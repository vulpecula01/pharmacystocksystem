let allDrugs = [];

async function load() {
  allDrugs = await apiGet('/api/admin/drugs');
  render(allDrugs);
}

function render(rows) {
  document.getElementById('tbody').innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td>${r.drug_code}</td><td>${r.drug_name}</td><td>${r.strength_form || '-'}</td>
      <td>${r.unit}</td><td>${r.group_name || '-'}</td>
      <td><button class="btn btn-sm btn-outline-secondary" onclick="showQr(${r.drug_id}, '${r.drug_name.replace(/'/g, '')}', '${r.drug_code}')"><i class="bi bi-qr-code"></i></button></td>
    </tr>`).join('') : `<tr><td colspan="6" class="text-center text-muted py-3">ไม่มีข้อมูล</td></tr>`;
}

function showQr(id, name, code) {
  document.getElementById('qrImg').src = `/api/drugs/${id}/qrcode`;
  document.getElementById('qrLabel').innerText = `${name} (${code})`;
  new bootstrap.Modal(document.getElementById('qrModal')).show();
}

async function findOrCreateGroupId(name) {
  if (!name) return null;
  const groups = await apiGet('/api/admin/drug-groups');
  const found = groups.find(g => g.group_name.toLowerCase() === name.toLowerCase());
  if (found) return found.drug_group_id;
  const result = await apiSend('/api/admin/drug-groups', 'POST', { groupName: name });
  return result.drugGroupId;
}

document.getElementById('addBtn').addEventListener('click', async () => {
  try {
    const groupName = document.getElementById('groupName').value.trim();
    const drugGroupId = await findOrCreateGroupId(groupName);
    await apiSend('/api/admin/drugs', 'POST', {
      drugCode: document.getElementById('drugCode').value.trim(),
      drugName: document.getElementById('drugName').value.trim(),
      strengthForm: document.getElementById('strengthForm').value.trim(),
      unit: document.getElementById('unit').value.trim(),
      drugGroupId
    });
    showToast('เพิ่มยาสำเร็จ');
    ['drugCode', 'drugName', 'strengthForm', 'unit', 'groupName'].forEach(id => document.getElementById(id).value = '');
    load();
  } catch (err) { showToast(err.message, 'danger'); }
});

document.getElementById('searchBox').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  render(allDrugs.filter(d => d.drug_name.toLowerCase().includes(q) || d.drug_code.includes(q)));
});

load();
