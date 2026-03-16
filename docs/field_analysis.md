# D3Plot 数据字段分析

## 基本信息
- 时间范围: 0.0000 ~ 0.9980 s，共 55 帧
- 节点数: 1,777,011
- Shell 单元: 768,288（车身钣金为主）
- Solid 单元: 825,280（发动机舱等块体）
- Beam 单元: 22,894（焊缝、铰链等）
- Part 数量: 1,672
- 单位制: mm / s / ton / N / MPa

---

## 网格拓扑（静态，不随时间变化）

| 字段 | Shape | 含义 |
|---|---|---|
| `node_coordinates` | (1777011, 3) | 所有节点的初始 XYZ 坐标（mm） |
| `node_ids` | (1777011,) | 节点的全局 ID |
| `element_shell_node_indexes` | (768288, 4) | 每个 Shell 单元的 4 个节点索引 |
| `element_solid_node_indexes` | (825280, 8) | 每个 Solid 单元的 8 个节点索引 |
| `element_beam_node_indexes` | (22894, 5) | 每个 Beam 单元的节点索引 |
| `element_shell_part_indexes` | (768288,) | 每个 Shell 单元属于哪个 Part |
| `element_solid_part_indexes` | (825280,) | 每个 Solid 单元属于哪个 Part |
| `element_beam_part_indexes` | (22894,) | 每个 Beam 单元属于哪个 Part |
| `part_ids` | (1672,) | Part ID 列表 |
| `part_titles` | (940,) | Part 名称（字符串，部分有名字） |

> Shell = 薄板壳（车身钣金为主），Solid = 实体块（发动机、轮胎橡胶等），Beam = 梁单元（焊缝、铰链等）

---

## 时间序列数据（55 帧）

### 节点运动（驱动动画变形的核心）

| 字段 | Shape | 含义 |
|---|---|---|
| `node_displacement` | (55, 1777011, 3) | 每帧每节点相对初始位置的位移 XYZ（mm） |
| `node_velocity` | (55, 1777011, 3) | 节点速度 XYZ（mm/s） |
| `node_acceleration` | (55, 1777011, 3) | 节点加速度 XYZ（mm/s²） |

> 当前坐标 = `node_coordinates` + `node_displacement[frame]`，这是动画变形的核心公式。

### 全局量（宏观曲线）

| 字段 | Shape | 含义 |
|---|---|---|
| `global_timesteps` | (55,) | 每帧时间（s） |
| `global_kinetic_energy` | (55,) | 全局动能（N·mm） |
| `global_internal_energy` | (55,) | 全局内能（N·mm） |
| `global_total_energy` | (55,) | 全局总能量 |
| `global_velocity` | (55, 3) | 全局质心速度 XYZ（mm/s） |

### 零件级物理量

| 字段 | Shape | 含义 |
|---|---|---|
| `part_internal_energy` | (55, 1672) | 每个 Part 的内能（吸能分布） |
| `part_kinetic_energy` | (55, 1672) | 每个 Part 的动能 |
| `part_velocity` | (55, 1672, 3) | 每个 Part 的速度 |
| `part_mass` | (55, 1672) | 每个 Part 的质量 |
| `part_hourglass_energy` | (55, 1672) | 沙漏能（质量指标，越小越好） |

### Shell 单元结果（车身钣金）

| 字段 | Shape | 含义 |
|---|---|---|
| `element_shell_effective_plastic_strain` | (55, 768288, 3) | 等效塑性应变，3层=外/中/内表面，越大越接近断裂 |
| `element_shell_thickness` | (55, 768288) | 实时厚度（mm），减薄代表塑性变形 |
| `element_shell_internal_energy` | (55, 768288) | 每单元内能（N·mm） |
| `element_shell_is_alive` | (55, 768288) | 单元是否存活（0=已侵蚀/断裂） |

### Solid 单元结果（发动机舱等）

