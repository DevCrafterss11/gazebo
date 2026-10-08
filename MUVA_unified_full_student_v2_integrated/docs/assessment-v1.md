# 实验三 V1.1：浏览器教学模拟

入口 `/experiments/mission`；使用 `VITE_DATA_SOURCE=mock npm run dev` 启动（或不设置数据源，默认 Mock）。如已有 `.env.local` 设置 API，必须在启动命令中显式覆盖。无需启动后端、Gazebo、SITL 或 MAVLink。页面顶部明确标示教学模拟；**本实验不控制真实无人机**。

八步依次为系统认知、参数配置、场景选择、模拟环境启动、模拟诊断、安全检查、十项综合飞行、复盘与保存。各步门禁基于同一个 Run：测验提交、配置确认、场景确认、环境 READY、诊断提交、安全决策、遥测判定任务通过并完成异常处置，以及最后的数据复盘。刷新后保留作答、评分、降采样轨迹和任务结果，但重置模拟连接与安全检查；如飞行中刷新，运行中的任务标记中断，需重新启动模拟并进行安全检查/重练。考核模式不覆盖中断成绩；新实验生成新 Run ID。

`MockAssessmentRuntime` 通过 `AssessmentRuntime` 契约由 Service Registry 注入。单一 RAF 运动循环负责位置、航向、电池、目标插值及实时遥测；X 向东、Y 向上、Z 向南。`TrainingRuleEngine` 根据遥测和参数判定起飞、连续稳定悬停、方向位移、航向、航点及落地；任务命令接受与完成分别记录。程序化 Three.js 四旋翼是**Iris 教学示意模型**，不是 Gazebo DAE 的精确导入模型。场景为前端简化的跑道、校园、城市、山地，不对应真实 Gazebo World。故障为可重复的前端教学情境；不操作真实传感器或安全机制。

六维评分满分 100：认知 10、准备 10、诊断安全 20、飞行任务 35、异常处置 15、复盘 10。`ScoringEngine` 从 Run 的提交答案、任务结果及证据重新计算；未交复盘前不结算完整报告。记录和轨迹保存在本机 `localStorage` 的 `muva-assessment-active-v1`、`muva-assessment-records-v1`，支持 JSON 导出及浏览器打印。浏览器本地数据不是防篡改的正式成绩库，也不具备跨设备同步。

V2 只读观察入口：默认 `VITE_ASSESSMENT_SOURCE=mock VITE_DATA_SOURCE=mock npm run dev`，八步 Mock 流程不请求 Gateway。显式使用 `VITE_ASSESSMENT_SOURCE=real VITE_DATA_SOURCE=mock npm run dev` 时，同一路由展示 Real 只读观测页：仅检查 `GET /api/health`、`GET /api/vehicle`，订阅 `WS /ws/telemetry`，未取得有效 Home 与新鲜快照时位置为 UNKNOWN。断线和快照过期不会转成 Mock 遥测或评分。此时没有可用网关也可以打开页面，但无法连接。

Real 不提供八步真实控制：现有后端没有跨实验资源所有权/租约，实验三不能安全启动/停止共享 SITL 或执行 arm、takeoff、move、RTL、land；飞行与评分只在 Mock 模式运行。Real 只读页面仅用于验证消息契约，不是 SITL 联调通过的证明。接口核对见 `docs/ui-audit/experiment3/backend-contract.md`；将来需先补后端原子资源租约、独立安全检查和位置/速度控制支持，然后按统一 `AssessmentDroneAdapter` 分层升级真实任务。

验证：`npm run typecheck && npm test && npm run build`；不得将 Mock 状态标记为真实连接。

后续视觉工作：已检查 ArduPilot Gazebo `iris.dae`（21MB）。临时减面 GLB 无材质/独立螺旋桨，未达到可用的忠实模型标准，未合入。继续寻找/制作许可合规的浏览器 Iris 模型；场景仍为程序化教学画面，非参考图卫星影像。视觉对照见 `docs/ui-audit/experiment3/ui-gap-report.md`。
