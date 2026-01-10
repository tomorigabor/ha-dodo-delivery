from __future__ import annotations

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.helpers import selector

from .const import (
    DOMAIN,
    CONF_MODE,
    MODE_MANUAL,
    MODE_ENTITY,
    CONF_TRACKING_CODE,
    CONF_CODE_ENTITY,
    CONF_POLL_INTERVAL,
    DEFAULT_POLL_INTERVAL,
    CONF_RETENTION_HOURS,
    DEFAULT_RETENTION_HOURS,
    CONF_INCLUDE_DESTINATION,
    DEFAULT_INCLUDE_DESTINATION,
)
from .helpers import extract_code


def _validate_code(value: str) -> str:
    code = extract_code(value)
    if not code:
        raise vol.Invalid("Invalid tracking code (expected 8 chars A-Z/0-9 or a t.idodo.group link)")
    return code


class DodoDeliveryConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        """Step 1: choose mode."""
        if user_input is not None:
            mode = user_input[CONF_MODE]
            if mode == MODE_MANUAL:
                return await self.async_step_manual()
            return await self.async_step_entity()

        schema = vol.Schema(
            {
                vol.Required(CONF_MODE, default=MODE_ENTITY): vol.In([MODE_ENTITY, MODE_MANUAL]),
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema)

    async def async_step_manual(self, user_input=None):
        """Step 2a: manual tracking code."""
        errors = {}
        if user_input is not None:
            try:
                code = _validate_code(user_input.get(CONF_TRACKING_CODE, ""))
                data = {CONF_MODE: MODE_MANUAL, CONF_TRACKING_CODE: code}
                return self.async_create_entry(title="DODO delivery", data=data)
            except vol.Invalid:
                errors[CONF_TRACKING_CODE] = "invalid_code"

        schema = vol.Schema({vol.Required(CONF_TRACKING_CODE): str})
        return self.async_show_form(step_id="manual", data_schema=schema, errors=errors)

    async def async_step_entity(self, user_input=None):
        """Step 2b: read tracking code from an entity."""
        errors = {}
        if user_input is not None:
            ent = user_input.get(CONF_CODE_ENTITY, "")
            if not ent:
                errors[CONF_CODE_ENTITY] = "required"
            else:
                st = self.hass.states.get(ent)
                code = extract_code(st.state if st else None)
                if not code:
                    errors[CONF_CODE_ENTITY] = "entity_no_code"

            if not errors:
                data = {CONF_MODE: MODE_ENTITY, CONF_CODE_ENTITY: ent}
                return self.async_create_entry(title="DODO delivery", data=data)

        schema = vol.Schema(
            {
                vol.Required(CONF_CODE_ENTITY): selector.EntitySelector(
                    selector.EntitySelectorConfig(
                        multiple=False,
                        filter=[
                            selector.EntityFilterSelectorConfig(domain="input_text"),
                            selector.EntityFilterSelectorConfig(domain="sensor"),
                        ],
                    )
                )
            }
        )
        return self.async_show_form(step_id="entity", data_schema=schema, errors=errors)

    async def async_step_options(self, user_input=None):
        return await OptionsFlowHandler(self.hass, self.context).async_step_init(user_input)
class OptionsFlowHandler(config_entries.OptionsFlow):
    def __init__(self, hass: HomeAssistant, context) -> None:
        self.hass = hass
        self.context = context

    async def async_step_init(self, user_input=None):
        errors = {}
        if user_input is not None:
            mode = user_input.get(CONF_MODE, MODE_ENTITY)
            if mode == MODE_MANUAL:
                try:
                    user_input[CONF_TRACKING_CODE] = _validate_code(user_input.get(CONF_TRACKING_CODE, ""))
                except vol.Invalid:
                    errors[CONF_TRACKING_CODE] = "invalid_code"
            else:
                ent = user_input.get(CONF_CODE_ENTITY, "")
                if not ent:
                    errors[CONF_CODE_ENTITY] = "required"
                else:
                    st = self.hass.states.get(ent)
                    if not extract_code(st.state if st else None):
                        errors[CONF_CODE_ENTITY] = "entity_no_code"

            if not errors:
                return self.async_create_entry(title="", data=user_input)

        # Defaults from existing options
        current = self.config_entry.options

        schema = vol.Schema(
            {
                vol.Required(CONF_MODE, default=current.get(CONF_MODE, MODE_ENTITY)): vol.In([MODE_ENTITY, MODE_MANUAL]),
                vol.Optional(CONF_POLL_INTERVAL, default=int(current.get(CONF_POLL_INTERVAL, DEFAULT_POLL_INTERVAL))): vol.All(int, vol.Range(min=10, max=300)),
                vol.Optional(CONF_RETENTION_HOURS, default=int(current.get(CONF_RETENTION_HOURS, DEFAULT_RETENTION_HOURS))): vol.All(int, vol.Range(min=1, max=48)),
                vol.Optional(CONF_INCLUDE_DESTINATION, default=bool(current.get(CONF_INCLUDE_DESTINATION, DEFAULT_INCLUDE_DESTINATION))): bool,
            }
        )

        mode = (user_input or current).get(CONF_MODE, MODE_ENTITY)
        if mode == MODE_MANUAL:
            schema = schema.extend({vol.Required(CONF_TRACKING_CODE, default=current.get(CONF_TRACKING_CODE, "")): str})
        else:
            schema = schema.extend(
                {
                    vol.Required(
                        CONF_CODE_ENTITY,
                        default=current.get(CONF_CODE_ENTITY, ""),
                    ): selector.EntitySelector(
                        selector.EntitySelectorConfig(
                            multiple=False,
                            filter=[
                                selector.EntityFilterSelectorConfig(domain="input_text"),
                                selector.EntityFilterSelectorConfig(domain="sensor"),
                            ],
                        )
                    )
                }
            )

        return self.async_show_form(step_id="init", data_schema=schema, errors=errors)
