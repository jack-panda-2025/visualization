#!/usr/bin/env python3
"""mesh_extract.py — one frame of a raw d3plot as a drawable triangle mesh.

The sampled h5 cannot produce a mesh: FPS sampling keeps an element only when
every one of its corners survives, which leaves under 1% of the shells. So the
geometry has to come from the raw d3plot, where the connectivity is intact.

This does one frame only, uncompressed, and reports what each reduction step
costs. The point is the numbers: until we know how many triangles survive,
choosing a compression stack is guesswork.

Reductions, in the order they are applied:

  1. drop whole parts      the ground plane, and the barrier's buried layers
  2. solid boundary only   a face shared by two bricks is invisible forever
  3. drop dead elements    is_alive == 0 (it stores the part id, zeroed on
                           deletion — never test == 1)
  4. renumber nodes        keep only nodes some surviving face still refers to.
                           Easy to forget, and without it the vertex count
                           stays at the full 3.3 M however many faces were cut.
  5. quads to triangles

Usage
-----
    python mesh_extract.py --case data_raw --state d3plot01 --out mesh_f0.npz
"""

from __future__ import annotations

import argparse
import os
import re
import tempfile
from pathlib import Path

import numpy as np
from lasso.dyna import ArrayType, D3plot

# Part name -> functional assembly. Same rules as the viewer's partGroups.ts,
# plus the layered-barrier names this case introduces (core / skin / wave beam).
# First match wins.
RULES: list[tuple[str, str]] = [
    ('Ground',           r'rigid fixed ground'),
    ('Barrier concrete', r'concrete|core|skin'),
    ('Barrier steel',    r'steel tube|t lok|rebar|reinforcement|wave beam'),
    ('Hood',             r'hood'),
    ('Fender',           r'fender'),
    ('Bumper',           r'bumper|frontface|grille|tow'),
    ('Lights',           r'headlight|taillight|lamp'),
    ('Glazing',          r'windshield|window|glass|backlite'),
    ('Doors',            r'door|lockplate|hinge'),
    ('Roof & cab rail',  r'roof|cabrail'),
    ('Pillars',          r'pillar'),
    ('Cab body',         r'sidepanel|backwall|cabpanel|rocker|bodyside|quarter'),
    ('Bed',              r'bed|tailgate'),
    ('Floor & firewall', r'floor|firewall|dash(?!.*screen)|tunnel'),
    ('Frame & rails',    r'rail|xmember|crossmem|frame|bodymount|shackle|brkt|bracket|sidebar|cornersupport'),
    ('Powertrain',       r'engine|transmiss|radiator|condensor|fan|gastank|fuel|battery|exhaust|muffler|oilpan|clutch|driveshaft|axle|differen|manifold|fusebox'),
    ('Suspension',       r'tire|rim|wheel|aarm|upright|spindle|disk|brake|shock|sway|spring|leaf|suspension|steering|knuckle|tierod'),
    ('Occupant',         r'seat|foam|dummy|belt|airbag|headrest|strap'),
    ('Instrument panel', r'ipbeam|dashboard|glovebox|console|steeringcol'),
    ('Sensors',          r'accelerom|sensor|nrb|rigid|spot weld'),
]

# Parts dropped outright. The ground is replaced by a synthetic plane below —
# the real one is a single 10 x 6 m quad, far too small for a vehicle that
# travels 26 m. The barrier's inner layers are sandwiched between its skins
# and never visible; keeping them costs ~900 k shells for nothing. Revisit if
# layer separation at the impact becomes the subject.
DROP_PATTERNS = [
    r'rigid fixed ground',
    r'inter skin',
    r'(first|second|third|fourth) core',
]

# Six quad faces of a hex, by local node order.
HEX_FACES = np.array([
    [0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1],
    [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0],
], dtype=np.int64)


def group_of(name: str) -> str:
    low = name.lower()
    for label, rx in RULES:
        if re.search(rx, low):
            return label
    return 'Other'


