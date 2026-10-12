async function load() {
  const rows = await apiGet('/api/admin/clinics');
  document.getElementById('tbody').innerHTML = rows.map(r => `
    <tr>
      <td>${r.store_code}</td><td>${r.store_name}</td>
      <td>${r.address || '-'}</td><td>${r.contact_phone || '-'}</td>
      <td>${r.distance_km ?? '-'}</td><td>${r.avg_speed_kmh ?? '-'} กม./ชม.</td>
      <td>${r.lat && r.lng ? `${Number(r.lat).toFixed(5)}, ${Number(r.lng).toFixed(5)}` : '<span class="text-muted">ไม่ระบุ</span>'}</td>
      <td><span class="badge ${r.is_active ? 'bg-success' : 'bg-secondary'}">${r.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}</span></td>
    </tr>`).join('');
}

document.getElementById('addBtn').addEventListener('click', async () => {
  const code = document.getElementById('cCode').value.trim();
  const name = document.getElementById('cName').value.trim();
  if (!code || !name) return showToast('กรุณาระบุรหัสและชื่อคลินิก', 'danger');
  try {
    await apiSend('/api/admin/clinics', 'POST', {
      storeCode: code,
      storeName: name,
      address: document.getElementById('cAddress').value,
      contactPhone: document.getElementById('cPhone').value,
      distanceKm: document.getElementById('cDistance').value || null,
      lat: document.getElementById('cLat').value || null,
      lng: document.getElementById('cLng').value || null,
      avgSpeedKmh: document.getElementById('cSpeed').value || 40
    });
    showToast('เพิ่มคลินิกสำเร็จ');
    ['cCode', 'cName', 'cAddress', 'cPhone', 'cDistance', 'cLat', 'cLng'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('cSpeed').value = 40;
    load();
  } catch (err) { showToast(err.message, 'danger'); }
});

load();
