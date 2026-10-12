const REPORT_CONFIG = {
  movement: {
    endpoint: '/api/reports/movement',
    cols: [
      { key: 'created_at', label: 'วันที่/เวลา', fmt: fmtDateTime },
      { key: 'store_name', label: 'Store' },
      { key: 'drug_code', label: 'รหัสยา' },
      { key: 'drug_name', label: 'ชื่อยา' },
      { key: 'lot_no', label: 'Lot' },
      { key: 'expired_date', label: 'Expired', fmt: fmtDate },
      { key: 'transaction_type', label: 'ประเภท' },
      { key: 'qty', label: 'จำนวน', fmt: fmtNumber, right: true },
      { key: 'unit_cost', label: 'ราคาต้นทุน', fmt: fmtMoney, right: true },
      { key: 'value', label: 'มูลค่า', fmt: fmtMoney, right: true },
      { key: 'balance_after', label: 'คงเหลือ', fmt: fmtNumber, right: true },
      { key: 'user_name', label: 'ผู้ทำรายการ' }
    ]
  },
  transfers: {
    endpoint: '/api/reports/transfers',
    cols: [
      { key: 'transfer_no', label: 'เลขที่' },
      { key: 'status', label: 'สถานะ' },
      { key: 'from_store', label: 'จาก' },
      { key: 'to_store', label: 'ถึง' },
      { key: 'total_qty', label: 'จำนวนรวม', fmt: fmtNumber, right: true },
      { key: 'total_value', label: 'มูลค่ารวม', fmt: fmtMoney, right: true },
      { key: 'created_by', label: 'สร้างโดย' },
      { key: 'received_by', label: 'รับโดย' },
      { key: 'created_at', label: 'วันที่สร้าง', fmt: fmtDateTime }
    ]
  },
  'stock-balance': {
    endpoint: '/api/reports/stock-balance',
    cols: [
      { key: 'store_name', label: 'Store' },
      { key: 'drug_code', label: 'รหัสยา' },
      { key: 'drug_name', label: 'ชื่อยา' },
      { key: 'group_name', label: 'กลุ่มยา' },
      { key: 'unit', label: 'หน่วย' },
      { key: 'qty_on_hand', label: 'คงเหลือ', fmt: fmtNumber, right: true },
      { key: 'stock_value', label: 'มูลค่า', fmt: fmtMoney, right: true },
      { key: 'nearest_expire_days', label: 'วันใกล้หมดอายุที่สุด', fmt: fmtNumber, right: true }
    ]
  },
  'stock-by-lot': {
    endpoint: '/api/reports/stock-by-lot',
    cols: [
      { key: 'store_name', label: 'Store' },
      { key: 'drug_code', label: 'รหัสยา' },
      { key: 'drug_name', label: 'ชื่อยา' },
      { key: 'lot_no', label: 'Lot' },
      { key: 'expired_date', label: 'Expired', fmt: fmtDate },
      { key: 'qty_on_hand', label: 'คงเหลือ', fmt: fmtNumber, right: true },
      { key: 'unit_cost', label: 'ราคาต้นทุน', fmt: fmtMoney, right: true },
      { key: 'stock_value', label: 'มูลค่า', fmt: fmtMoney, right: true },
      { key: 'min_qty', label: 'Min', right: true },
      { key: 'max_qty', label: 'Max', right: true }
    ]
  },
  'near-expiry': {
    endpoint: '/api/reports/near-expiry',
    cols: [
      { key: 'store_name', label: 'Store' },
      { key: 'drug_code', label: 'รหัสยา' },
      { key: 'drug_name', label: 'ชื่อยา' },
      { key: 'lot_no', label: 'Lot' },
      { key: 'expired_date', label: 'Expired', fmt: fmtDate },
      { key: 'days_to_expire', label: 'จำนวนวัน', fmt: fmtNumber, right: true },
      { key: 'qty_on_hand', label: 'คงเหลือ', fmt: fmtNumber, right: true },
      { key: 'expiry_status', label: 'สถานะ' }
    ]
  }
};

let currentType = 'movement';

async function loadStores() {
  const stores = await apiGet('/api/stores');
  const sel = document.getElementById('storeFilter');
  sel.innerHTML = `<option value="">-- ทุก Store --</option>` + stores.map(s => `<option value="${s.store_id}">${s.store_name}</option>`).join('');
}

function buildQuery() {
  const params = new URLSearchParams();
  const storeId = document.getElementById('storeFilter').value;
  const type = document.getElementById('typeFilter').value;
  const from = document.getElementById('fromDate').value;
  const to = document.getElementById('toDate').value;
  if (storeId) params.set('storeId', storeId);
  if (type && currentType === 'movement') params.set('type', type);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return params.toString();
}

async function loadReport() {
  const cfg = REPORT_CONFIG[currentType];
  document.getElementById('theadRow').innerHTML = cfg.cols.map(c => `<th class="${c.right ? 'text-end' : ''}">${c.label}</th>`).join('');
  document.getElementById('typeFilterWrap').style.display = currentType === 'movement' ? '' : 'none';

  try {
    const rows = await apiGet(`${cfg.endpoint}?${buildQuery()}`);
    const tbody = document.getElementById('tbody');
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="${cfg.cols.length}" class="text-center text-muted py-4">ไม่มีข้อมูล</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(r => {
      let rowClass = '';
      if (r.expiry_status === 'EXPIRED') rowClass = 'expiring-row-EXPIRED';
      else if (r.expiry_status === 'NEAR_EXPIRED') rowClass = 'expiring-row-NEAR_EXPIRED';
      return `<tr class="${rowClass}">` + cfg.cols.map(c => {
        const val = c.fmt ? c.fmt(r[c.key]) : (r[c.key] ?? '-');
        return `<td class="${c.right ? 'text-end' : ''}">${val}</td>`;
      }).join('') + `</tr>`;
    }).join('');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

document.querySelectorAll('#reportTabs .nav-link').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelectorAll('#reportTabs .nav-link').forEach(l => l.classList.remove('active'));
    link.classList.add('active');
    currentType = link.dataset.type;
    loadReport();
  });
});

document.getElementById('filterBtn').addEventListener('click', loadReport);
document.getElementById('exportBtn').addEventListener('click', () => {
  window.location.href = `/api/reports/export/${currentType}?${buildQuery()}`;
});

loadStores().then(loadReport);
