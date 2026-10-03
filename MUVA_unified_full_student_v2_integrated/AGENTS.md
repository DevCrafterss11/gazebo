# AGENTS.md

## 项目与当前目标

- 项目名称：MUVA 无人机教学与安全实验平台。
- 当前阶段：开发一个完全前端模拟的 ArduPilot 四旋翼无人机仿真教学平台。
- 当前首要交付：完整实现“实验一：无人机配置与基础飞行操作”。
- 本文件适用于仓库根目录及其全部子目录；后续所有开发、修改、审查和验收均须遵守。

## 不可违背的运行约束

- 当前版本必须仅通过 `npm run dev` 即可完整体验实验一，不得要求启动或安装任何后端服务。
- 当前版本不得依赖 Gazebo、ArduPilot SITL、MAVLink Gateway 或 FastAPI 才能运行核心流程。
- 所有后端能力当前均由 Mock Service 与 Mock Drone Simulator 在前端模拟，包括异步过程、状态变化、遥测、异常和实验结果。
- 默认数据源必须为 `mock`。未设置 `VITE_DATA_SOURCE` 时，应用必须正常进入 Mock 模式。
- 支持 `VITE_DATA_SOURCE=mock`；为未来的 `VITE_DATA_SOURCE=api` 保留可替换实现。
- React 页面和组件不得感知、判断或分支处理当前数据源是 `mock` 还是 `api`。数据源选择只允许在 Service Registry / Composition Root 中完成。
- 不得为了当前功能引入隐藏的远程依赖；Mock 模式下核心实验流程应在无后端环境中独立工作。

## 长期架构边界

未来真实链路为：

```text
React
  -> FastAPI / MAVLink Gateway
  -> MAVLink
  -> ArduPilot SITL
  -> Gazebo
```

代码必须遵循以下依赖方向：

```text
Page / Component
  -> Zustand Store / domain Hook
  -> Service Interface
  -> Mock Implementation 或 API Implementation
```

- UI Component 永远不得直接使用 `fetch`、`axios`、`WebSocket` 或 MAVLink。
- 页面不得绕过 Store / Hook 直接耦合具体的 Mock 或 API Service 实现。
- 网络访问只允许位于 `src/services/` 下的 API / transport 实现中，并通过接口暴露能力。
- Mock 实现和 API 实现必须满足同一 Service Interface，返回相同领域类型并保持等价语义。
- 浏览器未来也不处理 MAVLink 二进制协议。MAVLink 编解码、连接与协议细节归后端 Gateway；浏览器仅通过 HTTP REST 与 WebSocket JSON 通信。
- 不得把 Mock 特有字段渗透到页面、通用组件或共享领域模型；确有必要时应在 Mock 实现内部适配。

## 工程技术栈与职责

固定使用：

- React
- TypeScript
- Vite
- React Router
- Zustand
- ECharts
- Lucide React

目录和职责约定：

- `src/pages/`：路由页面和页面级组合，不承载可复用组件细节或底层数据访问。
- `src/components/`：可复用、以展示和交互为主的组件。
- `src/layouts/`：跨页面布局结构。
- `src/stores/`：前端应用状态、动作编排，以及 Service 与 UI 之间的状态桥接。
- `src/services/contracts.ts`：外部能力接口的统一定义。
- `src/services/mock/`：Mock Service 与 Mock Drone Simulator。
- `src/services/api/`、`src/services/http/`、`src/services/websocket/`：未来真实 Gateway 的 API 与传输实现。
- `src/services/serviceRegistry.ts`：数据源选择和具体 Service 注入的唯一入口。
- `src/types/`：共享领域类型；已有类型应复用，不得在不同层重复定义等价类型。
- `src/mocks/`：静态 Mock 数据与场景配置；行为模拟应留在 Mock Service / Simulator。
- `src/styles/`：全局样式与设计 token。

工程纪律：

- TypeScript 必须保持 strict 模式；禁止使用显式或隐式 `any`，也不得用 `as any`、`@ts-ignore` 等方式掩盖类型问题。
- 优先通过准确的领域类型、联合类型、泛型、类型守卫和 `unknown` 收窄来解决类型问题。
- 不创建超大型 `App.tsx`；`App.tsx` 只保留应用入口级职责。
- 不在单一页面或组件中堆积所有状态、业务逻辑和展示代码；按职责拆分。
- 优先复用已有组件、类型、Store、Service contract、样式 token 和模拟器能力。
- 新增抽象前先搜索现有实现；禁止重复定义类型、重复创建功能或视觉相近的 UI Component。
- 不随意重构与当前任务无关的代码，不扩大修改范围。
- 新增依赖必须确有必要，并不得破坏纯前端 Mock 运行目标。

## 视觉实现规范

- `docs/reference/` 下的设计图是视觉标准，当前重点参考 `docs/reference/experiment1-flight-training.png`。
- 优先针对 `2048 x 1152` 桌面视口进行接近 1:1 的还原，同时避免较小桌面视口出现不可用的溢出或遮挡。
- 禁止将设计图本身直接用作页面 `<img>`、CSS `background-image`、Canvas 整图或其他截图铺底方案。
- 按钮、Panel、步骤条、状态、数据、图表、提示和控制区必须由真实 React DOM 与相应组件实现。
- 图标优先复用 Lucide React；数据图表使用 ECharts；不得用截图替代可交互 UI。
- 优先复用现有 CSS Modules、全局 token 与公共组件，保持间距、颜色、边框、层级和交互状态一致。
- 实现设计图时同时保留语义化结构、键盘可操作性、明确的按钮状态和必要的可访问性标签。

## 实验一行为要求

- 实验一的配置、检查、环境启动、基础飞行训练、遥测反馈、任务进度、评分与结果流程必须在 Mock 模式闭环可用。
- Mock Drone Simulator 应作为飞行状态演进的事实来源；不同面板不得各自伪造互相不一致的数据。
- 用户操作应通过 Store / Hook 调用 Service contract，再由模拟器产生状态和遥测更新。
- 模拟异步延迟或失败时必须可预测、可清理；订阅、定时器和连接在组件卸载或实验结束时必须释放。
- 未来接入 API 数据源时，不应要求重写页面组件；若需要修改，应优先完善接口和适配层。

## 每次任务的工作方式

1. 修改前先阅读与任务相关的页面、组件、Store、Service contract、类型和设计图，确认已有能力。
2. 以最小且完整的变更实现需求，保持上述分层与依赖方向。
3. 修改后检查 Mock 模式仍可仅通过 `npm run dev` 使用完整实验一。
4. 必须依次运行并通过：

   ```bash
   npm run typecheck
   npm run build
   ```

5. 若项目存在测试脚本或任务新增了测试，则还必须运行并通过：

   ```bash
   npm test
   ```

6. 若任何检查失败，必须修复由本次变更引起或阻碍交付的错误后再结束任务；不得以忽略错误、降低严格度或删除测试规避。
7. 交付说明应简要列出实际修改、验证命令与结果，以及仍存在的明确限制（如有）。

## 完成定义

只有同时满足以下条件，任务才可视为完成：

- 功能在默认 Mock 数据源下无需后端即可运行。
- UI 未绕过 Store / Hook 与 Service Interface 的边界。
- 页面未耦合具体 Mock / API 实现或 MAVLink 协议。
- 视觉实现由真实 DOM 和组件构成，并符合参考图方向。
- 未引入 `any`、重复类型、重复组件或无关重构。
- `npm run typecheck` 与 `npm run build` 通过；存在测试时测试也通过。
