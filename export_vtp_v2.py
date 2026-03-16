# export_vtp_v2.py
from lasso.dyna import D3plot
import pyvista as pv
import numpy as np
from pathlib import Path
import json

Path("vtp_output_v2").mkdir(exist_ok=True)

print("读取几何...")
d3_geom = D3plot("d3plot", state_array_filter=[])
coords0      = d3_geom.arrays["node_coordinates"]
shell_conn   = d3_geom.arrays["element_shell_node_indexes"]
shell_parts  = d3_geom.arrays["element_shell_part_indexes"]
solid_conn   = d3_geom.arrays["element_solid_node_indexes"]
solid_parts  = d3_geom.arrays["element_solid_part_indexes"]
part_ids     = d3_geom.arrays["part_ids"]

# 护栏 part id 范围
barrier_part_ids = set(range(10000001, 10000025))

# 建立 part index → part id 映射
part_id_map = {i: pid for i, pid in enumerate(part_ids)}

# 护栏 solid 单元
solid_is_barrier = np.array([
    part_id_map.get(int(p), 0) in barrier_part_ids
    for p in solid_parts
])

# 车辆 shell 单元（排除内部辅助面，车身+轮胎不再区分）
shell_is_barrier = np.array([
    part_id_map.get(int(p), 0) in barrier_part_ids
    for p in shell_parts
])
exclude_shell_ids = {9000002, 9000003, 9000004, 2000812, 2000813}
shell_is_vehicle = (~shell_is_barrier) & np.array([
    part_id_map.get(int(p), 0) not in exclude_shell_ids
    for p in shell_parts
])

print(f"Solid 护栏单元: {solid_is_barrier.sum():,}")
print(f"Shell 车辆单元: {shell_is_vehicle.sum():,}")

del d3_geom

d3_ts = D3plot("d3plot", state_array_filter=["timesteps"])
timesteps = d3_ts.arrays["timesteps"]
print(f"共 {len(timesteps)} 个时间步")
del d3_ts

meta = {"n_frames": len(timesteps), "vm_global_max": 699.0, "frames": []}

for i in range(len(timesteps)):
    print(f"处理帧 {i+1}/{len(timesteps)}, t={timesteps[i]:.4f}s ...", end=" ")

    d3 = D3plot("d3plot", state_array_filter=[
        "node_displacement",
        "element_solid_stress",
    ], state_filter={i})

    displace = d3.arrays["node_displacement"][0]
    stress   = d3.arrays["element_solid_stress"][0, :, 0, :]
    del d3

    coords_def = coords0 + displace

    s = stress
    sxx, syy, szz = s[:, 0], s[:, 1], s[:, 2]
    sxy, syz, sxz = s[:, 3], s[:, 4], s[:, 5]
    vm_solid = np.sqrt(0.5 * ((sxx - syy)**2 + (syy - szz)**2 + (szz - sxx)**2
                               + 6 * (sxy**2 + syz**2 + sxz**2))).astype(np.float32)

    # ── 护栏网格（solid）──
    barrier_conn = solid_conn[solid_is_barrier]
    n_b = len(barrier_conn)
    cell_arr = np.hstack([np.full((n_b, 1), 8, dtype=np.int64),
                          barrier_conn.astype(np.int64)]).ravel()
    barrier_mesh = pv.UnstructuredGrid(cell_arr, np.full(n_b, 12, dtype=np.uint8),
                                       coords_def.astype(np.float64))
    barrier_mesh.cell_data["von_mises"] = vm_solid[solid_is_barrier]
    barrier_surf = barrier_mesh.extract_surface(algorithm='dataset_surface')
    barrier_surf = barrier_surf.cell_data_to_point_data()

    # ── 车辆网格（车身+轮胎合并处理）──
    vehicle_conn = shell_conn[shell_is_vehicle]
    n_v = len(vehicle_conn)
    cell_arr_v = np.hstack([np.full((n_v, 1), 4, dtype=np.int64),
                             vehicle_conn.astype(np.int64)]).ravel()
    vehicle_mesh = pv.UnstructuredGrid(cell_arr_v, np.full(n_v, 9, dtype=np.uint8),
                                       coords_def.astype(np.float64))
    vehicle_mesh.cell_data["von_mises"] = np.zeros(n_v, dtype=np.float32)
    vehicle_surf = vehicle_mesh.extract_surface(algorithm='dataset_surface')
    vehicle_surf = vehicle_surf.cell_data_to_point_data()
    vehicle_surf = vehicle_surf.compute_normals(
        consistent_normals=True, auto_orient_normals=True, non_manifold_traversal=False)

    # ── 合并保存：顺序固定为 barrier → vehicle ──
    if i == 0:
        meta["n_pts_barrier"] = int(barrier_surf.n_points)
        meta["n_pts_vehicle"] = int(vehicle_surf.n_points)
    combined = barrier_surf + vehicle_surf
    out_path = f"vtp_output_v2/frame_{i:04d}.vtp"
    combined.save(out_path)

    vm_max = float(vm_solid[solid_is_barrier].max())
    size   = Path(out_path).stat().st_size / 1024 / 1024
    print(f"vm_max={vm_max:.1f} MPa, {size:.1f} MB")

    meta["frames"].append({
        "frame": i,
        "time":  round(float(timesteps[i]), 6),
        "vm_max": round(vm_max, 2)
    })

with open("vtp_output_v2/metadata.json", "w") as f:
    json.dump(meta, f, indent=2)

print("\n完成！输出目录: vtp_output_v2/")
