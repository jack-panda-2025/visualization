"""
export.py — 完整导出管线
- 所有 55 帧
- Shell（四边形→三角形）+ Solid 外表面（hex8→三角形）合并渲染
- 仅存储表面节点坐标（Float32，绝对坐标），节省约 40% 空间
- PEEQ Float32，alive Uint8
- 每帧 zlib 压缩
- 输出到 output/
"""
import json, zlib
import numpy as np
from pathlib import Path
import pyvista as pv
from lasso.dyna import D3plot, ArrayType

ROOT = Path(__file__).resolve().parent.parent
OUT  = ROOT / "output"
OUT.mkdir(exist_ok=True)

# ── 加载 ───────────────────────────────────────────────────────────────────────
print("Loading d3plot ...")
d   = D3plot(str(ROOT / "d3plot"))
arr = d.arrays

t           = arr[ArrayType.global_timesteps]                               # (N_frames,)
coords      = arr[ArrayType.node_coordinates]                               # (N_nodes, 3)
node_disp   = arr[ArrayType.node_displacement]                              # (N_frames, N_nodes, 3) — absolute
shell_conn  = arr[ArrayType.element_shell_node_indexes]                     # (N_shell, 4)
shell_peeq  = arr[ArrayType.element_shell_effective_plastic_strain]         # (N_frames, N_shell, 3)
shell_alive = arr[ArrayType.element_shell_is_alive]                         # (N_frames, N_shell)
solid_conn  = arr[ArrayType.element_solid_node_indexes]                     # (N_solid, 8)
solid_alive = arr[ArrayType.element_solid_is_alive]                         # (N_frames, N_solid)

n_nodes  = coords.shape[0]
n_shell  = shell_conn.shape[0]
n_solid  = solid_conn.shape[0]
n_frames = len(t)

print(f"  Frames:{n_frames}  Nodes:{n_nodes:,}  Shell:{n_shell:,}  Solid:{n_solid:,}")

is_absolute = np.allclose(coords[0], node_disp[0][0], atol=1.0)
print(f"  node_displacement: {'ABSOLUTE' if is_absolute else 'RELATIVE (unexpected!)'}")

# ── Solid 外表面提取 ──────────────────────────────────────────────────────────
print("\nExtracting solid outer surface ...")

cells_flat = np.empty(n_solid * 9, dtype=np.int64)
cells_flat[0::9] = 8
for k in range(8):
    cells_flat[k+1::9] = solid_conn[:, k]
cell_types = np.full(n_solid, 12, dtype=np.uint8)   # VTK_HEXAHEDRON

solid_mesh = pv.UnstructuredGrid(cells_flat, cell_types, coords.astype(np.float32))
solid_surf = solid_mesh.extract_surface(algorithm='dataset_surface').triangulate()

surf_pt_ids    = solid_surf.point_data.get("vtkOriginalPointIds")  # local → global node ID
solid_cell_src = solid_surf.cell_data.get("vtkOriginalCellIds")    # surface tri → solid element idx

n_solid_surf_tris = solid_surf.n_cells
print(f"  Solid surface: {n_solid_surf_tris:,} tris  {solid_surf.n_points:,} points")
if solid_cell_src is None:
    print("  WARNING: vtkOriginalCellIds not found — solid alive set to 1")

# ── 构建统一三角形连接关系 ────────────────────────────────────────────────────
print("\nBuilding triangle connectivity ...")

def quads_to_tris(q):
    q = np.asarray(q, dtype=np.int64)
    t1 = q[:, [0, 1, 2]]
    t2 = q[:, [0, 2, 3]]
    return np.vstack([t1, t2])

# Shell：每个 quad → 2 tris
shell_tris    = quads_to_tris(shell_conn)          # (N_shell*2, 3)
shell_tri_src = np.tile(np.arange(n_shell), 2)     # tri i → shell element index

# Solid surface：local node IDs → global node IDs
solid_faces_local = solid_surf.faces.reshape(n_solid_surf_tris, 4)[:, 1:4]
if surf_pt_ids is not None:
    solid_tris = surf_pt_ids[solid_faces_local].astype(np.int64)
else:
    solid_tris = solid_faces_local.astype(np.int64)

