async function load() {
  const params = new URLSearchParams();
  const from = document.getElementById('fromDate').value;
  const to = document.getElementById('toDate').value;
  const action = document.getElementById('actionFilter').value;
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (action) params.set('action', action);

  const rows = await apiGet(`/api/admin/audit-log?${params.toString()}`);
  document.getElementById('tbody').innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td>${fmtDateTime(r.created_at)}</td><td>${r.username || '-'}</td><td>${r.action}</td>
      <td>${r.entity_type || '-'} ${r.entity_id ? '#' + r.entity_id : ''}</td>
      <td>${r.store_id || '-'}</td>
      <td><code class="small">${r.detail ? JSON.stringify(r.detail) : ''}</code></td>
      <td>${r.ip_address || '-'}</td>
    </tr>`).join('') : `<tr><td colspan="7" class="text-center text-muted py-3">ไม่มีข้อมูล</td></tr>`;
}

document.getElementById('filterBtn').addEventListener('click', load);
load();
