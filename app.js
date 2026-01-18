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
let lastSnapshotJson = "";
let snapshotTimer = null;

// Debounced snapshot to avoid 1000 snapshots while dragging
function pushHistoryDebounced(delayMs = 120) {
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    pushHistory();
    snapshotTimer = null;
  }, delayMs);
}

function pushHistory() {
  const state = serializeState();
  const json = JSON.stringify(state);
  if (json === lastSnapshotJson) return; // no-op
  history.push(state);
  lastSnapshotJson = json;
  if (history.length > 250) history.shift();
}

function undo() {
  if (history.length < 1) return;
  const prev = history.pop();
  lastSnapshotJson = JSON.stringify(prev);
  restoreState(prev);
  hideTransformHandles();
  selectedLayer = null;
}

undoBtn.onclick = undo;

/* ===== Marker icon (colorable SVG pin) ===== */
function makePinIcon(color, opacity) {
  const fill = color || "#ff0000";
  const op = (opacity == null) ? 1 : opacity;

  // Simple pin SVG; sized like default Leaflet marker
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

/* ===== Marker label helper ===== */
function setMarkerLabel(marker, text) {
  marker.__label = text || "";
  // permanent tooltip shown above marker
  marker.unbindTooltip();
  if (marker.__label.trim()) {
    marker.bindTooltip(marker.__label, {
      permanent: true,
      direction: "top",
      offset: [0, -38],
      className: "marker-label"
    }).openTooltip();
  }
}

/* ===== Serialize / restore ALL drawings ===== */
function serializeState() {
  const layers = [];
  drawnItems.eachLayer(layer => {
    // Colored marker pin
    if (layer instanceof L.Marker && !(layer instanceof L.CircleMarker)) {
      layers.push({
        type: "marker",
        latlng: layer.getLatLng(),
        label: layer.__label || "",
        markerColor: layer.__markerColor || "#ff0000",
        markerOpacity: layer.__markerOpacity ?? 1
      });
      return;
    }

    // Circle SHAPE
    if (layer instanceof L.Circle) {
      layers.push({
        type: "circle",
        latlng: layer.getLatLng(),
        radius: layer.getRadius(),
        style: {
          color: layer.options.color,
          weight: layer.options.weight,
          opacity: layer.options.opacity,
          fill: layer.options.fill,
          fillColor: layer.options.fillColor,
          fillOpacity: layer.options.fillOpacity
        }
      });
      return;
    }

    // Polyline / Polygon / Rectangle
    if (layer instanceof L.Polyline) {
      layers.push({
        type: layer instanceof L.Polygon ? "polygon" : "polyline",
        latlngs: layer.getLatLngs(),
        style: {
          color: layer.options.color,
          weight: layer.options.weight,
          opacity: layer.options.opacity,
          fill: layer.options.fill,
          fillColor: layer.options.fillColor,
          fillOpacity: layer.options.fillOpacity
        },
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
      layer = L.marker(obj.latlng, {
        icon: makePinIcon(obj.markerColor, obj.markerOpacity)
      });
      layer.__markerColor = obj.markerColor;
      layer.__markerOpacity = obj.markerOpacity;

      setMarkerLabel(layer, obj.label);

      layer.on("click", () => selectLayer(layer));
      layer.on("dblclick", () => {
        const next = prompt("Marker label:", layer.__label || "") ?? (layer.__label || "");
        pushHistory();
        setMarkerLabel(layer, next);
      });

      drawnItems.addLayer(layer);
      return;
    }

    if (obj.type === "circle") {
      layer = L.circle(obj.latlng, { ...obj.style, radius: obj.radius });
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

/* ===== Apply style (shapes + marker color) ===== */
function applyStyle(layer) {
  if (!layer) return;

  // Marker: recolor icon using strokeColor + strokeOpacity
  if (layer instanceof L.Marker && !(layer instanceof L.CircleMarker)) {
    const c = strokeColor.value;
    const op = +strokeOpacity.value;
    layer.__markerColor = c;
    layer.__markerOpacity = op;
    layer.setIcon(makePinIcon(c, op));
    return;
  }

  // Circle / Polyline / Polygon
  if (layer.setStyle) {
    layer.setStyle(currentStyle());
  }
}

/* ===== Select layer ===== */
function selectLayer(layer) {
  selectedLayer = layer;
  if (moveEnabled) showTransformHandles();
}

/* ===== Panel changes: undoable ===== */
[
  strokeColor, strokeWidth, strokeOpacity,
  useFill, fillColor, fillOpacity
].forEach(el => {
  el.addEventListener("input", () => {
    if (!selectedLayer) return;
    pushHistoryDebounced();
    applyStyle(selectedLayer);
    if (moveEnabled) showTransformHandles();
  });
});

/* ===== Leaflet Draw: DRAW ONLY =====
   We can’t fully remove the circleMarker tool button via options,
   but we can prevent it from persisting if it’s created.
*/
new L.Control.Draw({
  draw: {
    polyline: true,
    polygon: true,
    rectangle: true,
    circle: true,
    marker: true,
    circlemarker: true // button may still show; we will immediately discard output
  },
  edit: false
}).addTo(map);

map.on(L.Draw.Event.CREATED, e => {
  // If user used circleMarker tool, discard it (effectively "removed")
  if (e.layerType === "circlemarker") {
    return;
  }

  pushHistory(); // creation is undoable

  let layer = e.layer;

  // Marker tool => colorable pin + prompt label
  if (e.layerType === "marker") {
    layer = L.marker(layer.getLatLng(), {
      icon: makePinIcon(strokeColor.value, +strokeOpacity.value)
    });

    layer.__markerColor = strokeColor.value;
    layer.__markerOpacity = +strokeOpacity.value;

    const label = prompt("Marker label (optional):", "") || "";
    setMarkerLabel(layer, label);

    layer.on("click", () => selectLayer(layer));
    layer.on("dblclick", () => {
      const next = prompt("Marker label:", layer.__label || "") ?? (layer.__label || "");
      pushHistory();
      setMarkerLabel(layer, next);
    });

    drawnItems.addLayer(layer);
    selectLayer(layer);
    return;
  }

  // Circle tool => circle SHAPE (keep drawn radius)
  if (e.layerType === "circle") {
    layer.setStyle(currentStyle());
    layer.on("click", () => selectLayer(layer));
    drawnItems.addLayer(layer);
    selectLayer(layer);
    return;
  }

  // Other shapes
  layer.setStyle(currentStyle());
  layer.on("click", () => selectLayer(layer));
  layer.__angleRad = 0;
  drawnItems.addLayer(layer);
  selectLayer(layer);
});

/* ===== FREE DRAW ===== */
let freeDraw = false;
let line = null;
let lastPt = null;
const MIN_DIST = 10;

freeDrawBtn.onclick = () => {
  freeDraw = !freeDraw;
  freeDrawBtn.textContent = freeDraw ? "Free Draw: ON" : "Free Draw";
  if (freeDraw) map.dragging.disable();
  else if (!moveEnabled) map.dragging.enable();
};

map.on("mousedown touchstart", e => {
  if (!freeDraw) return;
  pushHistory();
  line = L.polyline([e.latlng], currentStyle()).addTo(drawnItems);
  line.on("click", () => selectLayer(line));
  line.__angleRad = 0;
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
   TRANSFORM HANDLES (Move + Resize + Rotate)
   ======================================================================= */

let moveEnabled = false;

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

  const rot = L.latLng(ne.lat + (b.getNorth() - b.getSouth()) * 0.15 + 1, ne.lng);
  hRotate = L.circleMarker(rot, { ...handleStyle, radius: 7 }).addTo(transformGroup);

  wireMoveOnTarget(selectedLayer);
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

function transformLayer(layer, origin, centerLL, scale, angleRad) {
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

  if (layer instanceof L.Circle) {
    const baseR = origin.radius;
    layer.setRadius(Math.max(2, baseR * scale));
    return;
  }

  const newLLs = mapLatLngs(origin, xformPoint);
  layer.setLatLngs(newLLs);
}

/* ---------- Handle interactions (ALL undoable) ---------- */
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
    if (selectedLayer instanceof L.Circle) return;

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
