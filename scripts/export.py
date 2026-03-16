"""
D3plot → VTK.js 数据导出脚本

输出结构:
  output/
  ├── geometry.vtp      静态几何：Shell 外表面节点 + 连接关系
  ├── frame_00.bin      动态数据：Float16 位移 + PEEQ，zlib 压缩
  ├── frame_01.bin
  ├── ...
  └── manifest.json     元数据：帧时间、scale/offset、节点数等
"""

import json
import zlib
import struct
import numpy as np
from pathlib import Path
import pyvista as pv
from lasso.dyna import D3plot, ArrayType

ROOT = Path(__file__).resolve().parent.parent

# ─── 配置 ────────────────────────────────────────────────────────────────────
OUTPUT_DIR   = ROOT / "output"
D3PLOT_PATH  = str(ROOT / "d3plot")
TARGET_FRAMES = 30          # 目标抽帧数（自适应）
MIN_PEEQ_CHANGE = 0.001     # 自适应抽帧：PEEQ 变化阈值

OUTPUT_DIR.mkdir(exist_ok=True)

# ─── 加载 ────────────────────────────────────────────────────────────────────
print("Loading d3plot ...")
d   = D3plot(D3PLOT_PATH)
arr = d.arrays

t             = arr[ArrayType.global_timesteps]            # (55,)
node_coords   = arr[ArrayType.node_coordinates]            # (N_nodes, 3)
node_disp     = arr[ArrayType.node_displacement]           # (55, N_nodes, 3)
shell_conn    = arr[ArrayType.element_shell_node_indexes]  # (N_shell, 4)
shell_peeq    = arr[ArrayType.element_shell_effective_plastic_strain]  # (55, N_shell, 3)
shell_alive   = arr[ArrayType.element_shell_is_alive]      # (55, N_shell)

n_frames      = len(t)
n_nodes       = node_coords.shape[0]
n_shell       = shell_conn.shape[0]

print(f"  Frames: {n_frames}, Nodes: {n_nodes:,}, Shell elements: {n_shell:,}")

# ─── Step 1: 自适应抽帧 ───────────────────────────────────────────────────────
print("\nStep 1: Adaptive frame selection ...")

peeq_outer = shell_peeq[:, :, 0]  # (55, N_shell)

# 贪心算法：从首帧开始，当位移或 PEEQ 的累积变化超过阈值时才纳入下一帧
disp_mag_per_frame = np.linalg.norm(node_disp, axis=2).max(axis=1)  # (55,)
peeq_max_per_frame = peeq_outer.max(axis=1)                          # (55,)

# 归一化到 [0,1]
disp_norm = (disp_mag_per_frame - disp_mag_per_frame.min()) / (np.ptp(disp_mag_per_frame) + 1e-12)
peeq_norm = (peeq_max_per_frame - peeq_max_per_frame.min()) / (np.ptp(peeq_max_per_frame) + 1e-12)
change    = 0.6 * disp_norm + 0.4 * peeq_norm  # 综合变化量

# 计算步长阈值使最终选帧数约等于 TARGET_FRAMES
step_threshold = 1.0 / TARGET_FRAMES

selected = [0]
accumulated = 0.0
for i in range(1, n_frames):
    accumulated += abs(change[i] - change[i - 1])
    if accumulated >= step_threshold or i == n_frames - 1:
        selected.append(i)
        accumulated = 0.0

print(f"  Selected {len(selected)} frames from {n_frames}: {selected}")

# ─── Step 2: 构建 Shell 外表面几何（PyVista） ─────────────────────────────────
print("\nStep 2: Building shell surface geometry ...")

# 将 Shell 四边形连接关系转为 PyVista faces 格式 (每行: 4, n0, n1, n2, n3)
faces_flat = np.hstack([
    np.full((n_shell, 1), 4, dtype=np.int32),
    shell_conn.astype(np.int32)
]).ravel()

mesh = pv.PolyData(node_coords.astype(np.float32), faces_flat)

# 提取外表面（去除内部重叠面，减少单元数）
surface = mesh.extract_surface()
print(f"  Shell mesh: {n_shell:,} quads → surface: {surface.n_cells:,} cells, {surface.n_points:,} points")

# 记录表面点映射（surface 有自己的点索引）
surf_point_ids = surface.point_data.get("vtkOriginalPointIds")
if surf_point_ids is None:
    # 若无映射则用全量点
    surf_point_ids = np.arange(n_nodes)

# 导出静态几何 VTP（仅坐标 + 连接关系，无标量）
geo_path = OUTPUT_DIR / "geometry.vtp"
surface_geo = pv.PolyData(surface.points, surface.faces)
surface_geo.save(str(geo_path), binary=True)
geo_size = geo_path.stat().st_size / 1024 / 1024
print(f"  geometry.vtp saved: {geo_size:.1f} MB")

# ─── Step 3: 逐帧导出动态数据（Float16 + zlib） ───────────────────────────────
print("\nStep 3: Exporting per-frame binary data ...")

# 预计算全局 displacement 和 PEEQ 的 scale/offset，用于 Float16 量化
# 取所有选定帧的统计
disp_selected = node_disp[selected]          # (n_sel, N_nodes, 3)
peeq_selected = peeq_outer[selected]         # (n_sel, N_shell)

