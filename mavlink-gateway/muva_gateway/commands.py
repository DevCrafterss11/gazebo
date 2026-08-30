from __future__ import annotations

import threading
import time
from typing import Any

from pymavlink import mavutil

from .config import Settings
from .state import VehicleState
from .transport import MavlinkTransport


class GatewayCommandError(RuntimeError):
    status_code = 500


class VehicleOfflineError(GatewayCommandError):
    status_code = 503


class CommandTimeoutError(GatewayCommandError):
    status_code = 504


class CommandRejectedError(GatewayCommandError):
    status_code = 409


class InvalidCommandError(GatewayCommandError):
    status_code = 422


RESULT_NAMES = {
    mavutil.mavlink.MAV_RESULT_ACCEPTED: "ACCEPTED",
    mavutil.mavlink.MAV_RESULT_TEMPORARILY_REJECTED: "TEMPORARILY_REJECTED",
    mavutil.mavlink.MAV_RESULT_DENIED: "DENIED",
    mavutil.mavlink.MAV_RESULT_UNSUPPORTED: "UNSUPPORTED",
    mavutil.mavlink.MAV_RESULT_FAILED: "FAILED",
    mavutil.mavlink.MAV_RESULT_IN_PROGRESS: "IN_PROGRESS",
    getattr(mavutil.mavlink, "MAV_RESULT_CANCELLED", 6): "CANCELLED",
}


