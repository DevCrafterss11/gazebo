from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .commands import GatewayCommandError
from .swarm_sitl import SwarmSitlRuntime


class ConfigureRequest(BaseModel):
    config: dict[str, Any]


class UploadRequest(BaseModel):
    sessionId: str
    planId: str = Field(min_length=1, max_length=128)
    missions: list[dict[str, Any]]


class CommandRequest(BaseModel):
    sessionId: str
    action: str
    droneId: str | None = None


def create_swarm_app(runtime: SwarmSitlRuntime | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        application.state.runtime = runtime or SwarmSitlRuntime()
        try:
            yield
        finally:
            application.state.runtime.close()

    application = FastAPI(title="MUVA Experiment 2 native SITL", lifespan=lifespan)
    origins = os.getenv("MUVA_SWARM_CORS_ORIGINS", "http://127.0.0.1:5174,http://localhost:5174").split(",")
    application.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

    @application.exception_handler(GatewayCommandError)
    async def command_error(_request: Any, error: GatewayCommandError):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=error.status_code, content={"detail": str(error)})

    @application.get("/api/swarm/health")
    def health():
        service = application.state.runtime
        return {"experiment": 2, "mode": "sitl", "gazebo": False, "ekfPreflight": True,
                "sitlBinaryAvailable": service.binary.is_file(), "sessionId": service.session_id}

    @application.post("/api/swarm/configure")
    def configure(request: ConfigureRequest):
        return application.state.runtime.initialize(request.config)

    @application.get("/api/swarm/status")
    def status(sessionId: str):
        service = application.state.runtime
        service.require_session(sessionId)
        return service.snapshot()

    @application.post("/api/swarm/missions")
    def upload(request: UploadRequest):
        service = application.state.runtime
        service.require_session(request.sessionId)
        return service.upload(request.missions, request.planId)

    @application.post("/api/swarm/command")
    def command(request: CommandRequest):
        service = application.state.runtime
        service.require_session(request.sessionId)
        return service.command(request.action, request.droneId)

    @application.post("/api/swarm/shutdown")
    def shutdown(request: CommandRequest):
        service = application.state.runtime
        service.shutdown(request.sessionId)
        return {"stopped": True}

    @application.websocket("/ws/swarm")
    async def telemetry(socket: WebSocket):
        if socket.headers.get("origin") not in origins:
            await socket.close(code=1008)
            return
        await socket.accept()
        try:
            while True:
                service = application.state.runtime
                service.require_session(socket.query_params.get("sessionId", ""))
                await socket.send_json(service.snapshot())
                await asyncio.sleep(.2)
        except WebSocketDisconnect:
            return
        except GatewayCommandError:
            await socket.close(code=1008)

    return application


app = create_swarm_app()
