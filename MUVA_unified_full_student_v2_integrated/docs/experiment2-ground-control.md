# 实验二：地图优先地面控制台

> 当前实现：步骤2只确认区域；步骤3生成 → 检查 → Mock 下发逐机回执 → 确认，预检查通过才等待起飞。由绘制顶点计算最小面积外接矩形，沿矩形长边生成蛇形扫描。进出分区畅通时直达，受阻时绕过禁飞缓冲或其他无人机等待点；默认显示全部航线编号。完整 Home 入场/扫描/返航路径和编号均由任务数据渲染。文末旧验证记录仅供历史追溯。

## 2026-10-12：最小矩形覆盖与全部编号

- 新增共享最小面积外接矩形计算，保持原绘制多边形不变；分区、扫描方向、几何检查、面积校验和地图范围使用一致的矩形模型。
- 普通区域生成规则蛇形；禁飞缓冲会切分扫描单元。旋转区域仍检查实际 ENU 训练边界、完整航段安全间距与禁飞避让。
- 默认显示所有 UAV 编号，仍可关闭编号或只看所选航线。展示绘制面积、外接矩形面积和扣除禁飞缓冲后的可飞覆盖面积；飞行和结果页按可飞覆盖面积显示估算进度。
- 保留已有进度和历史任务，旧任务须在步骤3重新生成/重新分配后才采用新规划方式。
- 验证：类型检查与构建通过，129 项自动测试通过（实验二 55 项）；25 个规划浏览器场景及独立最小矩形/三机编号/直达绕障下发流程通过。实验一的刷新选择、恢复、取消与确认重新开始另行通过浏览器验证。截图和日志位于 `/tmp/muva-swarm-route-review/` 与 `/tmp/muva-swarm-planning/`；仅测试独立 Mock，不控制真实无人机或 SITL。

## 范围与入口

只优化学生端已有 `/experiments/swarm` 路由，不新增独立页面，不修改实验一、实验三、公共导航、Header 或其他角色页面。不增加依赖。实验二六阶段及原有协同起飞、暂停、返航、评分和记录能力继续保留。

操作流程：入口选择开始新实验 / 继续上次进度 → 步骤1机群配置 → 步骤2自主绘制区域、禁飞区与规划 Home → 确认区域进入步骤3 → 生成/重新分配航线 → 检查航线 → 下发航线（全部 UAV 回执成功）→ 确认进入预检查 → 自动检查通过 → 等待起飞。步骤2不生成航线，也不以已有航线为下一步的前置条件。入口不会自动恢复旧地图或推进飞行。

六阶段统一采用约 **20% / 60% / 20%** 的配置、地图、状态三列；结果阶段将评分与概览放左侧、报告放右侧，轨迹回放占据中央整列。预检查的进入飞行按钮移到底栏，避免挤占地图。较低屏幕可纵向滚动，不压缩地图为小预览。

## 地图与影像清晰度

- 复用实验二 `SwarmMap` 和既有 MapLibre GL，底图直接复用 `geographicMapStyle()` 的 Esri World Imagery 配置，未修改共享地图代码。
- 真实地理瓦片随缩放和平移请求，不使用静态图片、设计截图或生成背景。
- 新实验的校园中心为 WGS84 `[116.3268, 40.0098]`；旧草稿没有 `sceneOrigin` 时继续使用原 `[108.8289653, 34.1251589]`，不会将已有任务直接搬到新坐标。
- 每个实验的 ENU 换算、区域面积、无人机位置、航程和 Mock 插值都由同一个场景中心计算。
- 最大缩放级别 19，不进行超出既有源级别的强制放大；真实清晰度仍取决于该位置的原始影像，不能通过 CSS 滤镜恢复原图不存在的细节。
- 保留影像来源署名、比例尺、缩放控件、指南针、回到任务区域和加载状态。卫星影像需要联网；加载失败明确提示并提供重试，任务规划本身不需要后端。

## 绘制与智能覆盖航线

