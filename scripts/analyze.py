"""
D3plot crash simulation analysis (unit system: mm / s / ton / N / MPa)
"""

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
from matplotlib import rcParams

# Use a system font that supports CJK characters
for font in ["PingFang SC", "Heiti TC", "Arial Unicode MS", "DejaVu Sans"]:
    rcParams["font.family"] = font
    break

from pathlib import Path
from lasso.dyna import D3plot, ArrayType

ROOT = Path(__file__).resolve().parent.parent

# ─── Load ────────────────────────────────────────────────────────────────────
print("Loading d3plot ...")
d = D3plot(str(ROOT / "d3plot"))
arr = d.arrays

t      = arr[ArrayType.global_timesteps]    # (55,)  unit: s
n_step = len(t)
print(f"  Time range: {t[0]:.4f} ~ {t[-1]:.4f} s   {n_step} frames")

# ─── 1. Global Energy ────────────────────────────────────────────────────────
ke       = arr[ArrayType.global_kinetic_energy]      # (55,)  N·mm = mJ
ie       = arr[ArrayType.global_internal_energy]
te       = arr[ArrayType.global_total_energy]
part_hg  = arr[ArrayType.part_hourglass_energy]      # (55, 1672)
hg_total = part_hg.sum(axis=1)

print("\n=== Global Energy (N·mm) ===")
print(f"  Initial total energy : {te[0]:.3e}")
print(f"  Peak KE              : {ke.max():.3e}  @ t={t[ke.argmax()]:.4f} s")
print(f"  Peak IE              : {ie.max():.3e}  @ t={t[ie.argmax()]:.4f} s")
hg_ratio_max = (hg_total / (te + 1e-12)).max() * 100
print(f"  Max hourglass ratio  : {hg_ratio_max:.2f}%  (>10% is abnormal)")

# ─── 2. Rigid Wall Forces ────────────────────────────────────────────────────
rw_force = arr[ArrayType.rigid_wall_force]           # (55, 24)  N
n_walls  = rw_force.shape[1]
peak_wall_idx = rw_force.max(axis=0).argmax()
print(f"\n=== Rigid Walls ===")
print(f"  Number of walls  : {n_walls}")
print(f"  Peak force       : {rw_force.max()/1e3:.2f} kN  wall#{peak_wall_idx}"
      f"  @ t={t[rw_force[:, peak_wall_idx].argmax()]:.4f} s")

# ─── 3. Global Velocity (mm/s) ───────────────────────────────────────────────
gv     = arr[ArrayType.global_velocity]              # (55, 3)  mm/s
gv_mag = np.linalg.norm(gv, axis=1)
# Convert mm/s -> km/h: ×3.6/1000
print(f"\n=== Global Velocity ===")
print(f"  Initial : {gv_mag[0]:.0f} mm/s  = {gv_mag[0]*3.6/1e3:.2f} km/h")
print(f"  Final   : {gv_mag[-1]:.0f} mm/s  = {gv_mag[-1]*3.6/1e3:.2f} km/h")

# ─── 4. Node Displacement (mm) ───────────────────────────────────────────────
node_disp = arr[ArrayType.node_displacement]         # (55, N_nodes, 3)  mm
disp_mag  = np.linalg.norm(node_disp, axis=2)        # (55, N_nodes)
# Alive check: use shell is_alive to mask analysis
# Use percentiles to avoid outliers from eroded/exploded elements
disp_p99_step = np.percentile(disp_mag, 99, axis=1)
disp_max_step = disp_mag.max(axis=1)
print(f"\n=== Node Displacement (mm) ===")
print(f"  Final max        : {disp_max_step[-1]:.1f}")
print(f"  Final 99th pct   : {disp_p99_step[-1]:.1f}")
print(f"  Final median     : {np.median(disp_mag[-1]):.1f}")

