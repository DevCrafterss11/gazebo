from __future__ import annotations

import asyncio
import logging
import threading
from contextlib import asynccontextmanager
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

    def start(self) -> None:
        self.transport.start()
        self.monitor.start()

    def stop(self) -> None:
        self.monitor.stop()
        self.transport.stop()


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
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    @app.exception_handler(GatewayCommandError)
    async def handle_command_error(_request: Request, error: GatewayCommandError) -> JSONResponse:
        return JSONResponse(status_code=error.status_code, content={"detail": str(error)})

    @app.get("/api/health")
    async def health(request: Request) -> dict[str, Any]:
        gateway_instance: Gateway = request.app.state.gateway
        snapshot = gateway_instance.state.snapshot(gateway_instance.settings.mavlink_endpoint)
        return {
            "status": "ok",
            "vehicleConnected": snapshot["connection"]["connected"],
            "endpoint": gateway_instance.settings.mavlink_endpoint,
        }

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
        result = await asyncio.to_thread(request.app.state.gateway.commands.set_mode, payload.mode)
        return {"ok": True, "result": result}

    @app.post("/api/commands/arm")
    async def arm(request: Request, payload: ArmRequest) -> dict[str, Any]:
        result = await asyncio.to_thread(request.app.state.gateway.commands.arm, payload.arm)
        return {"ok": True, "result": result}

    @app.post("/api/commands/takeoff")
    async def takeoff(request: Request, payload: TakeoffRequest) -> dict[str, Any]:
        result = await asyncio.to_thread(request.app.state.gateway.commands.takeoff, payload.altitude)
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
                    await websocket.send_json(snapshot)
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

    return app


app = create_app()
