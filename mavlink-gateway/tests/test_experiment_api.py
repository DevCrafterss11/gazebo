from __future__ import annotations

import time

from fastapi.testclient import TestClient
from pymavlink import mavutil

from muva_gateway.app import Gateway, SCENES, create_app
from muva_gateway.config import Settings
from muva_gateway.commands import CommandRejectedError

from test_state import Message, heartbeat


def test_experiment_progress_assessment_and_record_survive_restart(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MUVA_PLATFORM_DATA", str(tmp_path / "platform.json"))
    gateway = Gateway(Settings())
    monkeypatch.setattr(gateway, "start", lambda: None)
    monkeypatch.setattr(gateway, "stop", lambda: None)
    with TestClient(create_app(gateway=gateway)) as client:
        session = client.post("/api/v1/experiments", json={"name": "实验一", "drone": {}, "scene": {}, "configuration": {}}).json()
        session_id = session["id"]
        assert client.post(f"/api/v1/experiments/{session_id}/start").status_code == 200
        progress = {"version": 2, "progressId": "browser-1", "currentStep": 7, "completedSteps": [1, 2, 3, 4, 5, 6], "configuration": {}, "sessionId": session_id, "session": session, "learningProgress": {"learnedPartIds": ["frame"]}}
        assert client.post("/api/v1/experiments/configuration", json=progress).status_code == 200
        assert client.put(f"/api/v1/experiments/{session_id}/assessment", json={"sessionId": session_id, "totalScore": 88}).status_code == 200
        assert client.put(f"/api/v1/experiments/{session_id}/assessment", json={"sessionId": "wrong"}).status_code == 404
        assert client.post(f"/api/v1/experiments/{session_id}/finish", json={"score": 88}).status_code == 200
        assert client.post(f"/api/v1/experiments/{session_id}/record", json={"id": session_id, "result": {"score": 88}}).status_code == 200

    restored = Gateway(Settings())
    monkeypatch.setattr(restored, "start", lambda: None)
    monkeypatch.setattr(restored, "stop", lambda: None)
    with TestClient(create_app(gateway=restored)) as client:
        assert client.get("/api/v1/experiments/progress/browser-1").json()["learningProgress"]["learnedPartIds"] == ["frame"]
        assert client.get(f"/api/v1/experiments/{session_id}/assessment").json()["totalScore"] == 88
        assert client.get(f"/api/v1/experiments/records/{session_id}").json()["result"]["score"] == 88
        assert client.delete("/api/v1/experiments/progress/browser-1").status_code == 200
        assert client.get("/api/v1/experiments/progress/browser-1").json() is None
        assert client.get(f"/api/v1/experiments/{session_id}/assessment").json()["totalScore"] == 88


def test_experiment_one_api_exposes_all_teaching_scenes(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MUVA_PLATFORM_DATA", str(tmp_path / "platform.json"))
    gateway = Gateway(Settings())
    monkeypatch.setattr(gateway, "start", lambda: None)
    monkeypatch.setattr(gateway, "stop", lambda: None)
    with TestClient(create_app(gateway=gateway)) as client:
        scenes = client.get("/api/v1/scenes").json()
        assert [scene["id"] for scene in scenes[:4]] == ["campus", "city", "mountain", "airport"]
        assert {scene["id"] for scene in scenes} == {scene["id"] for scene in SCENES}


def test_sensor_checks_use_real_sys_status_and_gps_fix(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MUVA_PLATFORM_DATA", str(tmp_path / "platform.json"))
    gateway = Gateway(Settings())
    monkeypatch.setattr(gateway, "start", lambda: None)
    monkeypatch.setattr(gateway, "stop", lambda: None)
    gateway.state.set_transport_connected(True)
    gateway.state.handle_message(heartbeat())
    gateway._runtime_active = True
    with TestClient(create_app(gateway=gateway)) as client:
        checks = {item["id"]: item for item in client.post("/api/v1/system/sensors/check").json()}
        assert checks["imu"]["status"] == "FAIL"
        assert checks["gps"]["status"] == "FAIL"
        mask = sum(getattr(mavutil.mavlink, f"MAV_SYS_STATUS_SENSOR_{name}") for name in ("3D_GYRO", "3D_ACCEL", "3D_MAG", "ABSOLUTE_PRESSURE"))
        gateway.state.handle_message(Message("SYS_STATUS", onboard_control_sensors_present=mask, onboard_control_sensors_enabled=mask, onboard_control_sensors_health=mask, voltage_battery=12000, current_battery=0, battery_remaining=80))
        gateway.state.handle_message(Message("GPS_RAW_INT", fix_type=2, satellites_visible=10, eph=100))
        checks = {item["id"]: item for item in client.post("/api/v1/system/sensors/check").json()}
        assert checks["imu"]["status"] == "PASS"
        assert checks["compass"]["status"] == "PASS"
        assert checks["barometer"]["status"] == "PASS"
        assert checks["gps"]["status"] == "FAIL"
        gateway.state.handle_message(Message("GPS_RAW_INT", fix_type=3, satellites_visible=10, eph=100))
        assert {item["id"]: item for item in client.post("/api/v1/system/sensors/check").json()}["gps"]["status"] == "PASS"


def test_mission_clear_waits_for_ack_before_forgetting_state(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MUVA_PLATFORM_DATA", str(tmp_path / "platform.json"))
    gateway = Gateway(Settings(command_timeout=0.05))
    gateway.state.set_transport_connected(True)
    gateway.state.handle_message(heartbeat(armed=False))
    gateway.state.handle_message(Message("MISSION_COUNT", count=3, mission_type=mavutil.mavlink.MAV_MISSION_TYPE_MISSION))

    class MissionMav:
        result = mavutil.mavlink.MAV_MISSION_DENIED

        def mission_clear_all_send(self, _system: int, _component: int) -> None:
            gateway.state.handle_message(Message("MISSION_ACK", type=self.result, mission_type=mavutil.mavlink.MAV_MISSION_TYPE_MISSION))

    class MissionConnection:
        mav = MissionMav()

    monkeypatch.setattr(gateway.transport, "send", lambda callback: callback(MissionConnection()))
    try:
        gateway.missions.clear()
    except CommandRejectedError:
        pass
    else:
        raise AssertionError("Mission clear must reject a denied ACK")
    assert gateway.state.mission_snapshot()["total"] == 3

    MissionMav.result = mavutil.mavlink.MAV_MISSION_ACCEPTED
    gateway.missions.clear()
    assert gateway.state.mission_snapshot()["total"] == 0


def test_security_assessment_hides_case_and_server_calculates_persisted_score(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MUVA_PLATFORM_DATA", str(tmp_path / "platform.json"))
    gateway = Gateway(Settings())
    monkeypatch.setattr(gateway, "start", lambda: None)
    monkeypatch.setattr(gateway, "stop", lambda: None)
    gateway.state.set_transport_connected(True)
    gateway.state.handle_message(heartbeat())
    before = gateway.vehicle_snapshot()
    with TestClient(create_app(gateway=gateway)) as client:
        created = client.post("/api/v1/security/runs", json={"caseId": "replay", "mode": "assessment", "difficulty": "medium"})
        assert created.status_code == 200
        run = created.json()
        assert run["config"]["caseId"] == "hidden"
        assert run["seed"] is None
        run_id = run["runId"]
        assert client.post(f"/api/v1/security/runs/{run_id}/baseline").status_code == 200
        judgment = {"judgment": "normal", "evidenceIds": [], "requestId": "judgment-once", "score": 100}
        assert client.post(f"/api/v1/security/runs/{run_id}/judgment", json=judgment).status_code == 200
        assert client.post(f"/api/v1/security/runs/{run_id}/judgment", json=judgment).status_code == 200
        finished = client.post(f"/api/v1/security/runs/{run_id}/finish", json={"reflection": "short", "score": 100})
        assert finished.status_code == 200
        report = finished.json()
        assert report["scoreSource"] == "gateway"
        assert report["score"]["total"] != 100
        assert len(report["judgments"]) == 1
        assert client.get("/api/v1/security/records").json()[0]["runId"] == run_id
    assert gateway.vehicle_snapshot()["telemetry"] == before["telemetry"]


def test_security_api_mode_does_not_fallback_without_live_vehicle(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MUVA_PLATFORM_DATA", str(tmp_path / "platform.json"))
    gateway = Gateway(Settings())
    monkeypatch.setattr(gateway, "start", lambda: None)
    monkeypatch.setattr(gateway, "stop", lambda: None)
    with TestClient(create_app(gateway=gateway)) as client:
        result = client.post("/api/v1/security/runs", json={"caseId": "replay", "mode": "training", "difficulty": "low"})
        assert result.status_code == 503
        assert "不会回退" in result.json()["detail"]


def test_security_recovery_requires_live_frames_and_saves_elapsed_time_once(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MUVA_PLATFORM_DATA", str(tmp_path / "platform.json"))
    gateway = Gateway(Settings())
    monkeypatch.setattr(gateway, "start", lambda: None)
    monkeypatch.setattr(gateway, "stop", lambda: None)
    gateway.state.set_transport_connected(True)
    gateway.state.handle_message(heartbeat())
    with TestClient(create_app(gateway=gateway)) as client:
        run_id = client.post("/api/v1/security/runs", json={"caseId": "degradation", "mode": "training", "difficulty": "low"}).json()["runId"]
        assert client.post(f"/api/v1/security/runs/{run_id}/baseline").status_code == 200
        assert client.post(f"/api/v1/security/runs/{run_id}/anomaly").status_code == 200
        assert client.post(f"/api/v1/security/runs/{run_id}/stop-injection").json()["phase"] == "recovery"
        assert client.post(f"/api/v1/security/runs/{run_id}/verify").json()["isolation"] != "verified"
        run = gateway._security_runs[run_id]
        run["_recoveryCount"] = 3
        run["_recoveryStartedAt"] = time.monotonic() - 0.05
        assert client.post(f"/api/v1/security/runs/{run_id}/verify").json()["isolation"] == "verified"
        report = client.post(f"/api/v1/security/runs/{run_id}/finish", json={"reflection": "本次观察显示通道恢复需要连续新鲜数据。"}).json()
        repeated = client.post(f"/api/v1/security/runs/{run_id}/finish", json={"reflection": "changed"}).json()
        assert report["recoveryMs"] >= 40
        assert repeated == report
        assert len(client.get("/api/v1/security/records").json()) == 1
