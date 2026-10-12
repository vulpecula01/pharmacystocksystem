const mysql = require('mysql2/promise');
require('dotenv').config({ path: process.env.ENV_FILE || '.env' });

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
  // บังคับ collation ของทุก connection ให้ตรงกับที่ schema/views ใช้เสมอ
  // ป้องกัน "Illegal mix of collations" เวลาเซิร์ฟเวอร์ MySQL ใช้ default collation คนละแบบ
  // (เช่น utf8mb4_0900_ai_ci ของ MySQL 8) กับที่ view คำนวณไว้
  charset: 'utf8mb4_unicode_ci'
});

module.exports = pool;
