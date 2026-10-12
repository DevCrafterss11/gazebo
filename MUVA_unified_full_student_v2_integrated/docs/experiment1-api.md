# 实验一真实链路

默认 `npm run dev` 保持前端 Mock，无需后端。完整真实 SITL 链路从仓库根目录执行 `./start_experiment1.sh`，或在前端设置 `VITE_DATA_SOURCE=api` 并自行启动 `./start_all_muva.sh`。一键启动器托管 Gazebo、SITL、FastAPI 与 API 模式前端；离开时使用 `./stop_all_muva.sh`。接口文档由运行中的 Gateway `/docs` 提供。

## 实验入口与进度恢复

进入实验一（包括刷新页面或重启前端后）先显示实验介绍，不自动载入已完成步骤或恢复遥测连接。没有未完成进度时选择“开始新实验”；有未完成进度时显示上次阶段，并提供“重新开始实验”和“继续上次进度”。入口等待选择期间不会覆盖已保存进度。

“继续上次进度”恢复学习、作答和配置；页面重新加载后，原步骤5～7回到步骤4，必须重新启动环境、执行传感器检查与起飞前检查，不把旧的检查结果当作当前安全状态。同一次页面运行中切出再返回，继续操作保留当前阶段和运行状态。已结束或已结算的实验不作为可继续的草稿。

“重新开始实验”需确认，会清除当前草稿、检查、训练、地图和作答，生成新的进度 ID 并回到第一步；旧的未完成草稿不再可恢复，但不会删除已保存的历史报告。Mock 与 API 模式使用相同入口和 Service 接口。

入口浏览器回归：在独立 Mock 前端运行 `node tests/experiment1-entry-browser.cjs`，可通过 `MUVA_TEST_URL`、`PLAYWRIGHT_CORE_PATH`、`CHROMIUM_PATH` 指定测试实例和现有浏览器依赖，不要指向真实飞行实例。

## 真实链路与限制

实验一的机型/场景列表、实验 Session、步骤进度、学习答题、环境状态与日志、传感器和起飞前检查、飞行命令、航线、遥测、地图 HOME/轨迹、考试评分、结果和历史报告均走 Gateway 的 HTTP/WS 接口。浏览器仅保留当前登录名称关联的进度 ID，不把整份 API 模式评分或进度存在本地。进度按 ID 隔离；当前服务未实现认证/服务端用户授权，不适合暴露在公网。

步骤4向已运行的一键启动器请求建立飞行器连接，不负责重启 Gazebo 或 SITL；启动失败、断线与传感器不健康不会伪装为 READY/PASS。传感器取自 MAVLink `SYS_STATUS` 与 GPS 3D fix；目前网关未接入独立 EKF 状态报文，EKF 依据 GPS fix 与 IMU health 推断，不能当作飞控 EKF 的直接诊断。已验证真实 SITL 上的会话创建、环境启动、预检、WS 遥测、ARM、起飞、HOLD、LAND 并安全落地，以及地面航线上传、回读和确认清除；完整 10 项训练、航线执行与浏览器端评分尚未做真实飞行验收。

**场景展示与实际起飞点分离**：SITL 实际 HOME 仍由 `start_iris_sitl.sh` 的固定参数决定。实验一卫星地图以所选 HOME 为场景原点，把实际 HOME 与真实东/北位移映射到该场景；无人机、轨迹和定位按钮统一使用场景展示坐标，不再跳回校园。地图对原点差异显示明确提示。Store 与网关保留实际 GPS 和飞控 HOME，点击航点时反向转换成实际飞控坐标，真实返航和航线仍基于实际飞控 HOME。这不是按场景重新创建 SITL，也不适用于真实地理导航。详见 `experiment1-map.md`。

网关默认持久化文件位于 `${XDG_STATE_HOME:-~/.local/state}/muva/platform.json`，可以使用 `MUVA_PLATFORM_DATA` 覆盖。测试用 `PYTHONPATH=.packages:. python3 -m pytest -q`，前端按 `npm run typecheck`、`npm run build`、`npm test` 验证。
