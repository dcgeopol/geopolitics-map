const map = L.map("map", {
  minZoom: 2,
  zoomSnap: 0.25,
  zoomDelta: 0.25
}).setView([20, 0], 2);

// Clamp latitude + normalize longitude (cylinder behavior, no wrap-jump blink)
map.on("moveend", () => {
  const c = map.getCenter();
  const clampedLat = Math.max(-85, Math.min(85, c.lat));

  let lng = c.lng;
  while (lng > 180) lng -= 360;
  while (lng < -180) lng += 360;

  if (clampedLat !== c.lat || lng !== c.lng) {
    map.panTo([clampedLat, lng], { animate: false });
  }
});

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap"
}).addTo(map);

// ===== STYLE PANEL HELPERS =====
function currentStyle() {
  return {
    color: document.getElementById("strokeColor").value,
    weight: +document.getElementById("strokeWidth").value,
    opacity: +document.getElementById("strokeOpacity").value,
    fill: document.getElementById("useFill").checked,
    fillColor: document.getElementById("fillColor").value,
    fillOpacity: +document.getElementById("fillOpacity").value
  };
}

function markerStyle() {
  const s = currentStyle();
  return {
    ...s,
    radius: +document.getElementById("markerRadius").value,
    weight: +document.getElementById("markerBorder").value
  };
}

// ===== UI (Style toggle) =====
const toggleBtn = document.getElementById("toggleStyle");
const stylePanel = document.getElementById("stylePanel");
if (toggleBtn && stylePanel) {
  toggleBtn.addEventListener("click", (e) => {
    e.preventDefault();
    stylePanel.style.display =
      (stylePanel.style.display === "none" || !stylePanel.style.display) ? "flex" : "none";
  });
}

// ===== DRAW / ANNOTATION LAYER =====
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

// Undo stack
const undoStack = [];

// Selected layer (for restyling)
let selectedLayer = null;
function setSelected(layer) {
  selectedLayer = layer;
}

// Apply style to a layer
function applyStyleToLayer(layer) {
  if (!layer) return;

  if (layer instanceof L.CircleMarker) {
    layer.setStyle(markerStyle());
    layer.setRadius(+document.getElementById("markerRadius").value);
    return;
  }

  if (layer.setStyle) {
    layer.setStyle(currentStyle());
  }
}

// Bind click selection to a layer (so panel changes work)
function makeSelectable(layer) {
  if (!layer) return;
  layer.off("click");
  layer.on("click", () => setSelected(layer));
}

// When panel changes, restyle the selected layer (use both input + change)
[
  "strokeColor","strokeWidth","strokeOpacity",
  "useFill","fillColor","fillOpacity",
  "markerRadius","markerBorder"
].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("input", () => applyStyleToLayer(selectedLayer));
  el.addEventListener("change", () => applyStyleToLayer(selectedLayer));
});

// Draw control (NOTE: Leaflet Draw will still show handles, but we will reduce vertices)
const drawControl = new L.Control.Draw({
  draw: {
    polyline: true,
    polygon: true,
    rectangle: true,
    circle: false,
    marker: true
  },
  edit: {
    featureGroup: drawnItems
  }
});
map.addControl(drawControl);

// Auto-show style panel when drawing starts
map.on("draw:drawstart", () => {
  if (stylePanel) stylePanel.style.display = "flex";
});

// ===== Polyline simplification (reduces edit handles) =====
function simplifyPolylineLayer(layer, tolerancePx = 6) {
  if (!layer || !layer.getLatLngs) return;
  const latlngs = layer.getLatLngs();
  if (!Array.isArray(latlngs) || latlngs.length < 3) return;

  // Convert to pixel points, simplify, convert back
  const pts = latlngs.map(ll => map.latLngToLayerPoint(ll));
  const simplified = L.LineUtil.simplify(pts, tolerancePx);
  const newLatLngs = simplified.map(p => map.layerPointToLatLng(p));

  layer.setLatLngs(newLatLngs);
}

