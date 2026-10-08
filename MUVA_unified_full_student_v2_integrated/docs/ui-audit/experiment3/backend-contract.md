# 实验三网关契约与安全边界

核对分支 `upload/muva-unified-2026-10-03`，commit `98417806d89cde63b1ac95c41a766f72e556708e`，源码在仓库**上层** `mavlink-gateway/muva_gateway/app.py`、`commands.py`、`state.py`；本机对应文件与该分支 `app.py` SHA-256 一致。前端共享服务在 `src/services/api/ApiServices.ts`、`src/services/websocket/telemetrySocket.ts`、`src/services/http/client.ts`。本地 `.env.local` 可能覆写 API 地址。检查的是源代码，不是 SITL 联调。

HTTP 前缀 `/api`；出错为 `{detail: string}`，服务无响应由前端 axios 10 秒超时报错；飞行指令 409 拒绝/忙碌、422 参数错误、503 离线、504 超时。网关命令返回 `{accepted:true,...}`（并不保证目标到达）。前端共享 `ApiFlightService` 已映射以下接口，实验一使用 `FlightService`，实验三不共享其实验 Store。

| 能力 | 实际接口及主要字段 | 已有前端调用/限制 |
| --- | --- | --- |
| 网关健康 | `GET /api/health` → `{status,vehicleConnected,endpoint}` | 健康不等于飞控在线 |
| 运行状态 | `GET /api/v1/runtime/status` → gazebo,ardupilotSitl,mavlinkGateway,heartbeat,gps,ekf,vehicle | 服务会根据保存的 `currentStep` **合成 STOPPED**，不能用于进程所有权判定 |
| 启动/停止 | `POST /api/v1/runtime/start`, `POST /api/v1/runtime/stop` | 启动只连接已有 SITL；停止只修改 `_runtime_active`；无原子租约，不可由实验三安全调用 |
| 实时遥测 | `WS /ws/telemetry` → `protocolVersion:1.0,type:telemetry,timestamp,vehicleId,sequence,source:mavlink,payload:{type:SNAPSHOT,position:{latitude,longitude,altitude,north,east},velocity:{groundSpeed,verticalSpeed},attitude:{roll,pitch,yaw},batteryPercent,gps,health,system:{mode,armed}}` | `WebSocketTelemetryService` 解析；断线、未收到快照、超时都不是 READY |
| 状态快照/Home | `GET /api/vehicle` → `connection,telemetry,home,vehicle,track` | `ApiTelemetryService.getFlightMap()` 提供 Home/轨迹；未有有效 Home 不应创建本地位置原点 |
| 诊断/安全 | `POST /api/v1/system/sensors/check` → 列表；`POST /api/v1/flight/preflight` → 清单；`GET /api/v1/vehicle/safety` → environmentReady,vehicleOnline,mavlinkConnected,ekfHealthy,gpsSatellites,batteryPercent,armed,altitude,maxAltitude,homePosition | 诊断检查 IMU 的“正常”基于在线推断，不是 IMU 原始健康；preflight 依赖传入检查项，不能代替硬件独立 pre-arm ACK |
| 模式/解锁 | `POST /api/v1/vehicle/mode` `{mode}`；`POST /api/v1/vehicle/arm`；`POST /api/v1/vehicle/disarm` | `ApiFlightService.setMode/arm/disarm`；模式集合映射需实际飞控校验 |
| 起飞/悬停 | `POST /api/v1/vehicle/takeoff` `{altitudeMeters}`；`POST /api/v1/vehicle/hold` | `ApiFlightService.takeoff/hold`；米；到达高度需独立遥测判定 |
| 位移/航向 | `POST /api/v1/vehicle/move` `{direction,meters}` (forward/backward/left/right/up/down)；`POST /api/v1/vehicle/yaw` `{direction,degrees}` | move 使用**绝对纬度增加代表 forward（北）**，不是机头相对方向；无速度目标；无任意单点 `flyTo`；yaw 为相对角度 |
| RTL/降落 | `POST /api/v1/vehicle/rtl`、`POST /api/v1/vehicle/land` | `ApiFlightService.rtl/land`；接受 ACK ≠ 到家或落地 |
| 航点任务 | `POST /api/v1/missions/upload` `{name,waypoints:[{latitude,longitude,altitudeMeters}]}`、`POST /api/v1/missions/start`、`GET /api/v1/missions/current`、`POST /api/v1/missions/clear` | `ApiMissionService` 已有；上传整个任务并非逐个飞向相对本地目标 |
| 持久化 | `/api/v1/experiments`、`/api/v1/experiments/{id}/record` 等 | 网关持久化无实验三飞控独占所有权；Mock 实验三独立存本地，切模式不能复用 Mock 评分证据 |

约定：Web 画布 X 东、Y 上、Z 南；遥测 local X=`east`、Z=`-north`、Y=相对 Home 的高度。Gateway 的 `altitude` 字段按相对高度使用；无法确认 Home 时返回 UNKNOWN，不使用经纬度 0,0 或 Mock 原点替代。Yaw 从北顺时针，渲染视角需校验模型朝向；Roll/Pitch 要通过模型坐标转换，不能直接把角度塞进 Euler 同名轴。前端快照时间单独记录；新心跳不能刷新旧位置快照的有效期。

**安全裁决：**网关尚无跨实验会话原子资源所有权/租约，当前不能保证实验三不抢占实验一；因此真实模式只允许无副作用的网关检查/遥测观察，不执行 start、stop、arm、takeoff、move、yaw、mission、RTL 或 land。实验三正式飞行训练在真实模式标记“不支持/待后端所有权能力”，绝不通过 Mock 状态绕过。动态 Gazebo World 切换和可执行速度目标均不存在。SITL 真机联调未运行，也未授权操纵共享飞控。
