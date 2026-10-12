let currentPreview = []; // รายการพรีวิวก่อนสร้างใบขอเบิก (จาก previewAutoRequest)
let currentRequests = [];
let activeReqId = null;

const REPL_STATUS_LABEL = {
  PENDING: 'รอจัด',
  FULFILLED: 'จัดแล้ว',
  CANCELLED: 'ยกเลิก'
};
const REPL_STATUS_BADGE_CLASS = {
  PENDING: 'bg-warning text-dark',
  FULFILLED: 'bg-success',
  CANCELLED: 'bg-secondary'
};
function replStatusBadge(status) {
  return `<span class="badge ${REPL_STATUS_BADGE_CLASS[status] || 'bg-secondary'}">${REPL_STATUS_LABEL[status] || status}</span>`;
}

async function loadStores() {
  const stores = await apiGet('/api/stores');
  const sel = document.getElementById('storeSelect');
  sel.innerHTML = stores.map(s => `<option value="${s.store_id}">${s.store_name} (${s.store_type})</option>`).join('');
}

async function loadRequests() {
  const rows = await apiGet('/api/replenishment/requests');
  currentRequests = rows;
  renderRequests(rows);
}

function renderRequests(rows) {
  const tbody = document.querySelector('#requestTable tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">ยังไม่มีใบขอเบิก</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const actions = [];
    if (r.status === 'PENDING') {
      if (window.IS_ADMIN) {
        actions.push(`<button class="btn btn-sm btn-primary" onclick="openFulfill(${r.request_id})"><i class="bi bi-truck"></i> จัดใบขอเบิก</button>`);
      }
      actions.push(`<button class="btn btn-sm btn-outline-danger" onclick="openCancelReq(${r.request_id})">ยกเลิก</button>`);
    }
    return `<tr>
      <td>#${r.request_id}</td>
      <td>${r.store_name}</td>
      <td>${r.item_count}</td>
      <td>${replStatusBadge(r.status)}</td>
      <td>${r.created_by_name}</td>
      <td>${fmtDateTime(r.created_at)}</td>
      <td>${r.fulfilled_transfer_no ? `<a href="/transfers/${r.fulfilled_transfer_id}">${r.fulfilled_transfer_no}</a>` : '-'}</td>
      <td class="text-nowrap">${actions.join(' ')}</td>
    </tr>`;
  }).join('');
}

// ---------- สร้างใบขอเบิกอัตโนมัติ ----------
document.getElementById('createRequestBtn')?.addEventListener('click', async () => {
  const storeId = document.getElementById('storeSelect').value;
  if (!storeId) return showToast('กรุณาเลือก Store ก่อน', 'danger');
  try {
    currentPreview = await apiGet(`/api/replenishment/preview?storeId=${storeId}`);
  } catch (err) {
    return showToast(err.message, 'danger');
  }
  document.getElementById('creqRemark').value = '';
  renderCreqTable();
  new bootstrap.Modal(document.getElementById('createReqModal')).show();
});

function renderCreqTable() {
  const tbody = document.querySelector('#creqTable tbody');
  const emptyBox = document.getElementById('creqEmpty');
  if (!currentPreview.length) {
    tbody.innerHTML = '';
    emptyBox.classList.remove('d-none');
    document.getElementById('confirmCreateReqBtn').disabled = true;
    return;
  }
  emptyBox.classList.add('d-none');
  document.getElementById('confirmCreateReqBtn').disabled = false;
  tbody.innerHTML = currentPreview.map((r, i) => `
    <tr>
      <td><input type="checkbox" class="form-check-input creq-chk" data-i="${i}" checked></td>
      <td>${r.drug_name} <small class="text-muted">${r.drug_code}</small></td>
      <td class="text-end">${fmtNumber(r.qty_on_hand)} ${r.unit}</td>
      <td class="text-end">${r.min_qty ?? '-'} / ${r.max_qty ?? '-'}</td>
      <td class="text-end"><input type="number" min="0.01" step="0.01" class="form-control form-control-sm creq-qty" data-i="${i}" value="${r.suggested_qty}"></td>
    </tr>`).join('');
}

