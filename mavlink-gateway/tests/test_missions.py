from __future__ import annotations

import math

import pytest
from pymavlink import mavutil

from muva_gateway.missions import MissionService
from muva_gateway.commands import InvalidCommandError, CommandRejectedError


def service() -> MissionService:
    return MissionService.__new__(MissionService)


def valid_items() -> list[dict[str, float | str]]:
    return [
        {"command": "TAKEOFF", "latitude": 34.3416, "longitude": 108.9398, "altitude": 6},
        {"command": "WAYPOINT", "latitude": 34.3417, "longitude": 108.9398, "altitude": 6},
        {"command": "LAND", "latitude": 34.3416, "longitude": 108.9398, "altitude": 0},
    ]


def test_build_items_adds_home_and_preserves_public_sequence() -> None:
    built = service().build_items(valid_items())

    assert len(built) == 4
    assert built[0].seq == 0
    assert built[0].command == mavutil.mavlink.MAV_CMD_NAV_WAYPOINT
    assert [item.seq for item in built[1:]] == [1, 2, 3]
    assert built[1].command == mavutil.mavlink.MAV_CMD_NAV_TAKEOFF
    assert built[-1].command == mavutil.mavlink.MAV_CMD_NAV_LAND


@pytest.mark.parametrize(
    "items, message",
    [
        ([{"command": "WAYPOINT", "latitude": 0, "longitude": 0, "altitude": 6}, {"command": "LAND"}], "first"),
        ([{"command": "TAKEOFF", "latitude": 0, "longitude": 0, "altitude": 6}, {"command": "WAYPOINT", "latitude": 0, "longitude": 0, "altitude": 6}], "final"),
        ([{"command": "TAKEOFF", "latitude": math.nan, "longitude": 0, "altitude": 6}, {"command": "LAND"}], "non-finite"),
        ([{"command": "TAKEOFF", "latitude": 0, "longitude": 0, "altitude": math.inf}, {"command": "LAND"}], "non-finite"),
    ],
)
def test_build_items_rejects_unsafe_missions(items: list[dict[str, object]], message: str) -> None:
    with pytest.raises(InvalidCommandError, match=message):
        service().build_items(items)


def test_verify_checks_commands_coordinates_and_altitudes() -> None:
    mission = service().build_items(valid_items())
    service()._verify(mission, mission)

    changed = list(mission)
    changed[2] = changed[2].__class__(**{**changed[2].__dict__, "altitude": 8})
    with pytest.raises(CommandRejectedError, match="altitude mismatch"):
        service()._verify(mission, changed)


def test_verify_accepts_int_frame_aliases_and_fc_owned_land_yaw() -> None:
    mission = service().build_items(valid_items())
    downloaded = [
        item.__class__(**{
            **item.__dict__,
            "frame": mavutil.mavlink.MAV_FRAME_GLOBAL if item.seq == 0 else mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT,
            "param4": 1.0 if item.command == mavutil.mavlink.MAV_CMD_NAV_LAND else item.param4,
        })
        for item in mission
    ]
    service()._verify(mission, downloaded)
