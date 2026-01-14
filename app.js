const map = L.map("map", {
  worldCopyJump: true, // wrap like a cylinder but keep one world visible
  minZoom: 2
}).setView([20, 0], 2);

// Clamp latitude so you can't drift vertically into empty space
map.on("move", () => {
  const c = map.getCenter();
  const clampedLat = Math.max(-85, Math.min(85, c.lat));
  if (c.lat !== clampedLat) map.panTo([clampedLat, c.lng], { animate: false });
});





L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap"
}).addTo(map);

let markers = [];

fetch("data.json")
  .then(res => res.json())
  .then(data => {
    const dateInput = document.getElementById("date");
    dateInput.value = "2026-01-13";

    function render(date) {
      markers.forEach(m => map.removeLayer(m));
      markers = [];

      data.filter(d => d.date === date).forEach(d => {
        const m = L.marker(d.coords)
          .addTo(map)
          .bindPopup(`<b>${d.country}</b><br>${d.type}<br>${d.text}`);
        markers.push(m);
      });
    }

    render(dateInput.value);
    dateInput.addEventListener("change", e => render(e.target.value));
  });
