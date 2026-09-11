# MUVA V1 Smoke Test Plan

当前仓库未配置 Playwright/Cypress 测试运行器，因此本文件作为交付前的手工 Smoke Test 清单。执行前运行 `npm run dev`，默认使用 Mock 数据源。

## 主流程

1. 打开 `/`，确认自动进入平台总览；未登录时访问 `/dashboard` 应跳转 `/login`。
2. 登录后进入实验中心，打开实验一。
3. Step 1 选择无人机，依次完成参数配置、场景配置。
4. 启动仿真环境，确认 Gazebo、SITL、MAVLink Gateway 和 Vehicle 依次进入就绪状态。
5. 执行传感器检查和起飞前检查，确认未满足前置条件时不能进入下一步。
6. 进入基础飞行训练，验证 ARM、TAKEOFF、HOLD、MOVE、RTL、LAND 产生状态和遥测变化；LAND 与重置实验必须二次确认。
7. 完成训练并打开实验结果，确认成绩、事件和遥测摘要存在。
8. 打开实验记录、数据分析和实验报告，确认它们引用同一实验 Session。
9. 通过顶部用户菜单退出登录，再访问 `/dashboard`、`/flight`、`/records`，确认统一跳转 `/login`。

## 异常流程

- 停止仿真环境后，飞行控制按钮锁定，遥测面板显示“等待数据”或“Telemetry Lost”，不保留旧采样。
- 向 WebSocket 发送缺少 Envelope 或 payload 字段的消息，确认被拒绝并记录错误，不进入遥测 Store。
- 在未启动环境、未通过检查或无 GPS/EKF 时尝试 ARM/TAKEOFF，确认 Service 返回安全校验错误。
- 在所有 Modal 中使用 Tab、Shift+Tab 和 Escape，确认焦点不会逃逸到背景页面。
