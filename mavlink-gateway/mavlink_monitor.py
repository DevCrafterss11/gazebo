#!/usr/bin/env python3
"""Read-only MAVLink flight monitor.

The monitor intentionally does not send flight-control commands. It only reads
MAVLink packets and renders a compact dashboard plus a rolling event log.

Examples:
    python mavlink_monitor.py --port 14553
    python mavlink_monitor.py --endpoint tcp:127.0.0.1:5762 --no-clear
    python mavlink_monitor.py --port 14554 --log logs/flight.jsonl
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import signal
import socket
import sys
import time
from collections import Counter, deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pymavlink import mavutil


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

ACK_RESULT_NAMES = {
    value: entry.name
    for value, entry in mavutil.mavlink.enums.get("MAV_RESULT", {}).items()
}

MODE_FLAG_ARMED = mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED
SEVERITY_ALERT = 4


def finite(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def field_value(message: Any, name: str, default: Any = None) -> Any:
    return getattr(message, name, default)


def enum_name(table: str, value: int, fallback: str = "UNKNOWN") -> str:
    entry = mavutil.mavlink.enums.get(table, {}).get(value)
    return entry.name if entry is not None else fallback


def format_age(timestamp: float | None) -> str:
    if timestamp is None:
        return "--"
    age = max(0.0, time.monotonic() - timestamp)
    return f"{age:.1f}s"


def format_float(value: Any, digits: int = 1, suffix: str = "") -> str:
    if value is None or value == "--":
        return f"--{suffix}"
    number = finite(value)
    return f"{number:.{digits}f}{suffix}"


def format_int(value: Any, suffix: str = "") -> str:
    try:
        return f"{int(value)}{suffix}"
    except (TypeError, ValueError):
        return f"--{suffix}"


def decode_sensor_flags(flags: int) -> str:
    names = (
        (1, "GYRO"),
        (2, "ACCEL"),
        (4, "MAG"),
        (8, "BARO"),
        (32, "GPS"),
        (64, "OPTICAL_FLOW"),
        (128, "VISION"),
        (256, "LASER"),
        (1024, "ANGULAR_RATE"),
        (2048, "ATTITUDE"),
        (4096, "YAW_POSITION"),
        (8192, "ALTITUDE"),
        (16384, "XY_POSITION"),
        (32768, "MOTOR_OUTPUTS"),
        (65536, "RC"),
        (131072, "GYRO2"),
        (262144, "ACCEL2"),
        (524288, "MAG2"),
        (1048576, "GEOFENCE"),
        (2097152, "AHRS"),
        (4194304, "TERRAIN"),
        (8388608, "REVERSE_MOTOR"),
        (16777216, "LOGGING"),
        (33554432, "BATTERY"),
        (67108864, "PROXIMITY"),
        (134217728, "SATCOM"),
        (268435456, "PREARM"),
        (536870912, "OBSTACLE_AVOIDANCE"),
    )
    active = [name for bit, name in names if flags & bit]
    return ",".join(active) if active else "NONE"


def decode_ekf_flags(flags: int) -> str:
    names = (
        (1, "ATTITUDE"),
        (2, "VELOCITY_HORIZ"),
        (4, "VELOCITY_VERT"),
        (8, "POS_HORIZ_REL"),
        (16, "POS_HORIZ_ABS"),
        (32, "POS_VERT_ABS"),
        (64, "POS_VERT_AGL"),
        (128, "CONST_POS"),
        (256, "PRED_POS_HORIZ_REL"),
        (512, "PRED_POS_HORIZ_ABS"),
        (1024, "PRED_POS_VERT_ABS"),
        (2048, "GPS_GLITCH"),
        (4096, "GPS"),
        (8192, "MAG_CONST"),
        (16384, "YAW") ,
    )
    active = [name for bit, name in names if flags & bit]
    return ",".join(active) if active else "NONE"


@dataclass
class Sample:
    values: dict[str, Any] = field(default_factory=dict)
    received_at: float | None = None

    def update(self, received_at: float, **values: Any) -> None:
        self.values.update(values)
        self.received_at = received_at


@dataclass
class MonitorState:
    started_at: float = field(default_factory=time.monotonic)
    packet_count: int = 0
    message_counts: Counter[str] = field(default_factory=Counter)
    heartbeat: Sample = field(default_factory=Sample)
    position: Sample = field(default_factory=Sample)
    attitude: Sample = field(default_factory=Sample)
    hud: Sample = field(default_factory=Sample)
    gps: Sample = field(default_factory=Sample)
    power: Sample = field(default_factory=Sample)
    mission: Sample = field(default_factory=Sample)
    health: Sample = field(default_factory=Sample)
    rc: Sample = field(default_factory=Sample)
    servo: Sample = field(default_factory=Sample)
    home: Sample = field(default_factory=Sample)
    events: deque[tuple[float, str, str]] = field(default_factory=lambda: deque(maxlen=14))

    def event(self, severity: str, text: str, received_at: float | None = None) -> None:
        now = time.time()
        if any(item_severity == severity and item_text == text and now - timestamp < 10 for timestamp, item_severity, item_text in self.events):
            return
        self.events.appendleft((received_at or now, severity, text))

    def handle(self, message: Any) -> None:
        received_at = time.monotonic()
        wall_time = time.time()
        message_type = message.get_type()
        self.packet_count += 1
        self.message_counts[message_type] += 1

        if message_type == "HEARTBEAT":
            if int(field_value(message, "type", 0)) == mavutil.mavlink.MAV_TYPE_GCS:
                return
            armed = bool(int(field_value(message, "base_mode", 0)) & MODE_FLAG_ARMED)
            mode = mavutil.mode_string_v10(message)
            self.heartbeat.update(
                received_at,
                system_id=int(message.get_srcSystem()),
                component_id=int(message.get_srcComponent()),
                vehicle_type=enum_name("MAV_TYPE", int(field_value(message, "type", 0))),
                autopilot=enum_name("MAV_AUTOPILOT", int(field_value(message, "autopilot", 0))),
                mode=mode,
                armed=armed,
                system_status=enum_name("MAV_STATE", int(field_value(message, "system_status", 0))),
            )
            return

        if message_type == "GLOBAL_POSITION_INT":
            self.position.update(
                received_at,
                latitude=finite(field_value(message, "lat")) / 1e7,
                longitude=finite(field_value(message, "lon")) / 1e7,
                absolute_altitude=finite(field_value(message, "alt")) / 1000,
                relative_altitude=finite(field_value(message, "relative_alt")) / 1000,
                north_speed=finite(field_value(message, "vx")) / 100,
                east_speed=finite(field_value(message, "vy")) / 100,
                down_speed=finite(field_value(message, "vz")) / 100,
                heading=(finite(field_value(message, "hdg"), 65535) / 100) if field_value(message, "hdg", 65535) != 65535 else None,
            )
        elif message_type == "ATTITUDE":
            self.attitude.update(
                received_at,
                roll=math.degrees(finite(field_value(message, "roll"))),
                pitch=math.degrees(finite(field_value(message, "pitch"))),
                yaw=math.degrees(finite(field_value(message, "yaw"))),
                roll_speed=math.degrees(finite(field_value(message, "rollspeed"))),
                pitch_speed=math.degrees(finite(field_value(message, "pitchspeed"))),
                yaw_speed=math.degrees(finite(field_value(message, "yawspeed"))),
            )
        elif message_type == "VFR_HUD":
            self.hud.update(
                received_at,
                airspeed=finite(field_value(message, "airspeed")),
                groundspeed=finite(field_value(message, "groundspeed")),
                climb=finite(field_value(message, "climb")),
                heading=int(field_value(message, "heading", 0)),
                throttle=int(field_value(message, "throttle", 0)),
                altitude=finite(field_value(message, "alt")),
            )
        elif message_type == "GPS_RAW_INT":
            self.gps.update(
                received_at,
                fix_type=int(field_value(message, "fix_type", 0)),
                satellites=int(field_value(message, "satellites_visible", 0)),
                hdop=finite(field_value(message, "eph"), 65535) / 100 if field_value(message, "eph", 65535) != 65535 else None,
                vdop=finite(field_value(message, "epv"), 65535) / 100 if field_value(message, "epv", 65535) != 65535 else None,
                hacc=finite(field_value(message, "h_acc"), 0) / 1000,
                vacc=finite(field_value(message, "v_acc"), 0) / 1000,
            )
        elif message_type in ("SYS_STATUS", "BATTERY_STATUS"):
            self._handle_power(message_type, message, received_at)
        elif message_type == "EKF_STATUS_REPORT":
            flags = int(field_value(message, "flags", 0))
            self.health.update(received_at, ekf_flags=flags, ekf_text=decode_ekf_flags(flags))
            if flags & 2048:
                self.event("CRITICAL", "EKF reports GPS glitch", wall_time)
        elif message_type == "ESTIMATOR_STATUS":
            flags = int(field_value(message, "flags", 0))
            self.health.update(received_at, estimator_flags=flags)
        elif message_type == "MISSION_CURRENT":
            self.mission.update(
                received_at,
                current=int(field_value(message, "seq", 0)),
                total=int(field_value(message, "total", 0)),
            )
        elif message_type == "MISSION_ITEM_REACHED":
            reached = int(field_value(message, "seq", 0))
            self.mission.update(received_at, last_reached=reached)
            self.event("MISSION", f"Reached mission item {reached}", wall_time)
        elif message_type == "NAV_CONTROLLER_OUTPUT":
            self.mission.update(
                received_at,
                waypoint_distance=finite(field_value(message, "wp_dist")),
                nav_bearing=finite(field_value(message, "nav_bearing")),
                target_bearing=finite(field_value(message, "target_bearing")),
                xtrack_error=finite(field_value(message, "xtrack_error")),
            )
        elif message_type == "RC_CHANNELS":
            channels = [int(field_value(message, f"chan{i}_raw", 0)) for i in range(1, 17)]
            raw_rssi = int(field_value(message, "rssi", 255))
            rssi = None if raw_rssi == 255 else round(max(0, min(254, raw_rssi)) / 254 * 100)
            self.rc.update(received_at, channels=channels, rssi=rssi)
        elif message_type == "SERVO_OUTPUT_RAW":
            outputs = [int(field_value(message, f"servo{i}_raw", 0)) for i in range(1, 17)]
            self.servo.update(received_at, outputs=outputs)
        elif message_type == "HOME_POSITION":
            self.home.update(
                received_at,
                latitude=finite(field_value(message, "latitude", field_value(message, "x"))) / 1e7,
                longitude=finite(field_value(message, "longitude", field_value(message, "y"))) / 1e7,
                altitude=finite(field_value(message, "altitude", field_value(message, "z"))) / 1000,
            )
        elif message_type == "STATUSTEXT":
            severity = int(field_value(message, "severity", 6))
            text = field_value(message, "text", "")
            if isinstance(text, bytes):
                text = text.decode(errors="replace")
            text = str(text).rstrip("\x00")
            self.event(SEVERITY_NAMES.get(severity, f"SEV{severity}"), text, wall_time)
        elif message_type == "COMMAND_ACK":
            command = int(field_value(message, "command", 0))
            result = int(field_value(message, "result", 0))
            result_name = ACK_RESULT_NAMES.get(result, enum_name("MAV_RESULT", result))
            command_name = enum_name("MAV_CMD", command, str(command)).removeprefix("MAV_CMD_")
            severity = "INFO" if result in (0, 5) else "ERROR"
            self.event(severity, f"COMMAND_ACK {command_name} ({command}): {result_name}", wall_time)
        elif message_type == "POWER_STATUS":
            self.health.update(
                received_at,
                power_flags=int(field_value(message, "Vcc", 0)),
                power_brick=int(field_value(message, "Vservo", 0)),
            )

    def _handle_power(self, message_type: str, message: Any, received_at: float) -> None:
        if message_type == "SYS_STATUS":
            voltage = field_value(message, "voltage_battery", 65535)
            current = field_value(message, "current_battery", -1)
            remaining = field_value(message, "battery_remaining", -1)
            if voltage != 65535:
                self.power.update(received_at, voltage=finite(voltage) / 1000)
            if current != -1:
                self.power.update(received_at, current=finite(current) / 100)
            if remaining != -1:
                self.power.update(received_at, remaining=int(remaining))
            enabled = int(field_value(message, "onboard_control_sensors_enabled", 0))
            healthy = int(field_value(message, "onboard_control_sensors_health", 0))
            self.health.update(received_at, sensors_enabled=enabled, sensors_healthy=healthy)
            unhealthy = enabled & ~healthy
            if unhealthy:
                self.event("WARNING", f"Unhealthy sensors: {decode_sensor_flags(unhealthy)} (0x{unhealthy:x})")
        else:
            voltages = [value for value in field_value(message, "voltages", []) if value not in (0, 65535)]
            if voltages:
                self.power.update(received_at, voltage=sum(voltages) / 1000)
            current = field_value(message, "current_battery", -1)
            remaining = field_value(message, "battery_remaining", -1)
            if current != -1:
                self.power.update(received_at, current=finite(current) / 100)
            if remaining != -1:
                self.power.update(received_at, remaining=int(remaining))


class JsonlLogger:
    def __init__(self, path: str | None) -> None:
        self._file = None
        if path:
            log_path = Path(path)
            log_path.parent.mkdir(parents=True, exist_ok=True)
            self._file = log_path.open("a", encoding="utf-8")

    def write(self, message: Any) -> None:
        if self._file is None:
            return
        payload = {
            "receivedAt": datetime.now(timezone.utc).isoformat(),
            "type": message.get_type(),
            "sourceSystem": int(message.get_srcSystem()),
            "sourceComponent": int(message.get_srcComponent()),
            "message": message.to_dict(),
        }
        self._file.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str) + "\n")
        self._file.flush()

    def close(self) -> None:
        if self._file is not None:
            self._file.close()


def value(sample: Sample, key: str, default: Any = "--") -> Any:
    return sample.values.get(key, default)


def render(state: MonitorState, endpoint: str, clear: bool) -> str:
    width = max(88, shutil.get_terminal_size((120, 40)).columns)
    lines: list[str] = []
    if clear:
        lines.append("\033[2J\033[H")
    lines.append(f"MUVA MAVLink Monitor  |  {endpoint}  |  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"[:width])
    lines.append("=" * min(width, 116))

    hb = state.heartbeat
    pos = state.position
    att = state.attitude
    hud = state.hud
    gps = state.gps
    power = state.power
    mission = state.mission
    health = state.health
    armed = value(hb, "armed", False)
    link_age = format_age(hb.received_at)
    link = "ONLINE" if hb.received_at is not None and time.monotonic() - hb.received_at < 3 else "WAITING"
    mode = value(hb, "mode")
    lines.append(f"LINK    {link:<8} last heartbeat {link_age:<6} packets {state.packet_count:<8} msg types {len(state.message_counts)}")
    lines.append(
        f"VEHICLE sys={value(hb, 'system_id')} comp={value(hb, 'component_id')} "
        f"type={value(hb, 'vehicle_type')} autopilot={value(hb, 'autopilot')} "
        f"mode={mode:<12} {'ARMED' if armed else 'SAFE':<5} state={value(hb, 'system_status')}"
    )
    lines.append(
        f"POSITION lat={format_float(value(pos, 'latitude'), 7)} lon={format_float(value(pos, 'longitude'), 7)} "
        f"alt_rel={format_float(value(pos, 'relative_altitude'), 1, 'm')} "
        f"alt_abs={format_float(value(pos, 'absolute_altitude'), 1, 'm')}"
    )
    lines.append(
        f"ATTITUDE roll={format_float(value(att, 'roll'), 1, 'deg')} pitch={format_float(value(att, 'pitch'), 1, 'deg')} "
        f"yaw={format_float(value(att, 'yaw'), 1, 'deg')}  "
        f"rates=({format_float(value(att, 'roll_speed'), 2)}, {format_float(value(att, 'pitch_speed'), 2)}, {format_float(value(att, 'yaw_speed'), 2)})"
    )
    lines.append(
        f"NAV     ground={format_float(value(hud, 'groundspeed'), 1, 'm/s')} air={format_float(value(hud, 'airspeed'), 1, 'm/s')} "
        f"climb={format_float(value(hud, 'climb'), 1, 'm/s')} heading={format_int(value(hud, 'heading'), 'deg')} "
        f"throttle={format_int(value(hud, 'throttle'), '%')}"
    )
    gps_fix = int(value(gps, "fix_type", 0)) if value(gps, "fix_type", 0) != "--" else 0
    gps_fix_name = enum_name("GPS_FIX_TYPE", gps_fix, "UNKNOWN").removeprefix("GPS_FIX_TYPE_")
    lines.append(
        f"GPS     fix={gps_fix_name}({gps_fix}) satellites={format_int(value(gps, 'satellites'))} "
        f"hdop={format_float(value(gps, 'hdop'), 2)} vdop={format_float(value(gps, 'vdop'), 2)}"
    )
    lines.append(
        f"POWER   voltage={format_float(value(power, 'voltage'), 2, 'V')} current={format_float(value(power, 'current'), 1, 'A')} "
        f"battery={format_int(value(power, 'remaining'), '%')}"
    )
    lines.append(
        f"MISSION current={format_int(value(mission, 'current'))}/{format_int(value(mission, 'total'))} "
        f"last_reached={format_int(value(mission, 'last_reached'))} distance={format_float(value(mission, 'waypoint_distance'), 0, 'm')} "
        f"xtrack={format_float(value(mission, 'xtrack_error'), 1, 'm')}"
    )
    lines.append(
        f"HEALTH  ekf={value(health, 'ekf_text')} "
        f"sensors=0x{int(value(health, 'sensors_healthy', 0)):x}/0x{int(value(health, 'sensors_enabled', 0)):x}"
    )
    channels = value(state.rc, "channels", [])
    if channels:
        lines.append(f"RC      rssi={format_int(value(state.rc, 'rssi'), '%')} channels=" + " ".join(str(channel) for channel in channels[:8]))
    outputs = value(state.servo, "outputs", [])
    if outputs:
        lines.append("SERVO   " + " ".join(f"{index + 1}:{output}" for index, output in enumerate(outputs[:8])))
    if state.home.received_at:
        lines.append(
            f"HOME    lat={format_float(value(state.home, 'latitude'), 7)} lon={format_float(value(state.home, 'longitude'), 7)} "
            f"alt={format_float(value(state.home, 'altitude'), 1, 'm')}"
        )

    lines.append("-" * min(width, 116))
    lines.append("RECENT EVENTS  (STATUSTEXT, COMMAND_ACK, mission and health warnings)")
    if not state.events:
        lines.append("  -- no events received --")
    else:
        for timestamp, severity, text in list(state.events)[:10]:
            stamp = datetime.fromtimestamp(timestamp).strftime("%H:%M:%S")
            lines.append(f"  {stamp} [{severity:<9}] {text}"[:width])
    lines.append("-" * min(width, 116))
    top_types = ", ".join(f"{name}={count}" for name, count in state.message_counts.most_common(8))
    lines.append(f"MESSAGE COUNTS  {top_types}")
    lines.append("Press Ctrl-C to stop. Use --no-clear for a streaming event log.")
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Read-only MAVLink flight status and error monitor")
    parser.add_argument("--port", type=int, default=int(os.getenv("MUVA_MONITOR_PORT", "14554")), help="UDP input port (default: 14554)")
    parser.add_argument("--bind", default=os.getenv("MUVA_MONITOR_BIND", "0.0.0.0"), help="UDP bind address")
    parser.add_argument("--endpoint", default=None, help="Full pymavlink endpoint, e.g. tcp:127.0.0.1:5762")
    parser.add_argument("--interval", type=float, default=1.0, help="Dashboard refresh interval in seconds")
    parser.add_argument("--rate", type=int, default=5, help="Requested MAVLink telemetry rate in Hz")
    parser.add_argument("--passive", action="store_true", help="Do not send a telemetry stream subscription request")
    parser.add_argument("--log", default=None, help="Append every received MAVLink packet as JSONL")
    parser.add_argument("--no-clear", action="store_true", help="Keep dashboard snapshots in the terminal")
    parser.add_argument("--once", action="store_true", help="Receive one packet and exit")
    return parser.parse_args()


def udp_port_is_available(bind_address: str, port: int) -> bool:
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.bind((bind_address, port))
        return True
    except OSError:
        return False
    finally:
        probe.close()


def main() -> int:
    args = parse_args()
    if args.interval <= 0:
        raise SystemExit("--interval must be greater than zero")
    if args.rate <= 0:
        raise SystemExit("--rate must be greater than zero")
    endpoint = args.endpoint or f"udpin:{args.bind}:{args.port}"
    if args.endpoint is None and not udp_port_is_available(args.bind, args.port):
        print(f"UDP port {args.bind}:{args.port} is already in use.", file=sys.stderr)
        print("Stop the existing receiver, choose another --port, or use --endpoint tcp:127.0.0.1:5762.", file=sys.stderr)
        return 2
    state = MonitorState()
    logger = JsonlLogger(args.log)
    stop = False

    def request_stop(_signum: int, _frame: Any) -> None:
        nonlocal stop
        stop = True

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    print(f"Connecting to {endpoint} ...", flush=True)
    try:
        connection = mavutil.mavlink_connection(endpoint, autoreconnect=True, source_system=254, source_component=190)
    except Exception as error:
        logger.close()
        print(f"Unable to open MAVLink endpoint {endpoint}: {error}", file=sys.stderr)
        print("The web monitor uses 14553. Choose 14554 for this terminal monitor or add another SITL --out port.", file=sys.stderr)
        return 2

    next_render = time.monotonic()
    last_stream_request = 0.0
    try:
        while not stop:
            message = connection.recv_match(blocking=True, timeout=min(0.25, args.interval))
            if message is not None:
                logger.write(message)
                state.handle(message)
                if message.get_type() == "HEARTBEAT" and not args.passive:
                    now = time.monotonic()
                    if now - last_stream_request >= 5:
                        connection.mav.request_data_stream_send(
                            int(message.get_srcSystem()),
                            int(message.get_srcComponent()),
                            mavutil.mavlink.MAV_DATA_STREAM_ALL,
                            args.rate,
                            1,
                        )
                        last_stream_request = now
                if args.once:
                    print(render(state, endpoint, clear=not args.no_clear), flush=True)
                    break
            now = time.monotonic()
            if now >= next_render:
                print(render(state, endpoint, clear=not args.no_clear), flush=True)
                next_render = now + args.interval
    except KeyboardInterrupt:
        pass
    except Exception as error:
        print(f"MAVLink monitor stopped: {error}", file=sys.stderr)
        return 1
    finally:
        logger.close()
        try:
            connection.close()
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
