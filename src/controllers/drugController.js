const QRCode = require('qrcode');
const pool = require('../config/db');

// ค้นหายา (ใช้ในหน้า Transfer / Issue / Admin)
exports.searchDrugs = async (req, res) => {
  try {
    const q = req.query.q ? `%${req.query.q}%` : '%';
    const [rows] = await pool.query(
      `SELECT d.drug_id, d.drug_code, d.drug_name, d.strength_form, d.unit,
              dg.group_name, d.is_active
       FROM drug_master d
       LEFT JOIN drug_groups dg ON dg.drug_group_id = d.drug_group_id
       WHERE d.is_active = 1 AND (d.drug_name LIKE ? OR d.drug_code LIKE ?)
       ORDER BY d.drug_name LIMIT 50`,
      [q, q]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getDrug = async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM drug_master WHERE drug_id = ?`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบยา' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getDrugByCode = async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM drug_master WHERE drug_code = ?`, [req.params.code]);
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบยารหัสนี้ในระบบ' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Generate QR Code (PNG) จากรหัสยา 14 หลัก - ใช้พิมพ์ติดภาชนะ/ป้ายยา
exports.getQrCode = async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT drug_code, drug_name FROM drug_master WHERE drug_id = ?`, [req.params.id]);
    const drug = rows[0];
    if (!drug) return res.status(404).send('ไม่พบยา');
    const png = await QRCode.toBuffer(drug.drug_code, { type: 'png', width: 300, margin: 1 });
    res.set('Content-Type', 'image/png');
    res.send(png);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
