// ---------- Helper functions ที่ใช้ร่วมกันทุกหน้า ----------

async function apiGet(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
  return data;
}

async function apiSend(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
  return data;
}

function fmtNumber(n) {
  if (n === null || n === undefined) return '-';
  return Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 });
}

function fmtMoney(n) {
  if (n === null || n === undefined) return '-';
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '-';
  const date = new Date(d);
  return date.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtDateTime(d) {
  if (!d) return '-';
  const date = new Date(d);
  return date.toLocaleString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function showToast(message, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.position = 'fixed';
    container.style.top = '70px';
    container.style.right = '16px';
    container.style.zIndex = '2000';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `alert alert-${type} shadow-sm`;
  el.style.minWidth = '260px';
  el.innerText = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

const STATUS_LABEL_TH = {
  DRAFT: 'ร่าง (Draft)',
  TRANSFER_PENDING: 'รอรับสินค้า',
  RECEIVED: 'รับสินค้าแล้ว',
  CANCELLED: 'ยกเลิก'
};

function statusBadge(status) {
  return `<span class="badge badge-status-${status}">${STATUS_LABEL_TH[status] || status}</span>`;
}
