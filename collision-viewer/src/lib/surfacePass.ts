import * as THREE from 'three';

/**
 * Screen-space surface rendering for a deforming point cloud.
 *
 * The mesh's own connectivity is unusable here — region-aware FPS sampling
 * keeps an element only when all of its corners survive, which leaves 7,223
 * elements touching 9.3% of the nodes. Per-part convex hulls, the other
 * option, turn thin concave panels (doors, floor pans, rails) into solid
 * blocks. So the surface is never reconstructed as geometry at all:
 *
 *   1. splat pass    — draw each node as a shaded sphere, keep the nearest
 *                      view distance per pixel, and the field colour with it
 *   2. bilateral blur— smooth across the surface but not across silhouettes,
 *                      which is what fuses separate splats into one skin
 *   3. composite     — rebuild view positions from the smoothed distances,
 *                      take normals from their screen-space derivatives, light
 *
 * Nothing is precomputed, so deformation is handled for free: every frame is
 * rebuilt from the positions currently in the buffer. Uneven sampling density
 * is absorbed by step 2 rather than having to be corrected in the data.
 */

const QUAD_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// Splats are spheres, not flat discs: offsetting the reported distance by the
// sphere's own curvature is what makes neighbouring splats meet smoothly
// instead of leaving a visible disc edge at every point.
// GLSL3 throughout the splat passes: gl_FragDepth needs it, and three only
// provides the gl_FragColor alias for GLSL1, so these declare their own out.
const SPLAT_HEAD = `
in float size;
uniform float uScale;      // half the viewport height, in device px
uniform float uMul;        // splat diameter as a multiple of node spacing
uniform float uTanHalf;    // tan(fov/2)
out vec3 vView;
out float vRadius;
`;

const SPLAT_VERT_BODY = `
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  vRadius = size * uMul * 0.5;
  // A true projection of a world length, unlike three's sizeAttenuation,
  // which omits tan(fov/2) and so draws points at 41% of their real size at
  // a 45 deg fov. Points only have to be visible; splats have to overlap
  // their neighbours exactly, or the surface comes out perforated.
  gl_PointSize = max(2.0, vRadius * 2.0 * uScale / (-mv.z * uTanHalf));
  gl_Position = projectionMatrix * mv;
`;

// Each splat writes the depth of its own sphere surface. Without this the
// depth test ranks splats by their centres, so where two spheres overlap the
// winner's spherical cap is clipped against the loser's rather than the two
// merging — every splat shows up as a separate bump. Writing gl_FragDepth
// makes the pass render the true union of the spheres.
const SPLAT_FRAG_HEAD = `
precision highp float;
in vec3 vView;
in float vRadius;
uniform float uProjA;
uniform float uProjB;
out vec4 fragColor;
vec3 spherePoint(out float ok) {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  c.y = -c.y;
  float r2 = dot(c, c);
  ok = step(r2, 1.0);
  return vView + vec3(c.x, c.y, sqrt(max(0.0, 1.0 - r2))) * vRadius;
}
void writeDepth(vec3 p) {
  gl_FragDepth = (uProjA + uProjB / p.z) * 0.5 + 0.5;
}`;

const DEPTH_FRAG = `
${SPLAT_FRAG_HEAD}
void main() {
  float ok;
  vec3 p = spherePoint(ok);
  if (ok < 0.5) discard;
  writeDepth(p);
  fragColor = vec4(-p.z, 0.0, 0.0, 1.0);   // view distance, mm
}`;

const COLOR_FRAG = `
${SPLAT_FRAG_HEAD}
in vec3 vColor;
void main() {
  float ok;
  vec3 p = spherePoint(ok);
  if (ok < 0.5) discard;
  if (vColor.r + vColor.g + vColor.b == 0.0) discard;   // hidden / thinned out
  writeDepth(p);                 // must match the depth pass exactly, or colour
  fragColor = vec4(vColor, 1.0); // and distance come from different splats
}`;

