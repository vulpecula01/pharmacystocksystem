// สคริปต์สร้างข้อมูลตัวอย่าง (Seed Data) สำหรับทดสอบระบบ
require('dotenv').config({ path: process.env.ENV_FILE || '.env' });
const bcrypt = require('bcryptjs');
const pool = require('../src/config/db');

async function run() {
  const conn = await pool.getConnection();
  try {
    console.log('Seeding roles...');
    await conn.query(`INSERT IGNORE INTO roles (role_code, role_name) VALUES
      ('SUPER_ADMIN','Super Admin'),
      ('PHARMACY_ADMIN','Pharmacy Admin'),
      ('STORE_USER','Store User')`);

    console.log('Seeding stores...');
    await conn.query(`INSERT IGNORE INTO stores (store_code, store_name, store_type, location) VALUES
      ('MAIN','ห้องยาหลัก (Main Pharmacy)','MAIN_PHARMACY','อาคาร A ชั้น 1'),
      ('FS-ER','Floor Stock - ห้องฉุกเฉิน (ER)','FLOOR_STOCK','อาคาร A ชั้น 1'),
      ('FS-IPD1','Floor Stock - หอผู้ป่วยใน 1','FLOOR_STOCK','อาคาร B ชั้น 3'),
      ('EMB-01','กระเป๋า Emergency 01','EMERGENCY_BAG','รถ Ambulance 1'),
      ('EMB-02','กระเป๋า Emergency 02','EMERGENCY_BAG','จุดปฐมพยาบาล OPD')`);

    const [[main]] = await conn.query(`SELECT store_id FROM stores WHERE store_code='MAIN'`);
    const [[fsEr]] = await conn.query(`SELECT store_id FROM stores WHERE store_code='FS-ER'`);
    const [[fsIpd]] = await conn.query(`SELECT store_id FROM stores WHERE store_code='FS-IPD1'`);
    const [[emb1]] = await conn.query(`SELECT store_id FROM stores WHERE store_code='EMB-01'`);

    console.log('Seeding drug groups...');
    await conn.query(`INSERT IGNORE INTO drug_groups (group_name) VALUES ('Analgesics'),('Antibiotics'),('Emergency Drugs'),('IV Fluids')`);
    const [[gAnalgesic]] = await conn.query(`SELECT drug_group_id FROM drug_groups WHERE group_name='Analgesics'`);
    const [[gAntibiotic]] = await conn.query(`SELECT drug_group_id FROM drug_groups WHERE group_name='Antibiotics'`);
    const [[gEmergency]] = await conn.query(`SELECT drug_group_id FROM drug_groups WHERE group_name='Emergency Drugs'`);
    const [[gIvFluid]] = await conn.query(`SELECT drug_group_id FROM drug_groups WHERE group_name='IV Fluids'`);

    console.log('Seeding drug master...');
    const drugs = [
      ['10000000000001', 'Paracetamol 500 mg', '500 mg Tablet', 'TAB', gAnalgesic.drug_group_id],
      ['10000000000002', 'Ibuprofen 400 mg', '400 mg Tablet', 'TAB', gAnalgesic.drug_group_id],
      ['10000000000003', 'Ceftriaxone 1 g Injection', '1 g Vial', 'VIAL', gAntibiotic.drug_group_id],
      ['10000000000004', 'Adrenaline (Epinephrine) 1 mg/mL', '1 mg/mL Amp', 'AMP', gEmergency.drug_group_id],
      ['10000000000005', 'Atropine Sulfate 1 mg/mL', '1 mg/mL Amp', 'AMP', gEmergency.drug_group_id],
      ['10000000000006', 'Normal Saline 0.9% 1000 mL', '1000 mL Bag', 'BAG', gIvFluid.drug_group_id],
      ['10000000000007', 'Amoxicillin 500 mg', '500 mg Capsule', 'CAP', gAntibiotic.drug_group_id],
      ['10000000000008', 'Diazepam 5 mg/mL Injection', '5 mg/mL Amp', 'AMP', gEmergency.drug_group_id]
    ];
    for (const d of drugs) {
      await conn.query(
        `INSERT IGNORE INTO drug_master (drug_code, drug_name, strength_form, unit, drug_group_id) VALUES (?,?,?,?,?)`,
        d
      );
    }
    const [drugRows] = await conn.query(`SELECT drug_id, drug_code FROM drug_master`);
    const drugIdByCode = {};
    drugRows.forEach(r => drugIdByCode[r.drug_code] = r.drug_id);

    console.log('Seeding store_drug_config (Min/Max)...');
    const configs = [
      [fsEr.store_id, drugIdByCode['10000000000001'], 50, 200, 10],
      [fsEr.store_id, drugIdByCode['10000000000004'], 10, 50, 2],
      [fsEr.store_id, drugIdByCode['10000000000005'], 10, 50, 1],
      [fsIpd.store_id, drugIdByCode['10000000000001'], 30, 150, 8],
      [fsIpd.store_id, drugIdByCode['10000000000006'], 20, 100, 5],
      [emb1.store_id, drugIdByCode['10000000000004'], 2, 10, 1],
      [emb1.store_id, drugIdByCode['10000000000008'], 2, 10, 1]
    ];
    for (const c of configs) {
      await conn.query(
        `INSERT INTO store_drug_config (store_id, drug_id, min_qty, max_qty, avg_usage) VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE min_qty=VALUES(min_qty), max_qty=VALUES(max_qty), avg_usage=VALUES(avg_usage)`,
        c
      );
    }

    console.log('Seeding lots + main pharmacy stock...');
    const today = new Date();
    const addDays = (n) => {
      const d = new Date(today);
      d.setDate(d.getDate() + n);
      return d.toISOString().slice(0, 10);
    };
    const lotSeed = [
      [drugIdByCode['10000000000001'], 'LOT-PARA-24A', addDays(400), 0.50, 5000],
      [drugIdByCode['10000000000002'], 'LOT-IBU-24A', addDays(300), 1.20, 2000],
      [drugIdByCode['10000000000003'], 'LOT-CTX-24A', addDays(60), 45.00, 200],   // near expiry
      [drugIdByCode['10000000000004'], 'LOT-ADR-24A', addDays(500), 25.00, 300],
      [drugIdByCode['10000000000005'], 'LOT-ATR-24A', addDays(-10), 18.00, 100],  // already expired
      [drugIdByCode['10000000000006'], 'LOT-NSS-24A', addDays(365), 15.00, 1000],
      [drugIdByCode['10000000000007'], 'LOT-AMOX-24A', addDays(200), 2.00, 3000],
      [drugIdByCode['10000000000008'], 'LOT-DZP-24A', addDays(45), 30.00, 150]     // near expiry
    ];
    for (const [drugId, lotNo, expDate, unitCost, qty] of lotSeed) {
      const [lotResult] = await conn.query(
        `INSERT INTO drug_lots (drug_id, lot_no, expired_date, unit_cost) VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE unit_cost=VALUES(unit_cost)`,
        [drugId, lotNo, expDate, unitCost]
      );
      const [[lotRow]] = await conn.query(`SELECT lot_id FROM drug_lots WHERE drug_id=? AND lot_no=? AND expired_date=?`, [drugId, lotNo, expDate]);
      await conn.query(
        `INSERT INTO store_stock (store_id, drug_id, lot_id, qty_on_hand, received_date) VALUES (?,?,?,?,NOW())
         ON DUPLICATE KEY UPDATE qty_on_hand=VALUES(qty_on_hand)`,
        [main.store_id, drugId, lotRow.lot_id, qty]
      );
    }

    console.log('Seeding users...');
    const superAdminHash = await bcrypt.hash('SuperAdmin@123', 10);
    const adminHash = await bcrypt.hash('Admin@123', 10);
    const userHash = await bcrypt.hash('User@123', 10);
    const [[superAdminRole]] = await conn.query(`SELECT role_id FROM roles WHERE role_code='SUPER_ADMIN'`);
    const [[adminRole]] = await conn.query(`SELECT role_id FROM roles WHERE role_code='PHARMACY_ADMIN'`);
    const [[storeRole]] = await conn.query(`SELECT role_id FROM roles WHERE role_code='STORE_USER'`);

    await conn.query(
      `INSERT IGNORE INTO users (username, password_hash, full_name, role_id) VALUES (?,?,?,?)`,
      ['superadmin', superAdminHash, 'ผู้ดูแลระบบสูงสุด', superAdminRole.role_id]
    );
    await conn.query(
      `INSERT IGNORE INTO users (username, password_hash, full_name, role_id) VALUES (?,?,?,?)`,
      ['admin', adminHash, 'ผู้ดูแลระบบเภสัชกรรม', adminRole.role_id]
    );
    const userDefs = [
      ['main_user', 'จนท.ห้องยาหลัก', main.store_id],
      ['er_user', 'จนท. Floor Stock ER', fsEr.store_id],
      ['ipd1_user', 'จนท. Floor Stock IPD1', fsIpd.store_id],
      ['emb01_user', 'จนท.กระเป๋า Emergency 01', emb1.store_id]
    ];
    for (const [username, fullName, storeId] of userDefs) {
      await conn.query(
        `INSERT IGNORE INTO users (username, password_hash, full_name, role_id) VALUES (?,?,?,?)`,
        [username, userHash, fullName, storeRole.role_id]
      );
      const [[u]] = await conn.query(`SELECT user_id FROM users WHERE username=?`, [username]);
      await conn.query(`INSERT IGNORE INTO user_store_access (user_id, store_id) VALUES (?,?)`, [u.user_id, storeId]);
      // ให้ main_user เข้าถึง main store สำหรับสร้าง transfer
    }
    // main_user เข้าถึง store MAIN เท่านั้น (ผู้ส่ง) - เพิ่มสิทธิ์เข้าถึงปลายทางเผื่อทดสอบไม่จำเป็น

    console.log('Seed completed successfully.');
    console.log('Login: superadmin / SuperAdmin@123 (Super Admin)');
    console.log('Login: admin / Admin@123 (Pharmacy Admin)');
    console.log('Login: main_user, er_user, ipd1_user, emb01_user / User@123 (Store User)');
  } catch (err) {
    console.error('Seed error:', err);
  } finally {
    conn.release();
    process.exit(0);
  }
}

run();
