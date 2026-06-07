export function compactTimestamp(date) {
  return date.toISOString().replace(new RegExp("[\\-:.TZ]", "g"), "").slice(0, 14);
}

export function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function toneClass(tone = "idle") {
  if (["ok", "ready", "authenticated", "accepted", "validated", "uploaded"].includes(tone)) {
    return "border-neon-green/40 bg-neon-green/10 text-neon-green";
  }
  if (["running", "processing", "degraded", "pending"].includes(tone)) {
    return "border-neon-amber/40 bg-neon-amber/10 text-neon-amber";
  }
  if (["failed", "error", "invalid"].includes(tone)) {
    return "border-danger/50 bg-danger/10 text-danger";
  }
  return "border-space-line bg-white/5 text-muted";
}

export function parseRecordDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function displayStatus(value) {
  const normalized = String(value || "").toLowerCase();
  const labels = {
    accepted: "Kabul edildi",
    authenticated: "Oturum açık",
    degraded: "Kısmi hazır",
    error: "Hata",
    failed: "Başarısız",
    idle: "Bekliyor",
    invalid: "Geçersiz",
    not_configured: "Yapılandırılmadı",
    ok: "Çalışıyor",
    pending: "Bekliyor",
    processed: "İşlendi",
    processing: "İşleniyor",
    pubsub: "Pub/Sub",
    published: "Yayınlandı",
    ready: "Hazır",
    received: "Alındı",
    recorded: "Kaydedildi",
    running: "Çalışıyor",
    uploaded: "Yüklendi",
    unreachable: "Ulaşılamıyor",
    unknown: "Bilinmiyor",
    validated: "Doğrulandı",
    waiting: "Bekliyor",
  };
  return labels[normalized] || value || "Bilinmiyor";
}

export function sortRecordsByDate(records) {
  return [...records].sort((left, right) => {
    return new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0);
  });
}