class CommandService:
    def __init__(
        self,
        settings: Settings,
        state: VehicleState,
        transport: MavlinkTransport,
        operation_lock: threading.RLock | None = None,
    ) -> None:
        self.settings = settings
        self.state = state
        self.transport = transport
        self._command_lock = operation_lock or threading.RLock()

    def set_mode(self, mode: str) -> dict[str, Any]:
        mode = mode.upper()
        with self._command_lock:
            self._ensure_online()
            mapping = self.transport.mode_mapping()
            if mode not in mapping:
                raise InvalidCommandError(f"Unsupported flight mode: {mode}")
            target_system, _ = self.state.target
            heartbeat_generation = self.state.heartbeat_generation()
            self.transport.send(
                lambda connection: connection.mav.set_mode_send(
                    target_system,
                    mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
                    mapping[mode],
                )
            )
            changed = self.state.wait_for(
                lambda: self.state.heartbeat_generation() > heartbeat_generation
                and self.state.vehicle_value("mode") == mode,
                self.settings.command_timeout,
            )
            if not changed:
                raise CommandTimeoutError(f"Flight mode did not change to {mode}")
            return {"accepted": True, "mode": mode}

    def arm(self, arm: bool) -> dict[str, Any]:
        with self._command_lock:
            self._ensure_online()
            mode_changed = False
            # ArduCopter refuses a ground arm request while still in AUTO.
            # Switch to a manual/assisted mode first; never do this airborne.
            if arm and self.state.vehicle_value("mode") == "AUTO":
                altitude = float(self.state.telemetry_value("altitude") or 0.0)
                if altitude > 1.0:
                    raise CommandRejectedError("Cannot arm in AUTO while airborne; land before arming")
                self.set_mode("GUIDED")
                mode_changed = True
            if not arm and self.state.vehicle_value("armed") and not self.settings.allow_in_flight_disarm:
                altitude = float(self.state.telemetry_value("altitude") or 0.0)
                if altitude > 1.0:
                    raise CommandRejectedError("Refusing to disarm while the vehicle is airborne")
            command = mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM
            generation = self.state.ack_generation(command)
            target_system, target_component = self.state.target
            self.transport.send(
                lambda connection: connection.mav.command_long_send(
                    target_system,
                    target_component,
                    command,
                    0,
                    1.0 if arm else 0.0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                )
            )
            ack = self._wait_for_ack(command, generation)
            changed = self.state.wait_for(
                lambda: self.state.vehicle_value("armed") is arm,
                self.settings.command_timeout,
            )
            if not changed:
                raise CommandTimeoutError("Armed state did not change after command acknowledgement")
            return {"accepted": True, "armed": arm, "modeChanged": mode_changed, "mode": self.state.vehicle_value("mode"), "ack": ack}

    def takeoff(self, altitude: float) -> dict[str, Any]:
        if not 2 <= altitude <= 120:
            raise InvalidCommandError("Takeoff altitude must be between 2 and 120 metres")
        with self._command_lock:
            self._ensure_online()
            if not self.state.vehicle_value("armed"):
                raise CommandRejectedError("Vehicle must be armed before takeoff")
            if self.state.vehicle_value("mode") != "GUIDED":
                raise CommandRejectedError("Vehicle must be in GUIDED mode before takeoff")
            command = mavutil.mavlink.MAV_CMD_NAV_TAKEOFF
            generation = self.state.ack_generation(command)
            target_system, target_component = self.state.target
            self.transport.send(
                lambda connection: connection.mav.command_long_send(
                    target_system,
                    target_component,
                    command,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    altitude,
                )
            )
            ack = self._wait_for_ack(command, generation)
            baseline_altitude = float(self.state.telemetry_value("altitude") or 0.0)
            confirmation_altitude = max(1.0, min(altitude * 0.7, altitude - 0.5))
            if baseline_altitude < confirmation_altitude:
                confirmed = self.state.wait_for(
                    lambda: self.state.is_online()
                    and self.state.vehicle_value("armed")
                    and self.state.vehicle_value("mode") == "GUIDED"
                    and float(self.state.telemetry_value("altitude") or 0.0) >= max(
                        confirmation_altitude, baseline_altitude + 0.8
                    ),
                    self.settings.takeoff_timeout,
                )
                if not confirmed:
                    raise CommandTimeoutError(
                        f"Takeoff acknowledged but altitude did not reach {confirmation_altitude:.1f} metres"
                    )
            return {"accepted": True, "altitude": altitude, "confirmedAltitude": float(self.state.telemetry_value("altitude") or 0.0), "ack": ack}

    def start_mission(self) -> dict[str, Any]:
        with self._command_lock:
            self._ensure_online()
            if not self.state.vehicle_value("armed"):
                raise CommandRejectedError("Vehicle must be armed before starting a mission")
            mission_before = self.state.mission_snapshot()
            if int(mission_before["total"]) < 2:
                raise CommandRejectedError("No uploaded mission is available")
            mission_progress_generation = self.state.mission_progress_generation()
            self.state.set_mission_state("starting")
            self.set_mode("AUTO")
            command = mavutil.mavlink.MAV_CMD_MISSION_START
            generation = self.state.ack_generation(command)
            target_system, target_component = self.state.target
            self.transport.send(
                lambda connection: connection.mav.command_long_send(
                    target_system,
                    target_component,
                    command,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                )
            )
            ack = self._wait_for_ack(command, generation)
            started = self.state.wait_for(
                lambda: self.state.is_online()
                and self.state.vehicle_value("armed")
                and self.state.vehicle_value("mode") == "AUTO"
                and self.state.mission_progress_generation() > mission_progress_generation,
                self.settings.command_timeout,
            )
            if not started:
                self.state.set_mission_state("failed")
                raise CommandTimeoutError("Mission was acknowledged but did not enter AUTO execution")
            self.state.set_mission_state("active")
            return {"accepted": True, "started": True, "mode": "AUTO", "mission": self.state.mission_snapshot(), "ack": ack}

    def _ensure_online(self) -> None:
        if not self.state.is_online():
            raise VehicleOfflineError("No recent vehicle heartbeat")

    def _wait_for_ack(self, command: int, generation: int) -> dict[str, Any]:
        expires_at = time.monotonic() + self.settings.command_timeout
        latest = generation
        while True:
            remaining = expires_at - time.monotonic()
            if remaining <= 0:
                raise CommandTimeoutError(f"No final COMMAND_ACK for command {command}")
            ack = self.state.wait_for_ack(command, latest, remaining)
            if ack is None:
                raise CommandTimeoutError(f"No COMMAND_ACK for command {command}")
            ack["resultName"] = RESULT_NAMES.get(ack["result"], f"UNKNOWN_{ack['result']}")
            if ack["result"] == mavutil.mavlink.MAV_RESULT_IN_PROGRESS:
                latest = int(ack["generation"])
                continue
            if ack["result"] != mavutil.mavlink.MAV_RESULT_ACCEPTED:
                raise CommandRejectedError(f"Command rejected: {ack['resultName']}")
            return ack
