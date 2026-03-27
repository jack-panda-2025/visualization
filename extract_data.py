# extract_data.py
import numpy as np
import struct
import os
from lasso.dyna import D3plot, ArrayType

# ================================================================
D3PLOT_PATH = "data/d3plot"
OUTPUT_PATH = "collision_light.bin"

MEGA_PART_IDS = [
    10000001,
    10000007,
    10000013,
    10000019,
    10000017,
    10000023,
    10000018,
    10000024,
    10000005,
    10000011,
]

TIRE_PART_IDS = [
    2000441,
    2000444,
    2000440,
    2000445,
    2000443,
    2000442,
    2000446,
    2000439,
    2000177,
    2000178,
    2000407,
    2000408,
    2000449,
    2000452,
    2000448,
    2000450,
    2000451,
    2000453,
    2000447,
    2000454,
    2000678,
    2000679,
    2000822,
    2000821,
    2000824,
    2000823,
]

MEGA_STRIDE = 12
MID_STRIDE = 5
SMALL_STRIDE = 15
TINY_THRESHOLD = 200
FRAME_STEP = 1
# ================================================================

print("读取 d3plot ...")
d3 = D3plot(D3PLOT_PATH)


def get(key):
    attr = getattr(ArrayType, key, None)
    return None if attr is None else d3.arrays.get(attr)


timesteps = get("global_timesteps")
coords = get("node_coordinates")
disp = get("node_displacement")
part_ids = get("part_ids")
shell_nodes = get("element_shell_node_indexes")  # (768288, 4)
shell_parts = get("element_shell_part_indexes")  # (768288,)
solid_nodes = get("element_solid_node_indexes")  # (825280, 8)
solid_parts = get("element_solid_part_indexes")  # (825280,)
shell_eps = get("element_shell_effective_plastic_strain")  # (55, 768288, 3)
solid_stress = get("element_solid_stress")  # (55, 825280, 1, 6)

n_nodes = coords.shape[0]
n_states = len(timesteps)
print(f"节点数: {n_nodes:,}  时间步: {n_states}")

# ---- 构建 node → part_id 映射 ----
print("构建节点-part 映射 ...")
node_part = np.full(n_nodes, -1, dtype=np.int32)
for enodes, eparts in [(shell_nodes, shell_parts), (solid_nodes, solid_parts)]:
    if enodes is None or eparts is None:
        continue
    for part_idx in range(len(part_ids)):
        mask = eparts == part_idx
        if not mask.any():
            continue
        nids = enodes[mask].flatten()
        nids = nids[(nids >= 0) & (nids < n_nodes)]
        node_part[nids] = int(part_ids[part_idx])

# ---- 统计各 part 节点数 ----
part_node_counts = {}
for pid in part_ids:
    pid = int(pid)
    cnt = int((node_part == pid).sum())
    if cnt > 0:
        part_node_counts[pid] = cnt

EXCLUDE = set(MEGA_PART_IDS) | set(TIRE_PART_IDS)

tiny_part_ids = [
    p for p, c in part_node_counts.items() if c < TINY_THRESHOLD and p not in EXCLUDE
]
small_part_ids = [
    p
    for p, c in part_node_counts.items()
    if TINY_THRESHOLD <= c < 1000 and p not in EXCLUDE
]
mid_part_ids = [
    p for p, c in part_node_counts.items() if 1000 <= c < 10000 and p not in EXCLUDE
]


def sample_nodes(part_list, stride):
    idx = np.where(np.isin(node_part, part_list))[0]
    return idx[::stride]


def sample_nodes_full(part_list):
    return np.where(np.isin(node_part, part_list))[0]


mega_sampled = sample_nodes(MEGA_PART_IDS, MEGA_STRIDE)
mid_sampled = sample_nodes(mid_part_ids, MID_STRIDE)
small_sampled = sample_nodes(small_part_ids, SMALL_STRIDE)
tiny_sampled = sample_nodes_full(tiny_part_ids)
all_nodes = np.unique(
    np.concatenate([mega_sampled, mid_sampled, small_sampled, tiny_sampled])
)

