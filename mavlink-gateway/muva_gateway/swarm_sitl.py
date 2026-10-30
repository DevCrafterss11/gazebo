from __future__ import annotations

import copy
from concurrent.futures import ThreadPoolExecutor
import math
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import uuid
import xml.etree.ElementTree as ET
from collections import deque
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pymavlink import mavutil

from .commands import CommandService, CommandRejectedError, CommandTimeoutError, InvalidCommandError
from .config import Settings
from .missions import MissionService
from .state import VehicleState
from .swarm_console import FlightConsole
from .transport import MavlinkTransport


class SwarmVehicleState(VehicleState):
    def __init__(self, heartbeat_timeout: float = 3.0, console: FlightConsole | None = None) -> None:
        super().__init__(heartbeat_timeout)
        self._position_estimate_at = 0.0
        self._position_estimate_valid = False
        self.console = console

    def handle_message(self, message: Any) -> None:
        if message.get_type() == "EKF_STATUS_REPORT":
            with self._condition:
                if self.target[0] and message.get_srcSystem() != self.target[0]:
                    return
                self._position_estimate_valid = bool(int(message.flags) & mavutil.mavlink.ESTIMATOR_POS_HORIZ_ABS)
                self._position_estimate_at = time.monotonic()
        if message.get_type() == "PARAM_VALUE":
            with self._condition:
                if self.target[0] and message.get_srcSystem() != self.target[0]:
                    return
                generation = self._protocol_generation.get("PARAM_VALUE", 0) + 1
                self._protocol_generation["PARAM_VALUE"] = generation
                self._protocol_history.setdefault("PARAM_VALUE", deque(maxlen=64)).append((generation, message))
                self._condition.notify_all()
        super().handle_message(message)
        if self.console and (not self.target[0] or message.get_srcSystem() == self.target[0]):
            message_type = message.get_type()
            if message_type == "COMMAND_ACK":
                result = mavutil.mavlink.enums.get("MAV_RESULT", {}).get(int(message.result))
                self.console.record("RX", f"COMMAND_ACK cmd={message.command} result={result.name if result else message.result}")
            elif message_type == "MISSION_ACK":
                result = mavutil.mavlink.enums.get("MAV_MISSION_RESULT", {}).get(int(message.type))
                self.console.record("RX", f"MISSION_ACK result={result.name if result else message.type}")
            elif message_type == "STATUSTEXT":
                text = message.text.decode(errors="replace") if isinstance(message.text, bytes) else str(message.text)
                self.console.record("RX", f"STATUSTEXT {text.rstrip(chr(0))}")
            elif message_type == "MISSION_ITEM_REACHED":
                self.console.record("RX", f"MISSION_ITEM_REACHED seq={message.seq}")

    def set_transport_connected(self, connected: bool) -> None:
        with self._condition:
            if not connected:
                self._position_estimate_valid = False
                self._position_estimate_at = 0.0
        super().set_transport_connected(connected)

    def position_ready(self) -> bool:
        with self._condition:
            return (self.is_online() and self._position_estimate_valid
                    and time.monotonic() - self._position_estimate_at < self._heartbeat_timeout * 2
                    and self._telemetry["gpsFixType"] >= 3)


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def metres(first: list[float], second: list[float]) -> float:
    return math.hypot((first[0] - second[0]) * 111320 * math.cos(math.radians(second[1])), (first[1] - second[1]) * 110540)


@dataclass
class SitlVehicle:
    drone_id: str
    sys_id: int
    endpoint: str
    process: subprocess.Popen[bytes]
    log_file: Any
    state: VehicleState
    transport: MavlinkTransport
    commands: CommandService
    missions: MissionService
    home: list[float]
    phase: str = "READY"
    waypoint_index: int = 0
    completed: int = 0
    trajectory: list[list[float]] = field(default_factory=list)
    returning: list[list[float]] = field(default_factory=list)
    monitor_process: subprocess.Popen[bytes] | None = None
    console: FlightConsole | None = None


