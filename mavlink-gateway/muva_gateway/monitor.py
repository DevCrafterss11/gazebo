from __future__ import annotations

import logging
import math
import threading
import time
from collections import Counter, deque
from copy import deepcopy
from typing import Any

from pymavlink import mavutil

LOGGER = logging.getLogger(__name__)

SEVERITY_NAMES = {
    0: "EMERGENCY",
    1: "ALERT",
    2: "CRITICAL",
    3: "ERROR",
    4: "WARNING",
    5: "NOTICE",
    6: "INFO",
    7: "DEBUG",
}

MISSION_TYPES = {
    "MISSION_ACK",
    "MISSION_COUNT",
    "MISSION_CURRENT",
    "MISSION_ITEM",
    "MISSION_ITEM_INT",
    "MISSION_ITEM_REACHED",
    "MISSION_REQUEST",
    "MISSION_REQUEST_INT",
}

IMPORTANT_TYPES = MISSION_TYPES | {"STATUSTEXT", "COMMAND_ACK", "HEARTBEAT"}

IMPORTANT_STATUS_TERMS = (
    "ARMED",
    "DISARMED",
    "THROTTLE",
    "TAKEOFF",
    "MISSION",
    "REACHED",
    "RTL",
    "LAND",
    "FAILSAFE",
    "FLIGHT MODE",
    "COMMAND",
)

FIELD_ORDER = {
    "COMMAND_ACK": ("command", "result", "progress", "result_param2"),
    "MISSION_ACK": ("type", "mission_type"),
    "MISSION_COUNT": ("count", "mission_type"),
    "MISSION_CURRENT": ("seq", "total", "mission_state", "mission_mode"),
    "MISSION_ITEM": ("seq", "command", "frame", "x", "y", "z"),
    "MISSION_ITEM_INT": ("seq", "command", "frame", "x", "y", "z"),
    "MISSION_ITEM_REACHED": ("seq",),
    "MISSION_REQUEST": ("seq", "mission_type"),
    "MISSION_REQUEST_INT": ("seq", "mission_type"),
}


def _finite(value: Any) -> Any:
    if isinstance(value, float):
        return round(value, 4) if math.isfinite(value) else None
    if isinstance(value, bytes):
        return value.decode(errors="replace").rstrip("\x00")
    if isinstance(value, (list, tuple)):
        return [_finite(item) for item in value[:8]]
    return value


def _enum_name(table: str, value: int, fallback: str) -> str:
    entry = mavutil.mavlink.enums.get(table, {}).get(value)
    return entry.name if entry is not None else fallback


def _field_text(message_type: str, message: Any) -> str:
    payload = message.to_dict() if hasattr(message, "to_dict") else vars(message)
    keys = FIELD_ORDER.get(message_type)
    if keys is None:
        keys = tuple(key for key in payload if key not in {"mavpackettype"} and not key.startswith("_") )[:8]
    values = []
    for key in keys:
        if key not in payload and not hasattr(message, key):
            continue
        value = payload.get(key, getattr(message, key, None))
        values.append(f"{key}={_finite(value)}")
    return " ".join(values) or "packet received"


