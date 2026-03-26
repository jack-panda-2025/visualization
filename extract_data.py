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
    # 前轴 (X≈-1028)
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
    # 后轴 (X≈-4589)
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
    # 第三轴 (X≈-5206)
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
velocity = get("node_velocity")
part_ids = get("part_ids")
shell_nodes = get("element_shell_node_indexes")
shell_parts = get("element_shell_part_indexes")
solid_nodes = get("element_solid_node_indexes")
solid_parts = get("element_solid_part_indexes")

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

print(f"\n节点采样结果：")
print(f"  超大 part  : {len(mega_sampled):>8,}")
print(f"  中等 part  : {len(mid_sampled):>8,}")
print(f"  小 part    : {len(small_sampled):>8,}")
print(f"  微小 part  : {len(tiny_sampled):>8,}")
print(f"  车身合计   : {len(all_nodes):>8,}")

# ---- 提取车身物理量 ----
print("\n提取车身物理量 ...")
frame_idx = list(range(0, n_states, FRAME_STEP))
n_frames = len(frame_idx)
base_coords = coords[all_nodes].astype(np.float32)
disp_sub = disp[np.ix_(frame_idx, all_nodes)].astype(np.float32)
vel_sub = velocity[np.ix_(frame_idx, all_nodes)].astype(np.float32)

pos_frames = base_coords[None] + disp_sub
speed = np.linalg.norm(vel_sub, axis=-1)
spd_max = float(speed.max())
spd_q = (speed / spd_max * 255).astype(np.uint8)

layer = np.full(len(all_nodes), 2, dtype=np.uint8)
layer[np.isin(all_nodes, mega_sampled)] = 0
layer[np.isin(all_nodes, mid_sampled)] = 1

# ---- 提取轮胎几何信息 ----
print("提取轮胎几何信息 ...")
valid_tire_parts = [p for p in TIRE_PART_IDS if p in part_node_counts]
n_tires = len(valid_tire_parts)
print(f"  有效轮胎 part 数: {n_tires}")

# 每帧每个轮胎存 8 个 float：[cx, cy, cz, ax, ay, az, radius, width]
tire_data = np.zeros((n_frames, n_tires, 8), dtype=np.float32)

for ti, pid in enumerate(valid_tire_parts):
    idx = np.where(node_part == pid)[0]
    base = coords[idx].astype(np.float32)  # (N, 3)

    # PCA 确定轴向（最小惯性轴 = 旋转轴）
    c0 = base.mean(axis=0)
    pts = base - c0
    cov = np.cov(pts.T)
    eigvals, eigvecs = np.linalg.eigh(cov)
    axis = eigvecs[:, 0].astype(np.float32)
    axis = axis / (np.linalg.norm(axis) + 1e-8)

    # 初始帧宽度（沿轴方向范围，不随旋转变化）
    proj_axis = pts @ axis
    width_init = float(proj_axis.max() - proj_axis.min())

    for fi, si in enumerate(frame_idx):
        cur = base + disp[si][idx].astype(np.float32)
        center = cur.mean(axis=0)
        pts_f = cur - center

        # 半径：投影到轴垂直平面后取平均距离
        proj_f = pts_f - np.outer(pts_f @ axis, axis)
        radius = float(np.linalg.norm(proj_f, axis=1).mean())

        tire_data[fi, ti, 0:3] = center
        tire_data[fi, ti, 3:6] = axis
        tire_data[fi, ti, 6] = radius
        tire_data[fi, ti, 7] = width_init

    print(
        f"  part {pid:>8}  半径={tire_data[0,ti,6]:.1f}  宽={width_init:.1f}  "
        f"轴=({axis[0]:.2f},{axis[1]:.2f},{axis[2]:.2f})"
    )

# ---- 写 COL2 二进制 ----
print("\n序列化写入 ...")
N = len(all_nodes)

with open(OUTPUT_PATH, "wb") as f:
    # header: magic(4) + n_frames(i) + n_nodes(i) + n_tires(i) + spd_max(f) + pad(f)
    f.write(struct.pack("<4siiiff", b"COL2", n_frames, N, int(n_tires), spd_max, 0.0))

    # 时间戳 float32 × n_frames
    times = np.array([timesteps[i] for i in frame_idx], dtype=np.float32)
    f.write(times.tobytes())

    # 车身每帧：pos float32 (N×3) + spd uint8 (N)
    for fi in range(n_frames):
        f.write(pos_frames[fi].astype(np.float32).tobytes())
        f.write(spd_q[fi].tobytes())

    # 轮胎几何每帧：float32 (n_tires × 8)
    for fi in range(n_frames):
        f.write(tire_data[fi].tobytes())

    # layer 标签 uint8 × N
    f.write(layer.tobytes())

size_mb = os.path.getsize(OUTPUT_PATH) / 1024 / 1024
print(f"\n完成！")
print(f"  输出文件  : {OUTPUT_PATH}")
print(f"  文件大小  : {size_mb:.1f} MB")
print(f"  轮胎 part : {n_tires} 个")
print(f"  节点压缩比: {n_nodes / N:.1f}x")
