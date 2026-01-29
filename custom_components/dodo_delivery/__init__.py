from __future__ import annotations

from datetime import timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.event import async_track_state_change_event

from .const import (
    DOMAIN,
    CONF_POLL_INTERVAL,
    DEFAULT_POLL_INTERVAL,
    CONF_MODE,
    MODE_ENTITY,
    CONF_CODE_ENTITY,
)
from .coordinator import DodoDeliveryCoordinator

PLATFORMS: list[str] = ["sensor"]

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    poll_interval = entry.options.get(CONF_POLL_INTERVAL, DEFAULT_POLL_INTERVAL)
    coordinator = DodoDeliveryCoordinator(
        hass=hass,
        entry=entry,
        update_interval=timedelta(seconds=int(poll_interval)),
    )
    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator

    # If the integration is configured to read the tracking code from a helper entity,
    # refresh immediately when that helper changes (e.g., IMAP blueprint updates it).
    mode = entry.options.get(CONF_MODE, entry.data.get(CONF_MODE))
    if mode == MODE_ENTITY:
        ent_id = entry.options.get(CONF_CODE_ENTITY, entry.data.get(CONF_CODE_ENTITY))
        if ent_id:
            async def _on_code_change(event):
                coordinator.async_request_refresh()

            unsub = async_track_state_change_event(hass, [ent_id], _on_code_change)
            hass.data.setdefault(DOMAIN, {}).setdefault("_unsub", {})[entry.entry_id] = unsub

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        unsub = hass.data.get(DOMAIN, {}).get("_unsub", {}).pop(entry.entry_id, None)
        if unsub:
            unsub()
        hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    return unload_ok


async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)
