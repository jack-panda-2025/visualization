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
    ('Barrier steel',    r'steel tube|t lok|^reinforcement|anchor rebar|wave beam'),
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
    ('Wheels',           r'tire|rim|wheel'),
    ('Suspension',       r'aarm|upright|spindle|disk|brake|shock|sway|spring|leaf|suspension|steering|knuckle|tierod'),
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
    # Panels pressed directly against an outer skin. Real sheet metal is two
    # sheets spot-welded a few millimetres apart, and the simulation models
    # both; at that separation the depth buffer cannot tell them apart, so the
    # inner one shows through as dark z-fighting seams tracing its outline
    # across the hood and roof. Pushing the near plane out fixes the depth
    # precision but clips the body whenever the camera comes close, so the
    # inner panel goes instead — it is never visible from outside anyway.
    #
    # Deliberately narrow: doorinner, pillarinner and riminner all match a
    # plain 'inner' rule but are visible through openings or from the side.
    r'hoodinner',
    r'roofrail',
    # Laminated glass is modelled as three coincident layers — outer glass,
    # PVB interlayer, inner glass. Detected, not guessed: a 5 mm voxel scan
    # found these three sharing 12,043 cells, by far the worst overlap in the
    # mesh. Keep the outer layer only.
    r'windshield_bottom_layer',
    r'windshield_ploymer',
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


def state_files(case: Path) -> list[str]:
    """d3plot01 … d3plot202, ordered numerically.

    Sorted by the integer, not the string: plain sort puts d3plot100 before
    d3plot20, so the "last" frame would be d3plot99.
    """
    names = [f for f in os.listdir(case)
             if f.startswith('d3plot') and f[6:].isdigit()]
    return sorted(names, key=lambda f: int(f[6:]))


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


