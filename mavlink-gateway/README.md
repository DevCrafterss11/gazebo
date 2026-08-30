# MUVA MAVLink Gateway

将 ArduPilot MAVLink 转换为前端可用的 HTTP 命令接口和 WebSocket 遥测流。

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
