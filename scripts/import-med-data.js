// ----------------------------------------------------------------------------
// สคริปต์นำเข้าข้อมูล Stock จริงจากไฟล์ Excel "Data for Med flow connect.xlsx"
// เข้าสู่ระบบ (Stores, Drug Master, Lots, Stock คงเหลือเริ่มต้น)
//
// วิธีใช้งาน (ไม่ต้องตั้งค่า Environment Variable เอง ใช้ได้ทั้ง Windows PowerShell/CMD และ Linux/Mac):
//   node scripts/import-med-data.js <ไฟล์ .env> <ไฟล์ Excel> [username ผู้ทำรายการ]
//
//   ตัวอย่างสำหรับ Production:
//     node scripts/import-med-data.js .env.production "Data for Med flow connect.xlsx" superadmin
//   ตัวอย่างสำหรับ Test (แนะนำให้ลองก่อนรันจริง):
//     node scripts/import-med-data.js .env.test "Data for Med flow connect.xlsx" superadmin
//
//   argument ที่ 3 (username, optional) ใช้บันทึก audit log / stock_transactions
//   ถ้าไม่ระบุ จะพยายามใช้ user แรกที่เป็น SUPER_ADMIN โดยอัตโนมัติ
//
// หมายเหตุ:
//   - สคริปต์นี้ "รันซ้ำได้" (idempotent) ปลอดภัย - รันซ้ำจะ "ตั้งค่ายอดคงเหลือใหม่ทับของเดิม"
//     ตามข้อมูลในไฟล์ (ไม่ใช่การบวกเพิ่ม) เหมาะสำหรับกรณีแก้ไขไฟล์ Excel แล้วรันใหม่
//   - หลังรันเสร็จจะได้ไฟล์รายงาน "import-exceptions.xlsx" สรุปรายการที่ถูกข้าม
//     (รหัสยายังไม่ยืนยัน / วันหมดอายุผิดปกติ) ให้ส่งกลับไปให้แผนกที่เกี่ยวข้องตรวจสอบแก้ไข
// ----------------------------------------------------------------------------

const path = require('path');

const ENV_FILE = process.argv[2];
const FILE_PATH_ARG = process.argv[3];
const RUN_AS_USERNAME = process.argv[4] || null;

if (!ENV_FILE || !FILE_PATH_ARG) {
  console.error('วิธีใช้: node scripts/import-med-data.js <ไฟล์ .env เช่น .env.production> <ไฟล์ Excel> [username]');
  process.exit(1);
}

// ต้องโหลด .env ก่อน require('../src/config/db') เพราะ pool การเชื่อมต่อ DB จะถูกสร้างทันทีตอน require
require('dotenv').config({ path: ENV_FILE });
const ExcelJS = require('exceljs');
const pool = require('../src/config/db');

const FILE_PATH = FILE_PATH_ARG;
const PLACEHOLDER_EXPIRY_YEARS = 2; // สำหรับ Floor Stock ที่ไม่มีวันหมดอายุในไฟล์ต้นฉบับ

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
function addYears(dateStr, years) {
  const d = new Date(dateStr);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}
function ymdCompact(dateStr) {
  return dateStr.replace(/-/g, '');
}
// วันหมดอายุชั่วคราวคงที่ตลอดปีปฏิทินนี้ (ไม่อิงวันที่รันจริง) เพื่อให้รันสคริปต์ซ้ำวันไหนก็ตาม
// (เช่น รันวันนี้ แล้วแก้ไฟล์ Excel รันซ้ำอีกวันหนึ่ง) ยังจับคู่ Lot เดิมได้ ไม่สร้าง Lot ซ้ำซ้อน
const PLACEHOLDER_EXPIRY_DATE = `${new Date().getFullYear() + PLACEHOLDER_EXPIRY_YEARS}-12-31`;

// ทำ store_code ให้สั้น ไม่ซ้ำ ไม่เกิน 30 ตัวอักษร
const usedCodes = new Set();
function slugCode(prefix, name) {
  let base = name
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')      // ตัดอักขระไทย/พิเศษออก (เหลือ ASCII)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!base) base = 'STORE';
  let code = `${prefix}-${base}`.slice(0, 28);
  let final = code;
  let n = 1;
  while (usedCodes.has(final)) {
    n++;
    final = `${code.slice(0, 26)}-${n}`;
  }
  usedCodes.add(final);
  return final;
}

function isValidDrugCode(code) {
  return /^\d{14}$/.test(String(code || '').trim());
}