def open_frame(case: Path, state: str) -> D3plot:
    """Header plus one state file, symlinked alone into a temp directory.

    lasso loads every d3plotNN next to the header it is given — measured at
    ~0.135 GB per frame, so 202 frames would be about 27 GB. Showing it a
    directory with one state file is what keeps this to a single frame.
    """
    # resolve(): a symlink target is resolved relative to the link's own
    # directory, so a relative case path would dangle from inside /tmp
    case = case.resolve()
    tmp = Path(tempfile.mkdtemp(prefix='meshx_'))
    os.symlink(case / 'd3plot', tmp / 'd3plot')
    os.symlink(case / state, tmp / 'd3plot01')
    return D3plot(str(tmp / 'd3plot'))


def boundary_faces(conn: np.ndarray, keep: np.ndarray) -> np.ndarray:
    """Quad faces of the kept solids that belong to exactly one element.

    Faces are canonicalised by sorting their node ids before counting, so the
    two bricks sharing an interior face agree on its identity whatever their
    winding. Degenerate solids — tets and wedges are stored as hexes with
    repeated indices — collapse to faces with under three distinct nodes and
    are dropped, having no area.
    """
    if not keep.any():
        return np.empty((0, 4), dtype=np.int32)
    faces = conn[keep][:, HEX_FACES.ravel()].reshape(-1, 4).astype(np.int64)
    key = np.sort(faces, axis=1)
    ok = (np.diff(key, axis=1) != 0).sum(axis=1) + 1 >= 3
    faces, key = faces[ok], key[ok]
    _, inv, cnt = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    return faces[cnt[inv] == 1].astype(np.int32)


