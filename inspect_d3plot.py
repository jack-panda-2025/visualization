# inspect_d3plot.py
import numpy as np
from lasso.dyna import D3plot, ArrayType
import sys

D3PLOT_PATH = "data/d3plot"

print("读取 d3plot ...")
d3 = D3plot(D3PLOT_PATH)
print("读取完成")


def get(key):
    attr = getattr(ArrayType, key, None)
    return None if attr is None else d3.arrays.get(attr)


timesteps = get("global_timesteps")
coords = get("node_coordinates")
part_ids = get("part_ids")
shell_nodes = get("element_shell_node_indexes")
shell_parts = get("element_shell_part_indexes")
solid_nodes = get("element_solid_node_indexes")
solid_parts = get("element_solid_part_indexes")

# 构建 node → part 映射
n_nodes = coords.shape[0]
node_part = np.full(n_nodes, -1, dtype=np.int32)
for enodes, eparts in [(shell_nodes, shell_parts), (solid_nodes, solid_parts)]:
    if enodes is None or eparts is None:
        continue
    for part_idx in range(len(part_ids)):
        mask = eparts == part_idx
        if not mask.any():
            continue
        nids = enodes[mask].flatten()
        nids = nids[nids >= 0]
        node_part[nids] = int(part_ids[part_idx])

# # 统计每个 part 节点数，写入文件
# with open("part_summary.txt", "w") as f:
#     f.write(f"节点总数: {n_nodes:,}\n")
#     f.write(f"时间步数: {len(timesteps)}\n")
#     f.write(f"时间范围: {timesteps[0]:.4f} → {timesteps[-1]:.4f} s\n\n")
#     f.write(f"{'Part ID':<14} {'节点数':>10}\n")
#     f.write("-" * 26 + "\n")

#     rows = []
#     for pid in part_ids:
#         pid = int(pid)
#         cnt = int((node_part == pid).sum())
#         rows.append((pid, cnt))

#     # 按节点数降序
#     rows.sort(key=lambda x: x[1], reverse=True)
#     for pid, cnt in rows:
#         if cnt > 0:
#             f.write(f"{pid:<14} {cnt:>10,}\n")

#     f.write("\n--- 节点数为 0 的 part 已省略 ---\n")


print("完成！结果已写入 part_summary.txt")
print("请把 part_summary.txt 的内容粘贴给我")

# 在文件末尾加上这段
print("\n" + "=" * 60)
print("【应力/应变相关字段】\n")

for key in dir(ArrayType):
    if any(
        kw in key.lower() for kw in ["stress", "strain", "force", "plastic", "energy"]
    ):
        attr = getattr(ArrayType, key, None)
        if attr is None:
            continue
        arr = d3.arrays.get(attr)
        if arr is not None and hasattr(arr, "shape"):
            print(f"  {key:<55} shape={arr.shape}  dtype={arr.dtype}")

print("\n" + "=" * 60)
print("【所有单元结果字段（element开头）】\n")

for key in dir(ArrayType):
    if key.startswith("element"):
        attr = getattr(ArrayType, key, None)
        if attr is None:
            continue
        arr = d3.arrays.get(attr)
        if arr is not None and hasattr(arr, "shape"):
            print(f"  {key:<55} shape={arr.shape}  dtype={arr.dtype}")
