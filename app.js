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

// ===== STYLE PANEL =====
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

const toggleBtn = document.getElementById("toggleStyle");
const stylePanel = document.getElementById("stylePanel");
if (toggleBtn && stylePanel) {
  toggleBtn.addEventListener("click", (e) => {
    e.preventDefault();
    stylePanel.style.display =
      (stylePanel.style.display === "none" || !stylePanel.style.display) ? "flex" : "none";
  });
}

// ===== DRAW LAYERS =====
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

const undoStack = [];
let selectedLayer = null;

// Store/reapply style so it DOESN’T revert after “Save”
function storeStyle(layer) {
  if (!layer) return;
  layer.__savedStyle = (layer instanceof L.CircleMarker) ? markerStyle() : currentStyle();
}
function reapplyStoredStyle(layer) {
  if (!layer || !layer.__savedStyle) return;

  if (layer instanceof L.CircleMarker) {
    layer.setStyle(layer.__savedStyle);
    if (typeof layer.__savedStyle.radius === "number") layer.setRadius(layer.__savedStyle.radius);
  } else if (layer.setStyle) {
    layer.setStyle(layer.__savedStyle);
  }
}

function applyStyleToLayer(layer) {
  if (!layer) return;

  if (layer instanceof L.CircleMarker) {
    const s = markerStyle();
    layer.setStyle(s);
    layer.setRadius(+document.getElementById("markerRadius").value);
    layer.__savedStyle = s;
    return;
  }

  if (layer.setStyle) {
    const s = currentStyle();
    layer.setStyle(s);
    layer.__savedStyle = s;
  }
}

function makeSelectable(layer) {
  if (!layer) return;
  layer.off("click");
  layer.on("click", () => setSelected(layer));
}

// ===== MOVE MODE (drag whole shape/line) =====
let moveEnabled = false;
const moveBtn = document.getElementById("moveBtn");

function canDragLayer(layer) {
  return layer && layer.dragging && layer.dragging.enable && layer.dragging.disable;
}

function setMoveMode(on) {
  moveEnabled = on;
  if (moveBtn) moveBtn.textContent = on ? "Move: ON" : "Move";

  // Turn off map panning while moving shapes
  if (on) map.dragging.disable();
  else map.dragging.enable();

  // Only drag the selected layer
  drawnItems.eachLayer(l => {
    if (canDragLayer(l)) l.dragging.disable();
  });

  if (on && selectedLayer && canDragLayer(selectedLayer)) {
    selectedLayer.dragging.enable();
  }
}

if (moveBtn) {
  moveBtn.addEventListener("click", (e) => {
    e.preventDefault();
    setMoveMode(!moveEnabled);
  });
}

function setSelected(layer) {
  selectedLayer = layer;

  // If Move mode is on, switch dragging to the newly selected layer
  if (moveEnabled) {
    drawnItems.eachLayer(l => {
      if (canDragLayer(l)) l.dragging.disable();
    });
    if (selectedLayer && canDragLayer(selectedLayer)) selectedLayer.dragging.enable();
  }
}

// Panel changes restyle selected layer (input + change)
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

// ===== Leaflet Draw controls =====
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

map.on("draw:drawstart", () => {
  if (stylePanel) stylePanel.style.display = "flex";
});

// ===== Simplify helpers (reduces handles) =====
function simplifyPolylineLayer(layer, tolerancePx = 8) {
  if (!layer || !layer.getLatLngs) return;
  const latlngs = layer.getLatLngs();
  if (!Array.isArray(latlngs) || latlngs.length < 3) return;

  const pts = latlngs.map(ll => map.latLngToLayerPoint(ll));
  const simplified = L.LineUtil.simplify(pts, tolerancePx);
  const newLatLngs = simplified.map(p => map.layerPointToLatLng(p));
  layer.setLatLngs(newLatLngs);
}

// ===== Created shapes =====
map.on(L.Draw.Event.CREATED, function (e) {
  let layer = e.layer;

  if (e.layerType === "marker") {
    const ll = layer.getLatLng();
    layer = L.circleMarker([ll.lat, ll.lng], markerStyle());
  } else {
    layer.setStyle(currentStyle());
  }

  // Reduce handles for regular polylines a bit
  if (e.layerType === "polyline") simplifyPolylineLayer(layer, 8);

  makeSelectable(layer);
  drawnItems.addLayer(layer);

  // Persist style snapshot
  storeStyle(layer);

  undoStack.push(layer);
  setSelected(layer);

  // If move mode already ON, enable dragging for this selected layer (if supported)
  if (moveEnabled && canDragLayer(layer)) layer.dragging.enable();
});

// ===== Edit lifecycle: keep style from reverting =====
map.on("draw:editstop", () => {
  // Reapply saved style so nothing reverts visually
  drawnItems.eachLayer(reapplyStoredStyle);
});

map.on("draw:edited", (evt) => {
  evt.layers.eachLayer((layer) => {
    makeSelectable(layer);

    // If it’s a polyline, simplify again after edit
    if (layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
      simplifyPolylineLayer(layer, 8);
    }

    // Reapply saved style (prevents revert)
    reapplyStoredStyle(layer);
  });
});

// ===== UNDO =====
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

// ===== FREE DRAW (smoother curves) =====
let freeDrawEnabled = false;
let drawing = false;
let activeLine = null;
let lastPointPx = null;

// Smaller spacing => smoother lines (less “octagon”)
const MIN_POINT_DIST_PX = 10;

const freeDrawBtn = document.getElementById("freeDrawBtn");
if (freeDrawBtn) {
  freeDrawBtn.addEventListener("click", (e) => {
    e.preventDefault();
    freeDrawEnabled = !freeDrawEnabled;
    freeDrawBtn.textContent = freeDrawEnabled ? "Free Draw: ON" : "Free Draw";

    if (freeDrawEnabled && stylePanel) stylePanel.style.display = "flex";

    // In free draw mode, disable map drag so finger draws
    if (freeDrawEnabled) map.dragging.disable();
    else if (!moveEnabled) map.dragging.enable();
  });
}

function startFreeDraw(e) {
  if (!freeDrawEnabled) return;
  drawing = true;

  const ll = e.latlng;
  activeLine = L.polyline([ll], currentStyle()).addTo(drawnItems);
  makeSelectable(activeLine);
  setSelected(activeLine);

  storeStyle(activeLine);
  lastPointPx = map.latLngToLayerPoint(ll);
}

function moveFreeDraw(e) {
  if (!freeDrawEnabled || !drawing || !activeLine) return;

  const ll = e.latlng;
  const p = map.latLngToLayerPoint(ll);

  if (!lastPointPx || p.distanceTo(lastPointPx) >= MIN_POINT_DIST_PX) {
    activeLine.addLatLng(ll);
    lastPointPx = p;
  }
}

function endFreeDraw() {
  if (!freeDrawEnabled || !drawing || !activeLine) return;
  drawing = false;

  // Light simplify => smooth curves but fewer handles
  simplifyPolylineLayer(activeLine, 8);

  undoStack.push(activeLine);
  activeLine = null;
  lastPointPx = null;
}

map.on("mousedown touchstart", startFreeDraw);
map.on("mousemove touchmove", moveFreeDraw);
map.on("mouseup touchend touchcancel", endFreeDraw);

// ===== EVENT MARKERS (from data.json) =====
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