class MonitorConsoleState:
    def __init__(self, endpoint: str, heartbeat_timeout: float = 3.0) -> None:
        self.endpoint = endpoint
        self.heartbeat_timeout = heartbeat_timeout
        self._lock = threading.RLock()
        self._entries: deque[dict[str, Any]] = deque(maxlen=240)
        self._message_counts: Counter[str] = Counter()
        self._last_values: dict[str, Any] = {}
        self._last_event: tuple[str, str] | None = None
        self._last_event_at = 0.0
        self._last_heartbeat = 0.0
        self._transport_connected = False
        self._packet_count = 0
        self._version = 0
        self._entry_id = 0

    def set_transport_connected(self, connected: bool) -> None:
        with self._lock:
            if self._transport_connected != connected:
                self._transport_connected = connected
                if not connected:
                    self._last_heartbeat = 0.0
                self._version += 1

    def handle_message(self, message: Any) -> None:
        message_type = message.get_type()
        if message_type == "BAD_DATA":
            return
        now = time.time()
        monotonic_now = time.monotonic()
        with self._lock:
            self._packet_count += 1
            self._message_counts[message_type] += 1
            if message_type == "HEARTBEAT":
                if int(getattr(message, "type", 0)) == mavutil.mavlink.MAV_TYPE_GCS:
                    return
                self._last_heartbeat = monotonic_now

            if message_type not in IMPORTANT_TYPES:
                return
            if message_type == "STATUSTEXT" and not self._important_status_text(message):
                return

            change_key = self._change_key(message_type, message)
            if change_key is not None and self._last_values.get(message_type) == change_key:
                return
            if change_key is not None:
                self._last_values[message_type] = change_key

            severity, category, text = self._describe(message_type, message)
            event_key = (message_type, text)
            if event_key == self._last_event and monotonic_now - self._last_event_at < 5.0:
                return
            self._last_event = event_key
            self._last_event_at = monotonic_now
            self._entry_id += 1
            self._entries.append({
                "id": self._entry_id,
                "timestamp": now,
                "type": message_type,
                "category": category,
                "severity": severity,
                "direction": "RX",
                "text": text,
                "sourceSystem": int(message.get_srcSystem()),
                "sourceComponent": int(message.get_srcComponent()),
            })
            self._version += 1

    def record_local_event(
        self,
        message_type: str,
        category: str,
        severity: str,
        text: str,
        source_system: int = 0,
        source_component: int = 0,
        direction: str = "LOCAL",
    ) -> None:
        """Record a gateway command response while the read-only stream catches up."""
        now = time.time()
        with self._lock:
            self._entry_id += 1
            self._entries.append({
                "id": self._entry_id,
                "timestamp": now,
                "type": message_type,
                "category": category,
                "severity": severity,
                "direction": direction,
                "text": text,
                "sourceSystem": source_system,
                "sourceComponent": source_component,
            })
            self._version += 1

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            heartbeat_age = time.monotonic() - self._last_heartbeat if self._last_heartbeat else None
            return {
                "type": "monitor_console",
                "version": self._version,
                "timestamp": time.time(),
                "connection": {
                    "connected": bool(heartbeat_age is not None and heartbeat_age <= self.heartbeat_timeout),
                    "transportConnected": self._transport_connected,
                    "endpoint": self.endpoint,
                    "lastHeartbeatAgeMs": round(heartbeat_age * 1000) if heartbeat_age is not None else None,
                },
                "packetCount": self._packet_count,
                "messageCounts": dict(self._message_counts.most_common(20)),
                "entries": deepcopy(list(self._entries)),
            }

    @staticmethod
    def _important_status_text(message: Any) -> bool:
        severity = int(getattr(message, "severity", 6))
        text = _finite(getattr(message, "text", ""))
        normalized = str(text).upper()
        if "GCS SHOULD SEND MISSION_ITEM_INT" in normalized:
            return False
        return severity <= mavutil.mavlink.MAV_SEVERITY_WARNING or any(term in normalized for term in IMPORTANT_STATUS_TERMS)

    def _change_key(self, message_type: str, message: Any) -> Any:
        if message_type == "HEARTBEAT":
            return (
                mavutil.mode_string_v10(message),
                bool(int(getattr(message, "base_mode", 0)) & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED),
                int(getattr(message, "system_status", 0)),
            )
        if message_type == "MISSION_CURRENT":
            return (
                int(getattr(message, "seq", 0)),
                int(getattr(message, "total", 0)),
                int(getattr(message, "mission_state", 0)),
            )
        if message_type == "MISSION_COUNT":
            return int(getattr(message, "count", 0))
        return None

    def _describe(self, message_type: str, message: Any) -> tuple[str, str, str]:
        if message_type == "STATUSTEXT":
            severity_value = int(getattr(message, "severity", 6))
            text = _finite(getattr(message, "text", ""))
            if str(text).lower() == "arm: auto mode not armable":
                text = "解锁失败 · AUTO 模式不可解锁，请切换 GUIDED 或 LOITER"
            severity = "error" if severity_value <= 3 else "warning" if severity_value == 4 else "info"
            return severity, "status", f"{SEVERITY_NAMES.get(severity_value, severity_value)} · {text}"

        if message_type == "COMMAND_ACK":
            command = int(getattr(message, "command", 0))
            result = int(getattr(message, "result", 0))
            command_name = _enum_name("MAV_CMD", command, str(command)).removeprefix("MAV_CMD_")
            result_name = _enum_name("MAV_RESULT", result, str(result)).removeprefix("MAV_RESULT_")
            severity = "info" if result in (mavutil.mavlink.MAV_RESULT_ACCEPTED, mavutil.mavlink.MAV_RESULT_IN_PROGRESS) else "error"
            return severity, "command", f"{command_name} ({command}) -> {result_name}"

        if message_type == "HEARTBEAT":
            armed = bool(int(getattr(message, "base_mode", 0)) & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED)
            mode = mavutil.mode_string_v10(message)
            status = _enum_name("MAV_STATE", int(getattr(message, "system_status", 0)), "UNKNOWN").removeprefix("MAV_STATE_")
            return "info", "heartbeat", f"mode={mode} armed={str(armed).lower()} state={status}"

        if message_type in MISSION_TYPES:
            if message_type in ("MISSION_ITEM", "MISSION_ITEM_INT"):
                command = int(getattr(message, "command", 0))
                command_name = _enum_name("MAV_CMD", command, str(command)).removeprefix("MAV_CMD_")
                latitude_raw = float(getattr(message, "x", 0))
                longitude_raw = float(getattr(message, "y", 0))
                latitude = latitude_raw / 1e7 if message_type == "MISSION_ITEM_INT" else latitude_raw
                longitude = longitude_raw / 1e7 if message_type == "MISSION_ITEM_INT" else longitude_raw
                return "info", "mission", (
                    f"item seq={int(getattr(message, 'seq', 0))} command={command_name} ({command}) "
                    f"lat={latitude:.7f} lon={longitude:.7f} alt={float(getattr(message, 'z', 0)):.1f}m"
                )
            if message_type in ("MISSION_REQUEST", "MISSION_REQUEST_INT"):
                return "info", "mission", f"request item seq={int(getattr(message, 'seq', 0))}"
            if message_type == "MISSION_ITEM_REACHED":
                return "info", "mission", f"reached waypoint {int(getattr(message, 'seq', 0))}"
            if message_type == "MISSION_CURRENT":
                current = int(getattr(message, "seq", 0))
                total = int(getattr(message, "total", 0))
                return "info", "mission", f"current waypoint {current}" + (f" / {total}" if total else "")
            if message_type == "MISSION_COUNT":
                return "info", "mission", f"mission loaded · {int(getattr(message, 'count', 0))} items"
            if message_type == "MISSION_ACK":
                result = int(getattr(message, "type", 0))
                result_name = _enum_name("MAV_MISSION_RESULT", result, str(result)).removeprefix("MAV_MISSION_")
                severity = "info" if result == mavutil.mavlink.MAV_MISSION_ACCEPTED else "error"
                return severity, "mission", f"mission protocol -> {result_name}"

        return "debug", "telemetry", _field_text(message_type, message)


