#!/usr/bin/env python3
"""Run a small, bounded flight-control smoke test against a live SITL gateway.

This is intentionally opt-in because it arms and moves the simulated vehicle:
    MUVA_RUN_SITL_E2E=1 python tests/sitl_e2e.py
"""

from __future__ import annotations

import json
import os
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen


BASE_URL = os.getenv("MUVA_GATEWAY_URL", "http://127.0.0.1:8000")
HOME = (34.1251589, 108.8289653)


def request(path: str, method: str = "GET", payload: object | None = None) -> dict:
    body = None if payload is None else json.dumps(payload).encode()
    req = Request(f"{BASE_URL}{path}", data=body, method=method, headers={"Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=10) as response:
            return json.load(response)
    except HTTPError as error:
        detail = error.read().decode(errors="replace")
        raise AssertionError(f"{method} {path} failed ({error.code}): {detail}") from error


def wait_for(predicate, timeout: float, label: str) -> dict:
    deadline = time.monotonic() + timeout
    latest: dict = {}
    while time.monotonic() < deadline:
        latest = request("/api/vehicle")
        if predicate(latest):
            return latest
        time.sleep(0.5)
    raise AssertionError(f"Timed out waiting for {label}: {latest}")


def command(path: str, payload: object) -> dict:
    return request(path, "POST", payload)


def main() -> None:
    if os.getenv("MUVA_RUN_SITL_E2E") != "1":
        raise SystemExit("Set MUVA_RUN_SITL_E2E=1 to run the arming/flight test")

    initial = wait_for(lambda d: d["connection"]["connected"], 10, "MAVLink connection")
    if initial["vehicle"]["armed"]:
        raise AssertionError("Refusing to start E2E test while vehicle is armed")

    mission = {
        "verify": True,
        "items": [
            {"command": "TAKEOFF", "latitude": HOME[0], "longitude": HOME[1], "altitude": 6},
            {"command": "WAYPOINT", "latitude": 34.1252939, "longitude": HOME[1], "altitude": 6},
            {"command": "WAYPOINT", "latitude": 34.1252939, "longitude": 108.8291283, "altitude": 6},
            {"command": "LAND", "latitude": HOME[0], "longitude": HOME[1], "altitude": 0},
        ],
    }
    uploaded = request("/api/missions/upload", "POST", mission)
    assert uploaded["result"]["accepted"] and uploaded["result"]["verified"]
    downloaded = request("/api/missions")["result"]
    assert downloaded["count"] == 4

    command("/api/commands/mode", {"mode": "GUIDED"})
    command("/api/commands/arm", {"arm": True})
    command("/api/commands/takeoff", {"altitude": 6})
    airborne = wait_for(lambda d: d["vehicle"]["armed"] and d["telemetry"]["altitude"] >= 4.5, 20, "takeoff altitude")
    assert airborne["vehicle"]["mode"] == "GUIDED"

    command("/api/commands/mode", {"mode": "LOITER"})
    wait_for(lambda d: d["vehicle"]["mode"] == "LOITER", 8, "LOITER mode")
    command("/api/commands/mode", {"mode": "BRAKE"})
    wait_for(lambda d: d["vehicle"]["mode"] == "BRAKE", 8, "BRAKE mode")

    command("/api/missions/start", {})
    wait_for(lambda d: d["vehicle"]["mode"] == "AUTO" and d["vehicle"]["armed"], 8, "mission AUTO start")
    wait_for(lambda d: d["mission"]["current"] >= 2, 45, "waypoint progression")
    final = wait_for(lambda d: not d["vehicle"]["armed"] and d["telemetry"]["altitude"] < 1, 60, "automatic landing and disarm")
    assert final["mission"]["total"] == 4
    print("SITL E2E passed: upload/read, GUIDED arm/takeoff, LOITER, BRAKE, AUTO mission, LAND/disarm")


if __name__ == "__main__":
    main()
