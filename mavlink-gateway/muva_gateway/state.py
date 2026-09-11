from __future__ import annotations

import math
import threading
import time
from collections import deque
from copy import deepcopy
from typing import Any, Callable

from pymavlink import mavutil

MISSION_PROTOCOL_MESSAGES = frozenset(
    {
        "MISSION_REQUEST",
        "MISSION_REQUEST_INT",
        "MISSION_ACK",
        "MISSION_COUNT",
        "MISSION_ITEM",
        "MISSION_ITEM_INT",
        "MISSION_ITEM_REACHED",
    }
)


def _finite(value: float, default: float = 0.0) -> float:
    return value if math.isfinite(value) else default


class VehicleState:
    def __init__(self, heartbeat_timeout: float = 3.0) -> None:
        self._condition = threading.Condition(threading.RLock())
        self._heartbeat_timeout = heartbeat_timeout
        self._last_heartbeat = 0.0
        self._heartbeat_generation = 0
        self._transport_connected = False
        self._version = 0
        self._ack_generation: dict[int, int] = {}
        self._acks: dict[int, dict[str, Any]] = {}
        self._status_generation = 0
        self._status_messages: deque[tuple[int, str]] = deque(maxlen=32)
        self._messages: deque[dict[str, Any]] = deque(maxlen=50)
        self._track: deque[dict[str, Any]] = deque(maxlen=600)
        self._home: dict[str, Any] = {
            "valid": False,
            "latitude": 0.0,
            "longitude": 0.0,
            "altitude": 0.0,
        }
        self._mission: dict[str, Any] = {
            "current": 0,
            "total": 0,
            "distanceToWaypoint": 0,
            "state": "idle",
            "lastReached": None,
            "verified": False,
            "verifiedAt": None,
            "missionHash": None,
        }
        self._protocol_generation: dict[str, int] = {}
        self._protocol_messages: dict[str, Any] = {}
        self._protocol_history: dict[str, deque[tuple[int, Any]]] = {}
        self._mission_generation = 0
        self._mission_progress_generation = 0
        self._vehicle: dict[str, Any] = {
            "systemId": 0,
            "componentId": 0,
            "mode": "UNKNOWN",
            "armed": False,
            "vehicleType": 0,
            "autopilot": 0,
        }
        self._telemetry: dict[str, Any] = {
            "altitude": 0.0,
            "absoluteAltitude": 0.0,
            "groundSpeed": 0.0,
            "airSpeed": 0.0,
            "climbRate": 0.0,
            "heading": 0.0,
            "roll": 0.0,
            "pitch": 0.0,
            "yaw": 0.0,
            "voltage": 0.0,
            "current": 0.0,
            "battery": -1,
            "satellites": 0,
            "hdop": 0.0,
            "gpsFixType": 0,
            "latitude": 0.0,
            "longitude": 0.0,
            "linkQuality": -1,
            "throttle": 0,
        }

    @property
    def target(self) -> tuple[int, int]:
        with self._condition:
            return int(self._vehicle["systemId"]), int(self._vehicle["componentId"])

    def set_transport_connected(self, connected: bool) -> None:
        with self._condition:
            if self._transport_connected != connected:
                self._transport_connected = connected
                if not connected:
                    self._last_heartbeat = 0.0
                    self._vehicle.update(systemId=0, componentId=0, mode="UNKNOWN", armed=False)
                    self._mission.update(verified=False, verifiedAt=None, missionHash=None)
                self._touch()

    def is_online(self) -> bool:
        with self._condition:
            return self._is_online_unlocked()

    def snapshot(self, endpoint: str) -> dict[str, Any]:
        with self._condition:
            age = time.monotonic() - self._last_heartbeat if self._last_heartbeat else None
            return {
                "type": "vehicle_state",
                "version": self._version,
                "timestamp": time.time(),
                "connection": {
                    "connected": self._is_online_unlocked(),
                    "transportConnected": self._transport_connected,
                    "endpoint": endpoint,
                    "lastHeartbeatAgeMs": round(age * 1000) if age is not None else None,
                },
                "vehicle": deepcopy(self._vehicle),
                "telemetry": deepcopy(self._telemetry),
                "home": deepcopy(self._home),
                "track": list(self._track),
                "mission": deepcopy(self._mission),
                "messages": list(self._messages),
            }

    def handle_message(self, message: Any) -> None:
        message_type = message.get_type()
        with self._condition:
            if message_type == "BAD_DATA":
                return
            source_system = int(message.get_srcSystem())
            source_component = int(message.get_srcComponent())
            selected_system = int(self._vehicle["systemId"])
            if selected_system and source_system != selected_system:
                return
            selected_component = int(self._vehicle["componentId"])
            if selected_component and source_component != selected_component:
                return
            protocol_message = message_type in MISSION_PROTOCOL_MESSAGES
            if protocol_message:
                generation = self._protocol_generation.get(message_type, 0) + 1
                self._protocol_generation[message_type] = generation
                self._protocol_messages[message_type] = message
                self._protocol_history.setdefault(message_type, deque(maxlen=64)).append((generation, message))
            if message_type == "HEARTBEAT":
                self._handle_heartbeat(message)
            elif message_type == "ATTITUDE":
                self._telemetry.update(
                    roll=math.degrees(message.roll),
                    pitch=math.degrees(message.pitch),
                    yaw=math.degrees(message.yaw),
                    heading=math.degrees(message.yaw) % 360,
                )
            elif message_type == "GLOBAL_POSITION_INT":
                latitude = message.lat / 1e7
                longitude = message.lon / 1e7
                absolute_altitude = message.alt / 1000.0
                relative_altitude = message.relative_alt / 1000.0
                self._telemetry.update(
                    latitude=latitude,
                    longitude=longitude,
                    absoluteAltitude=absolute_altitude,
                    altitude=relative_altitude,
                    groundSpeed=math.hypot(message.vx, message.vy) / 100.0,
                    climbRate=-message.vz / 100.0,
                )
                if -90 <= latitude <= 90 and -180 <= longitude <= 180 and (abs(latitude) > 1e-6 or abs(longitude) > 1e-6):
                    if not self._home["valid"]:
                        self._home.update(
                            valid=True,
                            latitude=latitude,
                            longitude=longitude,
                            altitude=absolute_altitude,
                        )
                    self._append_track(latitude, longitude, relative_altitude)
                if message.hdg != 65535:
                    self._telemetry["heading"] = message.hdg / 100.0
            elif message_type == "HOME_POSITION":
                latitude = float(message.x) / 1e7
                longitude = float(message.y) / 1e7
                altitude = float(message.z) / 1000.0
                if -90 <= latitude <= 90 and -180 <= longitude <= 180 and (abs(latitude) > 1e-6 or abs(longitude) > 1e-6):
                    self._home.update(
                        valid=True,
                        latitude=latitude,
                        longitude=longitude,
                        altitude=altitude,
                    )
            elif message_type == "VFR_HUD":
                self._telemetry.update(
                    airSpeed=_finite(float(message.airspeed)),
                    groundSpeed=_finite(float(message.groundspeed)),
                    climbRate=_finite(float(message.climb)),
                    heading=float(message.heading % 360),
                    throttle=int(message.throttle),
                )
            elif message_type == "SYS_STATUS":
                if message.voltage_battery != 65535:
                    self._telemetry["voltage"] = message.voltage_battery / 1000.0
                if message.current_battery != -1:
                    self._telemetry["current"] = message.current_battery / 100.0
                if message.battery_remaining != -1:
                    self._telemetry["battery"] = int(message.battery_remaining)
            elif message_type == "BATTERY_STATUS":
                voltages = [value for value in message.voltages if value not in (0, 65535)]
                if voltages:
                    self._telemetry["voltage"] = sum(voltages) / 1000.0
                if message.current_battery != -1:
                    self._telemetry["current"] = message.current_battery / 100.0
                if message.battery_remaining != -1:
                    self._telemetry["battery"] = int(message.battery_remaining)
            elif message_type == "GPS_RAW_INT":
                self._telemetry.update(
                    gpsFixType=int(message.fix_type),
                    satellites=int(message.satellites_visible),
                )
                if message.eph != 65535:
                    self._telemetry["hdop"] = message.eph / 100.0
            elif message_type == "RADIO_STATUS":
                self._telemetry["linkQuality"] = round(max(0, min(255, message.rssi)) / 255 * 100)
            elif message_type == "STATUSTEXT":
                text = message.text.decode(errors="replace") if isinstance(message.text, bytes) else str(message.text)
                normalized_text = text.rstrip("\x00")
                self._status_generation += 1
                self._status_messages.append((self._status_generation, normalized_text))
                self._messages.appendleft(
                    {"timestamp": time.time(), "severity": int(message.severity), "text": normalized_text}
                )
            elif message_type == "MISSION_CURRENT":
                self._mission["current"] = int(message.seq)
                total = int(getattr(message, "total", 0))
                if total > 0:
                    self._mission["total"] = total
                final_reached = int(self._mission["lastReached"] or -1) >= int(self._mission["total"]) - 1
                landed = not self._vehicle["armed"] and float(self._telemetry["altitude"]) <= 1.0
                self._mission["state"] = "completed" if final_reached and landed else (
                    "active" if self._vehicle["armed"] and self._vehicle["mode"] == "AUTO" else "loaded"
                )
                self._mission_generation += 1
                self._mission_progress_generation += 1
            elif message_type == "MISSION_ITEM_REACHED":
                reached = int(message.seq)
                self._mission["lastReached"] = reached
                total = int(self._mission["total"])
                self._mission["state"] = "completed" if total > 0 and reached >= total - 1 else "active"
                self._mission_generation += 1
                self._mission_progress_generation += 1
            elif message_type == "NAV_CONTROLLER_OUTPUT":
                self._mission["distanceToWaypoint"] = max(0, int(message.wp_dist))
            elif message_type == "MISSION_COUNT":
                if int(getattr(message, "mission_type", mavutil.mavlink.MAV_MISSION_TYPE_MISSION)) == mavutil.mavlink.MAV_MISSION_TYPE_MISSION:
                    self._mission["total"] = int(message.count)
                    self._mission["current"] = 0
                    self._mission["lastReached"] = None
                    self._mission["state"] = "loaded" if int(message.count) else "idle"
                    self._mission_generation += 1
            elif message_type == "COMMAND_ACK":
                command = int(message.command)
                generation = self._ack_generation.get(command, 0) + 1
                self._ack_generation[command] = generation
                self._acks[command] = {
                    "command": command,
                    "result": int(message.result),
                    "progress": int(getattr(message, "progress", 0)),
                    "generation": generation,
                    "timestamp": time.time(),
                }
            else:
                if not protocol_message:
                    return
            self._touch()

    def ack_generation(self, command: int) -> int:
        with self._condition:
            return self._ack_generation.get(command, 0)

    def status_generation(self) -> int:
        with self._condition:
            return self._status_generation

    def status_since(self, after_generation: int) -> str | None:
        """Return the most recent flight-controller status after a command was sent."""
        with self._condition:
            for generation, text in reversed(self._status_messages):
                if generation > after_generation and text:
                    return text
            return None

    def wait_for_status(self, after_generation: int, timeout: float = 0.25) -> str | None:
        return self.wait_for(lambda: self.status_since(after_generation), timeout)

    def latest_status(self) -> str | None:
        with self._condition:
            return self._status_messages[-1][1] if self._status_messages else None

    def heartbeat_generation(self) -> int:
        with self._condition:
            return self._heartbeat_generation

    def mission_generation(self) -> int:
        with self._condition:
            return self._mission_generation

    def mission_progress_generation(self) -> int:
        with self._condition:
            return self._mission_progress_generation

    def mission_snapshot(self) -> dict[str, Any]:
        with self._condition:
            return deepcopy(self._mission)

    def wait_for_mission(self, predicate: Callable[[dict[str, Any]], Any], timeout: float) -> Any:
        return self.wait_for(lambda: predicate(deepcopy(self._mission)), timeout)

    def protocol_generations(self, message_types: tuple[str, ...]) -> dict[str, int]:
        with self._condition:
            return {message_type: self._protocol_generation.get(message_type, 0) for message_type in message_types}

    def wait_for_protocol(
        self,
        message_types: tuple[str, ...],
        after: dict[str, int],
        timeout: float,
        predicate: Callable[[Any], bool] | None = None,
    ) -> tuple[str, Any] | None:
        deadline = time.monotonic() + timeout
        with self._condition:
            while True:
                for message_type in message_types:
                    history = self._protocol_history.get(message_type, ())
                    for generation, message in history:
                        if generation <= after.get(message_type, 0):
                            continue
                        after[message_type] = generation
                        if predicate is None or predicate(message):
                            return message_type, message
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                self._condition.wait(remaining)

    def wait_for_ack(self, command: int, after_generation: int, timeout: float) -> dict[str, Any] | None:
        return self.wait_for(
            lambda: deepcopy(self._acks.get(command))
            if self._ack_generation.get(command, 0) > after_generation
            else None,
            timeout,
        )

    def wait_for(self, predicate: Callable[[], Any], timeout: float) -> Any:
        deadline = time.monotonic() + timeout
        with self._condition:
            while True:
                result = predicate()
                if result:
                    return result
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                self._condition.wait(remaining)

    def vehicle_value(self, key: str) -> Any:
        with self._condition:
            return self._vehicle.get(key)

    def telemetry_value(self, key: str) -> Any:
        with self._condition:
            return self._telemetry.get(key)

    def set_mission_state(self, state: str) -> None:
        with self._condition:
            if self._mission["state"] != state:
                self._mission["state"] = state
                self._mission_generation += 1
                self._touch()

    def set_mission_verification(
        self,
        verified: bool,
        verified_at: float | None = None,
        mission_hash: str | None = None,
    ) -> None:
        with self._condition:
            next_verified_at = verified_at if verified else None
            next_mission_hash = mission_hash if verified else None
            if (
                self._mission["verified"] != verified
                or self._mission["verifiedAt"] != next_verified_at
                or self._mission["missionHash"] != next_mission_hash
            ):
                self._mission["verified"] = verified
                self._mission["verifiedAt"] = next_verified_at
                self._mission["missionHash"] = next_mission_hash
                self._mission_generation += 1
                self._touch()

    def _handle_heartbeat(self, message: Any) -> None:
        if int(message.type) == mavutil.mavlink.MAV_TYPE_GCS:
            return
        self._last_heartbeat = time.monotonic()
        self._heartbeat_generation += 1
        previous_mode = self._vehicle["mode"]
        previous_armed = bool(self._vehicle["armed"])
        next_mode = mavutil.mode_string_v10(message)
        next_armed = bool(message.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED)
        self._vehicle.update(
            systemId=int(message.get_srcSystem()),
            componentId=int(message.get_srcComponent()),
            mode=next_mode,
            armed=next_armed,
            vehicleType=int(message.type),
            autopilot=int(message.autopilot),
        )
        mission_state = self._mission["state"]
        if mission_state in ("starting", "active"):
            total = int(self._mission["total"])
            final_item = total > 0 and (
                int(self._mission["lastReached"] or -1) >= total - 1
                or int(self._mission["current"]) >= total - 1
            )
            if not next_armed and float(self._telemetry["altitude"]) <= 1.0 and final_item:
                self._mission["state"] = "completed"
                self._mission_generation += 1
            elif previous_mode == "AUTO" and next_mode not in ("AUTO", "LAND"):
                self._mission["state"] = "aborted"
                self._mission_generation += 1
            elif previous_armed and not next_armed and not final_item:
                self._mission["state"] = "aborted"
                self._mission_generation += 1

    def _append_track(self, latitude: float, longitude: float, altitude: float) -> None:
        point = {
            "timestamp": time.time(),
            "latitude": latitude,
            "longitude": longitude,
            "altitude": altitude,
        }
        if self._track:
            previous = self._track[-1]
            if (
                abs(float(previous["latitude"]) - latitude) < 1e-7
                and abs(float(previous["longitude"]) - longitude) < 1e-7
                and time.time() - float(previous["timestamp"]) < 1.0
            ):
                return
        self._track.append(point)

    def _is_online_unlocked(self) -> bool:
        return bool(
            self._transport_connected
            and self._last_heartbeat
            and time.monotonic() - self._last_heartbeat <= self._heartbeat_timeout
        )

    def _touch(self) -> None:
        self._version += 1
        self._condition.notify_all()
