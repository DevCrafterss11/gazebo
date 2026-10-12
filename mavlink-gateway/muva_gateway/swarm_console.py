from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import time
from collections import deque
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import Any

LOGGER = logging.getLogger(__name__)


class FlightConsole:
    def __init__(self, directory: Path) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        self.events_file = directory / "commands.jsonl"
        self.state_file = directory / "flight-state.json"
        self._lock = Lock()
        self._write_failed = False
        if self.events_file.is_file() and self.events_file.stat().st_size:
            archived = directory / f"commands-{datetime.now().strftime('%Y%m%d-%H%M%S%f')}.jsonl"
            self.events_file.rename(archived)
        self.events_file.write_text("")
        self.state_file.unlink(missing_ok=True)

    def record(self, kind: str, text: str) -> None:
        event = {"time": datetime.now().astimezone().strftime("%H:%M:%S"), "kind": kind, "text": text}
        try:
            with self._lock, self.events_file.open("a", encoding="utf-8") as log:
                log.write(json.dumps(event, ensure_ascii=False) + "\n")
        except OSError as error:
            self._warn(error)

    def update(self, state: dict[str, Any]) -> None:
        temporary = self.state_file.with_suffix(".tmp")
        try:
            with self._lock:
                temporary.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
                os.replace(temporary, self.state_file)
        except OSError as error:
            self._warn(error)

    def _warn(self, error: OSError) -> None:
        if not self._write_failed:
            LOGGER.warning("Experiment 2 read-only command console unavailable: %s", error)
            self._write_failed = True


def read_display(directory: Path, drone_id: str, sys_id: int) -> str:
    state_file = directory / "flight-state.json"
    events_file = directory / "commands.jsonl"
    try:
        state = json.loads(state_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        state = {}
    try:
        with events_file.open(encoding="utf-8") as log:
            events = deque((json.loads(line) for line in log), maxlen=24)
    except (OSError, ValueError):
        events = deque()
    online = "在线" if state.get("connected") else "等待心跳 / 离线"
    armed = "已解锁" if state.get("armed") else "未解锁"
    lines = [f"MUVA 实验二  {drone_id} / SysID {sys_id}   {datetime.now().strftime('%H:%M:%S')}",
             f"飞控 {online} | {armed} | 模式 {state.get('flightMode', '--')} | 阶段 {state.get('phase', '--')}",
             f"位置 {state.get('latitude', '--')}, {state.get('longitude', '--')} | 高度 {state.get('altitude', '--')} m",
             f"速度 {state.get('speed', '--')} m/s | 电量 {state.get('battery', '--')}% | GPS fix {state.get('gpsFixType', '--')}",
             f"任务航点 {state.get('waypointIndex', '--')} | 已完成覆盖段 {state.get('completedSegments', '--')}",
             "=" * 108,
             "实际指令流水（TX=网关发起，RX=飞控回复，DONE=状态确认，ERROR=失败）："]
    width = max(65, shutil.get_terminal_size((110, 34)).columns - 1)
    lines.extend(f"{event['time']}  [{event['kind']:<5}] {event['text']}"[:width] for event in events)
    lines.append("=" * 108)
    lines.append(f"只读窗口，不发送飞行指令；完整记录：{events_file}")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Per-vehicle read-only flight command console")
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--drone-id", required=True)
    parser.add_argument("--sys-id", type=int, required=True)
    args = parser.parse_args()
    try:
        while True:
            print("\033[2J\033[H" + read_display(args.directory, args.drone_id, args.sys_id), flush=True)
            time.sleep(.5)
    except KeyboardInterrupt:
        return


if __name__ == "__main__":
    main()
