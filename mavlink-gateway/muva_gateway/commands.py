from __future__ import annotations

import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
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


class OperationBusyError(GatewayCommandError):
    status_code = 409


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

    @contextmanager
    def _operation(self) -> Iterator[None]:
        if not self._command_lock.acquire(blocking=False):
            raise OperationBusyError("Another flight operation is already in progress")
        try:
            yield
        finally:
            self._command_lock.release()

    def set_mode(self, mode: str) -> dict[str, Any]:
        mode = mode.upper()
        with self._operation():
            self._ensure_online()
            mapping = self.transport.mode_mapping()
            if mode not in mapping:
                raise InvalidCommandError(f"Unsupported flight mode: {mode}")
            if self.state.vehicle_value("mode") == mode:
                return {"accepted": True, "mode": mode, "idempotent": True}
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
        with self._operation():
            self._ensure_online()
            if self.state.vehicle_value("armed") is arm:
                return {"accepted": True, "armed": arm, "modeChanged": False, "mode": self.state.vehicle_value("mode"), "idempotent": True}
            mode_changed = False
            # ArduCopter refuses ground arm requests in autonomous terminal
            # modes. Switch to GUIDED while on the ground; never do this
            # airborne, where an implicit mode change would be dangerous.
            non_armable_modes = {"AUTO", "LAND", "RTL", "SMART_RTL"}
            if arm and self.state.vehicle_value("mode") in non_armable_modes:
                altitude = float(self.state.telemetry_value("altitude") or 0.0)
                if altitude > 1.0:
                    raise CommandRejectedError(
                        f"Cannot arm in {self.state.vehicle_value('mode')} while airborne; land before arming"
                    )
                self.set_mode("GUIDED")
                mode_changed = True
            if not arm and self.state.vehicle_value("armed") and not self.settings.allow_in_flight_disarm:
                altitude = float(self.state.telemetry_value("altitude") or 0.0)
                if altitude > 1.0:
                    raise CommandRejectedError("Refusing to disarm while the vehicle is airborne")
            command = mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM
            generation = self.state.ack_generation(command)
            status_generation = self.state.status_generation()
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
            ack = self._wait_for_ack(command, generation, status_generation)
            changed = self.state.wait_for(
                lambda: self.state.vehicle_value("armed") is arm,
                self.settings.command_timeout,
            )
            if not changed:
                detail = self.state.status_since(status_generation)
                suffix = f": {detail}" if detail else ""
                raise CommandTimeoutError(f"Armed state did not change after command acknowledgement{suffix}")
            return {"accepted": True, "armed": arm, "modeChanged": mode_changed, "mode": self.state.vehicle_value("mode"), "ack": ack}

    def takeoff(self, altitude: float) -> dict[str, Any]:
        if not 2 <= altitude <= 120:
            raise InvalidCommandError("Takeoff altitude must be between 2 and 120 metres")
        with self._operation():
            self._ensure_online()
            if not self.state.vehicle_value("armed"):
                raise CommandRejectedError("Vehicle must be armed before takeoff")
            if self.state.vehicle_value("mode") != "GUIDED":
                raise CommandRejectedError("Vehicle must be in GUIDED mode before takeoff")
            current_altitude = float(self.state.telemetry_value("altitude") or 0.0)
            if current_altitude >= max(1.0, altitude - 0.2):
                return {"accepted": True, "altitude": altitude, "confirmedAltitude": current_altitude, "idempotent": True}
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
            # Do not report takeoff complete while the vehicle is still
            # climbing through an intermediate threshold. Otherwise an
            # immediate hold command would capture that lower altitude.
            confirmation_altitude = max(1.0, altitude - 0.2)
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

    def hold(self) -> dict[str, Any]:
        """Hold current position/altitude using GUIDED position control."""
        with self._operation():
            self._ensure_online()
            if not self.state.vehicle_value("armed"):
                raise CommandRejectedError("Vehicle must be armed before holding position")
            latitude = float(self.state.telemetry_value("latitude") or 0.0)
            longitude = float(self.state.telemetry_value("longitude") or 0.0)
            altitude = float(self.state.telemetry_value("altitude") or 0.0)
            if not (-90 <= latitude <= 90 and -180 <= longitude <= 180) or altitude < 0:
                raise CommandRejectedError("A valid position and altitude are required to hold position")
            mode_changed = self.state.vehicle_value("mode") != "GUIDED"
            if mode_changed:
                self.set_mode("GUIDED")
            target_system, target_component = self.state.target
            type_mask = (
                mavutil.mavlink.POSITION_TARGET_TYPEMASK_VX_IGNORE
                | mavutil.mavlink.POSITION_TARGET_TYPEMASK_VY_IGNORE
                | mavutil.mavlink.POSITION_TARGET_TYPEMASK_VZ_IGNORE
                | mavutil.mavlink.POSITION_TARGET_TYPEMASK_AX_IGNORE
                | mavutil.mavlink.POSITION_TARGET_TYPEMASK_AY_IGNORE
                | mavutil.mavlink.POSITION_TARGET_TYPEMASK_AZ_IGNORE
                | mavutil.mavlink.POSITION_TARGET_TYPEMASK_YAW_IGNORE
                | mavutil.mavlink.POSITION_TARGET_TYPEMASK_YAW_RATE_IGNORE
            )
            self.transport.send(
                lambda connection: connection.mav.set_position_target_global_int_send(
                    int(time.time() * 1000) & 0xFFFFFFFF, target_system, target_component,
                    mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT, type_mask,
                    int(round(latitude * 1e7)), int(round(longitude * 1e7)), altitude,
                    0, 0, 0, 0, 0, 0, 0, 0,
                )
            )
            return {"accepted": True, "mode": "GUIDED", "modeChanged": mode_changed, "latitude": latitude, "longitude": longitude, "altitude": altitude}

    def start_mission(self) -> dict[str, Any]:
        with self._operation():
            self._ensure_online()
            if not self.state.vehicle_value("armed"):
                raise CommandRejectedError("Vehicle must be armed before starting a mission")
            mission_before = self.state.mission_snapshot()
            if int(mission_before["total"]) < 2:
                raise CommandRejectedError("No uploaded mission is available")
            if mission_before["state"] in ("starting", "active"):
                return {"accepted": True, "started": True, "mode": self.state.vehicle_value("mode"), "mission": mission_before, "idempotent": True}
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

    def _wait_for_ack(
        self,
        command: int,
        generation: int,
        status_generation: int | None = None,
    ) -> dict[str, Any]:
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
                detail = self.state.wait_for_status(status_generation, 0.25) if status_generation is not None else None
                suffix = f" ({detail})" if detail else ""
                raise CommandRejectedError(f"Command rejected: {ack['resultName']}{suffix}")
            return ack
