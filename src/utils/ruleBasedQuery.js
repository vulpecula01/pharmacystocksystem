// ----------------------------------------------------------------------------
// เครื่องมือค้นหาข้อมูล Stock แบบ "จับคำสำคัญ" (Rule-based) - ไม่มีค่าใช้จ่ายใดๆ
// ไม่ได้เรียก Claude API เลย ทำงานด้วยการจับคำสำคัญในประโยคภาษาไทย/อังกฤษทั่วไป
// แล้วดึงข้อมูลจริงจากฐานข้อมูลผ่าน aiTools.js (ชุดเดียวกับที่ AI Chat ใช้)
//
// ข้อจำกัด: เข้าใจได้เฉพาะรูปแบบคำถามที่ตรงกับ pattern ที่กำหนดไว้เท่านั้น
// (ไม่ยืดหยุ่นเท่าการใช้ Claude API จริง) ถ้าจับคำสำคัญไม่ได้จะแจ้งตัวอย่างคำถามให้ลองใหม่
// ----------------------------------------------------------------------------

const { runTool } = require('./aiTools');

function fmtNum(n) {
  const num = Number(n);
  return Number.isFinite(num) ? num.toLocaleString('th-TH', { maximumFractionDigits: 2 }) : n;
}
function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
}

const EXAMPLES = [
  '- "ER เหลือ Adrenaline กี่หลอด"',
  '- "ยาอะไรใกล้หมดอายุบ้าง"',
  '- "ICU ต่ำกว่า min อะไรบ้าง"',
  '- "แนวโน้มการเบิกใช้ Paracetamol 30 วันที่ผ่านมา"',
  '- "มี Store อะไรบ้าง"',
  '- "ค้นหายา amoxicillin"',
  '- "Store ไหนยังไม่รับ Transfer บ้าง"',
  '- "รายการ Transfer ที่ค้างสถานะ Pending"'
];

function extractDays(message, fallback) {
  const m = message.match(/(\d+)\s*วัน/);
  if (m) return Number(m[1]);
  if (/เดือนนี้|เดือนหน้า|1\s*เดือน/.test(message)) return 30;
  if (/2\s*เดือน/.test(message)) return 60;
  if (/3\s*เดือน|ไตรมาส/.test(message)) return 90;
  if (/สัปดาห์นี้|อาทิตย์นี้|1\s*สัปดาห์/.test(message)) return 7;
  if (/ปีนี้|1\s*ปี/.test(message)) return 365;
  return fallback;
}

// พยายามหา store ที่ถูกกล่าวถึงในข้อความ โดยเทียบกับชื่อ/รหัส store จริงที่ user เข้าถึงได้
function matchStore(message, stores) {
  const lower = message.toLowerCase();
  let best = null;
  for (const s of stores) {
    const candidates = [s.store_name, s.store_code].filter(Boolean);
    for (const c of candidates) {
      const cLower = c.toLowerCase();
      if (cLower.length >= 2 && lower.includes(cLower)) {
        if (!best || cLower.length > best._len) best = { ...s, _len: cLower.length };
      }
    }
  }
  return best ? best.store_id : null;
}

