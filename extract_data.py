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
shell_nodes = get("element_shell_node_indexes")
shell_parts = get("element_shell_part_indexes")
solid_nodes = get("element_solid_node_indexes")
solid_parts = get("element_solid_part_indexes")
shell_eps = get("element_shell_effective_plastic_strain")  # (55, 768288, 3)

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

# ---- 节点 → shell 单元映射（向量化）----
print("建立节点-单元映射 ...")
node_to_shell = np.full(n_nodes, -1, dtype=np.int32)
for col in range(shell_nodes.shape[1]):
    nids = shell_nodes[:, col]
    valid = (nids >= 0) & (nids < n_nodes)
    node_to_shell[nids[valid]] = np.where(valid)[0]

sampled_shell_elem = node_to_shell[all_nodes]  # (N,)
valid_mask = sampled_shell_elem >= 0
print(f"  有效 shell 节点: {valid_mask.sum():,} / {N:,}")

# ---- 提取各帧塑性应变（全向量化）----
print("提取各帧等效塑性应变 ...")
node_eps = np.zeros((n_frames, N), dtype=np.float32)

for fi, si in enumerate(frame_idx):
    eps_frame = shell_eps[si, :, 0]  # (768288,) 取外层
    node_eps[fi, valid_mask] = eps_frame[sampled_shell_elem[valid_mask]]

eps_max = float(node_eps.max())
print(f"  最大等效塑性应变: {eps_max:.6f}")

# ---- 归一化策略：0单独保留，非零部分用P95做上限 ----
nonzero_vals = node_eps[node_eps > 0]
if len(nonzero_vals) > 0:
    eps_p95 = float(np.percentile(nonzero_vals, 95))
else:
    eps_p95 = max(eps_max, 1e-8)

print(f"  非零P95上限     : {eps_p95:.6f}  (颜色归一化上限)")
print(f"  非零节点比例    : {len(nonzero_vals) / (n_frames * N) * 100:.1f}%")

# 0 → 保持0（HTML端检测到0显示暗色）
# 非零 → 映射到 2-255
eps_q = np.zeros((n_frames, N), dtype=np.uint8)
nonzero_mask = node_eps > 0
eps_q[nonzero_mask] = np.clip(
    2 + (node_eps[nonzero_mask] / eps_p95 * 253), 2, 255
).astype(np.uint8)

# ---- 提取 Von Mises 应力 ----
print("\n提取 Von Mises 应力 ...")
node_vm = np.zeros((n_frames, N), dtype=np.float32)
has_vm = False

shell_stress = get("element_shell_stress")
if shell_stress is not None:
    print(f"  element_shell_stress shape: {shell_stress.shape}")
    # Shape can be (F, E, 6) or (F, E, n_ip, 6)
    if shell_stress.ndim == 4:
        s = shell_stress[np.ix_(frame_idx, np.arange(shell_stress.shape[1]))].mean(axis=2)
    elif shell_stress.ndim == 3:
        s = shell_stress[frame_idx]
    else:
        s = None

    if s is not None and s.shape[-1] >= 4:
        s = s.astype(np.float32)
        sxx, syy = s[..., 0], s[..., 1]
        szz = s[..., 2] if s.shape[-1] > 2 else np.zeros_like(sxx)
        sxy = s[..., 3] if s.shape[-1] > 3 else np.zeros_like(sxx)
        syz = s[..., 4] if s.shape[-1] > 4 else np.zeros_like(sxx)
        sxz = s[..., 5] if s.shape[-1] > 5 else np.zeros_like(sxx)
        vm_elem = np.sqrt(
            0.5 * ((sxx - syy) ** 2 + (syy - szz) ** 2 + (szz - sxx) ** 2
                   + 6 * (sxy ** 2 + syz ** 2 + sxz ** 2))
        )  # (F, E)
        for fi in range(n_frames):
            node_vm[fi, valid_mask] = vm_elem[fi][sampled_shell_elem[valid_mask]]
        has_vm = True
        print(f"  最大 Von Mises 应力: {node_vm.max():.2f}")
    else:
        print("  stress 字段维度不符合预期，跳过")
else:
    print("  未找到 element_shell_stress，尝试节点速度派生...")
    node_vel = get("node_velocity")
    if node_vel is not None:
        print(f"  node_velocity shape: {node_vel.shape}")
        vel_sub = node_vel[np.ix_(frame_idx, all_nodes)].astype(np.float32)
        speed = np.linalg.norm(vel_sub, axis=2)  # (F, N)
        node_vm = speed
        has_vm = True
        print(f"  最大速度: {node_vm.max():.2f} mm/s")
    else:
        print("  无可用应力/速度数据，vm 通道将置零")

vm_max_val = float(node_vm.max())
nonzero_vm = node_vm[node_vm > 0]
vm_p95 = float(np.percentile(nonzero_vm, 95)) if len(nonzero_vm) > 0 else max(vm_max_val, 1e-8)
print(f"  vm P95: {vm_p95:.4f}  max: {vm_max_val:.4f}")

vm_q = np.zeros((n_frames, N), dtype=np.uint8)
vm_nonzero = node_vm > 0
vm_q[vm_nonzero] = np.clip(
    2 + (node_vm[vm_nonzero] / vm_p95 * 253), 2, 255
).astype(np.uint8)

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
    # header: magic(4) + n_frames(i) + n_nodes(i) + n_tires(i) + eps_p95(f) + eps_max(f) + vm_p95(f) + vm_max(f)
    f.write(
        struct.pack("<4siiiffff", b"COL3", n_frames, N, int(n_tires),
                   eps_p95, eps_max, vm_p95, vm_max_val)
    )

    # 时间戳
    times = np.array([timesteps[i] for i in frame_idx], dtype=np.float32)
    f.write(times.tobytes())

    # 车身每帧：pos float32 (N×3) + eps uint8 (N) + vm uint8 (N)
    for fi in range(n_frames):
        f.write(pos_frames[fi].astype(np.float32).tobytes())
        f.write(eps_q[fi].tobytes())
        f.write(vm_q[fi].tobytes())

    # 轮胎几何每帧
    for fi in range(n_frames):
        f.write(tire_data[fi].tobytes())

    # layer
    f.write(layer.tobytes())

size_mb = os.path.getsize(OUTPUT_PATH) / 1024 / 1024
print(f"\n完成！")
print(f"  输出文件     : {OUTPUT_PATH}")
print(f"  文件大小     : {size_mb:.1f} MB")
print(f"  最大塑性应变 : {eps_max:.6f}")
print(f"  PEEQ P95上限 : {eps_p95:.6f}")
print(f"  最大VM应力   : {vm_max_val:.4f}")
print(f"  VM P95上限   : {vm_p95:.4f}")
print(f"  节点压缩比   : {n_nodes / N:.1f}x")