N = len(all_nodes)
print(f"\n节点采样结果：")
print(f"  超大 part  : {len(mega_sampled):>8,}")
print(f"  中等 part  : {len(mid_sampled):>8,}")
print(f"  小 part    : {len(small_sampled):>8,}")
print(f"  微小 part  : {len(tiny_sampled):>8,}")
print(f"  车身合计   : {N:>8,}")

# ---- 提取车身位置 ----
print("\n提取车身位置 ...")
frame_idx = list(range(0, n_states, FRAME_STEP))
n_frames = len(frame_idx)
base_coords = coords[all_nodes].astype(np.float32)
disp_sub = disp[np.ix_(frame_idx, all_nodes)].astype(np.float32)
pos_frames = base_coords[None] + disp_sub  # (F, N, 3)

# ---- 节点 → shell 单元映射 ----
print("建立 shell 节点-单元映射 ...")
node_to_shell = np.full(n_nodes, -1, dtype=np.int32)
for col in range(shell_nodes.shape[1]):
    nids = shell_nodes[:, col]
    valid = (nids >= 0) & (nids < n_nodes)
    node_to_shell[nids[valid]] = np.where(valid)[0]

sampled_shell_elem = node_to_shell[all_nodes]
shell_valid = sampled_shell_elem >= 0
print(f"  有效 shell 节点: {shell_valid.sum():,} / {N:,}")

# ---- 节点 → solid 单元映射 ----
print("建立 solid 节点-单元映射 ...")
node_to_solid = np.full(n_nodes, -1, dtype=np.int32)
for col in range(solid_nodes.shape[1]):
    nids = solid_nodes[:, col]
    valid = (nids >= 0) & (nids < n_nodes)
    node_to_solid[nids[valid]] = np.where(valid)[0]

sampled_solid_elem = node_to_solid[all_nodes]
solid_valid = sampled_solid_elem >= 0
print(f"  有效 solid 节点: {solid_valid.sum():,} / {N:,}")

# ---- 提取各帧物理量，合并为统一着色值 ----
print("\n提取各帧应变/应力 ...")

# 先算最后一帧的 solid Von Mises 最大值，用于量纲统一
sv_last = solid_stress[-1, :, 0, :]  # (825280, 6)
s11, s22, s33 = sv_last[:, 0], sv_last[:, 1], sv_last[:, 2]
s12, s23, s13 = sv_last[:, 3], sv_last[:, 4], sv_last[:, 5]
vm_last = np.sqrt(
    0.5
    * (
        (s11 - s22) ** 2
        + (s22 - s33) ** 2
        + (s33 - s11) ** 2
        + 6 * (s12**2 + s23**2 + s13**2)
    )
)
vm_max = float(vm_last.max())
print(f"  Solid Von Mises 最大值（最后帧）: {vm_max:.2f} MPa")

# shell 塑性应变 P95（非零部分）
eps_last = shell_eps[-1, :, 0]
nonzero_eps = eps_last[eps_last > 0]
eps_p95 = float(np.percentile(nonzero_eps, 95)) if len(nonzero_eps) > 0 else 1.0
print(f"  Shell 塑性应变 P95: {eps_p95:.6f}")

# solid Von Mises P95
nonzero_vm = vm_last[vm_last > 0]
vm_p95 = float(np.percentile(nonzero_vm, 95)) if len(nonzero_vm) > 0 else vm_max
print(f"  Solid Von Mises P95: {vm_p95:.2f} MPa")

# 统一到 [0,1]：shell 用 eps/eps_p95，solid 用 vm/vm_p95
# 两者都归一化到同一色谱，0=无变形，1=高应变/高应力
node_val = np.zeros((n_frames, N), dtype=np.float32)

for fi, si in enumerate(frame_idx):
    # shell 塑性应变
    if shell_eps is not None:
        eps_frame = shell_eps[si, :, 0]
        node_val[fi, shell_valid] = eps_frame[sampled_shell_elem[shell_valid]] / eps_p95

    # solid Von Mises（只覆盖 solid 节点，不覆盖已有 shell 值）
    if solid_stress is not None:
        sv = solid_stress[si, :, 0, :]
        s11, s22, s33 = sv[:, 0], sv[:, 1], sv[:, 2]
        s12, s23, s13 = sv[:, 3], sv[:, 4], sv[:, 5]
        vm = np.sqrt(
            0.5
            * (
                (s11 - s22) ** 2
                + (s22 - s33) ** 2
                + (s33 - s11) ** 2
                + 6 * (s12**2 + s23**2 + s13**2)
            )
        )
        # 只写入没有 shell 数据的 solid 节点
        solid_only = solid_valid & ~shell_valid
        node_val[fi, solid_only] = vm[sampled_solid_elem[solid_only]] / vm_p95

