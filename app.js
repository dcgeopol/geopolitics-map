const map = L.map("map", {
  minZoom: 2,
  zoomSnap: 0.25,
  zoomDelta: 0.25
}).setView([20, 0], 2);

/* ===== Cylinder behavior ===== */
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

/* ===== DOM ===== */
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
const markerRadius = document.getElementById("markerRadius");
const markerBorder = document.getElementById("markerBorder");

/* ===== STYLE HELPERS ===== */
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
function markerStyle() {
  return {
    ...currentStyle(),
    radius: +markerRadius.value,
    weight: +markerBorder.value
  };
}

/* ===== UI: style panel toggle ===== */
toggleStyleBtn.onclick = () => {
  stylePanel.style.display = (stylePanel.style.display === "none" || !stylePanel.style.display)
    ? "flex"
    : "none";
};

/* ===== DRAW STORAGE ===== */
const drawnItems = new L.FeatureGroup().addTo(map);
const undoStack = [];
let selectedLayer = null;

/* ===== Persist per-layer style ===== */
function storeStyle(layer) {
  layer.__style = layer instanceof L.CircleMarker ? markerStyle() : currentStyle();
}
function applyStyle(layer) {
  if (!layer) return;
  const s = layer instanceof L.CircleMarker ? markerStyle() : currentStyle();
  layer.setStyle(s);
  if (layer instanceof L.CircleMarker) layer.setRadius(s.radius);
  layer.__style = s;
}
function restoreStyle(layer) {
  if (!layer || !layer.__style) return;
  layer.setStyle(layer.__style);
  if (layer instanceof L.CircleMarker && typeof layer.__style.radius === "number") {
    layer.setRadius(layer.__style.radius);
  }
}

/* ===== Select layer on click ===== */
function selectLayer(layer) {
  selectedLayer = layer;
  // show handles if move mode is on
  if (moveEnabled) showTransformHandles();
}

/* Restyle selected when panel changes */
[
  strokeColor, strokeWidth, strokeOpacity,
  useFill, fillColor, fillOpacity,
  markerRadius, markerBorder
].forEach(el => {
  el.addEventListener("input", () => {
    applyStyle(selectedLayer);
    if (moveEnabled) showTransformHandles(); // keep handles aligned
  });
});

/* ===== Leaflet Draw: DRAW ONLY (NO EDIT/DELETE BUTTONS) ===== */
new L.Control.Draw({
  draw: { polyline:true, polygon:true, rectangle:true, marker:true, circle:false },
  edit: false
}).addTo(map);

map.on(L.Draw.Event.CREATED, e => {
  let layer = e.layer;

  if (e.layerType === "marker") {
    const ll = layer.getLatLng();
    layer = L.circleMarker(ll, markerStyle());
  } else {
    layer.setStyle(currentStyle());
  }

  layer.on("click", () => selectLayer(layer));
  storeStyle(layer);

  drawnItems.addLayer(layer);
  undoStack.push(layer);
  selectLayer(layer);
});

/* ===== UNDO ===== */
undoBtn.onclick = () => {
  const last = undoStack.pop();
  if (!last) return;
  drawnItems.removeLayer(last);
  if (selectedLayer === last) {
    selectedLayer = null;
    hideTransformHandles();
  }
};

/* ===== FREE DRAW ===== */
let freeDraw = false;
let line = null;
let lastPt = null;
const MIN_DIST = 10; // smooth-ish without centipede

freeDrawBtn.onclick = () => {
  freeDraw = !freeDraw;
  freeDrawBtn.textContent = freeDraw ? "Free Draw: ON" : "Free Draw";
  if (freeDraw) {
    map.dragging.disable();
  } else if (!moveEnabled) {
    map.dragging.enable();
  }
};

