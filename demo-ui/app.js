const statusOutput = document.getElementById("status-output");
const publishOutput = document.getElementById("publish-output");
const publishForm = document.getElementById("publish-form");
const refreshStatusButton = document.getElementById("refresh-status");

function getBaseUrl() {
  return document.getElementById("api-base-url").value.trim().replace(/\/+$/, "");
}

function setBadge(id, text, tone) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = `badge ${tone}`;
}

function formatJSON(data) {
  return JSON.stringify(data, null, 2);
}

async function fetchJSON(path) {
  const response = await fetch(`${getBaseUrl()}${path}`);
  const text = await response.text();

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

async function refreshStatus() {
  statusOutput.textContent = "Durum endpoint'leri sorgulaniyor...";

  try {
    const [health, ready] = await Promise.all([fetchJSON("/health"), fetchJSON("/ready")]);

    setBadge("health-status", `${health.status}`, health.ok ? "ok" : "warn");
    setBadge("ready-status", `${ready.status}`, ready.ok ? "ok" : ready.status === 202 ? "warn" : "neutral");

    statusOutput.textContent = formatJSON({
      health,
      ready,
    });
  } catch (error) {
    setBadge("health-status", "Hata", "warn");
    setBadge("ready-status", "Hata", "warn");
    statusOutput.textContent = `Status sorgusu basarisiz:\n${error.message}`;
  }
}

async function submitPublish(event) {
  event.preventDefault();

  const payload = {
    documentId: document.getElementById("document-id").value.trim(),
    fileName: document.getElementById("file-name").value.trim(),
    source: document.getElementById("source").value.trim(),
  };

  publishOutput.textContent = "Publish istegi gonderiliyor...";

  try {
    const response = await fetch(`${getBaseUrl()}/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }

    publishOutput.textContent = formatJSON({
      request: payload,
      status: response.status,
      ok: response.ok,
      body,
    });
  } catch (error) {
    publishOutput.textContent = `Publish istegi basarisiz:\n${error.message}`;
  }
}

refreshStatusButton.addEventListener("click", refreshStatus);
publishForm.addEventListener("submit", submitPublish);

refreshStatus();
