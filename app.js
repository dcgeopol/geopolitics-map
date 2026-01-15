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

// Selected layer (for restyling existing drawings)
let selectedLayer = null;
function setSelected(layer) {
  selectedLayer = layer;
}

// Apply current style to a layer
function applyStyleToLayer(layer) {
  if (!layer) return;

  // CircleMarker: radius + border
  if (layer instanceof L.CircleMarker) {
    layer.setStyle(markerStyle());
    layer.setRadius(+document.getElementById("markerRadius").value);
    return;
  }

  // Paths (polyline/polygon/rectangle)
  if (layer.setStyle) {
    layer.setStyle(currentStyle());
  }
}

// When panel changes, restyle the selected layer immediately
[
  "strokeColor","strokeWidth","strokeOpacity",
  "useFill","fillColor","fillOpacity",
  "markerRadius","markerBorder"
].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("input", () => applyStyleToLayer(selectedLayer));
});

// Draw control
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

// When a shape is drawn, apply current styles and make it selectable
map.on(L.Draw.Event.CREATED, function (e) {
  let layer = e.layer;

  // Convert draw "marker" into CircleMarker so size/border/fill works
  if (e.layerType === "marker") {
    const ll = layer.getLatLng();
    layer = L.circleMarker([ll.lat, ll.lng], markerStyle());
  } else {
    layer.setStyle(currentStyle());
  }

  layer.on("click", () => setSelected(layer));

  drawnItems.addLayer(layer);
  undoStack.push(layer);
  setSelected(layer);
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

// ===== FREE DRAW (no plugin; works on mouse + touch) =====
let freeDrawEnabled = false;
let activeLine = null;
let drawing = false;

const freeDrawBtn = document.getElementById("freeDrawBtn");
if (freeDrawBtn) {
  freeDrawBtn.addEventListener("click", (e) => {
    e.preventDefault();
    freeDrawEnabled = !freeDrawEnabled;
    freeDrawBtn.textContent = freeDrawEnabled ? "Free Draw: ON" : "Free Draw";

    // When enabling, show style panel so you can set stroke/opacity
    if (freeDrawEnabled && stylePanel) stylePanel.style.display = "flex";

    // Disable map drag while drawing mode is enabled (so finger draws instead of panning)
    if (freeDrawEnabled) map.dragging.disable();
    else map.dragging.enable();
  });
}

function startFreeDraw(e) {
  if (!freeDrawEnabled) return;
  drawing = true;

  const latlng = e.latlng;
  activeLine = L.polyline([latlng], currentStyle()).addTo(drawnItems);
  activeLine.on("click", () => setSelected(activeLine));
  setSelected(activeLine);
}

function moveFreeDraw(e) {
  if (!freeDrawEnabled || !drawing || !activeLine) return;
  activeLine.addLatLng(e.latlng);
}

function endFreeDraw() {
  if (!freeDrawEnabled || !drawing || !activeLine) return;
  drawing = false;

  // Save to undo stack
  undoStack.push(activeLine);

  // If you want free-draw to be filled polygons later, we can add that.
  activeLine = null;
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
