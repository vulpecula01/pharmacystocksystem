let items = [];
let currentLots = [];

async function loadStores() {
  const stores = await apiGet('/api/stores');
  const opts = stores.map(s => `<option value="${s.store_id}">${s.store_name} (${s.store_type})</option>`).join('');
  document.getElementById('fromStore').innerHTML = '<option value="">-- เลือก Store ต้นทาง --</option>' + opts;
  document.getElementById('toStore').innerHTML = opts;
}

function resetDrugSelection() {
  document.getElementById('selectedDrugId').value = '';
  document.getElementById('selectedDrugLabel').innerText = '';
  document.getElementById('drugSearch').value = '';
  document.getElementById('lotSelect').innerHTML = '<option value="">-- เลือกยาก่อน --</option>';
  document.getElementById('lotAvailableLabel').innerText = '';
  document.getElementById('qty').value = '';
  currentLots = [];
}

// ต้องเลือก Store ต้นทางก่อน ถึงจะค้นหายาได้ (ป้องกันเลือกยาที่ไม่มีใน Store นั้น)
document.getElementById('fromStore').addEventListener('change', () => {
  const hasStore = !!document.getElementById('fromStore').value;
  document.getElementById('drugSearch').disabled = !hasStore;
  resetDrugSelection();
});

document.getElementById('drugSearch').addEventListener('input', async (e) => {
  const q = e.target.value.trim();
  const box = document.getElementById('drugSuggest');
  const fromStoreId = document.getElementById('fromStore').value;
  if (!q || !fromStoreId) { box.innerHTML = ''; return; }

  // ค้นหาเฉพาะยาที่มี Stock อยู่จริงใน Store ต้นทาง (ไม่ใช่ยาทั้งหมดในระบบ)
  const stockRows = await apiGet(`/api/stock?storeId=${fromStoreId}&q=${encodeURIComponent(q)}`);
  const uniqueDrugs = [];
  const seen = new Set();
  for (const r of stockRows) {
    if (!seen.has(r.drug_id)) { seen.add(r.drug_id); uniqueDrugs.push(r); }
  }
  if (!uniqueDrugs.length) {
    box.innerHTML = `<div class="list-group-item text-muted small">ไม่พบยาที่มี Stock ใน Store นี้</div>`;
    return;
  }
  box.innerHTML = uniqueDrugs.map(d => `<a href="#" class="list-group-item list-group-item-action py-1" data-id="${d.drug_id}" data-name="${d.drug_name} (${d.drug_code})">${d.drug_name} <small class="text-muted">${d.drug_code}</small></a>`).join('');
  box.querySelectorAll('a').forEach(a => a.addEventListener('click', async (ev) => {
    ev.preventDefault();
    document.getElementById('selectedDrugId').value = a.dataset.id;
    document.getElementById('selectedDrugLabel').innerText = 'เลือก: ' + a.dataset.name;
    document.getElementById('drugSearch').value = '';
    box.innerHTML = '';
    await loadLotsForSelectedDrug();
  }));
});

async function loadLotsForSelectedDrug() {
  const fromStoreId = document.getElementById('fromStore').value;
  const drugId = document.getElementById('selectedDrugId').value;
  const lotSelect = document.getElementById('lotSelect');
  if (!fromStoreId || !drugId) return;

  currentLots = await apiGet(`/api/stock/lots?storeId=${fromStoreId}&drugId=${drugId}`);
  if (!currentLots.length) {
    lotSelect.innerHTML = '<option value="">-- ไม่มี Stock ของยานี้ใน Store ต้นทาง --</option>';
    lotSelect.disabled = true;
    document.getElementById('qty').disabled = true;
    return;
  }
  lotSelect.disabled = false;
  lotSelect.innerHTML = '<option value="">-- เลือก Lot --</option>' + currentLots.map((l, i) =>
    `<option value="${i}">${l.lot_no} | Exp: ${l.expired_date} | คงเหลือ ${fmtNumber(l.qty_on_hand)}</option>`
  ).join('');
}

document.getElementById('lotSelect').addEventListener('change', (e) => {
  const idx = e.target.value;
  const qtyInput = document.getElementById('qty');
  if (idx === '') {
    document.getElementById('lotAvailableLabel').innerText = '';
    qtyInput.disabled = true;
    return;
  }
  const lot = currentLots[idx];
  document.getElementById('lotAvailableLabel').innerText = `คงเหลือใน Lot นี้: ${fmtNumber(lot.qty_on_hand)} (Expired: ${fmtDate(lot.expired_date)}, ราคาต้นทุน: ${fmtMoney(lot.unit_cost)})`;
  qtyInput.disabled = false;
  qtyInput.max = lot.qty_on_hand;
});

document.getElementById('addItemBtn').addEventListener('click', () => {
  const drugId = document.getElementById('selectedDrugId').value;
  const drugLabel = document.getElementById('selectedDrugLabel').innerText.replace('เลือก: ', '');
  const lotIdx = document.getElementById('lotSelect').value;
  const qty = Number(document.getElementById('qty').value || 0);

  if (!drugId) return showToast('กรุณาเลือกยาก่อน', 'danger');
  if (lotIdx === '') return showToast('กรุณาเลือก Lot', 'danger');
  const lot = currentLots[lotIdx];
  if (!qty || qty <= 0) return showToast('กรุณาระบุจำนวนที่ต้องการโอน', 'danger');
  if (qty > Number(lot.qty_on_hand)) return showToast(`จำนวนที่โอนเกินคงเหลือใน Lot นี้ (คงเหลือ ${lot.qty_on_hand})`, 'danger');

  items.push({
    drugId, drugLabel, lotNo: lot.lot_no, expDate: lot.expired_date,
    unitCost: lot.unit_cost, qty
  });
  renderItems();
  resetDrugSelection();
  document.getElementById('drugSearch').disabled = false;
});

function renderItems() {
  document.getElementById('itemsBody').innerHTML = items.map((it, i) => `
    <tr>
      <td>${it.drugLabel}</td><td>${it.lotNo}</td><td>${fmtDate(it.expDate)}</td>
      <td class="text-end">${fmtMoney(it.unitCost)}</td><td class="text-end">${fmtNumber(it.qty)}</td>
      <td><button class="btn btn-sm btn-outline-danger" onclick="removeItem(${i})">ลบ</button></td>
    </tr>`).join('');
}
function removeItem(i) { items.splice(i, 1); renderItems(); }

async function submitTransfer(submit) {
  if (!items.length) return showToast('กรุณาเพิ่มรายการยาอย่างน้อย 1 รายการ', 'danger');
  const fromStoreId = document.getElementById('fromStore').value;
  const toStoreId = document.getElementById('toStore').value;
  if (fromStoreId === toStoreId) return showToast('Store ต้นทางและปลายทางต้องไม่ใช่ที่เดียวกัน', 'danger');

  try {
    const result = await apiSend('/api/transfers', 'POST', {
      fromStoreId, toStoreId, remark: document.getElementById('remark').value,
      submit,
      items: items.map(it => ({ drugId: it.drugId, lotNo: it.lotNo, expiredDate: it.expDate, unitCost: it.unitCost, qtyTransfer: it.qty }))
    });
    showToast('สร้างรายการสำเร็จ: ' + result.transferNo);
    window.location.href = '/transfers/' + result.transferId;
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

document.getElementById('saveDraftBtn').addEventListener('click', () => submitTransfer(false));
document.getElementById('sendNowBtn').addEventListener('click', () => submitTransfer(true));

loadStores();
