from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from typing import Any

from pymavlink import mavutil

from .config import Settings
from .state import VehicleState

LOGGER = logging.getLogger(__name__)


class MavlinkTransport:
    def __init__(self, settings: Settings, state: VehicleState) -> None:
        self.settings = settings
        self.state = state
        self._connection: Any | None = None
        self._connection_lock = threading.RLock()
        self._send_lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name="mavlink-reader", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        self._close_connection()
        if self._thread:
            self._thread.join(timeout=3)

    def send(self, callback: Callable[[Any], None]) -> None:
        with self._send_lock:
            with self._connection_lock:
                connection = self._connection
            if connection is None:
                raise ConnectionError("MAVLink transport is not connected")
            callback(connection)

    def mode_mapping(self) -> dict[str, int]:
        with self._connection_lock:
            connection = self._connection
        mapping = connection.mode_mapping() if connection is not None else None
        return mapping or {name: number for number, name in mavutil.mode_mapping_acm.items()}

    def _run(self) -> None:
        reconnect_delay = 0.5
        while not self._stop_event.is_set():
            try:
                connection = mavutil.mavlink_connection(
                    self.settings.mavlink_endpoint,
                    source_system=self.settings.source_system,
                    source_component=self.settings.source_component,
                    dialect="ardupilotmega",
                    autoreconnect=True,
                    robust_parsing=True,
                )
                with self._connection_lock:
                    self._connection = connection
                self.state.set_transport_connected(True)
                LOGGER.info("MAVLink transport opened: %s", self.settings.mavlink_endpoint)
                reconnect_delay = 0.5
                self._receive(connection)
            except Exception:
                if not self._stop_event.is_set():
                    LOGGER.exception("MAVLink transport failed; retrying")
            finally:
                self.state.set_transport_connected(False)
                self._close_connection()
            if not self._stop_event.wait(reconnect_delay):
                reconnect_delay = min(reconnect_delay * 2, 5.0)

    def _receive(self, connection: Any) -> None:
        next_heartbeat = 0.0
        streams_requested = False
        received_vehicle_heartbeat = False
        heartbeat_deadline = 0.0
        while not self._stop_event.is_set():
            now = time.monotonic()
            if now >= next_heartbeat:
                with self._send_lock:
                    connection.mav.heartbeat_send(
                        mavutil.mavlink.MAV_TYPE_GCS,
                        mavutil.mavlink.MAV_AUTOPILOT_INVALID,
                        0,
                        0,
                        mavutil.mavlink.MAV_STATE_ACTIVE,
                    )
                next_heartbeat = now + 1.0
            message = connection.recv_match(blocking=True, timeout=0.2)
            if message is not None:
                self.state.handle_message(message)
                if message.get_type() == "HEARTBEAT" and self.state.target[0]:
                    received_vehicle_heartbeat = True
                    heartbeat_deadline = time.monotonic() + self.settings.heartbeat_timeout
                    if not streams_requested:
                        self._request_data_streams(connection)
                        streams_requested = True
            if received_vehicle_heartbeat and time.monotonic() > heartbeat_deadline:
                LOGGER.warning("MAVLink heartbeat timed out; reconnecting transport")
                return

    def _request_data_streams(self, connection: Any) -> None:
        target_system, target_component = self.state.target
        rate = max(1, min(20, round(self.settings.telemetry_rate_hz)))
        streams = (
            (mavutil.mavlink.MAV_DATA_STREAM_RAW_SENSORS, min(rate, 2)),
            (mavutil.mavlink.MAV_DATA_STREAM_EXTENDED_STATUS, min(rate, 2)),
            (mavutil.mavlink.MAV_DATA_STREAM_POSITION, rate),
            (mavutil.mavlink.MAV_DATA_STREAM_EXTRA1, min(10, rate * 2)),
            (mavutil.mavlink.MAV_DATA_STREAM_EXTRA2, rate),
            (mavutil.mavlink.MAV_DATA_STREAM_EXTRA3, min(rate, 2)),
        )
        with self._send_lock:
            for stream_id, stream_rate in streams:
                connection.mav.request_data_stream_send(
                    target_system,
                    target_component,
                    stream_id,
                    stream_rate,
                    1,
                )
        LOGGER.info("Requested %d MAVLink telemetry streams from system %d", len(streams), target_system)

    def _close_connection(self) -> None:
        with self._connection_lock:
            connection, self._connection = self._connection, None
        if connection is not None:
            try:
                connection.close()
            except Exception:
                LOGGER.debug("Ignoring MAVLink close error", exc_info=True)