1. **绘制区域**：默认单击逐点设定多边形顶点，从第二个点开始连续显示边界，并预览鼠标到下一点的连线。最后双击完成并自动闭合（至少三个不同顶点），绘制期间双击不会缩放地图或重复加入最后一点；仍保留完成绘制按钮和地图聚焦时 Enter 的替代操作。Esc 或右键取消。更多工具保留两角点快速矩形、移动顶点、删除顶点和单独重置区域。
2. **区域校验**：保留原有自交、面积和中心 500 m 范围检查。无效绘制不会删除之前的合法区域。保存闭合边界、面积、周长、包围盒和按多边形面积计算的 WGS84 中心；旧无中心字段的区域预览时补算，编辑后重新计算。
3. **分区**：仅在步骤3点击生成航线成功后显示 A–F；此前只显示任务外边界。从绘制顶点的凸包枚举边方向，计算最小面积外接矩形，沿矩形长边扫描。按扣除禁飞缓冲区后的可飞面积积分与二分确定分区边界，2–6 架获得独立矩形作业带。保留青色原绘制边界，黄色虚线显示外接矩形；地图适配包括矩形全部顶点和完整航线。
4. **覆盖**：基于外接矩形生成等长、平行、往返的蛇形扫描线，不再沿原多边形的斜边或凹口裁剪。外接矩形包含原绘制范围以外区域，页面明确说明扩展范围；禁飞区仍不可进入。扫描区间受禁飞缓冲分裂/合并时划为扫描单元，同一单元矩形往返，避免每一行都跨越障碍。行间距不超过配置值，分区边界各留半个安全间距。
5. **连接与入口**：行间衔接先尝试分区内部的安全直线；受阻时使用欧氏距离可见图绕过禁飞缓冲，且不得切穿已保留扫描线。区内不可连通时，只允许同一安全作业带内衔接，不计为扫描覆盖。扫描单元的四种方向按可达入场、衔接和最终返航成本选择，不只取最近入场点。入场/返航不把其他 UAV 的静态扫描线当作永久障碍；畅通时两点直达，受阻时绕行，使用实际服务位置/返航点并保存执行路径，不仅在地图上画一条假直线。地图默认显示全部 UAV 完整路径，虚线区分入场/返航；可切换仅所选航线。步骤3默认显示全部 UAV 的完整路径编号，支持仅所选编号或关闭。相同坐标的不同序号合并显示，各航线分别编号并使用对应颜色，Home 标注错位避免遮挡 UAV。
6. **禁飞区**：可绘制多个红色禁飞区。区域包含/相交禁飞区不再一律报错；使用禁飞多边形的 ENU 轴对齐外接矩形加 `safety / 2` 缓冲保守避让。旋转扫描坐标时变换缓冲矩形的全部四个顶点，再取扫描坐标包络；扫描避让可能更保守，但不会缩小安全缓冲。入场/返航仍使用原 ENU 障碍包络，不将旋转坐标的 ±500 m 当作实际训练边界。覆盖、连接、入场、正常/提前返航都避让；服务位置在缓冲区内、任务被完全覆盖或安全通道不可达时明确拒绝规划。
7. **模拟下发与调度**：`loadMission` 只缓存当前候选计划并清除旧回执，不代表已下发。步骤3显式检查任务匹配、完整路径、航程/时间、分区/扫描、禁飞/几何、安全间距；通过后由 Store 调用 `SwarmService.uploadMission(missions, planId)` 异步获取逐机接收回执。全部回执对应同一计划版本且航点数匹配，才能确认进入预检查。预检查通过后服务 `markReady` 才进入等待起飞，`takeoff` 同样校验接收结果。Mock 按机群顺序逐机入场，全部到达后并行扫描，全部覆盖结束后逐机返航。转场与扫描不同时执行；规划转场还避让其他 UAV 当时的等待位置（以安全间距矩形保守包络），完整覆盖连接按线段最小距离检查跨机间距。提前返航优先，其他运动等待，并按当前无人机位置重新绕障。预计时间包含入场、覆盖、返航的队列等待和升降时间，不是单纯航程除以速度。没有 Gazebo、ArduPilot、MAVLink 或真实后端下发。

