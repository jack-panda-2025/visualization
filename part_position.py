# part_positions.py
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
solid_nodes = get("element_solid_node_indexes")
solid_parts = get("element_solid_part_indexes")

n_nodes = coords.shape[0]
node_part = np.full(n_nodes, -1, dtype=np.int32)
for enodes, eparts in [(shell_nodes, shell_parts), (solid_nodes, solid_parts)]:
    if enodes is None or eparts is None:
        continue
    for pi in range(len(part_ids)):
        mask = eparts == pi
        if not mask.any():
            continue
        nids = enodes[mask].flatten()
        nids = nids[(nids >= 0) & (nids < n_nodes)]
        node_part[nids] = int(part_ids[pi])

# 每个 part 的中心坐标和节点数
import json

parts_info = []
for pid in part_ids:
    pid = int(pid)
    mask = node_part == pid
    cnt = int(mask.sum())
    if cnt == 0:
        continue
    pts = coords[mask]
    cx, cy, cz = pts[:, 0].mean(), pts[:, 1].mean(), pts[:, 2].mean()
    parts_info.append(
        {
            "id": pid,
            "count": cnt,
            "cx": round(float(cx), 1),
            "cy": round(float(cy), 1),
            "cz": round(float(cz), 1),
        }
    )

parts_info.sort(key=lambda x: x["count"], reverse=True)

with open("parts_info.json", "w") as f:
    json.dump(parts_info, f, separators=(",", ":"))

print(f"完成，共 {len(parts_info)} 个有效 part，已写入 parts_info.json")
print(f"\n节点数最多的前20个 part：")
print(f"  {'Part ID':<12} {'节点数':>8}  {'中心坐标 (x, y, z)'}")
print(f"  {'-'*50}")
for p in parts_info[:20]:
    print(
        f"  {p['id']:<12} {p['count']:>8,}  ({p['cx']:.0f}, {p['cy']:.0f}, {p['cz']:.0f})"
    )
