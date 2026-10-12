const STATUS_LABEL = {
  PENDING: { text: 'รอออกเดินทาง', cls: 'bg-secondary' },
  DEPARTED: { text: 'กำลังเดินทาง', cls: 'bg-primary' },
  ARRIVED: { text: 'ถึงที่หมายแล้ว', cls: 'bg-info text-dark' },
  DELIVERED: { text: 'ส่งมอบสำเร็จ', cls: 'bg-success' },
  CANCELLED: { text: 'ยกเลิก', cls: 'bg-dark' }
};

function fmtNum(n) {
  const num = Number(n);
  return Number.isFinite(num) ? num.toLocaleString('th-TH', { maximumFractionDigits: 1 }) : n;
}

function showMsg(text, type = 'success') {
  const box = document.getElementById('toast');
  box.className = `alert alert-${type}`;
  box.innerText = text;
  box.classList.remove('d-none');
}

let map = null;
let currentMarker = null;
let clinicMarker = null;
let trailLine = null;
let pollTimer = null;

function ensureMap(lat, lng) {
  if (map) return;
  map = L.map('map').setView([lat || 13.7563, lng || 100.5018], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);
}

async function refresh() {
  let data;
  try {
    const res = await fetch(`/api/track/${window.TRACK_TOKEN}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'ไม่พบข้อมูลการติดตามนี้');
    }
    data = await res.json();
  } catch (err) {
    document.getElementById('map').innerHTML = '';
    showMsg(err.message, 'danger');
    if (pollTimer) clearInterval(pollTimer);
    return;
  }

  document.getElementById('transferNo').innerText = data.transferNo;
  document.getElementById('fromStore').innerText = data.fromStoreName;
  document.getElementById('toStore').innerText = data.toStoreName + (data.clinicAddress ? ` (${data.clinicAddress})` : '');

  const st = STATUS_LABEL[data.trip.status] || { text: data.trip.status, cls: 'bg-secondary' };
  document.getElementById('statusBadge').innerHTML = `<span class="badge ${st.cls}">${st.text}</span>`;

  document.getElementById('etaLine').innerText =
    data.distanceRemainingKm != null
      ? `เหลืออีกประมาณ ${fmtNum(data.distanceRemainingKm)} กม. (${data.etaText || 'ยังไม่ทราบ ETA'})`
      : (data.trip.status === 'PENDING' ? 'ยังไม่เริ่มเดินทาง' : '');

  document.getElementById('itemsList').innerHTML = data.items.map(it =>
    `<li class="list-group-item d-flex justify-content-between px-0">
       <span>${it.drug_name}</span><span class="text-muted">${fmtNum(it.qty_transfer)} ${it.unit}</span>
     </li>`
  ).join('');

  // แผนที่
  const hasClinicCoord = data.clinicLat !== null && data.clinicLat !== undefined;
  const hasCurrentCoord = data.trip.lastLat !== null && data.trip.lastLat !== undefined;
  if (hasClinicCoord || hasCurrentCoord) {
    ensureMap(
      hasCurrentCoord ? data.trip.lastLat : data.clinicLat,
      hasCurrentCoord ? data.trip.lastLng : data.clinicLng
    );

    if (hasClinicCoord) {
      if (!clinicMarker) {
        clinicMarker = L.marker([data.clinicLat, data.clinicLng], {
          icon: L.divIcon({ className: '', html: '<div style="font-size:24px">🏥</div>', iconSize: [24, 24] })
        }).addTo(map).bindPopup(data.toStoreName);
      }
    }
    if (hasCurrentCoord) {
      if (!currentMarker) {
        currentMarker = L.marker([data.trip.lastLat, data.trip.lastLng], {
          icon: L.divIcon({ className: '', html: '<div style="font-size:24px">🚚</div>', iconSize: [24, 24] })
        }).addTo(map);
      } else {
        currentMarker.setLatLng([data.trip.lastLat, data.trip.lastLng]);
      }
      map.panTo([data.trip.lastLat, data.trip.lastLng]);
    }
    if (data.trail && data.trail.length > 1) {
      const latlngs = data.trail.map(p => [p.lat, p.lng]);
      if (trailLine) trailLine.setLatLngs(latlngs);
      else trailLine = L.polyline(latlngs, { color: '#0d6efd', weight: 3 }).addTo(map);
    }
  } else {
    document.getElementById('map').innerHTML =
      '<div class="d-flex align-items-center justify-content-center h-100 text-muted small border rounded">ยังไม่มีข้อมูลตำแหน่ง GPS</div>';
  }

  // ซ่อนปุ่มยืนยันถ้าจบรอบแล้ว
  const confirmCard = document.getElementById('confirmCard');
  if (data.trip.status === 'DELIVERED') {
    confirmCard.innerHTML = '<div class="card-body text-success"><i class="bi bi-check-circle-fill"></i> ยืนยันรับยาเรียบร้อยแล้ว ขอบคุณครับ/ค่ะ</div>';
    if (pollTimer) clearInterval(pollTimer);
  } else if (data.trip.status === 'CANCELLED') {
    confirmCard.innerHTML = '<div class="card-body text-muted"><i class="bi bi-x-circle"></i> รอบการส่งยานี้ถูกยกเลิก</div>';
    if (pollTimer) clearInterval(pollTimer);
  }
}

document.getElementById('confirmBtn')?.addEventListener('click', async () => {
  const receiverName = document.getElementById('receiverName').value;
  document.getElementById('confirmBtn').disabled = true;
  try {
    const res = await fetch(`/api/track/${window.TRACK_TOKEN}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receiverName })
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'ยืนยันไม่สำเร็จ');
    showMsg('ยืนยันรับยาเรียบร้อยแล้ว ขอบคุณครับ/ค่ะ');
    refresh();
  } catch (err) {
    showMsg(err.message, 'danger');
    document.getElementById('confirmBtn').disabled = false;
  }
});

refresh();
pollTimer = setInterval(refresh, 10000);