// When a shape is drawn, apply current styles + make selectable + simplify polylines
map.on(L.Draw.Event.CREATED, function (e) {
  let layer = e.layer;

  if (e.layerType === "marker") {
    const ll = layer.getLatLng();
    layer = L.circleMarker([ll.lat, ll.lng], markerStyle());
  } else {
    layer.setStyle(currentStyle());
  }

  // Reduce handles for drawn polylines
  if (e.layerType === "polyline") {
    simplifyPolylineLayer(layer, 6);
  }

  makeSelectable(layer);

  drawnItems.addLayer(layer);
  undoStack.push(layer);
  setSelected(layer);
});

// After edits are saved, rebind selection and keep styles (and simplify edited polylines)
map.on("draw:edited", (evt) => {
  evt.layers.eachLayer((layer) => {
    makeSelectable(layer);
    // Keep whatever style you want: apply current panel style to selected only,
    // but simplify any polyline edits to prevent handle explosion
    if (layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
      simplifyPolylineLayer(layer, 6);
    }
  });
});

// ===== UNDO BUTTON =====
const undoBtn = document.getElementById("undoBtn");
if (undoBtn) {
  undoBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const last = undoStack.pop();
    if (last) {
      drawnItems.removeLayer(last);
      if (selectedLayer === last) selectedLayer = null;
    }
  });
}

// ===== FREE DRAW (reduced points + simplify) =====
let freeDrawEnabled = false;
let activeLine = null;
let drawing = false;
let lastAddedPoint = null;

const freeDrawBtn = document.getElementById("freeDrawBtn");
if (freeDrawBtn) {
  freeDrawBtn.addEventListener("click", (e) => {
    e.preventDefault();
    freeDrawEnabled = !freeDrawEnabled;
    freeDrawBtn.textContent = freeDrawEnabled ? "Free Draw: ON" : "Free Draw";

    if (freeDrawEnabled && stylePanel) stylePanel.style.display = "flex";

    // Draw mode: disable dragging so finger/mouse draws
    if (freeDrawEnabled) map.dragging.disable();
    else map.dragging.enable();
  });
}

// Only add a new point if we moved at least N pixels (prevents huge vertex counts)
const MIN_POINT_DIST_PX = 10;

function startFreeDraw(e) {
  if (!freeDrawEnabled) return;
  drawing = true;

  const ll = e.latlng;
  activeLine = L.polyline([ll], currentStyle()).addTo(drawnItems);
  makeSelectable(activeLine);
  setSelected(activeLine);

  lastAddedPoint = map.latLngToLayerPoint(ll);
}

function moveFreeDraw(e) {
  if (!freeDrawEnabled || !drawing || !activeLine) return;

  const ll = e.latlng;
  const p = map.latLngToLayerPoint(ll);

  if (!lastAddedPoint || p.distanceTo(lastAddedPoint) >= MIN_POINT_DIST_PX) {
    activeLine.addLatLng(ll);
    lastAddedPoint = p;
  }
}

function endFreeDraw() {
  if (!freeDrawEnabled || !drawing || !activeLine) return;
  drawing = false;

  // Simplify line to reduce edit handles
  simplifyPolylineLayer(activeLine, 8);

  undoStack.push(activeLine);
  activeLine = null;
  lastAddedPoint = null;
}

map.on("mousedown touchstart", startFreeDraw);
map.on("mousemove touchmove", moveFreeDraw);
map.on("mouseup touchend touchcancel", endFreeDraw);

// ===== EVENT MARKERS (from data.json) =====
const markerLayer = L.layerGroup().addTo(map);
let markers = [];

fetch("data.json")
  .then(res => res.json())
  .then(data => {
    const dateInput = document.getElementById("date");
    dateInput.value = "2026-01-13";

    function render(date) {
      markerLayer.clearLayers();
      markers = [];

      data.filter(d => d.date === date).forEach(d => {
        const [lat, lng] = d.coords;
        [-360, 0, 360].forEach(offset => {
          const m = L.marker([lat, lng + offset])
            .addTo(markerLayer)
            .bindPopup(`<b>${d.country}</b><br>${d.type}<br>${d.text}`);
          markers.push(m);
        });
      });
    }

    render(dateInput.value);
    dateInput.addEventListener("change", e => render(e.target.value));
  });
