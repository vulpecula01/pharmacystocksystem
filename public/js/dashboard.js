let storeSummaries = [];

const STATUS_TEXT = { RED: 'ต้องรีบจัดการ', YELLOW: 'ควรตรวจสอบ', GREEN: 'ปกติ' };

function renderStoreCards() {
  const grid = document.getElementById('storeCardGrid');
  if (!storeSummaries.length) {
    grid.innerHTML = `<div class="col-12 text-muted text-center py-4">ไม่พบ Store ที่คุณมีสิทธิ์เข้าถึง</div>`;
    return;
  }
  grid.innerHTML = storeSummaries.map(s => `
    <div class="col-md-4 col-sm-6">
      <div class="store-status-card status-${s.status}" onclick="openDetail(${s.storeId})">
        <div class="d-flex justify-content-between align-items-start">
          <div>
            <span class="status-dot status-dot-${s.status}"></span>
            <span class="fw-semibold">${s.storeName}</span>
          </div>
          <span class="badge bg-light text-dark border">${STATUS_TEXT[s.status]}</span>
        </div>
        <div class="small text-muted mt-2">
          ${s.expiredCount > 0 ? `<div class="text-danger">หมดอายุแล้ว: ${s.expiredCount} รายการ</div>` : ''}
          ${s.belowMinCount > 0 ? `<div class="text-danger">ต่ำกว่า Min: ${s.belowMinCount} รายการ</div>` : ''}
          ${s.nearExpiredCount > 0 ? `<div class="text-warning">ใกล้หมดอายุ: ${s.nearExpiredCount} รายการ</div>` : ''}
          ${s.aboveMaxCount > 0 ? `<div class="text-warning">เกิน Max: ${s.aboveMaxCount} รายการ</div>` : ''}
          ${s.pendingReplenishCount > 0 ? `<div>ใบขอเบิกที่รอจัด: ${s.pendingReplenishCount} ใบ</div>` : ''}
          ${s.status === 'GREEN' ? `<div class="text-success">ทุกรายการอยู่ในเกณฑ์ปกติ</div>` : ''}
        </div>
      </div>
    </div>`).join('');
}

async function loadSummary() {
  storeSummaries = await apiGet('/api/dashboard/store-summary');
  renderStoreCards();
  // ถ้ามี Store เดียว (กรณีปกติของแผนก Floor Stock ส่วนใหญ่) เปิดรายละเอียดให้เห็นทันทีโดยไม่ต้องคลิก
  if (storeSummaries.length === 1) openDetail(storeSummaries[0].storeId);
}

function itemRow(cols) {
  return `<tr>${cols.map(c => `<td>${c}</td>`).join('')}</tr>`;
}

async function openDetail(storeId) {
  const store = storeSummaries.find(s => s.storeId === storeId);
  const detail = await apiGet(`/api/dashboard/store-summary/${storeId}/detail`);

  document.getElementById('detailStoreName').innerText = store ? store.storeName : `Store #${storeId}`;

  const expiredBody = document.getElementById('expiredBody');
  expiredBody.innerHTML = detail.expiredItems.length
    ? detail.expiredItems.map(it => itemRow([
        `${it.drug_name} <small class="text-muted">${it.drug_code}</small>`,
        `Lot ${it.lot_no}`, fmtDate(it.expired_date),
        `<span class="text-danger">${it.days_to_expire} วัน</span>`
      ])).join('')
    : `<tr><td class="text-muted">ไม่มีรายการ</td></tr>`;

  const nearBody = document.getElementById('nearExpiredBody');
  nearBody.innerHTML = detail.nearExpiredItems.length
    ? detail.nearExpiredItems.map(it => itemRow([
        `${it.drug_name} <small class="text-muted">${it.drug_code}</small>`,
        `Lot ${it.lot_no}`, fmtDate(it.expired_date),
        `เหลืออีก ${it.days_to_expire} วัน`
      ])).join('')
    : `<tr><td class="text-muted">ไม่มีรายการ</td></tr>`;

  const belowMinBody = document.getElementById('belowMinBody');
  belowMinBody.innerHTML = detail.belowMinItems.length
    ? detail.belowMinItems.map(it => itemRow([
        `${it.drug_name} <small class="text-muted">${it.drug_code}</small>`,
        `คงเหลือ ${fmtNumber(it.qty_on_hand)} ${it.unit}`,
        `Min ${fmtNumber(it.min_qty)}`
      ])).join('')
    : `<tr><td class="text-muted">ไม่มีรายการ</td></tr>`;

  const aboveMaxBody = document.getElementById('aboveMaxBody');
  aboveMaxBody.innerHTML = detail.aboveMaxItems.length
    ? detail.aboveMaxItems.map(it => itemRow([
        `${it.drug_name} <small class="text-muted">${it.drug_code}</small>`,
        `คงเหลือ ${fmtNumber(it.qty_on_hand)} ${it.unit}`,
        `Max ${fmtNumber(it.max_qty)}`
      ])).join('')
    : `<tr><td class="text-muted">ไม่มีรายการ</td></tr>`;

  const note = document.getElementById('pendingReplenishNote');
  if (detail.pendingReplenish.length) {
    note.classList.remove('d-none');
    note.innerHTML = `<i class="bi bi-hourglass-split"></i> มีใบขอเบิกอัตโนมัติที่ยังรอ Main Pharmacy จัดให้อยู่ ${detail.pendingReplenish.length} ใบ — <a href="/replenishment">ดูรายการ</a>`;
  } else {
    note.classList.add('d-none');
  }

  document.getElementById('detailPanel').classList.remove('d-none');
  document.getElementById('detailPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

document.getElementById('closeDetailBtn')?.addEventListener('click', () => {
  document.getElementById('detailPanel').classList.add('d-none');
});

loadSummary();
