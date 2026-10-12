async function load() {
  const status = document.getElementById('statusFilter').value;
  const rows = await apiGet(`/api/transfers${status ? '?status=' + status : ''}`);
  document.getElementById('tbody').innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td><a href="/transfers/${r.transfer_id}">${r.transfer_no}</a></td>
      <td>${r.from_store_name}</td>
      <td>${r.to_store_name}</td>
      <td>${r.item_count}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${r.created_by_name}</td>
      <td>${fmtDateTime(r.created_at)}</td>
      <td><a href="/transfers/${r.transfer_id}" class="btn btn-sm btn-outline-primary">ดู</a></td>
    </tr>`).join('') : `<tr><td colspan="8" class="text-center text-muted py-4">ไม่มีข้อมูล</td></tr>`;
}

document.getElementById('statusFilter').addEventListener('change', load);
document.getElementById('refreshBtn').addEventListener('click', load);
load();
