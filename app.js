const map = L.map("map", {
  minZoom: 2,
  zoomSnap: 0.25,   // smaller zoom increments
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
  const strokeColor = document.getElementById("strokeColor").value;
  const strokeWidth = +document.getElementById("strokeWidth").value;
  const strokeOpacity = +document.getElementById("strokeOpacity").value;

  const useFill = document.getElementById("useFill").checked;
  const fillColor = document.getElementById("fillColor").value;
  const fillOpacity = +document.getElementById("fillOpacity").value;

  return {
    color: strokeColor,
    weight: strokeWidth,
    opacity: strokeOpacity,
    fill: useFill,
    fillColor: fillColor,
    fillOpacity: fillOpacity
  };
}

function markerStyle() {
  const base = currentStyle();
  return {
    ...base,
    radius: +document.getElementById("markerRadius").value,
    weight: +document.getElementById("markerBorder").value
  };
}

// Toggle panel button
const toggleBtn = document.getElementById("toggleStyle");
const stylePanel = document.getElementById("stylePanel");
if (toggleBtn && stylePanel) {
  toggleBtn.onclick = () => {
    stylePanel.style.display = (stylePanel.style.display === "none" || !stylePanel.style.display)
      ? "flex"
      : "none";
  };
}

// ===== DRAW / ANNOTATION LAYER =====
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

// Undo stack for drawings
const undoStack = [];

// Draw control with style defaults (uses your current panel settings at draw time)
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

// Auto-show the style panel when you start drawing
map.on("draw:drawstart", () => {
  if (stylePanel) stylePanel.style.display = "flex";
});

// When a shape is drawn, apply current styles
map.on(L.Draw.Event.CREATED, function (e) {
  let layer = e.layer;

  // Convert draw "marker" into a CircleMarker so you can style radius/border/fill
  if (e.layerType === "marker") {
    const ll = layer.getLatLng();
    layer = L.circleMarker([ll.lat, ll.lng], markerStyle());
  } else {
    layer.setStyle(currentStyle());
  }

  drawnItems.addLayer(layer);
  undoStack.push(layer);
});

// ===== UNDO BUTTON =====
const undoBtn = document.getElementById("undoBtn");
if (undoBtn) {
  undoBtn.onclick = () => {
    const last = undoStack.pop();
    if (last) drawnItems.removeLayer(last);
  };
}

// ===== FREE DRAW TOOL (FINGER/MOUSE) =====
let freehand = null;
let freehandEnabled = false;

const freeDrawBtn = document.getElementById("freeDrawBtn");
if (freeDrawBtn) {
  freeDrawBtn.onclick = () => {
    freehandEnabled = !freehandEnabled;
    freeDrawBtn.textContent = freehandEnabled ? "Free Draw: ON" : "Free Draw";

    if (freehandEnabled) {
      if (!freehand) {
        freehand = new L.FreeHandShapes({
          polyline: currentStyle(),
          polygon: currentStyle()
        }).addTo(map);

        freehand.on("drawing:complete", (e) => {
          // Add finished freehand drawing into your editable layer group
          if (e.layer && e.layer.setStyle) e.layer.setStyle(currentStyle());
          drawnItems.addLayer(e.layer);
          undoStack.push(e.layer);
        });
      }
      freehand.setMode(true);
    } else {
      if (freehand) freehand.setMode(false);
    }
  };
}

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
