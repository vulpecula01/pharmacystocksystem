// รองรับหลาย environment: ตั้งค่า ENV_FILE เพื่อเลือกไฟล์ .env ที่จะโหลด
// เช่น ENV_FILE=.env.test npm run start:test  (ค่าเริ่มต้นคือ .env)
require('dotenv').config({ path: process.env.ENV_FILE || '.env' });
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

const app = express();

// ---------- HTTPS (จำเป็นสำหรับหน้าคนขับ - เบราว์เซอร์บังคับให้ต้องเป็น HTTPS ถึงจะส่งพิกัด GPS ได้) ----------
// ถ้าตั้งค่า SSL_CERT_PATH/SSL_KEY_PATH ไว้ใน .env ระบบจะรันเป็น HTTPS แทน HTTP ธรรมดา
// และเปิด HTTP เดิมไว้เป็นแค่ตัวเด้ง (redirect) ไปหา HTTPS ให้อัตโนมัติ (ลิงก์/Bookmark เดิมยังใช้ได้)
const SSL_CERT_PATH = process.env.SSL_CERT_PATH;
const SSL_KEY_PATH = process.env.SSL_KEY_PATH;

let HTTPS_ENABLED = false;
if (!SSL_CERT_PATH || !SSL_KEY_PATH) {
  console.log('[HTTPS] ไม่ได้ตั้งค่า SSL_CERT_PATH/SSL_KEY_PATH ใน .env - รันเป็น HTTP ธรรมดา');
} else {
  const certAbs = path.resolve(SSL_CERT_PATH);
  const keyAbs = path.resolve(SSL_KEY_PATH);
  const certExists = fs.existsSync(certAbs);
  const keyExists = fs.existsSync(keyAbs);
  if (!certExists || !keyExists) {
    console.log(`[HTTPS] ไม่พบไฟล์ certificate - จะรันเป็น HTTP ธรรมดาแทน (โปรดตรวจสอบ path ให้ถูกต้อง)`);
    console.log(`[HTTPS]   กำลังมองหาไฟล์ที่: ${certAbs} (${certExists ? 'พบ' : 'ไม่พบ'}), ${keyAbs} (${keyExists ? 'พบ' : 'ไม่พบ'})`);
    console.log(`[HTTPS]   Working directory ปัจจุบัน: ${process.cwd()}`);
  } else {
    HTTPS_ENABLED = true;
  }
}

// ใช้ MySQL เป็นที่เก็บ Session (รองรับหลาย process / restart โดยไม่ต้อง login ใหม่)
const sessionStore = new MySQLStore({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000, // 8 ชั่วโมง
    secure: HTTPS_ENABLED // บังคับส่ง Cookie ผ่าน HTTPS เท่านั้นเมื่อเปิดใช้ HTTPS แล้ว (ปลอดภัยขึ้น)
  }
}));

// ทำให้ currentUser ใช้ได้ในทุก view
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.activePage = '';
  next();
});

// ---------- Routes ----------
app.use('/', require('./src/routes/authRoutes'));
app.use('/', require('./src/routes/pageRoutes'));
app.use('/api/stores', require('./src/routes/storeRoutes'));
app.use('/api/drugs', require('./src/routes/drugRoutes'));
app.use('/api/transfers', require('./src/routes/transferRoutes'));
app.use('/api/stock', require('./src/routes/stockRoutes'));
app.use('/api/reports', require('./src/routes/reportRoutes'));
app.use('/api/dashboard', require('./src/routes/dashboardRoutes'));
app.use('/api/admin', require('./src/routes/adminRoutes'));
app.use('/api/ai', require('./src/routes/aiRoutes'));
app.use('/api/delivery', require('./src/routes/deliveryRoutes'));
app.use('/api/track', require('./src/routes/trackRoutes'));

app.use((req, res) => {
  res.status(404).render('error', { message: 'ไม่พบหน้าที่ต้องการ (404)' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(500).json({ error: err.message || 'เกิดข้อผิดพลาดของระบบ' });
  }
  res.status(500).render('error', { message: 'เกิดข้อผิดพลาดของระบบ: ' + err.message });
});

const PORT = process.env.PORT || 3000;

if (HTTPS_ENABLED) {
  const HTTPS_PORT = process.env.HTTPS_PORT || 6543;
  const httpsOptions = {
    cert: fs.readFileSync(SSL_CERT_PATH),
    key: fs.readFileSync(SSL_KEY_PATH)
  };

  https.createServer(httpsOptions, app).listen(HTTPS_PORT, () => {
    console.log(`Pharmacy Stock System (HTTPS) running on https://localhost:${HTTPS_PORT}`);
  });

  // เปิด HTTP เดิมไว้เป็นแค่ตัวเด้งไป HTTPS อัตโนมัติ (ลิงก์/Bookmark ที่เคยใช้ http://...:${PORT} ยังใช้ได้เหมือนเดิม)
  http.createServer((req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    res.writeHead(301, { Location: `https://${host}:${HTTPS_PORT}${req.url}` });
    res.end();
  }).listen(PORT, () => {
    console.log(`HTTP -> HTTPS redirect listener running on http://localhost:${PORT} (เด้งไป port ${HTTPS_PORT})`);
  });
} else {
  app.listen(PORT, () => {
    console.log(`Pharmacy Stock System running on http://localhost:${PORT}`);
  });
}
