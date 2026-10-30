#!/usr/bin/env python3
"""Stop remaining MUVA-owned processes without matching unrelated services."""

from __future__ import annotations

import os
import signal
import sys
import time
import argparse
from pathlib import Path


PROJECT = Path(__file__).resolve().parent
PROJECT_PREFIX = str(PROJECT) + os.sep
KNOWN_COMMANDS = (
    "arducopter",
    "sim_vehicle.py",
    "mavproxy.py",
    "muva_gateway",
    "node_modules/vite/",
    "gz sim",
    "gazebo",
    "mavlink_monitor.py",
)


def read_process(pid: int) -> tuple[int, str, str, str] | None:
    proc = Path("/proc") / str(pid)
    try:
        uid = proc.stat().st_uid
        raw = (proc / "cmdline").read_bytes().split(b"\0")
        command = " ".join(part.decode(errors="replace") for part in raw if part)
        executable = os.path.realpath(proc / "exe")
        cwd = os.path.realpath(proc / "cwd")
        return uid, command, executable, cwd
    except (FileNotFoundError, PermissionError, ProcessLookupError, OSError):
        return None


def is_under_project(path: str) -> bool:
    return path == str(PROJECT) or path.startswith(PROJECT_PREFIX)


def process_matches(pid: int, uid: int) -> tuple[bool, str]:
    info = read_process(pid)
    if info is None:
        return False, ""
    process_uid, command, executable, cwd = info
    if process_uid != uid:
        return False, ""
    matched = is_under_project(executable) or PROJECT_PREFIX in command
    if not matched and is_under_project(cwd):
        matched = any(signature in command for signature in KNOWN_COMMANDS)
    return matched, command or executable


def ancestor_pids(pid: int) -> set[int]:
    ancestors = {pid}
    current = pid
    while current > 1:
        try:
            fields = Path(f"/proc/{current}/stat").read_text().rsplit(")", 1)[1].split()
            current = int(fields[1])
        except (FileNotFoundError, PermissionError, ProcessLookupError, OSError, ValueError, IndexError):
            break
        ancestors.add(current)
    return ancestors


def process_running(pid: int) -> bool:
    try:
        fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
        return fields[0] != "Z"
    except (FileNotFoundError, PermissionError, ProcessLookupError, OSError, IndexError):
        return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="list matching processes without stopping them")
    args = parser.parse_args()
    uid = os.getuid()
    excluded = ancestor_pids(os.getpid())
    matches: dict[int, str] = {}
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        pid = int(entry.name)
        if pid in excluded:
            continue
        matched, command = process_matches(pid, uid)
        if matched:
            matches[pid] = command

    if not matches:
        print("没有发现残留的 MUVA 项目进程。")
        return 0

    if args.dry_run:
        print(f"只读检查：发现 {len(matches)} 个 MUVA 项目进程（未停止）：")
        for pid, command in sorted(matches.items()):
            print(f"  PID {pid}: {command[:220]}")
        return 0

    print(f"发现 {len(matches)} 个 MUVA 项目进程，发送 TERM：")
    for pid, command in sorted(matches.items()):
        matched, _ = process_matches(pid, uid)
        if not matched:
            continue
        print(f"  PID {pid}: {command[:220]}")
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        except PermissionError:
            print(f"  无权停止 PID {pid}", file=sys.stderr)

    deadline = time.monotonic() + 8
    remaining = set(matches)
    while remaining and time.monotonic() < deadline:
        remaining = {pid for pid in remaining if process_running(pid)}
        time.sleep(0.2)

    if remaining:
        print(f"以下 {len(remaining)} 个项目进程未响应 TERM，发送 KILL：")
        for pid in sorted(remaining):
            matched, _ = process_matches(pid, uid)
            if matched:
                try:
                    os.kill(pid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    pass

    time.sleep(0.5)
    survivors = [pid for pid in matches if process_running(pid) and process_matches(pid, uid)[0]]
    if survivors:
        print(f"仍有进程无法清理：{', '.join(map(str, survivors))}", file=sys.stderr)
        return 1
    print("MUVA 项目进程清理完成。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
