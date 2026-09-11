# MUVA 无人机教学实验平台

当前仓库包含已经联通的“实验一：无人机配置与基础飞行操作”：

- React / TypeScript 教学前端
- FastAPI MAVLink 网关
- ArduPilot SITL 与 Gazebo 启动脚本
- 实时遥测、基础飞行控制和航点任务接口

## 目录

- `gazebo/gazebo`：当前正式前端
- `mavlink-gateway`：FastAPI / MAVLink 后端
- `patches`：本项目对上游 ArduPilot 和 ardupilot_gazebo 的定制
- `start_experiment1.sh`：实验一快捷启动
- `start_all_muva.sh`：完整服务启动器
- `stop_all_muva.sh`：完整服务停止器

## 第三方仿真依赖

为了避免在本仓库重复保存数 GB 的第三方源码和构建产物，ArduPilot 与
`ardupilot_gazebo` 不直接提交。当前验证过的版本为：

- ArduPilot：`63ac2d68f2296252d1aeda58a10c219da7edcc7b`
- ardupilot_gazebo：`082a0fe231f6e63bc8d1598f1cba461d9e2ea7f5`

在仓库根目录恢复依赖：

```bash
git clone https://github.com/ArduPilot/ardupilot.git
git -C ardupilot checkout 63ac2d68f2296252d1aeda58a10c219da7edcc7b
git -C ardupilot submodule update --init --recursive

git clone https://github.com/ArduPilot/ardupilot_gazebo.git
git -C ardupilot_gazebo checkout 082a0fe231f6e63bc8d1598f1cba461d9e2ea7f5

git -C ardupilot apply ../patches/ardupilot-gazebo-iris-parameters.patch
git -C ardupilot_gazebo apply ../patches/ardupilot-gazebo-runway-location.patch
```

随后按照两个上游项目的文档完成 SITL 和 Gazebo 插件构建。

## 启动实验一

安装前端依赖：

```bash
cd gazebo/gazebo
npm install
cd ../..
```

启动完整实验平台并直接进入实验一：

```bash
./start_experiment1.sh
```

停止整套服务：

```bash
./stop_all_muva.sh
```

平台默认地址：

- 前端：`http://127.0.0.1:5173`
- 实验一：`http://127.0.0.1:5173/experiments/basic-flight`
- 后端：`http://127.0.0.1:8000`