map.on("mousedown touchstart", e => {
  if (!freeDraw) return;
  line = L.polyline([e.latlng], currentStyle()).addTo(drawnItems);
  line.on("click", () => selectLayer(line));
  storeStyle(line);
  lastPt = map.latLngToLayerPoint(e.latlng);
});
map.on("mousemove touchmove", e => {
  if (!line) return;
  const p = map.latLngToLayerPoint(e.latlng);
  if (p.distanceTo(lastPt) > MIN_DIST) {
    line.addLatLng(e.latlng);
    lastPt = p;
  }
});
map.on("mouseup touchend touchcancel", () => {
  if (!line) return;
  undoStack.push(line);
  selectLayer(line);
  line = null;
});

/* =======================================================================
   TRANSFORM HANDLES (Move + Resize + Rotate) — NO Leaflet-Draw Edit mode
   ======================================================================= */

let moveEnabled = false;

/* Handle layers */
let transformGroup = null;
let bbox = null;
let hNW = null, hNE = null, hSE = null, hSW = null;
let hRotate = null;

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

function hideTransformHandles() {
  if (transformGroup) {
    transformGroup.remove();
    transformGroup = null;
  }
  bbox = hNW = hNE = hSE = hSW = hRotate = null;
}

function layerBoundsLL(layer) {
  if (layer instanceof L.CircleMarker) {
    const ll = layer.getLatLng();
    return L.latLngBounds(ll, ll);
  }
  if (layer.getBounds) return layer.getBounds();
  // fallback for polyline/polygon
  return L.latLngBounds(layer.getLatLngs().flat(Infinity));
}

function layerCenterLL(layer) {
  if (layer instanceof L.CircleMarker) return layer.getLatLng();

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

  // bbox outline
  bbox = L.polygon([nw, ne, se, sw], {
    color: "#000",
    weight: 1,
    opacity: 0.6,
    fill: false
  }).addTo(transformGroup);

  const handleStyle = { radius: 6, color: "#000", weight: 2, fill: true, fillOpacity: 1 };

  hNW = L.circleMarker(nw, handleStyle).addTo(transformGroup);
  hNE = L.circleMarker(ne, handleStyle).addTo(transformGroup);
  hSE = L.circleMarker(se, handleStyle).addTo(transformGroup);
  hSW = L.circleMarker(sw, handleStyle).addTo(transformGroup);

  // rotate handle above NE (a bit north)
  const rot = L.latLng(ne.lat + (b.getNorth() - b.getSouth()) * 0.15 + 1, ne.lng);
  hRotate = L.circleMarker(rot, { ...handleStyle, radius: 7 }).addTo(transformGroup);

  // wire interactions
  wireMoveOnTarget(selectedLayer); // drag shape itself
  wireScaleHandle(hNW);
  wireScaleHandle(hNE);
  wireScaleHandle(hSE);
  wireScaleHandle(hSW);
  wireRotateHandle(hRotate);
}

/* ---------- Geometry transforms in pixel space ---------- */

function getLayerLatLngs(layer) {
  if (layer instanceof L.CircleMarker) return layer.getLatLng();
  return layer.getLatLngs();
}

function setLayerLatLngs(layer, latlngs) {
  if (layer instanceof L.CircleMarker) layer.setLatLng(latlngs);
  else layer.setLatLngs(latlngs);
}

function deepCloneLatLngs(lls) {
  if (Array.isArray(lls)) return lls.map(deepCloneLatLngs);
  return L.latLng(lls.lat, lls.lng);
}

function mapLatLngs(lls, fn) {
  if (Array.isArray(lls)) return lls.map(x => mapLatLngs(x, fn));
  return fn(lls);
}

function translateLayer(layer, dx, dy, originLatLngs) {
  if (layer instanceof L.CircleMarker) {
    const p = map.latLngToLayerPoint(originLatLngs).add([dx, dy]);
    layer.setLatLng(map.layerPointToLatLng(p));
    return;
  }
  const newLLs = mapLatLngs(originLatLngs, (ll) => {
    const p = map.latLngToLayerPoint(ll).add([dx, dy]);
    return map.layerPointToLatLng(p);
  });
  layer.setLatLngs(newLLs);
}

