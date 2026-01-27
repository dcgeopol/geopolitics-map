/* =========================================================
   GeoTracker app.js (clean working rebuild)
   - Draw toolbar (Leaflet.draw): shapes/lines/markers + edit/remove
   - Free draw
   - Select object (click)
   - Style panel applies to selected
   - Custom Move/Resize/Rotate via handles (Move button)
   - Undo/Redo (full snapshots)
   - Intel panel wiring (feed + notes) using localStorage
   ========================================================= */

(() => {
  "use strict";

  /* ---------------------------
     Helpers
  --------------------------- */
  const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

  function safeJSONParse(str, fallback) {
    try { return JSON.parse(str); } catch { return fallback; }
  }

  // Fix default Leaflet marker icons on GitHub Pages
  if (window.L && L.Icon && L.Icon.Default) {
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
      iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
      shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    });
  }

  /* ---------------------------
     Map
  --------------------------- */
  const map = L.map("map", {
    minZoom: 2,
    zoomSnap: 0.25,
    zoomDelta: 0.25,
  }).setView([20, 0], 2);

  // Cylinder-ish behavior (wrap lng, clamp lat)
  map.on("moveend", () => {
    const c = map.getCenter();
    const lat = Math.max(-85, Math.min(85, c.lat));
    let lng = c.lng;
    while (lng > 180) lng -= 360;
    while (lng < -180) lng += 360;
    if (lat !== c.lat || lng !== c.lng) map.panTo([lat, lng], { animate: false });
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap",
  }).addTo(map);

  // Fix weird render gaps when panels resize
  function fixMapSizeHard() {
    map.invalidateSize(true);
    setTimeout(() => map.invalidateSize(true), 80);
    setTimeout(() => map.invalidateSize(true), 240);
    setTimeout(() => map.invalidateSize(true), 600);
  }
  window.addEventListener("load", fixMapSizeHard);
  window.addEventListener("resize", fixMapSizeHard);
  setTimeout(fixMapSizeHard, 0);



