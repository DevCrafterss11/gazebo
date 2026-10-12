# MUVA 无人机教学实验平台

当前仓库包含已经联通的“实验一：无人机配置与基础飞行操作”：

- React / TypeScript 教学前端
- FastAPI MAVLink 网关
- ArduPilot SITL 与 Gazebo 启动脚本
- 实时遥测、基础飞行控制和航点任务接口

## 目录

- `gazebo/gazebo`：当前正式前端
- `mavlink-gateway`：FastAPI / MAVLink 后端
- `patches`：本项目对上游 ArduPilot 和 ardupilot_gazebo 的定制
- `start_experiment1.sh`：实验一快捷启动
- `start_all_muva.sh`：完整服务启动器
- `stop_all_muva.sh`：完整服务停止器

## 第三方仿真依赖

为了避免在本仓库重复保存数 GB 的第三方源码和构建产物，ArduPilot 与
`ardupilot_gazebo` 不直接提交。当前验证过的版本为：

- ArduPilot：`63ac2d68f2296252d1aeda58a10c219da7edcc7b`
- ardupilot_gazebo：`082a0fe231f6e63bc8d1598f1cba461d9e2ea7f5`

在仓库根目录恢复依赖：

```bash
git clone https://github.com/ArduPilot/ardupilot.git
git -C ardupilot checkout 63ac2d68f2296252d1aeda58a10c219da7edcc7b
git -C ardupilot submodule update --init --recursive

git clone https://github.com/ArduPilot/ardupilot_gazebo.git
git -C ardupilot_gazebo checkout 082a0fe231f6e63bc8d1598f1cba461d9e2ea7f5

git -C ardupilot apply ../patches/ardupilot-gazebo-iris-parameters.patch
git -C ardupilot_gazebo apply ../patches/ardupilot-gazebo-runway-location.patch
```

随后按照两个上游项目的文档完成 SITL 和 Gazebo 插件构建。

## 启动实验一

统一教学前端的实验一、二、三可独立使用前端 Mock：运行 `./start_unified_frontend.sh`，或在 `MUVA_unified_full_student_v2_integrated` 目录执行 `npm run dev`（本机 `.env.local` 应设置 `VITE_DATA_SOURCE=mock`）。无需启动后端。实验三完成步骤一的部件学习及知识自测后，点击页面底部的「完成本阶段，进入下一步」。

## 实验二：仅启动模拟飞控

运行 `./start_experiment2.sh`，访问 `http://127.0.0.1:5174/experiments/swarm`。前端其他实验保持 Mock，实验二使用独立的 FastAPI 服务 (`127.0.0.1:8002`) 和原生 ArduCopter `quad` SITL；**不启动 Gazebo 或 MAVProxy**，与实验一的端口、数据和飞控分离。点击「初始化机群」才启动 2–6 架 SITL；低配电脑建议先选 2 架。重新开始实验会先请求安全关闭旧会话；任一飞控离线、未确认降落或仍解锁时不会强行关闭，也不会丢弃当前实验进度。首次运行需要已编译的 `ardupilot/build/sitl/bin/arducopter` 和网关 Python / 前端 npm 依赖。

后端等待每架飞控心跳、GPS 和 EKF 绝对位置估计就绪后才允许预备/解锁；飞控离线时拒绝重置或停机，防止把未知飞行状态当作落地。航线由前端规划，后端对每架飞控逐一上传、回读确认，并以 MAVLink GUIDED 指令执行起飞、扫描与返航；前端接收实际飞控遥测。局部流程异常不会伪造任务完成。点击初始化并成功连接后，图形桌面上按实际机数自动打开逐机只读**指令流水终端**（2 架对应 2 个窗口，标题包含 UAV 编号及 SysID）：顶部显示飞控实时模式、位置、高度及进度，下方区分网关发起的指令 TX、飞控原始回复 RX 和飞行状态确认后的 DONE；不会将 ACK 误显示为飞行完成。逐机完整记录在 `~/.local/state/muva/experiment2/uav-N/commands.jsonl`，关闭窗口不影响飞控。无图形桌面或未安装 `xterm` 时飞控仍正常运行，可查看日志；设置 `MUVA_SWARM_MONITOR_TERMINALS=0` 可关闭自动弹窗（重启实验二网关后生效）。执行 `./stop_experiment2.sh` 只关闭实验二服务和它启动的监控窗口；**请先确认所有飞机落地**，飞行中会拒绝停止。模拟飞控仍会占用 CPU，不能等同于零负载；服务重启后内存中未完成的 SITL 会话不能恢复，页面需重新初始化。

需要使用真实网关调试实验一时，先启动对应后端，再显式运行 `VITE_DATA_SOURCE=api ./start_unified_frontend.sh`；`./start_all_muva.sh` 会自动使用 API 模式。

安装前端依赖：

```bash
cd gazebo/gazebo
npm install
cd ../..
```

启动完整实验平台并直接进入实验一：

```bash
./start_experiment1.sh
```

停止整套服务：

```bash
./stop_all_muva.sh
```

平台默认地址：

- 前端：`http://127.0.0.1:5173`
- 实验一：`http://127.0.0.1:5173/experiments/basic-flight`
- 后端：`http://127.0.0.1:8000`