这是教学 Mock 规划，不是生产级自动避障或动态碰撞证明。绘制边界可为三角形、旋转矩形、凹形等；实际覆盖任务是其最小面积外接矩形，扫描线沿矩形长边，行间衔接与入场/返航不必沿 ENU 轴正交。可见图在保守矩形障碍及候选顶点上寻找最短安全路径，多个扫描单元仍采用贪心排序，不宣称全局最优或精确最短飞行时间。严重狭窄、被障碍分隔而无法安全连通的分区会拒绝规划，不宣称任意几何在任意安全参数下都可达。禁飞区及缓冲区不计入可覆盖面积。航段完成率不等同于真实相机覆盖率（没有接入相机视场/传感器幅宽），不宣称“所有形状 100% 无盲区”。

## 组件与数据流

已有 `AreaPlanningStep`、`TaskConfiguration`、`FleetStatus` 和 `SwarmMap` 继续复用 `PanelShell`、Lucide、CSS Modules 和 MUVA token。只将原步骤3的局部 `MissionStep` 拆成实验二内的 `MissionPlanningStep`，没有新增独立页面、公共组件或 UI 框架。左侧任务参数、中间大地图、右侧逐机状态和下方状态流程保持原三列结构。

```text
AreaPlanningStep / MissionPlanningStep / SwarmMap 用户操作
  → useSwarmStore 动作
  → swarmPlanning / swarmRouting / swarmGeometry / swarmMissionWorkflow 几何、路径、检查
  → SwarmService 接口（既有 Composition Root 提供 MockSwarmRuntime）
  → snapshot 更新 Store
  → 地图、任务概览、无人机卡片从同一 run 渲染
```

- `run.area` 保存任务外边界；`missions[].assignedPolygon` 是本次计划按可飞面积生成的分区，地图直接使用该计划结果，不按旧算法重新计算分区。
- `missions[].entryPath/returnPath` 保存真实入场/返航路径；`waypoints` 包含入场连接及扫描连接；`coverageStartIndex/coverageWaypointIndices` 区分转场和真实扫描终点。`routingObstacles` 保存同一计划的 ENU 禁飞缓冲包络，提前返航用相同路由器避让。
- `snapshot.drones[].returnWaypoints` 保存剩余返航航点，离开/刷新恢复不丢失绕障返航进度；旧无该字段的返航快照恢复时补算路径。
- `run.delivery` 保存唯一 `planId`、五阶段状态、检查项、时间和逐机回执。`snapshot.missionPlanId/missionReceipts` 为服务接收事实；Store/UI 和 Service 都核对当前版本，不能仅凭页面按钮或预检查标记解锁起飞。
- 重新生成、编辑/清除区域、调整禁飞区/Home、修改参数或重新初始化均清除旧检查/回执；下发中离开/重启/编辑取消异步请求，迟到回执不得写入新版本。刷新中断的下发恢复为“检查通过”，允许重新下发，不伪造接收成功。
- `run.planning.noFlyZones` 保存禁飞区，`run.config.homePosition` 保存规划参考 Home，`sceneOrigin` 保存场景坐标原点。设置规划 Home 不重置机群；真实位置和返航点始终取 `snapshot.drones[].position/homePosition`，Mock 初始编队仅由 Service 模拟，页面未收到快照前不显示预设无人机。
- `run.missions` 保存实际模拟下发的航点、航段、航程和任务颜色；`run.snapshot` 是电量、位置、飞行状态、执行覆盖率的唯一来源。
- Store 保存选中的 UAV 和聚焦版本，重复点击同一 UAV 也能重新定位。地图工具的未完成顶点是临时交互状态，完成后统一提交 Store。
- 使用既有 `muva-swarm-draft-v1` 本地存储；规划更改自动暂存，「保存规划」建立有时间戳的保存检查点。参数变化使机群与航线失效，重新初始化和生成后方可继续。
- 离开或 `pagehide` 时停止 Mock 时钟、保存完整快照、释放订阅；不再标记中断。返回/刷新先显示入口，用户选择继续后通过 `SwarmService.restore(config, missions, snapshot)` 恢复时间、位置、轨迹、电量、已完成航段、航点下标与阶段，恢复原状态（暂停仍暂停），不累加离开及等待选择期间的时间。旧版中断草稿也可恢复。
- Home 地理锚点保持小图标，图标偏移及引线让开 UAV；坐标移到地图固定信息栏，不用大标签覆盖无人机。
- 禁飞区与 Home 修改清除已确认航线和预检查，避免旧检查结果被误用。新建实验、离开页面和重新初始化清理服务订阅与定时器。
- 记录保存携带规划数据，回放可恢复禁飞区。未伪造 92% 电量、36 条航线或 98.5% 覆盖率；数值来自配置与实际 Mock 运行，未执行时覆盖率为 0%。