def write_msh1(path: Path, positions: np.ndarray, tris: np.ndarray,
               tri_part: np.ndarray, titles: np.ndarray, groups: np.ndarray,
               time_s: float) -> None:
    """Write MSH1 — one static frame, in the layout the front end reads.

    Triangles carry a group index rather than a part id: 21 assemblies fit in
    a uint8, where 940 part ids would need an int32 and four times the space
    for a distinction nothing in the view uses. The synthetic ground plane is
    part -1 and gets its own trailing group.
    """
    names = sorted(set(groups.tolist())) + ['Ground (synthetic)']
    idx = {n: i for i, n in enumerate(names)}
    tri_group = np.where(tri_part < 0, idx['Ground (synthetic)'],
                         [idx[g] for g in groups[np.maximum(tri_part, 0)]]
                         ).astype(np.uint8)

    with open(path, 'wb') as f:
        f.write(b'MSH1')
        f.write(np.array([len(positions), len(tris), len(names)], '<i4').tobytes())
        f.write(np.array([time_s], '<f4').tobytes())
        f.write(np.ascontiguousarray(positions, '<f4').tobytes())
        f.write(np.ascontiguousarray(tris, '<u4').tobytes())
        f.write(tri_group.tobytes())
        for n in names:
            b = n.encode('utf-8')
            f.write(bytes([len(b)])); f.write(b)
    print(f'wrote {path}  ({path.stat().st_size/1e6:.1f} MB)  {len(names)} groups')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--case', type=Path, required=True)
    ap.add_argument('--state', default='d3plot01')
    ap.add_argument('--out', type=Path, default=Path('mesh_frame.npz'))
    ap.add_argument('--bin', type=Path, default=None,
                    help='Also write MSH1, the format the viewer loads')
    ap.add_argument('--keep-barrier-inner', action='store_true',
                    help='Keep the barrier core and inter-skin layers')
    args = ap.parse_args()

    d = open_frame(args.case, args.state)
    a = d.arrays
    titles = np.array([t.decode('utf-8', 'replace').strip()
                       for t in a[ArrayType.part_titles]])
    groups = np.array([group_of(t) for t in titles])
    pos_all = a[ArrayType.node_displacement][0].astype(np.float32)

    drop_rx = DROP_PATTERNS if not args.keep_barrier_inner else [DROP_PATTERNS[0]]
    part_dropped = np.array([any(re.search(rx, t.lower()) for rx in drop_rx)
                             for t in titles])

    print(f'case {args.case}  state {args.state}  '
          f't = {a[ArrayType.global_timesteps][0]:.4f} s')
    print(f'{"":26}{"before":>12}{"after":>12}')

    # ── shells ───────────────────────────────────────────────────────────
    sconn = a[ArrayType.element_shell_node_indexes]
    spart = a[ArrayType.element_shell_part_indexes]
    salive = a[ArrayType.element_shell_is_alive][0] != 0
    s_keep = ~part_dropped[spart]
    print(f'{"shells: drop parts":26}{len(sconn):>12,}{int(s_keep.sum()):>12,}')
    s_keep &= salive
    print(f'{"shells: drop dead":26}{"":>12}{int(s_keep.sum()):>12,}')

    # ── solids ───────────────────────────────────────────────────────────
    hconn = a[ArrayType.element_solid_node_indexes]
    hpart = a[ArrayType.element_solid_part_indexes]
    halive = a[ArrayType.element_solid_is_alive][0] != 0
    h_keep = (~part_dropped[hpart]) & halive
    print(f'{"solids: kept":26}{len(hconn):>12,}{int(h_keep.sum()):>12,}')
    hfaces = boundary_faces(hconn, h_keep)
    print(f'{"solids: boundary faces":26}{int(h_keep.sum()) * 6:>12,}{len(hfaces):>12,}')

    # Each boundary face inherits its parent solid's part.
    hface_part = np.repeat(hpart[h_keep], 6)
    if len(hfaces):
        faces_all = hconn[h_keep][:, HEX_FACES.ravel()].reshape(-1, 4).astype(np.int64)
        key = np.sort(faces_all, axis=1)
        ok = (np.diff(key, axis=1) != 0).sum(axis=1) + 1 >= 3
        _, inv, cnt = np.unique(key[ok], axis=0, return_inverse=True, return_counts=True)
        hface_part = hface_part[ok][cnt[inv] == 1]

    quads = np.vstack([sconn[s_keep].astype(np.int32), hfaces])
    qpart = np.concatenate([spart[s_keep], hface_part]).astype(np.int32)

    # ── per-quad field ───────────────────────────────────────────────────
    sstrain = a[ArrayType.element_shell_effective_plastic_strain][0].max(axis=-1)
    hstrain = a[ArrayType.element_solid_effective_plastic_strain][0].reshape(len(hconn), -1).max(axis=-1)
    qstrain = np.concatenate([sstrain[s_keep],
                              hstrain[h_keep].repeat(6)[ok][cnt[inv] == 1]
                              if len(hfaces) else np.empty(0)]).astype(np.float32)

    # ── renumber: keep only nodes a surviving face still refers to ───────
    used, remap = np.unique(quads.ravel(), return_inverse=True)
    quads_local = remap.reshape(quads.shape).astype(np.int32)
    positions = pos_all[used]
    print(f'{"nodes referenced":26}{len(pos_all):>12,}{len(positions):>12,}')

    # ── quads to triangles ───────────────────────────────────────────────
    tris = np.vstack([quads_local[:, [0, 1, 2]], quads_local[:, [0, 2, 3]]])
    tpart = np.tile(qpart, 2)
    tstrain = np.tile(qstrain, 2)
    print(f'{"triangles":26}{"":>12}{len(tris):>12,}')

    # ── synthetic ground: a visual reference, not simulation data ────────
    lo, hi = positions.min(0), positions.max(0)
    pad = 0.15 * (hi[:2] - lo[:2])
    (x0, y0), (x1, y1) = lo[:2] - pad, hi[:2] + pad
    gpos = np.array([[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]], np.float32)
    base = len(positions)
    positions = np.vstack([positions, gpos])
    tris = np.vstack([tris, base + np.array([[0, 1, 2], [0, 2, 3]], np.int32)])
    tpart = np.concatenate([tpart, [-1, -1]])          # -1 marks synthetic
    tstrain = np.concatenate([tstrain, [0, 0]])

    nbytes = positions.nbytes + tris.nbytes
    print(f'\npositions {positions.nbytes/1e6:6.1f} MB   '
          f'indices {tris.nbytes/1e6:6.1f} MB   total {nbytes/1e6:6.1f} MB')

    if args.bin:
        write_msh1(args.bin, positions, tris, tpart, titles, groups,
                   float(a[ArrayType.global_timesteps][0]))

    np.savez_compressed(
        args.out, positions=positions, triangles=tris, tri_part=tpart,
        tri_strain=tstrain, part_titles=titles, part_groups=groups,
        time=a[ArrayType.global_timesteps][0])
    print(f'wrote {args.out}  ({args.out.stat().st_size/1e6:.1f} MB on disk)')


if __name__ == '__main__':
    main()
