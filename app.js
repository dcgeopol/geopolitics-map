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

/* ===== UI ===== */
const stylePanel = document.getElementById("stylePanel");
toggleStyle.onclick = () => {
  stylePanel.style.display =
    stylePanel.style.display === "none" ? "flex" : "none";
};

/* ===== DRAW STORAGE ===== */
const drawnItems = new L.FeatureGroup().addTo(map);
const undoStack = [];
let selectedLayer = null;

/* ===== STYLE PERSISTENCE ===== */
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
  if (layer instanceof L.CircleMarker && layer.__style.radius)
    layer.setRadius(layer.__style.radius);
}

/* ===== SELECT ===== */
function makeSelectable(layer) {
  layer.on("click", () => selectedLayer = layer);
}
[
  strokeColor, strokeWidth, strokeOpacity,
  useFill, fillColor, fillOpacity,
  markerRadius, markerBorder
].forEach(el => el.oninput = () => applyStyle(selectedLayer));

/* ===== DRAW CONTROLS ===== */
new L.Control.Draw({
  draw: { polyline:true, polygon:true, rectangle:true, marker:true, circle:false },
  edit: { featureGroup: drawnItems }
}).addTo(map);

map.on(L.Draw.Event.CREATED, e => {
  let layer = e.layer;
  if (e.layerType === "marker") {
    const ll = layer.getLatLng();
    layer = L.circleMarker(ll, markerStyle());
  } else {
    layer.setStyle(currentStyle());
  }
  makeSelectable(layer);
  storeStyle(layer);
  drawnItems.addLayer(layer);
  undoStack.push(layer);
  selectedLayer = layer;
});

/* ===== EDIT FIX (NO STYLE REVERT) ===== */
map.on("draw:edited", e => e.layers.eachLayer(restoreStyle));
map.on("draw:editstop", () => drawnItems.eachLayer(restoreStyle));

/* ===== UNDO ===== */
undoBtn.onclick = () => {
  const last = undoStack.pop();
  if (last) drawnItems.removeLayer(last);
};

/* ===== MOVE MODE (NO PLUGIN) ===== */
let moveEnabled = false;
let dragLayer = null;
let dragStart = null;
let dragOrig = null;

moveBtn.onclick = () => {
  moveEnabled = !moveEnabled;
  moveBtn.textContent = moveEnabled ? "Move: ON" : "Move";
  moveEnabled ? map.dragging.disable() : map.dragging.enable();
};

function cloneLatLngs(lls) {
  return Array.isArray(lls) ? lls.map(cloneLatLngs) : L.latLng(lls.lat, lls.lng);
}
function offsetLatLngs(lls, dx, dy) {
  return Array.isArray(lls)
    ? lls.map(l => offsetLatLngs(l, dx, dy))
    : map.layerPointToLatLng(
        map.latLngToLayerPoint(lls).add([dx, dy])
      );
}

function startDrag(e, layer) {
  if (!moveEnabled) return;
  dragLayer = layer;
  dragStart = map.latLngToLayerPoint(e.latlng);
  dragOrig = layer instanceof L.CircleMarker
    ? layer.getLatLng()
    : cloneLatLngs(layer.getLatLngs());
}

function moveDrag(e) {
  if (!dragLayer) return;
  const p = map.latLngToLayerPoint(e.latlng);
  const d = p.subtract(dragStart);
  if (dragLayer instanceof L.CircleMarker) {
    dragLayer.setLatLng(
      map.layerPointToLatLng(
        map.latLngToLayerPoint(dragOrig).add(d)
      )
    );
  } else {
    dragLayer.setLatLngs(offsetLatLngs(dragOrig, d.x, d.y));
  }
}
function endDrag() {
  if (!dragLayer) return;
  storeStyle(dragLayer);
  dragLayer = null;
}

drawnItems.on("layeradd", e => {
  const l = e.layer;
  l.on("mousedown touchstart", ev => startDrag(ev, l));
});
map.on("mousemove touchmove", moveDrag);
map.on("mouseup touchend", endDrag);

// ===== RESIZE MODE =====
let resizeEnabled = false;
let resizeLayer = null;
let resizeStart = null;
let resizeOrig = null;

resizeBtn.onclick = () => {
  resizeEnabled = !resizeEnabled;
  resizeBtn.textContent = resizeEnabled ? "Resize: ON" : "Resize";
  resizeEnabled ? map.dragging.disable() : map.dragging.enable();
};

function getCentroid(layer) {
  if (layer instanceof L.CircleMarker) return layer.getLatLng();

  const latlngs = layer.getLatLngs().flat(Infinity);
  let lat = 0, lng = 0;
  latlngs.forEach(ll => { lat += ll.lat; lng += ll.lng; });
  return L.latLng(lat / latlngs.length, lng / latlngs.length);
}

function startResize(e, layer) {
  if (!resizeEnabled || layer !== selectedLayer) return;

  resizeLayer = layer;
  resizeStart = map.latLngToLayerPoint(e.latlng);

  resizeOrig = layer instanceof L.CircleMarker
    ? { center: layer.getLatLng(), radius: layer.getRadius() }
    : { center: getCentroid(layer), latlngs: cloneLatLngs(layer.getLatLngs()) };
}

function moveResize(e) {
  if (!resizeLayer) return;

  const p = map.latLngToLayerPoint(e.latlng);
  const factor = 1 + (p.y - resizeStart.y) / 300;

  if (resizeLayer instanceof L.CircleMarker) {
    resizeLayer.setRadius(Math.max(2, resizeOrig.radius * factor));
    return;
  }

  const centerPt = map.latLngToLayerPoint(resizeOrig.center);
  const newLatLngs = offsetLatLngs(
    resizeOrig.latlngs,
    0, 0
  ).map(ll => {
    const pt = map.latLngToLayerPoint(ll);
    return map.layerPointToLatLng(
      centerPt.add(pt.subtract(centerPt).multiplyBy(factor))
    );
  });

  resizeLayer.setLatLngs(newLatLngs);
}

function endResize() {
  if (!resizeLayer) return;
  storeStyle(resizeLayer);
  resizeLayer = null;
}

map.on("mousemove touchmove", moveResize);
map.on("mouseup touchend", endResize);

// Attach resize start to selectable layers
drawnItems.on("layeradd", e => {
  const l = e.layer;
  l.on("mousedown touchstart", ev => startResize(ev, l));
});


/* ===== FREE DRAW ===== */
let freeDraw = false;
let line = null;
let lastPt = null;
const MIN_DIST = 10;

freeDrawBtn.onclick = () => {
  freeDraw = !freeDraw;
  freeDrawBtn.textContent = freeDraw ? "Free Draw: ON" : "Free Draw";
  freeDraw ? map.dragging.disable() : map.dragging.enable();
};

map.on("mousedown touchstart", e => {
  if (!freeDraw) return;
  line = L.polyline([e.latlng], currentStyle()).addTo(drawnItems);
  makeSelectable(line);
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
map.on("mouseup touchend", () => {
  if (!line) return;
  undoStack.push(line);
  line = null;
});
