from __future__ import annotations

from dataclasses import dataclass
import asyncio
from datetime import datetime, timedelta, timezone
import logging
from typing import Any

import aiohttp

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.util import dt as dt_util

from .const import (
    API_BASE,
    DETAIL_PATH,
    DOMAIN,
    CONF_MODE,
    MODE_MANUAL,
    MODE_ENTITY,
    CONF_TRACKING_CODE,
    CONF_CODE_ENTITY,
    CONF_RETENTION_HOURS,
    DEFAULT_RETENTION_HOURS,
    CONF_INCLUDE_DESTINATION,
    DEFAULT_INCLUDE_DESTINATION,
    ATTR_TRACKING_CODE,
    ATTR_ACTIVE,
    ATTR_REASON,
    ATTR_LAST_UPDATE,
    ATTR_LAST_SEEN_STATUS,
)
from .helpers import extract_code

_LOGGER = logging.getLogger(__name__)

FINISHED_STATUSES = {"FINISHED", "DELIVERED"}

def _now_utc() -> datetime:
    return dt_util.utcnow()

def _parse_iso(iso: str | None) -> datetime | None:
    if not iso:
        return None
    try:
        # Home Assistant util handles Z and offsets
        return dt_util.parse_datetime(iso)
    except Exception:
        return None


class DodoDeliveryCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Fetches DODO/Gaia order detail and exposes a single structured payload."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, update_interval: timedelta) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}:{entry.title}",
            update_interval=update_interval,
        )
        self.entry = entry
        self._session = async_get_clientsession(hass)
        self._finished_at: datetime | None = None
        self._last_status: str | None = None
    def _get_tracking_code(self) -> str | None:
        mode = self.entry.options.get(CONF_MODE, self.entry.data.get(CONF_MODE, MODE_MANUAL))
        if mode == MODE_ENTITY:
            ent_id = self.entry.options.get(CONF_CODE_ENTITY, self.entry.data.get(CONF_CODE_ENTITY))
            if not ent_id:
                return None
            st = self.hass.states.get(ent_id)
            return extract_code(st.state if st else None)
        # manual
        code = self.entry.options.get(CONF_TRACKING_CODE, self.entry.data.get(CONF_TRACKING_CODE))
        return extract_code(code)

    def _retention_expired(self, now: datetime, retention_hours: int) -> bool:
        if not self._finished_at:
            return False
        return now >= (self._finished_at + timedelta(hours=retention_hours))

    async def _async_update_data(self) -> dict[str, Any]:
        code = self._get_tracking_code()
        retention_hours = int(self.entry.options.get(CONF_RETENTION_HOURS, DEFAULT_RETENTION_HOURS))
        include_destination = bool(self.entry.options.get(CONF_INCLUDE_DESTINATION, DEFAULT_INCLUDE_DESTINATION))
        now = _now_utc()

        if not code:
            return {
                ATTR_ACTIVE: False,
                ATTR_REASON: "no_tracking_code",
                ATTR_TRACKING_CODE: None,
                ATTR_LAST_UPDATE: now.isoformat(),
                ATTR_LAST_SEEN_STATUS: self._last_status,
                "detail": None,
            }

        if self._retention_expired(now, retention_hours):
            return {
                ATTR_ACTIVE: False,
                ATTR_REASON: "expired_after_finished",
                ATTR_TRACKING_CODE: code,
                ATTR_LAST_UPDATE: now.isoformat(),
                ATTR_LAST_SEEN_STATUS: self._last_status,
                "detail": None,
            }

        url = f"{API_BASE}{DETAIL_PATH.format(code=code)}"

        try:
            async with self._session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                if resp.status == 404:
                    return {
                        ATTR_ACTIVE: False,
                        ATTR_REASON: "not_found",
                        ATTR_TRACKING_CODE: code,
                        ATTR_LAST_UPDATE: now.isoformat(),
                        ATTR_LAST_SEEN_STATUS: self._last_status,
                        "detail": None,
                    }
                if resp.status >= 400:
                    raise UpdateFailed(f"HTTP {resp.status}")
                payload = await resp.json()
        except asyncio.CancelledError:
            raise
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            raise UpdateFailed(f"Request failed: {err}") from err
        except ValueError as err:
            raise UpdateFailed(f"Invalid JSON: {err}") from err

        # Track finished time for retention
        raw_status = (payload.get("status") or "").strip()
        status = raw_status.upper() if raw_status else "UNKNOWN"
        self._last_status = raw_status or None

        finished_iso = payload.get("finished") or payload.get("delivered")  # defensive
        finished_dt = _parse_iso(finished_iso)
        if status in FINISHED_STATUSES and finished_dt:
            self._finished_at = finished_dt

        # Optionally strip destination coords to be privacy-friendly by default
        if not include_destination and isinstance(payload, dict):
            if "dropQuestInfo" in payload:
                # keep object but remove coordinates if present
                dq = payload.get("dropQuestInfo") or {}
                if isinstance(dq, dict):
                    dq = dict(dq)
                    dq.pop("latitude", None)
                    dq.pop("longitude", None)
                    payload["dropQuestInfo"] = dq

        return {
            ATTR_ACTIVE: True,
            ATTR_REASON: None,
            ATTR_TRACKING_CODE: code,
            ATTR_LAST_UPDATE: now.isoformat(),
            ATTR_LAST_SEEN_STATUS: raw_status or status,
            "detail": payload,
        }
