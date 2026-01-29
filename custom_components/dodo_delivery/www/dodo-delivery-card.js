/* dodo-delivery-card.js
 * Home Assistant Lovelace custom card
 * v0.2.4
 *
 * Fix: Leaflet pane z-index CSS so polylines render above tiles.
 * Supports route formats:
 *  - route: {sections:[{polyline:[{latitude,longitude}]}]}
 *  - route: [{polyline:[...]}]  (sections array)
 *  - polyline / route_polyline: point arrays
 */

(() => {
  const CARD_TAG = "dodo-delivery-card";
  const EDITOR_TAG = "dodo-delivery-card-editor";
  const DEFAULT_ENTITY = "sensor.dodo_delivery";

  const norm = (v) => String(v ?? "").trim().toLowerCase();
  const sanitizeCode = (v) => String(v ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();

  const getStatusCode = (attrs) => attrs?.status_code ?? attrs?.last_seen_status ?? attrs?.lastSeenStatus ?? "";
  const isFinished = (code) => norm(code) === "finished";

  const isNoActiveOrder = (state, attrs) => {
    const s = norm(state);
    if (s.includes("nincs aktív rendelés")) return true;
    if (attrs && typeof attrs.active === "boolean" && attrs.active === false) return true;
    return false;
  };

  const isPickupPhase = (codeRaw) => {
    const c = sanitizeCode(codeRaw);
    return c === "pickupstarted" || c.startsWith("pickupstarted");
  };

  const toNumber = (v) => {
    const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
    return Number.isFinite(n) ? n : null;
  };

  const coordsFromKeys = (attrs, latKey, lonKey) => {
    const lat = toNumber(attrs?.[latKey]);
    const lon = toNumber(attrs?.[lonKey]);
    if (lat == null || lon == null) return null;
    return { lat, lon };
  };

  const fmtTimeHHmm = (iso) => {
    if (typeof iso !== "string" || !iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const fmtDateTime = (iso) => {
    if (typeof iso !== "string" || !iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const yyyy = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}.${mo}.${da} ${hh}:${mm}`;
  };

  const PROGRESS_CODES = [
    ["pickupstarted"],
    ["pickupcompleted"],
    ["onway"],
    ["arrived", "neardestination"],
    ["finished"],
  ];
  const progressIndexFromCode = (codeRaw) => {
    const c = sanitizeCode(codeRaw);
    const idx = PROGRESS_CODES.findIndex((arr) => arr.includes(c));
    return idx >= 0 ? idx : 0;
  };

  // Minimal Leaflet CSS + REQUIRED z-index pane ordering (for polylines)
  const minimalLeafletCss = `
    .leaflet-container{position:relative;overflow:hidden;outline:0;touch-action:pan-x pan-y;background:#ddd;}
    .leaflet-pane,.leaflet-tile,.leaflet-marker-icon,.leaflet-marker-shadow,.leaflet-tile-container,.leaflet-map-pane svg,.leaflet-map-pane canvas{position:absolute;left:0;top:0}
    .leaflet-tile-container{pointer-events:none;}
    .leaflet-tile{visibility:hidden;}
    .leaflet-tile-loaded{visibility:inherit;}
    .leaflet-overlay-pane svg{max-width:none!important;max-height:none!important;}

    /* Pane z-index ordering (critical for overlays) */
    .leaflet-map-pane{z-index:400;}
    .leaflet-tile-pane{z-index:200;}
    .leaflet-overlay-pane{z-index:400;}
    .leaflet-shadow-pane{z-index:500;}
    .leaflet-marker-pane{z-index:600;}
    .leaflet-tooltip-pane{z-index:650;}
    .leaflet-popup-pane{z-index:700;}

    .leaflet-marker-icon,.leaflet-marker-shadow{display:block;}
    .leaflet-control{position:relative;z-index:800;pointer-events:auto;}
    .leaflet-top,.leaflet-bottom{position:absolute;z-index:50;pointer-events:none;}
    .leaflet-top{top:0;}
    .leaflet-bottom{bottom:0;}
    .leaflet-left{left:0;}
    .leaflet-right{right:0;}
    .leaflet-top .leaflet-control{margin-top:10px;}
    .leaflet-left .leaflet-control{margin-left:10px;}
    .leaflet-bar{box-shadow:0 1px 5px rgba(0,0,0,0.65);border-radius:4px;}
    .leaflet-bar a{background-color:#fff;border-bottom:1px solid #ccc;width:26px;height:26px;line-height:26px;display:block;text-align:center;text-decoration:none;color:#000;}
    .leaflet-bar a:last-child{border-bottom:none;border-bottom-left-radius:4px;border-bottom-right-radius:4px;}
    .leaflet-bar a:first-child{border-top-left-radius:4px;border-top-right-radius:4px;}
    .leaflet-control-zoom-in,.leaflet-control-zoom-out{font: bold 18px 'Lucida Console', Monaco, monospace;}
    .leaflet-div-icon{background:transparent;border:none;}
  `;

  const maybeJsonParse = (raw) => {
    if (typeof raw !== "string") return raw;
    const s = raw.trim();
    if (!s) return raw;
    if (!(s.startsWith("{") || s.startsWith("["))) return raw;
    try { return JSON.parse(s); } catch (_) { return raw; }
  };

  const normalizePointArray = (raw) => {
    raw = maybeJsonParse(raw);
    if (!Array.isArray(raw) || raw.length < 2) return null;
    const out = [];
    for (const p of raw) {
      if (Array.isArray(p) && p.length >= 2) {
        const lat = toNumber(p[0]);
        const lon = toNumber(p[1]);
        if (lat != null && lon != null) out.push([lat, lon]);
      } else if (p && typeof p === "object") {
        const lat = toNumber(p.latitude ?? p.lat);
        const lon = toNumber(p.longitude ?? p.lon ?? p.lng);
        if (lat != null && lon != null) out.push([lat, lon]);
      }
    }
    return out.length >= 2 ? out : null;
  };

  const normalizeRoute = (raw) => {
    raw = maybeJsonParse(raw);
    if (!raw) return null;

    if (typeof raw === "object" && !Array.isArray(raw) && Array.isArray(raw.sections)) {
      const pts = [];
      for (const sec of raw.sections) if (Array.isArray(sec?.polyline)) pts.push(...sec.polyline);
      return normalizePointArray(pts);
    }

    if (Array.isArray(raw) && raw.length) {
      const looksLikeSections = raw.some((x) => x && typeof x === "object" && Array.isArray(x.polyline));
      if (looksLikeSections) {
        const pts = [];
        for (const sec of raw) if (Array.isArray(sec?.polyline)) pts.push(...sec.polyline);
        return normalizePointArray(pts);
      }
    }

    return normalizePointArray(raw);
  };

  const pickRouteFromAttrs = (attrs) => {
    const a = attrs || {};
    return normalizePointArray(a.route_polyline) || normalizePointArray(a.polyline) || normalizeRoute(a.route) || null;
  };

  const safeColor = (host, cssVar, fallback) => {
    try {
      const v = getComputedStyle(host).getPropertyValue(cssVar).trim();
      return v || fallback;
    } catch (_) {
      return fallback;
    }
  };

  class DodoDeliveryCardEditor extends HTMLElement {
    set hass(hass) { this._hass = hass; if (this._picker) this._picker.hass = hass; }
    setConfig(config) {
      this._config = { ...config };
      if (!this._config.entity) this._config.entity = DEFAULT_ENTITY;
      this._ensureDom();
      this._syncPicker();
    }
    connectedCallback() { this._ensureDom(); this._syncPicker(); }
    _ensureDom() {
      if (this.shadowRoot) return;
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `
        <style>.wrap{ padding: 8px 0; }</style>
        <div class="wrap"><ha-entity-picker id="picker"></ha-entity-picker></div>`;
      this._picker = this.shadowRoot.getElementById("picker");
      this._picker.includeDomains = ["sensor"];
      this._picker.label = "Entity";
      this._picker.addEventListener("value-changed", (ev) => {
        const value = ev?.target?.value;
        const newConfig = { ...this._config, entity: value };
        this._config = newConfig;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: newConfig } }));
      });
    }
    _syncPicker() {
      if (!this._picker) return;
      if (this._hass) this._picker.hass = this._hass;
      const entity = this._config?.entity || DEFAULT_ENTITY;
      if (this._picker.value !== entity) this._picker.value = entity;
    }
  }

  class DodoDeliveryCard extends HTMLElement {
    static getConfigElement() { return document.createElement(EDITOR_TAG); }
    static getStubConfig() { return { type: `custom:${CARD_TAG}`, entity: DEFAULT_ENTITY }; }

    setConfig(config) {
      if (!config || !config.entity) throw new Error("entity is required");
      this._config = { type: `custom:${CARD_TAG}`, entity: config.entity || DEFAULT_ENTITY };
      this._ensureDom();
      this._update(true);
    }
    set hass(hass) { this._hass = hass; this._ensureDom(); this._update(false); }
    connectedCallback() { this._ensureDom(); this._update(true); }
    _entity() { return this._hass?.states?.[this._config?.entity || DEFAULT_ENTITY]; }

    _ensureDom() {
      if (this.shadowRoot) return;
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `
        <style>
          :host { display:block; }
          .wrap { padding: 14px; display:grid; gap:12px; }
          .placeholder { text-align:center; opacity:0.85; padding:22px 14px; }
          .phIcon { font-size:36px; line-height:36px; margin-bottom:6px; opacity:0.5; }
          .phTitle { font-size:16px; font-weight:700; margin-bottom:4px; }
          .phSub { font-size:13px; opacity:0.75; }

          .etaBlock { display:grid; justify-items:center; gap:6px; }
          .eta { font-size:40px; font-weight:800; letter-spacing:0.4px; line-height:1; }
          .slot { font-size:13px; opacity:0.75; text-align:center; }

          .mapBlock { border-radius:14px; overflow:hidden; border:1px solid var(--divider-color); min-height:210px; position:relative; }
          #leafletMap { height:230px; width:100%; }
          .mapPlaceholder { padding:18px; opacity:0.7; }
          .mapWarn { padding:18px; opacity:0.75; }

          .progress { display:grid; grid-auto-flow:column; gap:10px; justify-content:center; align-items:center; padding:2px 0 4px; }
          .dot { width:10px; height:10px; border-radius:999px; background:var(--disabled-text-color); opacity:0.45; }
          .dot.on { background:var(--primary-color); opacity:1; }

          .status { border:1px solid var(--divider-color); border-radius:14px; padding:12px; font-weight:650; }

          .meta { display:grid; gap:8px; }
          .row { display:grid; grid-template-columns:80px 1fr; gap:10px; align-items:center; opacity:0.95; }
          .lbl { font-size:12px; opacity:0.7; text-transform:uppercase; letter-spacing:0.4px; }
          .val { font-size:14px; font-weight:650; }
          .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }

          .finished { text-align:center; padding:22px 14px; gap:10px; }
          .check { font-size:44px; font-weight:900; line-height:1; color:var(--success-color, var(--primary-color)); }
          .finTitle { font-size:16px; font-weight:800; }
          .finTime { font-size:28px; font-weight:900; letter-spacing:0.3px; }
          .finAgent { font-size:13px; opacity:0.75; }

          .dodoMarker{width:14px;height:14px;border-radius:999px;border:2px solid rgba(255,255,255,0.95);box-shadow:0 4px 10px rgba(0,0,0,0.25);}
          .dodoMarker.pickup{background: var(--warning-color, #f6a00c);}
          .dodoMarker.drop{background: var(--success-color, #2ecc71);}
          .dodoMarker.agent{background: var(--info-color, #3498db);}
          .leaflet-div-icon{background:transparent;border:none;}
        </style>
        <style id="leafletCss">${minimalLeafletCss}</style>
        <ha-card><div id="root"></div></ha-card>
      `;
      this._root = this.shadowRoot.getElementById("root");
    }

    _renderPlaceholder(title, sub) {
      this._root.innerHTML = `<div class="wrap placeholder"><div class="phIcon">—</div><div class="phTitle">${title}</div>${sub ? `<div class="phSub">${sub}</div>` : ""}</div>`;
      this._destroyLeaflet();
    }

    _renderFinished(attrs) {
      const finishedTxt = fmtDateTime(attrs.finished) || "—";
      const agent = String(attrs.agent_name ?? "").trim();
      this._root.innerHTML = `<div class="wrap finished"><div class="check">✓</div><div class="finTitle">A megrendelését sikeresen kézbesítettük</div><div class="finTime">${finishedTxt}</div>${agent ? `<div class="finAgent">Futár: ${agent}</div>` : ""}</div>`;
      this._destroyLeaflet();
    }

    _renderActive(e, attrs) {
      const codeRaw = getStatusCode(attrs);
      const statusHu = String(attrs.status_hu ?? e.state ?? "");
      const eta = fmtTimeHHmm(attrs.expectedStart) || "—";
      const rStart = fmtTimeHHmm(attrs.requiredStart);
      const rEnd = fmtTimeHHmm(attrs.requiredEnd);
      const slot = rStart && rEnd ? `Lefoglalt idősáv: ${rStart} – ${rEnd}` : "";

      const agentName = String(attrs.agent_name ?? "").trim();
      const shortCode = String(attrs.short_code ?? "").trim();
      const progIdx = progressIndexFromCode(codeRaw);
      const dots = Array.from({ length: 5 }).map((_, i) => `<div class="dot ${i <= progIdx ? "on" : ""}"></div>`).join("");

      this._root.innerHTML = `
        <div class="wrap active">
          <div class="etaBlock">
            <div class="eta" id="eta">${eta}</div>
            ${slot ? `<div class="slot" id="slot">${slot}</div>` : `<div class="slot" id="slot" style="display:none"></div>`}
          </div>
          <div class="mapBlock">
            <div id="leafletMap"></div>
            <div id="mapOverlay" class="mapPlaceholder" style="display:none"></div>
          </div>
          <div class="progress">${dots}</div>
          <div class="status" id="status">${statusHu}</div>
          <div class="meta">
            <div class="row"><div class="lbl">Futár</div><div class="val" id="agentName">${agentName || "—"}</div></div>
            <div class="row"><div class="lbl">Rendelés</div><div class="val mono" id="short">${shortCode || "—"}</div></div>
          </div>
        </div>`;

      this._ensureLeaflet();
      this._updateLeaflet(codeRaw, attrs, true);
    }

    _ensureLeaflet() {
      if (this._leafletReady) return;
      const L = window.L;
      const mapEl = this.shadowRoot.getElementById("leafletMap");
      const overlay = this.shadowRoot.getElementById("mapOverlay");
      if (!mapEl) return;

      if (!L) {
        if (overlay) {
          overlay.className = "mapWarn";
          overlay.style.display = "block";
          overlay.textContent = "A térkép komponens (Leaflet) nem érhető el a felületen.";
        }
        return;
      }

      this._pickupIcon = L.divIcon({ className: "leaflet-div-icon", html: `<div class="dodoMarker pickup"></div>`, iconSize: [14,14], iconAnchor:[7,7] });
      this._dropIcon   = L.divIcon({ className: "leaflet-div-icon", html: `<div class="dodoMarker drop"></div>`,   iconSize: [14,14], iconAnchor:[7,7] });
      this._agentIcon  = L.divIcon({ className: "leaflet-div-icon", html: `<div class="dodoMarker agent"></div>`,  iconSize: [14,14], iconAnchor:[7,7] });

      this._map = L.map(mapEl, { zoomControl:true, attributionControl:true, dragging:true, scrollWheelZoom:false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom:19, attribution:'&copy; OpenStreetMap contributors' }).addTo(this._map);

      this._pickupMarker = null;
      this._dropMarker = null;
      this._agentMarker = null;
      this._routeLine = null;

      this._userInteracted = false;
      this._map.on("dragstart", () => (this._userInteracted = true));
      this._map.on("zoomstart", () => (this._userInteracted = true));

      this._resizeObserver = new ResizeObserver(() => {
        try { this._map && this._map.invalidateSize(true); } catch (_) {}
      });
      this._resizeObserver.observe(mapEl);

      this._leafletReady = true;
    }

    _destroyLeaflet() {
      try { this._resizeObserver?.disconnect(); } catch (_) {}
      this._resizeObserver = null;
      try { this._map?.remove(); } catch (_) {}
      this._map = null;
      this._leafletReady = false;
      this._pickupMarker = this._dropMarker = this._agentMarker = this._routeLine = null;
      this._lastMapKey = null;
      this._userInteracted = false;
    }

    _computeMapKey(codeRaw, attrs) {
      const pu = coordsFromKeys(attrs, "pickup_latitude", "pickup_longitude");
      const dr = coordsFromKeys(attrs, "drop_latitude", "drop_longitude");
      const ag = coordsFromKeys(attrs, "agent_latitude", "agent_longitude");
      const route = pickRouteFromAttrs(attrs);
      const routeKey = route ? `${route.length}:${route[0][0].toFixed(5)},${route[0][1].toFixed(5)}:${route[route.length-1][0].toFixed(5)},${route[route.length-1][1].toFixed(5)}` : "-";
      return [sanitizeCode(codeRaw), pu?`${pu.lat.toFixed(6)},${pu.lon.toFixed(6)}`:"-", dr?`${dr.lat.toFixed(6)},${dr.lon.toFixed(6)}`:"-", ag?`${ag.lat.toFixed(6)},${ag.lon.toFixed(6)}`:"-", routeKey].join("|");
    }

    _updateLeaflet(codeRaw, attrs, forceFit) {
      const L = window.L;
      const overlay = this.shadowRoot.getElementById("mapOverlay");
      if (!L || !this._map) return;

      const pu = coordsFromKeys(attrs, "pickup_latitude", "pickup_longitude");
      const dr = coordsFromKeys(attrs, "drop_latitude", "drop_longitude");
      const ag = coordsFromKeys(attrs, "agent_latitude", "agent_longitude");
      const route = pickRouteFromAttrs(attrs);

      if (!pu && !dr && !route) {
        if (overlay) {
          overlay.className = "mapPlaceholder";
          overlay.style.display = "block";
          overlay.textContent = "Térkép adat nem érhető el";
        }
        return;
      } else if (overlay) {
        overlay.style.display = "none";
      }

      if (pu) {
        if (!this._pickupMarker) this._pickupMarker = L.marker([pu.lat, pu.lon], { icon: this._pickupIcon }).addTo(this._map);
        else this._pickupMarker.setLatLng([pu.lat, pu.lon]);
      }

      if (dr) {
        if (!this._dropMarker) this._dropMarker = L.marker([dr.lat, dr.lon], { icon: this._dropIcon }).addTo(this._map);
        else this._dropMarker.setLatLng([dr.lat, dr.lon]);
      }

      if (ag) {
        if (!this._agentMarker) this._agentMarker = L.marker([ag.lat, ag.lon], { icon: this._agentIcon }).addTo(this._map);
        else this._agentMarker.setLatLng([ag.lat, ag.lon]);
      }

      if (route) {
        const lineColor = safeColor(this, "--primary-color", "#ffeb3b"); // brighter fallback
        if (!this._routeLine) {
          this._routeLine = L.polyline(route, {
            pane: "overlayPane",
            color: lineColor,
            weight: 5,
            opacity: 0.95,
            lineJoin: "round",
            lineCap: "round",
          }).addTo(this._map);
        } else {
          this._routeLine.setLatLngs(route);
        }
      } else if (this._routeLine) {
        this._map.removeLayer(this._routeLine);
        this._routeLine = null;
      }

      const mapKey = this._computeMapKey(codeRaw, attrs);
      const keyChanged = mapKey !== this._lastMapKey;
      if (keyChanged) { this._userInteracted = false; this._lastMapKey = mapKey; }
      const shouldFit = forceFit || (keyChanged && !this._userInteracted);
      if (!shouldFit) return;

      try {
        if (route && this._routeLine) {
          this._map.fitBounds(this._routeLine.getBounds(), { padding: isPickupPhase(codeRaw) ? [40,60] : [40,40], maxZoom: 16 });
        } else {
          const pts = [];
          if (pu) pts.push([pu.lat, pu.lon]);
          if (dr) pts.push([dr.lat, dr.lon]);
          if (ag) pts.push([ag.lat, ag.lon]);
          if (pts.length >= 2) this._map.fitBounds(L.latLngBounds(pts), { padding: isPickupPhase(codeRaw) ? [40,60] : [40,40], maxZoom: 16 });
          else if (pts.length === 1) this._map.setView(pts[0], 15);
        }
        this._map.invalidateSize(true);
      } catch (_) {}
    }

    _update(forceRender) {
      if (!this._root) return;
      const e = this._entity();
      const eid = this._config?.entity || DEFAULT_ENTITY;

      if (!this._hass) return this._renderPlaceholder("Betöltés…", "");
      if (!e) return this._renderPlaceholder("Entity nem található", eid);

      const attrs = e.attributes || {};
      const codeRaw = getStatusCode(attrs);

      if (isNoActiveOrder(e.state, attrs)) return this._renderPlaceholder("Nincs aktív rendelés", "Ha elindul a kiszállítás, itt megjelenik a státusz.");
      if (isFinished(codeRaw)) return this._renderFinished(attrs);

      const hasMap = !!this.shadowRoot.getElementById("leafletMap");
      if (!hasMap || forceRender) return this._renderActive(e, attrs);

      // Update text
      const etaEl = this.shadowRoot.getElementById("eta");
      const slotEl = this.shadowRoot.getElementById("slot");
      const statusEl = this.shadowRoot.getElementById("status");
      const agentNameEl = this.shadowRoot.getElementById("agentName");
      const shortEl = this.shadowRoot.getElementById("short");

      const eta = fmtTimeHHmm(attrs.expectedStart) || "—";
      if (etaEl) etaEl.textContent = eta;

      const rStart = fmtTimeHHmm(attrs.requiredStart);
      const rEnd = fmtTimeHHmm(attrs.requiredEnd);
      if (slotEl) {
        if (rStart && rEnd) { slotEl.style.display = "block"; slotEl.textContent = `Lefoglalt idősáv: ${rStart} – ${rEnd}`; }
        else slotEl.style.display = "none";
      }

      const statusHu = String(attrs.status_hu ?? e.state ?? "");
      if (statusEl) statusEl.textContent = statusHu;

      const agentName = String(attrs.agent_name ?? "").trim();
      if (agentNameEl) agentNameEl.textContent = agentName || "—";

      const shortCode = String(attrs.short_code ?? "").trim();
      if (shortEl) shortEl.textContent = shortCode || "—";

      const progIdx = progressIndexFromCode(codeRaw);
      if (this._lastProgIdx !== progIdx) {
        this._lastProgIdx = progIdx;
        const prog = this.shadowRoot.querySelector(".progress");
        if (prog) prog.innerHTML = Array.from({ length: 5 }).map((_, i) => `<div class="dot ${i <= progIdx ? "on" : ""}"></div>`).join("");
      }

      this._ensureLeaflet();
      this._updateLeaflet(codeRaw, attrs, false);
    }
  }

  if (!customElements.get(EDITOR_TAG)) customElements.define(EDITOR_TAG, DodoDeliveryCardEditor);
  if (!customElements.get(CARD_TAG)) customElements.define(CARD_TAG, DodoDeliveryCard);

  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === CARD_TAG)) {
    window.customCards.push({ type: CARD_TAG, name: "DODO Delivery Card", description: "DODO kiszállítás státusz kártya (ETA, Leaflet térkép + polyline, progress, futár, short code)." });
  }
})();
