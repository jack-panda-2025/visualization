"""
export_simple.py — 简化导出，优先跑通流程
- 前 10 帧
- float32 直出（不做 uint16 量化）
- zlib level-1 轻压缩
- 绝对坐标（不做位移分离）
"""
import json, numpy as np
from pathlib import Path
from lasso.dyna import D3plot, ArrayType

ROOT       = Path(__file__).resolve().parent.parent
OUT        = ROOT / "output_simple"
OUT.mkdir(exist_ok=True)

N_FRAMES   = 10   # 只导出前 N 帧

print("Loading d3plot ...")
d   = D3plot(str(ROOT / "d3plot"))
arr = d.arrays

t          = arr[ArrayType.global_timesteps]            # (55,)
coords     = arr[ArrayType.node_coordinates]            # (N_nodes, 3)  初始坐标
node_disp  = arr[ArrayType.node_displacement]           # (55, N_nodes, 3)
shell_conn = arr[ArrayType.element_shell_node_indexes]  # (N_shell, 4)
shell_peeq = arr[ArrayType.element_shell_effective_plastic_strain]  # (55, N_shell, 3)
shell_alive= arr[ArrayType.element_shell_is_alive]      # (55, N_shell)

n_nodes  = coords.shape[0]
n_shell  = shell_conn.shape[0]
frames   = list(range(min(N_FRAMES, len(t))))

print(f"  Nodes: {n_nodes:,}  Shell: {n_shell:,}  Exporting {len(frames)} frames")

# ── 验证 node_displacement 是绝对坐标还是相对位移 ──────────────────────────────
disp0 = node_disp[0]          # 第 0 帧
print(f"\n  coords[0] sample  : {coords[0]}")
print(f"  disp[0][0] sample : {disp0[0]}")
# 如果两者接近，说明 node_displacement 存的是绝对坐标
is_absolute = np.allclose(coords[0], disp0[0], atol=1.0)
print(f"  node_displacement is {'ABSOLUTE position' if is_absolute else 'RELATIVE displacement'}")

# ── 逐帧导出 ──────────────────────────────────────────────────────────────────
frame_info = []
for out_idx, fi in enumerate(frames):
    # 当前帧节点绝对坐标
    if is_absolute:
        positions = node_disp[fi].astype(np.float32)          # 直接用
    else:
        positions = (coords + node_disp[fi]).astype(np.float32)

    peeq  = shell_peeq[fi, :, 0].astype(np.float32)           # 外表面 PEEQ
    alive = shell_alive[fi].astype(np.float32)

    raw = positions.tobytes() + peeq.tobytes() + alive.tobytes()

    out_path = OUT / f"frame_{out_idx:02d}.bin"
    out_path.write_bytes(raw)

    print(f"  frame_{out_idx:02d}.bin  t={t[fi]:.4f}s  "
          f"pos[{positions.min():.0f}~{positions.max():.0f}]  "
          f"peeq_max={peeq.max():.4f}  "
          f"{len(raw)//1024}KB")

    frame_info.append({"index": out_idx, "time": float(t[fi]), "file": f"frame_{out_idx:02d}.bin"})

# ── manifest ──────────────────────────────────────────────────────────────────
# 计算坐标范围（用于客户端相机初始化）
all_pos = node_disp[0] if is_absolute else coords
bounds = {
    "xmin": float(all_pos[:,0].min()), "xmax": float(all_pos[:,0].max()),
    "ymin": float(all_pos[:,1].min()), "ymax": float(all_pos[:,1].max()),
    "zmin": float(all_pos[:,2].min()), "zmax": float(all_pos[:,2].max()),
}

peeq_max_global = float(shell_peeq[frames, :, 0].max())

manifest = {
    "n_frames":  len(frames),
    "n_nodes":   int(n_nodes),
    "n_shell":   int(n_shell),
    "peeq_max":  peeq_max_global,
    "bounds":    bounds,
    "encoding": {
        "positions": {"dtype": "float32", "shape": [-1, 3], "unit": "mm"},
        "peeq":      {"dtype": "float32", "shape": [-1]},
        "alive":     {"dtype": "float32", "shape": [-1]},
    },
    "frames": frame_info,
}

# 加入全局能量（用于图表）
try:
    ke = arr[ArrayType.global_kinetic_energy].tolist()
    ie = arr[ArrayType.global_internal_energy].tolist()
    manifest["energy"] = {"times": t.tolist(), "kinetic": ke, "internal": ie}
except Exception:
    pass

(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2))

# ── 保存 shell 连接关系（单独的静态文件）─────────────────────────────────────
# 格式: int32 flat array，每 4 个值是一个 quad 的节点索引
conn_bytes = shell_conn.astype(np.int32).tobytes()
(OUT / "connectivity.bin").write_bytes(conn_bytes)

print(f"\n=== Done ===")
print(f"  Output : {OUT}")
print(f"  peeq global max : {peeq_max_global:.4f}")
print(f"  bounds : X[{bounds['xmin']:.0f} ~ {bounds['xmax']:.0f}]  "
      f"Y[{bounds['ymin']:.0f} ~ {bounds['ymax']:.0f}]  "
      f"Z[{bounds['zmin']:.0f} ~ {bounds['zmax']:.0f}]")
