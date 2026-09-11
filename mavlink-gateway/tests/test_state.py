from __future__ import annotations

from pymavlink import mavutil

from muva_gateway.state import VehicleState


class Message:
    def __init__(self, message_type: str, **values: object) -> None:
        self._message_type = message_type
        self.__dict__.update(values)

    def get_type(self) -> str:
        return self._message_type

    def get_srcSystem(self) -> int:
        return 1

    def get_srcComponent(self) -> int:
        return 1


def heartbeat(custom_mode: int = 4, armed: bool = True) -> Message:
    return Message(
        "HEARTBEAT",
        type=mavutil.mavlink.MAV_TYPE_QUADROTOR,
        autopilot=mavutil.mavlink.MAV_AUTOPILOT_ARDUPILOTMEGA,
        base_mode=mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED
        | (mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED if armed else 0),
        custom_mode=custom_mode,
        system_status=mavutil.mavlink.MAV_STATE_ACTIVE,
    )


def test_state_normalises_core_telemetry() -> None:
    state = VehicleState()
    state.set_transport_connected(True)
    state.handle_message(heartbeat())
    state.handle_message(
        Message(
            "GLOBAL_POSITION_INT",
            lat=343416000,
            lon=1089398000,
            alt=423400,
            relative_alt=18400,
            vx=300,
            vy=400,
            vz=-20,
            hdg=7200,
        )
    )
    state.handle_message(
        Message("SYS_STATUS", voltage_battery=15700, current_battery=830, battery_remaining=76)
    )
    state.handle_message(Message("GPS_RAW_INT", fix_type=3, satellites_visible=17, eph=72))

    snapshot = state.snapshot("test")

    assert snapshot["connection"]["connected"] is True
    assert snapshot["vehicle"]["mode"] == "GUIDED"
    assert snapshot["vehicle"]["armed"] is True
    assert snapshot["telemetry"]["latitude"] == 34.3416
    assert snapshot["telemetry"]["longitude"] == 108.9398
    assert snapshot["telemetry"]["groundSpeed"] == 5.0
    assert snapshot["telemetry"]["altitude"] == 18.4
    assert snapshot["telemetry"]["battery"] == 76
    assert snapshot["telemetry"]["satellites"] == 17
    assert snapshot["telemetry"]["hdop"] == 0.72


def test_command_ack_generation_is_monotonic() -> None:
    state = VehicleState()
    command = mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM
    state.handle_message(Message("COMMAND_ACK", command=command, result=0, progress=0))
    first = state.ack_generation(command)
    state.handle_message(Message("COMMAND_ACK", command=command, result=2, progress=0))

    assert first == 1
    assert state.ack_generation(command) == 2
    assert state.wait_for_ack(command, first, 0.01)["result"] == 2


def test_mission_verification_is_exposed_and_invalidated_on_disconnect() -> None:
    state = VehicleState()
    state.set_transport_connected(True)
    state.set_mission_verification(True, 1234.5, "mission-sha256")

    verified = state.snapshot("test")["mission"]
    assert verified["verified"] is True
    assert verified["verifiedAt"] == 1234.5
    assert verified["missionHash"] == "mission-sha256"

    state.set_transport_connected(False)

    invalidated = state.snapshot("test")["mission"]
    assert invalidated["verified"] is False
    assert invalidated["verifiedAt"] is None
    assert invalidated["missionHash"] is None


def test_active_mission_becomes_aborted_when_auto_is_interrupted() -> None:
    state = VehicleState()
    state.set_transport_connected(True)
    state.handle_message(heartbeat(custom_mode=3, armed=True))  # AUTO
    state.handle_message(Message("MISSION_COUNT", count=4))
    state.handle_message(Message("MISSION_CURRENT", seq=1, total=4))
    state.handle_message(heartbeat(custom_mode=5, armed=True))  # LOITER

    assert state.snapshot("test")["mission"]["state"] == "aborted"


def test_active_mission_completes_after_final_item_and_disarm() -> None:
    state = VehicleState()
    state.set_transport_connected(True)
    state.handle_message(heartbeat(custom_mode=3, armed=True))  # AUTO
    state.handle_message(Message("MISSION_COUNT", count=4))
    state.handle_message(Message("MISSION_CURRENT", seq=3, total=4))
    state.handle_message(heartbeat(custom_mode=9, armed=True))  # LAND
    state.handle_message(
        Message(
            "GLOBAL_POSITION_INT",
            lat=343416000,
            lon=1089398000,
            alt=405000,
            relative_alt=500,
            vx=0,
            vy=0,
            vz=0,
            hdg=0,
        )
    )
    state.handle_message(heartbeat(custom_mode=9, armed=False))  # LAND disarmed

    assert state.snapshot("test")["mission"]["state"] == "completed"


def test_completed_mission_stays_completed_on_late_current_message() -> None:
    state = VehicleState()
    state.set_transport_connected(True)
    state.handle_message(heartbeat(custom_mode=3, armed=True))
    state.handle_message(Message("MISSION_COUNT", count=4))
    state.handle_message(Message("MISSION_CURRENT", seq=3, total=4))
    state.handle_message(Message("MISSION_ITEM_REACHED", seq=3))
    state.handle_message(
        Message(
            "GLOBAL_POSITION_INT", lat=343416000, lon=1089398000, alt=405000,
            relative_alt=0, vx=0, vy=0, vz=0, hdg=0,
        )
    )
    state.handle_message(heartbeat(custom_mode=3, armed=False))
    state.handle_message(Message("MISSION_CURRENT", seq=1, total=4))

    assert state.snapshot("test")["mission"]["state"] == "completed"
