const map = L.map("map", {
  worldCopyJump: true,               // <- key: only one world visible while panning wraps
  minZoom: 2,                        // prevents zooming out to see repeated worlds
  maxBounds: [[-85, -180], [85, 180]],
  maxBoundsViscosity: 1.0
}).setView([20, 0], 2);




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
