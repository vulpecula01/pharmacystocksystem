let currentCounts = [];

const CC_STATUS_LABEL = { DRAFT: 'กำลังนับ', SUBMITTED: 'ปิดรอบแล้ว', CANCELLED: 'ยกเลิก' };
const CC_STATUS_BADGE_CLASS = { DRAFT: 'bg-warning text-dark', SUBMITTED: 'bg-success', CANCELLED: 'bg-secondary' };
function ccStatusBadge(status) {
  return `<span class="badge ${CC_STATUS_BADGE_CLASS[status] || 'bg-secondary'}">${CC_STATUS_LABEL[status] || status}</span>`;
}

async function loadStores() {
  const stores = await apiGet('/api/stores');
  const sel = document.getElementById('storeSelect');
  sel.innerHTML = stores.map(s => `<option value="${s.store_id}">${s.store_name} (${s.store_type})</option>`).join('');
}

async function loadCounts() {
  const rows = await apiGet('/api/cycle-count/counts');
  currentCounts = rows;
  renderCounts(rows);
}

function renderCounts(rows) {
  const tbody = document.querySelector('#countTable tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">ยังไม่มีรอบนับ</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const actions = [`<a class="btn btn-sm btn-outline-primary" href="/cycle-count/${r.count_id}">${r.status === 'DRAFT' ? 'กรอกยอดนับ' : 'ดูรายละเอียด'}</a>`];
    return `<tr>
      <td>#${r.count_id}</td>
      <td>${r.store_name}</td>
      <td>${r.item_count}</td>
      <td>${r.counted_count} / ${r.item_count}</td>
      <td>${ccStatusBadge(r.status)}</td>
      <td>${r.created_by_name}</td>
      <td>${fmtDateTime(r.created_at)}</td>
      <td class="text-nowrap">${actions.join(' ')}</td>
    </tr>`;
  }).join('');
}

document.getElementById('startCountBtn')?.addEventListener('click', async () => {
  const storeId = document.getElementById('storeSelect').value;
  if (!storeId) return showToast('กรุณาเลือก Store ก่อน', 'danger');
  try {
    const result = await apiSend('/api/cycle-count/counts', 'POST', { storeId });
    if (result.itemCount === 0) {
      showToast('Store นี้ยังไม่มีรายการยาคงเหลือในระบบให้นับ', 'danger');
      return;
    }
    window.location.href = `/cycle-count/${result.countId}`;
  } catch (err) {
    showToast(err.message, 'danger');
  }
});

loadStores();
loadCounts();