function transformLayer(layer, originLatLngs, centerLL, scale, angleRad) {
  // transform all vertices around center in pixel space
  const c = map.latLngToLayerPoint(centerLL);

  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  function xformPoint(ll) {
    const p = map.latLngToLayerPoint(ll);
    const v = p.subtract(c);

    const sx = v.x * scale;
    const sy = v.y * scale;

    const rx = sx * cos - sy * sin;
    const ry = sx * sin + sy * cos;

    const out = L.point(rx, ry).add(c);
    return map.layerPointToLatLng(out);
  }

  if (layer instanceof L.CircleMarker) {
    // circlemarker: scale changes radius; rotate irrelevant
    const centerPt = map.latLngToLayerPoint(originLatLngs);
    const outLL = map.layerPointToLatLng(centerPt); // position stays unless moved separately
    layer.setLatLng(outLL);
    const baseR = layer.getRadius();
    layer.setRadius(Math.max(2, baseR * scale));
    return;
  }

  const newLLs = mapLatLngs(originLatLngs, xformPoint);
  layer.setLatLngs(newLLs);
}

/* ---------- Drag interactions ---------- */

function wireMoveOnTarget(layer) {
  // prevent stacking listeners
  layer.off("mousedown");
  layer.off("touchstart");

  let dragging = false;
  let startPt = null;
  let origin = null;

  function start(e) {
    if (!moveEnabled || !selectedLayer || layer !== selectedLayer) return;
    dragging = true;
    startPt = map.latLngToLayerPoint(e.latlng);
    origin = layer instanceof L.CircleMarker ? layer.getLatLng() : deepCloneLatLngs(layer.getLatLngs());
    if (e.originalEvent) e.originalEvent.preventDefault();
  }
  function move(e) {
    if (!dragging) return;
    const p = map.latLngToLayerPoint(e.latlng);
    const d = p.subtract(startPt);
    translateLayer(layer, d.x, d.y, origin);
    storeStyle(layer);
    showTransformHandles();
  }
  function end() {
    dragging = false;
  }

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
  let originLLs = null;
  let centerLL = null;
  let startDist = 1;
  let baseAngle = 0;

  function start(e) {
    if (!moveEnabled || !selectedLayer) return;
    scaling = true;

    originLLs = selectedLayer instanceof L.CircleMarker ? selectedLayer.getLatLng() : deepCloneLatLngs(selectedLayer.getLatLngs());
    centerLL = layerCenterLL(selectedLayer);

    const c = map.latLngToLayerPoint(centerLL);
    startPt = map.latLngToLayerPoint(e.latlng);

    startDist = Math.max(1, startPt.distanceTo(c));
    baseAngle = selectedLayer.__angleRad || 0;

    if (e.originalEvent) e.originalEvent.preventDefault();
  }

  function move(e) {
    if (!scaling) return;

    const c = map.latLngToLayerPoint(centerLL);
    const p = map.latLngToLayerPoint(e.latlng);
    const dist = Math.max(1, p.distanceTo(c));
    const scale = dist / startDist;

    // apply scale around center; preserve current rotation
    transformLayer(selectedLayer, originLLs, centerLL, scale, baseAngle);

    storeStyle(selectedLayer);
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
  let originLLs = null;
  let centerLL = null;
  let startAngle = 0;
  let baseAngle = 0;

  function angleFromCenter(pt, centerPt) {
    return Math.atan2(pt.y - centerPt.y, pt.x - centerPt.x);
  }

  function start(e) {
    if (!moveEnabled || !selectedLayer) return;
    if (selectedLayer instanceof L.CircleMarker) return; // rotation not meaningful
    rotating = true;

    originLLs = deepCloneLatLngs(selectedLayer.getLatLngs());
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

    // rotate around center without scaling
    transformLayer(selectedLayer, originLLs, centerLL, 1, newAngle);

    selectedLayer.__angleRad = newAngle;
    storeStyle(selectedLayer);
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

/* ===== EVENT MARKERS (from data.json) ===== */
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