## 修改文件

| 文件 | 内容 |
| --- | --- |
| `src/pages/experiments/swarm/AreaPlanningStep.tsx` | 移除预设位置卡片，更新逐点绘制与 Home 提示 |
| `src/pages/experiments/swarm/SwarmMap.tsx` | 卫星底图、绘制工具、分区、禁飞区、Home、航线、安全圈和聚焦 |
| `src/pages/experiments/swarm/SwarmMap.module.css` | Home 锚点、偏移图标、引线与固定坐标栏 |
| `src/pages/experiments/swarm/SwarmExperimentPage.tsx` | 服务初始位置、页面自动恢复、卸载和 pagehide 保存，结果大地图 |
| `src/pages/experiments/swarm/Swarm.module.css` | 六阶段 20/60/20，紧凑侧栏与结果回放布局 |
| `src/stores/swarmStore.ts` | 服务快照规划与预检查、设置 Home 不移动机群、进度冻结与恢复 |
| `src/types/swarm.ts` | 增加兼容旧任务的覆盖终点索引，区分扫描与连接航点 |
| `src/domain/swarmCoverage.ts` | 凸包边方向最小面积外接矩形、扫描坐标与逆旋转 |
| `src/domain/swarmPlanning.ts` | 矩形均衡分区、蛇形扫描单元、禁飞裁剪及几何安全校验 |
| `src/domain/swarmRouting.ts` | 欧氏距离可见图最短安全连接与禁飞绕障；保留正交路由兼容，无新依赖 |
| `src/services/mock/MockSwarmRuntime.ts` | 服务初始位置、真实绕障返航、逐机转场及返航检查点恢复 |
| `src/services/swarmContract.ts` | 服务恢复接口 |
| `src/services/api/ApiSwarmService.ts` | 补齐恢复签名，保持真实 API 尚未接入的明确提示 |
| `tests/swarm.test.ts` | 几何、旋转矩形、去重、安全间距、禁飞区、Home、场景及生命周期测试 |
| `tests/swarm-planning-browser.cjs` | 实际鼠标绘制、持久化、定位、响应式和断网重试测试 |
| `docs/experiment2-ground-control.md` | 设计、数据流、验证与恢复说明 |
| `docs/ui-audit/experiment2/followup/` | 本轮各阶段、逐点绘制、断网验收截图与浏览器结果 |

## 备份与恢复

本轮跟进修改前已检查并保存 Git 状态，当前完整前端（包含全部未跟踪文件、现有可运行 `dist`、文档与测试）保存在 `/home/gazebo/muva-backups/experiment2-followup-20261011-100119/current-frontend.tar.gz`。配套 SHA256、工作区与索引补丁及 `RESTORE.txt` 均在该目录。无需再次复制依赖：完整仓库/依赖基线归档仍保留在下面的首轮目录。

