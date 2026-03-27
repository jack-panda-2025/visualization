# diagnose_strain.py
import numpy as np
from lasso.dyna import D3plot, ArrayType

D3PLOT_PATH = "data/d3plot"
d3 = D3plot(D3PLOT_PATH)


def get(key):
    attr = getattr(ArrayType, key, None)
    return None if attr is None else d3.arrays.get(attr)


shell_eps = get("element_shell_effective_plastic_strain")  # (55, 768288, 3)
timesteps = get("global_timesteps")

print(f"shell_eps shape: {shell_eps.shape}")
print(f"时间步数: {len(timesteps)}")

# 看最后一帧（变形最大）
last = shell_eps[-1, :, 0]  # 外层

print(f"\n【最后一帧应变分布】")
print(f"  最大值    : {last.max():.6f}")
print(f"  均值      : {last.mean():.6f}")
print(f"  非零比例  : {(last > 0).mean()*100:.1f}%")
print(f"  > 0.001  : {(last > 0.001).sum():,} 个单元")
print(f"  > 0.01   : {(last > 0.01).sum():,} 个单元")
print(f"  > 0.05   : {(last > 0.05).sum():,} 个单元")
print(f"  > 0.1    : {(last > 0.1).sum():,} 个单元")

# 百分位分布
print(f"\n【百分位数】")
for p in [50, 80, 90, 95, 99, 99.9]:
    # 只看非零的
    nz = last[last > 0]
    if len(nz) > 0:
        print(f"  非零部分 P{p:<5}: {np.percentile(nz, p):.6f}")

# 看哪些 part 的应变最大
shell_parts = get("element_shell_part_indexes")
part_ids = get("part_ids")

print(f"\n【应变最大的 part（最后一帧）】")
print(f"  {'Part ID':<12} {'最大应变':>12}  {'均值':>12}  {'非零单元数':>12}")
print(f"  {'-'*52}")

part_stats = []
for pi, pid in enumerate(part_ids):
    mask = shell_parts == pi
    if not mask.any():
        continue
    eps_part = last[mask]
    if eps_part.max() < 0.001:
        continue
    part_stats.append(
        (
            int(pid),
            float(eps_part.max()),
            float(eps_part.mean()),
            int((eps_part > 0).sum()),
        )
    )

part_stats.sort(key=lambda x: -x[1])
for pid, mx, mn, cnt in part_stats[:20]:
    print(f"  {pid:<12} {mx:>12.4f}  {mn:>12.4f}  {cnt:>12,}")
