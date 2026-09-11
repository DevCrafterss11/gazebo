from __future__ import annotations

import math
import hashlib
import json
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import asdict, dataclass, replace
from typing import Any, TYPE_CHECKING

from pymavlink import mavutil

from .commands import CommandRejectedError, CommandTimeoutError, InvalidCommandError, OperationBusyError, VehicleOfflineError
from .config import Settings
from .state import VehicleState
from .transport import MavlinkTransport

if TYPE_CHECKING:
    from .commands import CommandService

MISSION_TYPE = mavutil.mavlink.MAV_MISSION_TYPE_MISSION
PROTOCOL_TYPES = ("MISSION_REQUEST_INT", "MISSION_REQUEST", "MISSION_ACK")

COMMANDS = {
    "TAKEOFF": mavutil.mavlink.MAV_CMD_NAV_TAKEOFF,
    "WAYPOINT": mavutil.mavlink.MAV_CMD_NAV_WAYPOINT,
    "LOITER_TIME": mavutil.mavlink.MAV_CMD_NAV_LOITER_TIME,
    "RTL": mavutil.mavlink.MAV_CMD_NAV_RETURN_TO_LAUNCH,
    "LAND": mavutil.mavlink.MAV_CMD_NAV_LAND,
}
COMMAND_NAMES = {value: key for key, value in COMMANDS.items()}


@dataclass(frozen=True)
class MissionItem:
    seq: int
    command: int
    frame: int
    latitude: float
    longitude: float
    altitude: float
    param1: float = 0.0
    param2: float = 0.0
    param3: float = 0.0
    param4: float = 0.0
    current: int = 0
    autocontinue: int = 1

    def to_api(self) -> dict[str, Any]:
        return {
            **asdict(self),
            "command": COMMAND_NAMES.get(self.command, str(self.command)),
        }


