import threading
import signal
import json
import socket
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from pymavlink import mavutil

from muva_gateway.commands import CommandRejectedError, InvalidCommandError
from muva_gateway.swarm_app import create_swarm_app
from muva_gateway.swarm_console import FlightConsole, read_display
from muva_gateway.swarm_sitl import SwarmSitlRuntime, SwarmVehicleState


class EkfReport:
    def __init__(self, flags: int, system: int = 21) -> None:
        self.flags = flags
        self.system = system

    def get_type(self) -> str:
        return "EKF_STATUS_REPORT"

    def get_srcSystem(self) -> int:
        return self.system

    def get_srcComponent(self) -> int:
        return 1


def test_position_readiness_requires_fresh_ekf_and_gps() -> None:
    state = SwarmVehicleState()
    state.is_online = lambda: True
    state._telemetry["gpsFixType"] = 3
    state.handle_message(EkfReport(0))
    assert not state.position_ready()
    state.handle_message(EkfReport(mavutil.mavlink.ESTIMATOR_POS_HORIZ_ABS))
    assert state.position_ready()
    state.handle_message(EkfReport(0))
    assert not state.position_ready()
    state.handle_message(EkfReport(mavutil.mavlink.ESTIMATOR_POS_HORIZ_ABS))
    state._position_estimate_at -= 10
    assert not state.position_ready()
    state.handle_message(EkfReport(mavutil.mavlink.ESTIMATOR_POS_HORIZ_ABS))
    state.set_transport_connected(False)
    assert not state.position_ready()


def test_ready_rejects_missing_ekf_and_shutdown_rejects_offline(tmp_path) -> None:
    runtime = SwarmSitlRuntime(state_dir=tmp_path)
    state = SwarmVehicleState()
    state.is_online = lambda: True
    state._telemetry["gpsFixType"] = 3
    runtime.vehicles = [SimpleNamespace(state=state, process=SimpleNamespace(poll=lambda: None))]
    runtime.plan_id = "plan"
    runtime.receipts = [{}]
    runtime.status = "PLANNED"
    runtime.snapshot = lambda: {"status": runtime.status}
    try:
        with pytest.raises(CommandRejectedError, match="EKF"):
            runtime.command("ready")
        state.handle_message(EkfReport(mavutil.mavlink.ESTIMATOR_POS_HORIZ_ABS))
        assert runtime.command("ready")["status"] == "READY"
        state.is_online = lambda: False
        with pytest.raises(CommandRejectedError, match="离线"):
            runtime.require_ground()
        runtime.session_id = "session"
        with pytest.raises(CommandRejectedError, match="离线"):
            runtime.shutdown("session")
    finally:
        runtime.vehicles = []
        runtime.close()


def test_six_vehicle_config_and_safe_restart(monkeypatch, tmp_path) -> None:
    runtime = SwarmSitlRuntime(state_dir=tmp_path)
    config = {"count": 6, "altitude": 30, "speed": 7, "spacing": 12, "safety": 8}
    runtime.validate_config(config)
    with pytest.raises(InvalidCommandError, match="count"):
        runtime.validate_config({**config, "count": 7})
    state = SwarmVehicleState()
    state.is_online = lambda: True
    runtime.session_id = "original-session"
    runtime.vehicles = [SimpleNamespace(state=state, process=SimpleNamespace(poll=lambda: None))]
    closed = []
    monkeypatch.setattr(runtime, "_close_vehicles", lambda: (closed.append(True), runtime.vehicles.clear()))
    try:
        state._vehicle["armed"] = True
        with pytest.raises(CommandRejectedError, match="已解锁"):
            runtime.shutdown("original-session")
        state._vehicle["armed"] = False
        state._telemetry["altitude"] = 30
        with pytest.raises(CommandRejectedError, match="无法确认落地"):
            runtime.shutdown("original-session")
        assert runtime.session_id == "original-session" and not closed
        state._telemetry["altitude"] = 0
        runtime.shutdown("original-session")
        assert closed and runtime.session_id is None
    finally:
        runtime.close()