// escape อักขระพิเศษของ Regex (ชื่อ store จริงมักมีวงเล็บ เช่น "ห้องยาหลัก (Main Pharmacy)")
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ตัดคำสำคัญ/ชื่อ store/ตัวเลขวันออกจากข้อความ เหลือไว้เป็นคำค้นหายาโดยประมาณ
function extractDrugQuery(message, stores) {
  let text = message;
  // หมายเหตุ: เลี่ยงคำสั้นๆ ที่มักเป็นส่วนหนึ่งของคำอื่น (เช่น "ยา" ซ้อนอยู่ใน "ห้องยาหลัก")
  // เพราะจะตัดพลาดทำให้ชื่อ store/ยาขาดหายไปเป็นชิ้นๆ
  const stopWords = [
    'เหลือ', 'คงเหลือ', 'เท่าไหร่', 'เท่าไร', 'จำนวนสต๊อก', 'สต๊อก', 'stock',
    'กี่หลอด', 'กี่เม็ด', 'กี่ขวด', 'บ้าง', 'ไหม', 'ครับ', 'คะ', 'ค่ะ',
    'แนวโน้ม', 'การเบิกใช้', 'เบิกใช้', 'เบิกจ่าย', 'movement', 'ที่ผ่านมา', 'ผ่านมา', 'ย้อนหลัง'
  ];
  for (const s of stores) {
    if (s.store_name) text = text.replace(new RegExp(escapeRegex(s.store_name), 'gi'), ' ');
    if (s.store_code) text = text.replace(new RegExp(escapeRegex(s.store_code), 'gi'), ' ');
  }
  text = text.replace(/\d+\s*วัน/g, ' '); // ตัดช่วงเวลาแบบ "30 วัน" ออก
  for (const w of stopWords) text = text.replace(new RegExp(escapeRegex(w), 'gi'), ' ');
  return text.replace(/\s+/g, ' ').trim();
}

// ทักทายแบบมีชีวิตชีวา - ปรับคำตามช่วงเวลาจริง และเรียกชื่อผู้ใช้งานถ้ามี
function greetingReply(user) {
  const hour = new Date().getHours();
  let timeGreeting;
  if (hour >= 5 && hour < 12) timeGreeting = 'อรุณสวัสดิ์ครับ ☀️';
  else if (hour >= 12 && hour < 16) timeGreeting = 'สวัสดีตอนบ่ายครับ 🌤️';
  else if (hour >= 16 && hour < 19) timeGreeting = 'สวัสดีตอนเย็นครับ 🌆';
  else timeGreeting = 'สวัสดีครับ 🌙 ทำงานดึกอยู่เลยนะครับ';

  const name = user && user.full_name ? user.full_name.split(' ')[0] : null;
  const nameGreeting = name ? ` คุณ${name}` : '';

  const openers = [
    `${timeGreeting}${nameGreeting} ผมพร้อมช่วยดูข้อมูลคลังยาให้แล้วครับ 😊`,
    `${timeGreeting}${nameGreeting} วันนี้อยากให้ช่วยเช็คอะไรเกี่ยวกับ Stock ยาบ้างครับ?`,
    `${timeGreeting}${nameGreeting} มีอะไรให้ผมช่วยดูสต๊อกยาวันนี้ไหมครับ?`
  ];
  // สุ่มแบบเบาๆ ให้ไม่รู้สึกเหมือนตอบซ้ำแบบเดิมทุกครั้ง
  const pick = openers[Math.floor((hour + (message_seed || 0)) % openers.length)];
  return `${pick}\n\nลองถามได้เลย เช่น:\n${EXAMPLES.join('\n')}`;
}
let message_seed = 0;

