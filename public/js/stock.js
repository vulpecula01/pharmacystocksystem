let currentStock = [];
let selectedRow = null;

async function loadStores() {
  const stores = await apiGet('/api/stores');
  const sel = document.getElementById('storeSelect');
  sel.innerHTML = stores.map(s => `<option value="${s.store_id}">${s.store_name} (${s.store_type})</option>`).join('');
  if (stores.length) loadStock();
}

async function loadStock() {
  const storeId = document.getElementById('storeSelect').value;
  const q = document.getElementById('searchBox').value;
  if (!storeId) return;
  const rows = await apiGet(`/api/stock?storeId=${storeId}${q ? '&q=' + encodeURIComponent(q) : ''}`);
  currentStock = rows;
  renderStock(rows);
}

function renderStock(rows) {
  const tbody = document.querySelector('#stockTable tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="11" class="text-center text-muted py-4">ไม่มีข้อมูล</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((r, i) => {
    let rowClass = '';
    if (r.days_to_expire < 0) rowClass = 'expiring-row-EXPIRED';
    else if (r.days_to_expire <= 90) rowClass = 'expiring-row-NEAR_EXPIRED';
    return `<tr class="${rowClass}">
      <td>${r.drug_code}</td>
      <td>${r.drug_name}</td>
      <td>${r.strength_form || '-'}</td>
      <td>${r.unit}</td>
      <td>${r.lot_no}</td>
      <td>${fmtDate(r.expired_date)} ${r.days_to_expire < 0 ? '<span class="badge bg-danger">Expired</span>' : (r.days_to_expire<=90 ? '<span class="badge bg-warning text-dark">Near Expiry</span>' : '')}</td>
      <td class="text-end">${fmtNumber(r.qty_on_hand)}</td>
      <td class="text-end">${fmtMoney(r.unit_cost)}</td>
      <td class="text-end">${fmtMoney(r.stock_value)}</td>
      <td>${r.min_qty ?? '-'} / ${r.max_qty ?? '-'}</td>
      <td class="text-nowrap">
        <button class="btn btn-sm btn-outline-danger" onclick="openIssue(${i})">ตัดจ่าย</button>
        ${window.IS_ADMIN ? `<button class="btn btn-sm btn-outline-secondary" onclick="openEditLot(${i})" title="แก้ไข Lot/Expired Date"><i class="bi bi-pencil-square"></i></button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

function openIssue(i) {
  selectedRow = currentStock[i];
  document.getElementById('mDrugName').innerText = selectedRow.drug_name;
  document.getElementById('mDrugCode').innerText = selectedRow.drug_code;
  document.getElementById('mLot').innerText = selectedRow.lot_no;
  document.getElementById('mExpired').innerText = fmtDate(selectedRow.expired_date);
  document.getElementById('mOnHand').innerText = fmtNumber(selectedRow.qty_on_hand);
  document.getElementById('mQty').value = '';
  document.getElementById('mAfter').innerText = fmtNumber(selectedRow.qty_on_hand);
  new bootstrap.Modal(document.getElementById('issueModal')).show();
}

document.getElementById('mQty')?.addEventListener('input', (e) => {
  const qty = Number(e.target.value || 0);
  const after = Number(selectedRow.qty_on_hand) - qty;
  document.getElementById('mAfter').innerText = fmtNumber(after);
  document.getElementById('mAfter').className = after < 0 ? 'fw-semibold text-danger' : 'fw-semibold';
});

document.getElementById('confirmIssueBtn')?.addEventListener('click', async () => {
  const qty = Number(document.getElementById('mQty').value || 0);
  if (!qty || qty <= 0) return showToast('กรุณาระบุจำนวนที่ถูกต้อง', 'danger');
  if (qty > Number(selectedRow.qty_on_hand)) return showToast('จำนวนที่จ่ายมากกว่าคงเหลือ', 'danger');
  try {
    await apiSend('/api/stock/issue', 'POST', {
      storeId: document.getElementById('storeSelect').value,
      drugId: selectedRow.drug_id, lotId: selectedRow.lot_id, qty
    });
    bootstrap.Modal.getInstance(document.getElementById('issueModal')).hide();
    showToast('ตัดจ่ายสำเร็จ');
    loadStock();
  } catch (err) {
    showToast(err.message, 'danger');
  }
});

// ---------- แก้ไข Lot (Admin เท่านั้น) ----------
function toDateInputValue(d) {
  if (!d) return '';
  const date = new Date(d);
  return date.toISOString().slice(0, 10);
}

let editLotRow = null;

async function openEditLot(i) {
  editLotRow = currentStock[i];
  document.getElementById('elDrugName').innerText = editLotRow.drug_name;
  document.getElementById('elDrugCode').innerText = editLotRow.drug_code;
  document.getElementById('elLotId').value = editLotRow.lot_id;
  document.getElementById('elLotNo').value = editLotRow.lot_no;
  document.getElementById('elExpDate').value = toDateInputValue(editLotRow.expired_date);
  document.getElementById('elUnitCost').value = editLotRow.unit_cost;
  const usageBox = document.getElementById('elUsageWarning');
  const mergeBox = document.getElementById('elMergeWarning');
  usageBox.classList.add('d-none');
  mergeBox.classList.add('d-none');

  try {
    const { stores } = await apiGet(`/api/admin/lots/${editLotRow.lot_id}`);
    if (stores.length > 1) {
      usageBox.innerHTML = `<i class="bi bi-exclamation-triangle"></i> Lot นี้มีการถือครองอยู่ที่ <b>${stores.length} Store</b> พร้อมกัน ` +
        `(${stores.map(s => `${s.store_name}: ${fmtNumber(s.qty_on_hand)}`).join(', ')}) — การแก้ไขจะมีผลกับทุก Store ที่ถือ Lot นี้ เนื่องจากเป็นข้อมูลของก้อนยาก้อนเดียวกัน`;
      usageBox.classList.remove('d-none');
    }
  } catch (err) {
    // ไม่ต้องบล็อกการแก้ไขถ้าดึงข้อมูลการใช้งานไม่สำเร็จ
  }

  new bootstrap.Modal(document.getElementById('editLotModal')).show();
}

document.getElementById('confirmEditLotBtn')?.addEventListener('click', async () => {
  const lotId = document.getElementById('elLotId').value;
  const lotNo = document.getElementById('elLotNo').value.trim();
  const expiredDate = document.getElementById('elExpDate').value;
  const unitCost = document.getElementById('elUnitCost').value;
  if (!lotNo) return showToast('กรุณาระบุ Lot No.', 'danger');
  if (!expiredDate) return showToast('กรุณาระบุ Expired Date', 'danger');

  try {
    const result = await apiSend(`/api/admin/lots/${lotId}`, 'PUT', { lotNo, expiredDate, unitCost });
    bootstrap.Modal.getInstance(document.getElementById('editLotModal')).hide();
    if (result.merged) {
      showToast('บันทึกสำเร็จ — ค่าที่แก้ไขตรงกับ Lot ที่มีอยู่แล้ว ระบบได้รวมยอดคงเหลือเข้าด้วยกันให้อัตโนมัติ');
    } else {
      showToast('แก้ไข Lot สำเร็จ');
    }
    loadStock();
  } catch (err) {
    showToast(err.message, 'danger');
  }
});

document.getElementById('storeSelect')?.addEventListener('change', loadStock);
document.getElementById('searchBox')?.addEventListener('input', () => {
  clearTimeout(window._searchTimer);
  window._searchTimer = setTimeout(loadStock, 300);
});

// ---------- ค้นหายา (ใช้ร่วมกันทั้ง Modal รับยาเข้า และ FEFO) ----------
function wireDrugSearch(inputId, suggestId, hiddenId, labelId) {
  document.getElementById(inputId)?.addEventListener('input', async (e) => {
    const q = e.target.value.trim();
    const box = document.getElementById(suggestId);
    if (!q) { box.innerHTML = ''; return; }
    const drugs = await apiGet(`/api/drugs?q=${encodeURIComponent(q)}`);
    box.innerHTML = drugs.map(d => `<a href="#" class="list-group-item list-group-item-action py-1" data-id="${d.drug_id}" data-name="${d.drug_name} (${d.drug_code})">${d.drug_name} <small class="text-muted">${d.drug_code}</small></a>`).join('');
    box.querySelectorAll('a').forEach(a => a.addEventListener('click', (ev) => {
      ev.preventDefault();
      document.getElementById(hiddenId).value = a.dataset.id;
      document.getElementById(labelId).innerText = 'เลือก: ' + a.dataset.name;
      document.getElementById(inputId).value = '';
      box.innerHTML = '';
    }));
  });
}
wireDrugSearch('rDrugSearch', 'rDrugSuggest', 'rDrugId', 'rDrugLabel');
wireDrugSearch('fDrugSearch', 'fDrugSuggest', 'fDrugId', 'fDrugLabel');

// ---------- รับยาเข้า Stock ----------
document.getElementById('openReceiveBtn')?.addEventListener('click', () => {
  document.getElementById('rDrugId').value = '';
  document.getElementById('rDrugLabel').innerText = '';
  document.getElementById('rDrugSearch').value = '';
  document.getElementById('rLotNo').value = '';
  document.getElementById('rExpDate').value = '';
  document.getElementById('rUnitCost').value = '';
  document.getElementById('rQty').value = '';
  new bootstrap.Modal(document.getElementById('receiveModal')).show();
});

document.getElementById('confirmReceiveBtn')?.addEventListener('click', async () => {
  const drugId = document.getElementById('rDrugId').value;
  const expiredDate = document.getElementById('rExpDate').value;
  const qty = Number(document.getElementById('rQty').value || 0);
  if (!drugId) return showToast('กรุณาเลือกยาก่อน', 'danger');
  if (!expiredDate) return showToast('กรุณาระบุ Expired Date', 'danger');
  if (!qty || qty <= 0) return showToast('กรุณาระบุจำนวนที่ถูกต้อง', 'danger');

  try {
    const result = await apiSend('/api/stock/receive', 'POST', {
      storeId: document.getElementById('storeSelect').value,
      drugId,
      lotNo: document.getElementById('rLotNo').value,
      expiredDate,
      unitCost: Number(document.getElementById('rUnitCost').value || 0),
      qty
    });
    bootstrap.Modal.getInstance(document.getElementById('receiveModal')).hide();
    showToast(`รับยาเข้าสำเร็จ (Lot: ${result.lotNo})`);
    loadStock();
  } catch (err) {
    showToast(err.message, 'danger');
  }
});

// ---------- ตัดจ่าย FEFO ----------
document.getElementById('openFefoBtn')?.addEventListener('click', () => {
  document.getElementById('fDrugId').value = '';
  document.getElementById('fDrugLabel').innerText = '';
  document.getElementById('fDrugSearch').value = '';
  document.getElementById('fQty').value = '';
  new bootstrap.Modal(document.getElementById('fefoModal')).show();
});

document.getElementById('confirmFefoBtn')?.addEventListener('click', async () => {
  const drugId = document.getElementById('fDrugId').value;
  const qty = Number(document.getElementById('fQty').value || 0);
  if (!drugId) return showToast('กรุณาเลือกยาก่อน', 'danger');
  if (!qty || qty <= 0) return showToast('กรุณาระบุจำนวนที่ถูกต้อง', 'danger');

  try {
    const result = await apiSend('/api/stock/issue-fefo', 'POST', {
      storeId: document.getElementById('storeSelect').value,
      drugId, qty
    });
    bootstrap.Modal.getInstance(document.getElementById('fefoModal')).hide();
    const detail = result.allocations.map(a => `Lot ${a.lotNo} (${fmtDate(a.expiredDate)}): -${fmtNumber(a.qtyTaken)}`).join(', ');
    showToast(`ตัดจ่าย FEFO สำเร็จ — ${detail}`);
    loadStock();
  } catch (err) {
    showToast(err.message, 'danger');
  }
});

loadStores();