# 位移：以表面点为准
surf_disp_all = disp_selected[:, surf_point_ids, :]  # (n_sel, N_surf_pts, 3)
disp_min = float(surf_disp_all.min())
disp_max = float(surf_disp_all.max())
disp_scale  = (disp_max - disp_min) / 65535.0 if disp_max != disp_min else 1.0
disp_offset = disp_min

# PEEQ
peeq_min = float(peeq_selected.min())
peeq_max = float(peeq_selected.max())
peeq_scale  = (peeq_max - peeq_min) / 65535.0 if peeq_max != peeq_min else 1.0
peeq_offset = peeq_min

frame_info = []
total_raw = 0
total_compressed = 0

for out_idx, frame_idx in enumerate(selected):
    # --- 位移（表面点） ---
    surf_disp = node_disp[frame_idx][surf_point_ids]  # (N_surf_pts, 3)
    disp_u16  = np.clip(
        ((surf_disp - disp_offset) / disp_scale), 0, 65535
    ).astype(np.uint16)

    # --- PEEQ（需要映射到表面单元） ---
    # surface 的单元对应原始 shell 的哪些？
    # PyVista extract_surface 会保留 vtkOriginalCellIds
    orig_cell_ids = surface.cell_data.get("vtkOriginalCellIds")
    if orig_cell_ids is not None:
        frame_peeq = peeq_outer[frame_idx][orig_cell_ids]
    else:
        # fallback：用全部 shell peeq（截断到 surface 单元数）
        frame_peeq = peeq_outer[frame_idx][:surface.n_cells]

    peeq_u16 = np.clip(
        ((frame_peeq - peeq_offset) / peeq_scale), 0, 65535
    ).astype(np.uint16)

    # --- 单元存活标记（1bit → uint8） ---
    if orig_cell_ids is not None:
        alive_flag = shell_alive[frame_idx][orig_cell_ids].astype(np.uint8)
    else:
        alive_flag = shell_alive[frame_idx][:surface.n_cells].astype(np.uint8)
    alive_packed = np.packbits(alive_flag > 0.5)  # bit-pack，进一步压缩

    # --- 打包：[disp_u16 | peeq_u16 | alive_packed] ---
    raw_bytes = disp_u16.tobytes() + peeq_u16.tobytes() + alive_packed.tobytes()
    compressed = zlib.compress(raw_bytes, level=6)

    out_path = OUTPUT_DIR / f"frame_{out_idx:02d}.bin"
    out_path.write_bytes(compressed)

    raw_kb  = len(raw_bytes) / 1024
    comp_kb = len(compressed) / 1024
    total_raw        += len(raw_bytes)
    total_compressed += len(compressed)

    frame_info.append({
        "index":      out_idx,
        "time":       float(t[frame_idx]),
        "frame_idx":  int(frame_idx),
        "file":       f"frame_{out_idx:02d}.bin",
        "raw_bytes":  len(raw_bytes),
        "comp_bytes": len(compressed),
    })
    print(f"  frame_{out_idx:02d}.bin  t={t[frame_idx]:.4f}s  "
          f"{raw_kb:.0f}KB → {comp_kb:.0f}KB  "
          f"({100*len(compressed)/len(raw_bytes):.0f}%)")

# ─── Step 4: 写 manifest.json ────────────────────────────────────────────────
print("\nStep 4: Writing manifest.json ...")

manifest = {
    "version": 1,
    "n_frames":      len(selected),
    "n_surf_points": int(surface.n_points),
    "n_surf_cells":  int(surface.n_cells),
    "n_nodes_orig":  int(n_nodes),
    "geometry_file": "geometry.vtp",
    "encoding": {
        "displacement": {
            "dtype":  "uint16",
            "shape":  [-1, 3],          # [N_surf_points, 3]
            "scale":  disp_scale,
            "offset": disp_offset,
            "unit":   "mm",
        },
        "peeq": {
            "dtype":  "uint16",
            "shape":  [-1],             # [N_surf_cells]
            "scale":  peeq_scale,
            "offset": peeq_offset,
        },
        "alive": {
            "dtype":   "uint8",
            "bitpack": True,
            "shape":   [-1],            # [N_surf_cells], bit-packed
        },
    },
    "frames": frame_info,
    "stats": {
        "total_raw_MB":        round(total_raw / 1024 / 1024, 2),
        "total_compressed_MB": round(total_compressed / 1024 / 1024, 2),
        "compression_ratio":   round(total_raw / total_compressed, 2),
    },
}

manifest_path = OUTPUT_DIR / "manifest.json"
manifest_path.write_text(json.dumps(manifest, indent=2))

# ─── 汇总 ────────────────────────────────────────────────────────────────────
print("\n=== Export Summary ===")
print(f"  Output dir   : {OUTPUT_DIR.resolve()}")
print(f"  Frames       : {len(selected)} / {n_frames}")
print(f"  Surface pts  : {surface.n_points:,}  cells: {surface.n_cells:,}")
print(f"  geometry.vtp : {geo_size:.1f} MB")
print(f"  Frame data   : {total_raw/1024/1024:.1f} MB raw → "
      f"{total_compressed/1024/1024:.1f} MB compressed")
print(f"  Compression  : {total_raw/total_compressed:.1f}x")
print(f"  manifest.json: written")
