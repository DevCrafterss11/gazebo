# MUVA 无人机教学与安全实验平台

MUVA 是一个面向无人机课程的本地教学与仿真平台。统一教学前端提供实验流程、飞行场景、数据面板和结果记录；需要真实飞控仿真时，可通过 FastAPI 网关连接 ArduPilot SITL 与 Gazebo。实验页面默认可用浏览器 Mock 独立体验，不启动飞控或发送 MAVLink 指令。

## 已实现内容

- **实验一：无人机配置与基础飞行**：系统组成学习与自测、飞控参数、训练场景、传感器检查、起飞前检查、基础飞行训练及实验结果。可使用 Mock 完成前端流程，也可连接真实网关与 SITL/Gazebo。
- **实验二：多机协同飞行**：2–6 架无人机的区域任务规划与执行。前端任务规划和可视化由统一平台提供；真实执行通过独立 Gateway、Gazebo Sim 与多实例 ArduCopter SITL 完成。也可单独使用 Mock 模式体验界面。
- **实验三：任务协同**：面向多机任务分工、协同流程和理论考核的前端模拟实验；目前走 Mock 流程。
- **实验四：安全攻防对抗**：安全事件判断、隔离与恢复、验证和复盘。Mock 可独立体验；真实靶场使用独立 Gateway 与仿真进程。
- **实验五：自定义安全对抗**：自定义安全训练流程，目前通过前端模拟运行。
- **Web 地面站**：独立的飞行地图、航线规划、遥测、飞控控制与只读 MAVLink 消息面板。

真实仿真需要相应的 ArduPilot SITL、Gazebo 和插件依赖。未安装这些依赖时，仍可运行 Mock 前端，但不能执行真实飞行仿真。

## 前端工程

仓库中有多个独立前端目录，日常教学平台开发以统一平台为准：

| 目录 | 用途 |
| --- | --- |
| `MUVA_unified_full_student_v2_integrated` | 当前统一教学平台，包含学生、教师、管理员页面及实验一至五 |
| `web-gcs` | 独立 Web 地面站 |
| `gazebo/gazebo` | 较早的实验一教学平台版本，保留作历史实现 |
| `gazebo/gazebo-design` | 本机设计/实验目录，受根 `.gitignore` 排除，不会随仓库提交 |

启动脚本 `start_unified_frontend.sh`、`start_experiment2.sh` 和 `start_all_muva.sh` 使用 `MUVA_unified_full_student_v2_integrated`。旧版 `gazebo/gazebo` 不作为当前主启动入口。

## 快速开始：前端 Mock

需要 Node.js（建议 Node 22）和 npm。仅运行教学界面与模拟流程时，不需要 Python、Gateway、Gazebo 或 SITL：

```bash
cd MUVA_unified_full_student_v2_integrated
npm install
VITE_DATA_SOURCE=mock npm run dev -- --host 127.0.0.1
```

打开 `http://127.0.0.1:5173`，登录后从实验中心进入。常用页面：

- 实验一：`/experiments/basic-flight`
- 实验二：`/experiments/swarm`
- 实验三：`/experiments/collaboration`
- 实验四：`/experiments/security`
- 实验五：`/experiments/custom-security`

仓库根目录的便捷启动命令也会使用统一前端：

```bash
./start_unified_frontend.sh
```

首次使用此脚本前，请确保 Node/npm 已安装或已放入仓库本机工具目录 `.tools/node/bin`。Mock 是默认数据源；运行真实 API 模式时应显式设置 `VITE_DATA_SOURCE=api`，并先启动对应后端。

## 真实仿真依赖

真实飞行链路需要 Linux 仿真环境，以及已构建的 ArduPilot SITL、`ardupilot_gazebo` 插件、Gazebo Sim 8 和 `gz` 命令。部分启动流程还使用 `xterm` 显示飞控指令日志。第三方源码与构建产物不提交到本仓库；根 `.gitignore` 排除了 `/ardupilot/` 和 `/ardupilot_gazebo/`。

已验证的上游版本：

- ArduPilot：`63ac2d68f2296252d1aeda58a10c219da7edcc7b`
- `ardupilot_gazebo`：`082a0fe231f6e63bc8d1598f1cba461d9e2ea7f5`

在仓库根目录获取对应源码：

```bash
git clone https://github.com/ArduPilot/ardupilot.git
git -C ardupilot checkout 63ac2d68f2296252d1aeda58a10c219da7edcc7b
git -C ardupilot submodule update --init --recursive

git clone https://github.com/ArduPilot/ardupilot_gazebo.git
git -C ardupilot_gazebo checkout 082a0fe231f6e63bc8d1598f1cba461d9e2ea7f5
git -C ardupilot apply ../patches/ardupilot-gazebo-iris-parameters.patch
git -C ardupilot_gazebo apply ../patches/ardupilot-gazebo-runway-location.patch
```

