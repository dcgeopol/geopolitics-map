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
const markerRadius = document.getElementById("markerRadius");   // used for circle radius when a circle is selected
const markerBorder = document.getElementById("markerBorder");   // used for circle stroke weight too

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

/* ===== UI: style panel toggle ===== */
toggleStyleBtn.onclick = () => {
  stylePanel.style.display =
    (stylePanel.style.display === "none" || !stylePanel.style.display) ? "flex" : "none";
};

/* ===== DRAW STORAGE ===== */
const drawnItems = new L.FeatureGroup().addTo(map);
let selectedLayer = null;

/* ===== GLOBAL UNDO (state snapshots) ===== */
const history = [];
function pushHistory() {
  history.push(serializeState());
  if (history.length > 200) history.shift(); // keep it bounded
}
function undo() {
  if (history.length < 1) return;
  const prev = history.pop();
  restoreState(prev);
  hideTransformHandles();
  selectedLayer = null;
}

/* ===== Serialize / restore ALL drawings ===== */
function serializeState() {
  const layers = [];
  drawnItems.eachLayer(layer => {
    // Marker (pin icon)
    if (layer instanceof L.Marker && !(layer instanceof L.CircleMarker)) {
      layers.push({
        type: "marker",
        latlng: layer.getLatLng()
      });
      return;
    }

    // Circle shape
    if (layer instanceof L.Circle) {
      layers.push({
        type: "circle",
        latlng: layer.getLatLng(),
        radius: layer.getRadius(),
        style: layer.options,
        angleRad: layer.__angleRad || 0
      });
      return;
    }

    // Polyline / Polygon / Rectangle
    if (layer instanceof L.Polyline) {
      layers.push({
        type: layer instanceof L.Polygon ? "polygon" : "polyline",
        latlngs: layer.getLatLngs(),
        style: layer.options,
        angleRad: layer.__angleRad || 0
      });
      return;
    }
  });

  return { layers };
}

function restoreState(state) {
  drawnItems.clearLayers();

  (state.layers || []).forEach(obj => {
    let layer = null;

    if (obj.type === "marker") {
      layer = L.marker(obj.latlng);
      layer.on("click", () => selectLayer(layer));
      drawnItems.addLayer(layer);
      return;
    }

    if (obj.type === "circle") {
      layer = L.circle(obj.latlng, { ...obj.style, radius: obj.radius });
      layer.__angleRad = obj.angleRad || 0;
      layer.on("click", () => selectLayer(layer));
      drawnItems.addLayer(layer);
      return;
    }

    if (obj.type === "polyline") {
      layer = L.polyline(obj.latlngs, obj.style);
      layer.__angleRad = obj.angleRad || 0;
      layer.on("click", () => selectLayer(layer));
      drawnItems.addLayer(layer);
      return;
    }

    if (obj.type === "polygon") {
      layer = L.polygon(obj.latlngs, obj.style);
      layer.__angleRad = obj.angleRad || 0;
      layer.on("click", () => selectLayer(layer));
      drawnItems.addLayer(layer);
      return;
    }
  });
}

/* ===== Style application (shapes only) ===== */
function applyStyle(layer) {
  if (!layer) return;

  // marker icon: no stroke/fill styling (we just ignore)
  if (layer instanceof L.Marker && !(layer instanceof L.CircleMarker)) return;

  // Circle: style + radius control
  if (layer instanceof L.Circle) {
    // Use markerBorder as circle stroke width; markerRadius as circle radius (optional)
    const s = currentStyle();
    const w = +markerBorder.value;
    layer.setStyle({ ...s, weight: w });
    const r = +markerRadius.value;
    if (Number.isFinite(r) && r > 0) layer.setRadius(r);
    pushAnglePreserve(layer);
    return;
  }

  // Polyline/Polygon/Rectangle
  if (layer.setStyle) {
    const s = currentStyle();
    layer.setStyle(s);
    pushAnglePreserve(layer);
  }
}

// preserve angle metadata during style changes
function pushAnglePreserve(layer) {
  layer.__angleRad = layer.__angleRad || 0;
}

/* ===== Select layer ===== */
function selectLayer(layer) {
  selectedLayer = layer;
  if (moveEnabled) showTransformHandles();
}

/* Panel changes restyle selected layer, with UNDO snapshots */
[
  strokeColor, strokeWidth, strokeOpacity,
  useFill, fillColor, fillOpacity,
  markerRadius, markerBorder
].forEach(el => {
  el.addEventListener("input", () => {
    if (!selectedLayer) return;
    pushHistory();
    applyStyle(selectedLayer);
    if (moveEnabled) showTransformHandles();
  });
});

/* ===== Leaflet Draw: DRAW ONLY =====
   - marker: pin icon
   - circle: circle shape (like rectangle tool)
*/
new L.Control.Draw({
  draw: {
    polyline: true,
    polygon: true,
    rectangle: true,
    circle: true,
    marker: true
  },
  edit: false
}).addTo(map);

