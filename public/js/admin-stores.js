async function load() {
  const rows = await apiGet('/api/admin/stores');
  document.getElementById('tbody').innerHTML = rows.map(r => `
    <tr>
      <td>${r.store_code}</td><td>${r.store_name}</td><td>${r.store_type}</td>
      <td>${r.location || '-'}</td>
      <td><span class="badge ${r.is_active ? 'bg-success' : 'bg-secondary'}">${r.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}</span></td>
    </tr>`).join('');
}

document.getElementById('addBtn').addEventListener('click', async () => {
  try {
    await apiSend('/api/admin/stores', 'POST', {
      storeCode: document.getElementById('storeCode').value,
      storeName: document.getElementById('storeName').value,
      storeType: document.getElementById('storeType').value,
      location: document.getElementById('storeLocation').value
    });
    showToast('เพิ่ม Store สำเร็จ');
    ['storeCode', 'storeName', 'storeLocation'].forEach(id => document.getElementById(id).value = '');
    load();
  } catch (err) { showToast(err.message, 'danger'); }
});

load();
