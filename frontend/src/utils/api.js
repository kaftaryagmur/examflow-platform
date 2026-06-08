export async function parseResponse(response) {
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: response.ok, status: response.status, body };
}

export function responseMessage(method, path, status, body, apiBaseUrl) {
  if (status === 413) {
    return `${method} ${path} isteği için dosya boyutu çok büyük. Daha küçük bir dosya yüklemeyi deneyin veya sistem yöneticisinden yükleme limitini artırmasını isteyin.`;
  }

  if (body === null || body === "") {
    if (apiBaseUrl.trim() === "/api") {
      return `${method} ${path} ${status} döndü. API proxy yanıt vermedi. api-service için port-forward açık mı? Komut: kubectl port-forward service/api-service 8080:80 -n examflow`;
    }
    return `${method} ${path} ${status} döndü. API yanıtı boş geldi. api-service durumunu kontrol et.`;
  }

  const text = typeof body === "string" ? body.trim() : JSON.stringify(body);
  if (text.includes("auth store unavailable")) {
    return `${method} ${path} ${status} döndü. Auth store hazır değil; api-service MongoDB bağlantısı olmadan register/login yapamaz. /ready içindeki databaseStatus değerini kontrol et.`;
  }
  if (text.includes("auth token signing unavailable")) {
    return `${method} ${path} ${status} döndü. JWT_SECRET api-service için hazır değil. Kubernetes Secret veya local env ayarını kontrol et.`;
  }
  if (text.includes("document store unavailable")) {
    return `${method} ${path} ${status} döndü. Document store hazır değil; MongoDB bağlantısı gerekli.`;
  }

  return `${method} ${path} ${status} döndü: ${text || "istek başarısız oldu"}`;
}