// แปลงค่าวันหมดอายุจาก cell ของ ExcelJS ให้เป็น 'YYYY-MM-DD'
// สถานะที่เป็นไปได้ 3 แบบ:
//   'empty'   - ไม่มีข้อมูลเลย (ช่องว่าง) -> ใช้วันหมดอายุชั่วคราวได้ (ตามที่ผู้ใช้ยืนยัน)
//   'invalid' - มีข้อมูลแต่ผิดรูปแบบ/ผิดปกติ (เช่น ปี 1930, '9/31/27') -> ข้ามรายการ ต้องให้แผนกตรวจสอบ
//   'ok'      - วันที่ถูกต้อง ใช้ค่าจริงจากไฟล์
function parseExpiry(cellValue) {
  if (cellValue === null || cellValue === undefined || cellValue === '') {
    return { status: 'empty', raw: cellValue };
  }
  let d = null;
  if (cellValue instanceof Date) {
    d = cellValue;
  } else if (typeof cellValue === 'string') {
    const parsed = new Date(cellValue);
    if (!isNaN(parsed.getTime())) d = parsed;
  }
  if (!d || isNaN(d.getTime())) return { status: 'invalid', raw: cellValue };
  const year = d.getFullYear();
  if (year < 2024 || year > 2099) return { status: 'invalid', raw: cellValue }; // ปีผิดปกติ (เช่น 1930, 1931)
  return { status: 'ok', value: d.toISOString().slice(0, 10) };
}

// สำหรับกรณี Expire date ว่างเปล่า (empty) - ใช้วันหมดอายุชั่วคราว +N ปี เหมือน Floor Stock
function placeholderExpiry() {
  return PLACEHOLDER_EXPIRY_DATE;
}

function cellText(cell) {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'object' && cell.text) return cell.text;
  return String(cell).trim();
}

async function loadWorkbook() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE_PATH);
  return wb;
}