const BLUR_FRAG = `
varying vec2 vUv;
uniform sampler2D uDepth;
uniform vec2 uDir;           // (1,0) or (0,1)
uniform vec2 uTexel;         // 1 / drawing-buffer size
uniform float uScale;        // half the drawing-buffer height
uniform float uTanHalf;
uniform float uSplatWorld;   // splat radius in mm
uniform float uSigmaS;       // taps across one splat
uniform float uSigmaZ;       // mm — how far apart two samples may be and
                             // still count as the same surface
void main() {
  float z = texture2D(uDepth, vUv).r;
  if (z <= 0.0) { gl_FragColor = vec4(0.0); return; }

  // The bumps to flatten are whole splats, so the kernel has to span one —
  // and a splat's pixel size grows as you zoom in. A fixed pixel kernel is
  // right at one distance only: at any closer range it smooths a fraction of
  // each sphere and the surface reads as a bunch of grapes.
  float splatPx = uSplatWorld * uScale / (z * uTanHalf);
  vec2 uStep = uDir * uTexel * max(1.0, splatPx / uSigmaS);

  float sum = z, wsum = 1.0;
  for (int i = 1; i <= 10; i++) {
    float fi = float(i);
    float ws = exp(-fi * fi / (2.0 * uSigmaS * uSigmaS));
    vec2 off = uStep * fi;
    float za = texture2D(uDepth, vUv + off).r;
    if (za > 0.0) {
      float dz = za - z;
      float w = ws * exp(-dz * dz / (2.0 * uSigmaZ * uSigmaZ));
      sum += za * w; wsum += w;
    }
    float zb = texture2D(uDepth, vUv - off).r;
    if (zb > 0.0) {
      float dz = zb - z;
      float w = ws * exp(-dz * dz / (2.0 * uSigmaZ * uSigmaZ));
      sum += zb * w; wsum += w;
    }
  }
  gl_FragColor = vec4(sum / wsum, 0.0, 0.0, 1.0);
}`;

