// เรียกใช้ server.js พร้อมกำหนดไฟล์ .env ที่ต้องการ โดยไม่ต้องพึ่ง package เสริมใดๆ
// ใช้แทน cross-env เพื่อให้ทำงานได้บน Windows/Linux/Mac เหมือนกัน แม้ไม่มีอินเทอร์เน็ต
// วิธีใช้: node scripts/run-with-env.js .env.production
const path = require('path');
const { spawn } = require('child_process');

const envFile = process.argv[2];
if (!envFile) {
  console.error('กรุณาระบุไฟล์ .env เช่น: node scripts/run-with-env.js .env.production');
  process.exit(1);
}

const serverPath = path.join(__dirname, '..', 'server.js');

const child = spawn(process.execPath, [serverPath], {
  stdio: 'inherit',
  env: { ...process.env, ENV_FILE: envFile }
});

child.on('exit', (code) => process.exit(code === null ? 1 : code));