all_tris     = np.vstack([shell_tris, solid_tris])
n_tris       = len(all_tris)
n_shell_tris = len(shell_tris)
n_solid_tris = len(solid_tris)
print(f"  Total: {n_tris:,} tris  (shell:{n_shell_tris:,}  solid:{n_solid_tris:,})")

# ── 压缩节点集：只保留表面用到的节点 ─────────────────────────────────────────
surf_node_ids = np.unique(all_tris)          # 全局节点 ID，排序后
n_surf_nodes  = len(surf_node_ids)
print(f"  Surface nodes: {n_surf_nodes:,} / {n_nodes:,}")

# 全局 ID → 紧凑索引
inv_map = np.empty(n_nodes, dtype=np.int32)
inv_map[surf_node_ids] = np.arange(n_surf_nodes, dtype=np.int32)

surf_tris = inv_map[all_tris].astype(np.int32)   # 紧凑连接关系

# ── 保存静态文件 ──────────────────────────────────────────────────────────────
(OUT / "connectivity.bin").write_bytes(surf_tris.tobytes())
print(f"  connectivity.bin: {surf_tris.nbytes // 1024:,} KB")

# ── 逐帧导出 ──────────────────────────────────────────────────────────────────
print(f"\nExporting {n_frames} frames ...")

peeq_max_global = 0.0
frame_info = []

for fi in range(n_frames):
    # 表面节点坐标（绝对，Float32）
    positions = node_disp[fi, surf_node_ids, :].astype(np.float32)  # (N_surf_nodes, 3)

    # PEEQ：shell tri → shell element 外表面值，solid tri → 0
    peeq_shell      = shell_peeq[fi, :, 0].astype(np.float32)       # (N_shell,)
    peeq_shell_tris = peeq_shell[shell_tri_src]                      # (N_shell*2,)
    peeq_solid_tris = np.zeros(n_solid_tris, dtype=np.float32)
    peeq_all        = np.concatenate([peeq_shell_tris, peeq_solid_tris])

    # Alive：uint8，1=可见，0=已删除
    alive_shell_tris = (shell_alive[fi][shell_tri_src] > 0.5).astype(np.uint8)
    if solid_cell_src is not None:
        alive_solid_tris = (solid_alive[fi][solid_cell_src] > 0.5).astype(np.uint8)
    else:
        alive_solid_tris = np.ones(n_solid_tris, dtype=np.uint8)
    alive_all = np.concatenate([alive_shell_tris, alive_solid_tris])

    # 打包 + zlib 压缩
    raw        = positions.tobytes() + peeq_all.tobytes() + alive_all.tobytes()
    compressed = zlib.compress(raw, level=6)
    (OUT / f"frame_{fi:02d}.bin").write_bytes(compressed)

    peeq_max = float(peeq_shell.max())
    peeq_max_global = max(peeq_max_global, peeq_max)

    print(f"  frame_{fi:02d}.bin  t={t[fi]:.4f}s  peeq_max={peeq_max:.4f}"
          f"  {len(raw)//1024:,}KB → {len(compressed)//1024:,}KB"
          f"  ({100*len(compressed)//len(raw)}%)")
    frame_info.append({"index": fi, "time": float(t[fi]), "file": f"frame_{fi:02d}.bin"})

# ── Manifest ──────────────────────────────────────────────────────────────────
pos0 = node_disp[0, surf_node_ids, :]

manifest = {
    "n_frames":     n_frames,
    "n_surf_nodes": int(n_surf_nodes),
    "n_tris":       int(n_tris),
    "n_shell_tris": int(n_shell_tris),
    "peeq_max":     peeq_max_global,
    "bounds": {
        "xmin": float(pos0[:,0].min()), "xmax": float(pos0[:,0].max()),
        "ymin": float(pos0[:,1].min()), "ymax": float(pos0[:,1].max()),
        "zmin": float(pos0[:,2].min()), "zmax": float(pos0[:,2].max()),
    },
    "frames": frame_info,
}

try:
    manifest["energy"] = {
        "times":    t.tolist(),
        "kinetic":  arr[ArrayType.global_kinetic_energy].tolist(),
        "internal": arr[ArrayType.global_internal_energy].tolist(),
    }
except Exception:
    pass

(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2))

print(f"\n=== Done ===")
print(f"  Output:   {OUT}")
print(f"  peeq_max: {peeq_max_global:.4f}")
