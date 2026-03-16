# 数据压缩与导出方案

## 原始数据量估算

| 数据 | 计算 | 大小 |
|---|---|---|
| 节点坐标（静态） | 177万 × 3 × 4B | ~20 MB |
| 节点位移（每帧） | 177万 × 3 × 4B × 55帧 | ~1.1 GB |
| Shell 连接关系（静态） | 76万 × 4 × 4B | ~12 MB |
| Shell PEEQ（每帧） | 76万 × 4B × 55帧 | ~165 MB |
| Shell 厚度（每帧） | 76万 × 4B × 55帧 | ~165 MB |
| **合计** | | **~1.5 GB** |

---

## 四个压缩维度

### 1. 空间（几何简化）
- 丢弃 Solid(825K) 和 Beam(22K) 单元，仅保留 Shell(768K)
- 用 PyVista `extract_surface` 提取外表面，单元数再降 30~40%
- 节省约 50% 几何数据

### 2. 精度（数值降精度）
- 位移、坐标：Float32 → **Float16**，节省 50%，精度约 ±0.1mm
- PEEQ 等标量：Float32 → **Float16**
- 使用 scale + offset 量化，精度受控

### 3. 时间（帧稀疏化）
- 原始 55 帧 → 自适应抽帧保留 **20~30 帧**
- 变形剧烈阶段保留更多帧，稳定段抽稀
- 节省约 50% 时间维度数据

### 4. 编码格式
| 格式 | VTK.js 支持 | 压缩 | 特点 |
|---|---|---|---|
| `.vtp`（XML） | 原生 | zlib | 每帧一个文件，简单 |
| `.vtp`（Binary+zlib） | 原生 | zlib | 比 XML 小 3~5x |
| `.vtkjs` | 原生 | zip | 全场景打包 |
| 自定义二进制 | 需自写 loader | lz4/zstd | 最小体积 |
| **→ 选用：Binary VTP + zlib** | 原生 | zlib | 开箱支持，实现最简 |

---

## 输出结构（静态 + 动态分离）

```
output/
├── geometry.vtp          # 静态：节点初始坐标 + Shell 连接关系（一次下载）
├── frame_00.bin          # 动态：每帧仅存位移(Float16) + PEEQ(Float16)
├── frame_01.bin
├── ...
├── frame_N.bin
└── manifest.json         # 帧数、时间戳、scale/offset 元数据
```

### 每帧大小估算（压缩后）
```
位移: 177万 × 3 × 2B(F16) ≈ 10 MB  →  zlib压缩后 ~3-4 MB
PEEQ: 76万 × 2B(F16)       ≈  1.5 MB →  压缩后 ~0.5 MB
单帧: ~4 MB
总量: ~4 MB × 30帧 = 120 MB（vs 原始 1.5 GB，压缩比约 10:1）
```

---

## 技术选型汇总

| 环节 | 选型 |
|---|---|
| 数据读取 | lasso-python (D3plot) |
| 数据处理 | NumPy + PyVista |
| 静态几何 | Binary VTP（PyVista 直接导出） |
| 动态数据 | 自定义 Float16 二进制 + zlib |
| 前端加载 | manifest.json 驱动，按帧懒加载 |
| 前端渲染 | VTK.js HttpDataSetReader 或自定义 loader |
