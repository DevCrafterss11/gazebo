from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from copy import deepcopy
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .commands import CommandService, GatewayCommandError
from .config import Settings
from .missions import MissionService
from .monitor import ReadOnlyMavlinkMonitor
from .state import VehicleState
from .transport import MavlinkTransport

LOGGER = logging.getLogger(__name__)


class ModeRequest(BaseModel):
    mode: str = Field(min_length=2, max_length=32)


class ArmRequest(BaseModel):
    arm: bool


class TakeoffRequest(BaseModel):
    altitude: float = Field(ge=2, le=120)


class MissionItemRequest(BaseModel):
    command: str
    latitude: float = 0
    longitude: float = 0
    altitude: float = 0
    param1: float = 0
    param2: float = 0
    param3: float = 0
    param4: float = 0


class MissionUploadRequest(BaseModel):
    items: list[MissionItemRequest] = Field(min_length=2, max_length=200)
    verify: bool = True


class ExperimentCreateRequest(BaseModel):
    name: str
    drone: dict[str, Any]
    scene: dict[str, Any]
    configuration: dict[str, Any]


class ExperimentConfigurationRequest(BaseModel):
    version: int = 2
    currentStep: int = 1
    completedSteps: list[int] = Field(default_factory=list)
    configuration: dict[str, Any]


class VehicleMoveRequest(BaseModel):
    direction: str
    meters: float


class VehicleYawRequest(BaseModel):
    direction: str
    degrees: float


