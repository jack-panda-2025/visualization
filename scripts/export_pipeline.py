#!/usr/bin/env python3
"""
Prototype export pipeline
- Scans for top-level files starting with `d3plot`
- For the first N files, creates a bin_output_v3 directory and writes three levels:
  coarse (1% first bytes), medium (10%), fine (100% gzipped)
- Generates metadata JSON with file names, sizes, and sha256 checksums

This is a pragmatic prototype to enable backend/frontend integration quickly.
"""

import os
import gzip
import json
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / 'bin_output_v3'
N_FRAMES = 5
LEVELS = [
    ('coarse', 0.01),
    ('medium', 0.10),
    ('fine', 1.0),
]


def sha256_of_bytes(b: bytes) -> str:
    import hashlib
    return hashlib.sha256(b).hexdigest()


def process_file(p: Path, out_dir: Path):
    size = p.stat().st_size
    frames_entry = {'source': p.name, 'size': size, 'levels': {}}
    with p.open('rb') as f:
        data = f.read()
    for name, frac in LEVELS:
        take = max(1024, int(size * frac)) if frac < 1.0 else size
        chunk = data[:take]
        out_name = f"{p.name}_{name}.bin.gz"
        out_path = out_dir / out_name
        with gzip.open(out_path, 'wb') as gz:
            gz.write(chunk)
        frames_entry['levels'][name] = {
            'file': out_name,
            'bytes': out_path.stat().st_size,
            'sha256': sha256_of_bytes(chunk),
            'source_bytes_taken': take,
        }
    return frames_entry


def main():
    ROOT = Path(__file__).resolve().parents[1]
    os.makedirs(OUT_DIR, exist_ok=True)
    d3files = sorted([p for p in ROOT.iterdir() if p.is_file() and p.name.startswith('d3plot')])
    if not d3files:
        print('No d3plot* files found in repo root. Exiting.')
        return
    d3files = d3files[:N_FRAMES]
    metadata = {'frames': [], 'generated_by': 'export_pipeline.py'}
    for p in d3files:
        print('Processing', p.name)
        entry = process_file(p, OUT_DIR)
        metadata['frames'].append(entry)
    meta_path = OUT_DIR / 'metadata.json'
    with meta_path.open('w') as mf:
        json.dump(metadata, mf, indent=2)
    print('Wrote metadata to', str(meta_path))


if __name__ == '__main__':
    main()
