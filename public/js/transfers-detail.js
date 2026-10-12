async function load() {
  const id = document.getElementById('transferId').value;
  try {
    const t = await apiGet(`/api/transfers/${id}`);
    document.getElementById('headerCard').innerHTML = `
      <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
        <div>
          <h5>${t.transfer_no} ${statusBadge(t.status)}</h5>
          <div>จาก <b>${t.from_store_name}</b> → ถึง <b>${t.to_store_name}</b></div>
          <div class="text-muted small">สร้างโดย ${t.created_by_name} เมื่อ ${fmtDateTime(t.created_at)}</div>
          ${t.received_by_name ? `<div class="text-muted small">รับสินค้าโดย ${t.received_by_name} เมื่อ ${fmtDateTime(t.received_at)}</div>` : ''}
          ${t.remark ? `<div class="text-muted small">หมายเหตุ: ${t.remark}</div>` : ''}
        </div>
        <div class="d-flex gap-2">
          ${t.status === 'DRAFT' ? `<button class="btn btn-success btn-sm" onclick="sendTransfer()"><i class="bi bi-send"></i> ส่ง Transfer</button>` : ''}
          ${t.status === 'TRANSFER_PENDING' ? `<button class="btn btn-primary btn-sm" onclick="receiveTransfer()"><i class="bi bi-box-arrow-in-down"></i> รับสินค้า</button>` : ''}
          ${['DRAFT', 'TRANSFER_PENDING'].includes(t.status) ? `<button class="btn btn-outline-danger btn-sm" onclick="cancelTransfer()"><i class="bi bi-x-circle"></i> ยกเลิก</button>` : ''}
        </div>
      </div>`;
    document.getElementById('itemsBody').innerHTML = t.items.map(it => `
      <tr>
        <td>${it.drug_code}</td><td>${it.drug_name} ${it.strength_form || ''}</td>
        <td>${it.lot_no}</td><td>${fmtDate(it.expired_date)}</td>
        <td class="text-end">${fmtMoney(it.unit_cost)}</td>
        <td class="text-end">${fmtNumber(it.qty_transfer)}</td>
        <td class="text-end">${it.qty_received !== null ? fmtNumber(it.qty_received) : '-'}</td>
      </tr>`).join('');
  } catch (err) {
    document.getElementById('headerCard').innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
  }
}

async function sendTransfer() {
  if (!confirm('ยืนยันส่ง Transfer นี้? ระบบจะตัด Stock ออกจาก Store ต้นทางทันที')) return;
  try {
    await apiSend(`/api/transfers/${document.getElementById('transferId').value}/send`, 'POST');
    showToast('ส่ง Transfer สำเร็จ'); load();
  } catch (err) { showToast(err.message, 'danger'); }
}

async function receiveTransfer() {
  if (!confirm('ยืนยันรับสินค้าเข้า Store ปลายทาง?')) return;
  try {
    await apiSend(`/api/transfers/${document.getElementById('transferId').value}/receive`, 'POST');
    showToast('รับสินค้าสำเร็จ'); load();
  } catch (err) { showToast(err.message, 'danger'); }
}

async function cancelTransfer() {
  if (!confirm('ยืนยันยกเลิกรายการนี้?')) return;
  try {
    await apiSend(`/api/transfers/${document.getElementById('transferId').value}/cancel`, 'POST');
    showToast('ยกเลิกรายการสำเร็จ'); load();
  } catch (err) { showToast(err.message, 'danger'); }
}

load();
