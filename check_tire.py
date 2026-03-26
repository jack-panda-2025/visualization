# find_tire.py
import numpy as np
from lasso.dyna import D3plot, ArrayType

D3PLOT_PATH = "data/d3plot"

d3 = D3plot(D3PLOT_PATH)


def get(key):
    attr = getattr(ArrayType, key, None)
    return None if attr is None else d3.arrays.get(attr)


coords = get("node_coordinates")
part_ids = get("part_ids")
shell_nodes = get("element_shell_node_indexes")
shell_parts = get("element_shell_part_indexes")

n_nodes = coords.shape[0]

# 构建 node → part 映射
node_part = np.full(n_nodes, -1, dtype=np.int32)
for part_idx in range(len(part_ids)):
    mask = shell_parts == part_idx
    if not mask.any():
        continue
    nids = shell_nodes[mask].flatten()
    nids = nids[(nids >= 0) & (nids < n_nodes)]
    node_part[nids] = int(part_ids[part_idx])

print("分析各 part 的几何形状...\n")
print(
    f"  {'Part ID':<12} {'节点数':>6}  {'X范围':>16}  {'Y范围':>16}  {'Z范围':>16}  {'最像轮胎'}"
)
print(f"  {'-'*80}")

results = []
for pid in sorted(part_ids):
    pid = int(pid)
    mask = node_part == pid
    cnt = mask.sum()
    if cnt < 50:
        continue

    pts = coords[mask]
    xmin, xmax = pts[:, 0].min(), pts[:, 0].max()
    ymin, ymax = pts[:, 1].min(), pts[:, 1].max()
    zmin, zmax = pts[:, 2].min(), pts[:, 2].max()

    xr = xmax - xmin
    yr = ymax - ymin
    zr = zmax - zmin

    # 轮胎特征：两个方向范围相近（圆形），第三方向较窄（宽度）
    dims = sorted([xr, yr, zr])
    narrow = dims[0]  # 最窄方向（轮胎宽度）
    wide1 = dims[1]
    wide2 = dims[2]

    # 圆形度：两个大尺寸应该接近（都是直径）
    circularity = 1 - abs(wide1 - wide2) / max(wide1 + wide2, 1)
    # 宽径比：宽度/直径，轮胎这个值在 0.1~0.5 之间
    ratio = narrow / max(wide1, 1)

    is_tire = circularity > 0.7 and 0.05 < ratio < 0.6 and wide1 > 100

    results.append(
        (
            pid,
            cnt,
            xr,
            yr,
            zr,
            circularity,
            ratio,
            is_tire,
            pts[:, 0].mean(),
            pts[:, 1].mean(),
            pts[:, 2].mean(),
        )
    )

# 先打印疑似轮胎的
print("\n【疑似轮胎 part（圆形度>0.7，宽径比0.05~0.6，直径>100）】\n")
print(
    f"  {'Part ID':<12} {'节点数':>6}  {'圆形度':>8}  {'宽径比':>8}  {'直径估算':>10}  {'中心坐标'}"
)
print(f"  {'-'*75}")
for r in sorted(results, key=lambda x: -x[5]):
    pid, cnt, xr, yr, zr, circ, ratio, is_tire, cx, cy, cz = r
    if not is_tire:
        continue
    dims = sorted([xr, yr, zr])
    diameter = (dims[1] + dims[2]) / 2
    print(
        f"  {pid:<12} {cnt:>6,}  {circ:>8.3f}  {ratio:>8.3f}  {diameter:>10.1f}  ({cx:.0f}, {cy:.0f}, {cz:.0f})"
    )

print("\n结果已输出，把疑似轮胎的 part ID 和中心坐标发给我。")
