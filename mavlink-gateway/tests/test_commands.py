from __future__ import annotations

from pymavlink import mavutil

from muva_gateway.commands import CommandRejectedError, CommandService, OperationBusyError
from muva_gateway.config import Settings
from muva_gateway.state import VehicleState

from test_state import Message, heartbeat


class FakeMav:
    def __init__(self, state: VehicleState) -> None:
        self.state = state

    def set_mode_send(self, _system: int, _flags: int, custom_mode: int) -> None:
        self.state.handle_message(heartbeat(custom_mode=custom_mode, armed=bool(self.state.vehicle_value("armed"))))

    def command_long_send(self, _system: int, _component: int, command: int, _confirmation: int, *params: float) -> None:
        self.state.handle_message(Message("COMMAND_ACK", command=command, result=0, progress=0))
        if command == mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM:
            self.state.handle_message(heartbeat(custom_mode=4, armed=bool(params[0])))
        elif command == mavutil.mavlink.MAV_CMD_NAV_TAKEOFF:
            self.state.handle_message(Message(
                "GLOBAL_POSITION_INT",
                lat=343416000,
                lon=1089398000,
                alt=415000,
                relative_alt=int(params[6] * 1000),
                vx=0,
                vy=0,
                vz=0,
                hdg=0,
            ))

    def set_position_target_global_int_send(self, *_args: object) -> None:
        return None


class FakeConnection:
    def __init__(self, state: VehicleState) -> None:
        self.mav = FakeMav(state)


class FakeTransport:
    def __init__(self, state: VehicleState) -> None:
        self.connection = FakeConnection(state)

    def send(self, callback):
        callback(self.connection)

    def mode_mapping(self) -> dict[str, int]:
        return {name: number for number, name in mavutil.mode_mapping_acm.items()}


def connected_state() -> VehicleState:
    state = VehicleState()
    state.set_transport_connected(True)
    state.handle_message(heartbeat(custom_mode=0, armed=False))
    return state


def test_set_mode_waits_for_heartbeat_state() -> None:
    state = connected_state()
    service = CommandService(Settings(command_timeout=0.2), state, FakeTransport(state))

    result = service.set_mode("GUIDED")

    assert result == {"accepted": True, "mode": "GUIDED"}
    assert state.vehicle_value("mode") == "GUIDED"


def test_arm_requires_ack_and_armed_heartbeat() -> None:
    state = connected_state()
    service = CommandService(Settings(command_timeout=0.2), state, FakeTransport(state))

    result = service.arm(True)

    assert result["accepted"] is True
    assert result["armed"] is True
    assert result["ack"]["resultName"] == "ACCEPTED"
    assert state.vehicle_value("armed") is True


def test_stabilize_arm_switches_to_guided_and_allows_takeoff() -> None:
    state = connected_state()  # ArduCopter starts in STABILIZE (custom mode 0).
    service = CommandService(Settings(command_timeout=0.2, takeoff_timeout=0.2), state, FakeTransport(state))

    arm_result = service.arm(True)
    takeoff_result = service.takeoff(10)

    assert arm_result["accepted"] is True
    assert arm_result["modeChanged"] is True
    assert arm_result["mode"] == "GUIDED"
    assert takeoff_result["accepted"] is True
    assert takeoff_result["confirmedAltitude"] == 10.0


def test_repeated_arm_repairs_non_guided_ground_mode() -> None:
    state = connected_state()
    state.handle_message(heartbeat(custom_mode=0, armed=True))
    service = CommandService(Settings(command_timeout=0.2), state, FakeTransport(state))

    result = service.arm(True)

    assert result["accepted"] is True
    assert result["idempotent"] is True
    assert result["modeChanged"] is True
    assert result["mode"] == "GUIDED"
    assert state.vehicle_value("armed") is True


def test_arm_from_ground_auto_switches_to_guided() -> None:
    state = connected_state()
    state.handle_message(heartbeat(custom_mode=3, armed=False))  # AUTO
    service = CommandService(Settings(command_timeout=0.2), state, FakeTransport(state))

    result = service.arm(True)

    assert result["accepted"] is True
    assert result["modeChanged"] is True
    assert result["mode"] == "GUIDED"
    assert state.vehicle_value("armed") is True


def test_arm_from_ground_land_switches_to_guided() -> None:
    state = connected_state()
    state.handle_message(heartbeat(custom_mode=9, armed=False))  # LAND
    service = CommandService(Settings(command_timeout=0.2), state, FakeTransport(state))

    result = service.arm(True)

    assert result["accepted"] is True
    assert result["modeChanged"] is True
    assert result["mode"] == "GUIDED"


def test_arm_rejection_includes_flight_controller_status() -> None:
    class RejectingMav(FakeMav):
        def command_long_send(self, _system: int, _component: int, command: int, _confirmation: int, *params: float) -> None:
            self.state.handle_message(Message("STATUSTEXT", severity=3, text=b"PreArm: GPS not healthy"))
            self.state.handle_message(Message("COMMAND_ACK", command=command, result=mavutil.mavlink.MAV_RESULT_DENIED, progress=0))

    class RejectingTransport(FakeTransport):
        def __init__(self, state: VehicleState) -> None:
            self.connection = type("Connection", (), {"mav": RejectingMav(state)})()

    state = connected_state()
    service = CommandService(Settings(command_timeout=0.2), state, RejectingTransport(state))

    import pytest
    with pytest.raises(CommandRejectedError, match="GPS not healthy"):
        service.arm(True)


def test_repeated_same_state_commands_are_idempotent() -> None:
    state = connected_state()
    service = CommandService(Settings(command_timeout=0.2), state, FakeTransport(state))

    first = service.set_mode("GUIDED")
    second = service.set_mode("GUIDED")
    assert first["accepted"] is True
    assert second["idempotent"] is True


def test_concurrent_operation_is_rejected_instead_of_queued() -> None:
    import threading

    state = connected_state()
    lock = threading.RLock()
    service = CommandService(Settings(command_timeout=0.2), state, FakeTransport(state), lock)
    lock.acquire()
    try:
        import pytest
        result: list[BaseException] = []

        def invoke() -> None:
            try:
                service.arm(True)
            except BaseException as error:  # pass the worker exception to the assertion thread
                result.append(error)

        worker = threading.Thread(target=invoke)
        worker.start()
        worker.join(timeout=1)
        assert result and isinstance(result[0], OperationBusyError)
    finally:
        lock.release()


def test_hold_uses_guided_position_target_instead_of_loiter() -> None:
    state = connected_state()
    state.handle_message(heartbeat(custom_mode=4, armed=True))
    state.handle_message(Message(
        "GLOBAL_POSITION_INT",
        lat=343416000,
        lon=1089398000,
        alt=405000,
        relative_alt=8000,
        vx=0,
        vy=0,
        vz=0,
        hdg=0,
    ))
    service = CommandService(Settings(command_timeout=0.2), state, FakeTransport(state))

    result = service.hold()

    assert result["accepted"] is True
    assert result["mode"] == "GUIDED"
    assert result["altitude"] == 8.0