class SwarmSitlRuntime:
    def __init__(self, workspace: Path | None = None, state_dir: Path | None = None) -> None:
        self.workspace = workspace or Path(__file__).resolve().parents[2]
        self.binary = Path(os.getenv("MUVA_SWARM_SITL_BINARY", str(self.workspace / "ardupilot/build/sitl/bin/arducopter"))).resolve()
        self.state_dir = state_dir or Path(os.getenv("MUVA_SWARM_STATE_DIR", str(Path.home() / ".local/state/muva/experiment2")))
        self.base_port = int(os.getenv("MUVA_SWARM_SITL_BASE_PORT", "15760"))
        self.fdm_base_port = int(os.getenv("MUVA_SWARM_FDM_BASE_PORT", "9202"))
        self.gazebo: subprocess.Popen[bytes] | None = None
        self.world_path: Path | None = None
        self.world_name: str | None = None
        self.partition: str | None = None
        self._lock = threading.RLock()
        self._operation = threading.Lock()
        self._stop = threading.Event()
        self._cancel = threading.Event()
        self._worker: threading.Thread | None = None
        self.vehicles: list[SitlVehicle] = []
        self.config: dict[str, Any] = {}
        self.session_id: str | None = None
        self.status = "DRAFT"
        self.events: list[str] = []
        self.plan: list[dict[str, Any]] = []
        self.plan_id: str | None = None
        self.receipts: list[dict[str, Any]] = []
        self.started_at: float | None = None
        self.finished_at: float | None = None
        self.paused = False
        self.return_requested: set[str] = set()
        self.last_error: str | None = None
        self._returning = False
        self._monitor = threading.Thread(target=self._watch, name="experiment2-telemetry", daemon=True)
        self._monitor.start()

    def event(self, message: str) -> None:
        with self._lock:
            self.events = [*self.events[-199:], message]

    @staticmethod
    def _record(vehicle: SitlVehicle, kind: str, text: str) -> None:
        console = getattr(vehicle, "console", None)
        if console:
            console.record(kind, text)

    @staticmethod
    def validate_config(config: dict[str, Any]) -> None:
        limits = {"count": (2, 6), "altitude": (10, 120), "speed": (1, 20), "spacing": (3, 50), "safety": (3, 13)}
        for name, (lower, upper) in limits.items():
            value = config.get(name)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not lower <= value <= upper:
                raise InvalidCommandError(f"{name} 必须在 {lower}–{upper} 范围内")
        if config["count"] != int(config["count"]) or config["spacing"] < config["safety"]:
            raise InvalidCommandError("机数必须为整数，航线间距不能小于安全间距")
        if config["spacing"] < config["safety"] + 2:
            raise InvalidCommandError("SITL 实际轨迹需要2m跟踪余量；航线间距须至少为安全间距+2m")
        origin = config.get("sceneOrigin", [116.3268, 40.0098])
        if not isinstance(origin, list) or len(origin) != 2 or not all(isinstance(value, (int, float)) and math.isfinite(value) for value in origin) or not -180 <= origin[0] <= 180 or not -85 <= origin[1] <= 85:
            raise InvalidCommandError("场景坐标无效")

    def require_session(self, session_id: str) -> None:
        if not self.session_id or session_id != self.session_id:
            raise CommandRejectedError("机群会话已失效，请重新初始化；不会恢复本地伪造的飞行状态")

    def require_ground(self) -> None:
        if self._worker and self._worker.is_alive() or any(
            vehicle.state.vehicle_value("armed") or not vehicle.state.is_online() or vehicle.process.poll() is not None
            or vehicle.state.telemetry_value("altitude") >= .8
            for vehicle in self.vehicles
        ):
            raise CommandRejectedError("机群运行中、已解锁或飞控离线，无法确认落地；禁止重新配置、替换任务或关闭飞控")

    def shutdown(self, session_id: str) -> None:
        if not self._operation.acquire(blocking=False):
            raise CommandRejectedError("机群正在配置或下发，暂不能关闭飞控")
        try:
            if self.status in ("COMPLETED", "ABORTED") and self._worker and self._worker.is_alive():
                self._worker.join(timeout=2)
            with self._lock:
                if not self.session_id and session_id and not self.vehicles and not (self._worker and self._worker.is_alive()):
                    for index in range(6):
                        port = self.base_port + index * 20
                        with socket.socket() as probe:
                            try:
                                probe.bind(("127.0.0.1", port))
                            except OSError as error:
                                raise CommandRejectedError(f"实验二 SITL 端口 {port} 仍被占用；无法安全清理过期会话") from error
                    return
                self.require_session(session_id)
                self.require_ground()
                self._close_vehicles()
                self._stop_gazebo()
                self.session_id = None
        finally:
            self._operation.release()

    def abort_simulation(self, session_id: str, confirmed: bool) -> None:
        """Force-reclaim only processes owned by this isolated SITL runtime."""
        if not confirmed:
            raise CommandRejectedError("必须明确确认中止当前 Gazebo/SITL 仿真")
        if not self._operation.acquire(blocking=False):
            raise CommandRejectedError("机群正在初始化或关闭，请稍后重试")
        try:
            self.require_session(session_id)
            self._cancel.set()
            self.paused = False
            worker = self._worker
            if worker and worker.is_alive():
                worker.join(timeout=10)
                if worker.is_alive():
                    raise CommandRejectedError("调度线程仍未响应停止请求；仿真未回收，请稍后重试并保留当前页面")
            with self._lock:
                self.status = "ABORTED"
                self.finished_at = time.monotonic()
                self.last_error = "操作员确认中止 Gazebo/SITL 仿真；未确认飞行器已安全着陆"
                self.event(self.last_error)
            self._close_vehicles()
            self._stop_gazebo()
            self.session_id = None
            self._worker = None
        finally:
            self._operation.release()

    def initialize(self, config: dict[str, Any]) -> dict[str, Any]:
        if not self._operation.acquire(blocking=False):
            raise CommandRejectedError("机群正在配置或下发，请稍后重试")
        try:
            self.validate_config(config)
            self.require_ground()
            if not self.binary.is_file() or not os.access(self.binary, os.X_OK):
                raise InvalidCommandError(f"未找到 SITL 飞控可执行文件：{self.binary}；请先编译 ArduCopter SITL")
            self._validate_gazebo_install()
            self._close_vehicles()
            self._stop_gazebo()
            self.config = copy.deepcopy(config)
            self.config.update(simulationMode="sitl", sceneOrigin=config.get("sceneOrigin", [116.3268, 40.0098]))
            self.session_id = str(uuid.uuid4())
            self.plan = []
            self.plan_id = None
            self.receipts = []
            self.events = []
            self.status = "DRAFT"
            self.started_at = None
            self.finished_at = None
            self.last_error = None
            self._cancel.clear()
            self.return_requested.clear()
            self.paused = False
            self.state_dir.mkdir(parents=True, exist_ok=True)
            origin = self.config["sceneOrigin"]
            try:
                self._start_gazebo(int(config["count"]), origin)
                for index in range(int(config["count"])):
                    # Gazebo GPS already includes each model's world offset.
                    self.vehicles.append(self._launch(index, list(origin)))
                deadline = time.monotonic() + max(120, 30 * int(config["count"]))
                while time.monotonic() < deadline:
                    self._check_processes()
                    if all(vehicle.state.is_online() and vehicle.state.snapshot(vehicle.endpoint)["home"]["valid"]
                           and vehicle.state.position_ready() for vehicle in self.vehicles):
                        break
                    time.sleep(.2)
                else:
                    raise CommandTimeoutError("等待 Gazebo-backed SITL 心跳/GPS/EKF 位置估计超时，请查看实验二独立 Gazebo 与飞控日志")
                for vehicle in self.vehicles:
                    if vehicle.state.target[0] != vehicle.sys_id:
                        raise CommandRejectedError("飞控 SysID 与分配编号不匹配")
                    speed_parameter = self._find_parameter(vehicle, ("WP_SPD", "WPNAV_SPEED"))
                    radius_parameter = self._find_parameter(vehicle, ("WP_RADIUS_M", "WPNAV_RADIUS"))
                    self._parameter(vehicle, speed_parameter, config["speed"] if speed_parameter == "WP_SPD" else config["speed"] * 100)
                    self._parameter(vehicle, radius_parameter, .5 if radius_parameter == "WP_RADIUS_M" else 50)
                    raw_home = vehicle.state.snapshot(vehicle.endpoint)["home"]
                    vehicle.home = [raw_home["longitude"], raw_home["latitude"]]
                    vehicle.trajectory = [vehicle.home]
                    self._record(vehicle, "DONE", "心跳、GPS 和 EKF 位置估计已确认，飞控可用")
                self._open_monitors()
                self.event(f"实验二专用 Gazebo world 与 {len(self.vehicles)} 架 JSON SITL 已连接，心跳/GPS/EKF 和参数回读通过")
                return self.snapshot()
            except Exception:
                self._close_vehicles()
                self._stop_gazebo()
                self.session_id = None
                raise
        finally:
            self._operation.release()

    def _launch(self, index: int, home: list[float]) -> SitlVehicle:
        import socket
        port = self.base_port + index * 20
        with socket.socket() as probe:
            try:
                probe.bind(("127.0.0.1", port))
            except OSError as error:
                raise CommandRejectedError(f"实验二 SITL 端口 {port} 被占用；未终止其他程序") from error
        directory = self.state_dir / f"uav-{index + 1}"
        directory.mkdir(parents=True, exist_ok=True)
        try:
            console = FlightConsole(directory)
        except OSError as error:
            console = None
            self.event(f"UAV-{index + 1:02} 指令记录不可写：{error}；飞控继续启动")
        params = directory / "defaults.parm"
        params.write_text("FRAME_CLASS 1\nFRAME_TYPE 1\nSIM_SPEEDUP 1\nFS_GCS_ENABLE 0\nFS_THR_ENABLE 0\nRTL_ALT 0\nBATT_MONITOR 4\n")
        log_file = (directory / "sitl.log").open("ab")
        instance = 20 + index
        fdm_port = self.fdm_base_port + index * 10
        defaults_dir = self.workspace / "ardupilot/Tools/autotest/default_params"
        defaults = f"{defaults_dir / 'copter.parm'},{defaults_dir / 'gazebo-iris.parm'},{params}"
        process = subprocess.Popen([str(self.binary), "--model", "JSON", "--speedup", "1", "--rate", "800", "--wipe",
            "--defaults", defaults, "--base-port", str(port), "-I", str(instance), "--sysid", str(21 + index),
            "--sim-port-out", str(fdm_port), "--sim-address", "127.0.0.1",
            "--home", f"{home[1]},{home[0]},50,0", "--serial0", f"tcp:{port}"], cwd=directory,
            stdin=subprocess.DEVNULL, stdout=log_file, stderr=subprocess.STDOUT, start_new_session=True)
        settings = replace(Settings(), mavlink_endpoint=f"tcp:127.0.0.1:{port}", source_system=240,
                           takeoff_timeout=100, telemetry_rate_hz=5, command_timeout=8)
        state = SwarmVehicleState(settings.heartbeat_timeout, console)
        transport = MavlinkTransport(settings, state)
        operation = threading.RLock()

        def record_tx(message_type: str, _category: str, _severity: str, text: str, **_details: Any) -> None:
            if console:
                console.record("TX", f"{message_type} {text}")
        vehicle = SitlVehicle(f"UAV-{index + 1:02}", 21 + index, settings.mavlink_endpoint, process, log_file, state, transport,
                              CommandService(settings, state, transport, operation, record_tx),
                              MissionService(settings, state, transport, operation, record_tx), home, console=console)
        self._record(vehicle, "INFO", f"飞控启动 SysID={vehicle.sys_id}，等待心跳/GPS/EKF")
        transport.start()
        return vehicle

    @staticmethod
    def _find_parameter(vehicle: SitlVehicle, names: tuple[str, ...]) -> str:
        for name in names:
            generation = vehicle.state.protocol_generations(("PARAM_VALUE",))
            vehicle.transport.send(lambda connection: connection.mav.param_request_read_send(vehicle.sys_id, vehicle.state.target[1], name.encode(), -1))
            result = vehicle.state.wait_for_protocol(("PARAM_VALUE",), generation, 2,
                lambda message: str(message.param_id).rstrip("\x00") == name)
            if result:
                return name
        raise CommandRejectedError(f"{vehicle.drone_id} 飞控缺少受支持的速度/半径参数")

    @staticmethod
    def _parameter(vehicle: SitlVehicle, name: str, value: float) -> None:
        generation = vehicle.state.protocol_generations(("PARAM_VALUE",))
        vehicle.transport.send(lambda connection: connection.mav.param_set_send(vehicle.sys_id, vehicle.state.target[1], name.encode(), value, mavutil.mavlink.MAV_PARAM_TYPE_REAL32))
        result = vehicle.state.wait_for_protocol(("PARAM_VALUE",), generation, 8)
        deadline = time.monotonic() + 8
        while result:
            message = result[1]
            param_id = message.param_id.decode() if isinstance(message.param_id, bytes) else message.param_id
            if param_id.rstrip("\x00") == name:
                if abs(message.param_value - value) > .01:
                    raise CommandRejectedError(f"{vehicle.drone_id} {name} 回读不一致")
                return
            result = vehicle.state.wait_for_protocol(("PARAM_VALUE",), generation, max(0, deadline - time.monotonic()))
        raise CommandTimeoutError(f"{vehicle.drone_id} {name} 参数回读超时")

    def _check_processes(self) -> None:
        for vehicle in self.vehicles:
            if vehicle.process.poll() is not None:
                raise CommandRejectedError(f"{vehicle.drone_id} 飞控已退出，请查看 {self.state_dir}")

    def _open_monitors(self) -> None:
        if os.getenv("MUVA_SWARM_MONITOR_TERMINALS", "1").lower() in ("0", "false", "no"):
            return
        terminal = shutil.which("xterm") if os.getenv("DISPLAY") else None
        if not terminal:
            self.event("未检测到图形桌面或 xterm；可查看各机独立 commands.jsonl，飞控正常运行")
            return
        terminal_font = os.getenv("MUVA_SWARM_TERMINAL_FONT", "Noto Sans Mono CJK SC")
        terminal_font_size = os.getenv("MUVA_SWARM_TERMINAL_FONT_SIZE", "10")
        terminal_environment = {**os.environ, "LANG": "zh_CN.UTF-8", "LC_ALL": "zh_CN.UTF-8", "PYTHONIOENCODING": "UTF-8"}
        for index, vehicle in enumerate(self.vehicles):
            if not vehicle.console:
                continue
            try:
                with (self.state_dir / f"uav-{index + 1}" / "monitor.log").open("ab") as monitor_log:
                    vehicle.monitor_process = subprocess.Popen(
                        [terminal, "-u8", "-fa", terminal_font, "-fs", terminal_font_size,
                         "-title", f"实验二 {vehicle.drone_id} / SysID {vehicle.sys_id} 指令流水",
                         "-geometry", f"110x34+{40 + index * 80}+{40 + index * 70}",
                         "-e", sys.executable, "-u", "-m", "muva_gateway.swarm_console",
                         "--directory", str(self.state_dir / f"uav-{index + 1}"),
                         "--drone-id", vehicle.drone_id, "--sys-id", str(vehicle.sys_id)],
                        stdin=subprocess.DEVNULL, stdout=monitor_log, stderr=subprocess.STDOUT, env=terminal_environment,
                        start_new_session=True,
                    )
                time.sleep(.1)
                if vehicle.monitor_process.poll() is not None:
                    self.event(f"{vehicle.drone_id} 监控窗口未能保持打开，详见 monitor.log；飞控正常运行")
                    vehicle.monitor_process = None
                else:
                    self.event(f"{vehicle.drone_id} 只读飞控指令流水已打开；关闭窗口不影响飞行")
            except OSError as error:
                self.event(f"{vehicle.drone_id} 监控窗口打开失败：{error}；飞控正常运行，详见 commands.jsonl")

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            drones = []
            for vehicle in self.vehicles:
                raw = vehicle.state.snapshot(vehicle.endpoint)
                telemetry = raw["telemetry"]
                position = [telemetry.get("longitude", 0), telemetry.get("latitude", 0)]
                mission = next((mission for mission in self.plan if mission["droneId"] == vehicle.drone_id), None)
                total = len(mission["coverageSegments"]) if mission else 0
                drones.append({"droneId": vehicle.drone_id, "displayName": vehicle.drone_id, "modelType": "Iris", "sysId": vehicle.sys_id,
                    "homePosition": vehicle.home, "position": position, "targetAltitude": self.config.get("altitude", 0),
                    "cruiseSpeed": self.config.get("speed", 0), "altitude": telemetry["altitude"], "speed": telemetry["groundSpeed"],
                    "heading": telemetry["heading"], "battery": max(0, telemetry.get("battery", 0)), "state": vehicle.phase,
                    "waypointIndex": vehicle.waypoint_index, "progress": vehicle.completed / total * 100 if total else 0,
                    "trajectory": copy.deepcopy(vehicle.trajectory), "completedSegments": vehicle.completed,
                    "connected": raw["connection"]["connected"], "armed": raw["vehicle"]["armed"], "flightMode": raw["vehicle"]["mode"],
                    "gpsFixType": telemetry.get("gpsFixType", 0), "returnWaypoints": copy.deepcopy(vehicle.returning)})
            total = sum(len(mission["coverageSegments"]) for mission in self.plan)
            elapsed = ((self.finished_at or time.monotonic()) - self.started_at) if self.started_at else 0
            return {"status": self.status, "drones": drones, "elapsed": elapsed, "events": list(self.events),
                    "coverage": sum(vehicle.completed for vehicle in self.vehicles) / total * 100 if total else 0,
                    "missionPlanId": self.plan_id, "missionReceipts": copy.deepcopy(self.receipts),
                    "runtime": {"sessionId": self.session_id, "mode": "sitl", "label": "Gazebo · ArduPilot SITL", "connected": bool(drones) and all(drone["connected"] for drone in drones), "error": self.last_error}}

    def upload(self, missions: list[dict[str, Any]], plan_id: str) -> dict[str, Any]:
        if not self._operation.acquire(blocking=False):
            raise CommandRejectedError("机群操作忙")
        active_vehicle: SitlVehicle | None = None
        try:
            self.require_ground()
            self._validate_plan(missions)
            self.plan_id = None
            self.receipts = []
            self.plan = []
            for vehicle, mission in zip(self.vehicles, missions):
                active_vehicle = vehicle
                self._record(vehicle, "INFO", f"开始下发计划 {plan_id}，等待 MISSION_ACK 与任务回读")
                points = mission["waypoints"] + mission["returnPath"][1:]
                items = [{"command": "TAKEOFF", "longitude": vehicle.home[0], "latitude": vehicle.home[1], "altitude": self.config["altitude"]}]
                items.extend({"command": "WAYPOINT", "longitude": point[0], "latitude": point[1], "altitude": self.config["altitude"]} for point in points)
                items.append({"command": "LAND", "longitude": vehicle.home[0], "latitude": vehicle.home[1], "altitude": 0})
                result = vehicle.missions.upload(items, verify=True)
                if not result["accepted"] or not result["verified"]:
                    raise CommandRejectedError(f"{vehicle.drone_id} 任务回读失败")
                self._record(vehicle, "DONE", f"计划 {plan_id} 已经飞控 MISSION_ACK 接收，并完整回读校验通过")
                complete = [mission["entryPath"][0], *mission["waypoints"], *mission["returnPath"][1:]]
                count = sum(index == 0 or any(abs(point[axis] - complete[index - 1][axis]) > 1e-10 for axis in (0, 1)) for index, point in enumerate(complete))
                self.receipts.append({"planId": plan_id, "missionId": mission["missionId"], "droneId": vehicle.drone_id,
                    "status": "ACCEPTED", "waypointCount": count, "receivedAt": timestamp(), "message": "MAVLink MISSION_ACK 与完整任务回读一致"})
            self.plan = copy.deepcopy(missions)
            self.plan_id = plan_id
            self.status = "PLANNED"
            self.event("全部飞控任务上传/回读一致；后端 GUIDED 分阶段执行同一已验证路径")
            return self.snapshot()
        except Exception as error:
            if active_vehicle:
                self._record(active_vehicle, "ERROR", f"任务下发/回读未通过：{error}")
            self.receipts = []
            self.plan_id = None
            raise
        finally:
            self._operation.release()

    def _validate_plan(self, missions: list[dict[str, Any]]) -> None:
        from .swarm_routing import hits_box, timed_paths_violate_separation
        if len(missions) != len(self.vehicles) or [mission.get("droneId") for mission in missions] != [vehicle.drone_id for vehicle in self.vehicles]:
            raise InvalidCommandError("任务数量/编号与后端实际机群不匹配")
        origin = self.config["sceneOrigin"]
        local = lambda point: [(point[0] - origin[0]) * 111320 * math.cos(math.radians(origin[1])), (point[1] - origin[1]) * 110540]
        if any(not isinstance(mission.get("missionId"), str) or not mission["missionId"] for mission in missions) or len({mission["missionId"] for mission in missions}) != len(missions):
            raise InvalidCommandError("任务编号缺失或重复")
        execution_paths = []
        for vehicle, mission in zip(self.vehicles, missions):
            paths = [mission.get("waypoints", []), mission.get("entryPath", []), mission.get("returnPath", [])]
            if not paths[0] or len(paths[1]) < 1 or len(paths[2]) < 1 or not mission.get("coverageSegments"):
                raise InvalidCommandError("任务缺少覆盖、入场或返航路径")
            if not isinstance(mission.get("assignedArea"), (int, float)) or not math.isfinite(mission["assignedArea"]) or mission["assignedArea"] <= 0:
                raise InvalidCommandError("分区面积无效")
            for point in [point for path in paths for point in path]:
                if not isinstance(point, list) or len(point) != 2 or not all(isinstance(value, (int, float)) and math.isfinite(value) for value in point) or abs((point[0] - origin[0]) * 111320 * math.cos(math.radians(origin[1]))) > 500.001 or abs((point[1] - origin[1]) * 110540) > 500.001:
                    raise InvalidCommandError("任务含无效坐标或超出训练边界")
            start = mission.get("coverageStartIndex", 0)
            indices = mission.get("coverageWaypointIndices", [])
            if not isinstance(start, int) or not 0 <= start < len(paths[0]) or len(indices) != len(mission["coverageSegments"]) or any(not isinstance(index, int) or not start < index < len(paths[0]) for index in indices):
                raise InvalidCommandError("覆盖索引无效")
            if indices != sorted(set(indices)) or any(segment != [paths[0][index - 1], paths[0][index]] for segment, index in zip(mission["coverageSegments"], indices)):
                raise InvalidCommandError("覆盖航段与实际路径/索引不一致")
            if metres(paths[1][0], vehicle.home) > 2 or metres(paths[1][-1], paths[0][start]) > .1 or metres(paths[2][0], paths[0][-1]) > .1 or metres(paths[2][-1], vehicle.home) > 2:
                raise InvalidCommandError("任务入场/返航与实际服务 Home 不一致")
            if len(paths[0]) + len(paths[2]) + 1 > 198:
                raise InvalidCommandError("当前飞控任务最多支持198个路径点，请增大扫描间距")
            boxes = mission.get("routingObstacles", [])
            if not isinstance(boxes, list) or any(not isinstance(box, list) or len(box) != 4 or not all(isinstance(value, (int, float)) and math.isfinite(value) for value in box) or box[0] > box[2] or box[1] > box[3] for box in boxes):
                raise InvalidCommandError("禁飞缓冲数据无效")
            full = [local(point) for point in [vehicle.home, *paths[0], *paths[2][1:]]]
            if any(hits_box(first, second, box) for first, second in zip(full, full[1:]) for box in boxes):
                raise InvalidCommandError("任务穿越禁飞缓冲区")
            execution_paths.append([local(point) for point in [vehicle.home, *paths[0], *paths[2][1:]]])
        for index, path in enumerate(execution_paths):
            for other in execution_paths[index + 1:]:
                if timed_paths_violate_separation(path, 0, other, 0, self.config["safety"] + 2, self.config["speed"]):
                    raise InvalidCommandError("完整入场/覆盖/返航时间轨迹将触发安全间距；请调整分区、航线或机群速度后重新检查")

    def command(self, action: str, drone_id: str | None = None) -> dict[str, Any]:
        targets = [vehicle for vehicle in self.vehicles if drone_id is None or vehicle.drone_id == drone_id]
        for vehicle in targets:
            self._record(vehicle, "INFO", f"网关收到操作请求 {action}；等待飞控执行")
        try:
            result = self._command(action, drone_id)
        except Exception as error:
            for vehicle in targets:
                self._record(vehicle, "ERROR", f"操作请求 {action} 被拒绝：{error}")
            raise
        for vehicle in targets:
            self._record(vehicle, "INFO", f"调度器已接受 {action}；以飞控回复和状态确认为准")
        return result

    def _command(self, action: str, drone_id: str | None = None) -> dict[str, Any]:
        with self._lock:
            if action == "ready":
                if self.status not in ("PLANNED", "READY") or not self.plan_id or len(self.receipts) != len(self.vehicles):
                    raise CommandRejectedError("必须全部真实下发/回读通过后才能预备起飞")
                if not all(vehicle.state.is_online() for vehicle in self.vehicles):
                    raise CommandRejectedError("存在离线飞控，不能起飞")
                if not all(vehicle.state.position_ready() for vehicle in self.vehicles):
                    raise CommandRejectedError("飞控 EKF 绝对位置估计尚未就绪，不能解锁；请等待传感器稳定后重试")
                self.status = "READY"
            elif action == "takeoff":
                if self.status != "READY":
                    raise CommandRejectedError("必须预检查通过后才能起飞")
                if not all(vehicle.state.position_ready() for vehicle in self.vehicles):
                    raise CommandRejectedError("飞控 EKF 位置估计已丢失，请等待恢复后重新起飞")
                self._spawn(self._takeoff, "TAKING_OFF")
            elif action == "startMission":
                if self.status != "HOLDING":
                    raise CommandRejectedError("必须全部到达起飞高度后开始任务")
                self._spawn(self._execute, "RUNNING")
            elif action == "pauseMission":
                if self.status != "RUNNING":
                    raise CommandRejectedError("只有执行中的任务可以暂停")
                self.paused = True
                self.status = "PAUSED"
            elif action == "resumeMission":
                if self.status != "PAUSED":
                    raise CommandRejectedError("任务未暂停")
                self.paused = False
                self.status = "RUNNING"
            elif action in ("returnToHome", "returnDroneToHome"):
                if self.status not in ("RUNNING", "PAUSED", "HOLDING", "TAKING_OFF", "RETURNING", "FAILED"):
                    raise CommandRejectedError("机群未起飞，不能返航")
                if drone_id and drone_id not in [vehicle.drone_id for vehicle in self.vehicles]:
                    raise InvalidCommandError("无人机编号不存在")
                self.return_requested.update([drone_id] if drone_id else [vehicle.drone_id for vehicle in self.vehicles])
                self.paused = False
                if not self._worker or not self._worker.is_alive():
                    self._spawn(self._return_pending, "RETURNING")
            else:
                raise InvalidCommandError("不支持的机群命令")
            return self.snapshot()

    def _spawn(self, operation: Any, status: str) -> None:
        if self._worker and self._worker.is_alive():
            raise CommandRejectedError("机群调度正在运行")
        self.status = status
        self._worker = threading.Thread(target=self._run, args=(operation,), name="experiment2-flight", daemon=True)
        self._worker.start()

    def _run(self, operation: Any) -> None:
        try:
            operation()
        except Exception as error:
            self.last_error = str(error)
            self.event(f"飞控执行失败：{error}；尝试原地悬停，不伪造完成")
            self.status = "FAILED"
            for vehicle in self.vehicles:
                self._record(vehicle, "ERROR", f"机群调度失败：{error}；未确认的动作不计为完成")
                if vehicle.state.is_online() and vehicle.state.vehicle_value("armed"):
                    try:
                        vehicle.commands.set_mode("GUIDED")
                        self._target(vehicle, self._position(vehicle))
                    except Exception:
                        pass

    def _takeoff(self) -> None:
        self.started_at = time.monotonic()
        vehicles = [vehicle for vehicle in self.vehicles if not self.return_requested or self._returning]
        if not vehicles:
            return
        with ThreadPoolExecutor(max_workers=len(vehicles), thread_name_prefix="experiment2-takeoff") as pool:
            futures = [pool.submit(vehicle.commands.set_mode, "GUIDED") for vehicle in vehicles]
            for vehicle, future in zip(vehicles, futures):
                future.result()
                vehicle.phase = "TAKING_OFF"
                self._record(vehicle, "DONE", "飞控心跳确认 GUIDED 模式")

            futures = [pool.submit(vehicle.commands.arm, True) for vehicle in vehicles]
            for vehicle, future in zip(vehicles, futures):
                future.result()
                self._record(vehicle, "DONE", "飞控 ACK + 心跳确认解锁")

            futures = [pool.submit(vehicle.commands.takeoff, self.config["altitude"]) for vehicle in vehicles]
            for vehicle, future in zip(vehicles, futures):
                future.result()
                self._record(vehicle, "DONE", f"遥测确认起飞高度 {vehicle.state.telemetry_value('altitude'):.1f} m")
                vehicle.phase = "HOLDING"
        self.status = "HOLDING"
        self.event("全部飞控实际起飞高度确认，等待开始任务")
        if self.return_requested:
            self._return_pending()

    @staticmethod
    def _position(vehicle: SitlVehicle) -> list[float]:
        return [vehicle.state.telemetry_value("longitude"), vehicle.state.telemetry_value("latitude")]

    def _target(self, vehicle: SitlVehicle, point: list[float]) -> None:
        vehicle.transport.send(lambda connection: connection.mav.set_position_target_global_int_send(0, vehicle.sys_id, vehicle.state.target[1],
            mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT, 3576, round(point[1] * 1e7), round(point[0] * 1e7), self.config["altitude"], 0, 0, 0, 0, 0, 0, 0, 0))

    def _move_many(self, routes: dict[str, list[list[float]]], coverage: bool = False,
                   coverage_ranges: dict[str, tuple[int, int, int]] | None = None) -> None:
        cursors = {drone_id: 0 for drone_id in routes}
        deadlines: dict[str, float] = {}
        announced: dict[str, int] = {}
        held = False
        while any(cursors[drone_id] < len(path) for drone_id, path in routes.items()):
            if self._cancel.is_set():
                raise CommandRejectedError("后端调度已停止")
            self._check_motion()
            if self.return_requested and not self._returning:
                for vehicle in self.vehicles:
                    if vehicle.state.vehicle_value("armed"):
                        self._target(vehicle, self._position(vehicle))
                self._return_pending()
                deadlines.clear()
            if self.paused:
                if not held:
                    for vehicle in self.vehicles:
                        if vehicle.state.vehicle_value("armed"):
                            self._target(vehicle, self._position(vehicle))
                            vehicle.phase = "PAUSED"
                    held = True
                time.sleep(.2)
                deadlines.clear()
                continue
            held = False
            for vehicle in self.vehicles:
                path = routes.get(vehicle.drone_id, [])
                cursor = cursors.get(vehicle.drone_id, 0)
                if vehicle.phase == "LANDED":
                    cursors[vehicle.drone_id] = len(path)
                    continue
                if cursor >= len(path):
                    continue
                if not vehicle.state.is_online():
                    raise CommandRejectedError(f"{vehicle.drone_id} 飞控心跳中断")
                point = path[cursor]
                remaining = metres(self._position(vehicle), point)
                deadline = deadlines.setdefault(vehicle.drone_id, time.monotonic() + max(35, remaining / self.config["speed"] * 4 + 20))
                if time.monotonic() > deadline:
                    raise CommandTimeoutError(f"{vehicle.drone_id} 到达航点超时")
                coverage_range = (coverage_ranges or {}).get(vehicle.drone_id)
                vehicle.phase = "RETURNING" if self._returning or coverage_range and cursor > coverage_range[1] else "RUNNING"
                self._target(vehicle, point)
                if announced.get(vehicle.drone_id) != cursor:
                    self._record(vehicle, "TX", f"SET_POSITION_TARGET_GLOBAL_INT GUIDED 位置目标 {cursor + 1}/{len(path)}：{point[1]:.7f},{point[0]:.7f}；等待实际抵达")
                    announced[vehicle.drone_id] = cursor
                if remaining <= .55 and vehicle.state.telemetry_value("groundSpeed") < .65:
                    self._record(vehicle, "DONE", f"遥测确认目标 {cursor + 1}/{len(path)} 已抵达（误差 {remaining:.2f} m）")
                    cursors[vehicle.drone_id] += 1
                    deadlines.pop(vehicle.drone_id, None)
                    if coverage_range and coverage_range[0] <= cursor <= coverage_range[1]:
                        coverage_cursor = cursor - coverage_range[0]
                        vehicle.waypoint_index = coverage_range[2] + coverage_cursor + 1
                        mission = next(mission for mission in self.plan if mission["droneId"] == vehicle.drone_id)
                        vehicle.completed = sum(index <= vehicle.waypoint_index for index in mission["coverageWaypointIndices"])
                        if cursor == coverage_range[1]:
                            vehicle.phase = "RETURNING"
                            self.event(f"{vehicle.drone_id} 覆盖完成，立即开始返航")
                    elif coverage:
                        mission = next(mission for mission in self.plan if mission["droneId"] == vehicle.drone_id)
                        vehicle.waypoint_index = mission.get("coverageStartIndex", 0) + cursor + 1
                        vehicle.completed = sum(index <= vehicle.waypoint_index for index in mission["coverageWaypointIndices"])
                if cursors[vehicle.drone_id] >= len(path) and not self._returning:
                    vehicle.phase = "RETURNING" if coverage_range else "HOLDING"
            time.sleep(.2)

    def _execute(self) -> None:
        routes = {}
        coverage_ranges = {}
        for vehicle, mission in zip(self.vehicles, self.plan):
            if vehicle.phase == "LANDED":
                continue
            entry = mission["entryPath"][1:]
            start_index = mission.get("coverageStartIndex", 0)
            coverage = mission["waypoints"][start_index + 1:]
            returning = mission["returnPath"][1:]
            coverage_start = len(entry)
            routes[vehicle.drone_id] = [*entry, *coverage, *returning]
            coverage_ranges[vehicle.drone_id] = (coverage_start, coverage_start + len(coverage) - 1, start_index)
            vehicle.phase = "RUNNING"
            vehicle.returning = mission["returnPath"]
        self.event("各机独立执行入场、覆盖与返航；任一飞机完成覆盖即单独返航")
        self._move_many(routes, coverage_ranges=coverage_ranges)
        self.status = "RETURNING"
        active = [vehicle for vehicle in self.vehicles if vehicle.drone_id in routes]
        with ThreadPoolExecutor(max_workers=max(1, len(active)), thread_name_prefix="experiment2-land") as pool:
            futures = {vehicle.drone_id: pool.submit(self._land_vehicle, vehicle) for vehicle in active}
            for vehicle in active:
                futures[vehicle.drone_id].result()
                vehicle.phase = "LANDED"
                vehicle.returning = []
                self._record(vehicle, "DONE", "飞控确认降落：已上锁且遥测高度低于 0.8 m")
                self.event(f"{vehicle.drone_id} 飞控确认降落/上锁")
        self._finish()

    def _return_fleet(self, routes: dict[str, list[list[float]]]) -> None:
        active = [vehicle for vehicle in self.vehicles if vehicle.drone_id in routes]
        if not active:
            return
        self._returning = True
        for vehicle in active:
            vehicle.phase = "RETURNING"
            vehicle.returning = routes[vehicle.drone_id]
        self.event("全部覆盖完成，多机并行返航")
        self._move_many({vehicle.drone_id: routes[vehicle.drone_id][1:] for vehicle in active})
        with ThreadPoolExecutor(max_workers=len(active), thread_name_prefix="experiment2-land") as pool:
            futures = {vehicle.drone_id: pool.submit(self._land_vehicle, vehicle) for vehicle in active}
            for vehicle in active:
                futures[vehicle.drone_id].result()
                vehicle.phase = "LANDED"
                vehicle.returning = []
                self._record(vehicle, "DONE", "飞控确认降落：已上锁且遥测高度低于 0.8 m")
                self.event(f"{vehicle.drone_id} 飞控确认降落/上锁")
        self._returning = False

    @staticmethod
    def _land_vehicle(vehicle: SitlVehicle) -> None:
        vehicle.commands.land()
        if not vehicle.state.wait_for(lambda: not vehicle.state.vehicle_value("armed")
                                      and vehicle.state.telemetry_value("altitude") < .8, 100):
            raise CommandTimeoutError(f"{vehicle.drone_id} 降落未确认")

    def _return_pending(self) -> None:
        pending = list(self.return_requested)
        self.return_requested.clear()
        for vehicle in self.vehicles:
            if vehicle.drone_id in pending:
                if vehicle.state.vehicle_value("armed"):
                    self._return_vehicle(vehicle, self._safe_return(vehicle))
                else:
                    vehicle.phase = "LANDED"
        if all(not vehicle.state.vehicle_value("armed") for vehicle in self.vehicles):
            self._finish()
        elif self.status == "RETURNING":
            self.status = "HOLDING"

    def _check_motion(self) -> None:
        from .swarm_routing import hits_box
        origin = self.config["sceneOrigin"]
        for index, vehicle in enumerate(self.vehicles):
            if not vehicle.state.vehicle_value("armed"):
                continue
            if not vehicle.state.is_online():
                raise CommandRejectedError(f"{vehicle.drone_id} 心跳失联，暂停路径调度")
            position = self._position(vehicle)
            local = [(position[0] - origin[0]) * 111320 * math.cos(math.radians(origin[1])), (position[1] - origin[1]) * 110540]
            if any(abs(value) > 500 for value in local):
                raise CommandRejectedError("实际轨迹超出训练边界")
            mission = next((mission for mission in self.plan if mission["droneId"] == vehicle.drone_id), {})
            if any(hits_box(local, local, box) for box in mission.get("routingObstacles", [])):
                raise CommandRejectedError(f"{vehicle.drone_id} 实际位置接近禁飞缓冲，暂停调度")
            for other in self.vehicles[index + 1:]:
                separation = math.hypot(metres(position, self._position(other)), vehicle.state.telemetry_value("altitude") - other.state.telemetry_value("altitude"))
                if separation < self.config["safety"] - .2:
                    raise CommandRejectedError(f"实际机间距离不足安全间距（{separation:.2f}m），暂停调度")

    def _safe_return(self, vehicle: SitlVehicle) -> list[list[float]]:
        from .swarm_routing import shortest_route
        origin = self.config["sceneOrigin"]
        scale = 111320 * math.cos(math.radians(origin[1]))
        local = lambda point: [(point[0] - origin[0]) * scale, (point[1] - origin[1]) * 110540]
        mission = next((mission for mission in self.plan if mission["droneId"] == vehicle.drone_id), {})
        boxes = copy.deepcopy(mission.get("routingObstacles", []))
        margin = self.config["safety"] + 1
        for other in self.vehicles:
            if other is not vehicle and other.state.vehicle_value("armed"):
                east, north = local(self._position(other))
                boxes.append([east - margin, north - margin, east + margin, north + margin])
        return [[origin[0] + point[0] / scale, origin[1] + point[1] / 110540]
                for point in shortest_route(local(self._position(vehicle)), local(vehicle.home), boxes)]

    def _return_vehicle(self, vehicle: SitlVehicle, path: list[list[float]]) -> None:
        self._returning = True
        vehicle.phase = "RETURNING"
        vehicle.returning = path
        self._move_many({vehicle.drone_id: path[1:]})
        vehicle.phase = "RETURNING"
        vehicle.commands.land()
        if not vehicle.state.wait_for(lambda: not vehicle.state.vehicle_value("armed") and vehicle.state.telemetry_value("altitude") < .8, 100):
            raise CommandTimeoutError(f"{vehicle.drone_id} 降落未确认")
        vehicle.phase = "LANDED"
        vehicle.returning = []
        self._record(vehicle, "DONE", "飞控确认降落：已上锁且遥测高度低于 0.8 m")
        self.event(f"{vehicle.drone_id} 飞控确认降落/上锁")
        self._returning = False

    def _finish(self) -> None:
        complete = all(vehicle.completed == len(mission["coverageSegments"]) for vehicle, mission in zip(self.vehicles, self.plan))
        self.status = "COMPLETED" if complete else "ABORTED"
        self.finished_at = time.monotonic()
        self.event("飞控实际降落，任务已结束")

    def _watch(self) -> None:
        while not self._stop.wait(.4):
            with self._lock:
                for vehicle in self.vehicles:
                    if vehicle.state.is_online():
                        point = self._position(vehicle)
                        if point != [0, 0] and (not vehicle.trajectory or metres(vehicle.trajectory[-1], point) >= .15):
                            vehicle.trajectory.append(point)
                    if vehicle.process.poll() is not None or not vehicle.state.is_online() and self.started_at and self.status not in ("COMPLETED", "ABORTED", "FAILED"):
                        self.last_error = f"{vehicle.drone_id} 飞控离线；未伪造位置或任务完成"
                    if vehicle.console:
                        raw = vehicle.state.snapshot(vehicle.endpoint)
                        telemetry = raw["telemetry"]
                        vehicle.console.update({"connected": raw["connection"]["connected"],
                                                "armed": raw["vehicle"]["armed"], "flightMode": raw["vehicle"]["mode"],
                                                "phase": vehicle.phase, "latitude": telemetry["latitude"],
                                                "longitude": telemetry["longitude"], "altitude": round(telemetry["altitude"], 2),
                                                "speed": round(telemetry["groundSpeed"], 2), "battery": telemetry["battery"],
                                                "gpsFixType": telemetry["gpsFixType"], "waypointIndex": vehicle.waypoint_index,
                                                "completedSegments": vehicle.completed})

    def _close_vehicles(self) -> None:
        self._cancel.set()
        if self._worker and self._worker.is_alive():
            self._worker.join(timeout=2)
        for vehicle in self.vehicles:
            monitor = vehicle.monitor_process
            if monitor and monitor.poll() is None:
                try:
                    os.killpg(monitor.pid, signal.SIGTERM)
                    monitor.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(monitor.pid, signal.SIGKILL)
                        monitor.wait(timeout=2)
                    except (OSError, subprocess.TimeoutExpired):
                        pass
                except OSError:
                    pass
            vehicle.transport.stop()
            if vehicle.process.poll() is None:
                vehicle.process.terminate()
                try:
                    vehicle.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    vehicle.process.kill()
                    vehicle.process.wait(timeout=3)
            vehicle.log_file.close()
        self.vehicles = []

    def _validate_gazebo_install(self) -> None:
        plugin_dir = Path(os.getenv("MUVA_ARDUPILOT_GAZEBO_DIR", str(self.workspace / "ardupilot_gazebo"))).resolve()
        required = [
            shutil.which("gz"),
            str(plugin_dir / "worlds" / "experiment2_swarm.sdf"),
            str(plugin_dir / "models" / "iris_with_ardupilot" / "model.sdf"),
            str(plugin_dir / "build" / "libArduPilotPlugin.so"),
            str(self.workspace / "ardupilot/Tools/autotest/default_params/copter.parm"),
            str(self.workspace / "ardupilot/Tools/autotest/default_params/gazebo-iris.parm"),
        ]
        missing = [path for path in required if not path or not Path(path).is_file()]
        if missing:
            raise InvalidCommandError("实验二 Gazebo 依赖缺失：" + ", ".join(missing))

    def _gazebo_environment(self, model_resource_path: Path) -> dict[str, str]:
        plugin_dir = Path(os.getenv("MUVA_ARDUPILOT_GAZEBO_DIR", str(self.workspace / "ardupilot_gazebo"))).resolve()
        environment = os.environ.copy()
        local_lib = self.workspace / ".tools/gz-sim8/usr/lib/x86_64-linux-gnu"
        local_plugins = local_lib / "gz-sim-8/plugins"
        physics_plugins = local_lib / "gz-physics-7/engine-plugins"
        if local_lib.is_dir():
            environment["LD_LIBRARY_PATH"] = f"{local_lib}:{environment.get('LD_LIBRARY_PATH', '')}".rstrip(":")
        if local_plugins.is_dir():
            environment["GZ_SIM_SYSTEM_PLUGIN_PATH"] = f"{local_plugins}:{plugin_dir / 'build'}:{environment.get('GZ_SIM_SYSTEM_PLUGIN_PATH', '')}".rstrip(":")
            environment["GZ_GUI_PLUGIN_PATH"] = f"{local_plugins / 'gui'}:{environment.get('GZ_GUI_PLUGIN_PATH', '')}".rstrip(":")
            environment["QML2_IMPORT_PATH"] = f"{local_plugins / 'gui'}:{environment.get('QML2_IMPORT_PATH', '')}".rstrip(":")
            environment["QML_IMPORT_PATH"] = f"{local_plugins / 'gui'}:{environment.get('QML_IMPORT_PATH', '')}".rstrip(":")
        else:
            environment["GZ_SIM_SYSTEM_PLUGIN_PATH"] = f"{plugin_dir / 'build'}:{environment.get('GZ_SIM_SYSTEM_PLUGIN_PATH', '')}".rstrip(":")
        if physics_plugins.is_dir():
            environment["GZ_SIM_PHYSICS_ENGINE_PATH"] = f"{physics_plugins}:{environment.get('GZ_SIM_PHYSICS_ENGINE_PATH', '')}".rstrip(":")
        resources = [model_resource_path, plugin_dir / "models", plugin_dir / "worlds"]
        environment["GZ_SIM_RESOURCE_PATH"] = ":".join([*(str(path) for path in resources), environment.get("GZ_SIM_RESOURCE_PATH", "")]).rstrip(":")
        environment["GZ_PARTITION"] = self.partition or "MUVA_EXPERIMENT2"
        environment["LIBGL_ALWAYS_SOFTWARE"] = "1"
        return environment

    def _prepare_world(self, count: int, origin: list[float]) -> tuple[Path, Path]:
        plugin_dir = Path(os.getenv("MUVA_ARDUPILOT_GAZEBO_DIR", str(self.workspace / "ardupilot_gazebo"))).resolve()
        source_model = plugin_dir / "models" / "iris_with_ardupilot" / "model.sdf"
        template = plugin_dir / "worlds" / "experiment2_swarm.sdf"
        session_dir = self.state_dir / "gazebo" / (self.session_id or uuid.uuid4().hex)
        models_dir = session_dir / "models"
        models_dir.mkdir(parents=True, exist_ok=True)
        self.world_name = f"muva_experiment2_{(self.session_id or uuid.uuid4().hex)[:8]}"
        world_tree = ET.parse(template)
        world = world_tree.getroot().find("world")
        if world is None:
            raise InvalidCommandError(f"实验二 world 模板缺少 <world>：{template}")
        world.set("name", self.world_name)
        spherical = world.find("spherical_coordinates")
        if spherical is None:
            raise InvalidCommandError("实验二 world 模板缺少 spherical_coordinates")
        latitude = spherical.find("latitude_deg")
        longitude = spherical.find("longitude_deg")
        if latitude is None or longitude is None:
            raise InvalidCommandError("实验二 world 模板缺少经纬度原点")
        latitude.text = str(origin[1])
        longitude.text = str(origin[0])
        for index in range(count):
            drone_name = f"uav_{index + 1:02}"
            model_dir = models_dir / drone_name
            model_dir.mkdir(parents=True, exist_ok=True)
            model_root = ET.parse(source_model).getroot()
            model = model_root.find("model")
            if model is None:
                raise InvalidCommandError(f"Iris 模型缺少 <model>：{source_model}")
            model.set("name", drone_name)
            fdm_port = self.fdm_base_port + index * 10
            plugin = next((node for node in model.findall("plugin") if node.get("name") == "ArduPilotPlugin"), None)
            if plugin is None or plugin.find("fdm_port_in") is None:
                raise InvalidCommandError("Iris 模型缺少 ArduPilotPlugin/fdm_port_in")
            plugin.find("fdm_port_in").text = str(fdm_port)
            ET.ElementTree(model_root).write(model_dir / "model.sdf", encoding="utf-8", xml_declaration=True)
            (model_dir / "model.config").write_text(
                f'<model><name>{drone_name}</name><version>1.0</version><sdf version="1.9">model.sdf</sdf></model>\n',
                encoding="utf-8")
            east = -7 + index * 14
            include = ET.SubElement(world, "include")
            ET.SubElement(include, "uri").text = f"model://{drone_name}"
            ET.SubElement(include, "name").text = drone_name
            ET.SubElement(include, "pose").text = f"{east} 0 0.195 0 0 0"
        self.world_path = session_dir / "world.sdf"
        world_tree.write(self.world_path, encoding="utf-8", xml_declaration=True)
        return self.world_path, models_dir

    @staticmethod
    def _port_available(port: int, tcp: bool) -> bool:
        family = socket.SOCK_STREAM if tcp else socket.SOCK_DGRAM
        with socket.socket(socket.AF_INET, family) as probe:
            try:
                probe.bind(("127.0.0.1", port))
            except OSError:
                return False
        return True

    def _start_gazebo(self, count: int, origin: list[float]) -> None:
        self.partition = f"MUVA_EXPERIMENT2_{(self.session_id or uuid.uuid4().hex)[:8]}"
        world_path, model_path = self._prepare_world(count, origin)
        ports = [(self.fdm_base_port + index * 10, False) for index in range(count)]
        ports.extend((self.base_port + index * 20, True) for index in range(count))
        occupied = [port for port, tcp in ports if not self._port_available(port, tcp)]
        if occupied:
            raise CommandRejectedError(f"实验二专用仿真端口 {occupied} 已被占用；未终止其他程序")
        environment = self._gazebo_environment(model_path)
        log_path = self.state_dir / "gazebo" / (self.session_id or "unknown") / "gazebo.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_file = log_path.open("ab")
        try:
            self.gazebo = subprocess.Popen(
                [shutil.which("gz") or "gz", "sim", "-v4", "-r", "--render-engine-gui", "ogre", str(world_path)],
                cwd=self.workspace, env=environment, stdin=subprocess.DEVNULL,
                stdout=log_file, stderr=subprocess.STDOUT, start_new_session=True)
        finally:
            log_file.close()
        deadline = time.monotonic() + 60
        missing = [f"uav_{index + 1:02}" for index in range(count)]
        while time.monotonic() < deadline:
            if self.gazebo.poll() is not None:
                raise CommandRejectedError(f"实验二 Gazebo 已退出；查看 {log_path}")
            missing = []
            for index in range(count):
                name = f"uav_{index + 1:02}"
                try:
                    result = subprocess.run(
                        [shutil.which("gz") or "gz", "model", "-m", name], env=environment,
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=2, check=False)
                except subprocess.TimeoutExpired:
                    result = None
                if result is None or result.returncode != 0:
                    missing.append(name)
            if not missing:
                return
            time.sleep(.5)
        raise CommandTimeoutError(f"等待实验二 Gazebo world 模型加载超时：{missing}；查看 {log_path}")

    def _stop_gazebo(self) -> None:
        process = self.gazebo
        self.gazebo = None
        self.world_path = None
        self.world_name = None
        self.partition = None
        if not process or process.poll() is not None:
            return
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                pass
        except OSError:
            pass

    def close(self) -> None:
        self._stop.set()
        self._close_vehicles()
        self._stop_gazebo()
        self._monitor.join(timeout=2)