def test_stale_session_can_only_be_cleared_without_a_live_fleet(tmp_path) -> None:
    runtime = SwarmSitlRuntime(state_dir=tmp_path)
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        runtime.base_port = probe.getsockname()[1]
    try:
        runtime.shutdown("previous-session")
        assert runtime.session_id is None and not runtime.vehicles
        with TestClient(create_swarm_app(runtime)) as client:
            response = client.post("/api/swarm/shutdown", json={"sessionId": "previous-session", "action": "shutdown"})
            assert response.status_code == 200 and response.json() == {"stopped": True}
        with socket.socket() as occupied:
            occupied.bind(("127.0.0.1", runtime.base_port))
            with pytest.raises(CommandRejectedError, match="仍被占用"):
                runtime.shutdown("previous-session")
        runtime.session_id = "another-session"
        with pytest.raises(CommandRejectedError, match="已失效"):
            runtime.shutdown("previous-session")
        runtime.session_id = None
        runtime.vehicles = [SimpleNamespace()]
        with pytest.raises(CommandRejectedError, match="已失效"):
            runtime.shutdown("previous-session")
    finally:
        runtime.vehicles = []
        runtime.close()


def test_coverage_counts_last_confirmed_waypoint(tmp_path) -> None:
    runtime = object.__new__(SwarmSitlRuntime)
    runtime._cancel = threading.Event()
    runtime.return_requested = set()
    runtime.paused = False
    runtime._returning = False
    runtime.config = {"speed": 5}
    runtime._check_motion = lambda: None
    runtime._position = lambda vehicle: vehicle.position
    runtime._target = lambda vehicle, point: setattr(vehicle, "position", point)
    path = [[116.3268, 40.0098], [116.3268, 40.00983], [116.3268, 40.00986]]
    console = FlightConsole(tmp_path / "uav-1")
    vehicle = SimpleNamespace(drone_id="UAV-01", phase="HOLDING", console=console, state=SimpleNamespace(
        is_online=lambda: True, telemetry_value=lambda name: 0), position=path[0], waypoint_index=0, completed=0)
    runtime.vehicles = [vehicle]
    runtime.plan = [{"droneId": vehicle.drone_id, "coverageStartIndex": 0, "coverageWaypointIndices": [1, 2]}]

    runtime._move_many({vehicle.drone_id: path[1:]}, coverage=True)

    assert vehicle.completed == 2
    assert vehicle.waypoint_index == 2
    recorded = [json.loads(line) for line in console.events_file.read_text().splitlines()]
    assert [event["kind"] for event in recorded] == ["TX", "DONE", "TX", "DONE"]


@pytest.mark.parametrize("count", [2, 6])
def test_initialization_opens_separate_read_only_terminals(monkeypatch, tmp_path, count) -> None:
    runtime = SwarmSitlRuntime(workspace=tmp_path, state_dir=tmp_path / "state")
    runtime.vehicles = [SimpleNamespace(drone_id=f"UAV-{index:02}", sys_id=20 + index,
                                        monitor_process=None, console=FlightConsole(runtime.state_dir / f"uav-{index}"))
                        for index in range(1, count + 1)]
    for index in range(1, count + 1):
        (runtime.state_dir / f"uav-{index}").mkdir(parents=True, exist_ok=True)
    spawned = []
    monkeypatch.setenv("DISPLAY", ":0")
    monkeypatch.delenv("MUVA_SWARM_MONITOR_TERMINALS", raising=False)
    monkeypatch.setattr("muva_gateway.swarm_sitl.shutil.which", lambda name: "/usr/bin/xterm")

    def start(args, **kwargs):
        spawned.append((args, kwargs))
        return SimpleNamespace(poll=lambda: None)

    monkeypatch.setattr("muva_gateway.swarm_sitl.subprocess.Popen", start)
    monkeypatch.setattr("muva_gateway.swarm_sitl.time.sleep", lambda seconds: None)
    try:
        runtime._open_monitors()
        assert len(spawned) == count
        assert [args[args.index("--directory") + 1] for args, _ in spawned] == [
            str(runtime.state_dir / f"uav-{index}") for index in range(1, count + 1)]
        assert [args[args.index("--sys-id") + 1] for args, _ in spawned] == [str(20 + index) for index in range(1, count + 1)]
        assert all(args[args.index("-fa") + 1] == "Noto Sans Mono CJK SC" and args[args.index("-u8")] == "-u8" for args, _ in spawned)
        assert all("muva_gateway.swarm_console" in args and "-title" in args for args, _ in spawned)
        assert all(kwargs["env"]["LC_ALL"] == "zh_CN.UTF-8" and kwargs["env"]["PYTHONIOENCODING"] == "UTF-8" for _, kwargs in spawned)
        assert all(vehicle.monitor_process is not None for vehicle in runtime.vehicles)
        monkeypatch.setenv("MUVA_SWARM_MONITOR_TERMINALS", "0")
        runtime._open_monitors()
        assert len(spawned) == count
    finally:
        runtime.vehicles = []
        runtime.close()


