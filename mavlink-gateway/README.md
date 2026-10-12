# MUVA MAVLink Gateway

将 ArduPilot MAVLink 转换为前端可用的 HTTP 命令接口和 WebSocket 遥测流。

实验二使用单独的 `muva_gateway.swarm_app`：在仓库根目录运行 `./start_experiment2.sh`，前端只给实验二选用 `ApiSwarmService`；独立网关监听 `127.0.0.1:8002`，以 TCP 分别连接 2–6 架原生 ArduCopter `quad` SITL（默认端口 15760、15780 等），不启动 Gazebo，也不占用实验一飞控、网关或浏览器进度。后端逐机校验 GPS/EKF、上传并回读完整 MAVLink 任务，以 GUIDED 指令调度并行覆盖及逐机返航，通过 `/ws/swarm` 回传真实飞控位置。初始化成功后，若图形桌面已安装 `xterm`，自动打开每架无人机专属的**只读指令流水**，窗口固定使用 UTF-8 与 `Noto Sans Mono CJK SC` 中文等宽字体：网关实际控制通道发起的模式、解锁、起飞、任务上传和位置目标（TX），飞控原始 `COMMAND_ACK`、`MISSION_ACK`、`STATUSTEXT`（RX），以及心跳、遥测和任务回读确认后的完成记录（DONE）；顶部显示实时模式、高度、位置、电量和进度。ACK 只代表飞控接收，不冒充动作完成。各机独立写入 `uav-N/commands.jsonl` 和 `uav-N/flight-state.json`，无需再从另一个 MAVLink 端口旁路猜测控制指令。关闭窗口不影响任务，重新开始实验会先确认飞控在线、上锁且已降落，再通过会话安全关闭旧机群；失败则保留旧进度，不会强行结束飞控。窗口启动日志写入 `uav-N/monitor.log`，原始飞控日志在 `uav-N/sitl.log`；设置 `MUVA_SWARM_MONITOR_TERMINALS=0` 可关闭弹窗。服务重启后会话不会跨进程恢复。`./stop_experiment2.sh` 会拒绝在飞行中关闭飞控。

需要**实际飞行验证双机完整链路**时，在 `mavlink-gateway` 目录运行：

```bash
MUVA_RUN_SWARM_SITL_E2E=1 PYTHONPATH=.packages:. python3 tests/swarm_sitl_e2e.py
```

测试使用临时状态目录、独立端口 16960/16980，不连接已有实验；飞行中请勿强制终止脚本。低配机器建议关闭实验一 Gazebo 后再运行；测试脚本不会自动关闭实验一。

## 运行

标准 MAVProxy 输出方式：

```bash
./dev.sh
```

默认监听 `udpin:0.0.0.0:14552`。当前 SITL 已经运行但没有重启加载 `14552` 时，可直接使用其独立 MAVLink TCP 端口：

```bash
MUVA_MAVLINK_ENDPOINT=tcp:127.0.0.1:5762 ./dev.sh
```

HTTP 服务位于 `http://localhost:8000`，接口文档位于 `/docs`。

## 飞控信息监控

独立的只读终端监控器会展示飞行模式、解锁状态、位置、姿态、速度、GPS、
电池、任务进度、EKF / 传感器健康、RC / 舵机输出，以及飞控的 `STATUSTEXT`
错误和 `COMMAND_ACK` 结果。

Web 前端集成的只读回传控制台使用 UDP 14553。独立终端监控器默认使用 UDP 14554，使用前需要为 SITL 增加对应的 `--out`：

```bash
./monitor.sh --port 14554
```

保存全部收到的 MAVLink 数据为 JSONL：

```bash
./monitor.sh --port 14554 --log logs/flight-monitor.jsonl
```

当前网关已经占用 14552 时，不要让两个进程竞争同一个 UDP 输入端口。可直接
连接 SITL 的独立 TCP 端口：

```bash
./monitor.sh --endpoint tcp:127.0.0.1:5762
```

或者让 MAVProxy / SITL 额外输出到另一个 UDP 端口，再用 `--port` 指定该端口。
使用 `--no-clear` 可以保留每次刷新内容，适合重定向到终端日志。

监控器默认会发送 MAVLink 遥测订阅请求，以便直接 TCP 连接时获取位置、姿态等
完整状态；它不会发送解锁、模式或飞行控制命令。使用 `--passive` 可关闭订阅请求。

## 接口

实验一的真实 Session、按 `progressId` 保存的进度、按 Session 保存的评分/报告、环境、传感器预检和版本化飞行接口详见前端 `docs/experiment1-api.md`；全部接口细节以运行中的 `/docs` 为准。评分和实验进度持久化于 `MUVA_PLATFORM_DATA` 指定的文件（默认用户状态目录），不是浏览器 localStorage。

实验四安全对抗使用隔离的 `/api/v1/security/runs` REST 生命周期和 `WS /ws/security/{runId}` 通道；契约、检测/评分规则、Mock/API 差异与限制详见前端 `docs/experiment4-v1.md`。实验安全样本使用独立的 `security.telemetry.v1` envelope，不进入普通车辆遥测通道。考核结果虽由 Gateway 计算和保存，但当前服务没有身份认证/授权，不适用于正式防篡改考试。

- `GET /api/health`：网关和飞控连接健康
- `GET /api/vehicle`：最新车辆状态快照
- `WS /ws/telemetry`：最新遥测状态流
- `POST /api/commands/mode`：切换模式并等待心跳确认
- `POST /api/commands/arm`：解锁/锁定并等待 ACK 与状态确认
- `POST /api/commands/takeoff`：GUIDED 模式起飞命令
- `POST /api/commands/hold`：GUIDED 位置/高度保持（不依赖遥控器油门）
- `GET /api/missions`：从飞控下载任务
- `POST /api/missions/upload`：上传任务并回读校验
- `POST /api/missions/start`：切换 AUTO 并启动任务

地面解锁时，网关会自动将 `AUTO`、`LAND`、`RTL` 和 `SMART_RTL` 切换到 `GUIDED` 后再发送解锁命令；飞行中不会绕过安全检查。飞控拒绝解锁时，错误会包含同一时段的 `STATUSTEXT` 预检原因。

## 测试

```bash
PYTHONPATH=.packages:. python3 -m pytest -q
```
