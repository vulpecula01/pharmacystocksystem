// เรียกใช้ db/seed.js พร้อมกำหนดไฟล์ .env ที่ต้องการ (เหมือน run-with-env.js แต่สำหรับ seed)
// วิธีใช้: node scripts/seed-with-env.js .env.test
const path = require('path');
const { spawn } = require('child_process');

const envFile = process.argv[2];
if (!envFile) {
  console.error('กรุณาระบุไฟล์ .env เช่น: node scripts/seed-with-env.js .env.test');
  process.exit(1);
}

const seedPath = path.join(__dirname, '..', 'db', 'seed.js');

const child = spawn(process.execPath, [seedPath], {
  stdio: 'inherit',
  env: { ...process.env, ENV_FILE: envFile }
});

child.on('exit', (code) => process.exit(code === null ? 1 : code));
