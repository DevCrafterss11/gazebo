from __future__ import annotations

from pathlib import Path
import signal

from muva_gateway.runtime_processes import RuntimeProcesses


def test_start_adds_missing_simulator_without_stopping_running_sitl(tmp_path: Path, monkeypatch) -> None:
    runtime = RuntimeProcesses(tmp_path, tmp_path / "logs")

    class RunningProcess:
        pid = 4321

        def poll(self) -> None:
            return None

    sitl = RunningProcess()
    runtime._processes["sitl"] = sitl  # type: ignore[assignment]
    spawned: list[str] = []

    def spawn(name: str, *args, **kwargs) -> None:
        spawned.append(name)
        runtime._processes[name] = RunningProcess()  # type: ignore[assignment]

    monkeypatch.setattr(runtime, "_spawn", spawn)
    monkeypatch.setattr(runtime, "_wait_stable", lambda *_args: None)

    runtime.start()

    assert spawned == ["gazebo"]
    assert runtime._processes["sitl"] is sitl


def test_stop_kills_process_group_even_if_parent_already_exited(tmp_path: Path, monkeypatch) -> None:
    runtime = RuntimeProcesses(tmp_path, tmp_path / "logs")
    calls: list[tuple[int, int]] = []

    class ExitedProcess:
        pid = 4321

        def poll(self) -> int:
            return 0

    runtime._processes["sitl"] = ExitedProcess()  # type: ignore[assignment]
    monkeypatch.setattr("muva_gateway.runtime_processes.os.killpg", lambda pid, sig: calls.append((pid, sig)))
    runtime.stop()

    assert calls == [(4321, signal.SIGTERM), (4321, signal.SIGKILL)]


def test_selective_stop_keeps_previously_running_sitl(tmp_path: Path, monkeypatch) -> None:
    runtime = RuntimeProcesses(tmp_path, tmp_path / "logs")
    calls: list[int] = []

    class ExitedProcess:
        def __init__(self, pid: int) -> None:
            self.pid = pid

        def poll(self) -> int:
            return 0

    runtime._processes["gazebo"] = ExitedProcess(4321)  # type: ignore[assignment]
    sitl = ExitedProcess(5678)
    runtime._processes["sitl"] = sitl  # type: ignore[assignment]
    monkeypatch.setattr("muva_gateway.runtime_processes.os.killpg", lambda pid, _sig: calls.append(pid))

    runtime.stop(["gazebo"])

    assert calls == [4321, 4321]
    assert "gazebo" not in runtime._processes
    assert runtime._processes["sitl"] is sitl


def test_sitl_spawn_keeps_desktop_display_for_flight_controller_console(tmp_path: Path, monkeypatch) -> None:
    script = tmp_path / "start_sitl.sh"
    script.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    log_dir = tmp_path / "logs"
    log_dir.mkdir()
    runtime = RuntimeProcesses(tmp_path, log_dir)
    captured: dict[str, object] = {}

    class ProcessStub:
        pid = 1234

    def spawn(*args, **kwargs):
        captured.update(kwargs)
        return ProcessStub()

    monkeypatch.setenv("DISPLAY", ":0")
    monkeypatch.setenv("WAYLAND_DISPLAY", "wayland-0")
    monkeypatch.setattr("muva_gateway.runtime_processes.subprocess.Popen", spawn)
    runtime._spawn("sitl", script, log_name="sitl.log")

    process_env = captured["env"]
    assert isinstance(process_env, dict)
    assert process_env["DISPLAY"] == ":0"
    assert process_env["WAYLAND_DISPLAY"] == "wayland-0"
    assert captured["start_new_session"] is True
    for log_file in runtime._logs:
        log_file.close()


def test_gazebo_spawn_keeps_desktop_display(tmp_path: Path, monkeypatch) -> None:
    script = tmp_path / "start_gazebo.sh"
    script.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    runtime = RuntimeProcesses(tmp_path, tmp_path / "logs")
    runtime.log_dir.mkdir()
    captured: dict[str, object] = {}

    class ProcessStub:
        pid = 1234

    def spawn(*args, **kwargs):
        captured.update(kwargs)
        return ProcessStub()

    monkeypatch.setenv("DISPLAY", ":0")
    monkeypatch.setattr("muva_gateway.runtime_processes.subprocess.Popen", spawn)
    runtime._spawn("gazebo", script, log_name="gazebo.log")

    process_env = captured["env"]
    assert isinstance(process_env, dict)
    assert process_env["DISPLAY"] == ":0"
    for log_file in runtime._logs:
        log_file.close()
