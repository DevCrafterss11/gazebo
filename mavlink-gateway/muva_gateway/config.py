from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    mavlink_endpoint: str = "udpin:0.0.0.0:14552"
    monitor_endpoint: str = "udpin:0.0.0.0:14553"
    source_system: int = 254
    source_component: int = 190
    heartbeat_timeout: float = 3.0
    command_timeout: float = 5.0
    takeoff_timeout: float = 20.0
    mission_retries: int = 3
    allow_in_flight_disarm: bool = False
    telemetry_rate_hz: float = 5.0
    allow_armed_mission_upload: bool = False
    cors_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")

    @classmethod
    def from_env(cls) -> "Settings":
        origins = tuple(
            origin.strip()
            for origin in os.getenv("MUVA_CORS_ORIGINS", ",".join(cls.cors_origins)).split(",")
            if origin.strip()
        )
        return cls(
            mavlink_endpoint=os.getenv("MUVA_MAVLINK_ENDPOINT", cls.mavlink_endpoint),
            monitor_endpoint=os.getenv("MUVA_MONITOR_ENDPOINT", cls.monitor_endpoint),
            source_system=int(os.getenv("MUVA_SOURCE_SYSTEM", cls.source_system)),
            source_component=int(os.getenv("MUVA_SOURCE_COMPONENT", cls.source_component)),
            heartbeat_timeout=float(os.getenv("MUVA_HEARTBEAT_TIMEOUT", cls.heartbeat_timeout)),
            command_timeout=float(os.getenv("MUVA_COMMAND_TIMEOUT", cls.command_timeout)),
            takeoff_timeout=float(os.getenv("MUVA_TAKEOFF_TIMEOUT", cls.takeoff_timeout)),
            mission_retries=max(1, int(os.getenv("MUVA_MISSION_RETRIES", cls.mission_retries))),
            allow_in_flight_disarm=os.getenv("MUVA_ALLOW_IN_FLIGHT_DISARM", "false").lower() in ("1", "true", "yes"),
            telemetry_rate_hz=float(os.getenv("MUVA_TELEMETRY_RATE_HZ", cls.telemetry_rate_hz)),
            allow_armed_mission_upload=os.getenv("MUVA_ALLOW_ARMED_MISSION_UPLOAD", "false").lower() in ("1", "true", "yes"),
            cors_origins=origins,
        )