仅恢复本轮前端时，先留存当前新增工作，再执行：

```bash
tar -xzf /home/gazebo/muva-backups/experiment2-followup-20261011-100119/current-frontend.tar.gz -C /home/gazebo/muva
```

本轮实际文件：`SwarmExperimentPage.tsx`、`Swarm.module.css`、`AreaPlanningStep.tsx`、`SwarmMap.tsx`、`SwarmMap.module.css`（均在 `src/pages/experiments/swarm/`）；`src/stores/swarmStore.ts`、`src/domain/swarmPlanning.ts`、`src/types/swarm.ts`、`src/services/swarmContract.ts`、`src/services/mock/MockSwarmRuntime.ts`、`src/services/api/ApiSwarmService.ts`、两份实验二测试、本文档及 `docs/ui-audit/experiment2/followup/`。其中 API 类只补齐接口签名，真实后端仍未接入。

修改前完整归档：`/home/gazebo/muva-backups/experiment2-20261011-000803/muva-full.tar.gz`（含 `.git`、已有未提交和未跟踪文件、依赖、源码与已有构建）。目录中有 Git 状态、HEAD、工作区补丁、归档文件清单、SHA256 校验和及 `RESTORE.txt`。

备份时已有 ArduPilot 进程正在写入 `mav.tlog` / `mav.tlog.raw`，tar 对这两个运行日志报告变化；源码与前端归档已通过目录解压验证。未停止或修改其他仿真服务。

修改前源码构建未通过，原因是实验二 Store 缺少 `runtime`、`bind`、`unsubscribe` 等绑定；保留错误日志 `baseline-build.log`。已有编译产物保存为 `pre-existing-dist`，已用独立 preview 浏览器验证登录、机群初始化和进入区域规划可运行，不能把原源码声明为构建通过版本。

不使用 `git reset --hard`。完整恢复时先停止前端，将当前仓库重命名保留，再从归档提取原仓库：

```bash
mv /home/gazebo/muva /home/gazebo/muva-before-restore
tar -xzf /home/gazebo/muva-backups/experiment2-20261011-000803/muva-full.tar.gz -C /home/gazebo
cd /home/gazebo/muva
./start_unified_frontend.sh
```

如只恢复本次修改文件，先将归档解压到单独暂存目录，再按上表逐个恢复原文件；本次新增文件归档中不存在，移到留存目录即可。浏览器规划存储与文件备份相互独立，不会被 `tar` 恢复。

直接运行修改前既有编译版本：

```bash
cd /home/gazebo/muva/MUVA_unified_full_student_v2_integrated
export PATH="/home/gazebo/muva/.tools/node/bin:$PATH"
node_modules/.bin/vite preview --host 127.0.0.1 --port 5194 \
  --outDir /home/gazebo/muva-backups/experiment2-20261011-000803/pre-existing-dist
```

## 验证命令

```bash
npm run typecheck
npm run build
npm test
```

浏览器测试不新增项目依赖。使用本机已有 Playwright 与 Chromium：

```bash
MUVA_TEST_URL=http://127.0.0.1:5193 \
PLAYWRIGHT_CORE_PATH=/home/gazebo/muva_copy/web-gcs/node_modules/playwright-core \
CHROMIUM_PATH=/home/gazebo/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome \
node tests/swarm-planning-browser.cjs
```

浏览器截图及结果由脚本保存到 `/tmp/muva-swarm-planning`（可用 `MUVA_SCREENSHOT_DIR` 指定目录）。由于浏览器脚本直接检查 Vite 领域状态，应在开发服务器运行；生产构建另由 `npm run build` 验证。

## 验证结果

