async function loadStores() {
  const stores = await apiGet('/api/admin/stores');
  document.getElementById('storeSelect').innerHTML = stores.map(s => `<option value="${s.store_id}">${s.store_name}</option>`).join('');
}
async function loadDrugs() {
  const drugs = await apiGet('/api/admin/drugs');
  document.getElementById('drugSelect').innerHTML = drugs.map(d => `<option value="${d.drug_id}">${d.drug_name} (${d.drug_code})</option>`).join('');
}

async function loadConfig() {
  const storeId = document.getElementById('storeSelect').value;
  if (!storeId) return;
  const rows = await apiGet(`/api/admin/config?storeId=${storeId}`);
  document.getElementById('tbody').innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td>${r.drug_code}</td><td>${r.drug_name}</td><td>${r.unit}</td>
      <td class="text-end">${fmtNumber(r.min_qty)}</td><td class="text-end">${fmtNumber(r.max_qty)}</td>
      <td class="text-end">${fmtNumber(r.avg_usage)}</td><td class="text-end">${fmtNumber(r.qty_on_hand)}</td>
    </tr>`).join('') : `<tr><td colspan="7" class="text-center text-muted py-3">ยังไม่มีการกำหนดค่าสำหรับ Store นี้</td></tr>`;
}

document.getElementById('saveBtn').addEventListener('click', async () => {
  try {
    await apiSend('/api/admin/config', 'POST', {
      storeId: document.getElementById('storeSelect').value,
      drugId: document.getElementById('drugSelect').value,
      minQty: document.getElementById('minQty').value || 0,
      maxQty: document.getElementById('maxQty').value || 0,
      avgUsage: document.getElementById('avgUsage').value || 0
    });
    showToast('บันทึกสำเร็จ');
    loadConfig();
  } catch (err) { showToast(err.message, 'danger'); }
});

document.getElementById('storeSelect').addEventListener('change', loadConfig);

(async () => { await loadStores(); await loadDrugs(); await loadConfig(); })();