class MissionService:
    def __init__(
        self,
        settings: Settings,
        state: VehicleState,
        transport: MavlinkTransport,
        operation_lock: threading.RLock,
    ) -> None:
        self.settings = settings
        self.state = state
        self.transport = transport
        self._operation_lock = operation_lock
        self._last_verified: list[MissionItem] | None = None
        self._last_uploaded_at = 0.0

    @contextmanager
    def _operation(self) -> Iterator[None]:
        if not self._operation_lock.acquire(blocking=False):
            raise OperationBusyError("Another flight operation is already in progress")
        try:
            yield
        finally:
            self._operation_lock.release()

    def build_items(self, items: list[dict[str, Any]]) -> list[MissionItem]:
        if not 2 <= len(items) <= 200:
            raise InvalidCommandError("A mission must contain between 2 and 200 items")
        built: list[MissionItem] = [
            MissionItem(
                seq=0,
                command=mavutil.mavlink.MAV_CMD_NAV_WAYPOINT,
                frame=mavutil.mavlink.MAV_FRAME_GLOBAL_INT,
                latitude=float(items[0].get("latitude", 0)),
                longitude=float(items[0].get("longitude", 0)),
                altitude=0,
            )
        ]
        for user_seq, raw in enumerate(items):
            seq = user_seq + 1
            command_name = str(raw.get("command", "")).upper()
            if command_name not in COMMANDS:
                raise InvalidCommandError(f"Unsupported mission command: {command_name}")
            command = COMMANDS[command_name]
            latitude = float(raw.get("latitude", 0))
            longitude = float(raw.get("longitude", 0))
            altitude = float(raw.get("altitude", 0))
            numeric_values = (latitude, longitude, altitude, *(float(raw.get(name, 0)) for name in ("param1", "param2", "param3", "param4")))
            if not all(math.isfinite(value) for value in numeric_values):
                raise InvalidCommandError(f"Mission item {seq} contains a non-finite numeric value")
            if command_name not in ("RTL",) and not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
                raise InvalidCommandError(f"Invalid coordinates for mission item {seq}")
            if command_name == "RTL":
                latitude = 0.0
                longitude = 0.0
            if command_name in ("TAKEOFF", "WAYPOINT", "LOITER_TIME") and not 2 <= altitude <= 120:
                raise InvalidCommandError(f"Altitude for mission item {seq} must be between 2 and 120 metres")
            frame = (
                mavutil.mavlink.MAV_FRAME_GLOBAL
                if command_name == "RTL"
                else mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT
            )
            built.append(
                MissionItem(
                    seq=seq,
                    command=command,
                    frame=frame,
                    latitude=latitude,
                    longitude=longitude,
                    altitude=altitude,
                    param1=float(raw.get("param1", 0)),
                    param2=float(raw.get("param2", 0)),
                    param3=float(raw.get("param3", 0)),
                    param4=float(raw.get("param4", 0)),
                    current=0,
                )
            )
        if COMMAND_NAMES[built[1].command] != "TAKEOFF":
            raise InvalidCommandError("The first mission item must be TAKEOFF")
        if COMMAND_NAMES[built[-1].command] not in ("RTL", "LAND"):
            raise InvalidCommandError("The final mission item must be RTL or LAND")
        for item in built[2:-1]:
            if COMMAND_NAMES[item.command] in ("TAKEOFF", "RTL", "LAND"):
                raise InvalidCommandError("TAKEOFF, RTL, and LAND may only appear at mission boundaries")
        return built

    def upload(self, raw_items: list[dict[str, Any]], verify: bool = True) -> dict[str, Any]:
        items = self.build_items(raw_items)
        with self._operation():
            self._ensure_ready_for_upload()
            self._clear_verification()
            target_system, target_component = self.state.target
            generations = self.state.protocol_generations(PROTOCOL_TYPES)
            self._send_mission_count(target_system, target_component, len(items))
            sent: set[int] = set()
            deadline = time.monotonic() + max(10.0, self.settings.command_timeout + len(items))
            retries = 0
            last_item: tuple[MissionItem, str] | None = None
            while len(sent) < len(items):
                try:
                    event = self._wait_protocol(PROTOCOL_TYPES, generations, deadline)
                except CommandTimeoutError:
                    if retries >= self.settings.mission_retries:
                        raise
                    retries += 1
                    if last_item is None:
                        self._send_mission_count(target_system, target_component, len(items))
                    else:
                        self._send_item_with_retry(target_system, target_component, last_item[0], last_item[1])
                    deadline = time.monotonic() + max(3.0, self.settings.command_timeout)
                    continue
                message_type, message = event
                if message_type == "MISSION_ACK":
                    raise CommandRejectedError(
                        f"Mission upload rejected before completion: {self._mission_result_name(int(message.type))}"
                    )
                seq = int(message.seq)
                if not 0 <= seq < len(items):
                    raise CommandRejectedError(f"Flight controller requested invalid mission item {seq}")
                self._send_item_with_retry(target_system, target_component, items[seq], message_type)
                sent.add(seq)
                last_item = (items[seq], message_type)
                retries = 0

            while True:
                try:
                    event = self._wait_protocol(("MISSION_ACK",), generations, deadline)
                    break
                except CommandTimeoutError:
                    if retries >= self.settings.mission_retries:
                        raise
                    retries += 1
                    if last_item is None:
                        self._send_mission_count(target_system, target_component, len(items))
                    else:
                        self._send_item_with_retry(target_system, target_component, last_item[0], last_item[1])
                    deadline = time.monotonic() + max(3.0, self.settings.command_timeout)
            ack = event[1]
            if int(ack.type) != mavutil.mavlink.MAV_MISSION_ACCEPTED:
                raise CommandRejectedError(f"Mission upload rejected: {self._mission_result_name(int(ack.type))}")

            downloaded = self._download_locked()
            if verify:
                self._verify(items, downloaded)
                self._mark_verified(downloaded)
            return {
                "accepted": True,
                "count": len(items) - 1,
                "verified": verify,
                "items": [item.to_api() for item in self._public_items(downloaded)],
            }

    def download(self) -> dict[str, Any]:
        with self._operation():
            self._ensure_online()
            items = self._download_locked()
            public_items = self._public_items(items)
            validation_error: str | None = None
            try:
                self._validate_downloaded(items)
            except CommandRejectedError as error:
                self._clear_verification()
                validation_error = str(error)
            else:
                self._mark_verified(items)
            return {
                "count": len(public_items),
                "verified": validation_error is None,
                "verifiedAt": self._last_uploaded_at if validation_error is None else None,
                "missionHash": self._fingerprint(items) if validation_error is None else None,
                "validationError": validation_error,
                "items": [item.to_api() for item in public_items],
            }

    def start(self, command_service: "CommandService") -> dict[str, Any]:
        """Read back the mission before starting it.

        Another GCS (including MAVProxy) may have replaced the mission since the
        last upload, so execution must always operate on the flight controller's
        current mission rather than a stale browser copy.
        """
        with self._operation():
            self._ensure_online()
            actual = self._download_locked()
            try:
                self._validate_downloaded(actual)
                if self._last_verified is None:
                    raise CommandRejectedError("Mission must be read back and verified before execution")
                self._verify(self._last_verified, actual)
            except CommandRejectedError:
                self._clear_verification()
                raise
            self._mark_verified(actual)
            self.state.set_mission_state("loaded")
            return command_service.start_mission()

    def _clear_verification(self) -> None:
        self._last_verified = None
        self._last_uploaded_at = 0.0
        self.state.set_mission_verification(False)

    def _mark_verified(self, items: list[MissionItem]) -> None:
        self._last_verified = list(items)
        self._last_uploaded_at = time.time()
        self.state.set_mission_verification(True, self._last_uploaded_at, self._fingerprint(items))

    @staticmethod
    def _fingerprint(items: list[MissionItem]) -> str:
        canonical = [
            {
                **asdict(item),
                "latitude": round(item.latitude, 7),
                "longitude": round(item.longitude, 7),
                "altitude": round(item.altitude, 2),
                "param1": round(item.param1, 3),
                "param2": round(item.param2, 3),
                "param3": round(item.param3, 3),
                "param4": round(item.param4, 3),
            }
            for item in items
        ]
        payload = json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()
        return hashlib.sha256(payload).hexdigest()

    def _download_locked(self) -> list[MissionItem]:
        target_system, target_component = self.state.target
        count_types = ("MISSION_COUNT", "MISSION_ACK")
        generations = self.state.protocol_generations(count_types)
        self._send_request_list(target_system, target_component)
        deadline = time.monotonic() + max(10.0, self.settings.command_timeout)
        retries = 0
        while True:
            try:
                event = self._wait_protocol(count_types, generations, deadline)
                break
            except CommandTimeoutError:
                if retries >= self.settings.mission_retries:
                    raise
                retries += 1
                self._send_request_list(target_system, target_component)
                deadline = time.monotonic() + max(3.0, self.settings.command_timeout)
        if event[0] == "MISSION_ACK":
            raise CommandRejectedError(f"Mission download rejected: {self._mission_result_name(int(event[1].type))}")
        count = int(event[1].count)
        if count > 200:
            raise CommandRejectedError(f"Flight controller reported unreasonable mission count: {count}")

        items: list[MissionItem] = []
        item_types = ("MISSION_ITEM_INT", "MISSION_ITEM", "MISSION_ACK")
        generations = self.state.protocol_generations(item_types)
        for seq in range(count):
            self._send_request_item(target_system, target_component, seq)
            retries = 0
            while True:
                try:
                    event = self._wait_protocol(item_types, generations, deadline + count)
                except CommandTimeoutError:
                    if retries >= self.settings.mission_retries:
                        raise
                    retries += 1
                    self._send_request_item(target_system, target_component, seq)
                    deadline = time.monotonic() + max(3.0, self.settings.command_timeout)
                    continue
                message_type, message = event
                if message_type == "MISSION_ACK":
                    raise CommandRejectedError(
                        f"Mission download interrupted: {self._mission_result_name(int(message.type))}"
                    )
                if int(message.seq) == seq:
                    items.append(self._from_message(message))
                    break

        self._send_mission_ack(target_system, target_component, mavutil.mavlink.MAV_MISSION_ACCEPTED)
        return items

    def _send_mission_count(self, target_system: int, target_component: int, count: int) -> None:
        self.transport.send(lambda connection: connection.mav.mission_count_send(target_system, target_component, count))

    def _send_request_list(self, target_system: int, target_component: int) -> None:
        self.transport.send(lambda connection: connection.mav.mission_request_list_send(target_system, target_component))

    def _send_request_item(self, target_system: int, target_component: int, seq: int) -> None:
        self.transport.send(lambda connection: connection.mav.mission_request_int_send(target_system, target_component, seq))

    def _send_mission_ack(self, target_system: int, target_component: int, result: int) -> None:
        self.transport.send(lambda connection: connection.mav.mission_ack_send(target_system, target_component, result))

    def _send_item_with_retry(self, target_system: int, target_component: int, item: MissionItem, request_type: str) -> None:
        self.transport.send(
            lambda connection: self._send_item(connection, target_system, target_component, item, request_type)
        )

    def _send_item(
        self,
        connection: Any,
        target_system: int,
        target_component: int,
        item: MissionItem,
        request_type: str,
    ) -> None:
        common = (
            target_system,
            target_component,
            item.seq,
            item.frame,
            item.command,
            item.current,
            item.autocontinue,
            item.param1,
            item.param2,
            item.param3,
            item.param4,
        )
        # Use the integer mission protocol for both request variants. ArduPilot
        # accepts MISSION_ITEM_INT for legacy MISSION_REQUEST messages and avoids
        # the "GCS should send MISSION_ITEM_INT" warning.
        connection.mav.mission_item_int_send(
            *common,
            int(round(item.latitude * 1e7)),
            int(round(item.longitude * 1e7)),
            item.altitude,
        )

    @staticmethod
    def _from_message(message: Any) -> MissionItem:
        is_int = message.get_type() == "MISSION_ITEM_INT"
        latitude = message.x / 1e7 if is_int else float(message.x)
        longitude = message.y / 1e7 if is_int else float(message.y)
        return MissionItem(
            seq=int(message.seq),
            command=int(message.command),
            frame=int(message.frame),
            latitude=latitude,
            longitude=longitude,
            altitude=float(message.z),
            param1=float(message.param1),
            param2=float(message.param2),
            param3=float(message.param3),
            param4=float(message.param4),
            current=int(message.current),
            autocontinue=int(message.autocontinue),
        )

    @staticmethod
    def _verify(expected: list[MissionItem], actual: list[MissionItem]) -> None:
        if len(expected) != len(actual):
            raise CommandRejectedError(f"Mission verification count mismatch: {len(expected)} != {len(actual)}")
        # ArduPilot owns item zero and rewrites it with the current absolute Home altitude.
        for expected_item, actual_item in zip(expected[1:], actual[1:]):
            if expected_item.command != actual_item.command:
                raise CommandRejectedError(f"Mission command mismatch at item {expected_item.seq}")
            if not MissionService._frames_equivalent(expected_item.frame, actual_item.frame):
                raise CommandRejectedError(f"Mission frame mismatch at item {expected_item.seq}")
            if abs(expected_item.latitude - actual_item.latitude) > 1e-5:
                raise CommandRejectedError(f"Mission latitude mismatch at item {expected_item.seq}")
            if abs(expected_item.longitude - actual_item.longitude) > 1e-5:
                raise CommandRejectedError(f"Mission longitude mismatch at item {expected_item.seq}")
            if not math.isclose(expected_item.altitude, actual_item.altitude, abs_tol=0.2):
                raise CommandRejectedError(f"Mission altitude mismatch at item {expected_item.seq}")
            comparable_params = ("param1",) if COMMAND_NAMES.get(expected_item.command) == "LAND" else (
                () if COMMAND_NAMES.get(expected_item.command) == "RTL" else ("param1", "param2", "param3", "param4")
            )
            for name in comparable_params:
                expected_value = getattr(expected_item, name)
                actual_value = getattr(actual_item, name)
                if not math.isclose(expected_value, actual_value, abs_tol=0.05):
                    raise CommandRejectedError(f"Mission {name} mismatch at item {expected_item.seq}")

    @staticmethod
    def _frames_equivalent(expected: int, actual: int) -> bool:
        """MAVLink INT and non-INT frames carry the same navigation semantics."""
        global_frames = {mavutil.mavlink.MAV_FRAME_GLOBAL, mavutil.mavlink.MAV_FRAME_GLOBAL_INT}
        relative_frames = {
            mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT,
            mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
        }
        return (expected in global_frames and actual in global_frames) or (
            expected in relative_frames and actual in relative_frames
        ) or expected == actual

    @staticmethod
    def _validate_downloaded(items: list[MissionItem]) -> None:
        public_items = items[1:] if items else []
        if len(public_items) < 2:
            raise CommandRejectedError("Flight controller returned an incomplete mission")
        if COMMAND_NAMES.get(public_items[0].command) != "TAKEOFF":
            raise CommandRejectedError("The uploaded mission does not start with TAKEOFF")
        if COMMAND_NAMES.get(public_items[-1].command) not in ("RTL", "LAND"):
            raise CommandRejectedError("The uploaded mission does not end with RTL or LAND")
        for item in public_items:
            if item.command not in COMMAND_NAMES:
                raise CommandRejectedError(f"Flight controller returned unsupported mission command {item.command}")

    @staticmethod
    def _public_items(items: list[MissionItem]) -> list[MissionItem]:
        if not items:
            return []
        return [replace(item, seq=index) for index, item in enumerate(items[1:])]

    def _wait_protocol(
        self,
        message_types: tuple[str, ...],
        generations: dict[str, int],
        deadline: float,
    ) -> tuple[str, Any]:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise CommandTimeoutError(f"Mission protocol timed out waiting for {', '.join(message_types)}")
        event = self.state.wait_for_protocol(message_types, generations, remaining, self._is_mission_message)
        if event is None:
            raise CommandTimeoutError(f"Mission protocol timed out waiting for {', '.join(message_types)}")
        return event

    @staticmethod
    def _is_mission_message(message: Any) -> bool:
        return int(getattr(message, "mission_type", MISSION_TYPE)) == MISSION_TYPE

    @staticmethod
    def _mission_result_name(result: int) -> str:
        entry = mavutil.mavlink.enums.get("MAV_MISSION_RESULT", {}).get(result)
        return entry.name if entry is not None else f"UNKNOWN_{result}"

    def _ensure_online(self) -> None:
        if not self.state.is_online():
            raise VehicleOfflineError("No recent vehicle heartbeat")

    def _ensure_ready_for_upload(self) -> None:
        self._ensure_online()
        if self.state.vehicle_value("armed") and not self.settings.allow_armed_mission_upload:
            raise CommandRejectedError("Disarm the vehicle before replacing its mission")
