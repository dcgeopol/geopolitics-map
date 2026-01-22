/* =========================
   MAP SETUP
   ========================= */
const map = L.map("map", {
  minZoom: 2,
  zoomSnap: 0.25,
  zoomDelta: 0.25
}).setView([20, 0], 2);

// Cylinder behavior (clamp lat, normalize lng)
map.on("moveend", () => {
  const c = map.getCenter();
  const lat = Math.max(-85, Math.min(85, c.lat));
  let lng = c.lng;
  while (lng > 180) lng -= 360;
  while (lng < -180) lng += 360;
  if (lat !== c.lat || lng !== c.lng) map.panTo([lat, lng], { animate: false });
});

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap"
}).addTo(map);

/* =========================
   DOM
   ========================= */
const stylePanel = document.getElementById("stylePanel");
const toggleStyleBtn = document.getElementById("toggleStyle");
const undoBtn = document.getElementById("undoBtn");
const freeDrawBtn = document.getElementById("freeDrawBtn");
const moveBtn = document.getElementById("moveBtn");

const strokeColor = document.getElementById("strokeColor");
const strokeWidth = document.getElementById("strokeWidth");
const strokeOpacity = document.getElementById("strokeOpacity");
const useFill = document.getElementById("useFill");
const fillColor = document.getElementById("fillColor");
const fillOpacity = document.getElementById("fillOpacity");

// Style panel toggle
if (toggleStyleBtn && stylePanel) {
  toggleStyleBtn.onclick = () => {
    stylePanel.style.display =
      (stylePanel.style.display === "none" || !stylePanel.style.display) ? "flex" : "none";
  };
}

