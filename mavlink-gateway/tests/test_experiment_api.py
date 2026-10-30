from __future__ import annotations

import time
from types import SimpleNamespace

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


def test_security_range_uses_dedicated_mavlink_endpoints(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MUVA_PLATFORM_DATA", str(tmp_path / "platform.json"))
    monkeypatch.setenv("MUVA_SECURITY_MAVLINK_ENDPOINT", "udpin:0.0.0.0:14752")
    monkeypatch.setenv("MUVA_SECURITY_MONITOR_ENDPOINT", "udpin:0.0.0.0:14753")
    gateway = Gateway(Settings())
    monkeypatch.setattr(gateway, "start", lambda: None)
    monkeypatch.setattr(gateway, "stop", lambda: None)

    app = create_app(gateway=gateway)

    assert app.state.gateway.settings.mavlink_endpoint == "udpin:0.0.0.0:14552"
    assert app.state.security_range.settings.mavlink_endpoint == "udpin:0.0.0.0:14752"
    assert app.state.security_range.settings.monitor_endpoint == "udpin:0.0.0.0:14753"


def test_security_runtime_status_reports_processes_independently_of_telemetry(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MUVA_PLATFORM_DATA", str(tmp_path / "platform.json"))
    gateway = Gateway(Settings())
    monkeypatch.setattr(gateway, "start", lambda: None)
    monkeypatch.setattr(gateway, "stop", lambda: None)
    gateway._runtime_active = True

    class RuntimeStub:
        def is_running(self, name: str) -> bool:
            return name in {"gazebo", "sitl"}

        def is_managed(self, name: str) -> bool:
            return name in {"gazebo", "sitl"}

    gateway.runtime_processes = RuntimeStub()
    status = gateway.runtime_status()
    assert status["gazebo"] == "RUNNING"
    assert status["ardupilotSitl"] == "RUNNING"
    assert status["heartbeat"] == "WAITING"
    assert status["gps"] == "WAITING"


def test_security_range_start_keeps_simulation_running_while_telemetry_is_pending(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MUVA_PLATFORM_DATA", str(tmp_path / "platform.json"))
    gateway = Gateway(Settings())
    monkeypatch.setattr(gateway, "start", lambda: None)
    monkeypatch.setattr(gateway, "stop", lambda: None)

    class RuntimeStub:
        started = False
        stopped = False
        log_dir = tmp_path

        def start(self, env_overrides=None) -> None:
            self.started = True

        def stop(self) -> None:
            self.stopped = True

        def is_running(self, name: str) -> bool:
            return self.started and not self.stopped

        def is_managed(self, name: str) -> bool:
            return True

    runtime = RuntimeStub()
    gateway.runtime_processes = runtime
    monkeypatch.setattr(gateway.monitor, "start", lambda: None)
    monkeypatch.setattr(gateway.monitor, "stop", lambda: None)
    monkeypatch.setattr(gateway.transport, "start", lambda: None)
    monkeypatch.setattr(gateway.transport, "stop", lambda: None)
    monkeypatch.setattr(gateway, "vehicle_snapshot", lambda: {
        "connection": {"connected": False, "transportConnected": True, "lastHeartbeatAgeMs": None},
        "vehicle": {"armed": False}, "telemetry": {"altitude": 0.0},
        "home": {"valid": False},
    })
    monkeypatch.setattr(gateway, "runtime_status", lambda: {
        "gazebo": "RUNNING", "ardupilotSitl": "RUNNING", "gps": "WAITING", "ekf": "WAITING",
    })
    tick_count = -1

    def monotonic_after_deadline() -> float:
        nonlocal tick_count
        tick_count += 1
        return tick_count * 31.0

    monkeypatch.setattr("muva_gateway.app.time", SimpleNamespace(monotonic=monotonic_after_deadline, strftime=time.strftime, gmtime=time.gmtime))

    with TestClient(create_app(gateway=gateway, security_range=gateway)) as client:
        response = client.post("/api/v1/security/range/start")

    assert response.status_code == 200, response.text
    assert response.json()["active"] is True
    assert runtime.started is True
    assert runtime.stopped is False
    assert gateway._runtime_logs[-1]["phase"] == "WAITING_FOR_TELEMETRY"


def test_security_range_start_recovers_when_only_one_simulator_process_is_running(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MUVA_PLATFORM_DATA", str(tmp_path / "platform.json"))
    gateway = Gateway(Settings())
    monkeypatch.setattr(gateway, "start", lambda: None)
    monkeypatch.setattr(gateway, "stop", lambda: None)
    gateway._runtime_active = True

    class RuntimeStub:
        log_dir = tmp_path
        gazebo_running = False
        sitl_running = True
        starts = 0

        def start(self, env_overrides=None) -> None:
            self.starts += 1
            self.gazebo_running = True
            self.sitl_running = True

        def stop(self) -> None:
            self.gazebo_running = False
            self.sitl_running = False

        def is_running(self, name: str) -> bool:
            return self.gazebo_running if name == "gazebo" else self.sitl_running

        def is_managed(self, name: str) -> bool:
            return name in {"gazebo", "sitl"}

    runtime = RuntimeStub()
    gateway.runtime_processes = runtime
    monkeypatch.setattr(gateway.monitor, "start", lambda: None)
    monkeypatch.setattr(gateway.monitor, "stop", lambda: None)
    monkeypatch.setattr(gateway.transport, "start", lambda: None)
    monkeypatch.setattr(gateway.transport, "stop", lambda: None)
    monkeypatch.setattr(gateway.state, "is_online", lambda: True)
    monkeypatch.setattr(gateway, "vehicle_snapshot", lambda: {
        "connection": {"connected": True, "transportConnected": True, "lastHeartbeatAgeMs": 10},
        "vehicle": {"armed": False}, "telemetry": {"altitude": 0.0},
        "home": {"valid": True},
    })
    monkeypatch.setattr(gateway, "runtime_status", lambda: {
        "gazebo": "RUNNING" if runtime.gazebo_running else "STOPPED",
        "ardupilotSitl": "RUNNING" if runtime.sitl_running else "STOPPED",
        "gps": "3D FIX", "ekf": "HEALTHY",
    })

    with TestClient(create_app(gateway=gateway, security_range=gateway)) as client:
        response = client.post("/api/v1/security/range/start")

    assert response.status_code == 200, response.text
    assert response.json()["runtime"]["gazebo"] == "RUNNING"
    assert response.json()["runtime"]["ardupilotSitl"] == "RUNNING"
    assert runtime.starts == 1
    assert gateway._runtime_logs[0]["phase"] == "RECOVERING_SIMULATION"


def test_waypoint_tampering_requires_gateway_managed_runtime(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MUVA_PLATFORM_DATA", str(tmp_path / "platform.json"))
    gateway = Gateway(Settings())
    monkeypatch.setattr(gateway, "start", lambda: None)
    monkeypatch.setattr(gateway, "stop", lambda: None)
    with TestClient(create_app(gateway=gateway)) as client:
        response = client.post("/api/v1/security/simulation/waypoint-tampering", json={
            "waypoints": [{"latitude": 34.12516, "longitude": 108.82897}, {"latitude": 34.12520, "longitude": 108.82901}],
            "offsetSide": "right",
        })
    assert response.status_code == 409


def test_waypoint_tampering_rejects_points_outside_home_fence(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MUVA_PLATFORM_DATA", str(tmp_path / "platform.json"))
    gateway = Gateway(Settings())
    monkeypatch.setattr(gateway, "start", lambda: None)
    monkeypatch.setattr(gateway, "stop", lambda: None)
    monkeypatch.setattr(gateway, "runtime_status", lambda: {"ardupilotSitl": "RUNNING", "gazebo": "RUNNING"})
    gateway._runtime_active = True
    monkeypatch.setattr(gateway, "vehicle_snapshot", lambda: {
        "connection": {"connected": True, "lastHeartbeatAgeMs": 10},
        "vehicle": {"armed": False}, "telemetry": {"altitude": 0.0},
        "home": {"valid": True, "latitude": 34.12516, "longitude": 108.82897},
    })
    app = create_app(gateway=gateway, security_range=gateway)
    with TestClient(app) as client:
        response = client.post("/api/v1/security/simulation/waypoint-tampering", json={
            "waypoints": [{"latitude": 34.1260, "longitude": 108.82897}, {"latitude": 34.1261, "longitude": 108.82897}],
            "offsetSide": "right",
        })
    assert response.status_code == 422


def test_waypoint_tampering_uploads_then_arms_then_starts(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MUVA_PLATFORM_DATA", str(tmp_path / "platform.json"))
    gateway = Gateway(Settings())
    monkeypatch.setattr(gateway, "start", lambda: None)
    monkeypatch.setattr(gateway, "stop", lambda: None)
    monkeypatch.setattr(gateway, "runtime_status", lambda: {"ardupilotSitl": "RUNNING", "gazebo": "RUNNING"})
    gateway._runtime_active = True
    monkeypatch.setattr(gateway, "vehicle_snapshot", lambda: {
        "connection": {"connected": True, "lastHeartbeatAgeMs": 10},
        "vehicle": {"armed": False}, "telemetry": {"altitude": 0.0},
        "home": {"valid": True, "latitude": 34.12516, "longitude": 108.82897},
    })
    calls: list[tuple[str, object]] = []
    monkeypatch.setattr(gateway.missions, "upload", lambda items, verify: calls.append(("upload", items)) or {"verified": True})
    monkeypatch.setattr(gateway.commands, "arm", lambda armed: calls.append(("arm", armed)) or {"accepted": True})
    monkeypatch.setattr(gateway.missions, "start", lambda commands: calls.append(("start", commands)) or {"started": True})
    app = create_app(gateway=gateway, security_range=gateway)
    with TestClient(app) as client:
        response = client.post("/api/v1/security/simulation/waypoint-tampering", json={
            "waypoints": [{"latitude": 34.12516, "longitude": 108.82897}, {"latitude": 34.12520, "longitude": 108.82901}],
            "offsetSide": "right",
        })
    assert response.status_code == 200
    assert [call[0] for call in calls] == ["upload", "arm", "start"]
    uploaded = calls[0][1]
    assert isinstance(uploaded, list)
    assert uploaded[0]["command"] == "TAKEOFF" and uploaded[-1]["command"] == "LAND"
    assert response.json()["effect"] == "mission_replaced_and_started"


def test_security_range_move_rejects_ground_vehicle(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MUVA_PLATFORM_DATA", str(tmp_path / "platform.json"))
    gateway = Gateway(Settings())
    monkeypatch.setattr(gateway, "start", lambda: None)
    monkeypatch.setattr(gateway, "stop", lambda: None)
    gateway._runtime_active = True
    monkeypatch.setattr(gateway, "vehicle_snapshot", lambda: {
        "connection": {"connected": True, "lastHeartbeatAgeMs": 10},
        "vehicle": {"armed": False}, "telemetry": {"altitude": 0.0, "latitude": 34.12516, "longitude": 108.82897},
        "home": {"valid": True, "latitude": 34.12516, "longitude": 108.82897},
    })
    app = create_app(gateway=gateway, security_range=gateway)
    with TestClient(app) as client:
        response = client.post("/api/v1/security/range/move", json={"direction": "right", "meters": 3})
    assert response.status_code == 409


def test_security_range_takeoff_waits_for_gps_and_ekf_readiness(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MUVA_PLATFORM_DATA", str(tmp_path / "platform.json"))
    gateway = Gateway(Settings())
    monkeypatch.setattr(gateway, "start", lambda: None)
    monkeypatch.setattr(gateway, "stop", lambda: None)
    gateway._runtime_active = True
    monkeypatch.setattr(gateway, "runtime_status", lambda: {"gps": "WAITING", "ekf": "WAITING"})
    arm_calls: list[bool] = []
    monkeypatch.setattr(gateway.commands, "arm", lambda armed: arm_calls.append(armed))
    app = create_app(gateway=gateway, security_range=gateway)

    with TestClient(app) as client:
        response = client.post("/api/v1/security/range/takeoff", json={"altitude": 6})

    assert response.status_code == 409
    assert "GPS 3D" in response.json()["detail"]
    assert arm_calls == []


def test_security_range_stop_keeps_runtime_when_heartbeat_is_lost(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MUVA_PLATFORM_DATA", str(tmp_path / "platform.json"))
    gateway = Gateway(Settings())
    monkeypatch.setattr(gateway, "start", lambda: None)
    monkeypatch.setattr(gateway, "stop", lambda: None)
    gateway._runtime_active = True
    monkeypatch.setattr(gateway, "vehicle_snapshot", lambda: {
        "connection": {"connected": False, "lastHeartbeatAgeMs": 9000},
        "vehicle": {"armed": False}, "telemetry": {"altitude": 0.0},
    })
    app = create_app(gateway=gateway, security_range=gateway)
    with TestClient(app) as client:
        response = client.post("/api/v1/security/range/stop")
    assert response.status_code == 409
    assert gateway._runtime_active is True


def test_runtime_starts_and_stops_simulation_on_demand(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MUVA_PLATFORM_DATA", str(tmp_path / "platform.json"))
    gateway = Gateway(Settings())
    monkeypatch.setattr(gateway, "start", lambda: None)
    monkeypatch.setattr(gateway, "stop", lambda: None)

    class RuntimeStub:
        started = False

        def start(self) -> None:
            self.started = True

        def stop(self) -> None:
            self.started = False

    runtime = RuntimeStub()
    gateway.runtime_processes = runtime
    monkeypatch.setattr(gateway.monitor, "start", lambda: None)
    monkeypatch.setattr(gateway.monitor, "stop", lambda: None)

    def start_transport() -> None:
        gateway.state.set_transport_connected(True)
        gateway.state.handle_message(heartbeat(armed=False))

    monkeypatch.setattr(gateway.transport, "start", start_transport)
    monkeypatch.setattr(gateway.transport, "stop", lambda: gateway.state.set_transport_connected(False))
    with TestClient(create_app(gateway=gateway)) as client:
        session = client.post("/api/v1/experiments", json={"name": "实验一", "drone": {}, "scene": {}, "configuration": {}}).json()
        payload = {"experimentId": session["id"], "flightParameters": {"maxAltitude": 30}}
        started = client.post("/api/v1/runtime/start", json=payload)
        assert started.status_code == 200
        assert started.json()["vehicle"] == "ONLINE"
        assert runtime.started is True

        stopped = client.post("/api/v1/runtime/stop")
        assert stopped.status_code == 200
        assert runtime.started is False
        assert client.get("/api/v1/runtime/status").json()["vehicle"] == "UNAVAILABLE"


def test_runtime_refuses_to_stop_armed_vehicle(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MUVA_PLATFORM_DATA", str(tmp_path / "platform.json"))
    gateway = Gateway(Settings())
    monkeypatch.setattr(gateway, "start", lambda: None)
    monkeypatch.setattr(gateway, "stop", lambda: None)
    gateway.state.set_transport_connected(True)
    gateway.state.handle_message(heartbeat(armed=True))

    class RuntimeStub:
        stopped = False

        def stop(self) -> None:
            self.stopped = True

    runtime = RuntimeStub()
    gateway.runtime_processes = runtime
    with TestClient(create_app(gateway=gateway)) as client:
        response = client.post("/api/v1/runtime/stop")
        assert response.status_code == 409
        assert runtime.stopped is False


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
