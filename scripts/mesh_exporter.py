#!/usr/bin/env python3
"""
Mesh exporter prototype using trimesh + meshio
- Reads bin_output_v3/metadata.json to discover frames
- For each frame, generates three mesh LODs (coarse, medium, fine) as .ply files under vtp_output_v3/
- Computes basic mesh QA metrics and per-frame bounding boxes; writes vtp_output_v3/metadata.json

This is a pragmatic prototype: if real mesh parsing is available, replace the synthetic mesh generation
with real mesh conversion from parsed geometry.
"""

import json
from pathlib import Path
import gzip
import numpy as np
import trimesh
import meshio

ROOT = Path(__file__).resolve().parents[1]
IN_META = ROOT / 'bin_output_v3' / 'metadata.json'
OUT_DIR = ROOT / 'vtp_output_v3'
OUT_DIR.mkdir(exist_ok=True)
LEVELS = [('coarse',1), ('medium',2), ('fine',3)]  # icosphere subdivisions
TRANSLATE_STEP = 0.8

def mesh_metrics(mesh: trimesh.Trimesh):
    return {
        'vertices': int(mesh.vertices.shape[0]),
        'faces': int(mesh.faces.shape[0]),
        'is_watertight': bool(mesh.is_watertight),
        'euler_number': float(mesh.euler_number),
        'bounds': mesh.bounds.tolist(),
    }


def write_ply(mesh: trimesh.Trimesh, path: Path):
    # meshio expects points and cells
    points = mesh.vertices
    cells = [('triangle', mesh.faces)]
    meshio.write(str(path), meshio.Mesh(points, cells))


def main():
    if not IN_META.exists():
        print('Input metadata not found at', IN_META)
        return
    meta = json.loads(IN_META.read_text())
    out_meta = {'frames': []}
    for i, frame in enumerate(meta.get('frames', [])):
        src = frame.get('source')
        frame_entry = {'source': src, 'levels': {}}
        print('Generating meshes for', src)
        for name, subdiv in LEVELS:
            # Create an icosphere and translate by frame index to simulate motion
            sphere = trimesh.creation.icosphere(subdivisions=subdiv, radius=1.0)
            # apply small translation so successive frames can be tested for bbox overlap
            tx = i * TRANSLATE_STEP
            sphere.apply_translation([tx, 0.0, 0.0])
            out_name = f"{src}_{name}.ply"
            out_path = OUT_DIR / out_name
            write_ply(sphere, out_path)
            metrics = mesh_metrics(sphere)
            frame_entry['levels'][name] = {
                'file': out_name,
                'metrics': metrics
            }
        # simple collision heuristic: compare coarse bbox with previous frame coarse bbox
        out_meta['frames'].append(frame_entry)
    # compute bbox overlaps
    for j, f in enumerate(out_meta['frames']):
        bb = f['levels']['coarse']['metrics']['bounds']
        f['bbox'] = bb
        f['collision_with_prev'] = False
        if j>0:
            prev_bb = out_meta['frames'][j-1]['bbox']
            # bbox intersection test
            a_min = np.array(bb[0]); a_max = np.array(bb[1])
            b_min = np.array(prev_bb[0]); b_max = np.array(prev_bb[1])
            intersect = np.all(a_max >= b_min) and np.all(b_max >= a_min)
            f['collision_with_prev'] = bool(intersect)
    meta_path = OUT_DIR / 'metadata.json'
    meta_path.write_text(json.dumps(out_meta, indent=2))
    print('Wrote mesh outputs to', OUT_DIR)

if __name__ == '__main__':
    main()
