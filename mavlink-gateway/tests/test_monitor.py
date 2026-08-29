from __future__ import annotations

import time

from pymavlink import mavutil

from mavlink_monitor import MonitorState, render, udp_port_is_available


class Message:
    def __init__(self, message_type: str, **fields: object) -> None:
        self._message_type = message_type
        self._fields = fields
        for name, value in fields.items():
            setattr(self, name, value)

    def get_type(self) -> str:
        return self._message_type

    def get_srcSystem(self) -> int:
        return 1

    def get_srcComponent(self) -> int:
        return 1


def heartbeat() -> Message:
    return Message(
        "HEARTBEAT",
        type=mavutil.mavlink.MAV_TYPE_QUADROTOR,
        autopilot=mavutil.mavlink.MAV_AUTOPILOT_ARDUPILOTMEGA,
        base_mode=mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED | mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED,
        custom_mode=4,
        system_status=mavutil.mavlink.MAV_STATE_ACTIVE,
    )


def test_monitor_collects_core_flight_state_and_events() -> None:
    state = MonitorState()
    state.handle(heartbeat())
    state.handle(Message(
        "GLOBAL_POSITION_INT",
        lat=343416000,
        lon=1089398000,
        alt=423400,
        relative_alt=18400,
        vx=300,
        vy=400,
        vz=-20,
        hdg=7200,
    ))
    state.handle(Message("VFR_HUD", airspeed=0, groundspeed=5.0, climb=0.2, heading=72, throttle=46, alt=423.4))
    state.handle(Message("GPS_RAW_INT", fix_type=3, satellites_visible=17, eph=72, epv=110, h_acc=0, v_acc=0))
    state.handle(Message(
        "SYS_STATUS",
        voltage_battery=15700,
        current_battery=830,
        battery_remaining=76,
        onboard_control_sensors_enabled=0xFF,
        onboard_control_sensors_health=0xFF,
    ))
    state.handle(Message("MISSION_CURRENT", seq=2, total=4))
    state.handle(Message("MISSION_ITEM_REACHED", seq=1))
    state.handle(Message("STATUSTEXT", severity=3, text=b"PreArm: GPS not healthy\x00"))
    state.handle(Message(
        "COMMAND_ACK",
        command=mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
        result=mavutil.mavlink.MAV_RESULT_DENIED,
    ))

    output = render(state, "udpin:0.0.0.0:14552", clear=False)

    assert "mode=GUIDED" in output
    assert "lat=34.3416000" in output
    assert "ground=5.0m/s" in output
    assert "satellites=17" in output
    assert "voltage=15.70V" in output
    assert "current=2/4" in output
    assert "PreArm: GPS not healthy" in output
    assert "DENIED" in output
    assert "COMPONENT_ARM_DISARM" in output


def test_duplicate_health_events_are_rate_limited() -> None:
    state = MonitorState()
    message = Message(
        "SYS_STATUS",
        voltage_battery=12000,
        current_battery=0,
        battery_remaining=100,
        onboard_control_sensors_enabled=0x03,
        onboard_control_sensors_health=0x01,
    )
    state.handle(message)
    state.handle(message)

    assert len(state.events) == 1
    assert "0x2" in state.events[0][2]


def test_stale_heartbeat_is_reported_as_waiting() -> None:
    state = MonitorState()
    state.handle(heartbeat())
    state.heartbeat.received_at = time.monotonic() - 4

    assert "LINK    WAITING" in render(state, "test", clear=False)


def test_udp_port_probe_accepts_ephemeral_port() -> None:
    assert udp_port_is_available("127.0.0.1", 0) is True
