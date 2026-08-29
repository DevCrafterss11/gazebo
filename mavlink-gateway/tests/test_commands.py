from __future__ import annotations

from pymavlink import mavutil

from muva_gateway.commands import CommandService
from muva_gateway.config import Settings
from muva_gateway.state import VehicleState

from test_state import Message, heartbeat


class FakeMav:
    def __init__(self, state: VehicleState) -> None:
        self.state = state

    def set_mode_send(self, _system: int, _flags: int, custom_mode: int) -> None:
        self.state.handle_message(heartbeat(custom_mode=custom_mode, armed=False))

    def command_long_send(self, _system: int, _component: int, command: int, _confirmation: int, *params: float) -> None:
        self.state.handle_message(Message("COMMAND_ACK", command=command, result=0, progress=0))
        if command == mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM:
            self.state.handle_message(heartbeat(custom_mode=4, armed=bool(params[0])))


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