class Gateway:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.state = VehicleState(settings.heartbeat_timeout)
        self.transport = MavlinkTransport(settings, self.state)
        self.monitor = ReadOnlyMavlinkMonitor(settings.monitor_endpoint, settings.heartbeat_timeout)
        operation_lock = threading.RLock()
        self.operation_lock = operation_lock
        self.commands = CommandService(settings, self.state, self.transport, operation_lock)
        self.missions = MissionService(settings, self.state, self.transport, operation_lock)
        self._platform_lock = threading.RLock()
        self._current_configuration: dict[str, Any] | None = None
        self._sessions: dict[str, dict[str, Any]] = {}
        self._records: dict[str, dict[str, Any]] = {}
        self._runtime_logs: list[dict[str, Any]] = []
        # The MAVLink infrastructure may already be online because the
        # all-in-one launcher owns it.  The teaching workflow still needs a
        # separate, per-browser "environment started" transition at step 4.
        self._runtime_active = False
        self._sequence = 0
        default_data_path = Path(os.getenv("XDG_STATE_HOME", str(Path.home() / ".local" / "state"))) / "muva" / "platform.json"
        self._storage_path = Path(os.getenv("MUVA_PLATFORM_DATA", str(default_data_path)))
        self._load_platform_data()

    def start(self) -> None:
        self.transport.start()
        self.monitor.start()

    def stop(self) -> None:
        self.monitor.stop()
        self.transport.stop()

    def _load_platform_data(self) -> None:
        try:
            payload = json.loads(self._storage_path.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                self._current_configuration = payload.get("configuration") if isinstance(payload.get("configuration"), dict) else None
                sessions = payload.get("sessions")
                records = payload.get("records")
                if isinstance(sessions, dict): self._sessions = sessions
                if isinstance(records, dict): self._records = records
        except (FileNotFoundError, OSError, json.JSONDecodeError, TypeError):
            return

    def save_platform_data(self) -> None:
        with self._platform_lock:
            try:
                self._storage_path.parent.mkdir(parents=True, exist_ok=True)
                temporary = self._storage_path.with_suffix(".tmp")
                temporary.write_text(json.dumps({"configuration": self._current_configuration, "sessions": self._sessions, "records": self._records}, ensure_ascii=False), encoding="utf-8")
                temporary.replace(self._storage_path)
            except OSError:
                LOGGER.warning("Unable to persist platform data", exc_info=True)

    def vehicle_snapshot(self) -> dict[str, Any]:
        return self.state.snapshot(self.settings.mavlink_endpoint)

    def runtime_status(self) -> dict[str, str]:
        if not self._runtime_active:
            return {
                "gazebo": "STOPPED",
                "ardupilotSitl": "STOPPED",
                "mavlinkGateway": "DISCONNECTED",
                "heartbeat": "WAITING",
                "gps": "WAITING",
                "ekf": "WAITING",
                "vehicle": "UNAVAILABLE",
            }
        snapshot = self.vehicle_snapshot()
        online = bool(snapshot["connection"]["connected"])
        transport = bool(snapshot["connection"]["transportConnected"])
        telemetry = snapshot["telemetry"]
        gps = int(telemetry.get("gpsFixType", 0)) >= 3 and int(telemetry.get("satellites", 0)) >= 6
        return {
            "gazebo": "RUNNING" if online else "STOPPED",
            "ardupilotSitl": "RUNNING" if transport else "STOPPED",
            "mavlinkGateway": "CONNECTED" if transport else "DISCONNECTED",
            "heartbeat": "OK" if online else "WAITING",
            "gps": "3D FIX" if gps else "WAITING",
            "ekf": "HEALTHY" if online and gps else "WAITING",
            "vehicle": "ONLINE" if online else "UNAVAILABLE",
        }

    def append_runtime_log(self, phase: str, message: str) -> None:
        self._runtime_logs.append({"timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "phase": phase, "message": message})
        self._runtime_logs = self._runtime_logs[-100:]

    def telemetry_envelope(self) -> dict[str, Any]:
        snapshot = self.vehicle_snapshot()
        telemetry = snapshot["telemetry"]
        vehicle = snapshot["vehicle"]
        connection = snapshot["connection"]
        self._sequence += 1
        gps_fix = int(telemetry.get("gpsFixType", 0))
        fix_type = "3D FIX" if gps_fix >= 3 else "NO FIX"
        healthy = bool(connection["connected"] and gps_fix >= 3 and int(telemetry.get("satellites", 0)) >= 6)
        return {
            "protocolVersion": "1.0", "type": "telemetry", "timestamp": int(time.time() * 1000),
            "vehicleId": f"mavlink-{vehicle.get('systemId') or 'unknown'}", "sequence": self._sequence,
            "source": "mavlink",
            "payload": {
                "type": "SNAPSHOT",
                "position": {"latitude": float(telemetry.get("latitude", 0.0)), "longitude": float(telemetry.get("longitude", 0.0)), "altitude": float(telemetry.get("altitude", 0.0))},
                "velocity": {"groundSpeed": float(telemetry.get("groundSpeed", 0.0)), "verticalSpeed": float(telemetry.get("climbRate", 0.0))},
                "attitude": {"roll": float(telemetry.get("roll", 0.0)), "pitch": float(telemetry.get("pitch", 0.0)), "yaw": float(telemetry.get("yaw", telemetry.get("heading", 0.0)))},
                "batteryPercent": float(max(0, telemetry.get("battery", 0))),
                "gps": {"satellites": float(telemetry.get("satellites", 0)), "fixType": fix_type, "hdop": float(telemetry.get("hdop", 99.0))},
                "health": {"ekfStatus": {"healthy": healthy, "state": "NORMAL" if healthy else "UNAVAILABLE"}, "mavlinkStatus": {"connected": bool(connection["connected"]), "heartbeat": bool(connection["connected"]), "version": "MAVLink 2"}},
                "system": {"mode": str(vehicle.get("mode", "UNKNOWN")), "armed": bool(vehicle.get("armed", False))},
            },
        }


DRONE_MODELS: list[dict[str, Any]] = [
    {"id": "iris-quadrotor-01", "model": "Iris 四旋翼", "frame": "Quad X", "flightController": "ArduPilot Copter", "firmware": "4.6.2", "name": "Iris 四旋翼", "type": "quadrotor", "frameType": "Quad X", "weight": 0.6, "size": "450 × 450 × 120 mm", "maxSpeed": 8, "maxAltitude": 120, "flightTime": 20, "description": "ArduPilot 官方 SITL/Gazebo 教学常用四旋翼机型，适合基础飞行训练。", "image": "/mock-assets/iris.svg", "recommended": True, "rotorCount": 4, "maximumTakeoffWeightKg": 0.6, "wheelbaseMillimeters": 450, "heightMillimeters": 120, "maximumSpeedMetersPerSecond": 8, "enduranceMinutes": 20},
    {"id": "x500-quadrotor-01", "model": "X500 四旋翼", "frame": "Quad X", "flightController": "ArduPilot Copter", "firmware": "4.6.2", "name": "X500 四旋翼", "type": "quadrotor", "frameType": "Quad X", "weight": 1.0, "size": "500 × 500 × 180 mm", "maxSpeed": 12, "maxAltitude": 150, "flightTime": 26, "description": "轴距更大的四旋翼教学机型，适合稳定性与任务飞行训练。", "image": "/mock-assets/x500.svg", "recommended": False, "rotorCount": 4, "maximumTakeoffWeightKg": 1.0, "wheelbaseMillimeters": 500, "heightMillimeters": 180, "maximumSpeedMetersPerSecond": 12, "enduranceMinutes": 26},
    {"id": "hexa-01", "model": "Hexa 六旋翼", "frame": "Hexa X", "flightController": "ArduPilot Copter", "firmware": "4.6.2", "name": "Hexa 六旋翼", "type": "hexacopter", "frameType": "Hexa X", "weight": 1.5, "size": "650 × 650 × 220 mm", "maxSpeed": 16, "maxAltitude": 180, "flightTime": 28, "description": "六旋翼冗余教学机型，用于对比多旋翼构型与安全性。", "image": "/mock-assets/hexa.svg", "recommended": False, "rotorCount": 6, "maximumTakeoffWeightKg": 1.5, "wheelbaseMillimeters": 650, "heightMillimeters": 220, "maximumSpeedMetersPerSecond": 16, "enduranceMinutes": 28},
]

SCENES: list[dict[str, Any]] = [
    {"id": "campus", "name": "校园环境", "description": "包含教学楼、操场和开阔起降区的基础教学场景。", "latitude": 34.3416, "longitude": 108.9398, "altitude": 410, "weather": "晴朗 · 22°C", "wind": "东北风 1.2 m/s", "image": "campus"},
    {"id": "training-field", "name": "标准训练场", "description": "带标准训练点和航线标记的封闭训练区域。", "latitude": 34.3431, "longitude": 108.9422, "altitude": 406, "weather": "晴朗 · 21°C", "wind": "东风 0.8 m/s", "image": "training-field"},
    {"id": "open-area", "name": "空旷环境", "description": "障碍物较少，适合初次起飞和姿态控制练习。", "latitude": 34.3388, "longitude": 108.9354, "altitude": 398, "weather": "多云 · 20°C", "wind": "西北风 2.1 m/s", "image": "open-area"},
]


def create_app(settings: Settings | None = None, gateway: Gateway | None = None) -> FastAPI:
    configured_settings = settings or Settings.from_env()
    configured_gateway = gateway or Gateway(configured_settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.gateway = configured_gateway
        configured_gateway.start()
        try:
            yield
        finally:
            configured_gateway.stop()

    app = FastAPI(
        title="MUVA MAVLink Gateway",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.state.gateway = configured_gateway
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(configured_settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    def gateway_from_request(request: Request) -> Gateway:
        return request.app.state.gateway

    def safety_context(gateway_instance: Gateway) -> dict[str, Any]:
        snapshot = gateway_instance.vehicle_snapshot()
        runtime = gateway_instance.runtime_status()
        telemetry = snapshot["telemetry"]
        return {
            "environmentReady": runtime["vehicle"] == "ONLINE",
            "vehicleOnline": bool(snapshot["connection"]["connected"]),
            "mavlinkConnected": bool(snapshot["connection"]["connected"]),
            "ekfHealthy": runtime["ekf"] == "HEALTHY",
            "gpsSatellites": int(telemetry.get("satellites", 0)),
            "batteryPercent": float(max(0, telemetry.get("battery", 0))),
            "armed": bool(snapshot["vehicle"].get("armed", False)),
            "altitude": float(telemetry.get("altitude", 0)),
            "maxAltitude": 120.0,
            "homePosition": snapshot.get("home") if snapshot.get("home", {}).get("valid") else None,
        }

    @app.exception_handler(GatewayCommandError)
    async def handle_command_error(_request: Request, error: GatewayCommandError) -> JSONResponse:
        return JSONResponse(status_code=error.status_code, content={"detail": str(error)})

    @app.exception_handler(ConnectionError)
    async def handle_transport_error(_request: Request, error: ConnectionError) -> JSONResponse:
        # A reconnect race can happen after the heartbeat check but before the
        # packet is written. Keep that expected condition user-visible as a
        # retryable gateway error instead of an opaque HTTP 500.
        return JSONResponse(status_code=503, content={"detail": f"MAVLink transport unavailable: {error}"})

    @app.get("/api/health")
    async def health(request: Request) -> dict[str, Any]:
        gateway_instance: Gateway = request.app.state.gateway
        snapshot = gateway_instance.state.snapshot(gateway_instance.settings.mavlink_endpoint)
        return {
            "status": "ok",
            "vehicleConnected": snapshot["connection"]["connected"],
            "endpoint": gateway_instance.settings.mavlink_endpoint,
        }

    # Versioned contract consumed by the MUVA teaching frontend.
    @app.get("/api/v1/drones")
    async def v1_drones() -> list[dict[str, Any]]:
        return deepcopy(DRONE_MODELS)

    @app.get("/api/v1/scenes")
    async def v1_scenes() -> list[dict[str, Any]]:
        return deepcopy(SCENES)

    @app.post("/api/v1/experiments")
    async def v1_create_experiment(request: Request, payload: ExperimentCreateRequest) -> dict[str, Any]:
        gateway_instance = gateway_from_request(request)
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        experiment_id = f"muva-exp-{int(time.time() * 1000)}"
        session = {"id": experiment_id, "name": payload.name, "drone": payload.drone, "scene": payload.scene, "createdAt": now, "startedAt": None, "status": "CREATED", "configuration": payload.configuration}
        with gateway_instance._platform_lock:
            gateway_instance._sessions[experiment_id] = session
        gateway_instance.save_platform_data()
        return deepcopy(session)

    @app.post("/api/v1/experiments/configuration")
    async def v1_save_configuration(request: Request, payload: ExperimentConfigurationRequest) -> dict[str, bool]:
        gateway_instance = gateway_from_request(request)
        gateway_instance._current_configuration = payload.model_dump()
        gateway_instance.save_platform_data()
        return {"ok": True}

    @app.get("/api/v1/experiments/current")
    async def v1_load_configuration(request: Request) -> dict[str, Any] | None:
        return deepcopy(gateway_from_request(request)._current_configuration)

    @app.delete("/api/v1/experiments/current")
    async def v1_clear_configuration(request: Request) -> dict[str, bool]:
        gateway_instance = gateway_from_request(request)
        gateway_instance._current_configuration = None
        gateway_instance.save_platform_data()
        return {"ok": True}

    @app.post("/api/v1/experiments/{experiment_id}/start")
    async def v1_start_experiment(request: Request, experiment_id: str) -> dict[str, bool]:
        gateway_instance = gateway_from_request(request)
        session = gateway_instance._sessions.get(experiment_id)
        if session is None:
            raise GatewayCommandError("实验 Session 不存在")
        session["status"] = "STARTING"
        session["startedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        gateway_instance.save_platform_data()
        return {"ok": True}

    @app.post("/api/v1/experiments/{experiment_id}/finish")
    async def v1_finish_experiment(request: Request, experiment_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        gateway_instance = gateway_from_request(request)
        session = gateway_instance._sessions.get(experiment_id)
        if session is not None:
            session["status"] = "FINISHED"
        result = deepcopy(payload)
        gateway_instance.save_platform_data()
        return result

    @app.post("/api/v1/experiments/{experiment_id}/record")
    async def v1_save_record(request: Request, experiment_id: str, payload: dict[str, Any]) -> dict[str, bool]:
        gateway_instance = gateway_from_request(request)
        gateway_instance._records[experiment_id] = deepcopy(payload)
        gateway_instance.save_platform_data()
        return {"ok": True}

    @app.get("/api/v1/experiments/records")
    async def v1_list_records(request: Request) -> list[dict[str, Any]]:
        return deepcopy(list(gateway_from_request(request)._records.values()))

    @app.get("/api/v1/experiments/records/{record_id}")
    async def v1_get_record(request: Request, record_id: str) -> dict[str, Any] | None:
        return deepcopy(gateway_from_request(request)._records.get(record_id))

    @app.get("/api/v1/runtime/status")
    async def v1_runtime_status(request: Request) -> dict[str, str]:
        gateway_instance = gateway_from_request(request)
        saved_step = (gateway_instance._current_configuration or {}).get("currentStep", 1)
        # At step 4 a fresh browser has no `simulationStarted` flag yet.  Let
        # it replay the idempotent start request instead of restoring READY and
        # ending up with both the start and next buttons disabled.
        if isinstance(saved_step, int) and saved_step <= 4:
            return {
                "gazebo": "STOPPED", "ardupilotSitl": "STOPPED",
                "mavlinkGateway": "DISCONNECTED", "heartbeat": "WAITING",
                "gps": "WAITING", "ekf": "WAITING", "vehicle": "UNAVAILABLE",
            }
        return gateway_instance.runtime_status()

    @app.get("/api/v1/runtime/logs")
    async def v1_runtime_logs(request: Request) -> list[dict[str, Any]]:
        return deepcopy(gateway_from_request(request)._runtime_logs)

    @app.post("/api/v1/runtime/start")
    async def v1_runtime_start(request: Request, payload: dict[str, Any]) -> dict[str, str]:
        gateway_instance = gateway_from_request(request)
        gateway_instance.transport.start()
        gateway_instance.monitor.start()
        gateway_instance.append_runtime_log("STARTING_MAVLINK_GATEWAY", "正在连接 MAVLink Gateway")
        deadline = time.monotonic() + max(2.0, gateway_instance.settings.heartbeat_timeout * 4)
        while time.monotonic() < deadline and not gateway_instance.state.is_online():
            await asyncio.sleep(0.1)
        if not gateway_instance.state.is_online():
            gateway_instance._runtime_active = False
            gateway_instance.append_runtime_log("ERROR", "未收到飞行器 Heartbeat，环境启动失败")
            raise ConnectionError("No recent vehicle heartbeat")
        gateway_instance._runtime_active = True
        runtime = gateway_instance.runtime_status()
        gateway_instance.append_runtime_log("READY" if runtime["vehicle"] == "ONLINE" else "WAITING_HEARTBEAT", "仿真环境 READY" if runtime["vehicle"] == "ONLINE" else "等待飞行器 Heartbeat")
        return runtime

    @app.post("/api/v1/runtime/stop")
    async def v1_runtime_stop(request: Request) -> dict[str, bool]:
        gateway_instance = gateway_from_request(request)
        gateway_instance._runtime_active = False
        # Gazebo, SITL and the gateway transport are owned by the root
        # all-in-one launcher.  Ending or restarting one experiment must not
        # tear down that shared infrastructure, otherwise the next step-4
        # request waits for a heartbeat that can never arrive.
        gateway_instance.append_runtime_log("IDLE", "环境已停止")
        return {"ok": True}

    @app.post("/api/v1/system/sensors/check")
    async def v1_sensor_check(request: Request) -> list[dict[str, Any]]:
        gateway_instance = gateway_from_request(request)
        context = safety_context(gateway_instance)
        connected = bool(context["vehicleOnline"])
        gps_ok = connected and context["gpsSatellites"] >= 6
        ekf_ok = connected and context["ekfHealthy"]
        return [
            {"id": "heartbeat", "name": "Heartbeat", "status": "PASS" if connected else "FAIL", "details": ["Heartbeat OK" if connected else "Heartbeat unavailable", "Vehicle ONLINE" if connected else "Vehicle offline"]},
            {"id": "gps", "name": "GPS", "status": "PASS" if gps_ok else "FAIL", "details": ["3D Fix" if gps_ok else "Fix unavailable", f"{context['gpsSatellites']} satellites", "HDOP from vehicle telemetry"]},
            {"id": "imu", "name": "IMU", "status": "PASS" if connected else "FAIL", "details": ["Gyroscope Healthy" if connected else "Unavailable", "Accelerometer Healthy" if connected else "Unavailable"]},
            {"id": "compass", "name": "Compass", "status": "PASS" if connected else "FAIL", "details": ["Healthy" if connected else "Unavailable"]},
            {"id": "barometer", "name": "Barometer", "status": "PASS" if connected else "FAIL", "details": ["Healthy" if connected else "Unavailable"]},
            {"id": "ekf", "name": "EKF", "status": "PASS" if ekf_ok else "FAIL", "details": ["Healthy" if ekf_ok else "Unavailable"]},
        ]

    @app.post("/api/v1/flight/preflight")
    async def v1_preflight(request: Request, payload: dict[str, Any]) -> list[dict[str, Any]]:
        gateway_instance = gateway_from_request(request)
        runtime = gateway_instance.runtime_status()
        config = payload.get("configuration", {}) if isinstance(payload, dict) else {}
        parameters = config.get("flightParameters", {}) if isinstance(config, dict) else {}
        sensors = config.get("sensors", []) if isinstance(config, dict) else []
        sensor_by_id = {item.get("id"): item for item in sensors if isinstance(item, dict)}
        def sensor_pass(sensor_id: str) -> bool: return sensor_by_id.get(sensor_id, {}).get("status") == "PASS"
        home = config.get("homePosition") if isinstance(config, dict) else None
        checks = [
            ("environment-ready", "Environment READY", runtime["vehicle"] == "ONLINE", "仿真环境未 READY"),
            ("sitl-connected", "SITL Connected", runtime["ardupilotSitl"] == "RUNNING", "ArduPilot SITL 未连接"),
            ("mavlink-connected", "MAVLink Connected", runtime["mavlinkGateway"] == "CONNECTED", "MAVLink Gateway 未连接"),
            ("heartbeat", "Heartbeat OK", sensor_pass("heartbeat"), "Heartbeat 尚未通过系统检查"),
            ("gps", "GPS 3D Fix", sensor_pass("gps"), "GPS 尚未通过系统检查"),
            ("ekf", "EKF Healthy", sensor_pass("ekf"), "EKF 尚未通过系统检查"),
            ("imu", "IMU Healthy", sensor_pass("imu"), "IMU 尚未通过系统检查"),
            ("compass", "Compass Healthy", sensor_pass("compass"), "Compass 尚未通过系统检查"),
            ("barometer", "Barometer Healthy", sensor_pass("barometer"), "Barometer 尚未通过系统检查"),
            ("home", "Home Position Set", isinstance(home, dict) and all(isinstance(home.get(key), (int, float)) for key in ("latitude", "longitude", "altitude")), "Home Position 未设置"),
            ("parameters", "Flight Parameters Valid", isinstance(parameters, dict) and float(parameters.get("takeoffAltitude", 0)) >= 1 and float(parameters.get("maxAltitude", 0)) >= float(parameters.get("takeoffAltitude", 0)), "飞行参数无效"),
            ("vehicle-disarmed", "Vehicle Disarmed", not bool(gateway_instance.vehicle_snapshot()["vehicle"].get("armed", False)), "飞行器必须处于未解锁状态"),
        ]
        return [{"id": item_id, "label": label, "status": "PASS" if passed else "FAIL", "reason": None if passed else reason} for item_id, label, passed, reason in checks]

    @app.get("/api/v1/vehicle/safety")
    async def v1_vehicle_safety(request: Request) -> dict[str, Any]:
        return safety_context(gateway_from_request(request))

    @app.post("/api/v1/vehicle/arm")
    async def v1_vehicle_arm(request: Request) -> dict[str, Any]:
        return await asyncio.to_thread(gateway_from_request(request).commands.arm, True)

    @app.post("/api/v1/vehicle/disarm")
    async def v1_vehicle_disarm(request: Request) -> dict[str, Any]:
        return await asyncio.to_thread(gateway_from_request(request).commands.arm, False)

    @app.post("/api/v1/vehicle/takeoff")
    async def v1_vehicle_takeoff(request: Request, payload: dict[str, Any]) -> dict[str, Any]:
        return await asyncio.to_thread(gateway_from_request(request).commands.takeoff, float(payload.get("altitudeMeters", payload.get("altitude", 0))))

    @app.post("/api/v1/vehicle/land")
    async def v1_vehicle_land(request: Request) -> dict[str, Any]:
        return await asyncio.to_thread(gateway_from_request(request).commands.land)

    @app.post("/api/v1/vehicle/rtl")
    async def v1_vehicle_rtl(request: Request) -> dict[str, Any]:
        return await asyncio.to_thread(gateway_from_request(request).commands.rtl)

    @app.post("/api/v1/vehicle/hold")
    async def v1_vehicle_hold(request: Request) -> dict[str, Any]:
        return await asyncio.to_thread(gateway_from_request(request).commands.hold)

    @app.post("/api/v1/vehicle/move")
    async def v1_vehicle_move(request: Request, payload: VehicleMoveRequest) -> dict[str, Any]:
        return await asyncio.to_thread(gateway_from_request(request).commands.move, payload.direction, payload.meters)

    @app.post("/api/v1/vehicle/yaw")
    async def v1_vehicle_yaw(request: Request, payload: VehicleYawRequest) -> dict[str, Any]:
        return await asyncio.to_thread(gateway_from_request(request).commands.yaw, payload.direction, payload.degrees)

    @app.post("/api/v1/vehicle/mode")
    async def v1_vehicle_mode(request: Request, payload: ModeRequest) -> dict[str, Any]:
        return await asyncio.to_thread(gateway_from_request(request).commands.set_mode, payload.mode)

    @app.get("/api/v1/missions/current")
    async def v1_current_mission(request: Request) -> dict[str, Any] | None:
        gateway_instance = gateway_from_request(request)
        snapshot = gateway_instance.vehicle_snapshot()["mission"]
        if int(snapshot.get("total", 0)) == 0:
            return None
        try:
            result = await asyncio.to_thread(gateway_instance.missions.download)
        except GatewayCommandError:
            return None
        waypoints = [
            {"sequence": index, "latitude": item["latitude"], "longitude": item["longitude"], "altitudeMeters": item["altitude"]}
            for index, item in enumerate(result.get("items", []))
        ]
        state_map = {"active": "RUNNING", "completed": "COMPLETED", "failed": "FAILED", "aborted": "FAILED"}
        return {"id": str(snapshot.get("missionHash") or "vehicle-mission"), "name": "Vehicle mission", "waypoints": waypoints, "state": state_map.get(str(snapshot.get("state")), "UPLOADED")}

    @app.post("/api/v1/missions/upload")
    async def v1_upload_mission(request: Request, payload: dict[str, Any]) -> dict[str, Any]:
        gateway_instance = gateway_from_request(request)
        name = str(payload.get("name", "Vehicle mission"))
        raw_waypoints = payload.get("waypoints", [])
        items: list[dict[str, Any]] = []
        for index, waypoint in enumerate(raw_waypoints if isinstance(raw_waypoints, list) else []):
            if not isinstance(waypoint, dict): continue
            command = "TAKEOFF" if index == 0 else "LAND" if index == len(raw_waypoints) - 1 else "WAYPOINT"
            items.append({"command": command, "latitude": waypoint.get("latitude", 0), "longitude": waypoint.get("longitude", 0), "altitude": waypoint.get("altitudeMeters", 0)})
        result = await asyncio.to_thread(gateway_instance.missions.upload, items, True)
        waypoints = [{"sequence": index, "latitude": item["latitude"], "longitude": item["longitude"], "altitudeMeters": item["altitude"]} for index, item in enumerate(result.get("items", []))]
        return {"id": str(gateway_instance.vehicle_snapshot()["mission"].get("missionHash") or f"mission-{int(time.time())}"), "name": name, "waypoints": waypoints, "state": "UPLOADED"}

    @app.post("/api/v1/missions/start")
    async def v1_start_mission(request: Request) -> dict[str, Any]:
        gateway_instance = gateway_from_request(request)
        return await asyncio.to_thread(gateway_instance.missions.start, gateway_instance.commands)

    @app.post("/api/v1/missions/clear")
    async def v1_clear_mission(request: Request) -> dict[str, bool]:
        gateway_instance = gateway_from_request(request)
        target_system, target_component = gateway_instance.state.target
        gateway_instance.transport.send(lambda connection: connection.mav.mission_clear_all_send(target_system, target_component))
        gateway_instance.state.set_mission_state("idle")
        gateway_instance.state.set_mission_verification(False)
        return {"ok": True}

    @app.get("/api/vehicle")
    async def vehicle(request: Request) -> dict[str, Any]:
        gateway_instance: Gateway = request.app.state.gateway
        return gateway_instance.state.snapshot(gateway_instance.settings.mavlink_endpoint)

    @app.get("/api/monitor")
    async def monitor(request: Request) -> dict[str, Any]:
        gateway_instance: Gateway = request.app.state.gateway
        return gateway_instance.monitor.state.snapshot()

    @app.post("/api/commands/mode")
    async def set_mode(request: Request, payload: ModeRequest) -> dict[str, Any]:
        gateway_instance: Gateway = request.app.state.gateway
        result = await asyncio.to_thread(gateway_instance.commands.set_mode, payload.mode)
        gateway_instance.monitor.state.record_local_event(
            "MODE_CHANGE",
            "command",
            "info",
            f"mode={result['mode']} -> ACCEPTED",
            source_system=gateway_instance.state.target[0],
            source_component=gateway_instance.state.target[1],
        )
        return {"ok": True, "result": result}

    @app.post("/api/commands/arm")
    async def arm(request: Request, payload: ArmRequest) -> dict[str, Any]:
        result = await asyncio.to_thread(request.app.state.gateway.commands.arm, payload.arm)
        return {"ok": True, "result": result}

    @app.post("/api/commands/takeoff")
    async def takeoff(request: Request, payload: TakeoffRequest) -> dict[str, Any]:
        result = await asyncio.to_thread(request.app.state.gateway.commands.takeoff, payload.altitude)
        return {"ok": True, "result": result}

    @app.post("/api/commands/hold")
    async def hold(request: Request) -> dict[str, Any]:
        result = await asyncio.to_thread(request.app.state.gateway.commands.hold)
        return {"ok": True, "result": result}

    @app.get("/api/missions")
    async def download_mission(request: Request) -> dict[str, Any]:
        result = await asyncio.to_thread(request.app.state.gateway.missions.download)
        return {"ok": True, "result": result}

    @app.post("/api/missions/upload")
    async def upload_mission(request: Request, payload: MissionUploadRequest) -> dict[str, Any]:
        items = [item.model_dump() for item in payload.items]
        result = await asyncio.to_thread(request.app.state.gateway.missions.upload, items, payload.verify)
        return {"ok": True, "result": result}

    @app.post("/api/missions/start")
    async def start_mission(request: Request) -> dict[str, Any]:
        gateway_instance: Gateway = request.app.state.gateway
        result = await asyncio.to_thread(gateway_instance.missions.start, gateway_instance.commands)
        return {"ok": True, "result": result}

    @app.websocket("/ws/telemetry")
    async def telemetry(websocket: WebSocket) -> None:
        await websocket.accept()
        gateway_instance: Gateway = websocket.app.state.gateway
        interval = 1 / max(1.0, gateway_instance.settings.telemetry_rate_hz)
        last_version = -1
        try:
            while True:
                snapshot = gateway_instance.state.snapshot(gateway_instance.settings.mavlink_endpoint)
                if snapshot["version"] != last_version or not snapshot["connection"]["connected"]:
                    await websocket.send_json(gateway_instance.telemetry_envelope())
                    last_version = snapshot["version"]
                await asyncio.sleep(interval)
        except (WebSocketDisconnect, RuntimeError):
            LOGGER.debug("Telemetry WebSocket disconnected")

    @app.websocket("/ws/monitor")
    async def monitor_console(websocket: WebSocket) -> None:
        await websocket.accept()
        gateway_instance: Gateway = websocket.app.state.gateway
        last_version = -1
        try:
            while True:
                snapshot = gateway_instance.monitor.state.snapshot()
                if snapshot["version"] != last_version or not snapshot["connection"]["connected"]:
                    await websocket.send_json(snapshot)
                    last_version = snapshot["version"]
                await asyncio.sleep(0.25)
        except (WebSocketDisconnect, RuntimeError):
            LOGGER.debug("Monitor WebSocket disconnected")

    @app.websocket("/ws/mavlink/monitor")
    async def v1_monitor_console(websocket: WebSocket) -> None:
        await websocket.accept()
        gateway_instance: Gateway = websocket.app.state.gateway
        last_version = -1
        try:
            while True:
                snapshot = gateway_instance.monitor.state.snapshot()
                if snapshot["version"] != last_version or not snapshot["connection"]["connected"]:
                    await websocket.send_json(snapshot)
                    last_version = snapshot["version"]
                await asyncio.sleep(0.25)
        except (WebSocketDisconnect, RuntimeError):
            LOGGER.debug("Versioned monitor WebSocket disconnected")

    return app


app = create_app()
