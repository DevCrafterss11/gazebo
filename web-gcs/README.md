# MUVA Web GCS

面向 ArduCopter 的本地 Web 地面站前端。默认通过 `/ws/telemetry` 和 `/api` 连接 MUVA MAVLink 网关。

## 本地运行

```bash
./dev.sh
```

默认访问地址为 `http://localhost:5173`。如果系统没有 Node.js，脚本会在 `.tools/` 下准备项目私有的 Node 22，不修改系统环境。

纯界面演示可访问 `http://localhost:5173/?demo=1`，该模式不会向飞控发送命令。

## 当前界面

- 飞行地图、航线与无人机位置
- 姿态、高度、速度、电池、GPS 和链路遥测
- 模式切换、解锁确认、起飞、返航、降落和刹停
- 航点增删、航线摘要与上传交互
- QGC 风格规划视图，支持地图连续加点、双向选择、拖动改位、列表拖拽排序与参数编辑
- 规划起始点、飞控 Home 区分，以及区域测绘航线快速生成
- 系统健康检查与飞控消息
- 桌面、平板和移动端响应式布局

## 构建

```bash
npm run build
npm run test:e2e
```
