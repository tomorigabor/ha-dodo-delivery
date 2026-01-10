from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, ATTR_ACTIVE, ATTR_REASON, ATTR_TRACKING_CODE, ATTR_LAST_UPDATE, ATTR_LAST_SEEN_STATUS


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    coordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([DodoDeliverySensor(coordinator, entry)])


class DodoDeliverySensor(CoordinatorEntity, SensorEntity):
    _attr_has_entity_name = True
    _attr_name = "DODO delivery"

    def __init__(self, coordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator)
        self.entry = entry
        self._attr_unique_id = f"{DOMAIN}_{entry.entry_id}"
        self._attr_icon = "mdi:truck-fast"

    @property
    def native_value(self) -> str:
        data = self.coordinator.data or {}
        if not data.get(ATTR_ACTIVE):
            return "Nincs aktív rendelés"
        detail = data.get("detail") or {}
        status_code = (detail.get("status") or data.get(ATTR_LAST_SEEN_STATUS) or "unknown") or "unknown"
        short_map = {
            "PickupStarted": "Feldolgozás",
            "PickupCompleted": "Átvéve",
            "OnWay": "Úton",
            "Arrived": "Megérkezett",
            "NearDestination": "Hamarosan",
            "Finished": "Kézbesítve",
            "Delivered": "Kézbesítve",
            "Cancelled": "Törölve",
            "Failed": "Sikertelen",
        }
        return short_map.get(str(status_code), str(status_code))

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return extra attributes for the sensor (compact, card-oriented)."""
        data: dict[str, Any] = self.coordinator.data or {}
        detail: dict[str, Any] = data.get("detail") or {}

        # Raw status code (for automations / debugging)
        status_code = (
            detail.get("status")
            or data.get(ATTR_LAST_SEEN_STATUS)
            or self._attr_native_value
            or "unknown"
        )

        status_map = {
            "PickupStarted": "A megrendelés feldolgozása folyamatban van.",
            "PickupCompleted": "A futár átvette a megrendelését.",
            "OnWay": "A futár úton van Önhöz.",
            "Arrived": "A futár megérkezett.",
            "NearDestination": "A futár hamarosan érkezik.",
            "Finished": "A megrendelését sikeresen kézbesítettük.",
            "Delivered": "A megrendelését sikeresen kézbesítettük.",
            "Cancelled": "A rendelést törölték.",
            "Failed": "A kézbesítés sikertelen.",
        }
        status_hu = status_map.get(str(status_code), str(status_code))

        attrs: dict[str, Any] = {
            # Existing (requested to keep)
            ATTR_TRACKING_CODE: data.get(ATTR_TRACKING_CODE),
            ATTR_LAST_UPDATE: data.get(ATTR_LAST_UPDATE),
            ATTR_LAST_SEEN_STATUS: data.get(ATTR_LAST_SEEN_STATUS),

            # Useful flags
            ATTR_ACTIVE: data.get(ATTR_ACTIVE),
            ATTR_REASON: data.get(ATTR_REASON),

            # Hungarian status + raw code
            "status_hu": status_hu,
            "status_code": status_code,
        }

        # Order identifiers
        if detail.get("shortCode"):
            attrs["short_code"] = detail.get("shortCode")
        if detail.get("partnerIdentifier"):
            attrs["partner_identifier"] = detail.get("partnerIdentifier")

        # Time fields (ISO strings as provided by the API)
        for key in ["requiredStart", "requiredEnd", "expectedStart", "started", "finished"]:
            val = detail.get(key)
            if val:
                attrs[key] = val

        # Courier (agent)
        agent = detail.get("agent") or {}
        if isinstance(agent, dict):
            if agent.get("agentIdentifier"):
                attrs["agent_id"] = agent.get("agentIdentifier")
            if agent.get("name"):
                attrs["agent_name"] = agent.get("name")

        # Coordinates (flat, only when present)
        pickup = detail.get("pickupQuestInfo") or {}
        if isinstance(pickup, dict):
            if pickup.get("name"):
                attrs["pickup_name"] = pickup.get("name")
            if pickup.get("latitude") is not None and pickup.get("longitude") is not None:
                attrs["pickup_latitude"] = pickup.get("latitude")
                attrs["pickup_longitude"] = pickup.get("longitude")

        drop = detail.get("dropQuestInfo") or {}
        if isinstance(drop, dict):
            # Some phases may not include it; only store when coordinates exist
            if drop.get("latitude") is not None and drop.get("longitude") is not None:
                attrs["drop_latitude"] = drop.get("latitude")
                attrs["drop_longitude"] = drop.get("longitude")

        # Agent live coordinates may appear at later stages
        if detail.get("agentLatitude") is not None and detail.get("agentLongitude") is not None:
            attrs["agent_latitude"] = detail.get("agentLatitude")
            attrs["agent_longitude"] = detail.get("agentLongitude")

        # Vehicle name, if present
        veh = detail.get("vehicle") or {}
        if isinstance(veh, dict) and veh.get("name"):
            attrs["vehicle_name"] = veh.get("name")

        # Remove empty / None values to keep attributes clean
        return {k: v for k, v in attrs.items() if v not in ("", None, {}, [])}