map.on("click", (e) => {
  if (!pickingPoint) return;

  pickingPoint = false;
  pickedPoint = e.latlng;

  if (pickedPointPreview) pickedPointPreview.remove();
  pickedPointPreview = L.circleMarker(pickedPoint, { radius: 6, weight: 2, fillOpacity: 0.8 }).addTo(map);

  setPickedPointStatus();
});


  /* ---------------------------
     DOM
  --------------------------- */
  const stylePanel = document.getElementById("stylePanel");
  const toggleStyleBtn = document.getElementById("toggleStyle");
  const undoBtn = document.getElementById("undoBtn");
  const redoBtn = document.getElementById("redoBtn");
  const freeDrawBtn = document.getElementById("freeDrawBtn");
  const moveBtn = document.getElementById("moveBtn");

  const strokeColor = document.getElementById("strokeColor");
  const strokeWidth = document.getElementById("strokeWidth");
  const strokeOpacity = document.getElementById("strokeOpacity");
  const useFill = document.getElementById("useFill");
  const fillColor = document.getElementById("fillColor");
  const fillOpacity = document.getElementById("fillOpacity");

  // Move the style panel so it DOESN’T fight the intel panel (right side)
  // and DOESN’T cover your buttons.
  if (stylePanel) {
    stylePanel.style.top = "90px";
    stylePanel.style.left = "260px";
    stylePanel.style.right = "auto";
   stylePanel.style.maxWidth = "calc(100vw - var(--panelW) - 30px)"; // match index.html panel width

    stylePanel.style.zIndex = "860";
  }

  // Style panel toggle
  if (toggleStyleBtn && stylePanel) {
    toggleStyleBtn.onclick = () => {
      stylePanel.style.display =
        (stylePanel.style.display === "none" || !stylePanel.style.display) ? "flex" : "none";
      fixMapSizeHard();
    };
  }

  /* ---------------------------
     Marker label CSS
  --------------------------- */
  (function injectLabelCSS() {
    const css = `
      .marker-label{
        background: rgba(255,255,255,0.9);
        border: 1px solid rgba(0,0,0,0.25);
        border-radius: 8px;
        padding: 2px 6px;
        font-size: 12px;
        font-weight: 700;
        color: #111;
        box-shadow: 0 1px 4px rgba(0,0,0,0.2);
        white-space: nowrap;
        pointer-events: none;
      }
    `;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  })();

  /* ---------------------------
     Style helpers
  --------------------------- */
  function currentStyle() {
    return {
      color: strokeColor?.value ?? "#ff0000",
      weight: +(strokeWidth?.value ?? 4),
      opacity: +(strokeOpacity?.value ?? 0.9),
      fill: !!(useFill?.checked),
      fillColor: fillColor?.value ?? "#ff0000",
      fillOpacity: +(fillOpacity?.value ?? 0.25),
    };
  }

  function makePinIcon(color, opacity) {
    const fill = color || "#ff0000";
    const op = (opacity == null || Number.isNaN(opacity)) ? 1 : opacity;

    const svg = encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="44" viewBox="0 0 32 44">
        <path d="M16 44s14-16.1 14-26C30 8.1 23.7 2 16 2S2 8.1 2 18c0 9.9 14 26 14 26z"
          fill="${fill}" fill-opacity="${op}" stroke="#000" stroke-opacity="0.25" stroke-width="1"/>
        <circle cx="16" cy="18" r="6" fill="#fff" fill-opacity="0.85"/>
      </svg>
    `);

    return L.icon({
      iconUrl: `data:image/svg+xml,${svg}`,
      iconSize: [32, 44],
      iconAnchor: [16, 44],
      popupAnchor: [0, -40],
    });
  }
function setMarkerLabel(marker, text) {
  marker.__label = (text || "").trim();
  if (!marker.__label) {
    marker.unbindPopup();
    return;
  }
  marker.bindPopup(marker.__label, { closeButton: true, autoClose: true, closeOnClick: true });
}


  function applyStyle(layer) {
    if (!layer) return;

    // Marker recolor
    if (layer instanceof L.Marker && !(layer instanceof L.CircleMarker)) {
      const c = strokeColor?.value ?? "#ff0000";
      const op = +(strokeOpacity?.value ?? 1);
      layer.__markerColor = c;
      layer.__markerOpacity = op;
      layer.setIcon(makePinIcon(c, op));
      return;
    }

    if (layer.setStyle) layer.setStyle(currentStyle());
  }

  function loadStyleControlsFromLayer(layer) {
    if (!layer) return;

    if (layer instanceof L.Marker && !(layer instanceof L.CircleMarker)) {
      if (strokeColor) strokeColor.value = layer.__markerColor || (strokeColor.value != null ? strokeColor.value : "#ff0000");
if (strokeOpacity) strokeOpacity.value = (layer.__markerOpacity != null ? layer.__markerOpacity : (strokeOpacity.value != null ? strokeOpacity.value : 1));

      return;
    }

    const o = layer.options || {};
    if (strokeColor && o.color) strokeColor.value = o.color;
    if (strokeWidth && typeof o.weight === "number") strokeWidth.value = String(o.weight);
    if (strokeOpacity && typeof o.opacity === "number") strokeOpacity.value = String(o.opacity);

    if (useFill) useFill.checked = !!o.fill;
    if (fillColor && o.fillColor) fillColor.value = o.fillColor;
    if (fillOpacity && typeof o.fillOpacity === "number") fillOpacity.value = String(o.fillOpacity);
  }

  /* ---------------------------
     Draw layers (Leaflet.draw)
  --------------------------- */
  const drawnItems = new L.FeatureGroup().addTo(map);

function escapeHtml(s) {
  var out = String(s == null ? "" : s);
  out = out.replace(/&/g, "&amp;");
  out = out.replace(/</g, "&lt;");
  out = out.replace(/>/g, "&gt;");
  out = out.replace(/"/g, "&quot;");
  out = out.replace(/'/g, "&#39;");
  return out;
}




function refreshLinkedMarkerPopups() {
  const feed = (typeof getFeed === "function") ? getFeed() : [];
  if (!drawnItems) return;

  // group entries by linkedLayerId
  const byLayer = new Map();
  for (const it of feed) {
    if (!it || !it.linkedLayerId) continue;
    if (!byLayer.has(it.linkedLayerId)) byLayer.set(it.linkedLayerId, []);
    byLayer.get(it.linkedLayerId).push(it);
  }

  // sort each group newest first
  for (const [k, arr] of byLayer.entries()) {
    arr.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  }

  drawnItems.eachLayer((layer) => {
    if (!(layer instanceof L.Marker)) return;

    // make sure marker has an id
    if (!layer.__id && typeof uid === "function") layer.__id = uid();

    // remove any tooltip that might be forcing text to show
    if (layer.getTooltip && layer.getTooltip()) {
      layer.unbindTooltip();
    }

    const list = byLayer.get(layer.__id) || [];

    // If no linked entries, remove popup (optional)
    if (list.length === 0) {
      if (layer.getPopup && layer.getPopup()) layer.unbindPopup();
      return;
    }

    const html = `
      <div style="font-family:sans-serif; max-width:260px;">
        <div style="font-weight:900; font-size:14px; margin-bottom:6px;">
          ${escapeHtml(list[0].title || "(Untitled)")}
        </div>
        <div style="font-size:12px; opacity:0.75; margin-bottom:8px;">
          ${escapeHtml(list[0].date || "")} • ${escapeHtml(list[0].type || "")}
          ${list[0].country ? " • " + escapeHtml(list[0].country) : ""}
        </div>
        <div style="font-size:12px; white-space:pre-wrap;">
          ${escapeHtml(list[0].text || "")}
        </div>
        ${list.length > 1 ? `<div style="margin-top:8px; font-size:11px; opacity:0.65;">+ ${list.length - 1} more linked entries</div>` : ""}
      </div>
    `;

    // Click-only popup
    layer.bindPopup(html, { closeButton: true, autoClose: true, closeOnClick: true });
  });
}


  // IMPORTANT: edit/remove ON (this restores the edit tools)
  const drawControl = new L.Control.Draw({
    position: "topleft",
    edit: {
      featureGroup: drawnItems,
      edit: true,
      remove: true,
    },
    draw: {
      polyline: true,
      polygon: true,
      rectangle: true,
      circle: true,
      marker: true,
      circlemarker: false,
    },
  });
  map.addControl(drawControl);

  /* ---------------------------
     Selection
  --------------------------- */
  let selectedLayer = null;

  function selectLayer(layer) {
    selectedLayer = layer || null;
    if (selectedLayer) loadStyleControlsFromLayer(selectedLayer);
    // Keep transform handles synced
    if (moveEnabled) showTransformHandles();
    renderNotesPanel(); // notes tab update
  }

  function wireSelectable(layer) {
    layer.off("click");
    layer.on("click", (e) => {
      L.DomEvent.stopPropagation(e);
      selectLayer(layer);
    });

    // Double click marker to edit label
    if (layer instanceof L.Marker && !(layer instanceof L.CircleMarker)) {
      layer.off("dblclick");
      layer.on("dblclick", (e) => {
        L.DomEvent.stopPropagation(e);
        const next = prompt("Marker label:", layer.__label || "");
        if (next !== null) {
          setMarkerLabel(layer, next);
          pushHistory();
        }
      });
    }
  }

  map.on("click", () => selectLayer(null));

  /* ---------------------------
     Undo/Redo (full snapshots)
  --------------------------- */
  const history = [];
  let historyIndex = -1;

  function layerToSnapshot(layer) {
    // Ensure id
    if (!layer.__id) layer.__id = uid();

    // Rotation angle (for our transform system)
    const angle = typeof layer.__angleRad === "number" ? layer.__angleRad : 0;

    // Marker
    if (layer instanceof L.Marker && !(layer instanceof L.CircleMarker)) {
      const ll = layer.getLatLng();
      return {
        kind: "marker",
        id: layer.__id,
        lat: ll.lat,
        lng: ll.lng,
        markerColor: layer.__markerColor || "#ff0000",
        markerOpacity: (layer.__markerOpacity ?? 1),
        label: layer.__label || "",
        angle,
      };
    }

    // Circle
    if (layer instanceof L.Circle) {
      const ll = layer.getLatLng();
      return {
        kind: "circle",
        id: layer.__id,
        lat: ll.lat,
        lng: ll.lng,
        radius: layer.getRadius(),
        style: {
          color: layer.options.color,
          weight: layer.options.weight,
          opacity: layer.options.opacity,
          fill: layer.options.fill,
          fillColor: layer.options.fillColor,
          fillOpacity: layer.options.fillOpacity,
        },
        angle,
      };
    }

    // Polyline/Polygon/Rectangle/Freehand
    const gj = layer.toGeoJSON();
    return {
      kind: "geojson",
      id: layer.__id,
      geojson: gj,
      style: {
        color: layer.options.color,
        weight: layer.options.weight,
        opacity: layer.options.opacity,
        fill: layer.options.fill,
        fillColor: layer.options.fillColor,
        fillOpacity: layer.options.fillOpacity,
      },
      angle,
    };
  }

  function serializeState() {
    const items = [];
    drawnItems.eachLayer((layer) => items.push(layerToSnapshot(layer)));
    return { items };
  }

  function restoreState(state) {
    drawnItems.clearLayers();
    hideTransformHandles();
    selectedLayer = null;

    if (!state || !Array.isArray(state.items)) return;

    for (const it of state.items) {
      let layer = null;

      if (it.kind === "marker") {
        layer = L.marker([it.lat, it.lng], {
          icon: makePinIcon(it.markerColor, it.markerOpacity),
        });
        layer.__markerColor = it.markerColor;
        layer.__markerOpacity = it.markerOpacity;
        layer.__label = it.label || "";
        if (layer.__label) setMarkerLabel(layer, layer.__label);
      }

      if (it.kind === "circle") {
        layer = L.circle([it.lat, it.lng], {
          radius: it.radius,
          ...(it.style || {}),
        });
      }

      if (it.kind === "geojson") {
        const coll = L.geoJSON(it.geojson, {
          style: () => (it.style || {}),
        });
        // geoJSON returns a layergroup; we want the single child layer
        coll.eachLayer((child) => {
          layer = child;
        });
      }

      if (!layer) continue;

      layer.__id = it.id || uid();
      layer.__angleRad = it.angle || 0;

      drawnItems.addLayer(layer);
      wireSelectable(layer);
    }

    // after restore, keep map happy
    fixMapSizeHard();
  }

  function statesEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function pushHistory() {
    const snap = serializeState();

    // If we're in the middle (after undo), cut forward history
    history.splice(historyIndex + 1);

    // Deduplicate identical consecutive states
    if (history.length > 0 && statesEqual(history[history.length - 1], snap)) {
      historyIndex = history.length - 1;
      return;
    }

    history.push(snap);
    historyIndex = history.length - 1;

    // cap
    if (history.length > 220) {
      history.shift();
      historyIndex--;
    }
  }

  function undo() {
    if (historyIndex <= 0) return;
    historyIndex--;
    restoreState(history[historyIndex]);
  }

  function redo() {
    if (historyIndex >= history.length - 1) return;
    historyIndex++;
    restoreState(history[historyIndex]);
  }

  if (undoBtn) undoBtn.onclick = undo;
  if (redoBtn) redoBtn.onclick = redo;

  document.addEventListener("keydown", (e) => {
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (!mod) return;

    if (e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    }
    if (e.key.toLowerCase() === "z" && e.shiftKey) {
      e.preventDefault();
      redo();
    }
  });

  /* ---------------------------
     Record history on draw/edit/delete
  --------------------------- */
  map.on(L.Draw.Event.CREATED, (e) => {
    const layer = e.layer;

    // Default styling for new shapes
    if (layer instanceof L.Marker && !(layer instanceof L.CircleMarker)) {
      const c = strokeColor?.value ?? "#ff0000";
     const op = +(strokeOpacity && strokeOpacity.value != null ? strokeOpacity.value : 1);

      layer.__markerColor = c;
      layer.__markerOpacity = op;
      layer.setIcon(makePinIcon(c, op));
    } else if (layer.setStyle) {
      layer.setStyle(currentStyle());
    }

    layer.__id = uid();
    layer.__angleRad = 0;

    drawnItems.addLayer(layer);
    wireSelectable(layer);
    selectLayer(layer);

    pushHistory();
  });

  map.on(L.Draw.Event.EDITED, () => pushHistory());
  map.on(L.Draw.Event.DELETED, () => {
    // If selected layer got deleted, clear selection
    if (selectedLayer && !drawnItems.hasLayer(selectedLayer)) selectedLayer = null;
    hideTransformHandles();
    pushHistory();
    renderNotesPanel();
  });

  // Initial snapshot
  pushHistory();

  /* ---------------------------
     Style inputs apply to selected (and become undoable)
  --------------------------- */
  const styleInputs = [strokeColor, strokeWidth, strokeOpacity, useFill, fillColor, fillOpacity].filter(Boolean);

  let styleDebounce = null;
  function pushHistorySoon() {
    clearTimeout(styleDebounce);
    styleDebounce = setTimeout(() => pushHistory(), 80);
  }

  styleInputs.forEach((el) => {
    el.addEventListener("input", () => {
      if (!selectedLayer) return;
      applyStyle(selectedLayer);
      pushHistorySoon();
      if (moveEnabled) showTransformHandles();
    });
  });

  /* ---------------------------
     Free draw (simple but solid)
  --------------------------- */
  let freeDraw = false;
  let activeLine = null;
  let lastPt = null;
  const MIN_DIST = 10;

  if (freeDrawBtn) {
    freeDrawBtn.onclick = () => {
      freeDraw = !freeDraw;
      freeDrawBtn.textContent = freeDraw ? "Free Draw: ON" : "Free Draw";
      if (freeDraw) map.dragging.disable();
      else if (!moveEnabled) map.dragging.enable();
    };
  }

  map.on("mousedown touchstart", (e) => {
    if (!freeDraw) return;

    activeLine = L.polyline([e.latlng], currentStyle()).addTo(drawnItems);
    activeLine.__id = uid();
    activeLine.__angleRad = 0;

    wireSelectable(activeLine);
    selectLayer(activeLine);

    lastPt = map.latLngToLayerPoint(e.latlng);
  });

  map.on("mousemove touchmove", (e) => {
    if (!activeLine) return;

    const p = map.latLngToLayerPoint(e.latlng);
    if (!lastPt || p.distanceTo(lastPt) >= MIN_DIST) {
      activeLine.addLatLng(e.latlng);
      lastPt = p;
    }
  });

  map.on("mouseup touchend touchcancel", () => {
    if (!activeLine) return;
    activeLine = null;
    lastPt = null;
    pushHistory();
  });

  /* ---------------------------
     Custom transform handles (Move / Resize / Rotate)
     - Works on: marker, circle, polyline/polygon/freehand/rectangle
  --------------------------- */
  let moveEnabled = false;

  let transformGroup = null;
  let bbox = null;
  let hNW = null, hNE = null, hSE = null, hSW = null, hRotate = null;

  if (moveBtn) {
    moveBtn.onclick = () => {
      moveEnabled = !moveEnabled;
      moveBtn.textContent = moveEnabled ? "Move: ON" : "Move";
      if (moveEnabled) {
        if (!freeDraw) map.dragging.disable();
        showTransformHandles();
      } else {
        if (!freeDraw) map.dragging.enable();
        hideTransformHandles();
      }
    };
  }

  function hideTransformHandles() {
    if (transformGroup) {
      transformGroup.remove();
      transformGroup = null;
    }
    bbox = hNW = hNE = hSE = hSW = hRotate = null;
  }

  function layerBoundsLL(layer) {
    if (!layer) return null;
    if (layer instanceof L.Marker && !(layer instanceof L.CircleMarker)) {
      const ll = layer.getLatLng();
      return L.latLngBounds(ll, ll);
    }
    if (layer instanceof L.Circle) return layer.getBounds();
    if (layer.getBounds) return layer.getBounds();
    const latlngs = layer.getLatLngs().flat(Infinity);
    return L.latLngBounds(latlngs);
  }

  function layerCenterLL(layer) {
    if (!layer) return null;
    if (layer instanceof L.Marker && !(layer instanceof L.CircleMarker)) return layer.getLatLng();
    if (layer instanceof L.Circle) return layer.getLatLng();
    const latlngs = layer.getLatLngs().flat(Infinity);
    let lat = 0, lng = 0;
    latlngs.forEach((ll) => { lat += ll.lat; lng += ll.lng; });
    return L.latLng(lat / latlngs.length, lng / latlngs.length);
  }

  function showTransformHandles() {
    hideTransformHandles();
    if (!moveEnabled || !selectedLayer) return;

    transformGroup = L.layerGroup().addTo(map);

    const b = layerBoundsLL(selectedLayer);
    if (!b) return;

    const nw = b.getNorthWest();
    const ne = b.getNorthEast();
    const se = b.getSouthEast();
    const sw = b.getSouthWest();

    bbox = L.polygon([nw, ne, se, sw], {
      color: "#000",
      weight: 1,
      opacity: 0.6,
      fill: false,
      interactive: false,
    }).addTo(transformGroup);

    const handleStyle = {
      radius: 6,
      color: "#000",
      weight: 2,
      fill: true,
      fillOpacity: 1,
    };

    hNW = L.circleMarker(nw, handleStyle).addTo(transformGroup);
    hNE = L.circleMarker(ne, handleStyle).addTo(transformGroup);
    hSE = L.circleMarker(se, handleStyle).addTo(transformGroup);
    hSW = L.circleMarker(sw, handleStyle).addTo(transformGroup);

    // rotate handle above NE
    const rot = L.latLng(ne.lat + (b.getNorth() - b.getSouth()) * 0.15 + 1, ne.lng);
    hRotate = L.circleMarker(rot, { ...handleStyle, radius: 7 }).addTo(transformGroup);

    wireMoveOnTarget(selectedLayer);
    wireScaleHandle(hNW);
    wireScaleHandle(hNE);
    wireScaleHandle(hSE);
    wireScaleHandle(hSW);
    wireRotateHandle(hRotate);
  }

  function deepCloneLatLngs(lls) {
    if (Array.isArray(lls)) return lls.map(deepCloneLatLngs);
    return L.latLng(lls.lat, lls.lng);
  }

  function mapLatLngs(lls, fn) {
    if (Array.isArray(lls)) return lls.map((x) => mapLatLngs(x, fn));
    return fn(lls);
  }

  function rotatePoint(pt, rad) {
    const cos = Math.cos(rad), sin = Math.sin(rad);
    return L.point(pt.x * cos - pt.y * sin, pt.x * sin + pt.y * cos);
  }

  function translateLayer(layer, dx, dy, origin) {
    if (layer instanceof L.Marker && !(layer instanceof L.CircleMarker)) {
      const p = map.latLngToLayerPoint(origin).add([dx, dy]);
      layer.setLatLng(map.layerPointToLatLng(p));
      return;
    }

    if (layer instanceof L.Circle) {
      const p = map.latLngToLayerPoint(origin.center).add([dx, dy]);
      layer.setLatLng(map.layerPointToLatLng(p));
      return;
    }

    const newLLs = mapLatLngs(origin, (ll) => {
      const p = map.latLngToLayerPoint(ll).add([dx, dy]);
      return map.layerPointToLatLng(p);
    });
    layer.setLatLngs(newLLs);
  }

  function scaleLayer(layer, originLatLngs, centerLL, scale, baseAngleRad) {
    if (layer instanceof L.Marker && !(layer instanceof L.CircleMarker)) return;

    const c = map.latLngToLayerPoint(centerLL);

    function xform(ll) {
      const p = map.latLngToLayerPoint(ll);
      const v = p.subtract(c);
      const unrot = rotatePoint(v, -baseAngleRad);
      const scaled = L.point(unrot.x * scale, unrot.y * scale);
      const rerot = rotatePoint(scaled, baseAngleRad);
      return map.layerPointToLatLng(rerot.add(c));
    }

    if (layer instanceof L.Circle) {
      layer.setRadius(Math.max(2, originLatLngs.radius * scale));
      return;
    }

    const newLLs = mapLatLngs(originLatLngs, xform);
    layer.setLatLngs(newLLs);
  }

  function rotateLayer(layer, originLatLngs, centerLL, deltaRad, baseAngleRad) {
    if (layer instanceof L.Marker && !(layer instanceof L.CircleMarker)) return;

    const c = map.latLngToLayerPoint(centerLL);

    function xform(ll) {
      const p = map.latLngToLayerPoint(ll);
      const v = p.subtract(c);
      const unrot = rotatePoint(v, -baseAngleRad);
      const rerot = rotatePoint(unrot, deltaRad);
      const back = rotatePoint(rerot, baseAngleRad);
      return map.layerPointToLatLng(back.add(c));
    }

    if (layer instanceof L.Circle) return; // rotating circle doesn't matter

    const newLLs = mapLatLngs(originLatLngs, xform);
    layer.setLatLngs(newLLs);

    layer.__angleRad = (layer.__angleRad || 0) + deltaRad;
  }

  function wireMoveOnTarget(layer) {
    if (!layer) return;

    layer.off("mousedown");
    layer.on("mousedown", (e) => {
      if (!moveEnabled || !selectedLayer) return;

      // Don’t start move if Leaflet.draw edit mode is active on map
      // (we keep this simple: move button toggles dragging off anyway)
      L.DomEvent.stopPropagation(e);

      pushHistory(); // allow undo back to previous position

      const start = map.latLngToLayerPoint(e.latlng);

      const origin = (() => {
        if (selectedLayer instanceof L.Marker && !(selectedLayer instanceof L.CircleMarker)) {
          return selectedLayer.getLatLng();
        }
        if (selectedLayer instanceof L.Circle) {
          return { center: selectedLayer.getLatLng(), radius: selectedLayer.getRadius() };
        }
        return deepCloneLatLngs(selectedLayer.getLatLngs());
      })();

      function onMove(ev) {
        const p = map.latLngToLayerPoint(ev.latlng);
        const dx = p.x - start.x;
        const dy = p.y - start.y;
        translateLayer(selectedLayer, dx, dy, origin);
        showTransformHandles();
      }

      function onUp() {
        map.off("mousemove", onMove);
        map.off("mouseup", onUp);
        pushHistory();
      }

      map.on("mousemove", onMove);
      map.on("mouseup", onUp);
    });
  }

  function wireScaleHandle(handle) {
    if (!handle) return;

    handle.off("mousedown");
    handle.on("mousedown", (e) => {
      if (!moveEnabled || !selectedLayer) return;
      L.DomEvent.stopPropagation(e);

      pushHistory();

      const centerLL = layerCenterLL(selectedLayer);

      const baseAngle = selectedLayer.__angleRad || 0;

      const origin = (() => {
        if (selectedLayer instanceof L.Circle) {
          return { center: selectedLayer.getLatLng(), radius: selectedLayer.getRadius() };
        }
        return deepCloneLatLngs(
          (selectedLayer instanceof L.Marker && !(selectedLayer instanceof L.CircleMarker))
            ? [selectedLayer.getLatLng()]
            : selectedLayer.getLatLngs()
        );
      })();

      const c = map.latLngToLayerPoint(centerLL);
      const start = map.latLngToLayerPoint(e.latlng);
      const startDist = Math.max(1, start.distanceTo(c));

      function onMove(ev) {
        const p = map.latLngToLayerPoint(ev.latlng);
        const dist = Math.max(1, p.distanceTo(c));
        const scale = dist / startDist;

        if (selectedLayer instanceof L.Circle) {
          scaleLayer(selectedLayer, origin, centerLL, scale, baseAngle);
        } else if (!(selectedLayer instanceof L.Marker)) {
          scaleLayer(selectedLayer, origin, centerLL, scale, baseAngle);
        }

        showTransformHandles();
      }

      function onUp() {
        map.off("mousemove", onMove);
        map.off("mouseup", onUp);
        pushHistory();
      }

      map.on("mousemove", onMove);
      map.on("mouseup", onUp);
    });
  }

  function wireRotateHandle(handle) {
    if (!handle) return;

    handle.off("mousedown");
    handle.on("mousedown", (e) => {
      if (!moveEnabled || !selectedLayer) return;
      L.DomEvent.stopPropagation(e);

      pushHistory();

      const centerLL = layerCenterLL(selectedLayer);
      const c = map.latLngToLayerPoint(centerLL);

      const baseAngle = selectedLayer.__angleRad || 0;

      const origin = deepCloneLatLngs(selectedLayer.getLatLngs ? selectedLayer.getLatLngs() : []);

      const start = map.latLngToLayerPoint(e.latlng);
      const startAng = Math.atan2(start.y - c.y, start.x - c.x);

      function onMove(ev) {
        if (!selectedLayer || !selectedLayer.getLatLngs) return;

        const p = map.latLngToLayerPoint(ev.latlng);
        const ang = Math.atan2(p.y - c.y, p.x - c.x);
        const delta = ang - startAng;

        rotateLayer(selectedLayer, origin, centerLL, delta, baseAngle);
        showTransformHandles();
      }

      function onUp() {
        map.off("mousemove", onMove);
        map.off("mouseup", onUp);
        pushHistory();
      }

      map.on("mousemove", onMove);
      map.on("mouseup", onUp);
    });
  }

  /* ---------------------------
     Intel Panel: Feed + Notes (localStorage)
  --------------------------- */
  const FEED_KEY = "geotracker_feed_v1";
  const NOTES_KEY = "geotracker_notes_v1";

  const addToFeedBtn = document.getElementById("addToFeedBtn");
  const entryDate = document.getElementById("entryDate");
  const entryType = document.getElementById("entryType");
  const entryCountry = document.getElementById("entryCountry");
  const entryTags = document.getElementById("entryTags");
  const entryText = document.getElementById("entryText");
const entryTitle = document.getElementById("entryTitle");
const entryProvince = document.getElementById("entryProvince");
const entryCity = document.getElementById("entryCity");

const filterCountry = document.getElementById("filterCountry");
const filterProvince = document.getElementById("filterProvince");
const filterCity = document.getElementById("filterCity");

const pickPointBtn = document.getElementById("pickPointBtn");
const pickedPointStatus = document.getElementById("pickedPointStatus");
    let pickingPoint = false;
let pickedPoint = null;
let pickedPointPreview = null;

function setPickedPointStatus() {
  if (!pickedPointStatus) return;
  if (!pickedPoint) {
    pickedPointStatus.textContent = "No point selected.";
  } else {
    pickedPointStatus.textContent =
      `Point selected: ${pickedPoint.lat.toFixed(4)}, ${pickedPoint.lng.toFixed(4)}`;
  }
}

if (pickPointBtn) {
  pickPointBtn.onclick = () => {
    pickingPoint = true;
    pickedPoint = null;

    if (pickedPointPreview) {
      pickedPointPreview.remove();
      pickedPointPreview = null;
    }

    if (pickedPointStatus) pickedPointStatus.textContent = "Click the map to pick a point...";
  };
}

  const feedList = document.getElementById("feedList");
  const filterType = document.getElementById("filterType");
  const searchBox = document.getElementById("searchBox");

  const notesBody = document.getElementById("notesBody");

  function getFeed() {
    return safeJSONParse(localStorage.getItem(FEED_KEY) || "[]", []);
  }
  function setFeed(arr) {
    localStorage.setItem(FEED_KEY, JSON.stringify(arr));
  }

  function getNotesMap() {
    return safeJSONParse(localStorage.getItem(NOTES_KEY) || "{}", {});
  }
  function setNotesMap(obj) {
    localStorage.setItem(NOTES_KEY, JSON.stringify(obj));
  }

  function renderFeed() {
  if (!feedList) return;

  const feed = getFeed().slice();

  // newest first by date (then createdAt)
  feed.sort((a, b) => {
    const ad = (a.date || "") + (a.createdAt || "");
    const bd = (b.date || "") + (b.createdAt || "");
    return bd.localeCompare(ad);
  });

  const typeFilter = filterType?.value || "ALL";
  const q = (searchBox?.value || "").trim().toLowerCase();

  const fc = (filterCountry?.value || "").trim().toLowerCase();
  const fp = (filterProvince?.value || "").trim().toLowerCase();
  const fcity = (filterCity?.value || "").trim().toLowerCase();

  const filtered = feed.filter((x) => {
    if (typeFilter !== "ALL" && x.type !== typeFilter) return false;

    if (fc && !(x.country || "").toLowerCase().includes(fc)) return false;
    if (fp && !(x.province || "").toLowerCase().includes(fp)) return false;
    if (fcity && !(x.city || "").toLowerCase().includes(fcity)) return false;

    if (!q) return true;

    const hay =
      `${x.title || ""} ${x.type || ""} ${x.country || ""} ${x.province || ""} ${x.city || ""} ${(x.tags || []).join(",")} ${x.text || ""}`
        .toLowerCase();

    return hay.includes(q);
  });

  feedList.innerHTML = "";

  if (filtered.length === 0) {
    const div = document.createElement("div");
    div.className = "emptyState";
    div.textContent = (feed.length === 0) ? "No entries yet." : "No matches found.";
    feedList.appendChild(div);
    return;
  }

  filtered.forEach((x) => {
    const card = document.createElement("div");
    card.className = "card";
    card.style.cursor = x.linkedLayerId ? "pointer" : "default";

    // TITLE (this is the missing piece)
    const titleLine = document.createElement("div");
    titleLine.style.fontWeight = "900";
    titleLine.style.fontSize = "14px";
    titleLine.style.marginBottom = "4px";
    titleLine.textContent = (x.title && x.title.trim()) ? x.title.trim() : "(Untitled)";

    // META LINE (date • category • location)
    const parts = [];
    if (x.date) parts.push(x.date);
    if (x.type) parts.push(x.type);

    // Build a nicer location string
    const locParts = [];
    if (x.country) locParts.push(x.country);
    if (x.province) locParts.push(x.province);
    if (x.city) locParts.push(x.city);
    if (locParts.length) parts.push(locParts.join(", "));

    const meta = document.createElement("div");
    meta.className = "cardTitle";
    meta.textContent = parts.join(" • ");

    const body = document.createElement("div");
    body.style.fontSize = "13px";
    body.style.whiteSpace = "pre-wrap";
    body.textContent = x.text || "";

    const tags = document.createElement("div");
    tags.style.marginTop = "8px";
    tags.style.fontSize = "12px";
    tags.style.opacity = "0.7";
    tags.textContent = (x.tags && x.tags.length) ? `Tags: ${x.tags.join(", ")}` : "";

    card.appendChild(titleLine);
    card.appendChild(meta);
    card.appendChild(body);
    if (tags.textContent) card.appendChild(tags);

       if (x.linkedLayerId) {
      card.addEventListener("click", () => {
        let found = null;

        drawnItems.eachLayer((layer) => {
          if (layer && layer.__id === x.linkedLayerId) found = layer;
        });

        if (!found) return;

        // Select and zoom to it
        selectLayer(found);

        try {
          if (found.getBounds) {
            map.fitBounds(found.getBounds(), { padding: [30, 30], maxZoom: 8 });
          } else if (found.getLatLng) {
            map.setView(found.getLatLng(), Math.max(map.getZoom(), 6), { animate: true });
          }
        } catch (_) {}

        // If it's a marker, open its popup (shows intel details)
        if (found instanceof L.Marker) {
          if (found.openPopup) found.openPopup();
        }

        if (moveEnabled) showTransformHandles();
        renderNotesPanel();
      });
    }

    feedList.appendChild(card);
  });
}

  function renderNotesPanel() {
    if (!notesBody) return;

    if (!selectedLayer || !selectedLayer.__id) {
      notesBody.className = "emptyState";
      notesBody.textContent = "No object selected.";
      return;
    }

    const notesMap = getNotesMap();
    const notes = notesMap[selectedLayer.__id] || [];

    notesBody.className = "";
    notesBody.innerHTML = "";

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.gap = "8px";
    header.style.marginBottom = "8px";

    const h = document.createElement("div");
    h.style.fontWeight = "900";
    h.style.fontSize = "12px";
    h.style.opacity = "0.8";
    h.textContent = "Selected object notes";

    const addBtn = document.createElement("button");
    addBtn.textContent = "+ Add note";
    addBtn.className = "primaryBtn";
    addBtn.style.width = "auto";
    addBtn.style.padding = "6px 10px";

    addBtn.onclick = () => {
      const text = prompt("Note text:");
      if (text == null) return;
      const entry = { id: uid(), text: String(text), ts: new Date().toISOString() };
      notes.push(entry);
      notesMap[selectedLayer.__id] = notes;
      setNotesMap(notesMap);
      renderNotesPanel();
    };

    header.appendChild(h);
    header.appendChild(addBtn);
    notesBody.appendChild(header);

    if (notes.length === 0) {
      const empty = document.createElement("div");
      empty.className = "emptyState";
      empty.textContent = "No notes yet for this object.";
      notesBody.appendChild(empty);
      return;
    }

    notes.slice().reverse().forEach((n) => {
      const card = document.createElement("div");
      card.className = "card";

      const t = document.createElement("div");
      t.className = "cardTitle";
      t.textContent = new Date(n.ts).toLocaleString();

      const b = document.createElement("div");
      b.style.whiteSpace = "pre-wrap";
      b.textContent = n.text;

      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.gap = "8px";
      row.style.marginTop = "8px";

      const edit = document.createElement("button");
      edit.textContent = "Edit";
      edit.className = "tabBtn";
      edit.onclick = () => {
        const next = prompt("Edit note:", n.text);
        if (next == null) return;
        n.text = String(next);
        setNotesMap(notesMap);
        renderNotesPanel();
      };

      const del = document.createElement("button");
      del.textContent = "Delete";
      del.className = "tabBtn";
      del.onclick = () => {
        const idx = notes.findIndex((x) => x.id === n.id);
        if (idx >= 0) notes.splice(idx, 1);
        notesMap[selectedLayer.__id] = notes;
        setNotesMap(notesMap);
        renderNotesPanel();
      };

      row.appendChild(edit);
      row.appendChild(del);

      card.appendChild(t);
      card.appendChild(b);
      card.appendChild(row);

      notesBody.appendChild(card);
    });
  }

if (addToFeedBtn) {
  addToFeedBtn.onclick = () => {

    // 1) Decide what this entry is linked to:
    // - If a marker is selected, link to it
    // - Else, if you picked a point, create a marker there and link to it
    let linkedLayerId = null;

    // Link only to markers (because markers show popup on click)
    if (selectedLayer && selectedLayer instanceof L.Marker && selectedLayer.__id) {
      linkedLayerId = selectedLayer.__id;
    }

    // If no selected marker, but user picked a map point, create a marker there
    if (!linkedLayerId && pickedPoint) {
      const m = L.marker(pickedPoint, { draggable: false });

      // give the new marker a stable id so we can link entries to it
      m.__id = uid();

      // make it look exactly like a Draw-marker (your SVG pin)
      if (typeof applyStyle === "function") applyStyle(m);

      // never show persistent tooltip text on markers
      if (m.getTooltip && m.getTooltip()) m.unbindTooltip();

      // add marker to map data
      drawnItems.addLayer(m);

      // make it selectable
      if (typeof wireSelectable === "function") wireSelectable(m);
      if (typeof selectLayer === "function") selectLayer(m);

      linkedLayerId = m.__id;

      // clear pick point preview
      pickedPoint = null;
      if (pickedPointPreview) {
        pickedPointPreview.remove();
        pickedPointPreview = null;
      }
      setPickedPointStatus();

      // record history for the new marker
      if (typeof pushHistory === "function") pushHistory();
    }

    // 2) Build the entry
    const item = {
      id: uid(),
      createdAt: new Date().toISOString(),
      date: entryDate?.value || new Date().toISOString().slice(0, 10),

      title: (entryTitle?.value || "").trim(),
      type: entryType?.value || "Other",

      country: (entryCountry?.value || "").trim(),
      province: (entryProvince?.value || "").trim(),
      city: (entryCity?.value || "").trim(),

      tags: (entryTags?.value || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),

      text: (entryText?.value || "").trim(),

      linkedLayerId: linkedLayerId
    };

    // 3) Save to feed
    const feed = getFeed();
    feed.push(item);
    setFeed(feed);

    // 4) Clear inputs
    if (entryTitle) entryTitle.value = "";
    if (entryCountry) entryCountry.value = "";
    if (entryProvince) entryProvince.value = "";
    if (entryCity) entryCity.value = "";
    if (entryTags) entryTags.value = "";
    if (entryText) entryText.value = "";

    // 5) Re-render UI
    renderFeed();

    // 6) Update marker popups
    if (typeof refreshLinkedMarkerPopups === "function") {
      refreshLinkedMarkerPopups();
    }
  };
} // end if (addToFeedBtn)

if (filterType) filterType.addEventListener("change", renderFeed);
if (searchBox) searchBox.addEventListener("input", renderFeed);
if (filterCountry) filterCountry.addEventListener("input", renderFeed);
if (filterProvince) filterProvince.addEventListener("input", renderFeed);
if (filterCity) filterCity.addEventListener("input", renderFeed);

// First render
renderFeed();
renderNotesPanel();

})();