| 字段 | Shape | 含义 |
|---|---|---|
| `element_solid_stress` | (55, 825280, 1, 6) | 应力张量 [S11,S22,S33,S12,S23,S13]（MPa） |
| `element_solid_effective_plastic_strain` | (55, 825280, 1) | 等效塑性应变 |
| `element_solid_history_variables` | (55, 825280, 1, 6) | 材料自定义历史变量 |
| `element_solid_is_alive` | (55, 825280) | 单元存活状态 |

### Beam 单元结果（焊缝/铰链）

| 字段 | Shape | 含义 |
|---|---|---|
| `element_beam_axial_force` | (55, 22894) | 轴向力（N） |
| `element_beam_shear_force` | (55, 22894, 2) | 剪切力 |
| `element_beam_bending_moment` | (55, 22894, 2) | 弯矩 |
| `element_beam_torsion_moment` | (55, 22894) | 扭矩 |
| `element_beam_is_alive` | (55, 22894) | 单元存活状态 |

### 接触

| 字段 | Shape | 含义 |
|---|---|---|
| `rigid_wall_force` | (55, 24) | 24 个刚性壁的接触力历程（N） |

---

## 关键分析结果

| 指标 | 数值 |
|---|---|
| 初始总能量 | 9.565e+08 N·mm |
| 峰值动能 | 9.578e+08 N·mm @ t=0.0020 s |
| 峰值内能 | 4.218e+08 N·mm @ t=0.9980 s |
| 最大沙漏能比 | 9.46%（<10% 合格） |
| 初始速度 | 5.74 km/h |
| 末态速度 | 4.08 km/h |
| 最大刚性壁接触力 | 691.6 kN（壁#4，t=0.798 s） |
| Shell 最大塑性应变 | 1.783 |
| Shell 屈服单元比例 | 8.0%（61101/768288） |
| 厚度减薄 >20% 单元 | 517 个（0.07%） |
| Solid 最大 Von Mises 应力 | 638.5 MPa |

### Top-10 吸能零件（末帧内能）

| Part ID | IE (N·mm) | KE (N·mm) |
|---|---|---|
| 10000017 | 7.281e+07 | 5.466e+01 |
| 10000007 | 6.267e+07 | 1.168e+02 |
| 10000012 | 5.296e+07 | 6.472e-01 |
| 10000005 | 5.205e+07 | 1.608e+02 |
| 10000001 | 2.428e+07 | 1.347e+04 |
| 2000445  | 1.845e+07 | 2.453e+06 |
| 10000013 | 1.399e+07 | 4.323e+03 |
| 2000183  | 9.788e+06 | 1.151e+06 |
| 2000334  | 7.580e+06 | 2.553e+06 |
| 2000446  | 7.390e+06 | 4.059e+06 |

---

## 动画可视化所需字段

| 目的 | 必用字段 | 说明 |
|---|---|---|
| **变形动画（核心）** | `node_coordinates` + `node_displacement` | 实时节点位置 |
| **几何面片（核心）** | `element_shell_node_indexes` | 构成三角/四边形面 |
| **颜色云图：塑性应变** | `element_shell_effective_plastic_strain[:,:,0]` | 最直观的损伤指标 |
| **颜色云图：位移大小** | `node_displacement` 求模 | 整体变形程度 |
| **颜色云图：厚度减薄** | `element_shell_thickness` | 断裂风险区域 |
| **单元删除效果** | `element_shell_is_alive` | 已侵蚀单元不渲染 |
| **能量曲线面板** | `global_kinetic_energy` / `global_internal_energy` | 侧面折线图 |
| **接触力曲线** | `rigid_wall_force` | 显示碰撞冲击力 |
| **进度时间轴** | `global_timesteps` | 帧时间标注 |

## 建议动画方案

- **渲染引擎**: PyVista（已安装）
- **几何**: Shell 面片为主（768K 单元，车身主体），Solid 可选（发动机舱块体）
- **颜色映射**: 等效塑性应变 PEEQ（蓝色=未屈服 → 红色=高应变）
- **帧序列**: 55 帧 → 导出 GIF 或 MP4
- **附加面板**: 右侧实时能量曲线（KE / IE）+ 时间戳
- **内存策略**: 逐帧加载渲染，避免一次性读入全部 ~1.1 GB 位移数据
