from __future__ import annotations

from pymavlink import mavutil

from muva_gateway.monitor import MonitorConsoleState


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

    def to_dict(self) -> dict[str, object]:
        return {"mavpackettype": self._message_type, **self._fields}


def test_monitor_console_formats_important_return_messages() -> None:
    state = MonitorConsoleState("udpin:0.0.0.0:14553")
    state.set_transport_connected(True)
    state.handle_message(Message(
        "HEARTBEAT",
        type=mavutil.mavlink.MAV_TYPE_QUADROTOR,
        autopilot=mavutil.mavlink.MAV_AUTOPILOT_ARDUPILOTMEGA,
        base_mode=mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
        custom_mode=4,
        system_status=mavutil.mavlink.MAV_STATE_ACTIVE,
    ))
    state.handle_message(Message("STATUSTEXT", severity=3, text=b"PreArm: GPS not healthy\x00"))
    state.handle_message(Message(
        "COMMAND_ACK",
        command=mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
        result=mavutil.mavlink.MAV_RESULT_DENIED,
        progress=0,
    ))
    state.handle_message(Message("MISSION_CURRENT", seq=2, total=6))

    snapshot = state.snapshot()

    assert snapshot["connection"]["connected"] is True
    assert snapshot["connection"]["endpoint"] == "udpin:0.0.0.0:14553"
    assert snapshot["packetCount"] == 4
    assert [entry["type"] for entry in snapshot["entries"]] == [
        "HEARTBEAT",
        "STATUSTEXT",
        "COMMAND_ACK",
        "MISSION_CURRENT",
    ]
    assert snapshot["entries"][1]["severity"] == "error"
    assert "GPS not healthy" in snapshot["entries"][1]["text"]
    assert snapshot["entries"][2]["severity"] == "error"
    assert "DENIED" in snapshot["entries"][2]["text"]


def test_monitor_console_rate_limits_high_frequency_telemetry() -> None:
    state = MonitorConsoleState("udpin:0.0.0.0:14553")
    state.handle_message(Message("ATTITUDE", roll=0.1, pitch=0.2, yaw=0.3))
    state.handle_message(Message("ATTITUDE", roll=0.4, pitch=0.5, yaw=0.6))

    snapshot = state.snapshot()

    assert snapshot["packetCount"] == 2
    assert snapshot["messageCounts"]["ATTITUDE"] == 2
    assert len(snapshot["entries"]) == 0


def test_monitor_console_only_reports_heartbeat_state_changes() -> None:
    state = MonitorConsoleState("udpin:0.0.0.0:14553")
    heartbeat = Message(
        "HEARTBEAT",
        type=mavutil.mavlink.MAV_TYPE_QUADROTOR,
        autopilot=mavutil.mavlink.MAV_AUTOPILOT_ARDUPILOTMEGA,
        base_mode=mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
        custom_mode=4,
        system_status=mavutil.mavlink.MAV_STATE_ACTIVE,
    )
    state.handle_message(heartbeat)
    state.handle_message(heartbeat)

    assert len(state.snapshot()["entries"]) == 1


def test_monitor_console_hides_unrelated_boot_status_text() -> None:
    state = MonitorConsoleState("udpin:0.0.0.0:14553")
    state.handle_message(Message("STATUSTEXT", severity=6, text=b"Barometer calibration complete"))
    state.handle_message(Message("STATUSTEXT", severity=6, text=b"Mission started"))

    entries = state.snapshot()["entries"]

    assert len(entries) == 1
    assert entries[0]["text"].endswith("Mission started")
