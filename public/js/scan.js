let html5QrCode = null;
let currentLots = [];
let selectedLot = null;

async function loadStores() {
  const stores = await apiGet('/api/stores');
  const sel = document.getElementById('storeSelect');
  sel.innerHTML = stores.map(s => `<option value="${s.store_id}">${s.store_name} (${s.store_type})</option>`).join('');
}

async function doLookup(code) {
  const storeId = document.getElementById('storeSelect').value;
  if (!storeId) return showToast('กรุณาเลือก Store', 'danger');
  try {
    const result = await apiGet(`/api/stock/lookup?storeId=${storeId}&code=${encodeURIComponent(code)}`);
    currentLots = result.lots;
    document.getElementById('resDrugName').innerText = `${result.drug.drug_name} (${result.drug.drug_code})`;
    document.getElementById('resDrugMeta').innerText = `${result.drug.strength_form || ''} - หน่วย: ${result.drug.unit}`;
    const tbody = document.getElementById('lotTableBody');
    if (!result.lots.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">ไม่มี Stock ของยานี้ใน Store ที่เลือก</td></tr>`;
    } else {
      tbody.innerHTML = result.lots.map((l, i) => `
        <tr class="${l.days_to_expire < 0 ? 'expiring-row-EXPIRED' : (l.days_to_expire <= 90 ? 'expiring-row-NEAR_EXPIRED' : '')}">
          <td>${l.lot_no}</td>
          <td>${fmtDate(l.expired_date)}</td>
          <td class="text-end">${fmtNumber(l.qty_on_hand)}</td>
          <td><button class="btn btn-sm btn-outline-danger" onclick="openIssue(${i})">ตัดจ่าย</button></td>
        </tr>`).join('');
    }
    document.getElementById('resultCard').style.display = '';
    document.getElementById('emptyState').style.display = 'none';
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

function openIssue(i) {
  selectedLot = currentLots[i];
  document.getElementById('mLot').innerText = selectedLot.lot_no;
  document.getElementById('mExpired').innerText = fmtDate(selectedLot.expired_date);
  document.getElementById('mOnHand').innerText = fmtNumber(selectedLot.qty_on_hand);
  document.getElementById('mQty').value = '';
  document.getElementById('mAfter').innerText = fmtNumber(selectedLot.qty_on_hand);
  new bootstrap.Modal(document.getElementById('issueModal')).show();
}

document.getElementById('mQty')?.addEventListener('input', e => {
  const qty = Number(e.target.value || 0);
  document.getElementById('mAfter').innerText = fmtNumber(Number(selectedLot.qty_on_hand) - qty);
});

document.getElementById('confirmIssueBtn')?.addEventListener('click', async () => {
  const qty = Number(document.getElementById('mQty').value || 0);
  if (!qty || qty <= 0) return showToast('กรุณาระบุจำนวนที่ถูกต้อง', 'danger');
  try {
    await apiSend('/api/stock/issue', 'POST', {
      storeId: document.getElementById('storeSelect').value,
      drugId: selectedLot.drug_id, lotId: selectedLot.lot_id, qty
    });
    bootstrap.Modal.getInstance(document.getElementById('issueModal')).hide();
    showToast('ตัดจ่ายสำเร็จ');
    doLookup(selectedLot.drug_code);
  } catch (err) {
    showToast(err.message, 'danger');
  }
});

document.getElementById('manualLookupBtn')?.addEventListener('click', () => {
  const code = document.getElementById('manualCode').value.trim();
  if (code) doLookup(code);
});
document.getElementById('manualCode')?.addEventListener('keypress', e => {
  if (e.key === 'Enter') document.getElementById('manualLookupBtn').click();
});

// ---------- แจ้งเตือนตอนสแกนสำเร็จ (เสียง+สั่น) กันไม่ให้สแกนซ้ำโค้ดเดิมรัวๆ ----------
let lastScanCode = null;
let lastScanAt = 0;
const SCAN_COOLDOWN_MS = 2000;

// จำกัดรูปแบบบาร์โค้ดที่ต้องถอดรหัสเฉพาะที่ใช้จริงในเภสัชกรรม (QR + บาร์โค้ด 1 มิติที่พบบนกล่องยาทั่วไป)
// ช่วยให้สแกนเจอเร็วขึ้น/แม่นขึ้น เพราะไลบรารีไม่ต้องเสียเวลาลองถอดรหัสทุกรูปแบบที่รองรับ
function getScanFormatsConfig() {
  if (typeof Html5QrcodeSupportedFormats === 'undefined') return {}; // เผื่อเวอร์ชันไลบรารีไม่มี constant นี้ - ใช้ค่า default ของไลบรารีแทน
  return {
    formatsToSupport: [
      Html5QrcodeSupportedFormats.QR_CODE,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.CODABAR,
      Html5QrcodeSupportedFormats.ITF
    ]
  };
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    osc.onended = () => ctx.close();
  } catch (e) { /* ไม่ต้องบล็อกถ้าเบราว์เซอร์ไม่รองรับ Web Audio */ }
  if (navigator.vibrate) navigator.vibrate(80);
}

function onScanSuccess(decodedText) {
  const now = Date.now();
  if (decodedText === lastScanCode && (now - lastScanAt) < SCAN_COOLDOWN_MS) return; // กันสแกนซ้ำโค้ดเดิมรัวๆ ระหว่างยังส่องกล้องอยู่ที่เดิม
  lastScanCode = decodedText;
  lastScanAt = now;
  playBeep();
  doLookup(decodedText);
}

// ---------- เลือกกล้อง (มือถือส่วนใหญ่มีทั้งกล้องหน้า/หลัง - ให้เลือกเองได้เผื่อ auto-detect ผิดตัว) ----------
async function populateCameraSelect() {
  const sel = document.getElementById('cameraSelect');
  try {
    const cameras = await Html5Qrcode.getCameras();
    if (cameras && cameras.length > 1) {
      sel.innerHTML = cameras.map(c => `<option value="${c.id}">${c.label || 'กล้อง ' + c.id}</option>`).join('');
      // เดาว่ากล้องหลัง (back/rear) น่าจะเหมาะกับการสแกนมากกว่ากล้องหน้า - เลือกไว้ให้ก่อนถ้าเจอ
      const backCam = cameras.find(c => /back|rear|environment/i.test(c.label || ''));
      if (backCam) sel.value = backCam.id;
      sel.classList.remove('d-none');
      return cameras;
    }
    sel.classList.add('d-none');
    return cameras;
  } catch (err) {
    sel.classList.add('d-none');
    return []; // ดึงรายชื่อกล้องไม่ได้ (เช่น ยังไม่อนุญาต permission) - จะ fallback ไปใช้ facingMode แทน
  }
}

document.getElementById('startScanBtn')?.addEventListener('click', async () => {
  const startBtn = document.getElementById('startScanBtn');
  const stopBtn = document.getElementById('stopScanBtn');
  const statusBox = document.getElementById('scanStatus');
  startBtn.disabled = true;

  html5QrCode = new Html5Qrcode('qr-reader');
  const cameras = await populateCameraSelect();
  const selectedCameraId = document.getElementById('cameraSelect').value;
  const cameraConfig = (cameras && cameras.length && selectedCameraId) ? selectedCameraId : { facingMode: 'environment' };

  html5QrCode.start(
    cameraConfig,
    { fps: 10, qrbox: 220, ...getScanFormatsConfig() },
    onScanSuccess,
    () => {} // callback ตอนยังหาโค้ดไม่เจอในเฟรมนั้นๆ - ไม่ต้องทำอะไร (เรียกบ่อยเป็นปกติ)
  ).then(() => {
    startBtn.classList.add('d-none');
    stopBtn.classList.remove('d-none');
    statusBox.classList.remove('d-none');
  }).catch(err => {
    showToast('ไม่สามารถเปิดกล้องได้ - ตรวจสอบว่าอนุญาต (Allow) สิทธิ์กล้องแล้ว และเข้าเว็บผ่าน HTTPS: ' + err, 'danger');
  }).finally(() => { startBtn.disabled = false; });
});

document.getElementById('cameraSelect')?.addEventListener('change', async () => {
  // สลับกล้องระหว่างที่กำลังสแกนอยู่: หยุดตัวเดิมแล้วเปิดใหม่ด้วยกล้องที่เลือก
  if (!html5QrCode) return;
  const selectedCameraId = document.getElementById('cameraSelect').value;
  try {
    await html5QrCode.stop();
    await html5QrCode.start(
      selectedCameraId,
      { fps: 10, qrbox: 220, ...getScanFormatsConfig() },
      onScanSuccess,
      () => {}
    );
  } catch (err) {
    showToast('สลับกล้องไม่สำเร็จ: ' + err, 'danger');
  }
});

document.getElementById('stopScanBtn')?.addEventListener('click', () => {
  if (html5QrCode) {
    html5QrCode.stop().then(() => {
      document.getElementById('startScanBtn').classList.remove('d-none');
      document.getElementById('stopScanBtn').classList.add('d-none');
      document.getElementById('scanStatus').classList.add('d-none');
    });
  }
});

loadStores();
