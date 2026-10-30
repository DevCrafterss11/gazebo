from __future__ import annotations

import os
import signal
import subprocess
import time
from pathlib import Path
from typing import IO


class RuntimeProcesses:
    def __init__(self, project_dir: Path, log_dir: Path) -> None:
        self.project_dir = project_dir
        self.log_dir = log_dir
        self._processes: dict[str, subprocess.Popen[bytes]] = {}
        self._logs: list[IO[bytes]] = []

    def is_running(self, name: str) -> bool:
        process = self._processes.get(name)
        return process is not None and process.poll() is None

    def is_managed(self, name: str) -> bool:
        return name in self._processes

    def start(self, env_overrides: dict[str, str] | None = None) -> list[str]:
        self.log_dir.mkdir(parents=True, exist_ok=True)
        started: list[str] = []
        try:
            if not self.is_running("gazebo"):
                self._spawn("gazebo", self.project_dir / "start_iris_gazebo.sh", log_name="gazebo.log", env_overrides=env_overrides)
                started.append("gazebo")
                self._wait_stable("gazebo", 3.0)
            if not self.is_running("sitl"):
                # MAVProxy's --console module requires wxPython, which is not
                # installed in this project runtime. The SITL terminal is still
                # opened by sim_vehicle's run_in_terminal_window helper.
                self._spawn(
                    "sitl",
                    self.project_dir / "start_iris_sitl.sh",
                    "--mavproxy-args=--non-interactive",
                    log_name="sitl.log",
                    env_overrides=env_overrides,
                )
                started.append("sitl")
                self._wait_stable("sitl", 2.0)
            return started
        except Exception:
            for name in reversed(started):
                self._stop_process(name)
            raise

    def stop(self, names: list[str] | None = None) -> None:
        processes_to_stop = names if names is not None else ["sitl", "gazebo"]
        for name in processes_to_stop:
            self._stop_process(name)
        if names is None:
            self._processes.clear()
            for log_file in self._logs:
                log_file.close()
            self._logs.clear()

    def _stop_process(self, name: str) -> None:
        process = self._processes.pop(name, None)
        if process is None:
            return
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        if process.poll() is None:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
        # sim_vehicle can exit before its terminal-launched SITL child. Make
        # sure no process from that managed group survives the stop request.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        if process.poll() is None:
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                pass

    def _spawn(self, name: str, script: Path, *args: str, log_name: str, env_overrides: dict[str, str] | None = None) -> None:
        if not script.is_file():
            raise FileNotFoundError(f"仿真启动脚本不存在：{script}")
        log_file = (self.log_dir / log_name).open("ab", buffering=0)
        process_env = os.environ.copy()
        process_env.update(env_overrides or {})
        try:
            process = subprocess.Popen(
                [str(script), *args],
                cwd=self.project_dir,
                stdin=subprocess.DEVNULL,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                start_new_session=True,
                env=process_env,
            )
        except Exception:
            log_file.close()
            raise
        self._logs.append(log_file)
        self._processes[name] = process

    def _wait_stable(self, name: str, seconds: float) -> None:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            process = self._processes[name]
            if process.poll() is not None:
                raise RuntimeError(f"{name} 启动失败，请检查仿真日志")
            time.sleep(0.1)