class ReadOnlyMavlinkMonitor:
    def __init__(self, endpoint: str, heartbeat_timeout: float = 3.0) -> None:
        self.state = MonitorConsoleState(endpoint, heartbeat_timeout)
        self.endpoint = endpoint
        self._stop_event = threading.Event()
        self._connection: Any | None = None
        self._connection_lock = threading.RLock()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name="mavlink-monitor-reader", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        self._close_connection()
        if self._thread:
            self._thread.join(timeout=3)

    def _run(self) -> None:
        reconnect_delay = 0.5
        while not self._stop_event.is_set():
            try:
                connection = mavutil.mavlink_connection(
                    self.endpoint,
                    dialect="ardupilotmega",
                    autoreconnect=True,
                    robust_parsing=True,
                )
                with self._connection_lock:
                    self._connection = connection
                self.state.set_transport_connected(True)
                LOGGER.info("Read-only MAVLink monitor opened: %s", self.endpoint)
                reconnect_delay = 0.5
                while not self._stop_event.is_set():
                    message = connection.recv_match(blocking=True, timeout=0.25)
                    if message is not None:
                        self.state.handle_message(message)
            except Exception:
                if not self._stop_event.is_set():
                    LOGGER.exception("Read-only MAVLink monitor failed; retrying")
            finally:
                self.state.set_transport_connected(False)
                self._close_connection()
            if not self._stop_event.wait(reconnect_delay):
                reconnect_delay = min(reconnect_delay * 2, 5.0)

    def _close_connection(self) -> None:
        with self._connection_lock:
            connection, self._connection = self._connection, None
        if connection is not None:
            try:
                connection.close()
            except Exception:
                LOGGER.debug("Ignoring MAVLink monitor close error", exc_info=True)
