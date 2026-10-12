const chatBody = document.getElementById('chatBody');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function addMessage(role, text) {
  const wrap = document.createElement('div');
  wrap.className = `d-flex mb-3 ${role === 'user' ? 'justify-content-end' : 'justify-content-start'}`;
  const bubble = document.createElement('div');
  bubble.className = role === 'user'
    ? 'bg-success text-white rounded-3 px-3 py-2'
    : 'bg-light border rounded-3 px-3 py-2';
  bubble.style.maxWidth = '80%';
  bubble.style.whiteSpace = 'pre-wrap';
  bubble.innerHTML = escapeHtml(text);
  wrap.appendChild(bubble);
  chatBody.appendChild(wrap);
  chatBody.scrollTop = chatBody.scrollHeight;
  return bubble;
}

function timeGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'อรุณสวัสดิ์ครับ ☀️';
  if (hour >= 12 && hour < 16) return 'สวัสดีตอนบ่ายครับ 🌤️';
  if (hour >= 16 && hour < 19) return 'สวัสดีตอนเย็นครับ 🌆';
  return 'สวัสดีครับ 🌙';
}

const userName = chatBody.dataset.userName;
const nameGreeting = userName ? ` คุณ${userName}` : '';
addMessage('assistant', `${timeGreeting()}${nameGreeting} ผมคือผู้ช่วย AI ประจำระบบคลังยาครับ 😊 ถามข้อมูล Stock, ยาใกล้หมดอายุ, ยาต่ำกว่า Min หรือแนวโน้มการเบิกใช้ได้เลยครับ`);

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;
  addMessage('user', message);
  chatInput.value = '';
  chatInput.disabled = true;
  sendBtn.disabled = true;
  const loadingBubble = addMessage('assistant', 'กำลังค้นข้อมูล...');
  try {
    const { reply } = await apiSend('/api/ai/chat', 'POST', { message });
    loadingBubble.innerText = reply;
  } catch (err) {
    loadingBubble.innerText = 'เกิดข้อผิดพลาด: ' + err.message;
  } finally {
    chatInput.disabled = false;
    sendBtn.disabled = false;
    chatInput.focus();
    chatBody.scrollTop = chatBody.scrollHeight;
  }
});

document.getElementById('resetBtn').addEventListener('click', async () => {
  try {
    await apiSend('/api/ai/reset', 'POST');
    chatBody.innerHTML = '';
    addMessage('assistant', 'เริ่มการสนทนาใหม่แล้วครับ มีอะไรให้ช่วยดูข้อมูล Stock ไหมครับ');
  } catch (err) {
    showToast(err.message, 'danger');
  }
});