随后按 ArduPilot 与 `ardupilot_gazebo` 上游文档安装系统依赖、编译 SITL 和 Gazebo 插件，并确认实验所需 world 文件存在。

## 实验启动方式

### 实验一：单机仿真

```bash
./start_experiment1.sh
```

该快捷启动器使用 `start_all_muva.sh` 启动完整平台，默认打开 `http://127.0.0.1:5173/experiments/basic-flight`。完整启动需要已构建的 ArduPilot SITL、Gazebo 插件和 Python 网关依赖。主网关默认端口为 `8000`。若只体验实验流程，请使用前述 Mock 启动方式。

### 实验二：多机 Gazebo 仿真

```bash
./start_experiment2.sh
```

访问 `http://127.0.0.1:5174/experiments/swarm`。实验二网关默认使用 `8002`，状态、端口、world 和进程与实验一隔离。初始化后端会按所选机数创建专用 Gazebo 分区和 ArduCopter SITL 实例，并在飞控、GPS 与 EKF 就绪后才允许执行任务。低配机器建议从 2 架开始。停止时使用：

```bash
./stop_experiment2.sh
```

停止脚本会执行安全状态检查；不要在飞机尚未落地并上锁时强制关闭服务。

### 实验四：独立安全靶场

实验四的独立 Gateway 可单独管理：

```bash
./start_security_range.sh start
./start_security_range.sh status
./start_security_range.sh stop
```

默认监听 `127.0.0.1:8004`。启动 Gateway 本身不会启动飞行仿真；在实验页面启动靶场后，才会创建实验四专用仿真进程。停止靶场前应确认飞行器已落地并上锁。

### Web 地面站

地面站与教学平台分开运行。完整说明见 [`WEB_GCS.md`](WEB_GCS.md) 和 [`web-gcs/README.md`](web-gcs/README.md)。根目录脚本会在需要时启动实验一 Gateway，并运行地面站前端：

```bash
./start_web_gcs.sh
```

地面站默认访问 `http://127.0.0.1:5173`；教学前端也使用此端口，不能同时通过默认端口运行两者。纯界面演示模式为 `http://127.0.0.1:5173/?demo=1`，不会发送飞控命令。

## 网关开发与 API 文档

主 MAVLink Gateway 位于 `mavlink-gateway`，提供实验一飞控、遥测、任务及安全实验相关 API。开发启动脚本会创建本地 Python 虚拟环境并安装 `requirements.txt` 中的依赖：

```bash
./mavlink-gateway/dev.sh
```

默认 API 文档：`http://127.0.0.1:8000/docs`。实验二使用独立 ASGI 应用 `muva_gateway.swarm_app:app`；通过 `start_experiment2.sh` 管理，API 文档默认在 `http://127.0.0.1:8002/docs`。运行细节及安全行为见 [`mavlink-gateway/README.md`](mavlink-gateway/README.md)。

统一前端环境变量示例见 [`MUVA_unified_full_student_v2_integrated/.env.example`](MUVA_unified_full_student_v2_integrated/.env.example)。真实 API 模式不应与 Mock 模式混淆；实验二和实验四还具有独立数据源与网关配置。

## 测试与构建

统一前端：

```bash
cd MUVA_unified_full_student_v2_integrated
npm run typecheck
npm run build
npm test
```

Gateway 单元测试：

```bash
cd mavlink-gateway
PYTHONPATH=.packages:. python3 -m pytest -q
```

真实 SITL/Gazebo 端到端测试会启动仿真进程并运行飞行任务，只应在隔离、可控的仿真环境执行。详情见 `mavlink-gateway/README.md`。

## 运行数据与安全提示

- `.env.local`、依赖目录、构建产物、运行日志、状态数据和第三方仿真源码均为本机内容，不应提交。
- 平台运行状态默认保存在用户状态目录（通常为 `~/.local/state/muva/`）；部分路径可通过环境变量覆盖。
- Gateway API 默认没有面向互联网部署所需的身份认证与授权。请仅在受信任的本机或隔离网络中运行，不要直接暴露到公网。
- 真实 SITL/Gazebo 操作会产生实际的仿真进程和飞行状态。停止前务必遵循对应实验的安全降落与上锁流程。

## 目录概览

```text
MUVA_unified_full_student_v2_integrated/  当前统一教学平台
web-gcs/                                  独立 Web 地面站
gazebo/gazebo/                            早期实验一前端
mavlink-gateway/                          FastAPI / MAVLink 服务
patches/                                  上游仿真项目所需补丁
start_*.sh, stop_*.sh                     仿真与前端管理脚本
```