/* Optional: style for marker labels (works even if you don’t add CSS in index) */
(function injectLabelCSS() {
  const css = `
    .marker-label{
      background: rgba(255,255,255,0.9);
      border: 1px solid rgba(0,0,0,0.25);
      border-radius: 8px;
      padding: 2px 6px;
      font-size: 12px;
      font-weight: 600;
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

/* =========================
   STYLE HELPERS
   ========================= */
function currentStyle() {
  return {
    color: strokeColor.value,
    weight: +strokeWidth.value,
    opacity: +strokeOpacity.value,
    fill: useFill.checked,
    fillColor: fillColor.value,
    fillOpacity: +fillOpacity.value
  };
}

/* Colorable SVG pin marker */
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
    popupAnchor: [0, -40]
  });
}

function setMarkerLabel(marker, text) {
  marker.__label = (text || "").trim();
  marker.unbindTooltip();
  if (marker.__label) {
    marker.bindTooltip(marker.__label, {
      permanent: true,
      direction: "top",
      offset: [0, -38],
      className: "marker-label"
    }).openTooltip();
  }
}

/* =========================
   LAYERS + SELECTION
   ========================= */
const drawnItems = new L.FeatureGroup().addTo(map);
let selectedLayer = null;

/* =========================
   TRUE UNDO + REDO (timeline states)
   ========================= */
const history = [];
const redoStack = [];

function serializeState() {
  return {
    layers: drawnItems.toGeoJSON()
  };
}

function statesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Always keep the "current state" as the last history entry.
function pushHistory({ clearRedo = true } = {}) {
  const state = serializeState();

  if (history.length > 0) {
    const last = history[history.length - 1];
    if (statesEqual(last, state)) return; // no-op change
  }

  history.push(state);

  if (clearRedo) redoStack.length = 0;
  if (history.length > 250) history.shift();
}

function undo() {
  // Need at least 2 states to undo: [prev, current]
  if (history.length < 2) return;

  const current = history.pop();     // remove current
  redoStack.push(current);           // save for redo

  const prev = history[history.length - 1];
  restoreState(prev);

  if (moveEnabled) showTransformHandles();
}

function redo() {
  if (redoStack.length < 1) return;

  const next = redoStack.pop();
  history.push(next);
  restoreState(next);

  if (moveEnabled) showTransformHandles();
}

/* initial empty state snapshot */
pushHistory({ clearRedo: false });

function selectLayer(layer) {
  selectedLayer = layer;
  if (moveEnabled) showTransformHandles();
}

function wireSelectable(layer) {
  layer.off("click");
  layer.on("click", () => selectLayer(layer));
}

// Wire buttons (ONLY ONCE)
if (undoBtn) undoBtn.onclick = undo;

const redoBtn = document.getElementById("redoBtn");
if (redoBtn) redoBtn.onclick = redo;

// Keyboard shortcuts (optional but nice)
document.addEventListener("keydown", (e) => {
  const isMac = navigator.platform.toUpperCase().includes("MAC");
  const mod = isMac ? e.metaKey : e.ctrlKey;

  if (!mod) return;

  // Ctrl/Cmd+Z => undo
  if (e.key.toLowerCase() === "z" && !e.shiftKey) {
    e.preventDefault();
    undo();
  }

  // Ctrl/Cmd+Shift+Z => redo
  if (e.key.toLowerCase() === "z" && e.shiftKey) {
    e.preventDefault();
    redo();
  }
});


if (undoBtn) undoBtn.onclick = undo;





/* =========================
   STYLE APPLY (undoable)
   ========================= */
function applyStyle(layer) {
  if (!layer) return;

  // Marker pin: recolor icon
  if (layer instanceof L.Marker && !(layer instanceof L.CircleMarker)) {
    const c = strokeColor.value;
    const op = +strokeOpacity.value;
    layer.__markerColor = c;
    layer.__markerOpacity = op;
    layer.setIcon(makePinIcon(c, op));
    return;
  }

  // Shapes
  if (layer.setStyle) {
    layer.setStyle(currentStyle());
  }
}

[
  strokeColor, strokeWidth, strokeOpacity,
  useFill, fillColor, fillOpacity
].forEach(el => {
  if (!el) return;
  el.addEventListener("input", () => {
    if (!selectedLayer) return;
    pushHistoryDebounced();
    applyStyle(selectedLayer);
    if (moveEnabled) showTransformHandles();
  });
});

/* =========================
   DRAW TOOLS (Draw-only)
   ========================= */
new L.Control.Draw({
  draw: {
    polyline: true,
    polygon: true,
    rectangle: true,
    circle: true,
    marker: true,
    circlemarker: true // may still show; we ignore its output below
  },
  edit: false
}).addTo(map);

map.on(L.Draw.Event.CREATED, (e) => {
  // Ignore circleMarker tool output entirely
  if (e.layerType === "circlemarker") return;

  pushHistory(); // creation undoable

  let layer = e.layer;

  // Marker tool => colorable pin + label
  if (e.layerType === "marker") {
    layer = L.marker(layer.getLatLng(), {
      icon: makePinIcon(strokeColor.value, +strokeOpacity.value)
    });
    layer.__markerColor = strokeColor.value;
    layer.__markerOpacity = +strokeOpacity.value;

    const label = prompt("Marker label (optional):", "") || "";
    setMarkerLabel(layer, label);

    wireSelectable(layer);
    layer.on("dblclick", () => {
      const next = prompt("Marker label:", layer.__label || "") ?? (layer.__label || "");
      pushHistory();
      setMarkerLabel(layer, next);
    });

    drawnItems.addLayer(layer);
    selectLayer(layer);
    return;
  }

  // Circle tool => circle shape (keep radius)
  if (e.layerType === "circle") {
    layer.setStyle(currentStyle());
    wireSelectable(layer);
    drawnItems.addLayer(layer);
    selectLayer(layer);
    return;
  }

  // Polylines / polygons / rectangles
  layer.setStyle(currentStyle());
  layer.__angleRad = 0;
  wireSelectable(layer);
  drawnItems.addLayer(layer);
  selectLayer(layer);
});

/* =========================
   FREE DRAW
   ========================= */
let freeDraw = false;
let activeLine = null;
let lastPt = null;
const MIN_DIST = 10; // smooth enough; not a million points

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
  pushHistory(); // starting a line is undoable

  activeLine = L.polyline([e.latlng], currentStyle()).addTo(drawnItems);
  activeLine.__angleRad = 0;
  // make free-draw easier to click
  activeLine.options.interactive = true;
  activeLine.options.weight = Math.max(activeLine.options.weight || 3, 4);

  wireSelectable(activeLine);
  selectLayer(activeLine);

  lastPt = map.latLngToLayerPoint(e.latlng);
});

map.on("mousemove touchmove", (e) => {
  if (!activeLine) return;
  const p = map.latLngToLayerPoint(e.latlng);
  if (p.distanceTo(lastPt) >= MIN_DIST) {
    activeLine.addLatLng(e.latlng);
    lastPt = p;
  }
});

map.on("mouseup touchend touchcancel", () => {
  if (!activeLine) return;
  activeLine = null;
  lastPt = null;
});

/* =========================
   TRANSFORM HANDLES (Move + Resize + Rotate)
   ========================= */
let moveEnabled = false;

let transformGroup = null;
let bbox = null;
let hNW = null, hNE = null, hSE = null, hSW = null;
let hRotate = null;

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
  if (layer instanceof L.Marker && !(layer instanceof L.CircleMarker)) {
    const ll = layer.getLatLng();
    return L.latLngBounds(ll, ll);
  }
  if (layer instanceof L.Circle) {
    return layer.getBounds();
  }
  if (layer.getBounds) return layer.getBounds();
  return L.latLngBounds(layer.getLatLngs().flat(Infinity));
}

function layerCenterLL(layer) {
  if (layer instanceof L.Marker && !(layer instanceof L.CircleMarker)) return layer.getLatLng();
  if (layer instanceof L.Circle) return layer.getLatLng();

  const latlngs = layer.getLatLngs().flat(Infinity);
  let lat = 0, lng = 0;
  latlngs.forEach(ll => { lat += ll.lat; lng += ll.lng; });
  return L.latLng(lat / latlngs.length, lng / latlngs.length);
}

function showTransformHandles() {
  hideTransformHandles();
  if (!moveEnabled || !selectedLayer) return;

  transformGroup = L.layerGroup().addTo(map);

  const b = layerBoundsLL(selectedLayer);
  const nw = b.getNorthWest();
  const ne = b.getNorthEast();
  const se = b.getSouthEast();
  const sw = b.getSouthWest();

  // bbox overlay MUST NOT steal clicks
  bbox = L.polygon([nw, ne, se, sw], {
    color: "#000",
    weight: 1,
    opacity: 0.6,
    fill: false,
    interactive: false
  }).addTo(transformGroup);

  const handleStyle = {
    radius: 6,
    color: "#000",
    weight: 2,
    fill: true,
    fillOpacity: 1
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

/* ---------- geometry helpers ---------- */
function deepCloneLatLngs(lls) {
  if (Array.isArray(lls)) return lls.map(deepCloneLatLngs);
  return L.latLng(lls.lat, lls.lng);
}
function mapLatLngs(lls, fn) {
  if (Array.isArray(lls)) return lls.map(x => mapLatLngs(x, fn));
  return fn(lls);
}

/* Move (translate) */
function translateLayer(layer, dx, dy, origin) {
  // Marker pin
  if (layer instanceof L.Marker && !(layer instanceof L.CircleMarker)) {
    const p = map.latLngToLayerPoint(origin).add([dx, dy]);
    layer.setLatLng(map.layerPointToLatLng(p));
    return;
  }

  // Circle
  if (layer instanceof L.Circle) {
    const p = map.latLngToLayerPoint(origin.center).add([dx, dy]);
    layer.setLatLng(map.layerPointToLatLng(p));
    return;
  }

  // Polylines / polygons
  const newLLs = mapLatLngs(origin, (ll) => {
    const p = map.latLngToLayerPoint(ll).add([dx, dy]);
    return map.layerPointToLatLng(p);
  });
  layer.setLatLngs(newLLs);
}

/* Resize while preserving current rotation (no drift) */
function scalePreserveRotation(layer, origin, centerLL, scale, baseAngleRad) {
  if (layer instanceof L.Marker && !(layer instanceof L.CircleMarker)) return;

  const c = map.latLngToLayerPoint(centerLL);

  function rot(pt, rad) {
    const cos = Math.cos(rad), sin = Math.sin(rad);
    return L.point(pt.x * cos - pt.y * sin, pt.x * sin + pt.y * cos);
  }

  function xform(ll) {
    const p = map.latLngToLayerPoint(ll);
    const v = p.subtract(c);
    const unrot = rot(v, -baseAngleRad);
    const scaled = L.point(unrot.x * scale, unrot.y * scale);
    const rerot = rot(scaled, baseAngleRad);
    return map.layerPointToLatLng(rerot.add(c));
  }

  // Circle: scale radius only
  if (layer instanceof L.Circle) {
    layer.setRadius(Math.max(2, origin.radius * scale));
    return;
  }

  layer.setLatLngs(mapLatLngs(origin, xform));
}

/* Rotate to a given angle around center */
function rotateToAngle(layer, origin, centerLL, angleRad) {
  if (layer instanceof L.Marker && !(layer instanceof L.CircleMarker)) return;
  if (layer instanceof L.Circle) return;

  const c = map.latLngToLayerPoint(centerLL);
  const cos = Math.cos(angleRad), sin = Math.sin(angleRad);

  function xform(ll) {
    const p = map.latLngToLayerPoint(ll);
    const v = p.subtract(c);
    const r = L.point(v.x * cos - v.y * sin, v.x * sin + v.y * cos).add(c);
    return map.layerPointToLatLng(r);
  }

  layer.setLatLngs(mapLatLngs(origin, xform));
}

/* ---------- handle wiring ---------- */
function wireMoveOnTarget(layer) {
  layer.off("mousedown");
  layer.off("touchstart");

  let dragging = false;
  let startPt = null;
  let origin = null;

  function start(e) {
    if (!moveEnabled || !selectedLayer || layer !== selectedLayer) return;
    pushHistory();
    dragging = true;
    startPt = map.latLngToLayerPoint(e.latlng);

    if (layer instanceof L.Marker && !(layer instanceof L.CircleMarker)) {
      origin = layer.getLatLng();
    } else if (layer instanceof L.Circle) {
      origin = { center: layer.getLatLng(), radius: layer.getRadius() };
    } else {
      origin = deepCloneLatLngs(layer.getLatLngs());
    }

    if (e.originalEvent) e.originalEvent.preventDefault();
  }

  function move(e) {
    if (!dragging) return;
    const p = map.latLngToLayerPoint(e.latlng);
    const d = p.subtract(startPt);
    translateLayer(layer, d.x, d.y, origin);
    showTransformHandles();
  }

  function end() { dragging = false; }

  layer.on("mousedown", start);
  layer.on("touchstart", start);
  map.on("mousemove", move);
  map.on("touchmove", move);
  map.on("mouseup", end);
  map.on("touchend touchcancel", end);
}

function wireScaleHandle(handle) {
  handle.off("mousedown");
  handle.off("touchstart");

  let scaling = false;
  let startPt = null;
  let origin = null;
  let centerLL = null;
  let startDist = 1;
  let baseAngle = 0;

  function start(e) {
    if (!moveEnabled || !selectedLayer) return;
    if (selectedLayer instanceof L.Marker && !(selectedLayer instanceof L.CircleMarker)) return;

    pushHistory();
    scaling = true;

    centerLL = layerCenterLL(selectedLayer);
    const c = map.latLngToLayerPoint(centerLL);
    startPt = map.latLngToLayerPoint(e.latlng);

    startDist = Math.max(1, startPt.distanceTo(c));
    baseAngle = selectedLayer.__angleRad || 0;

    if (selectedLayer instanceof L.Circle) {
      origin = { center: selectedLayer.getLatLng(), radius: selectedLayer.getRadius() };
    } else {
      origin = deepCloneLatLngs(selectedLayer.getLatLngs());
    }

    if (e.originalEvent) e.originalEvent.preventDefault();
  }

  function move(e) {
    if (!scaling) return;

    const c = map.latLngToLayerPoint(centerLL);
    const p = map.latLngToLayerPoint(e.latlng);
    const dist = Math.max(1, p.distanceTo(c));
    const scale = dist / startDist;

    scalePreserveRotation(selectedLayer, origin, centerLL, scale, baseAngle);
    selectedLayer.__angleRad = baseAngle; // rotation stays locked during resize
    showTransformHandles();
  }

  function end() { scaling = false; }

  handle.on("mousedown", start);
  handle.on("touchstart", start);
  map.on("mousemove", move);
  map.on("touchmove", move);
  map.on("mouseup", end);
  map.on("touchend touchcancel", end);
}

function wireRotateHandle(handle) {
  handle.off("mousedown");
  handle.off("touchstart");

  let rotating = false;
  let origin = null;
  let centerLL = null;
  let startAngle = 0;
  let baseAngle = 0;

  function angleFromCenter(pt, centerPt) {
    return Math.atan2(pt.y - centerPt.y, pt.x - centerPt.x);
  }

  function start(e) {
    if (!moveEnabled || !selectedLayer) return;
    if (selectedLayer instanceof L.Marker && !(selectedLayer instanceof L.CircleMarker)) return;
    if (selectedLayer instanceof L.Circle) return; // no rotation for circles

    pushHistory();
    rotating = true;

    origin = deepCloneLatLngs(selectedLayer.getLatLngs());
    centerLL = layerCenterLL(selectedLayer);

    const c = map.latLngToLayerPoint(centerLL);
    const p = map.latLngToLayerPoint(e.latlng);

    startAngle = angleFromCenter(p, c);
    baseAngle = selectedLayer.__angleRad || 0;

    if (e.originalEvent) e.originalEvent.preventDefault();
  }

  function move(e) {
    if (!rotating) return;

    const c = map.latLngToLayerPoint(centerLL);
    const p = map.latLngToLayerPoint(e.latlng);

    const ang = angleFromCenter(p, c);
    const delta = ang - startAngle;
    const newAngle = baseAngle + delta;

    rotateToAngle(selectedLayer, origin, centerLL, newAngle);
    selectedLayer.__angleRad = newAngle;
    showTransformHandles();
  }

  function end() { rotating = false; }

  handle.on("mousedown", start);
  handle.on("touchstart", start);
  map.on("mousemove", move);
  map.on("touchmove", move);
  map.on("mouseup", end);
  map.on("touchend touchcancel", end);
}

/* =========================
   EVENT MARKERS (data.json) - unchanged
   ========================= */
const markerLayer = L.layerGroup().addTo(map);

fetch("data.json")
  .then(res => res.json())
  .then(data => {
    const dateInput = document.getElementById("date");
    dateInput.value = "2026-01-13";

    function render(date) {
      markerLayer.clearLayers();
      data.filter(d => d.date === date).forEach(d => {
        const [lat, lng] = d.coords;
        [-360, 0, 360].forEach(offset => {
          L.marker([lat, lng + offset])
            .addTo(markerLayer)
            .bindPopup(`<b>${d.country}</b><br>${d.type}<br>${d.text}`);
        });
      });
    }

    render(dateInput.value);
    dateInput.addEventListener("change", e => render(e.target.value));
  });