document.getElementById('confirmCreateReqBtn')?.addEventListener('click', async () => {
  const storeId = document.getElementById('storeSelect').value;
  const items = [];
  document.querySelectorAll('.creq-chk').forEach(chk => {
    if (!chk.checked) return;
    const i = Number(chk.dataset.i);
    const qtyInput = document.querySelector(`.creq-qty[data-i="${i}"]`);
    const qty = Number(qtyInput.value || 0);
    if (qty <= 0) return;
    const r = currentPreview[i];
    items.push({ drugId: r.drug_id, qtyRequested: qty, qtyOnHand: r.qty_on_hand, minQty: r.min_qty, maxQty: r.max_qty });
  });
  if (!items.length) return showToast('กรุณาเลือกรายการอย่างน้อย 1 รายการ', 'danger');

  try {
    await apiSend('/api/replenishment/requests', 'POST', { storeId, items, remark: document.getElementById('creqRemark').value });
    bootstrap.Modal.getInstance(document.getElementById('createReqModal')).hide();
    showToast('สร้างใบขอเบิกสำเร็จ ส่งไป Main Pharmacy แล้ว');
    loadRequests();
  } catch (err) {
    showToast(err.message, 'danger');
  }
});

// ---------- จัดใบขอเบิก (Admin / Main Pharmacy) ----------
async function openFulfill(requestId) {
  activeReqId = requestId;
  document.getElementById('fReqId').innerText = requestId;
  let preview;
  try {
    preview = await apiGet(`/api/replenishment/requests/${requestId}/fulfill-preview`);
  } catch (err) {
    return showToast(err.message, 'danger');
  }
  const tbody = document.querySelector('#fulfillTable tbody');
  tbody.innerHTML = preview.items.map(it => `
    <tr>
      <td>${it.drugName} <small class="text-muted">${it.drugCode}</small></td>
      <td class="text-end">${fmtNumber(it.qtyRequested)} ${it.unit}</td>
      <td class="text-end">${fmtNumber(it.qtyAvailable)}</td>
      <td class="text-end ${it.shortfall > 0 ? 'text-danger fw-semibold' : ''}">${fmtNumber(it.qtyAllocatable)}</td>
      <td class="small">${it.allocations.map(a => `Lot ${a.lotNo} (หมดอายุ ${fmtDate(a.expiredDate)}): ${fmtNumber(a.qty)}`).join('<br>') || '-'}</td>
    </tr>`).join('');
  const hasShortfall = preview.items.some(it => it.shortfall > 0);
  document.getElementById('fShortfallWarning').classList.toggle('d-none', !hasShortfall);
  new bootstrap.Modal(document.getElementById('fulfillModal')).show();
}

document.getElementById('confirmFulfillBtn')?.addEventListener('click', async () => {
  try {
    const result = await apiSend(`/api/replenishment/requests/${activeReqId}/fulfill`, 'POST');
    bootstrap.Modal.getInstance(document.getElementById('fulfillModal')).hide();
    showToast(result.hasShortfall
      ? `จัดใบขอเบิกสำเร็จ (Transfer ${result.transferNo}) — บางรายการสต๊อกไม่พอ จัดให้เท่าที่มี`
      : `จัดใบขอเบิกสำเร็จ (Transfer ${result.transferNo})`);
    loadRequests();
  } catch (err) {
    showToast(err.message, 'danger');
  }
});

// ---------- ยกเลิกใบขอเบิก ----------
function openCancelReq(requestId) {
  activeReqId = requestId;
  document.getElementById('cancelReason').value = '';
  new bootstrap.Modal(document.getElementById('cancelReqModal')).show();
}

document.getElementById('confirmCancelReqBtn')?.addEventListener('click', async () => {
  try {
    await apiSend(`/api/replenishment/requests/${activeReqId}/cancel`, 'POST', { reason: document.getElementById('cancelReason').value });
    bootstrap.Modal.getInstance(document.getElementById('cancelReqModal')).hide();
    showToast('ยกเลิกใบขอเบิกสำเร็จ');
    loadRequests();
  } catch (err) {
    showToast(err.message, 'danger');
  }
});

loadStores();
loadRequests();
