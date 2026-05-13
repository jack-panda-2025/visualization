# Collision Simulation Viewer

基于 React + Three.js 的车辆碰撞仿真可视化工具（v3.0）。

## 数据文件

> **重要：仓库不含仿真数据（文件过大），需手动放置。**

| 文件 | 放置路径 | 说明 |
|------|----------|------|
| `collision_light.bin` | `collision-viewer/public/collision_light.bin` | 主数据文件，约 151 MB，二进制格式 |

原始 LS-DYNA 仿真结果（`d3plot*`）及中间产物（`collision_light.json`）存放在本地 `data/` 目录，不纳入版本控制。

### 数据文件从哪里来

`collision_light.bin` 由 `extract_data.py` 从原始 d3plot 文件生成：

```bash
# 在项目根目录执行
python extract_data.py
```

生成后将输出文件复制到 `collision-viewer/public/`：

```bash
cp collision_light.bin collision-viewer/public/
```

## 开发启动

```bash
cd collision-viewer
npm install
npm run dev
```

浏览器访问 `http://localhost:5173`，应用启动后自动从 `public/collision_light.bin` 加载数据。

## 功能

### 跟踪 Tab
- 3D 点云显示碰撞过程，节点按 PEEQ / Von Mises 应力着色
- 点击节点 → 弹出信息框，可添加跟踪点
- 每个跟踪点显示实时应力值 + 帧历史曲线

### 网格 Tab
- 切换后自动将各部件渲染为凸包面网格
- 网格随动画实时更新（顶点位置逐帧同步）
- 支持透明度调节和线框叠加显示

### 检查 Tab
- 所有部件按区域分组（驾驶舱 / 前舱 / 后舱 / 车头 / 车尾 / 护栏）
- 支持分组全选 / 取消，以及全局全选 / 清空
- 选中部件渲染为彩色高亮凸包面

## 技术栈

- React 18 + TypeScript + Vite
- Three.js（点云、ConvexGeometry、轨道相机）
- Zustand（状态管理）
- Canvas 2D API（内联应力曲线图）

## 目录结构

```
collision-viewer/
  public/              ← 放置 collision_light.bin
  src/
    components/
      Sidebar/         ← TrackView / MeshView / InspectView
      Chart/           ← 内联曲线图 & 弹窗曲线图
      Viewer/          ← Three.js 画布 & Tooltip
      Controls/        ← 播放控制条
    hooks/
      useThreeScene.ts ← Three.js 核心逻辑
      usePlayback.ts   ← 帧播放循环
    lib/
      parseBin.ts      ← 二进制数据解析
      simData.ts       ← 仿真数据单例
      partsData.ts     ← 864 个部件元数据
      partColors.ts    ← 部件颜色映射
    store/
      useStore.ts      ← Zustand 全局状态
```
