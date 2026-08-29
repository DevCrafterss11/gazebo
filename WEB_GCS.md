# MUVA Web 地面站

## 标准启动顺序

1. 启动 Gazebo。
2. 使用 `./start_iris_sitl.sh` 启动 ArduCopter。脚本会让 MAVProxy 分别输出到控制端口 `UDP 14552` 和只读监控端口 `UDP 14553`。
3. 运行 `./start_web_gcs.sh`，同时启动 MAVLink 网关和 Web 前端。
4. 访问 `http://localhost:5173`。

当前已经启动但未加载 `14552` 输出的 SITL，可以让网关临时直连独立端口：

```bash
MUVA_MAVLINK_ENDPOINT=tcp:127.0.0.1:5762 ./mavlink-gateway/dev.sh
```

网关 API 文档位于 `http://localhost:8000/docs`。

## 飞控终端监控

Web 页面中的飞控回传控制台由网关只读监听 UDP 14553，不会通过该端口发送控制命令。
控制台在飞行、规划和系统视图中共用同一个底部停靠区，只显示命令确认、模式或解锁状态变化、任务进度、到达航点以及飞控告警；姿态、GPS 和传感器高频原始包不会进入界面。

如果还需要同时打开独立终端监控，请为 SITL 增加第三路 `--out=127.0.0.1:14554`，终端脚本默认监听 UDP 14554：

```bash
./start_mavlink_monitor.sh --port 14554
```

也可以在不影响两个 UDP 端口的情况下直连 SITL：

```bash
./start_mavlink_monitor.sh --endpoint tcp:127.0.0.1:5762
```

记录全部 MAVLink 消息：

```bash
./start_mavlink_monitor.sh --endpoint tcp:127.0.0.1:5762 \
    --log mavlink-gateway/logs/flight.jsonl
```
