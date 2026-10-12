const STATUS_LABEL = {
  PENDING: '<span class="badge bg-secondary">รอออกเดินทาง</span>',
  DEPARTED: '<span class="badge bg-primary">กำลังเดินทาง</span>',
  ARRIVED: '<span class="badge bg-info text-dark">ถึงที่หมายแล้ว (รอยืนยันรับ)</span>',
  DELIVERED: '<span class="badge bg-success">ส่งมอบสำเร็จ</span>',
  CANCELLED: '<span class="badge bg-dark">ยกเลิก</span>'
};

async function loadEligibleTransfers() {
  const rows = await apiGet('/api/delivery/eligible-transfers');
  const sel = document.getElementById('tTransfer');
  if (!rows.length) {
    sel.innerHTML = `<option value="">-- ไม่มี Transfer ที่พร้อมสร้างรอบส่งยา --</option>`;
    return;
  }
  sel.innerHTML = rows.map(r =>
    `<option value="${r.transfer_id}">${r.transfer_no}: ${r.from_store_name} → ${r.to_store_name} (${r.item_count} รายการ)</option>`
  ).join('');
}

async function loadDrivers() {
  const rows = await apiGet('/api/delivery/drivers');
  document.getElementById('tDriver').innerHTML = rows.map(r => `<option value="${r.user_id}">${r.full_name}</option>`).join('');
}

async function loadTrips() {
  const rows = await apiGet('/api/delivery/trips');
  const tbody = document.getElementById('tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">ยังไม่มีรอบส่งยา</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const trackUrl = `${window.location.origin}/track/${r.tracking_token}`;
    return `<tr>
      <td>${r.transfer_no}</td>
      <td>${r.from_store_name}</td>
      <td>${r.to_store_name}</td>
      <td>${r.driver_name}${r.vehicle_info ? ` <span class="text-muted small">(${r.vehicle_info})</span>` : ''}</td>
      <td>${STATUS_LABEL[r.status] || r.status}</td>
      <td>${r.distanceRemainingKm != null ? fmtNumber(r.distanceRemainingKm) + ' กม.' : '-'}</td>
      <td>${r.etaText || '-'}</td>
      <td><button class="btn btn-sm btn-outline-secondary" onclick="copyLink('${trackUrl}')"><i class="bi bi-clipboard"></i> คัดลอกลิงก์</button></td>
      <td><a class="btn btn-sm btn-outline-primary" href="/delivery/driver/${r.trip_id}"><i class="bi bi-phone"></i> หน้าคนขับ</a></td>
    </tr>`;
  }).join('');
}

function copyLink(url) {
  navigator.clipboard?.writeText(url).then(
    () => showToast('คัดลอกลิงก์ติดตามแล้ว — ส่งให้คลินิกทาง LINE/SMS ได้เลย'),
    () => showToast(url, 'info')
  );
}

document.getElementById('createBtn').addEventListener('click', async () => {
  const transferId = document.getElementById('tTransfer').value;
  const driverUserId = document.getElementById('tDriver').value;
  if (!transferId) return showToast('ไม่มี Transfer ให้เลือก', 'danger');
  if (!driverUserId) return showToast('กรุณาเลือกคนขับ', 'danger');
  try {
    const result = await apiSend('/api/delivery/trips', 'POST', {
      transferId, driverUserId,
      vehicleInfo: document.getElementById('tVehicle').value,
      avgSpeedKmh: document.getElementById('tSpeed').value || undefined
    });
    showToast('สร้างรอบส่งยาสำเร็จ');
    copyLink(`${window.location.origin}${result.trackingPath}`);
    document.getElementById('tVehicle').value = '';
    document.getElementById('tSpeed').value = '';
    loadEligibleTransfers();
    loadTrips();
  } catch (err) { showToast(err.message, 'danger'); }
});

loadEligibleTransfers();
loadDrivers();
loadTrips();
setInterval(loadTrips, 15000); // รีเฟรชสถานะ/ตำแหน่งอัตโนมัติทุก 15 วินาที