async function main() {
  console.log('อ่านไฟล์:', FILE_PATH);
  const wb = await loadWorkbook();

  // ---------- 1) โหลด Item Code Master ----------
  const masterSheet = wb.getWorksheet('Item code');
  const codeNameMaster = {};
  masterSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const code = cellText(row.getCell(1).value).trim();
    const name = cellText(row.getCell(2).value).trim();
    if (code && name) codeNameMaster[code] = name;
  });
  console.log(`Item Code Master: ${Object.keys(codeNameMaster).length} รหัส`);

  // ---------- 2) อ่าน 3 ชีทสต๊อก และจัดกลุ่มเป็น Store ----------
  const exceptions = []; // {sheet, row, code, name, reason, raw}
  const drugsSeen = new Map(); // code -> {name, unit}
  const storeDefs = new Map(); // storeKey -> {code, name, type}
  // aggregate: storeKey|drugCode|lotNo|expiredDate -> {qty, unitCost}
  const stockAgg = new Map();

  function addStock(storeKey, drugCode, lotNo, expiredDate, qty, unitCost) {
    const key = `${storeKey}||${drugCode}||${lotNo}||${expiredDate}`;
    const existing = stockAgg.get(key);
    if (existing) {
      existing.qty += qty;
      if (unitCost) existing.unitCost = unitCost;
    } else {
      stockAgg.set(key, { storeKey, drugCode, lotNo, expiredDate, qty, unitCost: unitCost || 0 });
    }
  }

  // ---- 2.1 Floor stock รายแผนก (รวม) : ไม่มี Lot/Expired ----
  {
    const ws = wb.getWorksheet('Floor stock รายแผนก (รวม)');
    let count = 0;
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const dept = cellText(row.getCell(1).value).trim();
      const codeRaw = cellText(row.getCell(2).value).trim();
      const name = cellText(row.getCell(3).value).trim();
      const uom = cellText(row.getCell(4).value).trim();
      const qty = Number(row.getCell(5).value) || 0;
      const cost = Number(row.getCell(6).value) || 0;
      if (!dept || !name) return;

      if (!isValidDrugCode(codeRaw)) {
        exceptions.push({ sheet: 'Floor stock รายแผนก (รวม)', row: rowNumber, code: codeRaw, name, status: 'SKIPPED', reason: 'รหัสยายังไม่ยืนยัน (รอ confirm code)' });
        return;
      }
      const storeKey = `FS::${dept}`;
      if (!storeDefs.has(storeKey)) {
        storeDefs.set(storeKey, { code: slugCode('FS', dept), name: `${dept} - Floor Stock`, type: 'FLOOR_STOCK' });
      }
      if (!drugsSeen.has(codeRaw)) drugsSeen.set(codeRaw, { name: codeNameMaster[codeRaw] || name, unit: uom || 'UNIT' });

      const lotNo = `IMPORT-${codeRaw}-INITIAL`;
      const expiredDate = placeholderExpiry();
      addStock(storeKey, codeRaw, lotNo, expiredDate, qty, cost);
      count++;
    });
    console.log(`Floor Stock: ${count} แถวนำเข้า (ใช้วันหมดอายุชั่วคราว +${PLACEHOLDER_EXPIRY_YEARS} ปี)`);
  }

  // ---- 2.2 Emergency Cart : มี Lot/Expired จริง ----
  {
    const ws = wb.getWorksheet('Emergency Cart');
    let count = 0;
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const dept = cellText(row.getCell(1).value).trim();
      const codeRaw = cellText(row.getCell(2).value).trim();
      const name = cellText(row.getCell(3).value).trim();
      const uom = cellText(row.getCell(4).value).trim();
      const qty = Number(row.getCell(5).value) || 0;
      const lotNoRaw = cellText(row.getCell(6).value).trim();
      const expiryCell = row.getCell(7).value;
      const cost = Number(row.getCell(8).value) || 0;
      const note = cellText(row.getCell(9).value).trim();
      if (!dept || !name) return;

      if (!isValidDrugCode(codeRaw)) {
        exceptions.push({ sheet: 'Emergency Cart', row: rowNumber, code: codeRaw, name, status: 'SKIPPED', reason: 'รหัสยาไม่ถูกต้อง' });
        return;
      }
      const expiry = parseExpiry(expiryCell);
      if (expiry.status === 'invalid') {
        exceptions.push({ sheet: 'Emergency Cart', row: rowNumber, code: codeRaw, name, status: 'SKIPPED', reason: `วันหมดอายุผิดปกติ: ${expiry.raw}` });
        return;
      }
      const expiryValue = expiry.status === 'ok' ? expiry.value : placeholderExpiry();
      if (expiry.status === 'empty') {
        exceptions.push({ sheet: 'Emergency Cart', row: rowNumber, code: codeRaw, name, status: 'IMPORTED_PLACEHOLDER', reason: `ไม่มีวันหมดอายุในไฟล์ - ใช้วันชั่วคราว ${expiryValue}` });
      }
      // แยก Store ตาม แผนก + หมายเหตุ (บาง แผนกมีมากกว่า 1 คัน เช่น Emergency Department No.1 / No.2)
      let groupSuffix = '';
      if (note && /No\.\s*\d+/i.test(note)) {
        const m = note.match(/No\.\s*(\d+)/i);
        groupSuffix = ` No.${m[1]}`;
      }
      const storeKey = `EC::${dept}${groupSuffix}`;
      if (!storeDefs.has(storeKey)) {
        storeDefs.set(storeKey, { code: slugCode('EC', `${dept}${groupSuffix}`), name: `${dept}${groupSuffix} - Emergency Cart`, type: 'EMERGENCY_BAG' });
      }
      if (!drugsSeen.has(codeRaw)) drugsSeen.set(codeRaw, { name: codeNameMaster[codeRaw] || name, unit: uom || 'UNIT' });

      const lotNo = lotNoRaw || `IMPORT-${codeRaw}-EXP${ymdCompact(expiryValue)}`;
      addStock(storeKey, codeRaw, lotNo, expiryValue, qty, cost);
      count++;
    });
    console.log(`Emergency Cart: ${count} แถวนำเข้า`);
  }

  // ---- 2.3 Box+Bag : มี Lot/Expired จริง (คอลัมน์เหมือน Emergency Cart) ----
  {
    const ws = wb.getWorksheet('Box+Bag');
    let count = 0;
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const kit = cellText(row.getCell(1).value).trim();
      const codeRaw = cellText(row.getCell(2).value).trim();
      const name = cellText(row.getCell(3).value).trim();
      const uom = cellText(row.getCell(4).value).trim();
      const qty = Number(row.getCell(5).value) || 0;
      const lotNoRaw = cellText(row.getCell(6).value).trim();
      const expiryCell = row.getCell(7).value;
      const cost = Number(row.getCell(8).value) || 0;
      if (!kit || !name) return;

      if (!isValidDrugCode(codeRaw)) {
        exceptions.push({ sheet: 'Box+Bag', row: rowNumber, code: codeRaw, name, status: 'SKIPPED', reason: 'รหัสยาไม่ถูกต้อง' });
        return;
      }
      const expiry = parseExpiry(expiryCell);
      if (expiry.status === 'invalid') {
        exceptions.push({ sheet: 'Box+Bag', row: rowNumber, code: codeRaw, name, status: 'SKIPPED', reason: `วันหมดอายุผิดปกติ: ${expiry.raw}` });
        return;
      }
      const expiryValue = expiry.status === 'ok' ? expiry.value : placeholderExpiry();
      if (expiry.status === 'empty') {
        exceptions.push({ sheet: 'Box+Bag', row: rowNumber, code: codeRaw, name, status: 'IMPORTED_PLACEHOLDER', reason: `ไม่มีวันหมดอายุในไฟล์ - ใช้วันชั่วคราว ${expiryValue}` });
      }
      const storeKey = `BB::${kit}`;
      if (!storeDefs.has(storeKey)) {
        storeDefs.set(storeKey, { code: slugCode('BB', kit), name: kit, type: 'EMERGENCY_BAG' });
      }
      if (!drugsSeen.has(codeRaw)) drugsSeen.set(codeRaw, { name: codeNameMaster[codeRaw] || name, unit: uom || 'UNIT' });

      const lotNo = lotNoRaw || `IMPORT-${codeRaw}-EXP${ymdCompact(expiryValue)}`;
      addStock(storeKey, codeRaw, lotNo, expiryValue, qty, cost);
      count++;
    });
    console.log(`Box+Bag: ${count} แถวนำเข้า`);
  }

  const skippedCount = exceptions.filter(e => e.status === 'SKIPPED').length;
  const placeholderCount = exceptions.filter(e => e.status === 'IMPORTED_PLACEHOLDER').length;
  console.log(`สรุปก่อนเขียนลงฐานข้อมูล: Store ${storeDefs.size} แห่ง, ยา ${drugsSeen.size} รายการ, บรรทัด Stock (หลังรวม Lot ซ้ำ) ${stockAgg.size}`);
  console.log(`  - ข้ามไม่นำเข้า (รหัสไม่ถูกต้อง/วันหมดอายุผิดปกติ): ${skippedCount} แถว`);
  console.log(`  - นำเข้าแล้วแต่ใช้วันหมดอายุชั่วคราว (ไม่มีข้อมูลในไฟล์): ${placeholderCount} แถว`);

  // ---------- 3) เขียนลงฐานข้อมูล ----------
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ผู้ทำรายการ (สำหรับ audit / stock_transactions.user_id)
    let runUser;
    if (RUN_AS_USERNAME) {
      const [[u]] = await conn.query(`SELECT user_id, username FROM users WHERE username = ?`, [RUN_AS_USERNAME]);
      runUser = u;
    }
    if (!runUser) {
      const [[u]] = await conn.query(
        `SELECT u.user_id, u.username FROM users u JOIN roles r ON r.role_id=u.role_id WHERE r.role_code='SUPER_ADMIN' ORDER BY u.user_id LIMIT 1`
      );
      runUser = u;
    }
    if (!runUser) throw new Error('ไม่พบ User สำหรับบันทึกรายการ (ต้องมี Super Admin อย่างน้อย 1 คน หรือระบุ username ผ่าน argument ที่ 2)');
    console.log('ทำรายการในนาม user:', runUser.username);

    // 3.1 Stores
    const storeIdByKey = new Map();
    for (const [key, def] of storeDefs.entries()) {
      await conn.query(
        `INSERT INTO stores (store_code, store_name, store_type, location) VALUES (?,?,?,NULL)
         ON DUPLICATE KEY UPDATE store_name = store_name`,
        [def.code, def.name, def.type]
      );
      const [[row]] = await conn.query(`SELECT store_id FROM stores WHERE store_code = ?`, [def.code]);
      storeIdByKey.set(key, row.store_id);
    }
    console.log(`สร้าง/ตรวจสอบ Store แล้ว: ${storeIdByKey.size} แห่ง`);

    // 3.2 Drug master
    const drugIdByCode = new Map();
    for (const [code, info] of drugsSeen.entries()) {
      await conn.query(
        `INSERT INTO drug_master (drug_code, drug_name, unit) VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE drug_name = VALUES(drug_name)`,
        [code, info.name, info.unit.slice(0, 30)]
      );
      const [[row]] = await conn.query(`SELECT drug_id FROM drug_master WHERE drug_code = ?`, [code]);
      drugIdByCode.set(code, row.drug_id);
    }
    console.log(`สร้าง/ตรวจสอบ Drug Master แล้ว: ${drugIdByCode.size} รายการ`);

    // 3.3 Lots + Store stock (snapshot: ตั้งค่าทับ ไม่ใช่บวกเพิ่ม - ปลอดภัยเมื่อรันซ้ำ)
    let lotCount = 0, stockCount = 0;
    for (const agg of stockAgg.values()) {
      const storeId = storeIdByKey.get(agg.storeKey);
      const drugId = drugIdByCode.get(agg.drugCode);
      if (!storeId || !drugId) continue;

      await conn.query(
        `INSERT INTO drug_lots (drug_id, lot_no, expired_date, unit_cost) VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE unit_cost = VALUES(unit_cost)`,
        [drugId, agg.lotNo, agg.expiredDate, agg.unitCost]
      );
      const [[lotRow]] = await conn.query(
        `SELECT lot_id FROM drug_lots WHERE drug_id = ? AND lot_no = ? AND expired_date = ?`,
        [drugId, agg.lotNo, agg.expiredDate]
      );
      lotCount++;

      await conn.query(
        `INSERT INTO store_stock (store_id, drug_id, lot_id, qty_on_hand, received_date) VALUES (?,?,?,?,NOW())
         ON DUPLICATE KEY UPDATE qty_on_hand = VALUES(qty_on_hand), received_date = NOW()`,
        [storeId, drugId, lotRow.lot_id, agg.qty]
      );
      stockCount++;

      await conn.query(
        `INSERT INTO stock_transactions (store_id, drug_id, lot_id, transaction_type, qty, unit_cost, balance_after, ref_type, ref_id, user_id)
         VALUES (?,?,?,'RECEIVE',?,?,?,?,NULL,?)`,
        [storeId, drugId, lotRow.lot_id, agg.qty, agg.unitCost, agg.qty, 'INITIAL_IMPORT', runUser.user_id]
      );
    }
    console.log(`บันทึก Lot: ${lotCount} รายการ, Store Stock: ${stockCount} รายการ`);

    await conn.query(
      `INSERT INTO audit_log (user_id, username, action, entity_type, detail) VALUES (?,?,?,?,?)`,
      [runUser.user_id, runUser.username, 'IMPORT_MED_DATA', 'SYSTEM', JSON.stringify({
        file: path.basename(FILE_PATH), stores: storeIdByKey.size, drugs: drugIdByCode.size,
        stockRows: stockCount, exceptions: exceptions.length
      })]
    );

    await conn.commit();
    console.log('นำเข้าข้อมูลสำเร็จ และบันทึกลงฐานข้อมูลเรียบร้อย (commit แล้ว)');
  } catch (err) {
    await conn.rollback();
    console.error('เกิดข้อผิดพลาด - ยกเลิกการนำเข้าทั้งหมด (rollback):', err);
    process.exitCode = 1;
    return;
  } finally {
    conn.release();
  }

  // ---------- 4) เขียนรายงานข้อยกเว้น / รายการที่ใช้วันหมดอายุชั่วคราว ----------
  if (exceptions.length) {
    const outWb = new ExcelJS.Workbook();
    const sheet = outWb.addWorksheet('รายการที่ควรตรวจสอบ');
    sheet.columns = [
      { header: 'สถานะ', key: 'status', width: 22 },
      { header: 'ชีทต้นฉบับ', key: 'sheet', width: 28 },
      { header: 'แถวที่ (Excel)', key: 'row', width: 14 },
      { header: 'รหัสยา/ค่าที่พบ', key: 'code', width: 20 },
      { header: 'ชื่อยา', key: 'name', width: 40 },
      { header: 'รายละเอียด', key: 'reason', width: 45 },
    ];
    sheet.getRow(1).font = { bold: true };
    exceptions.forEach(e => sheet.addRow({
      ...e,
      status: e.status === 'SKIPPED' ? 'ข้าม - ไม่ได้นำเข้า' : 'นำเข้าแล้ว (ใช้วันชั่วคราว)'
    }));
    const outPath = path.join(path.dirname(FILE_PATH), 'import-exceptions.xlsx');
    await outWb.xlsx.writeFile(outPath);
    console.log(`สร้างรายงานแล้ว: ${outPath} (${exceptions.length} รายการ: ข้าม ${skippedCount} / ใช้วันชั่วคราว ${placeholderCount})`);
  } else {
    console.log('ไม่มีรายการที่ต้องข้าม');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Import error:', err);
  process.exit(1);
});