- `npm run typecheck`：通过。
- `npm run build`：通过；保留项目原有大 bundle 提示，没有为本次 UI 优化进行无关打包重构。
- `npm test`：96 项通过（主套件 78 项，实验一地图回归 18 项），其中实验二 23 项覆盖旋转矩形、凹形连接、服务初始位置及五种飞行阶段完整恢复。
- 浏览器测试：14 场景通过，包括逐点闭合区域、两点连续边界预览、禁飞区、设置 Home 不移动机群且不遮挡 UAV、航线生成、定位、保存与预检查，以及离开自动冻结、返回续飞、刷新和暂停状态保留。
- 1440 × 900 / 1920 × 1080：地图为三列核心，1440 三列宽约 227.6 / 682.8 / 227.6 px，没有页面横向溢出，三架卡片完整显示。
- 禁飞冲突被阻止；删除冲突区后重新规划成功。断开卫星瓦片请求时明确提示，Mock 规划仍可使用；重试后底图与图层恢复。
- 步骤 1、3、4、5、6 的中央地图均通过宽度占比大于 55%、高度大于 400 px 以及无横向溢出的断言。预检查地图不再被独立控制卡片压缩。
- 验收浏览器没有未捕获异常；成功收到真实卫星瓦片响应，未用静态图片替代。
- 本轮结果与截图：`docs/ui-audit/experiment2/followup/results.json` 和同目录各阶段截图；首轮截图仍保留。

## 历史：2026-10-11 绘制时序与进度入口修正

- 原因：地图在 `run.area` 存在时立即派生全部 A/B/C 分区；页面又自动进入旧草稿，因此用户看不到继续或重启的选择。不是地图自动读取了新的区域。
- 新实验以空白区域开始，教学示例只能手动载入。用户逐点绘制并闭合后只显示任务外边界、面积；分区、扫描线、航点和 UAV 分配任务仅在明确生成后显示。当时在步骤2生成且未生成禁用下一步的逻辑，已由本轮修正为“步骤2确认区域 → 步骤3生成航线”。
- 再次绘制或编辑时暂时隐藏旧航线及分区，不删除旧有效规划；取消绘制恢复旧图层，提交新区域则清除旧任务，必须重新生成。
- 返回/刷新首先展示「继续上次进度」「重新开始实验」，不在入口等待期间推进飞行。实验内顶部常驻「保留进度并返回」「重新开始实验」。继续会恢复同一实验 ID、阶段和完整快照。
- 重新开始先将旧未完成 `SwarmRun` 归档至 `muva-swarm-saved-drafts-v1`，新任务不携带旧区域、禁飞区、Home、机群或航线。入口的「已保留的实验进度」列表可跨刷新恢复旧任务；切换进度时也保留当前草稿。既有 `muva-swarm-records-v1` 结果记录不删除。
- 取消重新开始不修改数据；若浏览器存储不可用或空间不足，拒绝开启新任务，避免丢失旧进度。保存仍只在当前浏览器本地，不是后端或跨设备同步。

本轮修改 7 个文件：`src/pages/experiments/swarm/SwarmMap.tsx`、`src/pages/experiments/swarm/AreaPlanningStep.tsx`、`src/pages/experiments/swarm/SwarmExperimentPage.tsx`、`src/pages/experiments/swarm/Swarm.module.css`、`src/stores/swarmStore.ts`、`tests/swarm-planning-browser.cjs` 和本文档；没有新增独立页面或公共组件。页面 → Zustand 动作 → Service 快照的数据流不变。

本轮完整前端备份（含未跟踪文件和修改前可运行 dist）：`/home/gazebo/muva-backups/experiment2-controls-20261011-110256/current-frontend.tar.gz`，配套 `RESTORE.txt`、Git 状态/补丁、SHA256 和验证日志。恢复前留存后续改动，再将归档解压至 `/home/gazebo/muva`，无需 reset 或删除已有功能。

验证：`npm run typecheck`、`npm run build` 通过；`npm test` 96 项通过；浏览器 18 场景通过、0 未捕获异常。新增断言覆盖空白新实验、未生成时无分区、重绘隐藏/取消恢复、重启保留、历史进度跨刷新恢复、入口等待冻结、取消及存储失败保护、结果记录不删除。构建仍有既有大包提醒。

