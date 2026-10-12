const STATUS_LABEL = {
  PENDING: 'รอออกเดินทาง',
  DEPARTED: 'กำลังเดินทาง (กำลังส่งพิกัด GPS ทุก 30 วินาที)',
  ARRIVED: 'ถึงที่หมายแล้ว - รอคลินิกกดยืนยันรับยาที่ลิงก์ติดตาม',
  DELIVERED: 'ส่งมอบสำเร็จแล้ว',
  CANCELLED: 'ยกเลิกแล้ว'
};

let positionTimer = null;
let currentTrip = null;

if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
  document.getElementById('httpsWarning').classList.remove('d-none');
}

async function loadTrip() {
  const { trip, clinic, trackingUrl } = await apiGet(`/api/delivery/trips/${window.TRIP_ID}/driver-view`);
  currentTrip = trip;
  document.getElementById('clinicName').innerText = clinic?.store_name || '-';
  document.getElementById('clinicAddress').innerText = clinic?.address || '';
  document.getElementById('statusLabel').innerText = STATUS_LABEL[trip.status] || trip.status;
  document.getElementById('trackLinkBox').innerHTML =
    `ลิงก์ติดตามสำหรับคลินิก: <a href="${trackingUrl}" target="_blank">${window.location.origin}${trackingUrl}</a>`;

  document.getElementById('departBtn').classList.toggle('d-none', trip.status !== 'PENDING');
  document.getElementById('arriveBtn').classList.toggle('d-none', trip.status !== 'DEPARTED');
  document.getElementById('cancelBtn').classList.toggle('d-none', !['PENDING', 'DEPARTED'].includes(trip.status));

  if (trip.status === 'DEPARTED') startSendingPosition();
  else stopSendingPosition();
}

function startSendingPosition() {
  if (positionTimer) return;
  sendPositionOnce();
  positionTimer = setInterval(sendPositionOnce, 30000);
}
function stopSendingPosition() {
  if (positionTimer) { clearInterval(positionTimer); positionTimer = null; }
}

function sendPositionOnce() {
  if (!navigator.geolocation) return showToast('เบราว์เซอร์นี้ไม่รองรับ GPS', 'danger');
  navigator.geolocation.getCurrentPosition(async (pos) => {
    try {
      const result = await apiSend(`/api/delivery/trips/${window.TRIP_ID}/position`, 'POST', {
        lat: pos.coords.latitude, lng: pos.coords.longitude
      });
      document.getElementById('etaLine').innerHTML =
        `<i class="bi bi-signpost-2"></i> เหลืออีกประมาณ ${result.distanceRemainingKm != null ? fmtNumber(result.distanceRemainingKm) + ' กม.' : '-'}` +
        ` (${result.etaText || 'ยังไม่ทราบ ETA'})`;
    } catch (err) { showToast(err.message, 'danger'); }
  }, (err) => {
    showToast('ไม่สามารถอ่านพิกัด GPS ได้: ' + err.message, 'danger');
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
}

document.getElementById('departBtn').addEventListener('click', async () => {
  try {
    await apiSend(`/api/delivery/trips/${window.TRIP_ID}/status`, 'POST', { status: 'DEPARTED' });
    showToast('เริ่มเดินทางแล้ว กำลังส่งพิกัด GPS ให้ระบบทุก 30 วินาที');
    loadTrip();
  } catch (err) { showToast(err.message, 'danger'); }
});

document.getElementById('arriveBtn').addEventListener('click', async () => {
  try {
    await apiSend(`/api/delivery/trips/${window.TRIP_ID}/status`, 'POST', { status: 'ARRIVED' });
    showToast('บันทึกว่าถึงที่หมายแล้ว รอคลินิกกดยืนยันรับยาที่ลิงก์ติดตาม');
    loadTrip();
  } catch (err) { showToast(err.message, 'danger'); }
});

document.getElementById('cancelBtn').addEventListener('click', async () => {
  const reason = prompt('เหตุผลที่ยกเลิก (ไม่บังคับ):') || '';
  try {
    await apiSend(`/api/delivery/trips/${window.TRIP_ID}/status`, 'POST', { status: 'CANCELLED', cancelReason: reason });
    showToast('ยกเลิกรอบส่งยานี้แล้ว');
    loadTrip();
  } catch (err) { showToast(err.message, 'danger'); }
});

loadTrip();
