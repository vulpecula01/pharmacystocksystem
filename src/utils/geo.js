// คำนวณระยะทางแบบเส้นตรง (Haversine) ระหว่างพิกัด 2 จุด หน่วยเป็นกิโลเมตร
// หมายเหตุ: เป็นระยะทางเส้นตรง ไม่ใช่ระยะทางตามถนนจริง (ไม่ได้เรียก Maps API ใดๆ จึงไม่มีค่าใช้จ่าย)
// ใช้ประมาณ ETA คร่าวๆ เท่านั้น ไม่ควรใช้นำทางจริง
function haversineKm(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some(v => v === null || v === undefined || Number.isNaN(Number(v)))) {
    return null;
  }
  const R = 6371; // รัศมีโลก (กม.)
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// แปลงจำนวนชั่วโมง (ทศนิยม) เป็นข้อความ "X ชม. Y นาที" แบบอ่านง่าย
function formatEta(hoursDecimal) {
  if (hoursDecimal === null || hoursDecimal === undefined || !Number.isFinite(hoursDecimal)) return null;
  if (hoursDecimal <= 0) return 'ถึงที่หมายแล้ว (โดยประมาณ)';
  const totalMinutes = Math.round(hoursDecimal * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h <= 0) return `~${m} นาที`;
  if (m === 0) return `~${h} ชม.`;
  return `~${h} ชม. ${m} นาที`;
}

// คำนวณระยะทางที่เหลือ + ETA จากพิกัดปัจจุบัน (หรือระยะทาง snapshot ถ้ายังไม่มีพิกัด GPS)
function estimateRemaining({ currentLat, currentLng, destLat, destLng, fallbackDistanceKm, avgSpeedKmh }) {
  const speed = Number(avgSpeedKmh) > 0 ? Number(avgSpeedKmh) : 40;
  let distanceKm = null;

  if (currentLat !== null && currentLat !== undefined && destLat !== null && destLat !== undefined) {
    distanceKm = haversineKm(currentLat, currentLng, destLat, destLng);
  }
  if (distanceKm === null && fallbackDistanceKm !== null && fallbackDistanceKm !== undefined) {
    distanceKm = Number(fallbackDistanceKm);
  }
  if (distanceKm === null) return { distanceKm: null, etaHours: null, etaText: null };

  const etaHours = distanceKm / speed;
  return { distanceKm: Math.round(distanceKm * 10) / 10, etaHours, etaText: formatEta(etaHours) };
}

module.exports = { haversineKm, formatEta, estimateRemaining };
