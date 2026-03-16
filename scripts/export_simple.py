"""
export_simple.py — 简化导出，优先跑通流程
- 前 10 帧
- float32 直出（不做量化）
- 无压缩
- Shell + Solid 外表面合并渲染
"""
import json, numpy as np
from pathlib import Path
import pyvista as pv
from lasso.dyna import D3plot, ArrayType

ROOT     = Path(__file__).resolve().parent.parent
OUT      = ROOT / "output_simple"
OUT.mkdir(exist_ok=True)

N_FRAMES = 10

print("Loading d3plot ...")
d   = D3plot(str(ROOT / "d3plot"))
arr = d.arrays

t           = arr[ArrayType.global_timesteps]
node_disp   = arr[ArrayType.node_displacement]      # (55, N_nodes, 3) — absolute coords
coords      = arr[ArrayType.node_coordinates]        # (N_nodes, 3)
shell_conn  = arr[ArrayType.element_shell_node_indexes]  # (N_shell, 4)
shell_peeq  = arr[ArrayType.element_shell_effective_plastic_strain]  # (55, N_shell, 3)
shell_alive = arr[ArrayType.element_shell_is_alive]  # (55, N_shell)
solid_conn  = arr[ArrayType.element_solid_node_indexes]  # (N_solid, 8)
solid_alive = arr[ArrayType.element_solid_is_alive]  # (55, N_solid)

n_nodes = coords.shape[0]
n_shell = shell_conn.shape[0]
n_solid = solid_conn.shape[0]
frames  = list(range(min(N_FRAMES, len(t))))

print(f"  Nodes: {n_nodes:,}  Shell: {n_shell:,}  Solid: {n_solid:,}")

# ── 验证坐标类型 ───────────────────────────────────────────────────────────────
is_absolute = np.allclose(coords[0], node_disp[0][0], atol=1.0)
print(f"  node_displacement: {'ABSOLUTE' if is_absolute else 'RELATIVE'}")

# ── 提取 Solid 外表面（用 PyVista） ───────────────────────────────────────────
print("\nExtracting solid outer surface ...")

# 构建 hex8 UnstructuredGrid
# PyVista cell format: [8, n0,n1,n2,n3,n4,n5,n6,n7] per cell
n_so = n_solid
cells_flat = np.empty(n_so * 9, dtype=np.int64)
cells_flat[0::9] = 8
for k in range(8):
    cells_flat[k+1::9] = solid_conn[:, k]

cell_types = np.full(n_so, 12, dtype=np.uint8)   # VTK_HEXAHEDRON = 12
solid_mesh = pv.UnstructuredGrid(cells_flat, cell_types, coords.astype(np.float32))
# triangulate() ensures all surface faces are triangles before extraction
solid_surf = solid_mesh.extract_surface().triangulate()
# extract_surface 返回 PolyData，点集是原始点的子集
# 获取 surface 点 → 原始节点的映射
surf_pt_ids = solid_surf.point_data.get("vtkOriginalPointIds")
print(f"  Solid surface: {solid_surf.n_cells:,} faces  {solid_surf.n_points:,} points")

# ── 构建合并连接表 ─────────────────────────────────────────────────────────────
# solid surface 全三角形: faces 格式 [3, i0, i1, i2, 3, i0, i1, i2, ...]
solid_face_flat = solid_surf.faces  # 1D array: groups of [3, i0, i1, i2]
n_solid_surf_tris = solid_surf.n_cells
solid_local_tris = solid_face_flat.reshape(n_solid_surf_tris, 4)[:, 1:4]  # (N, 3)

# 将 solid surface 的局部点 ID 映射为全局节点 ID
if surf_pt_ids is not None:
    solid_global_tris = surf_pt_ids[solid_local_tris]
else:
    solid_global_tris = solid_local_tris

# Shell quads: shape (N_shell, 4) → split into 2 tris each
shell_quads = shell_conn.astype(np.int32)

def quads_to_tris(q):
    t1 = q[:, [0, 1, 2]]
    t2 = q[:, [0, 2, 3]]
    return np.vstack([t1, t2]).astype(np.int32)

all_tris = np.vstack([
    quads_to_tris(shell_quads),
    solid_global_tris.astype(np.int32),
])
n_tris = len(all_tris)

# 记录每个三角形来自哪里（用于 PEEQ 赋值）
n_shell_tris = n_shell * 2
n_solid_tris = n_solid_surf_tris

print(f"  Total triangles: {n_tris:,}  (shell:{n_shell_tris:,}  solid_surf:{n_solid_tris:,})")

# ── 保存连接关系 ───────────────────────────────────────────────────────────────
(OUT / "connectivity.bin").write_bytes(all_tris.tobytes())
print(f"  connectivity.bin: {all_tris.nbytes//1024} KB")

# ── 逐帧导出 ──────────────────────────────────────────────────────────────────
frame_info = []
for out_idx, fi in enumerate(frames):
    positions = node_disp[fi].astype(np.float32) if is_absolute \
                else (coords + node_disp[fi]).astype(np.float32)

    # PEEQ: shell 元素的外表面值
    peeq_shell = shell_peeq[fi, :, 0].astype(np.float32)   # (N_shell,)
    # 每个 shell quad 拆成 2 个 tri，peeq 相同
    peeq_shell_tris = np.repeat(peeq_shell, 2)               # (N_shell*2,)
    # Solid surface 无 peeq，填 0
    peeq_solid_tris = np.zeros(n_solid_tris, dtype=np.float32)
    peeq_all = np.concatenate([peeq_shell_tris, peeq_solid_tris])

    # alive: shell
    alive_shell = shell_alive[fi].astype(np.float32)
    alive_shell_tris = np.repeat(alive_shell, 2)
    alive_solid_tris = np.ones(n_solid_tris, dtype=np.float32)  # solid 始终可见
    alive_all = np.concatenate([alive_shell_tris, alive_solid_tris])

    raw = positions.tobytes() + peeq_all.tobytes() + alive_all.tobytes()
    (OUT / f"frame_{out_idx:02d}.bin").write_bytes(raw)

    print(f"  frame_{out_idx:02d}.bin  t={t[fi]:.4f}s  peeq_max={peeq_shell.max():.4f}  {len(raw)//1024} KB")
    frame_info.append({"index": out_idx, "time": float(t[fi]), "file": f"frame_{out_idx:02d}.bin"})

# ── Manifest ──────────────────────────────────────────────────────────────────
peeq_max_global = float(shell_peeq[frames, :, 0].max())
pos0 = node_disp[0] if is_absolute else coords

manifest = {
    "n_frames":       len(frames),
    "n_nodes":        int(n_nodes),
    "n_tris":         int(n_tris),
    "n_shell_tris":   int(n_shell_tris),
    "peeq_max":       peeq_max_global,
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
print(f"  peeq_max: {peeq_max_global:.4f}")
print(f"  Output: {OUT}")
