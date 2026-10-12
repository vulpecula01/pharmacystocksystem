let allStores = [];
let allRoles = [];
let allUsers = [];

async function loadRoles() {
  allRoles = await apiGet('/api/admin/roles');
  const opts = allRoles.map(r => `<option value="${r.role_id}">${r.role_name}</option>`).join('');
  document.getElementById('roleSelect').innerHTML = opts;
  document.getElementById('eRoleSelect').innerHTML = opts;
}

async function loadStoreChecks() {
  allStores = await apiGet('/api/admin/stores');
  document.getElementById('storeChecks').innerHTML = allStores.map(s => `
    <div class="form-check">
      <input class="form-check-input store-check" type="checkbox" value="${s.store_id}" id="sc${s.store_id}">
      <label class="form-check-label small" for="sc${s.store_id}">${s.store_name}</label>
    </div>`).join('');
}

async function loadUsers() {
  allUsers = await apiGet('/api/admin/users');
  document.getElementById('tbody').innerHTML = allUsers.map(r => `
    <tr>
      <td>${r.username}</td><td>${r.full_name}</td><td>${r.role_name}</td>
      <td>${r.stores || '-'}</td>
      <td><span class="badge ${r.is_active ? 'bg-success' : 'bg-secondary'}">${r.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}</span></td>
      <td class="text-nowrap">
        <button class="btn btn-sm btn-outline-primary" onclick="openEdit(${r.user_id})"><i class="bi bi-pencil"></i> แก้ไข</button>
        <button class="btn btn-sm ${r.is_active ? 'btn-outline-warning' : 'btn-outline-success'}" onclick="toggleActive(${r.user_id}, ${r.is_active ? 'false' : 'true'})">
          ${r.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
        </button>
        <button class="btn btn-sm btn-outline-danger" onclick="deleteUser(${r.user_id}, '${r.username}')"><i class="bi bi-trash"></i> ลบ</button>
      </td>
    </tr>`).join('');
}

document.getElementById('addBtn').addEventListener('click', async () => {
  try {
    const storeIds = [...document.querySelectorAll('.store-check:checked')].map(el => el.value);
    await apiSend('/api/admin/users', 'POST', {
      username: document.getElementById('username').value.trim(),
      password: document.getElementById('password').value,
      fullName: document.getElementById('fullName').value.trim(),
      email: document.getElementById('email').value.trim(),
      roleId: document.getElementById('roleSelect').value,
      storeIds
    });
    showToast('เพิ่ม User สำเร็จ');
    ['username', 'password', 'fullName', 'email'].forEach(id => document.getElementById(id).value = '');
    document.querySelectorAll('.store-check').forEach(el => el.checked = false);
    loadUsers();
  } catch (err) { showToast(err.message, 'danger'); }
});

// ---------- แก้ไข User ----------
async function openEdit(userId) {
  try {
    const user = await apiGet(`/api/admin/users/${userId}`);
    document.getElementById('eUserId').value = user.user_id;
    document.getElementById('eUsername').innerText = user.username;
    document.getElementById('eFullName').value = user.full_name;
    document.getElementById('eEmail').value = user.email || '';
    document.getElementById('eRoleSelect').value = user.role_id;
    document.getElementById('ePassword').value = '';
    document.getElementById('eIsActive').checked = !!user.is_active;

    document.getElementById('eStoreChecks').innerHTML = allStores.map(s => `
      <div class="form-check">
        <input class="form-check-input e-store-check" type="checkbox" value="${s.store_id}" id="esc${s.store_id}" ${user.storeIds.includes(s.store_id) ? 'checked' : ''}>
        <label class="form-check-label small" for="esc${s.store_id}">${s.store_name}</label>
      </div>`).join('');

    new bootstrap.Modal(document.getElementById('editModal')).show();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

document.getElementById('saveEditBtn').addEventListener('click', async () => {
  const userId = document.getElementById('eUserId').value;
  try {
    await apiSend(`/api/admin/users/${userId}`, 'PUT', {
      fullName: document.getElementById('eFullName').value.trim(),
      email: document.getElementById('eEmail').value.trim(),
      roleId: document.getElementById('eRoleSelect').value,
      isActive: document.getElementById('eIsActive').checked,
      password: document.getElementById('ePassword').value || undefined
    });
    const storeIds = [...document.querySelectorAll('.e-store-check:checked')].map(el => el.value);
    await apiSend(`/api/admin/users/${userId}/store-access`, 'POST', { storeIds });

    bootstrap.Modal.getInstance(document.getElementById('editModal')).hide();
    showToast('บันทึกการแก้ไขสำเร็จ');
    loadUsers();
  } catch (err) {
    showToast(err.message, 'danger');
  }
});

// ---------- เปิด/ปิดใช้งาน (Deactivate/Activate) ----------
async function toggleActive(userId, makeActive) {
  const user = allUsers.find(u => u.user_id === userId);
  if (!confirm(`ยืนยัน${makeActive ? 'เปิด' : 'ปิด'}ใช้งานบัญชี "${user?.username}" ?`)) return;
  try {
    // ต้องส่ง field ที่จำเป็นครบตาม API (fullName/email/roleId เดิม)
    const detail = await apiGet(`/api/admin/users/${userId}`);
    await apiSend(`/api/admin/users/${userId}`, 'PUT', {
      fullName: detail.full_name,
      email: detail.email,
      roleId: detail.role_id,
      isActive: makeActive
    });
    showToast(makeActive ? 'เปิดใช้งานสำเร็จ' : 'ปิดใช้งานสำเร็จ');
    loadUsers();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

// ---------- ลบ User ----------
async function deleteUser(userId, username) {
  if (!confirm(`ยืนยันลบ User "${username}" ? การลบไม่สามารถย้อนกลับได้`)) return;
  try {
    await apiSend(`/api/admin/users/${userId}`, 'DELETE');
    showToast('ลบ User สำเร็จ');
    loadUsers();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

(async () => { await loadRoles(); await loadStoreChecks(); await loadUsers(); })();