截图和结果：`docs/ui-audit/experiment2/controls/`，含 `drawn-before-generation.png`、`continue-or-restart.png`、各阶段截图及 `results.json`。本轮浏览器成功收到 236 个真实卫星瓦片响应。

### 双击完成绘制

单击添加边界顶点，最后双击完成并自动闭合，不再单击首点立即结束。双击产生的第二次 click 不加入顶点，事件即时同步草稿避免快速点击丢点；绘制时阻止双击缩放，少于三个顶点不能完成。保留完成绘制按钮、Enter 和取消操作。类型检查、构建及 96 项回归通过；19 个浏览器场景通过，包括最后一点双击、顶点去重、自动闭合与不足三点时不缩放/不完成。新增验证日志和结果保存在 `/home/gazebo/muva-backups/experiment2-doubleclick-20261011-113943/`；该目录包含修改前完整前端归档与恢复说明。

## 2026-10-11：航线阶段与禁飞绕障升级

本轮修改文件（与本轮开始前快照比较，保留更早的用户改动）：

- `src/domain/swarmPlanning.ts`：正交扫描、可飞面积均衡分区、扫描单元、真实路径及几何校验。
- `src/domain/swarmRouting.ts`：新增轻量网格 A* 正交路由模块，无依赖变更。
- `src/types/swarm.ts`：向后兼容的任务路径与返航剩余航点字段。
- `src/stores/swarmStore.ts`：只在步骤3生成，传入禁飞区，预检查复核真实几何。
- `src/services/mock/MockSwarmRuntime.ts`：逐机入场/返航，实际执行绕障路径，保存剩余返航航点。
- `src/pages/experiments/swarm/AreaPlanningStep.tsx`：移除生成按钮和下一步的航线前置条件。
- `src/pages/experiments/swarm/SwarmExperimentPage.tsx`：步骤3说明、实际服务起降点间距与禁飞校验结果。
- `src/pages/experiments/swarm/SwarmMap.tsx`：直接渲染实际分区、扫描和所选 UAV 的真实转场；去掉虚构斜向 Home 连线。
- `tests/swarm.test.ts`：31 项实验二测试，新增三角形/凹形/多禁飞区、正交性、交叉检查、正常/提前返航实际轨迹和返航检查点恢复。
- `tests/swarm-planning-browser.cjs`：步骤2→3生成流程、全部既有绘制/布局/存储验收，以及三角形内部禁飞区绕行。
- 本文档和 `docs/ui-audit/experiment2/planner/`：修改、数据流、验证结果和界面截图。

没有新增 UI 组件或页面；复用原 `AreaPlanningStep`、`SwarmMap`、`MissionStep`、Zustand、MapLibre 和 MUVA UI。六阶段地图优先三列布局不变。对本轮备份逐文件比较：实验一、实验三、其他角色、共享导航和依赖文件均未修改。

验证：`npm run typecheck`、`npm run build` 通过；`npm test` 全部 **104 项**通过（主测试 86 + 地图测试 18，其中实验二 31）。浏览器 **20 个场景**通过，0 未捕获异常，收到 502 个卫星瓦片成功响应。截图包括 `triangle-no-fly-stage3.png`、`stage-3.png`、`drawn-before-generation.png`，结果见同目录 `results.json`。构建仅有既有单包大于 500 kB 的提醒。

修改前前端完整备份（包含已有未提交/未跟踪源码和可运行 dist，排除重复的依赖与 Git）：`/home/gazebo/muva-backups/experiment2-planner-20261011-114746/current-frontend.tar.gz`，SHA256 校验通过。同目录 `RESTORE.txt` 记录独立解压恢复方法；`verified-dist/` 和日志保存本轮验证通过版本。原完整整仓基线仍保留于 `/home/gazebo/muva-backups/experiment2-20261011-000803/muva-full.tar.gz`。恢复应先留存后续工作，再独立解压比较，不使用 `git reset --hard`。
