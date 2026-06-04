import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Cloud,
  Database,
  FileText,
  FileUp,
  KeyRound,
  LayoutDashboard,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const defaultBaseUrl = "/api";
const demoPassword = "ExamFlowDemo2026";
const sessionKey = "examflow-demo-session";

const views = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "exams", label: "Exams", icon: ClipboardList },
];

const emptyTimeline = [
  { id: "received", label: "received", detail: "API Service", status: "waiting" },
  { id: "published", label: "published", detail: "Pub/Sub Event", status: "waiting" },
  { id: "processing", label: "processing", detail: "Worker Service", status: "waiting" },
  { id: "validated", label: "validated", detail: "Validation Service", status: "waiting" },
  { id: "failed", label: "failed", detail: "Error State", status: "waiting" },
];

function readStoredSession() {
  const raw = window.localStorage.getItem(sessionKey);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    window.localStorage.removeItem(sessionKey);
    return null;
  }
}

function compactTimestamp(date) {
  return date.toISOString().replace(new RegExp("[\\-:.TZ]", "g"), "").slice(0, 14);
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function toneClass(tone = "idle") {
  if (["ok", "ready", "authenticated", "accepted", "validated", "uploaded"].includes(tone)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (["running", "processing", "degraded", "pending"].includes(tone)) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (["failed", "error", "invalid"].includes(tone)) {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function parseRecordDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

async function parseResponse(response) {
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: response.ok, status: response.status, body };
}

function responseMessage(method, path, status, body, apiBaseUrl) {
  if (body === null || body === "") {
    if (apiBaseUrl.trim() === "/api") {
      return `${method} ${path} returned ${status}. API proxy yanit vermedi. api-service icin port-forward acik mi? Komut: kubectl port-forward service/api-service 8080:80 -n examflow`;
    }
    return `${method} ${path} returned ${status}. API yaniti bos geldi. API Base URL degerini ve api-service durumunu kontrol et.`;
  }

  const text = typeof body === "string" ? body.trim() : JSON.stringify(body);
  if (text.includes("auth store unavailable")) {
    return `${method} ${path} returned ${status}. Auth store hazir degil; api-service MongoDB baglantisi olmadan register/login yapamaz. /ready icindeki databaseStatus degerini kontrol et.`;
  }
  if (text.includes("auth token signing unavailable")) {
    return `${method} ${path} returned ${status}. JWT_SECRET api-service icin hazir degil. Kubernetes Secret veya local env ayarini kontrol et.`;
  }
  if (text.includes("document store unavailable")) {
    return `${method} ${path} returned ${status}. Document store hazir degil; MongoDB baglantisi gerekli.`;
  }

  return `${method} ${path} returned ${status}: ${text || "request failed"}`;
}

function App() {
  const [activeView, setActiveView] = useState("dashboard");
  const [apiBaseUrl, setApiBaseUrl] = useState(defaultBaseUrl);
  const [session, setSession] = useState(readStoredSession);
  const [health, setHealth] = useState(null);
  const [ready, setReady] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [exams, setExams] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [source, setSource] = useState("demo-ui");
  const [timeline, setTimeline] = useState(emptyTimeline);
  const [lastResponse, setLastResponse] = useState(null);
  const [lastDocumentId, setLastDocumentId] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const demoDocumentId = useMemo(() => {
    return `demo-${compactTimestamp(new Date())}`;
  }, [selectedFile]);

  function apiPath(path) {
    return `${apiBaseUrl.replace(/\/+$/, "")}${path}`;
  }

  function setStep(id, status) {
    setTimeline((items) => items.map((item) => (item.id === id ? { ...item, status } : item)));
  }

  function resetTimeline() {
    setTimeline(emptyTimeline);
  }

  async function request(path, options = {}) {
    const response = await fetch(apiPath(path), options);
    const parsed = await parseResponse(response);
    if (!parsed.ok) {
      throw new Error(responseMessage(options.method || "GET", path, parsed.status, parsed.body, apiBaseUrl));
    }
    return parsed.body;
  }

  async function refreshStatus() {
    setBusy("status");
    setError("");
    try {
      const [healthBody, readyBody] = await Promise.all([request("/health"), request("/ready")]);
      setHealth(healthBody);
      setReady(readyBody);
    } catch (err) {
      setHealth({ status: "error", service: "api-service", mode: "unreachable" });
      setReady({ status: "error", databaseStatus: "unknown" });
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function startDemoSession() {
    setBusy("session");
    setError("");
    setNotice("");
    const email = session?.email || `demo-${Date.now()}@examflow.local`;
    const displayName = "Demo User";

    try {
      if (!session?.email) {
        try {
          await request("/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, displayName, password: demoPassword }),
          });
        } catch (err) {
          if (!err.message.toLowerCase().includes("already exists")) {
            throw err;
          }
        }
      }

      const login = await request("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: demoPassword }),
      });
      const nextSession = { email, token: login.token, user: login.user };
      setSession(nextSession);
      window.localStorage.setItem(sessionKey, JSON.stringify(nextSession));
      setLastResponse({ action: "auth/login", body: login });
      await refreshArchive(nextSession.token);
      return nextSession;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy("");
    }
  }

  async function loadArchive(token = session?.token) {
    if (!token) {
      throw new Error("Archive kayitlari icin once demo session baslatilmali.");
    }

    const headers = { Authorization: `Bearer ${token}` };
    const [documentBody, examBody] = await Promise.all([
      request("/documents", { headers }),
      request("/exams", { headers }),
    ]);
    const nextDocuments = documentBody.documents || [];
    const nextExams = examBody.exams || [];
    setDocuments(nextDocuments);
    setExams(nextExams);
    return { documents: nextDocuments, exams: nextExams };
  }

  async function refreshArchive(token = session?.token) {
    if (!token) {
      setError("Archive kayitlari icin once demo session baslatilmali.");
      return null;
    }

    setBusy("archive");
    setError("");
    try {
      return await loadArchive(token);
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy("");
    }
  }

  async function waitForExamRecord(token, documentId) {
    setStep("processing", "running");
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await delay(attempt === 0 ? 900 : 1500);
      const archive = await loadArchive(token);
      const exam = archive.exams.find((record) => record.documentId === documentId);
      if (!exam) continue;

      if (exam.status === "failed" || exam.validationResult === "invalid") {
        setStep("processing", "ok");
        setStep("failed", "failed");
      } else {
        setStep("processing", "ok");
        setStep("validated", "ok");
      }
      return exam;
    }

    setNotice("Exam kaydi henuz gelmedi. Event akisi arka planda devam ediyor olabilir.");
    return null;
  }

  async function submitDocument(event) {
    event.preventDefault();
    let activeSession = session;
    if (!activeSession?.token) {
      activeSession = await startDemoSession();
    }
    if (!activeSession?.token) return;

    const documentId = `demo-${compactTimestamp(new Date())}`;
    const payload = {
      documentId,
      fileName: selectedFile?.name || "demo-document.pdf",
      source: source.trim() || "demo-ui",
    };

    resetTimeline();
    setLastDocumentId(documentId);
    setBusy("publish");
    setError("");
    setNotice("");
    setStep("received", "running");

    try {
      const body = await request("/publish", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeSession.token}`,
        },
        body: JSON.stringify(payload),
      });
      setLastResponse({ action: "publish", request: payload, body });
      setStep("received", "ok");
      setStep("published", "ok");
      await waitForExamRecord(activeSession.token, documentId);
      setActiveView("dashboard");
    } catch (err) {
      setStep("failed", "failed");
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  function resetSession() {
    window.localStorage.removeItem(sessionKey);
    setSession(null);
    setDocuments([]);
    setExams([]);
    setLastResponse(null);
    setLastDocumentId("");
    setNotice("");
    setError("");
    resetTimeline();
    setActiveView("dashboard");
  }

  useEffect(() => {
    refreshStatus();
  }, []);

  return (
    <main className="min-h-screen bg-page text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-base font-black text-white">
                EF
              </div>
              <div className="min-w-0">
                <p className="label">ExamFlow Demo</p>
                <h1 className="truncate text-xl font-bold sm:text-2xl">Processing Console</h1>
              </div>
              <Badge tone={ready?.status || "idle"}>{ready?.mode || "api"}</Badge>
            </div>

            <div className="grid gap-2 sm:grid-cols-[minmax(240px,360px)_auto] sm:items-end">
              <label>
                <span className="label">API Base URL</span>
                <input className="field mt-1" value={apiBaseUrl} onChange={(event) => setApiBaseUrl(event.target.value)} />
              </label>
              <button className="btn btn-secondary" type="button" onClick={refreshStatus} disabled={busy === "status"}>
                {busy === "status" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <nav className="flex flex-wrap gap-2" aria-label="Demo navigation">
              {views.map((view) => {
                const Icon = view.icon;
                const active = activeView === view.id;
                return (
                  <button
                    key={view.id}
                    className={`btn ${active ? "btn-primary" : "btn-secondary"}`}
                    type="button"
                    onClick={() => setActiveView(view.id)}
                  >
                    <Icon className="h-4 w-4" />
                    {view.label}
                  </button>
                );
              })}
            </nav>
            <div className="flex flex-wrap gap-2">
              <StatusPill icon={KeyRound} label="JWT" value={session?.token ? "active" : "idle"} tone={session?.token ? "ok" : "idle"} />
              <StatusPill icon={Database} label="DB" value={ready?.databaseStatus || "unknown"} tone={ready?.databaseStatus === "ready" ? "ok" : ready?.status} />
              <StatusPill icon={Server} label="API" value={health?.status || "pending"} tone={health?.status} />
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
        {error ? <Alert tone="failed" message={error} /> : null}
        {notice ? <Alert tone="running" message={notice} /> : null}

        {activeView === "dashboard" ? (
          <Dashboard
            busy={busy}
            demoDocumentId={demoDocumentId}
            documents={documents}
            exams={exams}
            health={health}
            lastDocumentId={lastDocumentId}
            lastResponse={lastResponse}
            onReset={resetSession}
            onStart={startDemoSession}
            onSubmit={submitDocument}
            ready={ready}
            selectedFile={selectedFile}
            session={session}
            setSelectedFile={setSelectedFile}
            setSource={setSource}
            source={source}
            timeline={timeline}
          />
        ) : null}

        {activeView === "documents" ? (
          <ArchiveView
            busy={busy}
            empty="Document kaydi bulunamadi."
            icon={FileText}
            onRefresh={() => refreshArchive()}
            onStart={startDemoSession}
            records={documents}
            session={session}
            title="Documents"
          />
        ) : null}

        {activeView === "exams" ? (
          <ArchiveView
            busy={busy}
            empty="Exam kaydi bulunamadi."
            icon={ClipboardList}
            onRefresh={() => refreshArchive()}
            onStart={startDemoSession}
            records={exams}
            session={session}
            title="Exams"
          />
        ) : null}
      </div>
    </main>
  );
}

function Dashboard({
  busy,
  demoDocumentId,
  documents,
  exams,
  health,
  lastDocumentId,
  lastResponse,
  onReset,
  onStart,
  onSubmit,
  ready,
  selectedFile,
  session,
  setSelectedFile,
  setSource,
  source,
  timeline,
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)_360px]">
      <section className="panel p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="label">Demo Session</p>
            <h2 className="section-title">Publish Request</h2>
          </div>
          <Badge tone={session?.token ? "ok" : "idle"}>{session?.token ? "token ready" : "no token"}</Badge>
        </div>

        <form className="mt-5 space-y-4" onSubmit={onSubmit}>
          <label className="block rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-center transition hover:border-cyan-500 hover:bg-cyan-50/50">
            <FileUp className="mx-auto h-10 w-10 text-cyan-700" />
            <span className="mt-3 block truncate text-sm font-semibold">{selectedFile?.name || "demo-document.pdf"}</span>
            <span className="mt-1 block text-xs text-slate-500">documentId: {demoDocumentId}</span>
            <input
              className="sr-only"
              type="file"
              accept=".pdf,.doc,.docx,.txt"
              onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
            />
          </label>

          <label className="block">
            <span className="label">Source</span>
            <input className="field mt-1" value={source} onChange={(event) => setSource(event.target.value)} />
          </label>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <button className="btn btn-secondary" type="button" onClick={onStart} disabled={busy === "session"}>
              {busy === "session" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Baslat
            </button>
            <button className="btn btn-secondary" type="button" onClick={onReset}>
              <RotateCcw className="h-4 w-4" />
              Sifirla
            </button>
          </div>

          <button className="btn btn-primary w-full" type="submit" disabled={busy === "publish"}>
            {busy === "publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
            Publish
          </button>
        </form>
      </section>

      <section className="panel p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="label">End-to-end state</p>
            <h2 className="section-title">Processing Timeline</h2>
          </div>
          <Badge tone={busy ? "running" : "idle"}>{busy || "ready"}</Badge>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-5">
          {timeline.map((item) => (
            <TimelineStep key={item.id} item={item} />
          ))}
        </div>

        <div className="mt-6 grid gap-3 lg:grid-cols-3">
          <PipelineNode icon={Server} title="API Service" value="/publish" tone={timeline[0].status} />
          <PipelineNode icon={Cloud} title="Pub/Sub" value="document-events" tone={timeline[1].status} />
          <PipelineNode icon={Activity} title="Worker" value="processing" tone={timeline[2].status} />
          <PipelineNode icon={ShieldCheck} title="Validation" value="validation result" tone={timeline[3].status} />
          <PipelineNode icon={ClipboardList} title="Exam Service" value="exam lifecycle" tone={timeline[3].status} />
          <PipelineNode icon={Database} title="MongoDB" value="documents / exams" tone={documents.length || exams.length ? "ok" : "idle"} />
        </div>

        <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <Info label="Last document" value={lastDocumentId || "-"} />
            <Info label="Documents" value={documents.length} />
            <Info label="Exams" value={exams.length} />
          </dl>
        </div>
      </section>

      <section className="space-y-5">
        <section className="panel p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="label">Runtime</p>
              <h2 className="section-title">Service Health</h2>
            </div>
            <Activity className="h-5 w-5 text-cyan-700" />
          </div>
          <div className="mt-4 space-y-3">
            <HealthRow label="/health" value={health?.status || "pending"} tone={health?.status} />
            <HealthRow label="/ready" value={ready?.status || "pending"} tone={ready?.status} />
            <HealthRow label="database" value={ready?.databaseStatus || "unknown"} tone={ready?.databaseStatus === "ready" ? "ok" : ready?.status} />
            <HealthRow label="mode" value={health?.mode || "unknown"} tone={health?.status} />
          </div>
        </section>

        <LastResponse lastResponse={lastResponse} />
      </section>
    </div>
  );
}

function ArchiveView({ busy, empty, icon: Icon, onRefresh, onStart, records, session, title }) {
  if (!session?.token) {
    return (
      <section className="panel p-6">
        <div className="flex items-center gap-3">
          <Icon className="h-6 w-6 text-cyan-700" />
          <div>
            <p className="label">Protected archive</p>
            <h2 className="section-title">{title}</h2>
          </div>
        </div>
        <button className="btn btn-primary mt-5" type="button" onClick={onStart} disabled={busy === "session"}>
          {busy === "session" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Baslat
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="panel p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Icon className="h-6 w-6 text-cyan-700" />
            <div>
              <p className="label">Archive</p>
              <h2 className="section-title">{title}</h2>
            </div>
          </div>
          <button className="btn btn-secondary" type="button" onClick={onRefresh} disabled={busy === "archive"}>
            {busy === "archive" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
        </div>
      </div>
      <ArchiveList records={records} empty={empty} />
    </section>
  );
}

function Badge({ children, tone = "idle" }) {
  return <span className={`inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-semibold ${toneClass(tone)}`}>{children}</span>;
}

function StatusPill({ icon: Icon, label, value, tone }) {
  return (
    <div className={`flex h-9 items-center gap-2 rounded-md border px-3 ${toneClass(tone)}`}>
      <Icon className="h-4 w-4" />
      <span className="text-xs font-semibold">{label}</span>
      <span className="text-xs">{value}</span>
    </div>
  );
}

function Alert({ message, tone }) {
  const Icon = tone === "failed" ? AlertCircle : Activity;
  return (
    <div className={`mb-4 flex items-start gap-3 rounded-lg border p-4 text-sm font-medium ${toneClass(tone)}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function TimelineStep({ item }) {
  const done = item.status === "ok";
  const failed = item.status === "failed";
  const running = item.status === "running";
  const Icon = done ? CheckCircle2 : failed ? XCircle : running ? Loader2 : Activity;
  return (
    <article className={`rounded-lg border p-4 ${toneClass(item.status)}`}>
      <Icon className={`h-5 w-5 ${running ? "animate-spin" : ""}`} />
      <h3 className="mt-3 text-sm font-bold capitalize">{item.label}</h3>
      <p className="mt-1 truncate text-xs opacity-80">{item.detail}</p>
    </article>
  );
}

function PipelineNode({ icon: Icon, title, value, tone }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-md border ${toneClass(tone)}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{title}</p>
          <p className="truncate text-xs text-slate-500">{value}</p>
        </div>
      </div>
    </div>
  );
}

function HealthRow({ label, value, tone }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3 last:border-0 last:pb-0">
      <span className="text-sm font-medium text-slate-600">{label}</span>
      <Badge tone={tone}>{value}</Badge>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="mt-1 truncate font-semibold">{value}</dd>
    </div>
  );
}

function LastResponse({ lastResponse }) {
  return (
    <section className="panel p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label">API</p>
          <h2 className="section-title">Last Response</h2>
        </div>
        <Badge tone={lastResponse ? "ok" : "idle"}>{lastResponse ? lastResponse.action : "waiting"}</Badge>
      </div>
      <pre className="mt-4 max-h-64 overflow-auto rounded-lg border border-slate-200 bg-slate-950 p-4 text-xs leading-5 text-slate-100">
        {lastResponse ? JSON.stringify(lastResponse, null, 2) : "No response yet."}
      </pre>
    </section>
  );
}

function ArchiveList({ records, empty }) {
  if (!records.length) {
    return <p className="panel p-5 text-sm text-slate-500">{empty}</p>;
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {records.map((record) => (
        <article key={record.id || `${record.documentId}-${record.createdAt}`} className="panel p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold">{record.title || record.fileName || record.documentId}</h3>
              <p className="mt-1 truncate text-xs text-slate-500">{record.documentId}</p>
            </div>
            <Badge tone={record.status}>{record.status || "unknown"}</Badge>
          </div>
          <dl className="mt-4 space-y-2 text-xs">
            <ArchiveRow label="Result" value={record.validationResult || record.source || "-"} />
            <ArchiveRow label="Created" value={parseRecordDate(record.createdAt)} />
            <ArchiveRow label="Updated" value={parseRecordDate(record.updatedAt)} />
          </dl>
        </article>
      ))}
    </div>
  );
}

function ArchiveRow({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="truncate text-right font-medium">{value}</dd>
    </div>
  );
}

export default App;
