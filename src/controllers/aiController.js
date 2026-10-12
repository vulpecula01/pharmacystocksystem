// ----------------------------------------------------------------------------
// AI Assistant - ถาม-ตอบข้อมูล Stock ยาแบบภาษาพูด โดยใช้ Claude API (Tool Use)
// AI จะ "เรียกเครื่องมือ" (ดู src/utils/aiTools.js) เพื่อดึงข้อมูลจริงจากฐานข้อมูล
// เท่านั้น - ไม่สามารถเขียน SQL เองหรือแก้ไขข้อมูลใดๆ ได้ และถูกจำกัดสิทธิ์ตาม Store
// ของผู้ใช้งานที่ login อยู่เสมอ
// ----------------------------------------------------------------------------

const { callClaude } = require('../utils/anthropic');
const { TOOL_DEFS, runTool } = require('../utils/aiTools');
const ruleBasedQuery = require('../utils/ruleBasedQuery');

const SYSTEM_PROMPT = `คุณคือผู้ช่วย AI ประจำระบบบริหารจัดการ Stock ยา ของโรงพยาบาลกรุงเทพระยอง (Occhealth_BRH)
หน้าที่ของคุณคือช่วยตอบคำถามเกี่ยวกับสต๊อกยา, ยาใกล้หมดอายุ, ยาต่ำกว่า Minimum, และแนวโน้มการเบิก-จ่ายยา
โดยใช้เครื่องมือ (tools) ที่มีให้เพื่อดึงข้อมูลจริงจากฐานข้อมูลเสมอ ห้ามเดาหรือสมมติตัวเลขขึ้นเองเด็ดขาด
ถ้าคำถามไม่ชัดเจนว่าหมายถึงยาหรือ Store ใด ให้ใช้เครื่องมือค้นหาก่อน แล้วถามผู้ใช้งานให้ชัดเจนถ้ายังจำเป็น
ตอบเป็นภาษาไทย กระชับ ชัดเจน ใช้ตัวเลขจากข้อมูลจริงเท่านั้น หากไม่พบข้อมูลให้แจ้งตรงๆ ว่าไม่พบ
ห้ามให้คำแนะนำทางการแพทย์ (เช่น ขนาดยา วิธีใช้ยากับผู้ป่วย) หน้าที่ของคุณจำกัดเฉพาะข้อมูลด้าน Stock/คลังยาเท่านั้น`;

const MAX_HISTORY_MESSAGES = 16; // จำกัดประวัติสนทนาต่อ session กันบานปลาย/ค่าใช้จ่ายเกินจำเป็น
const MAX_TOOL_ROUNDS = 6;       // กันการวนเรียก tool ไม่รู้จบ

exports.chat = async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'กรุณาพิมพ์คำถาม' });
    }
    const user = req.session.user;

    // โหมดฟรี (ไม่มีค่าใช้จ่าย): ลองจับคำสำคัญตอบก่อนเสมอ ไม่เรียก Claude API เลยถ้าตอบได้
    let ruleResult;
    try {
      ruleResult = await ruleBasedQuery.answer(user, message);
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
    if (ruleResult.handled) {
      return res.json({ reply: ruleResult.text, mode: 'free' });
    }
    // จับคำสำคัญไม่ได้ - ถ้ามีการตั้งค่า ANTHROPIC_API_KEY ไว้ ให้ลองใช้ Claude API ช่วยตอบต่อ (มีค่าใช้จ่าย)
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.json({ reply: ruleResult.text, mode: 'free' });
    }

    if (!req.session.aiHistory) req.session.aiHistory = [];
    const history = req.session.aiHistory;

    history.push({ role: 'user', content: message });

    let rounds = 0;
    let finalText = '';
    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++;
      const response = await callClaude({
        system: SYSTEM_PROMPT,
        messages: history,
        tools: TOOL_DEFS,
        maxTokens: 1024
      });

      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');

      if (toolUseBlocks.length === 0) {
        finalText = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        history.push({ role: 'assistant', content: response.content });
        break;
      }

      // มีการเรียก tool - ต้องรันแล้วส่งผลลัพธ์กลับไปให้ Claude ต่อ
      history.push({ role: 'assistant', content: response.content });

      const toolResults = [];
      for (const block of toolUseBlocks) {
        let resultContent;
        try {
          const result = await runTool(block.name, user, block.input);
          resultContent = JSON.stringify(result);
        } catch (err) {
          resultContent = JSON.stringify({ error: err.message });
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: resultContent
        });
      }
      history.push({ role: 'user', content: toolResults });
    }

    if (!finalText) {
      finalText = 'ขออภัย ระบบไม่สามารถประมวลผลคำถามนี้ได้ในขณะนี้ กรุณาลองถามใหม่อีกครั้ง';
    }

    // จำกัดขนาดประวัติสนทนาที่เก็บไว้ใน session ไม่ให้บานปลาย
    // ตัดออกเฉพาะจาก "จุดเริ่มคำถามใหม่ของ user" เท่านั้น (role='user' และ content เป็น string ล้วน)
    // เพื่อไม่ให้ตัดขาดกลาง tool_use/tool_result pair ซึ่งจะทำให้เรียก API ครั้งถัดไปพังได้
    while (history.length > MAX_HISTORY_MESSAGES) {
      let cutIndex = -1;
      for (let i = 1; i < history.length; i++) {
        if (history[i].role === 'user' && typeof history[i].content === 'string') { cutIndex = i; break; }
      }
      if (cutIndex === -1) break; // หาจุดตัดที่ปลอดภัยไม่ได้ - หยุดตัด (กันประวัติพังดีกว่ากันยาว)
      history.splice(0, cutIndex);
    }

    res.json({ reply: finalText, mode: 'ai' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

exports.resetChat = (req, res) => {
  req.session.aiHistory = [];
  res.json({ ok: true });
};