# ─── 5. Shell Effective Plastic Strain ───────────────────────────────────────
eps_shell  = arr[ArrayType.element_shell_effective_plastic_strain]  # (55, N_shell, 3)
sh_alive   = arr[ArrayType.element_shell_is_alive][-1]              # (N_shell,)
eps_outer  = eps_shell[:, :, 0]   # outer surface
max_eps_step = eps_outer.max(axis=1)

final_eps  = eps_outer[-1]
alive_mask = sh_alive > 0.5
n_shell_alive  = alive_mask.sum()
n_yielded      = ((final_eps > 1e-4) & alive_mask).sum()
pct95_eps      = np.percentile(final_eps[alive_mask], 95) if n_shell_alive else 0

print(f"\n=== Shell Plastic Strain ===")
print(f"  Final max PEEQ   : {max_eps_step[-1]:.4f}")
print(f"  Final 95th pct   : {pct95_eps:.4f}")
print(f"  Alive elements   : {n_shell_alive}/{eps_shell.shape[1]}")
print(f"  Yielded (>0.01%) : {n_yielded}  ({n_yielded/max(n_shell_alive,1)*100:.1f}%)")

# ─── 6. Shell Thickness Reduction ────────────────────────────────────────────
thick = arr[ArrayType.element_shell_thickness]       # (55, N_shell)
t0    = thick[0].copy()
t0[t0 < 1e-6] = np.nan
thick_ratio = thick[-1] / t0
thinning    = 1 - thick_ratio
n_thin_20   = np.nansum(thinning > 0.2)
max_thin    = np.nanmax(thinning)
print(f"\n=== Shell Thickness Reduction ===")
print(f"  Elements thinned >20% : {n_thin_20}  ({n_thin_20/thick.shape[1]*100:.2f}%)")
print(f"  Max thinning          : {max_thin*100:.1f}%")

# ─── 7. Part Energy Ranking ───────────────────────────────────────────────────
part_ie  = arr[ArrayType.part_internal_energy][-1]   # (1672,)
part_ke  = arr[ArrayType.part_kinetic_energy][-1]
part_ids = arr[ArrayType.part_ids]
top10    = np.argsort(part_ie)[::-1][:10]
print("\n=== Top-10 Parts by Internal Energy (final frame) ===")
print(f"  {'Part ID':>10}  {'IE (N·mm)':>14}  {'KE (N·mm)':>14}")
for i in top10:
    print(f"  {part_ids[i]:>10}  {part_ie[i]:>14.3e}  {part_ke[i]:>14.3e}")

# ─── 8. Solid Stress ─────────────────────────────────────────────────────────
s_arr    = arr[ArrayType.element_solid_stress]        # (55, N_solid, 1, 6)
sl_alive = arr[ArrayType.element_solid_is_alive][-1]  # (N_solid,)
s        = s_arr[-1, :, 0, :]                         # (N_solid, 6)
vm = np.sqrt(0.5*((s[:,0]-s[:,1])**2 + (s[:,1]-s[:,2])**2 + (s[:,2]-s[:,0])**2)
             + 3*(s[:,3]**2 + s[:,4]**2 + s[:,5]**2))
alive_solid = sl_alive > 0.5
n_solid_alive = alive_solid.sum()
if n_solid_alive and vm[alive_solid].max() > 0:
    print(f"\n=== Solid Von Mises Stress (MPa, final frame) ===")
    print(f"  Max  : {vm[alive_solid].max():.1f}")
    print(f"  Mean : {vm[alive_solid].mean():.1f}")
    print(f"  95%  : {np.percentile(vm[alive_solid], 95):.1f}")
else:
    eps_solid = arr[ArrayType.element_solid_effective_plastic_strain][-1, :, 0]
    print(f"\n=== Solid Elements ===")
    print(f"  Alive: {n_solid_alive}/{sl_alive.shape[0]}")
    print(f"  (Stress may be zero — check if material outputs stress)")
    print(f"  Max solid EPS  : {eps_solid[alive_solid].max() if n_solid_alive else 0:.4f}")
    print(f"  Mean solid EPS : {eps_solid[alive_solid].mean() if n_solid_alive else 0:.4f}")

