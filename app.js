const map = L.map("map", {
  minZoom: 2,
  zoomSnap: 0.25,   // smaller zoom increments
  zoomDelta: 0.25
}).setView([20, 0], 2);


// Clamp latitude + normalize longitude (cylinder behavior, no wrap-jump blink)
map.on("moveend", () => {
  const c = map.getCenter();

  // clamp latitude
  const clampedLat = Math.max(-85, Math.min(85, c.lat));

  // normalize longitude into [-180, 180]
  let lng = c.lng;
  while (lng > 180) lng -= 360;
  while (lng < -180) lng += 360;

  // only pan if something changed
  if (clampedLat !== c.lat || lng !== c.lng) {
    map.panTo([clampedLat, lng], { animate: false });
  }
});







L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap"
}).addTo(map);

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
  // 3 wrapped copies so markers persist across world wrap (cylinder effect)
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