# 裁剪到 [0,1]
node_val = np.clip(node_val, 0, 1)

# 量化：0=无变形（保留为0），非零映射到 2-255
val_q = np.zeros((n_frames, N), dtype=np.uint8)
nonzero_mask = node_val > 0.001  # 阈值过滤极小值
val_q[nonzero_mask] = np.clip(2 + (node_val[nonzero_mask] * 253), 2, 255).astype(
    np.uint8
)

print(f"  有颜色节点比例（最后帧）: {(val_q[-1] >= 2).mean()*100:.1f}%")

# ---- 提取轮胎几何 ----
print("\n提取轮胎几何信息 ...")
valid_tire_parts = [p for p in TIRE_PART_IDS if p in part_node_counts]
n_tires = len(valid_tire_parts)
print(f"  有效轮胎 part 数: {n_tires}")

tire_data = np.zeros((n_frames, n_tires, 8), dtype=np.float32)

for ti, pid in enumerate(valid_tire_parts):
    idx = np.where(node_part == pid)[0]
    base = coords[idx].astype(np.float32)
    c0 = base.mean(axis=0)
    pts = base - c0
    cov = np.cov(pts.T)
    eigvals, eigvecs = np.linalg.eigh(cov)
    axis = eigvecs[:, 0].astype(np.float32)
    axis = axis / (np.linalg.norm(axis) + 1e-8)
    proj_axis = pts @ axis
    width_init = float(proj_axis.max() - proj_axis.min())

    for fi, si in enumerate(frame_idx):
        cur = base + disp[si][idx].astype(np.float32)
        center = cur.mean(axis=0)
        pts_f = cur - center
        proj_f = pts_f - np.outer(pts_f @ axis, axis)
        radius = float(np.linalg.norm(proj_f, axis=1).mean())
        tire_data[fi, ti, 0:3] = center
        tire_data[fi, ti, 3:6] = axis
        tire_data[fi, ti, 6] = radius
        tire_data[fi, ti, 7] = width_init

layer = np.full(N, 2, dtype=np.uint8)
layer[np.isin(all_nodes, mega_sampled)] = 0
layer[np.isin(all_nodes, mid_sampled)] = 1

# ---- 写 COL2 二进制 ----
print("\n序列化写入 ...")

with open(OUTPUT_PATH, "wb") as f:
    # header: magic(4) + n_frames(i) + n_nodes(i) + n_tires(i) + eps_p95(f) + vm_p95(f)
    f.write(
        struct.pack(
            "<4siiiff",
            b"COL2",
            n_frames,
            N,
            int(n_tires),
            float(eps_p95),
            float(vm_p95),
        )
    )

    # 时间戳
    times = np.array([timesteps[i] for i in frame_idx], dtype=np.float32)
    f.write(times.tobytes())

    # 车身每帧：pos float32 (N×3) + val uint8 (N)
    for fi in range(n_frames):
        f.write(pos_frames[fi].astype(np.float32).tobytes())
        f.write(val_q[fi].tobytes())

    # 轮胎几何每帧
    for fi in range(n_frames):
        f.write(tire_data[fi].tobytes())

    # layer
    f.write(layer.tobytes())

    # part_label: int32 × N，每个节点对应的 part ID
    part_label = node_part[all_nodes].astype(np.int32)
    f.write(part_label.tobytes())
    print(f"  写入 part_label: {len(part_label):,} 个节点")

size_mb = os.path.getsize(OUTPUT_PATH) / 1024 / 1024
print(f"\n完成！")
print(f"  输出文件     : {OUTPUT_PATH}")
print(f"  文件大小     : {size_mb:.1f} MB")
print(f"  Shell P95   : {eps_p95:.6f}")
print(f"  Solid P95   : {vm_p95:.2f} MPa")
print(f"  节点压缩比   : {n_nodes / N:.1f}x")
