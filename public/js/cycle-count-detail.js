let currentCount = null;

const REASON_LABEL = {
  MISSING: 'ของหาย',
  MISCOUNT: 'นับผิด',
  DAMAGED_EXPIRED: 'ยาเสีย/หมดอายุ',
  OTHER: 'อื่นๆ'
};

function reasonSelectHtml(itemId, current) {
  const opts = Object.entries(REASON_LABEL).map(([val, label]) =>
    `<option value="${val}" ${current === val ? 'selected' : ''}>${label}</option>`
  ).join('');
  return `<select class="form-select form-select-sm reason-select" data-item="${itemId}">
    <option value="">-- เลือกเหตุผล --</option>${opts}
  </select>`;
}

async function loadCount() {
  currentCount = await apiGet(`/api/cycle-count/counts/${window.COUNT_ID}`);
  renderMeta();
  renderItems();
  const isDraft = currentCount.status === 'DRAFT';
  document.getElementById('saveDraftBtn').classList.toggle('d-none', !isDraft);
  document.getElementById('submitCountBtn').classList.toggle('d-none', !isDraft);
  document.getElementById('cancelCountBtn').classList.toggle('d-none', !isDraft);
}

function renderMeta() {
  const box = document.getElementById('countMeta');
  const statusText = currentCount.status === 'DRAFT' ? 'กำลังนับ (ยังไม่ปิดรอบ)'
    : currentCount.status === 'SUBMITTED' ? 'ปิดรอบแล้ว — ยอดคงเหลือถูกปรับตามที่นับได้จริงเรียบร้อย'
    : 'ยกเลิกแล้ว';
  box.innerHTML = `<i class="bi bi-info-circle"></i> Store: <b>${currentCount.store_name}</b> — สถานะ: <b>${statusText}</b>`
    + (currentCount.remark ? ` — หมายเหตุ: ${currentCount.remark}` : '');
}

function renderItems() {
  const editable = currentCount.status === 'DRAFT';
  const tbody = document.querySelector('#itemTable tbody');
  if (!currentCount.items.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">ไม่มีรายการ</td></tr>`;
    return;
  }
  tbody.innerHTML = currentCount.items.map(it => {
    const counted = it.counted_qty !== null ? it.counted_qty : it.system_qty;
    const variance = it.counted_qty !== null ? (Number(it.counted_qty) - Number(it.system_qty)) : 0;
    const varianceClass = variance > 0 ? 'text-success' : (variance < 0 ? 'text-danger' : '');
    return `<tr>
      <td>${it.drug_name} <small class="text-muted">${it.drug_code}</small></td>
      <td>${it.lot_no}</td>
      <td>${fmtDate(it.expired_date)}</td>
      <td class="text-end">${fmtNumber(it.system_qty)} ${it.unit}</td>
      <td class="text-end">
        ${editable
          ? `<input type="number" step="0.01" min="0" class="form-control form-control-sm counted-input" data-item="${it.item_id}" value="${counted}">`
          : fmtNumber(it.counted_qty)}
      </td>
      <td class="text-end fw-semibold ${varianceClass}"><span class="variance-cell" data-item="${it.item_id}">${fmtNumber(variance)}</span></td>
      <td>${editable ? reasonSelectHtml(it.item_id, it.variance_reason) : (REASON_LABEL[it.variance_reason] || '-')}</td>
      <td>${editable
        ? `<input type="text" class="form-control form-control-sm note-input" data-item="${it.item_id}" value="${it.note ? it.note.replace(/"/g, '&quot;') : ''}">`
        : (it.note || '-')}</td>
    </tr>`;
  }).join('');

  if (editable) {
    document.querySelectorAll('.counted-input').forEach(inp => {
      inp.addEventListener('input', () => {
        const itemId = Number(inp.dataset.item);
        const item = currentCount.items.find(i => i.item_id === itemId);
        const variance = Number(inp.value || 0) - Number(item.system_qty);
        const cell = document.querySelector(`.variance-cell[data-item="${itemId}"]`);
        cell.textContent = fmtNumber(variance);
        cell.className = 'variance-cell ' + (variance > 0 ? 'text-success' : (variance < 0 ? 'text-danger' : ''));
      });
    });
  }
}

function collectItemsPayload() {
  const items = [];
  document.querySelectorAll('.counted-input').forEach(inp => {
    const itemId = Number(inp.dataset.item);
    const reasonSel = document.querySelector(`.reason-select[data-item="${itemId}"]`);
    const noteInp = document.querySelector(`.note-input[data-item="${itemId}"]`);
    items.push({
      itemId,
      countedQty: inp.value === '' ? null : Number(inp.value),
      reason: reasonSel ? (reasonSel.value || null) : null,
      note: noteInp ? noteInp.value : null
    });
  });
  return items;
}

document.getElementById('saveDraftBtn')?.addEventListener('click', async () => {
  const items = collectItemsPayload();
  try {
    await apiSend(`/api/cycle-count/counts/${window.COUNT_ID}/items`, 'PUT', { items });
    showToast('บันทึกยอดที่กรอกไว้สำเร็จ');
    loadCount();
  } catch (err) {
    showToast(err.message, 'danger');
  }
});

document.getElementById('submitCountBtn')?.addEventListener('click', async () => {
  if (!confirm('ยืนยันปิดรอบนับ? ระบบจะปรับยอดคงเหลือให้ตรงกับที่นับได้จริงทันที และจะแก้ไขไม่ได้อีก')) return;
  const items = collectItemsPayload();
  try {
    // บันทึกยอดล่าสุดก่อนปิดรอบเสมอ กันกรณีลืมกด "บันทึกยอดที่กรอกไว้"
    await apiSend(`/api/cycle-count/counts/${window.COUNT_ID}/items`, 'PUT', { items });
    const result = await apiSend(`/api/cycle-count/counts/${window.COUNT_ID}/submit`, 'POST');
    showToast(result.varianceCount > 0
      ? `ปิดรอบนับสำเร็จ — ปรับยอด ${result.varianceCount} รายการที่มีส่วนต่าง`
      : 'ปิดรอบนับสำเร็จ — ยอดตรงกับระบบทุกรายการ');
    loadCount();
  } catch (err) {
    showToast(err.message, 'danger');
  }
});

document.getElementById('cancelCountBtn')?.addEventListener('click', async () => {
  if (!confirm('ยืนยันยกเลิกรอบนับนี้?')) return;
  try {
    await apiSend(`/api/cycle-count/counts/${window.COUNT_ID}/cancel`, 'POST');
    showToast('ยกเลิกรอบนับสำเร็จ');
    window.location.href = '/cycle-count';
  } catch (err) {
    showToast(err.message, 'danger');
  }
});

loadCount();