map.on(L.Draw.Event.CREATED, e => {
  pushHistory(); // undo should remove this creation

  let layer = e.layer;

  // Marker tool => real map pin icon
  if (e.layerType === "marker") {
    layer = L.marker(layer.getLatLng());
    layer.on("click", () => selectLayer(layer));
    drawnItems.addLayer(layer);
    selectLayer(layer);
    return;
  }

  // Circle tool => circle SHAPE
  if (e.layerType === "circle") {
    layer.setStyle({ ...currentStyle(), weight: +markerBorder.value });
    // Keep the radius the user drew (don’t overwrite here)
    layer.on("click", () => selectLayer(layer));
    drawnItems.addLayer(layer);
    selectLayer(layer);
    return;
  }

  // Other shapes
  layer.setStyle(currentStyle());
  layer.on("click", () => selectLayer(layer));
  drawnItems.addLayer(layer);
  selectLayer(layer);
});

/* ===== UNDO ===== */
undoBtn.onclick = undo;

/* ===== FREE DRAW ===== */
let freeDraw = false;
let line = null;
let lastPt = null;
const MIN_DIST = 10; // smooth-ish without handle centipede

freeDrawBtn.onclick = () => {
  freeDraw = !freeDraw;
  freeDrawBtn.textContent = freeDraw ? "Free Draw: ON" : "Free Draw";

  if (freeDraw) map.dragging.disable();
  else if (!moveEnabled) map.dragging.enable();
};

map.on("mousedown touchstart", e => {
  if (!freeDraw) return;
  pushHistory(); // undo removes the whole free-draw line

  line = L.polyline([e.latlng], currentStyle()).addTo(drawnItems);
  line.on("click", () => selectLayer(line));
  selectLayer(line);

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
  line = null;
});

/* =======================================================================
   TRANSFORM HANDLES (Move + Resize + Rotate) — custom, no Draw edit mode
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
  if (layer instanceof L.Marker && !(layer instanceof L.CircleMarker)) {
    const ll = layer.getLatLng();
    return L.latLngBounds(ll, ll);
  }
  if (layer.getBounds) return layer.getBounds();
  // fallback
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
  wireMoveOnTarget(selectedLayer); // drag shape itself => move
  wireScaleHandle(hNW);
  wireScaleHandle(hNE);
  wireScaleHandle(hSE);
  wireScaleHandle(hSW);
  wireRotateHandle(hRotate);
}

/* ---------- Geometry transforms in pixel space ---------- */

function deepCloneLatLngs(lls) {
  if (Array.isArray(lls)) return lls.map(deepCloneLatLngs);
  return L.latLng(lls.lat, lls.lng);
}

function mapLatLngs(lls, fn) {
  if (Array.isArray(lls)) return lls.map(x => mapLatLngs(x, fn));
  return fn(lls);
}

function translateLayer(layer, dx, dy, origin) {
  // Marker (pin)
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

  // Polyline/Polygon
  const newLLs = mapLatLngs(origin, (ll) => {
    const p = map.latLngToLayerPoint(ll).add([dx, dy]);
    return map.layerPointToLatLng(p);
  });
  layer.setLatLngs(newLLs);
}

function transformLayer(layer, origin, centerLL, scale, angleRad) {
  // Marker: scale/rotate ignored (only move is meaningful)
  if (layer instanceof L.Marker && !(layer instanceof L.CircleMarker)) return;

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

  // Circle: scale radius only (rotation irrelevant)
  if (layer instanceof L.Circle) {
    const baseR = origin.radius;
    layer.setRadius(Math.max(2, baseR * scale));
    return;
  }

  // Polyline/Polygon
  const newLLs = mapLatLngs(origin, xformPoint);
  layer.setLatLngs(newLLs);
}

/* ---------- Drag interactions ---------- */

function wireMoveOnTarget(layer) {
  // remove old listeners on the selected layer
  layer.off("mousedown");
  layer.off("touchstart");

  let dragging = false;
  let startPt = null;
  let origin = null;

  function start(e) {
    if (!moveEnabled || !selectedLayer || layer !== selectedLayer) return;

    pushHistory(); // undo should revert this move

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
  let origin = null;
  let centerLL = null;
  let startDist = 1;
  let baseAngle = 0;

  function start(e) {
    if (!moveEnabled || !selectedLayer) return;
    if (selectedLayer instanceof L.Marker && !(selectedLayer instanceof L.CircleMarker)) return;

    pushHistory(); // undo should revert this resize/scale

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

    transformLayer(selectedLayer, origin, centerLL, scale, baseAngle);
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
    if (selectedLayer instanceof L.Circle) return; // rotation not meaningful for circles

    pushHistory(); // undo should revert this rotation

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

    transformLayer(selectedLayer, origin, centerLL, 1, newAngle);

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
