// ----------------------------------------------------------------------------
// Client เรียก Claude API (Anthropic Messages API) แบบเบาที่สุด - ไม่ใช้ SDK เสริมใดๆ
// ใช้ global fetch ที่มีอยู่ในตัว Node.js เวอร์ชัน 18 ขึ้นไปอยู่แล้ว (ไม่ต้อง npm install
// เพิ่ม สอดคล้องกับข้อจำกัดที่ Production Server ไม่มีอินเทอร์เน็ตสำหรับติดตั้ง package)
//
// Server นี้ต้องเปิดให้ยิง HTTPS ออกไปยัง api.anthropic.com ได้ (ไม่ต้องเปิดอินเทอร์เน็ตทั้งหมด)
// ----------------------------------------------------------------------------

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

function getConfig() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';
  if (!apiKey) {
    throw Object.assign(new Error('ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY ในไฟล์ .env (ติดต่อผู้ดูแลระบบ)'), { status: 500 });
  }
  return { apiKey, model };
}

// เรียก Claude API ครั้งเดียว (ไม่จัดการ tool loop - ให้ผู้เรียกจัดการเอง)
async function callClaude({ system, messages, tools, maxTokens = 1024 }) {
  const { apiKey, model } = getConfig();

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages,
      ...(tools && tools.length ? { tools } : {})
    })
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || `Anthropic API error (HTTP ${res.status})`;
    throw Object.assign(new Error(msg), { status: 502 });
  }
  return data;
}

module.exports = { callClaude };
