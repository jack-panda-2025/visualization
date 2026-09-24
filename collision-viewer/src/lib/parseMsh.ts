// MSH1 — one static frame of a raw d3plot as a triangle mesh.
// Written by ../../mesh_extract.py; see write_msh1() there for the layout.

export interface MeshData {
  time: number;
  positions: Float32Array;   // n_verts * 3, mm
  triangles: Uint32Array;    // n_tris * 3, indices into positions
  triGroup: Uint8Array;      // n_tris, index into groups
  groups: string[];
}

export function parseMsh(buffer: ArrayBuffer): MeshData {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (magic !== 'MSH1') throw new Error(`Not a MSH1 file (magic "${magic}")`);

  const nVerts = view.getInt32(4, true);
  const nTris = view.getInt32(8, true);
  const nGroups = view.getInt32(12, true);
  const time = view.getFloat32(16, true);

  // slice() rather than a zero-copy view: the uint8 group block leaves the
  // following offsets unaligned for a Uint32Array, which would throw.
  let off = 20;
  const positions = new Float32Array(buffer.slice(off, off + nVerts * 12));
  off += nVerts * 12;
  const triangles = new Uint32Array(buffer.slice(off, off + nTris * 12));
  off += nTris * 12;
  const triGroup = new Uint8Array(buffer.slice(off, off + nTris));
  off += nTris;

  const groups: string[] = [];
  const dec = new TextDecoder();
  for (let i = 0; i < nGroups; i++) {
    const len = view.getUint8(off); off += 1;
    groups.push(dec.decode(new Uint8Array(buffer, off, len))); off += len;
  }
  return { time, positions, triangles, triGroup, groups };
}

/** Muted categorical palette, matching the comparison views. Ground is last
 *  and deliberately flat — it is a visual reference, not simulation data. */
export const GROUP_COLOR: Record<string, string> = {
  'Barrier concrete': '#6b7076', 'Barrier steel': '#454c54',
  'Hood': '#3d6fa0', 'Fender': '#3f8288', 'Bumper': '#a34a3f',
  'Lights': '#c08a2a', 'Glazing': '#7fa8b8', 'Doors': '#7a7f3a',
  'Roof & cab rail': '#4a5d8a', 'Pillars': '#6b5a8a', 'Cab body': '#4a7f52',
  'Bed': '#8a7a4a', 'Floor & firewall': '#8a5a2b', 'Frame & rails': '#7f4a4a',
  'Powertrain': '#2f6b6b', 'Suspension': '#9a6b8a', 'Occupant': '#b08a2e',
  'Instrument panel': '#566370', 'Sensors': '#b5514c', 'Other': '#5c6169',
  'Ground': '#3a3f45', 'Ground (synthetic)': '#2b3036',
};