const COMPOSITE_FRAG = `
varying vec2 vUv;
uniform sampler2D uDepth;
uniform sampler2D uColor;
uniform vec2 uTexel;
uniform float uTanHalf;
uniform float uAspect;
uniform vec3 uBg;

/** Colour averaged over a small cross, keeping only taps that sit on the same
 *  surface as the centre. Splat colour is decided per pixel by whichever
 *  sphere won the depth test, so raw colour is speckled and the seam between
 *  two parts comes out ragged; depth tells us which taps belong together. */
vec3 colorAt(vec2 uv, float z) {
  vec3 sum = texture2D(uColor, uv).rgb;
  float wsum = 1.0;
  for (int i = 1; i <= 2; i++) {
    vec2 d = uTexel * float(i);
    vec2 offs[4];
    offs[0] = vec2(d.x, 0.0); offs[1] = vec2(-d.x, 0.0);
    offs[2] = vec2(0.0, d.y); offs[3] = vec2(0.0, -d.y);
    for (int k = 0; k < 4; k++) {
      vec2 uv2 = uv + offs[k];
      float z2 = texture2D(uDepth, uv2).r;
      if (z2 <= 0.0) continue;
      float w = exp(-abs(z2 - z) / 6.0);   // mm
      sum += texture2D(uColor, uv2).rgb * w;
      wsum += w;
    }
  }
  return sum / wsum;
}

vec3 viewAt(vec2 uv) {
  float z = texture2D(uDepth, uv).r;
  vec2 ndc = uv * 2.0 - 1.0;
  return vec3(ndc.x * uTanHalf * uAspect, ndc.y * uTanHalf, -1.0) * z;
}

void main() {
  float z = texture2D(uDepth, vUv).r;
  if (z <= 0.0) { gl_FragColor = vec4(uBg, 1.0); return; }

  vec3 p = viewAt(vUv);
  // Two-sided differences, keeping whichever side is the smaller step: across
  // a silhouette one side jumps to a far surface and would bend the normal.
  vec3 dxA = viewAt(vUv + vec2(uTexel.x, 0.0)) - p;
  vec3 dxB = p - viewAt(vUv - vec2(uTexel.x, 0.0));
  vec3 dx = abs(dxA.z) < abs(dxB.z) ? dxA : dxB;
  vec3 dyA = viewAt(vUv + vec2(0.0, uTexel.y)) - p;
  vec3 dyB = p - viewAt(vUv - vec2(0.0, uTexel.y));
  vec3 dy = abs(dyA.z) < abs(dyB.z) ? dyA : dyB;

  vec3 n = normalize(cross(dx, dy));
  if (n.z < 0.0) n = -n;

  vec3 albedo = colorAt(vUv, z);
  vec3 L = normalize(vec3(0.4, 0.7, 0.6));
  vec3 V = normalize(-p);
  vec3 H = normalize(L + V);
  float diff = max(dot(n, L), 0.0);
  float spec = pow(max(dot(n, H), 0.0), 45.0) * 0.13;
  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0) * 0.07;

  vec3 col = albedo * (0.42 + 0.58 * diff) + vec3(spec + rim);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export interface SurfacePass {
  render(): void;
  setSize(w: number, h: number): void;
  setParams(p: { radius?: number; smooth?: number; spacing?: number }): void;
  dispose(): void;
}

/** Wraps one panel's renderer/scene/camera. `cloud`'s material is swapped
 *  during the pass and restored, so the caller's point-cloud mode is
 *  unaffected. */
export function createSurfacePass(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  cloud: THREE.Points,
  background: number,
): SurfacePass {
  const gl = renderer.getContext();
  const floatOk = !!(gl as WebGL2RenderingContext).getExtension?.('EXT_color_buffer_float');
  const type = floatOk ? THREE.FloatType : THREE.HalfFloatType;
  const rtOpts: THREE.RenderTargetOptions = {
    type, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: true, stencilBuffer: false,
    generateMipmaps: false,
  };

  const depthA = new THREE.WebGLRenderTarget(1, 1, rtOpts);
  const depthB = new THREE.WebGLRenderTarget(1, 1, rtOpts);
  const colorRT = new THREE.WebGLRenderTarget(1, 1, {
    ...rtOpts, type: THREE.UnsignedByteType,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });

  const splatUniforms = {
    uScale: { value: 300 },
    uMul: { value: 1.8 },
    uTanHalf: { value: 0.414 },
    uProjA: { value: 1 },
    uProjB: { value: 1 },
  };
  const depthMat = new THREE.ShaderMaterial({
    vertexShader: `${SPLAT_HEAD}\nvoid main() {${SPLAT_VERT_BODY}}`,
    fragmentShader: DEPTH_FRAG,
    uniforms: splatUniforms,
    glslVersion: THREE.GLSL3,
  });
  const colorMat = new THREE.ShaderMaterial({
    vertexShader: `${SPLAT_HEAD}\nin vec3 color;\nout vec3 vColor;\n` +
      `void main() { vColor = color;${SPLAT_VERT_BODY}}`,
    fragmentShader: COLOR_FRAG,
    uniforms: splatUniforms,
    glslVersion: THREE.GLSL3,
  });

  const quadScene = new THREE.Scene();
  const quadCam = new THREE.Camera();
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const blurMat = new THREE.ShaderMaterial({
    vertexShader: QUAD_VERT, fragmentShader: BLUR_FRAG,
    depthTest: false, depthWrite: false,
    uniforms: {
      uDepth: { value: depthA.texture },
      uDir: { value: new THREE.Vector2() },
      uTexel: { value: new THREE.Vector2() },
      uScale: { value: 300 },
      uTanHalf: { value: 0.414 },
      uSplatWorld: { value: 40 },
      uSigmaS: { value: 5 },
      uSigmaZ: { value: 120 },
    },
  });
  const compMat = new THREE.ShaderMaterial({
    vertexShader: QUAD_VERT, fragmentShader: COMPOSITE_FRAG,
    depthTest: false, depthWrite: false,
    uniforms: {
      uDepth: { value: depthA.texture },
      uColor: { value: colorRT.texture },
      uTexel: { value: new THREE.Vector2() },
      uTanHalf: { value: 0.4 },
      uAspect: { value: 1 },
      uBg: { value: new THREE.Color(background) },
    },
  });
  const quad = new THREE.Mesh(quadGeo, blurMat);
  quadScene.add(quad);

  const prevClear = new THREE.Color();
  const BLACK = new THREE.Color(0x000000);
  let W = 1, H = 1;
  let radius = 1.8;
  let spacingMm = 40;      // representative node spacing, set by the caller

  function setSize(w: number, h: number) {
    W = Math.max(1, Math.floor(w)); H = Math.max(1, Math.floor(h));
    const dpr = renderer.getPixelRatio();
    const bw = Math.floor(W * dpr), bh = Math.floor(H * dpr);
    depthA.setSize(bw, bh); depthB.setSize(bw, bh); colorRT.setSize(bw, bh);
    compMat.uniforms.uTexel.value.set(1 / bw, 1 / bh);
    blurMat.uniforms.uTexel.value.set(1 / bw, 1 / bh);
    blurMat.uniforms.uScale.value = bh * 0.5;
    splatUniforms.uScale.value = bh * 0.5;   // gl_PointSize is in device px
  }

  function render() {
    // Deliberately independent of the point cloud's size slider: the splat
    // radius is a property of the surface reconstruction, not a look setting.
    const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
    const { near: nz, far: fz } = camera;
    splatUniforms.uMul.value = radius;
    splatUniforms.uTanHalf.value = tanHalf;
    // ndc = A + B / viewZ, the perspective depth mapping written out so the
    // fragment shader does not need the projection matrix.
    splatUniforms.uProjA.value = (fz + nz) / (fz - nz);
    splatUniforms.uProjB.value = (2 * fz * nz) / (fz - nz);
    blurMat.uniforms.uTanHalf.value = tanHalf;
    blurMat.uniforms.uSplatWorld.value = spacingMm * radius * 0.5;
    compMat.uniforms.uTanHalf.value = tanHalf;
    compMat.uniforms.uAspect.value = camera.aspect;

    const prevMat = cloud.material;
    const prevTarget = renderer.getRenderTarget();

    // Both targets must clear to 0, not to the scene's background: the
    // composite reads "distance > 0" as "a surface is here", and the usual
    // dark clear colour (0.039) would mark every empty pixel as a surface
    // 0.04 mm from the eye.
    renderer.getClearColor(prevClear);
    const prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(BLACK, 0);

    cloud.material = depthMat;
    renderer.setRenderTarget(depthA);
    renderer.clear();
    renderer.render(scene, camera);

    cloud.material = colorMat;
    renderer.setRenderTarget(colorRT);
    renderer.clear();
    renderer.render(scene, camera);
    cloud.material = prevMat;

    renderer.setClearColor(prevClear, prevAlpha);

    // Separable bilateral blur: depthA -> depthB -> depthA.
    quad.material = blurMat;
    blurMat.uniforms.uDepth.value = depthA.texture;
    blurMat.uniforms.uDir.value.set(1, 0);
    renderer.setRenderTarget(depthB);
    renderer.render(quadScene, quadCam);

    blurMat.uniforms.uDepth.value = depthB.texture;
    blurMat.uniforms.uDir.value.set(0, 1);
    renderer.setRenderTarget(depthA);
    renderer.render(quadScene, quadCam);

    quad.material = compMat;
    compMat.uniforms.uDepth.value = depthA.texture;
    renderer.setRenderTarget(prevTarget);
    renderer.render(quadScene, quadCam);
  }

  return {
    render, setSize,
    setParams({ radius: r, smooth, spacing }) {
      if (r !== undefined) radius = r;
      if (spacing !== undefined && spacing > 0) spacingMm = spacing;
      if (smooth !== undefined) {
        blurMat.uniforms.uSigmaS.value = Math.max(0.5, smooth);
        blurMat.uniforms.uSigmaZ.value = 40 + smooth * 40;
      }
    },
    dispose() {
      depthA.dispose(); depthB.dispose(); colorRT.dispose();
      depthMat.dispose(); colorMat.dispose();
      blurMat.dispose(); compMat.dispose(); quadGeo.dispose();
    },
  };
}
