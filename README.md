# DODO Delivery (Tesco) – Home Assistant custom integration (v1.0.0)

This is a local-only test package. It creates **one sensor entity** with rich attributes,
and can read the tracking code either from:
- Manual tracking code
- An entity (e.g., `input_text.dodo_tracking_code`), where the state contains the 8-char code or an `https://t.idodo.group/XXXXXXXX` link.

## Install (manual)
1. Copy `custom_components/dodo_delivery` into your HA config folder:
   - `<config>/custom_components/dodo_delivery/`
2. Restart Home Assistant.
3. Settings → Devices & services → Add integration → **DODO Delivery (Tesco)**

## Options
- Mode: `entity` or `manual`
- Poll interval (sec): default 20
- Retention after Finished (hours): default 12
- Include destination coordinates: default OFF

## Notes
- API used: `https://api.gaia.delivery/order-tracking/orders/<CODE>/detail`
- This integration is intended for personal use / testing.



## HACS installation

This repository is structured for HACS as a **custom repository**.

1. HACS → **Integrations** → ⋮ → **Custom repositories**
2. Add: `tomorigabor/ha-dodo-delivery` with category **Integration**
3. Install **DODO Delivery (Tesco.hu)**, then restart Home Assistant.

## Lovelace card (bundled)

The card is included in this repo at:

- `/dodo_delivery/dodo-delivery-card.js` (served by the integration)

Add it as a Lovelace resource:

- Settings → Dashboards → Resources → **Add resource**
  - URL: `/dodo_delivery/dodo-delivery-card.js`
  - Type: **JavaScript Module**

Then add the card:

```yaml
type: custom:dodo-delivery-card
entity: sensor.dodo_delivery
```
