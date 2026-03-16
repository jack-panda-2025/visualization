"""
export_binary_v2.py
把 vtp_output_v2 的 vtp 文件转成二进制格式，供前端快速加载
每帧格式: [points(N*3 float32), von_mises(N float32)]
"""
import pyvista as pv
import numpy as np
from pathlib import Path
import json

Path("bin_output_v2").mkdir(exist_ok=True)

files = sorted(Path("vtp_output_v2").glob("frame_*.vtp"))
print(f"共 {len(files)} 帧")

mesh0    = pv.read(str(files[0]))
N_POINTS = mesh0.n_points
print(f"每帧点数: {N_POINTS:,}")

# 导出拓扑（只需一次，供参考）
faces = mesh0.faces.reshape(-1, 4)[:, 1:].astype(np.uint32)
faces.tofile("bin_output_v2/faces.bin")
print(f"拓扑: {faces.shape}, {Path('bin_output_v2/faces.bin').stat().st_size/1024/1024:.1f} MB")

# 读 vtp 的 metadata（时间步信息）
vtp_meta_path = Path("vtp_output_v2/metadata.json")
if vtp_meta_path.exists():
    vtp_meta = json.loads(vtp_meta_path.read_text())
    frames_meta = vtp_meta["frames"]
else:
    frames_meta = [{"frame": i, "time": round(i*0.018, 4), "vm_max": 0} for i in range(len(files))]

meta = {
    "n_frames":      len(files),
    "n_points":      N_POINTS,
    "vm_global_max": 699.0,
    "frames":        frames_meta
}

for i, f in enumerate(files):
    mesh   = pv.read(str(f))
    points = mesh.points.astype(np.float32)
    vm     = mesh.point_data["von_mises"].astype(np.float32)
    out    = np.concatenate([points.flatten(), vm])
    out.tofile(f"bin_output_v2/frame_{i:04d}.bin")
    size = Path(f"bin_output_v2/frame_{i:04d}.bin").stat().st_size / 1024 / 1024
    print(f"帧 {i+1}/{len(files)}: {size:.1f} MB", end="\r")

with open("bin_output_v2/metadata.json", "w") as fp:
    json.dump(meta, fp, indent=2)

print(f"\n完成！每帧 {size:.1f} MB, 点数 {N_POINTS:,}")