async function answer(user, message) {
  const stores = await runTool('list_stores', user, {});
  const storeId = matchStore(message, stores);

  // 0) ทักทาย - ตอบให้เป็นธรรมชาติ ไม่ใช่แค่ Error message
  if (/^\s*(สวัสดี|หวัดดี|ดีครับ|ดีค่ะ|hello|hi|hey|good\s*morning|good\s*afternoon|good\s*evening)/i.test(message.trim())) {
    message_seed++;
    return { handled: true, text: greetingReply(user) };
  }

  // 1) ยาใกล้หมดอายุ / หมดอายุแล้ว
  if (/ใกล้หมดอายุ|หมดอายุ|expire|expiry/i.test(message)) {
    const days = extractDays(message, 90);
    const rows = await runTool('get_near_expiry', user, { storeId, days });
    if (!rows.length) return { handled: true, text: `ไม่พบยาที่ใกล้หมดอายุภายใน ${days} วัน${storeId ? ' ในร้านที่ระบุ' : ''} ครับ` };
    const lines = rows.slice(0, 15).map(r =>
      `- ${r.drug_name} (${r.drug_code}) | ${r.store_name} | Lot ${r.lot_no} | หมดอายุ ${fmtDate(r.expired_date)} (เหลือ ${r.days_to_expire} วัน) | คงเหลือ ${fmtNum(r.qty_on_hand)} | สถานะ: ${r.expiry_status === 'EXPIRED' ? 'หมดอายุแล้ว' : 'ใกล้หมดอายุ'}`
    );
    const more = rows.length > 15 ? `\n...และอีก ${rows.length - 15} รายการ (ดูทั้งหมดได้ที่เมนู Reports > Near Expiry)` : '';
    return { handled: true, text: `พบยาใกล้หมดอายุ/หมดอายุแล้ว ${rows.length} รายการ:\n${lines.join('\n')}${more}` };
  }

  // 2) ต่ำกว่า Min
  if (/ต่ำกว่า\s*min|below\s*min|ขาดสต๊อก|ใกล้หมด(?!อายุ)|น้อยกว่ากำหนด/i.test(message)) {
    const rows = await runTool('get_below_min', user, { storeId });
    if (!rows.length) return { handled: true, text: `ไม่พบรายการที่ต่ำกว่า Minimum Stock${storeId ? ' ในร้านที่ระบุ' : ''} ครับ` };
    const lines = rows.slice(0, 15).map(r =>
      `- ${r.drug_name} (${r.drug_code}) | ${r.store_name} | คงเหลือ ${fmtNum(r.qty_on_hand)} (Min ${fmtNum(r.min_qty)} / Max ${fmtNum(r.max_qty)})`
    );
    const more = rows.length > 15 ? `\n...และอีก ${rows.length - 15} รายการ` : '';
    return { handled: true, text: `พบรายการต่ำกว่า Minimum Stock ${rows.length} รายการ:\n${lines.join('\n')}${more}` };
  }

  // 2.5) Transfer ที่ยังไม่รับ / ค้างสถานะ Pending / ยังเป็น Draft
  if (/transfer|โอนย้าย|โอนยา|ยังไม่รับ|ค้างรับ|รอรับ|pending|ค้างสถานะ|draft/i.test(message)) {
    const includeDraft = /draft|ร่าง/i.test(message);
    const rows = await runTool('get_pending_transfers', user, { storeId, includeDraft });
    if (!rows.length) return { handled: true, text: `ไม่พบรายการ Transfer ที่ค้างสถานะ${includeDraft ? ' (Draft/รอรับสินค้า)' : 'รอรับสินค้า'}${storeId ? ' ในร้านที่ระบุ' : ''} ครับ` };
    const lines = rows.slice(0, 15).map(r => {
      const statusLabel = r.status === 'DRAFT' ? 'Draft (ยังไม่ส่งออก)' : 'รอรับสินค้า';
      return `- ${r.transfer_no} | ${statusLabel} | จาก ${r.from_store} → ถึง ${r.to_store} | ${r.item_count} รายการ | สร้างโดย ${r.created_by} | ค้างมาแล้ว ${r.days_waiting} วัน`;
    });
    const more = rows.length > 15 ? `\n...และอีก ${rows.length - 15} รายการ` : '';
    return { handled: true, text: `พบรายการ Transfer ที่ค้างอยู่ ${rows.length} รายการ:\n${lines.join('\n')}${more}` };
  }

  // 3) แนวโน้มการเบิก-จ่าย / Movement summary
  if (/แนวโน้ม|เบิกใช้|เบิกจ่าย|movement|ใช้ไปเท่าไหร่|ใช้ไปกี่/i.test(message)) {
    const days = extractDays(message, 30);
    const drugQuery = extractDrugQuery(message, stores);
    const rows = await runTool('get_movement_summary', user, { storeId, days, drugQuery: drugQuery || undefined });
    if (!rows.length) return { handled: true, text: `ไม่พบข้อมูลการเคลื่อนไหวสต๊อกในช่วง ${days} วันที่ผ่านมา${drugQuery ? ` สำหรับ "${drugQuery}"` : ''} ครับ` };
    const lines = rows.slice(0, 15).map(r =>
      `- ${r.drug_name} (${r.drug_code}) | ${r.transaction_type} | รวม ${fmtNum(r.total_qty)} (${r.tx_count} ครั้ง)`
    );
    const more = rows.length > 15 ? `\n...และอีก ${rows.length - 15} รายการ` : '';
    return { handled: true, text: `สรุปการเคลื่อนไหวสต๊อกย้อนหลัง ${days} วัน:\n${lines.join('\n')}${more}` };
  }

  // 4) รายชื่อ Store
  if (/store\s*(อะไร|ไหน)|มี\s*store|รายชื่อ\s*store|แผนกอะไรบ้าง|รายชื่อแผนก/i.test(message)) {
    const lines = stores.map(s => `- ${s.store_name} (${s.store_code}, ${s.store_type})`);
    return { handled: true, text: `Store ที่คุณมีสิทธิ์เข้าถึงทั้งหมด ${stores.length} แห่ง:\n${lines.join('\n')}` };
  }

  // 5) ค้นหายา (ชื่อ/รหัส)
  const searchMatch = message.match(/ค้นหายา\s*(.+)/i) || message.match(/รหัสยา\s*(?:ของ|คือ)?\s*(.+)/i);
  if (searchMatch && searchMatch[1].trim()) {
    const q = searchMatch[1].trim();
    const rows = await runTool('search_drug', user, { query: q });
    if (!rows.length) return { handled: true, text: `ไม่พบยาที่ตรงกับ "${q}" ครับ` };
    const lines = rows.map(r => `- ${r.drug_name} | รหัส ${r.drug_code} | หน่วย ${r.unit}`);
    return { handled: true, text: `พบยาที่ตรงกับ "${q}" จำนวน ${rows.length} รายการ:\n${lines.join('\n')}` };
  }

  // 6) ค่าเริ่มต้น: ถ้าดูเหมือนถามยอดคงเหลือของยาตัวใดตัวหนึ่ง (มีคำว่า เหลือ/คงเหลือ/มี...ไหม) ให้ลอง get_stock
  if (/เหลือ|คงเหลือ|มี.*ไหม|กี่หลอด|กี่เม็ด|กี่ขวด/i.test(message)) {
    const drugQuery = extractDrugQuery(message, stores);
    if (drugQuery) {
      const rows = await runTool('get_stock', user, { storeId, drugQuery });
      if (!rows.length) return { handled: true, text: `ไม่พบข้อมูลสต๊อกของ "${drugQuery}"${storeId ? ' ในร้านที่ระบุ' : ''} ครับ (ลองตรวจสอบชื่อยาอีกครั้ง หรือพิมพ์ "ค้นหายา ${drugQuery}" เพื่อดูชื่อที่ถูกต้อง)` };
      const lines = rows.slice(0, 15).map(r =>
        `- ${r.drug_name} | ${r.store_name} | Lot ${r.lot_no} (หมดอายุ ${fmtDate(r.expired_date)}) | คงเหลือ ${fmtNum(r.qty_on_hand)} ${r.unit}`
      );
      const more = rows.length > 15 ? `\n...และอีก ${rows.length - 15} รายการ` : '';
      return { handled: true, text: `พบข้อมูลสต๊อก "${drugQuery}" ${rows.length} รายการ:\n${lines.join('\n')}${more}` };
    }
  }

  return {
    handled: false,
    text: `ขออภัยครับ ผมจับคำถามนี้ไม่ได้ (โหมดค้นหาฟรีเข้าใจได้เฉพาะรูปแบบคำถามที่กำหนดไว้) ลองพิมพ์ในรูปแบบนี้ดูครับ:\n${EXAMPLES.join('\n')}`
  };
}

module.exports = { answer };
