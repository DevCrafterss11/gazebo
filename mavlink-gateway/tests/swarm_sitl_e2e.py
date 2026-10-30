"""Opt-in, isolated two-ArduCopter/Gazebo flight test; never touches experiment 1.

    MUVA_RUN_SWARM_SITL_E2E=1 PYTHONPATH=.packages:. python3 tests/swarm_sitl_e2e.py
"""

from __future__ import annotations

import os
import json
import tempfile
import time
from pathlib import Path

from fastapi.testclient import TestClient

from muva_gateway.swarm_app import create_swarm_app
from muva_gateway.swarm_sitl import SwarmSitlRuntime


def wait_for(client: TestClient, session_id: str, phases: set[str], timeout: float) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        response = client.get("/api/swarm/status", params={"sessionId": session_id})
        response.raise_for_status()
        result = response.json()
        if result["status"] in phases:
            return result
        time.sleep(1)
    raise AssertionError(f"机群未到达 {phases}，最后状态 {result['status']}: {result['runtime']['error']}")


def main() -> None:
    if os.getenv("MUVA_RUN_SWARM_SITL_E2E") != "1":
        raise SystemExit("Set MUVA_RUN_SWARM_SITL_E2E=1 to arm two isolated SITL aircraft")
    os.environ.setdefault("MUVA_SWARM_SITL_BASE_PORT", "16960")
    os.environ.setdefault("MUVA_SWARM_FDM_BASE_PORT", "19402")
    with tempfile.TemporaryDirectory(prefix="muva-swarm-e2e-") as directory:
        runtime = SwarmSitlRuntime(state_dir=Path(directory))
        config = {"count": 2, "altitude": 10, "speed": 5, "spacing": 10, "safety": 5,
                  "sceneOrigin": [116.3268, 40.0098]}
        try:
            with TestClient(create_swarm_app(runtime)) as client:
                def post(path: str, payload: dict) -> dict:
                    response = client.post(f"/api/swarm/{path}", json=payload, timeout=180)
                    response.raise_for_status()
                    return response.json()

                health = client.get("/api/swarm/health").json()
                assert health["gazeboWorldAvailable"] is True and health["ekfPreflight"] is True
                initialized = post("configure", {"config": config})
                assert client.get("/api/swarm/health").json()["gazebo"] is True
                session_id = initialized["runtime"]["sessionId"]
                assert len(initialized["drones"]) == 2
                assert [drone["sysId"] for drone in initialized["drones"]] == [21, 22]
                with client.websocket_connect(f"/ws/swarm?sessionId={session_id}",
                                              headers={"origin": "http://127.0.0.1:5174"}) as socket:
                    assert len(socket.receive_json()["drones"]) == 2
                print("双机心跳、GPS、EKF 与 WebSocket 遥测就绪", flush=True)

                missions = []
                for drone in initialized["drones"]:
                    home = drone["homePosition"]
                    route = [home, [home[0], home[1] + 3 / 110540], [home[0], home[1] + 6 / 110540]]
                    missions.append({"droneId": drone["droneId"], "missionId": drone["droneId"] + "-e2e",
                                     "assignedArea": 100, "waypoints": route, "entryPath": [home],
                                     "returnPath": [route[2], route[1], home], "routingObstacles": [],
                                     "coverageStartIndex": 0, "coverageWaypointIndices": [1, 2],
                                     "coverageSegments": [[route[0], route[1]], [route[1], route[2]]]})
                uploaded = post("missions", {"sessionId": session_id, "planId": "e2e-plan", "missions": missions})
                assert len(uploaded["missionReceipts"]) == 2
                assert all(receipt["status"] == "ACCEPTED" for receipt in uploaded["missionReceipts"])
                post("command", {"sessionId": session_id, "action": "ready"})
                post("command", {"sessionId": session_id, "action": "takeoff"})
                airborne = wait_for(client, session_id, {"HOLDING", "FAILED"}, 180)
                assert airborne["status"] == "HOLDING", airborne["runtime"]["error"]
                assert all(drone["armed"] and drone["altitude"] >= 8 for drone in airborne["drones"])
                print("双机任务回读通过，并分别解锁起飞到 10 m", flush=True)

                post("command", {"sessionId": session_id, "action": "startMission"})
                finished = wait_for(client, session_id, {"COMPLETED", "ABORTED", "FAILED"}, 240)
                assert finished["status"] == "COMPLETED", (finished["status"], finished["runtime"]["error"])
                assert finished["coverage"] == 100
                assert all(drone["state"] == "LANDED" and not drone["armed"] for drone in finished["drones"])
                for index in (1, 2):
                    path = Path(directory) / f"uav-{index}" / "commands.jsonl"
                    records = [json.loads(line) for line in path.read_text().splitlines()]
                    assert any(item["kind"] == "TX" and "MISSION_COUNT" in item["text"] for item in records)
                    assert any(item["kind"] == "RX" and "COMMAND_ACK" in item["text"] for item in records)
                    assert any(item["kind"] == "RX" and "MISSION_ACK" in item["text"] for item in records)
                    assert any(item["kind"] == "TX" and "SET_POSITION_TARGET_GLOBAL_INT" in item["text"] for item in records)
                    assert any(item["kind"] == "DONE" and "已抵达" in item["text"] for item in records)
                    assert any(item["kind"] == "DONE" and "降落" in item["text"] for item in records)
                    assert not any(f"target={23 - index}" in item["text"] for item in records)
                post("shutdown", {"sessionId": session_id, "action": "shutdown"})
                print("双机并行覆盖 100%、分别返航落地、独立会话安全关闭", flush=True)
        finally:
            for vehicle in runtime.vehicles:
                if vehicle.state.is_online() and vehicle.state.vehicle_value("armed"):
                    try:
                        vehicle.commands.land()
                    except Exception:
                        pass
            deadline = time.monotonic() + 100
            while any(vehicle.state.vehicle_value("armed") for vehicle in runtime.vehicles) and time.monotonic() < deadline:
                time.sleep(1)
            runtime.close()


if __name__ == "__main__":
    main()
