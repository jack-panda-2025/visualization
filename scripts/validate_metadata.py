#!/usr/bin/env python3
"""
Validate bin_output_v3/metadata.json and associated gz level files.
Checks:
- metadata exists and is valid JSON
- each frame has all declared levels with files present
- gzip decompresses and the uncompressed sha256 matches metadata sha
- reports summary and non-zero exit code on failures
"""

import sys
import json
from pathlib import Path
import gzip
import hashlib

ROOT = Path(__file__).resolve().parents[1]
META = ROOT / 'bin_output_v3' / 'metadata.json'

def sha256(b: bytes):
    return hashlib.sha256(b).hexdigest()


def main():
    if not META.exists():
        print('ERROR: metadata.json not found at', META)
        return 2
    try:
        meta = json.loads(META.read_text())
    except Exception as e:
        print('ERROR: failed to parse metadata.json:', e)
        return 2
    frames = meta.get('frames', [])
    total = len(frames)
    ok = 0
    problems = []
    for f in frames:
        src = f.get('source')
        levels = f.get('levels', {})
        for lvl, info in levels.items():
            fname = info.get('file')
            path = ROOT / 'bin_output_v3' / fname
            if not path.exists():
                problems.append(f"Missing file for {src} {lvl}: {fname}")
                continue
            if path.stat().st_size == 0:
                problems.append(f"Empty file for {src} {lvl}: {fname}")
                continue
            # try decompress and hash
            try:
                with gzip.open(path, 'rb') as gz:
                    data = gz.read()
                expected_sha = info.get('sha256')
                actual = sha256(data)
                if expected_sha and expected_sha != actual:
                    problems.append(f"Checksum mismatch for {src} {lvl}: expected {expected_sha}, got {actual}")
                    continue
            except Exception as e:
                problems.append(f"Failed to read/decompress {fname}: {e}")
                continue
            ok += 1
    print(f"Validated {ok} level files out of approx {total * 3} expected (3 levels per frame).")
    if problems:
        print('Problems found:')
        for p in problems:
            print(' -', p)
        return 1
    print('All checks passed.')
    return 0

if __name__ == '__main__':
    sys.exit(main())
