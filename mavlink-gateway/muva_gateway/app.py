from __future__ import annotations

import asyncio
from dataclasses import replace
import json
import logging
import math
import os
import random
import threading
import time
from contextlib import asynccontextmanager
from copy import deepcopy
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from pymavlink import mavutil

from .commands import CommandService, GatewayCommandError
from .config import Settings
from .missions import MissionService
from .monitor import ReadOnlyMavlinkMonitor
from .runtime_processes import RuntimeProcesses
from .state import VehicleState, relative_position_meters
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


class WaypointTamperingRequest(BaseModel):
    waypoints: list[dict[str, float]] = Field(min_length=2, max_length=6)
    offsetSide: str = Field(pattern="^(left|right)$")


class RouteExecutionRequest(BaseModel):
    waypoints: list[dict[str, float]] = Field(min_length=2, max_length=6)


class WaypointInjectionRequest(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    altitude: float = Field(ge=0.5, le=10)


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
    progressId: str | None = None
    learningProgress: dict[str, Any] | None = None
    flightMapView: dict[str, Any] | None = None
    sessionId: str | None = None
    session: dict[str, Any] | None = None
    result: dict[str, Any] | None = None
    assessment: dict[str, Any] | None = None


class VehicleMoveRequest(BaseModel):
    direction: str
    meters: float


class VehicleYawRequest(BaseModel):
    direction: str
    degrees: float


class SecurityRunRequest(BaseModel):
    caseId: str = Field(pattern="^(replay|degradation)$")
    mode: str = Field(pattern="^(training|assessment)$")
    difficulty: str = Field(pattern="^(low|medium|high)$")


class SecurityJudgmentRequest(BaseModel):
    judgment: str = Field(pattern="^(normal|link_anomaly|replay|insufficient_evidence)$")
    evidenceIds: list[str] = Field(default_factory=list, max_length=100)
    requestId: str = Field(min_length=1, max_length=100)


class SecurityReflectionRequest(BaseModel):
    reflection: str = Field(default="", max_length=4000)


class Gateway:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.state = VehicleState(settings.heartbeat_timeout)
        self.transport = MavlinkTransport(settings, self.state)
        self.monitor = ReadOnlyMavlinkMonitor(settings.monitor_endpoint, settings.heartbeat_timeout)
        project_dir = Path(os.getenv("MUVA_PROJECT_DIR", Path(__file__).resolve().parents[2]))
        default_log_dir = Path(os.getenv("XDG_STATE_HOME", str(Path.home() / ".local" / "state"))) / "muva" / "logs"
        self.runtime_processes = RuntimeProcesses(project_dir, Path(os.getenv("MUVA_LOG_DIR", default_log_dir)))
        operation_lock = threading.RLock()
        self.operation_lock = operation_lock
        self.commands = CommandService(
            settings, self.state, self.transport, operation_lock, self.monitor.state.record_local_event,
        )
        self.missions = MissionService(
            settings, self.state, self.transport, operation_lock, self.monitor.state.record_local_event,
        )
        self._platform_lock = threading.RLock()
        self._current_configuration: dict[str, Any] | None = None
        self._sessions: dict[str, dict[str, Any]] = {}
        self._records: dict[str, dict[str, Any]] = {}
        self._progress: dict[str, dict[str, Any]] = {}
        self._assessments: dict[str, dict[str, Any]] = {}
        self._security_records: dict[str, dict[str, Any]] = {}
        self._security_runs: dict[str, dict[str, Any]] = {}
        self._runtime_logs: list[dict[str, Any]] = []
        # The MAVLink infrastructure may already be online because the
        # all-in-one launcher owns it.  The teaching workflow still needs a
        # separate, per-browser "environment started" transition at step 4.
        self._runtime_active = False
        self._flight_max_altitude = 120.0
        self._sequence = 0
        default_data_path = Path(os.getenv("XDG_STATE_HOME", str(Path.home() / ".local" / "state"))) / "muva" / "platform.json"
        self._storage_path = Path(os.getenv("MUVA_PLATFORM_DATA", str(default_data_path)))
        self._load_platform_data()

    def start(self) -> None:
        # The teaching platform and API stay available without launching SITL.
        return

    def stop(self) -> None:
        self.monitor.stop()
        self.transport.stop()
        self.runtime_processes.stop()

    def _load_platform_data(self) -> None:
        try:
            payload = json.loads(self._storage_path.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                self._current_configuration = payload.get("configuration") if isinstance(payload.get("configuration"), dict) else None
                sessions = payload.get("sessions")
                records = payload.get("records")
                progress = payload.get("progress")
                assessments = payload.get("assessments")
                security_records = payload.get("securityRecords")
                if isinstance(sessions, dict): self._sessions = sessions
                if isinstance(records, dict): self._records = records
                if isinstance(progress, dict): self._progress = progress
                if isinstance(assessments, dict): self._assessments = assessments
                if isinstance(security_records, dict): self._security_records = security_records
        except (FileNotFoundError, OSError, json.JSONDecodeError, TypeError):
            return

    def save_platform_data(self) -> None:
        with self._platform_lock:
            try:
                self._storage_path.parent.mkdir(parents=True, exist_ok=True)
                temporary = self._storage_path.with_suffix(".tmp")
                temporary.write_text(json.dumps({"configuration": self._current_configuration, "sessions": self._sessions, "records": self._records, "progress": self._progress, "assessments": self._assessments, "securityRecords": self._security_records}, ensure_ascii=False), encoding="utf-8")
                temporary.replace(self._storage_path)
            except OSError as error:
                LOGGER.exception("Unable to persist platform data")
                raise HTTPException(status_code=507, detail="实验数据保存失败，请检查网关存储空间") from error

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
        process_is_running = getattr(self.runtime_processes, "is_running", None)
        process_is_managed = getattr(self.runtime_processes, "is_managed", None)
        gazebo_managed = process_is_managed("gazebo") if process_is_managed else bool(process_is_running)
        sitl_managed = process_is_managed("sitl") if process_is_managed else bool(process_is_running)
        gazebo_running = process_is_running("gazebo") if process_is_running and gazebo_managed else online
        sitl_running = process_is_running("sitl") if process_is_running and sitl_managed else transport
        telemetry = snapshot["telemetry"]
        gps = int(telemetry.get("gpsFixType", 0)) >= 3 and int(telemetry.get("satellites", 0)) >= 6
        imu_mask = mavutil.mavlink.MAV_SYS_STATUS_SENSOR_3D_GYRO | mavutil.mavlink.MAV_SYS_STATUS_SENSOR_3D_ACCEL
        imu = all(int(telemetry.get(field, 0)) & imu_mask == imu_mask for field in ("sensorsPresent", "sensorsEnabled", "sensorsHealth"))
        return {
            "gazebo": "RUNNING" if gazebo_running else "STOPPED",
            "ardupilotSitl": "RUNNING" if sitl_running else "STOPPED",
            "mavlinkGateway": "CONNECTED" if transport else "DISCONNECTED",
            "heartbeat": "OK" if online else "WAITING",
            "gps": "3D FIX" if gps else "WAITING",
            "ekf": "HEALTHY" if online and gps and imu else "WAITING",
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
        home = snapshot["home"]
        north = 0.0
        east = 0.0
        if home.get("valid"):
            north, east = relative_position_meters(
                float(telemetry.get("latitude", 0.0)),
                float(telemetry.get("longitude", 0.0)),
                float(home.get("latitude", 0.0)),
                float(home.get("longitude", 0.0)),
            )
        self._sequence += 1
        gps_fix = int(telemetry.get("gpsFixType", 0))
        fix_type = "3D FIX" if gps_fix >= 3 else "NO FIX"
        healthy = self.runtime_status()["ekf"] == "HEALTHY"
        return {
            "protocolVersion": "1.0", "type": "telemetry", "timestamp": int(time.time() * 1000),
            "vehicleId": f"mavlink-{vehicle.get('systemId') or 'unknown'}", "sequence": self._sequence,
            "source": "mavlink",
            "payload": {
                "type": "SNAPSHOT",
                "position": {"latitude": float(telemetry.get("latitude", 0.0)), "longitude": float(telemetry.get("longitude", 0.0)), "altitude": float(telemetry.get("altitude", 0.0)), "north": north, "east": east},
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
    {"id": "campus", "name": "校园训练场", "description": "包含教学楼、操场和开阔起降区的基础教学场景。", "latitude": 34.1251589, "longitude": 108.8289653, "altitude": 412, "weather": "晴朗 · 22°C", "wind": "东北风 1.2 m/s", "image": "campus"},
    {"id": "city", "name": "城市训练场", "description": "通过密集街区影像理解视距、遮挡与安全飞行限制。", "latitude": 37.7702, "longitude": -122.415, "altitude": 15, "weather": "晴朗 · 20°C", "wind": "西风 2.4 m/s", "image": "city"},
    {"id": "mountain", "name": "山地训练场", "description": "观察山地环境，练习高度约束与返航决策。", "latitude": 37.75, "longitude": -119.58, "altitude": 1220, "weather": "多云 · 15°C", "wind": "山谷风 2.8 m/s", "image": "mountain"},
    {"id": "airport", "name": "机场训练场", "description": "仅用于模拟开放区域起降，真实机场及管制空域不得擅自飞行。", "latitude": 37.618, "longitude": -122.375, "altitude": 4, "weather": "晴朗 · 19°C", "wind": "西风 1.6 m/s", "image": "airport"},
    {"id": "training-field", "name": "标准训练场", "description": "带标准训练点和航线标记的封闭训练区域。", "latitude": 34.1266589, "longitude": 108.8313653, "altitude": 415, "weather": "晴朗 · 21°C", "wind": "东风 0.8 m/s", "image": "training-field"},
    {"id": "open-area", "name": "空旷环境", "description": "障碍物较少，适合初次起飞和姿态控制练习。", "latitude": 34.1223589, "longitude": 108.8245653, "altitude": 395, "weather": "多云 · 20°C", "wind": "西北风 2.1 m/s", "image": "open-area"},
]


def create_app(settings: Settings | None = None, gateway: Gateway | None = None, security_range: Gateway | None = None) -> FastAPI:
    configured_settings = settings or Settings.from_env()
    configured_gateway = gateway or Gateway(configured_settings)
    range_settings = replace(
        configured_settings,
        mavlink_endpoint=os.getenv("MUVA_SECURITY_MAVLINK_ENDPOINT", "udpin:0.0.0.0:14652"),
        monitor_endpoint=os.getenv("MUVA_SECURITY_MONITOR_ENDPOINT", "udpin:0.0.0.0:14653"),
    )
    range_gateway = security_range or Gateway(range_settings)
    range_gateway.runtime_processes.log_dir = range_gateway.runtime_processes.log_dir / "security-range"

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.gateway = configured_gateway
        app.state.security_range = range_gateway
        configured_gateway.start()
        range_gateway.start()
        try:
            yield
        finally:
            range_gateway.stop()
            configured_gateway.stop()

    app = FastAPI(
        title="MUVA MAVLink Gateway",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.state.gateway = configured_gateway
    app.state.security_range = range_gateway
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(configured_settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    def gateway_from_request(request: Request) -> Gateway:
        return request.app.state.gateway

    def range_from_request(request: Request) -> Gateway:
        return request.app.state.security_range

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
            "maxAltitude": gateway_instance._flight_max_altitude,
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

    def security_public(run: dict[str, Any]) -> dict[str, Any]:
        result = {key: deepcopy(value) for key, value in run.items() if not key.startswith("_")}
        if run["config"]["mode"] == "assessment" and run["phase"] not in ("completed", "aborted", "failed"):
            result["config"]["caseId"] = "hidden"
            result["seed"] = None
        return result

    def security_require(gateway_instance: Gateway, run_id: str) -> dict[str, Any]:
        run = gateway_instance._security_runs.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="安全实验运行不存在")
        return run

    def security_event(run: dict[str, Any], code: str, detail: str, received_at: int) -> dict[str, Any]:
        event = {"id": f"{run['runId']}-{received_at}-{code}", "code": code, "detail": detail, "receivedAt": received_at, "automatic": True}
        if not any(item["id"] == event["id"] for item in run["evidence"]):
            run["evidence"].append(event)
            run["timeline"].append({"at": received_at, "label": detail, "kind": "detection"})
        return event

    @app.post("/api/v1/security/runs")
    async def security_create(request: Request, payload: SecurityRunRequest) -> dict[str, Any]:
        gateway_instance = gateway_from_request(request)
        snapshot = gateway_instance.vehicle_snapshot()
        if not snapshot["connection"]["connected"]:
            raise HTTPException(status_code=503, detail="真实飞控遥测不可用；API 模式不会回退到模拟数据")
        case_id = payload.caseId if payload.mode == "training" else random.choice(("replay", "degradation"))
        seed = random.SystemRandom().randrange(1, 2**31)
        run_id = f"security-{uuid4().hex}"
        now = int(time.time() * 1000)
        run = {"runId": run_id, "config": {"caseId": case_id, "mode": payload.mode, "difficulty": payload.difficulty}, "caseVersion": "1.0", "seed": seed, "phase": "preparation", "source": "mavlink", "telemetry": None, "evidence": [], "timeline": [{"at": now, "label": "创建专属安全实验运行", "kind": "run"}], "judgment": None, "judgments": [], "evidenceIds": [], "isolation": "not_submitted", "score": None, "_lastSequence": None, "_lastReceivedAt": None, "_baseline": [], "_ticks": 0, "_recoveryCount": 0, "_anomalyStarts": None, "_injection": False, "_isolated": False, "_subscribed": False, "_judgmentRequests": set(), "_startedMonotonic": time.monotonic(), "_recoveryStartedAt": None, "_recoveryMs": None, "_judgedElapsedMs": None, "_reflection": ""}
        gateway_instance._security_runs[run_id] = run
        return security_public(run)

    @app.get("/api/v1/security/runs/{run_id}")
    async def security_get(request: Request, run_id: str) -> dict[str, Any] | None:
        run = gateway_from_request(request)._security_runs.get(run_id)
        return security_public(run) if run else None

    @app.get("/api/v1/security/records")
    async def security_records(request: Request) -> list[dict[str, Any]]:
        return deepcopy(list(gateway_from_request(request)._security_records.values()))

    @app.post("/api/v1/security/runs/{run_id}/baseline")
    async def security_baseline(request: Request, run_id: str) -> dict[str, Any]:
        run = security_require(gateway_from_request(request), run_id)
        if run["phase"] == "preparation":
            run["phase"] = "baseline"
            run["timeline"].append({"at": int(time.time() * 1000), "label": "开始正常遥测对照", "kind": "baseline"})
        return security_public(run)

    @app.post("/api/v1/security/runs/{run_id}/anomaly")
    async def security_anomaly(request: Request, run_id: str) -> dict[str, Any]:
        run = security_require(gateway_from_request(request), run_id)
        if run["phase"] == "baseline":
            run["phase"] = "anomaly"
            run["_injection"] = True
            run["_anomalyStarts"] = time.monotonic() + 2.0
            run["timeline"].append({"at": int(time.time() * 1000), "label": "异常观察阶段开始（触发方案保留在服务端）", "kind": "anomaly"})
        return security_public(run)

    @app.post("/api/v1/security/runs/{run_id}/judgment")
    async def security_judgment(request: Request, run_id: str, payload: SecurityJudgmentRequest) -> dict[str, Any]:
        run = security_require(gateway_from_request(request), run_id)
        if payload.requestId not in run["_judgmentRequests"] and run["phase"] in ("baseline", "anomaly"):
            known = {item["id"] for item in run["evidence"]}
            run["_judgmentRequests"].add(payload.requestId)
            evidence_ids = list(dict.fromkeys(item for item in payload.evidenceIds if item in known))
            false_positive = run["phase"] == "baseline" and payload.judgment != "normal"
            elapsed = int((time.monotonic() - run["_startedMonotonic"]) * 1000)
            run["judgments"].append({"judgment": payload.judgment, "evidenceIds": evidence_ids, "elapsedMs": elapsed, "falsePositive": false_positive})
            if run["phase"] == "anomaly":
                run["judgment"] = payload.judgment
                run["evidenceIds"] = evidence_ids
                run["_judgedElapsedMs"] = elapsed
            run["timeline"].append({"at": int(time.time() * 1000), "label": f"学生提交判断：{payload.judgment}" + ("（正常对照误报）" if false_positive else ""), "kind": "judgment"})
        return security_public(run)

    @app.post("/api/v1/security/runs/{run_id}/isolate")
    async def security_isolate(request: Request, run_id: str) -> dict[str, Any]:
        run = security_require(gateway_from_request(request), run_id)
        if run["isolation"] == "not_submitted":
            run["isolation"] = "submitted"
            run["timeline"].append({"at": int(time.time() * 1000), "label": "提交异常数据隔离请求", "kind": "action"})
            run["isolation"] = "accepted"
            run["_isolated"] = True
            run["isolation"] = "executed"
            run["timeline"].append({"at": int(time.time() * 1000), "label": "Gateway 已隔离当前实验通道异常数据", "kind": "action"})
        return security_public(run)

    @app.post("/api/v1/security/runs/{run_id}/stop-injection")
    async def security_stop_injection(request: Request, run_id: str) -> dict[str, Any]:
        run = security_require(gateway_from_request(request), run_id)
        if run["phase"] == "anomaly":
            run["_injection"] = False
            run["phase"] = "recovery"
            run["_recoveryCount"] = 0
            run["_lastSequence"] = None
            run["_lastReceivedAt"] = None
            run["_recoveryStartedAt"] = time.monotonic()
            run["timeline"].append({"at": int(time.time() * 1000), "label": "停止注入、丢弃待发送数据并恢复实时订阅", "kind": "action"})
        return security_public(run)

    @app.post("/api/v1/security/runs/{run_id}/verify")
    async def security_verify(request: Request, run_id: str) -> dict[str, Any]:
        run = security_require(gateway_from_request(request), run_id)
        if run["phase"] == "recovery" and run["_recoveryCount"] >= 3:
            if run["isolation"] != "verified":
                run["isolation"] = "verified"
                run["_recoveryMs"] = int((time.monotonic() - run["_recoveryStartedAt"]) * 1000) if run["_recoveryStartedAt"] is not None else None
            run["timeline"].append({"at": int(time.time() * 1000), "label": "至少 3 条连续实时遥测验证恢复", "kind": "recovery"})
        else:
            run["error"] = "需要至少 3 条连续实时遥测才能验证恢复"
        return security_public(run)

    def security_score(run: dict[str, Any]) -> dict[str, Any]:
        expected = "replay" if run["config"]["caseId"] == "replay" else "link_anomaly"
        judgment_correct = run["judgment"] == expected
        deductions: list[str] = []
        if not judgment_correct:
            deductions.append("判断与服务端实际事件不符或未提交（-30）")
        if not run["evidenceIds"]:
            deductions.append("未提交有效证据（-15）")
        false_positives = sum(1 for item in run["judgments"] if item["falsePositive"])
        if false_positives:
            deductions.append(f"正常对照误报 {false_positives} 次（每次扣 5 分，最多扣 15 分）")
        sections = {"judgmentEvidence": max(0, (30 if judgment_correct and run["evidenceIds"] else 18 if judgment_correct else 0) - min(15, false_positives * 5)), "timeliness": 15 if judgment_correct and run["_judgedElapsedMs"] is not None and run["_judgedElapsedMs"] <= 30000 else 5 if judgment_correct else 0, "handling": 25 if run["isolation"] in ("executed", "verified") else 0, "recovery": 20 if run["isolation"] == "verified" else 0, "reflection": 10 if len(run["_reflection"].strip()) >= 20 else 0}
        return {"total": sum(sections.values()), "sections": sections, "deductions": deductions}

    async def security_end(request: Request, run_id: str, phase: str, reflection: str = "") -> dict[str, Any]:
        gateway_instance = gateway_from_request(request)
        run = security_require(gateway_instance, run_id)
        if run["phase"] not in ("completed", "aborted", "failed"):
            run["_injection"] = False
            run["_isolated"] = True
            run["_reflection"] = reflection
            run["phase"] = phase
            run["score"] = security_score(run)
            run["timeline"].append({"at": int(time.time() * 1000), "label": "运行结束：停止注入并清理专属通道", "kind": phase})
            gateway_instance._security_records[run_id] = {key: deepcopy(value) for key, value in run.items() if not key.startswith("_")}
            gateway_instance._security_records[run_id]["scoreSource"] = "gateway"
            gateway_instance._security_records[run_id]["scoreVersion"] = "security-score-v1"
            gateway_instance._security_records[run_id]["reflection"] = reflection
            gateway_instance._security_records[run_id]["limitations"] = ["未评价飞行任务完成率、真实飞控防御或真实网络攻击阻断效果", "当前 Gateway 无真实身份认证，不构成防篡改正式考试"]
            gateway_instance.save_platform_data()
        report = deepcopy(gateway_instance._security_records.get(run_id, {}))
        report["recoveryMs"] = run["_recoveryMs"]
        return report

    @app.post("/api/v1/security/runs/{run_id}/finish")
    async def security_finish(request: Request, run_id: str, payload: SecurityReflectionRequest) -> dict[str, Any]:
        return await security_end(request, run_id, "completed", payload.reflection)

    @app.post("/api/v1/security/runs/{run_id}/abort")
    async def security_abort(request: Request, run_id: str) -> dict[str, Any]:
        return await security_end(request, run_id, "aborted")

    @app.websocket("/ws/security/{run_id}")
    async def security_telemetry(websocket: WebSocket, run_id: str) -> None:
        gateway_instance: Gateway = websocket.app.state.gateway
        run = gateway_instance._security_runs.get(run_id)
        if run is None:
            await websocket.close(code=4404, reason="Security run not found")
            return
        if run["_subscribed"]:
            await websocket.close(code=4409, reason="Security run already has an active subscriber")
            return
        run["_subscribed"] = True
        await websocket.accept()
        last_sent: dict[str, Any] | None = None
        try:
            while run["phase"] not in ("completed", "aborted", "failed"):
                snapshot = gateway_instance.state.snapshot(gateway_instance.settings.mavlink_endpoint)
                if not snapshot["connection"]["connected"]:
                    if run["phase"] == "recovery":
                        run["_recoveryCount"] = 0
                    await websocket.send_json({"protocolVersion": "security.telemetry.v1", "type": "security.sample", "sample": {"protocolVersion": "security.telemetry.v1", "runId": run_id, "source": "mavlink", "sequence": last_sent["sequence"] if last_sent else 0, "capturedAt": last_sent["capturedAt"] if last_sent else 0, "receivedAt": int(time.time() * 1000), "elapsedMs": int((time.monotonic() - run["_startedMonotonic"]) * 1000), "altitude": last_sent["altitude"] if last_sent else 0, "speed": last_sent["speed"] if last_sent else 0, "battery": last_sent["battery"] if last_sent else 0, "stale": True, "connection": "unavailable"}})
                    await asyncio.sleep(1)
                    continue
                envelope = gateway_instance.telemetry_envelope()
                run["_ticks"] += 1
                now = int(time.time() * 1000)
                if run["phase"] == "baseline":
                    run["_baseline"].append(deepcopy(envelope))
                    run["_baseline"] = run["_baseline"][-12:]
                inject = bool(run["_injection"] and not run["_isolated"] and run["_anomalyStarts"] and time.monotonic() >= run["_anomalyStarts"])
                interrupted = inject and run["config"]["caseId"] == "degradation" and run["config"]["difficulty"] == "high" and run["_ticks"] % 8 == 0
                dropped = inject and run["config"]["caseId"] == "degradation" and run["_ticks"] % (7 if run["config"]["difficulty"] == "low" else 4) == 0
                if dropped:
                    await asyncio.sleep(1)
                    continue
                if inject and run["config"]["caseId"] == "replay" and run["_baseline"]:
                    envelope = deepcopy(run["_baseline"][0])
                if interrupted and last_sent:
                    envelope = deepcopy(last_sent)
                if inject and run["config"]["caseId"] == "degradation":
                    delay = {"low": 0.35, "medium": 0.8, "high": 1.2}[run["config"]["difficulty"]]
                    await asyncio.sleep(delay)
                    if run["phase"] != "anomaly" or not run["_injection"] or run["_isolated"]:
                        continue
                now = int(time.time() * 1000)
                telemetry = envelope["payload"]
                captured_at = int(envelope["timestamp"])
                sequence = int(envelope["sequence"])
                stale = interrupted or now - captured_at > 2500
                previous_sequence = run["_lastSequence"]
                previous_received_at = run["_lastReceivedAt"]
                sequence_delta = sequence - previous_sequence if previous_sequence is not None else None
                missing_rate = ((sequence_delta - 1) / sequence_delta * 100) if sequence_delta and sequence_delta > 1 else 0.0 if sequence_delta == 1 else None
                receive_interval = now - previous_received_at if previous_received_at is not None else None
                sample = {"protocolVersion": "security.telemetry.v1", "runId": run_id, "source": "mavlink", "sequence": sequence, "capturedAt": captured_at, "receivedAt": now, "elapsedMs": int((time.monotonic() - run["_startedMonotonic"]) * 1000), "receiveIntervalMs": receive_interval, "missingRatePct": missing_rate, "altitude": float(telemetry["position"]["altitude"]), "speed": float(telemetry["velocity"]["groundSpeed"]), "battery": float(telemetry["batteryPercent"]), "stale": stale, "connection": "interrupted" if interrupted else "connected"}
                if run["_lastSequence"] is not None and sequence <= run["_lastSequence"]:
                    code = "duplicate_sequence" if sequence == run["_lastSequence"] else "sequence_regression"
                    security_event(run, code, f"接收序列 {sequence} 未超过实验通道前序 {run['_lastSequence']}", now)
                elif sequence_delta is not None and sequence_delta > 1:
                    security_event(run, "packet_loss", f"实验通道序列缺口 {sequence_delta - 1}；估算缺失率 {missing_rate:.1f}%", now)
                if stale:
                    security_event(run, "stale_data", f"遥测数据年龄 {now - captured_at} ms，超过 2500 ms", now)
                if sample["connection"] == "interrupted":
                    security_event(run, "connection_interrupted", "当前实验页面遥测订阅发生短时中断；不代表飞控失联", now)
                if run["_lastReceivedAt"] and now - run["_lastReceivedAt"] > 2500:
                    security_event(run, "receive_gap", f"页面接收间隔 {now - run['_lastReceivedAt']} ms", now)
                if run["phase"] == "recovery":
                    run["_recoveryCount"] = run["_recoveryCount"] + 1 if sequence > (run["_lastSequence"] or -1) and not stale else 0
                    if run["_recoveryCount"] >= 3:
                        security_event(run, "recovered", "实时遥测连续恢复", now)
                run["_lastSequence"] = sequence
                run["_lastReceivedAt"] = now
                run["telemetry"] = sample
                run["timeline"] = run["timeline"][-500:]
                run["evidence"] = run["evidence"][-500:]
                await websocket.send_json({"protocolVersion": "security.telemetry.v1", "type": "security.sample", "sample": sample})
                if run["evidence"]:
                    await websocket.send_json({"protocolVersion": "security.telemetry.v1", "type": "security.evidence", "evidence": run["evidence"][-4:]})
                last_sent = sample
                await asyncio.sleep(1)
        except (WebSocketDisconnect, RuntimeError):
            LOGGER.info("Security telemetry subscriber disconnected for %s", run_id)
        finally:
            run["_subscribed"] = False

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
        experiment_id = f"muva-exp-{uuid4().hex}"
        session = {"id": experiment_id, "name": payload.name, "drone": payload.drone, "scene": payload.scene, "createdAt": now, "startedAt": None, "status": "CREATED", "configuration": payload.configuration}
        with gateway_instance._platform_lock:
            gateway_instance._sessions[experiment_id] = session
        gateway_instance.save_platform_data()
        return deepcopy(session)

    @app.post("/api/v1/experiments/configuration")
    async def v1_save_configuration(request: Request, payload: ExperimentConfigurationRequest) -> dict[str, bool]:
        gateway_instance = gateway_from_request(request)
        state = payload.model_dump(exclude_none=True)
        gateway_instance._current_configuration = state
        if payload.progressId:
            gateway_instance._progress[payload.progressId] = state
        gateway_instance.save_platform_data()
        return {"ok": True}

    @app.get("/api/v1/experiments/progress/{progress_id}")
    async def v1_load_progress(request: Request, progress_id: str) -> dict[str, Any] | None:
        return deepcopy(gateway_from_request(request)._progress.get(progress_id))

    @app.delete("/api/v1/experiments/progress/{progress_id}")
    async def v1_clear_progress(request: Request, progress_id: str) -> dict[str, bool]:
        gateway_instance = gateway_from_request(request)
        gateway_instance._progress.pop(progress_id, None)
        gateway_instance.save_platform_data()
        return {"ok": True}

    @app.put("/api/v1/experiments/{experiment_id}/assessment")
    async def v1_save_assessment(request: Request, experiment_id: str, payload: dict[str, Any]) -> dict[str, bool]:
        gateway_instance = gateway_from_request(request)
        if experiment_id not in gateway_instance._sessions or payload.get("sessionId") != experiment_id:
            raise HTTPException(status_code=404, detail="实验 Session 不存在或评分 Session 不匹配")
        gateway_instance._assessments[experiment_id] = deepcopy(payload)
        gateway_instance.save_platform_data()
        return {"ok": True}

    @app.get("/api/v1/experiments/{experiment_id}/assessment")
    async def v1_load_assessment(request: Request, experiment_id: str) -> dict[str, Any] | None:
        return deepcopy(gateway_from_request(request)._assessments.get(experiment_id))

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
        if session is None:
            raise HTTPException(status_code=404, detail="实验 Session 不存在")
        session["status"] = "FINISHED"
        result = deepcopy(payload)
        gateway_instance.save_platform_data()
        return result

    @app.post("/api/v1/experiments/{experiment_id}/record")
    async def v1_save_record(request: Request, experiment_id: str, payload: dict[str, Any]) -> dict[str, bool]:
        gateway_instance = gateway_from_request(request)
        if experiment_id not in gateway_instance._sessions or payload.get("id") != experiment_id:
            raise HTTPException(status_code=404, detail="实验 Session 不存在或记录 ID 不匹配")
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
        return gateway_from_request(request).runtime_status()

    @app.get("/api/v1/security/range/status")
    async def security_range_status(request: Request) -> dict[str, Any]:
        target = range_from_request(request)
        return {"runtime": target.runtime_status(), "vehicle": target.vehicle_snapshot(), "active": target._runtime_active}

    @app.post("/api/v1/security/range/start")
    async def security_range_start(request: Request) -> dict[str, Any]:
        target = range_from_request(request)
        if target._runtime_active:
            runtime = target.runtime_status()
            if runtime["gazebo"] == "RUNNING" and runtime["ardupilotSitl"] == "RUNNING":
                return {"runtime": runtime, "vehicle": target.vehicle_snapshot(), "active": True}
            target.append_runtime_log("RECOVERING_SIMULATION", "检测到靶场进程未完整运行，正在重新启动 Gazebo / SITL")
            target._runtime_active = False
            target.monitor.stop()
            target.transport.stop()
            target.state.set_transport_connected(False)
        target.append_runtime_log("STARTING_SIMULATION", "正在启动实验四专属 Gazebo / SITL 靶场")
        started_processes: list[str] = []
        try:
            started_processes = target.runtime_processes.start({
                "MUVA_SITL_MAVLINK_PORT": os.getenv("MUVA_SECURITY_SITL_MAVLINK_PORT", "14652"),
                "MUVA_SITL_MONITOR_PORT": os.getenv("MUVA_SECURITY_SITL_MONITOR_PORT", "14653"),
            }) or []
            target.transport.start()
            target.monitor.start()
            target._runtime_active = True
            readiness = target.runtime_status()
            if readiness["gazebo"] != "RUNNING" or readiness["ardupilotSitl"] != "RUNNING":
                raise RuntimeError(
                    "启动命令已执行，但未检测到 Gazebo 与 ArduPilot SITL 均在运行；请检查靶场运行日志"
                )
            snapshot = target.vehicle_snapshot()
            if readiness["gps"] != "3D FIX" or readiness["ekf"] != "HEALTHY" or not snapshot["home"].get("valid"):
                target.append_runtime_log(
                    "WAITING_FOR_TELEMETRY",
                    "仿真进程仍在运行，飞控 GPS、IMU/EKF 或 HOME 尚未就绪；保留进程并继续等待遥测",
                )
            target._flight_max_altitude = 10.0
        except Exception as error:
            target._runtime_active = False
            target.monitor.stop()
            target.transport.stop()
            if started_processes:
                target.runtime_processes.stop(started_processes)
            raise HTTPException(status_code=503, detail=f"实验四靶场启动失败：{error}") from error
        return {"runtime": target.runtime_status(), "vehicle": target.vehicle_snapshot(), "active": True}

    @app.post("/api/v1/security/range/stop")
    async def security_range_stop(request: Request) -> dict[str, bool]:
        target = range_from_request(request)
        if target._runtime_active:
            connection = target.vehicle_snapshot()["connection"]
            if not connection["connected"] or connection.get("lastHeartbeatAgeMs") is None or connection["lastHeartbeatAgeMs"] > target.settings.heartbeat_timeout * 1000:
                raise HTTPException(status_code=409, detail="飞控心跳离线或过期，无法确认落地状态；靶场保持运行，请恢复心跳后再关闭")
        snapshot = target.vehicle_snapshot()
        if snapshot["vehicle"].get("armed") or abs(float(snapshot["telemetry"].get("altitude", 0))) > 0.5:
            raise HTTPException(status_code=409, detail="请先安全降落并确认飞行器已锁定、位于地面，再关闭靶场")
        target._runtime_active = False
        target.monitor.stop()
        target.transport.stop()
        target.runtime_processes.stop()
        target.state.set_transport_connected(False)
        return {"ok": True}

    @app.post("/api/v1/security/range/takeoff")
    async def security_range_takeoff(request: Request, payload: TakeoffRequest) -> dict[str, Any]:
        target = range_from_request(request)
        if not target._runtime_active:
            raise HTTPException(status_code=409, detail="请先启动实验四专属靶场")
        if payload.altitude > 10:
            raise HTTPException(status_code=422, detail="靶场最大起飞高度为 10 米")
        readiness = target.runtime_status()
        if readiness["gps"] != "3D FIX" or readiness["ekf"] != "HEALTHY":
            raise HTTPException(status_code=409, detail="飞控尚未就绪：请等待 GPS 3D 定位和 IMU/EKF 健康后再起飞")
        if not target.vehicle_snapshot()["home"].get("valid"):
            raise HTTPException(status_code=409, detail="飞控 HOME 尚未建立，请等待定位完成后再起飞")
        await asyncio.to_thread(target.commands.arm, True)
        return await asyncio.to_thread(target.commands.takeoff, payload.altitude)

    @app.post("/api/v1/security/range/move")
    async def security_range_move(request: Request, payload: VehicleMoveRequest) -> dict[str, Any]:
        target = range_from_request(request)
        if not target._runtime_active:
            raise HTTPException(status_code=409, detail="请先启动实验四专属靶场")
        if payload.direction not in ("forward", "backward", "left", "right") or not 0 < payload.meters <= 5:
            raise HTTPException(status_code=422, detail="仅支持前后左右移动，单次距离须在 0–5 米内")
        snapshot = target.vehicle_snapshot()
        if not snapshot["connection"]["connected"] or snapshot["connection"].get("lastHeartbeatAgeMs") is None or snapshot["connection"]["lastHeartbeatAgeMs"] > target.settings.heartbeat_timeout * 1000:
            raise HTTPException(status_code=409, detail="飞控心跳已过期，拒绝发送位置指令")
        if not snapshot["vehicle"].get("armed") or float(snapshot["telemetry"].get("altitude", 0)) < 1:
            raise HTTPException(status_code=409, detail="前后左右操作仅允许在已解锁且离地 1 米以上时执行")
        if not snapshot["home"].get("valid"):
            raise HTTPException(status_code=409, detail="飞控 HOME 无效，拒绝发送位置指令")
        return await asyncio.to_thread(target.commands.move, payload.direction, payload.meters)

    @app.post("/api/v1/security/range/mission-start")
    async def security_range_mission_start(request: Request, payload: RouteExecutionRequest) -> dict[str, Any]:
        target = range_from_request(request)
        snapshot = target.vehicle_snapshot()
        runtime = target.runtime_status()
        if not target._runtime_active or runtime["ardupilotSitl"] != "RUNNING" or runtime["gazebo"] != "RUNNING":
            raise HTTPException(status_code=409, detail="请先启动实验四 Gazebo / SITL 靶场")
        if not snapshot["connection"]["connected"] or snapshot["connection"].get("lastHeartbeatAgeMs") is None or snapshot["connection"]["lastHeartbeatAgeMs"] > target.settings.heartbeat_timeout * 1000:
            raise HTTPException(status_code=409, detail="飞控心跳已过期，不能执行航线")
        if snapshot["vehicle"].get("armed") or abs(float(snapshot["telemetry"].get("altitude", 999))) > 0.5:
            raise HTTPException(status_code=409, detail="执行新航线前必须确认无人机已落地并锁定")
        home = snapshot["home"]
        if not home.get("valid"):
            raise HTTPException(status_code=409, detail="飞控 HOME 无效")
        for index, point in enumerate(payload.waypoints):
            lat, lon = float(point["latitude"]), float(point["longitude"])
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                raise HTTPException(status_code=422, detail=f"第 {index + 1} 个航点坐标无效")
        altitude = min(10.0, max(2.0, target._flight_max_altitude))
        mission = [{"command": "TAKEOFF", "latitude": home["latitude"], "longitude": home["longitude"], "altitude": 6.0}]
        mission.extend({"command": "WAYPOINT", "latitude": p["latitude"], "longitude": p["longitude"], "altitude": altitude} for p in payload.waypoints)
        mission.append({"command": "LAND", "latitude": home["latitude"], "longitude": home["longitude"], "altitude": 0.0})
        uploaded = await asyncio.to_thread(target.missions.upload, mission, True)
        await asyncio.to_thread(target.commands.arm, True)
        started = await asyncio.to_thread(target.missions.start, target.commands)
        return {"accepted": True, "effect": "original_mission_started", "uploaded": uploaded, "mission": started}

    @app.post("/api/v1/security/range/inject-waypoint")
    async def security_range_inject_waypoint(request: Request, payload: WaypointInjectionRequest) -> dict[str, Any]:
        target = range_from_request(request)
        if not target._runtime_active:
            raise HTTPException(status_code=409, detail="请先启动实验四专属靶场")
        snapshot = target.vehicle_snapshot()
        if not snapshot["connection"]["connected"] or snapshot["connection"].get("lastHeartbeatAgeMs") is None or snapshot["connection"]["lastHeartbeatAgeMs"] > target.settings.heartbeat_timeout * 1000:
            raise HTTPException(status_code=409, detail="飞控心跳已过期，拒绝注入航点")
        if not snapshot["home"].get("valid"):
            raise HTTPException(status_code=409, detail="飞控 HOME 无效，拒绝注入航点")
        if not snapshot["vehicle"].get("armed") or float(snapshot["telemetry"].get("altitude", 0)) < 1:
            raise HTTPException(status_code=409, detail="航点注入仅允许在无人机离地 1 米以上时执行")
        result = await asyncio.to_thread(target.commands.inject_waypoint, payload.latitude, payload.longitude, payload.altitude)
        target.monitor.state.record_local_event("WAYPOINT_INJECTION", "security", "warning", f"lat={payload.latitude:.7f} lon={payload.longitude:.7f} alt={payload.altitude:.1f}")
        return result

    @app.post("/api/v1/security/range/land")
    async def security_range_land(request: Request) -> dict[str, Any]:
        target = range_from_request(request)
        if not target._runtime_active:
            raise HTTPException(status_code=409, detail="实验四专属靶场未启动")
        return await asyncio.to_thread(target.commands.land)

    @app.get("/api/v1/runtime/logs")
    async def v1_runtime_logs(request: Request) -> list[dict[str, Any]]:
        return deepcopy(gateway_from_request(request)._runtime_logs)

    @app.post("/api/v1/runtime/start")
    async def v1_runtime_start(request: Request, payload: dict[str, Any]) -> dict[str, str]:
        gateway_instance = gateway_from_request(request)
        experiment_id = payload.get("experimentId")
        if not isinstance(experiment_id, str) or experiment_id not in gateway_instance._sessions:
            raise HTTPException(status_code=404, detail="实验 Session 不存在，请先创建实验")
        parameters = payload.get("flightParameters", {})
        try:
            maximum = float(parameters["maxAltitude"])
        except (KeyError, TypeError, ValueError):
            raise HTTPException(status_code=422, detail="最大飞行高度无效") from None
        if not 2 <= maximum <= 120:
            raise HTTPException(status_code=422, detail="最大飞行高度必须在 2–120 米之间")
        if gateway_instance.vehicle_snapshot()["vehicle"].get("armed", False):
            raise HTTPException(status_code=409, detail="飞行器仍处于解锁状态，不能启动或重启仿真")
        gateway_instance.append_runtime_log("STARTING_SIMULATION", "正在启动 Gazebo 与 ArduPilot SITL")
        try:
            gateway_instance.runtime_processes.start()
            gateway_instance.transport.start()
            gateway_instance.monitor.start()
            gateway_instance.append_runtime_log("STARTING_MAVLINK_GATEWAY", "正在连接 MAVLink Gateway")
            deadline = time.monotonic() + max(10.0, gateway_instance.settings.heartbeat_timeout * 8)
            while time.monotonic() < deadline and not gateway_instance.state.is_online():
                await asyncio.sleep(0.1)
            if not gateway_instance.state.is_online():
                raise ConnectionError("No recent vehicle heartbeat")
        except Exception as error:
            gateway_instance._runtime_active = False
            gateway_instance.monitor.stop()
            gateway_instance.transport.stop()
            gateway_instance.runtime_processes.stop()
            gateway_instance.append_runtime_log("ERROR", f"仿真环境启动失败：{error}")
            raise HTTPException(status_code=503, detail=f"仿真环境启动失败：{error}") from error
        gateway_instance._runtime_active = True
        gateway_instance._flight_max_altitude = maximum
        gateway_instance._sessions[experiment_id]["status"] = "RUNNING"
        gateway_instance.save_platform_data()
        runtime = gateway_instance.runtime_status()
        gateway_instance.append_runtime_log("READY" if runtime["vehicle"] == "ONLINE" else "WAITING_HEARTBEAT", "仿真环境 READY" if runtime["vehicle"] == "ONLINE" else "等待飞行器 Heartbeat")
        return runtime

    @app.post("/api/v1/runtime/stop")
    async def v1_runtime_stop(request: Request) -> dict[str, bool]:
        gateway_instance = gateway_from_request(request)
        if gateway_instance.vehicle_snapshot()["vehicle"].get("armed", False):
            raise HTTPException(status_code=409, detail="飞行器仍处于解锁状态，请先降落并锁定后再结束训练")
        gateway_instance._runtime_active = False
        gateway_instance.monitor.stop()
        gateway_instance.transport.stop()
        gateway_instance.runtime_processes.stop()
        gateway_instance.state.set_transport_connected(False)
        gateway_instance.append_runtime_log("IDLE", "环境已停止")
        return {"ok": True}

    @app.post("/api/v1/system/sensors/check")
    async def v1_sensor_check(request: Request) -> list[dict[str, Any]]:
        gateway_instance = gateway_from_request(request)
        context = safety_context(gateway_instance)
        connected = bool(context["vehicleOnline"])
        telemetry = gateway_instance.vehicle_snapshot()["telemetry"]
        present = int(telemetry.get("sensorsPresent", 0))
        enabled = int(telemetry.get("sensorsEnabled", 0))
        health = int(telemetry.get("sensorsHealth", 0))
        def sensor_healthy(*names: str) -> bool:
            mask = 0
            for name in names:
                mask |= int(getattr(mavutil.mavlink, f"MAV_SYS_STATUS_SENSOR_{name}"))
            return connected and present & mask == mask and enabled & mask == mask and health & mask == mask
        gps_ok = connected and int(telemetry.get("gpsFixType", 0)) >= 3 and context["gpsSatellites"] >= 6
        imu_ok = sensor_healthy("3D_GYRO", "3D_ACCEL")
        compass_ok = sensor_healthy("3D_MAG")
        barometer_ok = sensor_healthy("ABSOLUTE_PRESSURE")
        ekf_ok = gps_ok and imu_ok and context["ekfHealthy"]
        return [
            {"id": "heartbeat", "name": "Heartbeat", "status": "PASS" if connected else "FAIL", "details": ["Heartbeat OK" if connected else "Heartbeat unavailable", "Vehicle ONLINE" if connected else "Vehicle offline"]},
            {"id": "gps", "name": "GPS", "status": "PASS" if gps_ok else "FAIL", "details": ["3D Fix" if gps_ok else "Fix unavailable", f"{context['gpsSatellites']} satellites", "HDOP from vehicle telemetry"]},
            {"id": "imu", "name": "IMU", "status": "PASS" if imu_ok else "FAIL", "details": ["SYS_STATUS gyro/accelerometer health" if imu_ok else "SYS_STATUS IMU unavailable or unhealthy"]},
            {"id": "compass", "name": "Compass", "status": "PASS" if compass_ok else "FAIL", "details": ["SYS_STATUS magnetometer health" if compass_ok else "SYS_STATUS compass unavailable or unhealthy"]},
            {"id": "barometer", "name": "Barometer", "status": "PASS" if barometer_ok else "FAIL", "details": ["SYS_STATUS pressure health" if barometer_ok else "SYS_STATUS barometer unavailable or unhealthy"]},
            {"id": "ekf", "name": "EKF", "status": "PASS" if ekf_ok else "FAIL", "details": ["GPS fix and SYS_STATUS IMU health (EKF inferred)" if ekf_ok else "GPS/IMU unavailable; EKF cannot be inferred"]},
        ]

    @app.post("/api/v1/flight/preflight")
    async def v1_preflight(request: Request, payload: dict[str, Any]) -> list[dict[str, Any]]:
        gateway_instance = gateway_from_request(request)
        runtime = gateway_instance.runtime_status()
        config = payload.get("configuration", {}) if isinstance(payload, dict) else {}
        parameters = config.get("flightParameters", {}) if isinstance(config, dict) else {}
        observed_sensors = await v1_sensor_check(request)
        sensor_by_id = {item["id"]: item for item in observed_sensors}
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
            ("home", "Home Position Set", bool(gateway_instance.vehicle_snapshot()["home"].get("valid")), "SITL Home Position 未设置"),
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

    @app.post("/api/v1/security/simulation/motor-stop")
    async def v1_security_simulation_motor_stop(request: Request) -> dict[str, Any]:
        gateway_instance = range_from_request(request)
        runtime = gateway_instance.runtime_status()
        if not gateway_instance._runtime_active or runtime["ardupilotSitl"] != "RUNNING" or runtime["gazebo"] != "RUNNING":
            raise HTTPException(status_code=409, detail="该攻击仅允许在 Gateway 管理的本地 ArduPilot SITL 仿真运行时执行")
        snapshot = gateway_instance.vehicle_snapshot()
        if not snapshot["connection"]["connected"] or snapshot["connection"].get("lastHeartbeatAgeMs") is None or snapshot["connection"]["lastHeartbeatAgeMs"] > gateway_instance.settings.heartbeat_timeout * 1000:
            raise HTTPException(status_code=409, detail="飞控心跳已过期，拒绝发送电机停止攻击")
        if not snapshot["vehicle"].get("armed") or float(snapshot["telemetry"].get("altitude", 0)) < 1:
            raise HTTPException(status_code=409, detail="电机停止攻击仅允许在已解锁且离地 1 米以上时执行")
        return await asyncio.to_thread(gateway_instance.commands.simulation_motor_stop)

    @app.post("/api/v1/security/simulation/waypoint-tampering")
    async def v1_security_waypoint_tampering(request: Request, payload: WaypointTamperingRequest) -> dict[str, Any]:
        gateway_instance = range_from_request(request)
        runtime = gateway_instance.runtime_status()
        if not gateway_instance._runtime_active or runtime["ardupilotSitl"] != "RUNNING" or runtime["gazebo"] != "RUNNING":
            raise HTTPException(status_code=409, detail="航点篡改仅允许在 Gateway 管理的本地 Gazebo / SITL 运行时执行")
        snapshot = gateway_instance.vehicle_snapshot()
        if not snapshot["connection"]["connected"] or snapshot["connection"].get("lastHeartbeatAgeMs") is None or snapshot["connection"]["lastHeartbeatAgeMs"] > gateway_instance.settings.heartbeat_timeout * 1000:
            raise HTTPException(status_code=409, detail="飞控心跳已过期，拒绝替换任务")
        if snapshot["vehicle"].get("armed"):
            raise HTTPException(status_code=409, detail="无人机已解锁；请先安全降落并锁定，再规划篡改航线")
        telemetry = snapshot["telemetry"]
        if abs(float(telemetry.get("altitude", 999))) > 0.5:
            raise HTTPException(status_code=409, detail="当前高度未确认在地面，拒绝替换任务")
        home = snapshot["home"]
        if not home.get("valid"):
            raise HTTPException(status_code=409, detail="飞控 HOME 无效，不能安全限定航线范围")

        home_lat = float(home["latitude"])
        home_lon = float(home["longitude"])
        latitude_scale = 111_111.0
        longitude_scale = latitude_scale * max(0.01, abs(math.cos(home_lat * math.pi / 180)))
        points: list[tuple[float, float]] = []
        for index, point in enumerate(payload.waypoints):
            lat, lon = float(point.get("latitude", float("nan"))), float(point.get("longitude", float("nan")))
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                raise HTTPException(status_code=422, detail=f"第 {index + 1} 个航点坐标无效")
            points.append((lat, lon))

        target_index = len(points) // 2
        before = points[max(0, target_index - 1)]
        target = points[target_index]
        after = points[min(len(points) - 1, target_index + 1)]
        north_delta = (after[0] - before[0]) * latitude_scale
        east_delta = (after[1] - before[1]) * longitude_scale
        length = (north_delta * north_delta + east_delta * east_delta) ** 0.5
        if length < 0.1:
            raise HTTPException(status_code=422, detail="相邻航点重合，无法计算航点篡改方向")
        side = 1 if payload.offsetSide == "right" else -1
        changed = list(points)
        changed[target_index] = (
            target[0] + side * east_delta / length * 6 / latitude_scale,
            target[1] - side * north_delta / length * 6 / longitude_scale,
        )
        altitude = min(10.0, max(2.0, gateway_instance._flight_max_altitude))
        mission_items = [{"command": "TAKEOFF", "latitude": home_lat, "longitude": home_lon, "altitude": 6.0}]
        mission_items.extend({"command": "WAYPOINT", "latitude": lat, "longitude": lon, "altitude": altitude} for lat, lon in changed)
        mission_items.append({"command": "LAND", "latitude": home_lat, "longitude": home_lon, "altitude": 0.0})
        await asyncio.to_thread(gateway_instance.missions.upload, mission_items, True)
        await asyncio.to_thread(gateway_instance.commands.arm, True)
        result = await asyncio.to_thread(gateway_instance.missions.start, gateway_instance.commands)
        gateway_instance.monitor.state.record_local_event("MISSION_TAMPER", "security", "warning", f"waypoint={target_index + 1} offset=6m side={payload.offsetSide}")
        return {"accepted": True, "effect": "mission_replaced_and_started", "tamperedIndex": target_index, "offsetMeters": 6.0, "mission": result}

    @app.post("/api/v1/vehicle/takeoff")
    async def v1_vehicle_takeoff(request: Request, payload: dict[str, Any]) -> dict[str, Any]:
        gateway_instance = gateway_from_request(request)
        altitude = float(payload.get("altitudeMeters", payload.get("altitude", 0)))
        if altitude > gateway_instance._flight_max_altitude:
            raise HTTPException(status_code=422, detail="起飞高度超过实验配置的最大飞行高度")
        return await asyncio.to_thread(gateway_instance.commands.takeoff, altitude)

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
        gateway_instance = gateway_from_request(request)
        if payload.direction == "up" and float(gateway_instance.state.telemetry_value("altitude") or 0) + payload.meters > gateway_instance._flight_max_altitude:
            raise HTTPException(status_code=422, detail="上升目标超过实验配置的最大飞行高度")
        return await asyncio.to_thread(gateway_instance.commands.move, payload.direction, payload.meters)

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
        await asyncio.to_thread(gateway_instance.missions.clear)
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
