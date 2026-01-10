DOMAIN = "dodo_delivery"

CONF_MODE = "mode"
MODE_MANUAL = "manual"
MODE_ENTITY = "entity"

CONF_TRACKING_CODE = "tracking_code"
CONF_CODE_ENTITY = "code_entity"

CONF_POLL_INTERVAL = "poll_interval"
CONF_RETENTION_HOURS = "retention_hours"
CONF_INCLUDE_DESTINATION = "include_destination"

DEFAULT_POLL_INTERVAL = 20  # seconds
DEFAULT_RETENTION_HOURS = 12
DEFAULT_INCLUDE_DESTINATION = False

API_BASE = "https://api.gaia.delivery"
DETAIL_PATH = "/order-tracking/orders/{code}/detail"

ATTR_TRACKING_CODE = "tracking_code"
ATTR_ACTIVE = "active"
ATTR_REASON = "reason"
ATTR_LAST_UPDATE = "last_update"
ATTR_LAST_SEEN_STATUS = "last_seen_status"
