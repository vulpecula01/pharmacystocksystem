// Categorical palette (fixed order, per dataviz skill) - do not reorder/cycle
const CAT = { blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', yellow: '#eda100', magenta: '#e87ba4', green: '#008300', violet: '#4a3aa7', red: '#e34948' };
const MUTED_INK = '#898781';
const GRID = '#e1e0d9';

Chart.defaults.font.family = "'Segoe UI', system-ui, sans-serif";
Chart.defaults.color = '#52514e';

async function loadDashboard() {
  try {
    const d = await apiGet('/api/dashboard/summary');

    document.getElementById('statValue').innerText = '฿' + fmtMoney(d.totals.total_value);
    document.getElementById('statQty').innerText = fmtNumber(d.totals.total_qty);
    document.getElementById('statNear').innerText = fmtNumber(d.nearExpiryCount);
    document.getElementById('statExpired').innerText = fmtNumber(d.expiredCount);
    document.getElementById('statMin').innerText = fmtNumber(d.belowMinCount);
    document.getElementById('statPending').innerText = fmtNumber(d.pendingTransfers);

    // มูลค่า Inventory แยกตาม Store - เป็นข้อมูล identity ต่อ store จึงใช้สีเดียว (sequential/neutral) ไม่ใช้หลายสีไล่ตามอันดับ
    new Chart(document.getElementById('storeValueChart'), {
      type: 'bar',
      data: {
        labels: d.byStore.map(s => s.store_name),
        datasets: [{ label: 'มูลค่า Inventory (บาท)', data: d.byStore.map(s => s.total_value), backgroundColor: CAT.blue, borderRadius: 4, maxBarThickness: 40 }]
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: GRID }, ticks: { color: MUTED_INK } },
          y: { grid: { display: false }, ticks: { color: MUTED_INK } }
        }
      }
    });

    // Stock Movement - แต่ละประเภท transaction คือ series (categorical, fixed order)
    const dates = [...new Set(d.recentMovement.map(r => r.d))].sort();
    const types = [
      { key: 'RECEIVE', label: 'รับเข้า', color: CAT.blue },
      { key: 'TRANSFER_IN', label: 'Transfer เข้า', color: CAT.aqua },
      { key: 'TRANSFER_OUT', label: 'Transfer ออก', color: CAT.orange },
      { key: 'ISSUE', label: 'จ่ายออก', color: CAT.red },
      { key: 'ADJUSTMENT', label: 'ปรับปรุง', color: CAT.violet }
    ];
    new Chart(document.getElementById('movementChart'), {
      type: 'line',
      data: {
        labels: dates.map(fmtDate),
        datasets: types.map(t => ({
          label: t.label,
          data: dates.map(dt => {
            const row = d.recentMovement.find(r => r.d === dt && r.transaction_type === t.key);
            return row ? Number(row.qty) : 0;
          }),
          borderColor: t.color, backgroundColor: t.color, tension: 0.3, borderWidth: 2, pointRadius: 3
        }))
      },
      options: {
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: MUTED_INK } },
          y: { grid: { color: GRID }, ticks: { color: MUTED_INK } }
        }
      }
    });

    document.getElementById('nearExpiryBody').innerHTML = d.nearExpiryList.length ? d.nearExpiryList.map(r => `
      <tr class="${r.expiry_status === 'EXPIRED' ? 'expiring-row-EXPIRED' : 'expiring-row-NEAR_EXPIRED'}">
        <td>${r.store_name}</td><td>${r.drug_name}</td><td>${r.lot_no}</td>
        <td>${fmtDate(r.expired_date)}</td><td class="text-end">${fmtNumber(r.days_to_expire)}</td>
      </tr>`).join('') : `<tr><td colspan="5" class="text-center text-muted">ไม่มีข้อมูล</td></tr>`;

    document.getElementById('belowMinBody').innerHTML = d.belowMinList.length ? d.belowMinList.map(r => `
      <tr><td>${r.store_name}</td><td>${r.drug_name}</td>
        <td class="text-end text-danger fw-semibold">${fmtNumber(r.qty_on_hand)}</td>
        <td class="text-end">${fmtNumber(r.min_qty)}</td></tr>`).join('') : `<tr><td colspan="4" class="text-center text-muted">ไม่มีข้อมูล</td></tr>`;
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

loadDashboard();
