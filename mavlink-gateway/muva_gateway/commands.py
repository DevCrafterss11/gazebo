from __future__ import annotations

import threading
import time
import math
from contextlib import contextmanager
from collections.abc import Callable, Iterator
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
        monitor_event: Callable[..., None] | None = None,
    ) -> None:
        self.settings = settings
        self.state = state
        self.transport = transport
        self._command_lock = operation_lock or threading.RLock()
        self._monitor_event = monitor_event

    def _record_tx(self, message_type: str, text: str) -> None:
        if self._monitor_event is None:
            return
        target_system, target_component = self.state.target
        self._monitor_event(
            message_type,
            "command",
            "info",
            text,
            source_system=target_system,
            source_component=target_component,
            direction="TX",
        )

    @contextmanager
    def _operation(self) -> Iterator[None]:
        # Do not queue a second flight operation behind the first one. A queued
        # request can become unsafe by the time it reaches the flight
        # controller (for example, a second takeoff after the first completed).
        if not self._command_lock.acquire(blocking=False):
            raise OperationBusyError("Another flight operation is already in progress")
        try:
            yield
        finally:
            self._command_lock.release()

    def set_mode(self, mode: str) -> dict[str, Any]:
        mode = mode.upper()
        with self._operation():
            return self._set_mode_locked(mode)

    def _set_mode_locked(self, mode: str) -> dict[str, Any]:
            self._ensure_online()
            mapping = self.transport.mode_mapping()
            if mode not in mapping:
                raise InvalidCommandError(f"Unsupported flight mode: {mode}")
            if self.state.vehicle_value("mode") == mode:
                return {"accepted": True, "mode": mode, "idempotent": True}
            target_system, _ = self.state.target
            heartbeat_generation = self.state.heartbeat_generation()
            self._record_tx("SET_MODE", f"target={target_system} mode={mode} custom_mode={mapping[mode]}")
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
            mode_changed = False
            # The teaching UI's arm action is the first half of its guided
            # takeoff sequence. Ensure every ground arm enters GUIDED first,
            # including ArduCopter's default STABILIZE mode, so the following
            # takeoff request cannot fail solely because of a stale mode.
            if arm and self.state.vehicle_value("mode") != "GUIDED":
                altitude = float(self.state.telemetry_value("altitude") or 0.0)
                if altitude > 1.0:
                    raise CommandRejectedError(
                        f"Cannot arm in {self.state.vehicle_value('mode')} while airborne; land before arming"
                    )
                self._set_mode_locked("GUIDED")
                mode_changed = True
            if self.state.vehicle_value("armed") is arm:
                return {
                    "accepted": True,
                    "armed": arm,
                    "modeChanged": mode_changed,
                    "mode": self.state.vehicle_value("mode"),
                    "idempotent": True,
                }
            if not arm and self.state.vehicle_value("armed") and not self.settings.allow_in_flight_disarm:
                altitude = float(self.state.telemetry_value("altitude") or 0.0)
                if altitude > 1.0:
                    raise CommandRejectedError("Refusing to disarm while the vehicle is airborne")
            command = mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM
            generation = self.state.ack_generation(command)
            status_generation = self.state.status_generation()
            target_system, target_component = self.state.target
            action = "ARM" if arm else "DISARM"
            self._record_tx(
                "COMMAND_LONG",
                f"{action} · COMPONENT_ARM_DISARM ({command}) param1={1 if arm else 0} target={target_system}/{target_component}",
            )
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
                return {
                    "accepted": True,
                    "altitude": altitude,
                    "confirmedAltitude": current_altitude,
                    "idempotent": True,
                }
            command = mavutil.mavlink.MAV_CMD_NAV_TAKEOFF
            generation = self.state.ack_generation(command)
            target_system, target_component = self.state.target
            self._record_tx(
                "COMMAND_LONG",
                f"TAKEOFF · NAV_TAKEOFF ({command}) altitude={altitude:.1f}m target={target_system}/{target_component}",
            )
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
        """Hold the current position and altitude without relying on RC throttle.

        ArduCopter LOITER uses the pilot throttle stick for vertical control.
        That is unsuitable for this headless gateway/SITL path where no RC
        neutral input is guaranteed, so the UI's hold action uses GUIDED with
        an explicit position target instead.
        """
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
                self._set_mode_locked("GUIDED")
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
            self._record_tx(
                "SET_POSITION_TARGET_GLOBAL_INT",
                f"HOLD · lat={latitude:.7f} lon={longitude:.7f} alt={altitude:.1f}m target={target_system}/{target_component}",
            )
            self.transport.send(
                lambda connection: connection.mav.set_position_target_global_int_send(
                    int(time.time() * 1000) & 0xFFFFFFFF,
                    target_system,
                    target_component,
                    mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
                    type_mask,
                    int(round(latitude * 1e7)),
                    int(round(longitude * 1e7)),
                    altitude,
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
            return {
                "accepted": True,
                "mode": "GUIDED",
                "modeChanged": mode_changed,
                "latitude": latitude,
                "longitude": longitude,
                "altitude": altitude,
            }

    def land(self) -> dict[str, Any]:
        with self._operation():
            self._ensure_online()
            if not self.state.vehicle_value("armed"):
                raise CommandRejectedError("Vehicle is not armed")
            return self._set_mode_locked("LAND")

    def rtl(self) -> dict[str, Any]:
        with self._operation():
            self._ensure_online()
            if not self.state.vehicle_value("armed"):
                raise CommandRejectedError("Vehicle is not armed")
            if float(self.state.telemetry_value("altitude") or 0.0) < 0.2:
                raise CommandRejectedError("Vehicle is still on the ground")
            return self._set_mode_locked("RTL")

    def move(self, direction: str, metres: float) -> dict[str, Any]:
        direction = direction.lower()
        if direction not in {"forward", "backward", "left", "right", "up", "down"}:
            raise InvalidCommandError(f"Unsupported movement direction: {direction}")
        if not 0 < metres <= 100:
            raise InvalidCommandError("Movement distance must be between 0 and 100 metres")
        with self._operation():
            self._ensure_online()
            if not self.state.vehicle_value("armed"):
                raise CommandRejectedError("Vehicle must be armed before moving")
            if self.state.vehicle_value("mode") != "GUIDED":
                self._set_mode_locked("GUIDED")
            latitude = float(self.state.telemetry_value("latitude") or 0.0)
            longitude = float(self.state.telemetry_value("longitude") or 0.0)
            altitude = float(self.state.telemetry_value("altitude") or 0.0)
            if direction == "forward": latitude += metres / 111_111.0
            elif direction == "backward": latitude -= metres / 111_111.0
            elif direction == "right": longitude += metres / max(1.0, 111_111.0 * math.cos(math.radians(latitude)))
            elif direction == "left": longitude -= metres / max(1.0, 111_111.0 * math.cos(math.radians(latitude)))
            elif direction == "up": altitude += metres
            elif direction == "down": altitude = max(0.5, altitude - metres)
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
            self._record_tx(
                "SET_POSITION_TARGET_GLOBAL_INT",
                f"MOVE_{direction.upper()} · distance={metres:.1f}m lat={latitude:.7f} lon={longitude:.7f} alt={altitude:.1f}m target={target_system}/{target_component}",
            )
            self.transport.send(lambda connection: connection.mav.set_position_target_global_int_send(
                int(time.time() * 1000) & 0xFFFFFFFF, target_system, target_component,
                mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT, type_mask,
                int(round(latitude * 1e7)), int(round(longitude * 1e7)), altitude,
                0, 0, 0, 0, 0, 0, 0, 0,
            ))
            return {"accepted": True, "direction": direction, "metres": metres, "latitude": latitude, "longitude": longitude, "altitude": altitude}

    def yaw(self, direction: str, degrees: float) -> dict[str, Any]:
        direction = direction.lower()
        if direction not in {"left", "right"}:
            raise InvalidCommandError(f"Unsupported yaw direction: {direction}")
        if not 0 < degrees <= 360:
            raise InvalidCommandError("Yaw must be between 0 and 360 degrees")
        with self._operation():
            self._ensure_online()
            if not self.state.vehicle_value("armed"):
                raise CommandRejectedError("Vehicle must be armed before yawing")
            command = mavutil.mavlink.MAV_CMD_CONDITION_YAW
            generation = self.state.ack_generation(command)
            target_system, target_component = self.state.target
            self._record_tx(
                "COMMAND_LONG",
                f"YAW_{direction.upper()} · CONDITION_YAW ({command}) degrees={degrees:.1f} target={target_system}/{target_component}",
            )
            self.transport.send(lambda connection: connection.mav.command_long_send(
                target_system, target_component, command, 0,
                degrees, 0, -1 if direction == "left" else 1, 1, 0, 0, 0,
            ))
            ack = self._wait_for_ack(command, generation)
            return {"accepted": True, "direction": direction, "degrees": degrees, "ack": ack}

    def start_mission(self) -> dict[str, Any]:
        with self._operation():
            self._ensure_online()
            if not self.state.vehicle_value("armed"):
                raise CommandRejectedError("Vehicle must be armed before starting a mission")
            mission_before = self.state.mission_snapshot()
            if int(mission_before["total"]) < 2:
                raise CommandRejectedError("No uploaded mission is available")
            if mission_before["state"] in ("starting", "active"):
                return {
                    "accepted": True,
                    "started": True,
                    "mode": self.state.vehicle_value("mode"),
                    "mission": mission_before,
                    "idempotent": True,
                }
            mission_progress_generation = self.state.mission_progress_generation()
            self.state.set_mission_state("starting")
            self._set_mode_locked("AUTO")
            command = mavutil.mavlink.MAV_CMD_MISSION_START
            generation = self.state.ack_generation(command)
            target_system, target_component = self.state.target
            self._record_tx(
                "COMMAND_LONG",
                f"MISSION_START ({command}) first=0 last=0 target={target_system}/{target_component}",
            )
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