def test_monitor_terminals_are_optional_without_desktop(monkeypatch, tmp_path) -> None:
    runtime = SwarmSitlRuntime(state_dir=tmp_path)
    monkeypatch.delenv("DISPLAY", raising=False)
    monkeypatch.delenv("MUVA_SWARM_MONITOR_TERMINALS", raising=False)
    try:
        runtime._open_monitors()
        assert "commands.jsonl" in runtime.events[-1]
    finally:
        runtime.close()


def test_per_vehicle_console_records_real_ack_and_confirmed_state(tmp_path) -> None:
    first = FlightConsole(tmp_path / "uav-1")
    second = FlightConsole(tmp_path / "uav-2")
    state_first = SwarmVehicleState(console=first)
    state_second = SwarmVehicleState(console=second)
    state_first._vehicle["systemId"] = 21
    state_second._vehicle["systemId"] = 22

    def ack(system_id: int, result: int):
        return SimpleNamespace(get_type=lambda: "COMMAND_ACK", get_srcSystem=lambda: system_id,
                               get_srcComponent=lambda: 1, command=400, result=result)

    first.record("TX", "ARM target=21")
    state_first.handle_message(ack(21, mavutil.mavlink.MAV_RESULT_ACCEPTED))
    state_first.handle_message(ack(22, mavutil.mavlink.MAV_RESULT_DENIED))
    state_second.handle_message(ack(22, mavutil.mavlink.MAV_RESULT_DENIED))
    assert all(event["kind"] != "DONE" for event in (json.loads(line) for line in first.events_file.read_text().splitlines()))
    first.record("DONE", "飞控 ACK + 心跳确认解锁")
    first.update({"connected": True, "armed": True, "flightMode": "GUIDED", "phase": "HOLDING"})

    first_events = [json.loads(line) for line in first.events_file.read_text().splitlines()]
    second_events = [json.loads(line) for line in second.events_file.read_text().splitlines()]
    assert [event["kind"] for event in first_events] == ["TX", "RX", "DONE"]
    assert "ACCEPTED" in first_events[1]["text"]
    assert len(second_events) == 1 and "DENIED" in second_events[0]["text"]
    display = read_display(tmp_path / "uav-1", "UAV-01", 21)
    assert "GUIDED" in display and "心跳确认解锁" in display
    assert "DENIED" not in display


def test_new_session_archives_prior_command_record(tmp_path) -> None:
    previous = FlightConsole(tmp_path / "uav-1")
    previous.record("DONE", "上次任务已完成")
    current = FlightConsole(tmp_path / "uav-1")
    current.record("INFO", "新的任务")
    archives = list((tmp_path / "uav-1").glob("commands-*.jsonl"))
    assert len(archives) == 1
    assert "上次任务已完成" in archives[0].read_text()
    assert "上次任务已完成" not in current.events_file.read_text()


def test_console_write_failure_does_not_block_flight(tmp_path) -> None:
    console = FlightConsole(tmp_path / "uav-1")
    console.events_file = tmp_path / "unavailable" / "commands.jsonl"
    console.state_file = tmp_path / "unavailable" / "flight-state.json"
    console.record("TX", "ARM")
    console.update({"armed": False})
    assert console._write_failed


def test_closing_monitor_group_does_not_stop_other_vehicle(monkeypatch, tmp_path) -> None:
    runtime = SwarmSitlRuntime(state_dir=tmp_path)
    terminated = []
    monkeypatch.setattr("muva_gateway.swarm_sitl.os.killpg", lambda pid, sig: terminated.append((pid, sig)))
    vehicle = SimpleNamespace(monitor_process=SimpleNamespace(pid=98765, poll=lambda: None, wait=Mock()),
                              transport=SimpleNamespace(stop=Mock()),
                              process=SimpleNamespace(poll=lambda: 0), log_file=SimpleNamespace(close=Mock()))
    runtime.vehicles = [vehicle]
    runtime.close()
    assert terminated == [(98765, signal.SIGTERM)]
    vehicle.transport.stop.assert_called_once()
    vehicle.log_file.close.assert_called_once()