def write_msh2(path: Path, frames: list[tuple[float, np.ndarray]],
               tris: np.ndarray, tri_part: np.ndarray, tri_death: np.ndarray,
               titles: np.ndarray, groups: np.ndarray) -> None:
    """MSH2 — connectivity once, then one position block per frame.

    Connectivity is constant across the run (verified: element counts and
    their node indices are identical in frame 1 and frame 202), so repeating
    it per frame would triple the file for nothing.

    tri_death is how erosion is handled. A deleted element keeps its node
    positions while those nodes keep moving, so drawing it stretches a face
    across the scene; but deletion is monotonic, so each triangle carries the
    frame it dies at and the shader drops it from there on. That keeps the
    index buffer immutable and costs nothing per frame.
    """
    names = sorted(set(groups.tolist())) + ['Ground (synthetic)']
    idx = {n: i for i, n in enumerate(names)}
    tri_group = np.where(tri_part < 0, idx['Ground (synthetic)'],
                         [idx[g] for g in groups[np.maximum(tri_part, 0)]]
                         ).astype(np.uint8)
    n_vert = len(frames[0][1])

    with open(path, 'wb') as f:
        f.write(b'MSH2')
        f.write(np.array([n_vert, len(tris), len(names), len(frames)], '<i4').tobytes())
        f.write(np.array([t for t, _ in frames], '<f4').tobytes())
        f.write(np.ascontiguousarray(tris, '<u4').tobytes())
        f.write(tri_group.tobytes())
        f.write(np.ascontiguousarray(tri_death, '<u2').tobytes())
        for n in names:
            b = n.encode('utf-8')
            f.write(bytes([len(b)])); f.write(b)
        for _, pos in frames:
            f.write(np.ascontiguousarray(pos, '<f4').tobytes())

    mb = path.stat().st_size / 1e6
    print(f'wrote {path}  ({mb:.1f} MB)  {len(frames)} frames, '
          f'{n_vert:,} verts, {len(tris):,} tris')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--case', type=Path, required=True)
    ap.add_argument('--state', default='d3plot01')
    ap.add_argument('--out', type=Path, default=Path('mesh_frame.npz'))
    ap.add_argument('--frames', type=int, default=None, metavar='N',
                    help='Write N frames spread evenly over the run, as MSH2. '
                         'Requires --anim.')
    ap.add_argument('--anim', type=Path, default=None,
                    help='MSH2 output path (multi-frame)')
    ap.add_argument('--bin', type=Path, default=None,
                    help='Also write MSH1, the format the viewer loads')
    ap.add_argument('--barrier-margin', type=float, default=None, metavar='M',
                    help='Keep barrier only within M metres of the vehicle. '
                         'The barrier runs 73 m; the vehicle is 6 m and never '
                         'reaches most of it.')
    ap.add_argument('--outer-only', action='store_true',
                    help='Drop assemblies that sit under the skin — frame, '
                         'powertrain, floor, seats. Invisible from outside '
                         'and about 38%% of the triangles.')
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

    # ── trim the barrier to the impact region ────────────────────────────
    # Per element, not per part: every barrier part spans the full 73 m, so a
    # part-level test keeps all of them as soon as one element is near the car.
    #
    # Tested as a box around the vehicle rather than a range along x — the
    # barrier lies at -25.4 degrees, so no single axis describes its length.
    # The margin must cover where the vehicle *travels*, not just where it
    # starts: at 100 km/h it moves ~26 m, and a frame-0 box would cut away the
    # barrier it is about to hit.
    # Assemblies that form the visible outside. Everything else sits under
    # the skin and contributes nothing to an exterior view. Wheels are listed
    # explicitly: they are suspension by function but plainly visible.
    OUTER = {'Barrier concrete', 'Barrier steel', 'Hood', 'Fender', 'Bumper',
             'Lights', 'Glazing', 'Doors', 'Roof & cab rail', 'Pillars',
             'Cab body', 'Bed', 'Wheels', 'Ground',
             # A thin liner. Without it you see straight through the window
             # openings, wheel arches and underbody into an empty shell.
             'Floor & firewall',
             # Axles, uprights, control arms. Only ~36 k shells once wheels
             # are counted separately, and without them the wheels float.
             'Suspension'}
    if args.outer_only:
        inner = ~np.isin(groups, list(OUTER))
        print(f'{"parts: outer only":26}{len(titles):>12,}'
              f'{int((~inner & ~part_dropped).sum()):>12,}')
        part_dropped = part_dropped | inner

    is_barrier = np.char.startswith(groups, 'Barrier')
    box = None
    if args.barrier_margin is not None:
        # Groups that are unambiguously the vehicle's outer shell. Defining
        # the vehicle by negation ("not barrier") fails: names like
        # 216_fr_bodymountrearbrktreinforcementR match the barrier's
        # reinforcement rule, and one stray part anywhere in the scene
        # inflates the box until it covers everything.
        CORE = {'Cab body', 'Doors', 'Hood', 'Roof & cab rail', 'Bed',
                'Bumper', 'Fender', 'Glazing', 'Pillars'}
        veh_parts = np.flatnonzero(np.isin(groups, list(CORE)) & ~part_dropped)
        vmask = np.isin(a[ArrayType.element_shell_part_indexes], veh_parts)
        vnodes = np.unique(a[ArrayType.element_shell_node_indexes][vmask])
        m = args.barrier_margin * 1000
        box = (pos_all[vnodes].min(0) - m, pos_all[vnodes].max(0) + m)

    def in_range(conn: np.ndarray, part: np.ndarray) -> np.ndarray:
        """True for elements to keep: everything outside the barrier, plus the
        barrier elements whose centroid falls inside the box."""
        keep = np.ones(len(conn), bool)
        if box is None:
            return keep
        b = is_barrier[part]
        if not b.any():
            return keep
        c = pos_all[conn[b]].mean(axis=1)
        keep[b] = ((c >= box[0]) & (c <= box[1])).all(axis=1)
        return keep

    # ── shells ───────────────────────────────────────────────────────────
    sconn = a[ArrayType.element_shell_node_indexes]
    spart = a[ArrayType.element_shell_part_indexes]
    salive = a[ArrayType.element_shell_is_alive][0] != 0
    s_keep = ~part_dropped[spart] & in_range(sconn, spart)
    print(f'{"shells: drop parts":26}{len(sconn):>12,}{int(s_keep.sum()):>12,}')
    s_keep &= salive
    print(f'{"shells: drop dead":26}{"":>12}{int(s_keep.sum()):>12,}')

    # ── solids ───────────────────────────────────────────────────────────
    hconn = a[ArrayType.element_solid_node_indexes]
    hpart = a[ArrayType.element_solid_part_indexes]
    halive = a[ArrayType.element_solid_is_alive][0] != 0
    h_keep = (~part_dropped[hpart]) & in_range(hconn, hpart) & halive
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

    # ── the rest of the frames ───────────────────────────────────────────
    # Topology, the kept-element masks and the node subset are all decided
    # above from the first frame and reused unchanged: connectivity does not
    # vary across the run, and re-deriving it per frame would also risk the
    # element set drifting, which would invalidate the index buffer.
    if args.frames and args.anim:
        all_states = state_files(args.case.resolve())
        pick = [all_states[i] for i in
                np.linspace(0, len(all_states) - 1, args.frames).astype(int)]
        print(f'\nframes: {args.frames} of {len(all_states)}  '
              f'{pick[0]} … {pick[-1]}')

        n_quad_tris = len(tris) - 2                      # minus the ground pair
        death = np.full(n_quad_tris, 0xFFFF, np.uint16)  # 0xFFFF = survives
        out_frames: list[tuple[float, np.ndarray]] = []

        for fi, state in enumerate(pick):
            df = open_frame(args.case, state) if fi else d
            fa = df.arrays
            fpos = fa[ArrayType.node_displacement][0].astype(np.float32)
            gp = fpos[used]
            # the synthetic ground is fixed; recompute nothing, reuse frame 0's
            out_frames.append((float(fa[ArrayType.global_timesteps][0]),
                               np.vstack([gp, gpos])))

            # is_alive holds the part id and is zeroed on deletion, so the
            # test is != 0. Deletion is monotonic, so the first frame a
            # triangle is dead is the frame it dies at.
            sdead = fa[ArrayType.element_shell_is_alive][0][s_keep] == 0
            hdead = np.zeros(len(hfaces), bool)
            if len(hfaces):
                hd = fa[ArrayType.element_solid_is_alive][0][h_keep] == 0
                hdead = hd.repeat(6)[ok][cnt[inv] == 1]
            qdead = np.concatenate([sdead, hdead])
            tdead = np.tile(qdead, 2)
            death[tdead & (death == 0xFFFF)] = fi
            if fi:
                del df
            print(f'  {state:<10} t={out_frames[-1][0]:6.3f}s  '
                  f'dead so far {int((death != 0xFFFF).sum()):,}')

        write_msh2(args.anim, out_frames, tris,
                   np.concatenate([tpart[:n_quad_tris], [-1, -1]]),
                   np.concatenate([death, [0xFFFF, 0xFFFF]]), titles, groups)

    np.savez_compressed(
        args.out, positions=positions, triangles=tris, tri_part=tpart,
        tri_strain=tstrain, part_titles=titles, part_groups=groups,
        time=a[ArrayType.global_timesteps][0])
    print(f'wrote {args.out}  ({args.out.stat().st_size/1e6:.1f} MB on disk)')


if __name__ == '__main__':
    main()
