# check_barrier.py
import numpy as np
from lasso.dyna import D3plot, ArrayType

D3PLOT_PATH = "data/d3plot"
d3 = D3plot(D3PLOT_PATH)


def get(key):
    attr = getattr(ArrayType, key, None)
    return None if attr is None else d3.arrays.get(attr)


part_ids = get("part_ids")
shell_parts = get("element_shell_part_indexes")
solid_parts = get("element_solid_part_indexes")

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

print(f"{'Part ID':<12} {'Shell单元数':>12} {'Solid单元数':>12}")
print("-" * 38)

for pi, pid in enumerate(part_ids):
    pid = int(pid)
    if pid not in MEGA_PART_IDS:
        continue
    n_shell = int((shell_parts == pi).sum()) if shell_parts is not None else 0
    n_solid = int((solid_parts == pi).sum()) if solid_parts is not None else 0
    print(f"{pid:<12} {n_shell:>12,} {n_solid:>12,}")