# ─── Plots ────────────────────────────────────────────────────────────────────
fig = plt.figure(figsize=(16, 14))
fig.suptitle("D3plot Crash Simulation Analysis", fontsize=15, fontweight="bold")
gs = gridspec.GridSpec(3, 3, figure=fig, hspace=0.45, wspace=0.35)

# (a) Global energy
ax = fig.add_subplot(gs[0, :2])
ax.plot(t, ke/1e6, label="KE",         lw=2)
ax.plot(t, ie/1e6, label="IE",         lw=2)
ax.plot(t, te/1e6, label="Total",      lw=2, ls="--")
ax.plot(t, hg_total/1e6, label="HG",   lw=1.5, ls=":")
ax.set_xlabel("Time (s)")
ax.set_ylabel("Energy (kN·m)")
ax.set_title("Global Energy History")
ax.legend(fontsize=9)
ax.grid(True, alpha=0.3)

# (b) Hourglass ratio
ax2 = fig.add_subplot(gs[0, 2])
hg_r = hg_total / (te + 1e-12) * 100
ax2.plot(t, hg_r, color="red", lw=2)
ax2.axhline(10, color="orange", ls="--", lw=1, label="10% limit")
ax2.set_xlabel("Time (s)")
ax2.set_ylabel("HG / Total (%)")
ax2.set_title("Hourglass Energy Ratio")
ax2.legend(fontsize=9)
ax2.grid(True, alpha=0.3)

# (c) Rigid wall forces (only walls with peak > 5% of global max)
ax3 = fig.add_subplot(gs[1, :2])
global_max_rw = rw_force.max()
for w in range(n_walls):
    if rw_force[:, w].max() > global_max_rw * 0.05:
        ax3.plot(t, rw_force[:, w]/1e3, label=f"Wall#{w}", lw=1.5)
ax3.set_xlabel("Time (s)")
ax3.set_ylabel("Force (kN)")
ax3.set_title("Rigid Wall Contact Forces (>5% peak)")
ax3.legend(fontsize=7, ncol=3)
ax3.grid(True, alpha=0.3)

# (d) Global velocity
ax4 = fig.add_subplot(gs[1, 2])
ax4.plot(t, gv_mag*3.6/1e3, color="navy", lw=2)
ax4.set_xlabel("Time (s)")
ax4.set_ylabel("Speed (km/h)")
ax4.set_title("Global CoM Velocity")
ax4.grid(True, alpha=0.3)

# (e) Node displacement (99th percentile, excluding outliers)
ax5 = fig.add_subplot(gs[2, 0])
ax5.plot(t, disp_p99_step, color="darkorange", lw=2, label="99th pct")
ax5.set_xlabel("Time (s)")
ax5.set_ylabel("Displacement (mm)")
ax5.set_title("Node Displacement (99th pct)")
ax5.grid(True, alpha=0.3)

# (f) Shell max PEEQ over time
ax6 = fig.add_subplot(gs[2, 1])
ax6.plot(t, max_eps_step, color="green", lw=2)
ax6.set_xlabel("Time (s)")
ax6.set_ylabel("PEEQ")
ax6.set_title("Shell Max Plastic Strain")
ax6.grid(True, alpha=0.3)

# (g) Final frame shell PEEQ distribution (yielded elements only)
ax7 = fig.add_subplot(gs[2, 2])
eps_plot = final_eps[(final_eps > 1e-4) & alive_mask]
if len(eps_plot):
    ax7.hist(eps_plot, bins=60, color="steelblue", edgecolor="white", linewidth=0.3)
ax7.set_xlabel("PEEQ")
ax7.set_ylabel("Count")
ax7.set_title("Shell PEEQ Distribution (final, yielded)")
ax7.grid(True, alpha=0.3)

plt.savefig(str(ROOT / "analysis_result.png"), dpi=150, bbox_inches="tight")
print("\nPlot saved: analysis_result.png")
