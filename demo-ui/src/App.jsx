import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Cloud,
  Cpu,
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
  User,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";

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

function DemoDashboard() {
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
    <main className="min-h-screen overflow-hidden">
      <header className="border-b border-space-line bg-black/30 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-neon-cyan/40 bg-gradient-to-br from-cyber-purple/80 to-neon-cyan/60 text-xl font-black text-white shadow-neon-cyan">
                E
              </div>
              <div className="min-w-0">
                <p className="label">ExamFlow</p>
                <h1 className="truncate text-2xl font-black text-ink sm:text-3xl">Live Analysis Dashboard</h1>
              </div>
              <Badge tone={health?.status || "idle"}>{health?.mode ? `GKE ${health.mode}` : "GKE Live"}</Badge>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(240px,340px)_auto] sm:items-end">
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

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <nav className="flex flex-wrap gap-2" aria-label="Demo dashboard navigation">
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
              <StatusPill icon={ShieldCheck} label="JWT" value={session?.token ? "Authenticated" : "Idle"} tone={session?.token ? "ok" : "idle"} />
              <StatusPill icon={Database} label="MongoDB" value={ready?.databaseStatus || "Unknown"} tone={ready?.databaseStatus === "ready" ? "ok" : ready?.status} />
              <StatusPill icon={Activity} label="/health" value={health?.status || "Pending"} tone={health?.status} />
              <StatusPill icon={Server} label="/ready" value={ready?.status || "Pending"} tone={ready?.status} />
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
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
    <div className="grid gap-5 xl:grid-cols-[minmax(260px,0.8fr)_minmax(420px,1.3fr)_minmax(300px,0.9fr)]">
      <section className="panel glass-grid p-5">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="label">Input</p>
            <h2 className="mt-1 text-xl font-bold text-ink">Lecture Note</h2>
          </div>
          <Badge tone={session?.token ? "ok" : "idle"}>{session?.token ? "Token Ready" : "No Token"}</Badge>
        </div>

        <form onSubmit={onSubmit}>
          <label className="block rounded-lg border border-dashed border-cyber-purple/50 bg-black/25 p-5 text-center transition hover:border-neon-cyan/70">
            <FileUp className="mx-auto h-12 w-12 text-cyber-purple" />
            <span className="mt-4 block truncate text-sm font-semibold text-ink">{selectedFile?.name || "demo-document.pdf"}</span>
            <span className="mt-1 block text-xs text-muted">documentId: {demoDocumentId}</span>
            <input
              className="sr-only"
              type="file"
              accept=".pdf,.doc,.docx,.txt"
              onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
            />
          </label>

          <label className="mt-4 block">
            <span className="label">Source</span>
            <input className="field mt-1" value={source} onChange={(event) => setSource(event.target.value)} />
          </label>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <button className="btn btn-primary" type="button" onClick={onStart} disabled={busy === "session"}>
              {busy === "session" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Demo Baslat
            </button>
            <button className="btn btn-secondary" type="button" onClick={onReset}>
              <RotateCcw className="h-4 w-4" />
              Sifirla
            </button>
          </div>

          <button className="btn btn-primary mt-3 w-full" type="submit" disabled={busy === "publish"}>
            {busy === "publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
            Publish Event
          </button>
        </form>
      </section>

      <WorkflowPanel busy={busy} documents={documents} exams={exams} lastDocumentId={lastDocumentId} timeline={timeline} />

      <section className="space-y-5">
        <section className="panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="label">Generated Content</p>
              <h2 className="mt-1 text-xl font-bold text-ink">MongoDB Storage</h2>
            </div>
            <Database className="h-5 w-5 text-neon-magenta" />
          </div>

          <div className="grid gap-3">
            <StorageCard title="Documents" subtitle="collection: documents" count={documents.length} tone="cyan" />
            <StorageCard title="Exams" subtitle="collection: exams" count={exams.length} tone="green" />
          </div>
        </section>

        <section className="panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-ink">Infrastructure Metrics</h2>
            <Cpu className="h-5 w-5 text-neon-green" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Metric label="/health" value={health?.status || "pending"} tone={health?.status} />
            <Metric label="/ready" value={ready?.status || "pending"} tone={ready?.status} />
            <Metric label="database" value={ready?.databaseStatus || "unknown"} tone={ready?.databaseStatus === "ready" ? "ok" : ready?.status} />
            <Metric label="mode" value={health?.mode || "unknown"} tone={health?.status} />
          </div>
        </section>

        <LastResponse lastResponse={lastResponse} />
      </section>
    </div>
  );
}

function WorkflowPanel({ busy, documents, exams, lastDocumentId, timeline }) {
  const stateById = Object.fromEntries(timeline.map((item) => [item.id, item.status]));
  const publishState = stateById.published === "ok" ? "ok" : stateById.received;
  const validationState = stateById.failed === "failed" ? "failed" : stateById.validated;

  const nodes = [
    { label: "API Service", icon: Server, state: stateById.received, detail: "protected /publish" },
    { label: "Pub/Sub", icon: Cloud, state: stateById.published, detail: "document-events" },
    { label: "Worker", icon: Cpu, state: stateById.processing, detail: "processing" },
    { label: "Validation", icon: ShieldCheck, state: validationState, detail: "validation result" },
    { label: "Exam Service", icon: ClipboardList, state: validationState, detail: "exam lifecycle" },
    { label: "MongoDB", icon: Database, state: documents.length || exams.length ? "ok" : "waiting", detail: "documents / exams" },
  ];

  return (
    <section className="panel relative min-h-[560px] overflow-hidden p-5">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-cyber-purple via-neon-cyan to-neon-magenta" />
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="label">Event-Driven Workflow</p>
          <h2 className="mt-1 text-xl font-bold text-ink">Note Processed</h2>
        </div>
        <Badge tone={busy ? "running" : publishState === "ok" ? "ok" : "idle"}>{busy ? "Running" : "Ready"}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr]">
        <div className="space-y-4">
          {nodes.slice(0, 3).map((node) => (
            <WorkflowNode key={node.label} node={node} />
          ))}
        </div>

        <div className="flex items-center justify-center py-4">
          <div className="flex h-36 w-36 flex-col items-center justify-center rounded-full border border-neon-cyan/50 bg-black/40 text-center shadow-neon-cyan">
            <KeyRound className="h-7 w-7 text-neon-cyan" />
            <p className="mt-2 text-sm font-bold text-ink">System Core</p>
            <p className="text-xs text-muted">{lastDocumentId ? lastDocumentId : "waiting"}</p>
          </div>
        </div>

        <div className="space-y-4">
          {nodes.slice(3).map((node) => (
            <WorkflowNode key={node.label} node={node} />
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-5">
        {timeline.map((item) => (
          <TimelineStep key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

function WorkflowNode({ node }) {
  const Icon = node.icon;
  const active = node.state === "running" || node.state === "ok";
  return (
    <article
      className={`rounded-lg border p-4 transition ${
        active ? "border-neon-cyan/60 bg-neon-cyan/10 shadow-neon-cyan" : "border-space-line bg-black/25"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-md border ${active ? "border-neon-cyan/60 text-neon-cyan" : "border-space-line text-muted"}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-ink">{node.label}</p>
          <p className="truncate text-xs text-muted">{node.detail}</p>
        </div>
      </div>
    </article>
  );
}

function StorageCard({ count, subtitle, title, tone }) {
  const color = tone === "green" ? "text-neon-green border-neon-green/40 bg-neon-green/10" : "text-neon-cyan border-neon-cyan/40 bg-neon-cyan/10";
  return (
    <article className={`rounded-lg border p-4 ${count ? color : "border-space-line bg-black/20 text-muted"}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold">{title}</p>
          <p className="mt-1 text-xs text-muted">{subtitle}</p>
        </div>
        <span className="text-2xl font-black">{count}</span>
      </div>
    </article>
  );
}

function Metric({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-space-line bg-black/25 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-normal text-muted">{label}</p>
      <p className={`mt-2 truncate text-sm font-bold ${toneClass(tone).includes("green") ? "text-neon-green" : toneClass(tone).includes("amber") ? "text-neon-amber" : "text-ink"}`}>
        {value}
      </p>
    </div>
  );
}

function ArchiveView({ busy, empty, icon: Icon, onRefresh, onStart, records, session, title }) {
  if (!session?.token) {
    return (
      <section className="panel glass-grid p-6">
        <div className="flex items-center gap-3">
          <Icon className="h-6 w-6 text-neon-cyan" />
          <div>
            <p className="label">Protected archive</p>
            <h2 className="mt-1 text-xl font-semibold text-ink">{title}</h2>
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
      <div className="panel glass-grid p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Icon className="h-6 w-6 text-neon-cyan" />
            <div>
              <p className="label">Archive</p>
              <h2 className="mt-1 text-xl font-semibold text-ink">{title}</h2>
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
  return <span className={`inline-flex h-7 items-center rounded-full border px-3 text-xs font-semibold ${toneClass(tone)}`}>{children}</span>;
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
    <div className={`mb-4 flex items-start gap-3 rounded-lg border p-4 text-sm font-medium backdrop-blur ${toneClass(tone)}`}>
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
    <article className={`rounded-lg border bg-black/25 p-4 ${toneClass(item.status)}`}>
      <Icon className={`h-5 w-5 ${running ? "animate-spin" : ""}`} />
      <h3 className="mt-3 text-sm font-bold capitalize">{item.label}</h3>
      <p className="mt-1 truncate text-xs opacity-80">{item.detail}</p>
    </article>
  );
}

function PipelineNode({ icon: Icon, title, value, tone }) {
  return (
    <div className="rounded-lg border border-space-line bg-black/25 p-4">
      <div className="flex items-center gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-md border ${toneClass(tone)}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-ink">{title}</p>
          <p className="truncate text-xs text-muted">{value}</p>
        </div>
      </div>
    </div>
  );
}

function HealthRow({ label, value, tone }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-space-line pb-3 last:border-0 last:pb-0">
      <span className="text-sm font-medium text-muted">{label}</span>
      <Badge tone={tone}>{value}</Badge>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="mt-1 truncate font-semibold text-ink">{value}</dd>
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
      <pre className="mt-4 max-h-64 overflow-auto rounded-md border border-space-line bg-black/55 p-4 text-xs leading-5 text-slate-100">
        {lastResponse ? JSON.stringify(lastResponse, null, 2) : "No response yet."}
      </pre>
    </section>
  );
}

function ArchiveList({ records, empty }) {
  if (!records.length) {
    return <p className="panel p-5 text-sm text-muted">{empty}</p>;
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {records.map((record) => (
        <article key={record.id || `${record.documentId}-${record.createdAt}`} className="panel p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold text-ink">{record.title || record.fileName || record.documentId}</h3>
              <p className="mt-1 truncate text-xs text-muted">{record.documentId}</p>
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
      <dt className="text-muted">{label}</dt>
      <dd className="truncate text-right font-medium text-ink">{value}</dd>
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/demo/" replace />} />
      <Route path="/demo/*" element={<DemoDashboard />} />
      <Route path="/app/*" element={<ProductApp />} />
      <Route path="*" element={<Navigate to="/demo/" replace />} />
    </Routes>
  );
}

const appNav = [
  { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/app/documents", label: "Documents", icon: FileText },
  { to: "/app/exams", label: "Exams", icon: ClipboardList },
  { to: "/app/activity", label: "Activity", icon: Activity },
];

function ProductApp() {
  const [apiBaseUrl, setApiBaseUrl] = useState(defaultBaseUrl);
  const [session, setSession] = useState(readStoredSession);
  const [health, setHealth] = useState(null);
  const [ready, setReady] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [exams, setExams] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  function apiPath(path) {
    return `${apiBaseUrl.replace(/\/+$/, "")}${path}`;
  }

  async function appRequest(path, options = {}) {
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
      const [healthBody, readyBody] = await Promise.all([appRequest("/health"), appRequest("/ready")]);
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

  async function loadArchive(token = session?.token) {
    if (!token) return;
    setBusy("archive");
    setError("");
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [documentBody, examBody] = await Promise.all([
        appRequest("/documents", { headers }),
        appRequest("/exams", { headers }),
      ]);
      setDocuments(documentBody.documents || []);
      setExams(examBody.exams || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function handleAuth(values) {
    setBusy("auth");
    setError("");
    try {
      if (values.mode === "register") {
        await appRequest("/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: values.email,
            displayName: values.displayName || "ExamFlow User",
            password: values.password,
          }),
        });
      }

      const login = await appRequest("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: values.email, password: values.password }),
      });
      const nextSession = { email: values.email, token: login.token, user: login.user };
      setSession(nextSession);
      window.localStorage.setItem(sessionKey, JSON.stringify(nextSession));
      await loadArchive(nextSession.token);
      navigate("/app/dashboard", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  function logout() {
    window.localStorage.removeItem(sessionKey);
    setSession(null);
    setDocuments([]);
    setExams([]);
    navigate("/app", { replace: true });
  }

  useEffect(() => {
    refreshStatus();
  }, []);

  useEffect(() => {
    if (session?.token) {
      loadArchive(session.token);
    }
  }, [session?.token]);

  if (!session?.token) {
    return (
      <main className="app-auth-shell">
        <AuthPanel apiBaseUrl={apiBaseUrl} busy={busy} error={error} onApiBaseUrl={setApiBaseUrl} onSubmit={handleAuth} />
        <AuthAside health={health} ready={ready} onRefresh={refreshStatus} busy={busy} />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="app-sidebar">
        <div className="flex items-center gap-3">
          <div className="brand-mark">E</div>
          <div className="min-w-0">
            <p className="label">ExamFlow</p>
            <h1 className="truncate text-lg font-black text-ink">Workspace</h1>
          </div>
        </div>

        <nav className="mt-8 grid gap-2" aria-label="Application navigation">
          {appNav.map((item) => (
            <AppNavItem key={item.to} item={item} />
          ))}
        </nav>

        <div className="mt-auto rounded-lg border border-space-line bg-black/25 p-4">
          <p className="label">Signed in</p>
          <p className="mt-1 truncate text-sm font-bold text-ink">{session.user?.displayName || session.email}</p>
          <button className="btn btn-secondary mt-4 w-full" type="button" onClick={logout}>
            <User className="h-4 w-4" />
            Cikis
          </button>
        </div>
      </aside>

      <section className="app-main">
        <header className="app-topbar">
          <div>
            <p className="label">Authenticated frontend</p>
            <h2 className="text-2xl font-black text-ink">Product Shell</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(220px,320px)_auto] sm:items-end">
            <label>
              <span className="label">API Base URL</span>
              <input className="field mt-1" value={apiBaseUrl} onChange={(event) => setApiBaseUrl(event.target.value)} />
            </label>
            <button className="btn btn-secondary" type="button" onClick={() => loadArchive()} disabled={busy === "archive"}>
              {busy === "archive" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Sync
            </button>
          </div>
        </header>

        {error ? <Alert tone="failed" message={error} /> : null}

        <Routes>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route
            path="dashboard"
            element={<AppOverview documents={documents} exams={exams} health={health} ready={ready} />}
          />
          <Route path="documents" element={<WorkspaceRecords title="Document Archive" records={documents} empty="Henuz document kaydi yok." />} />
          <Route path="exams" element={<WorkspaceRecords title="Exam Archive" records={exams} empty="Henuz exam kaydi yok." />} />
          <Route path="activity" element={<ActivityWorkspace documents={documents} exams={exams} />} />
          <Route path="*" element={<Navigate to="dashboard" replace />} />
        </Routes>
      </section>
    </main>
  );
}

function AuthPanel({ apiBaseUrl, busy, error, onApiBaseUrl, onSubmit }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("demo@examflow.local");
  const [displayName, setDisplayName] = useState("Demo User");
  const [password, setPassword] = useState(demoPassword);

  function submit(event) {
    event.preventDefault();
    onSubmit({ mode, email, displayName, password });
  }

  return (
    <section className="auth-card">
      <div className="brand-mark">E</div>
      <p className="label mt-6">ExamFlow App</p>
      <h1 className="mt-2 text-3xl font-black text-ink">Akilli sinav arsivi icin giris yap.</h1>
      <p className="mt-3 text-sm leading-6 text-muted">
        Demo arayuzu sunum akisini gosterir; bu alan authenticated urun deneyiminin baslangic kabugudur.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-2 rounded-lg border border-space-line bg-black/20 p-1">
        <button className={`segmented-btn ${mode === "login" ? "active" : ""}`} type="button" onClick={() => setMode("login")}>
          Giris
        </button>
        <button className={`segmented-btn ${mode === "register" ? "active" : ""}`} type="button" onClick={() => setMode("register")}>
          Kayit
        </button>
      </div>

      <form className="mt-6 grid gap-4" onSubmit={submit}>
        <label>
          <span className="label">Email</span>
          <input className="field mt-1" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        {mode === "register" ? (
          <label>
            <span className="label">Display name</span>
            <input className="field mt-1" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
        ) : null}
        <label>
          <span className="label">Password</span>
          <input className="field mt-1" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        <label>
          <span className="label">API Base URL</span>
          <input className="field mt-1" value={apiBaseUrl} onChange={(event) => onApiBaseUrl(event.target.value)} />
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy === "auth"}>
          {busy === "auth" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          {mode === "login" ? "Workspace'e gir" : "Kayit ol ve gir"}
        </button>
      </form>

      {error ? <p className="mt-4 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p> : null}
    </section>
  );
}

function AuthAside({ busy, health, onRefresh, ready }) {
  return (
    <section className="auth-aside panel glass-grid p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="label">Live system</p>
          <h2 className="section-title">Backend baglantisi</h2>
        </div>
        <button className="btn btn-secondary" type="button" onClick={onRefresh} disabled={busy === "status"}>
          {busy === "status" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </button>
      </div>
      <div className="mt-6 grid gap-3">
        <HealthRow label="/health" value={health?.status || "pending"} tone={health?.status} />
        <HealthRow label="/ready" value={ready?.status || "pending"} tone={ready?.status} />
        <HealthRow label="database" value={ready?.databaseStatus || "unknown"} tone={ready?.databaseStatus === "ready" ? "ok" : ready?.status} />
      </div>
      <div className="mt-8 rounded-lg border border-neon-cyan/30 bg-neon-cyan/10 p-4">
        <p className="text-sm font-bold text-ink">Sonraki ekranlar</p>
        <p className="mt-2 text-sm leading-6 text-muted">
          Document detail, exam detail, favorites ve tag isleri bu shell uzerine route bazli eklenecek.
        </p>
      </div>
    </section>
  );
}

function AppNavItem({ item }) {
  const Icon = item.icon;
  return (
    <NavLink className={({ isActive }) => `app-nav-item ${isActive ? "active" : ""}`} to={item.to}>
      <Icon className="h-4 w-4" />
      {item.label}
    </NavLink>
  );
}

function AppOverview({ documents, exams, health, ready }) {
  return (
    <div className="grid gap-5">
      <section className="app-hero">
        <div>
          <p className="label">Today</p>
          <h3 className="mt-2 text-3xl font-black text-ink">Arsiv, sinavlar ve islem gecmisi tek calisma alaninda.</h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
            Bu shell, mevcut API ile login olan kullanicinin kayitlarini okuyarak urun arayuzunun temelini kurar.
          </p>
        </div>
        <Badge tone={ready?.databaseStatus === "ready" ? "ok" : ready?.status}>MongoDB {ready?.databaseStatus || "unknown"}</Badge>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <InsightCard icon={FileText} title="Documents" value={documents.length} tone="ok" />
        <InsightCard icon={ClipboardList} title="Exams" value={exams.length} tone="ready" />
        <InsightCard icon={Activity} title="API" value={health?.status || "pending"} tone={health?.status} />
        <InsightCard icon={Database} title="Database" value={ready?.databaseStatus || "unknown"} tone={ready?.databaseStatus === "ready" ? "ok" : ready?.status} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <WorkspaceRecords title="Recent Documents" records={documents.slice(0, 4)} empty="Henuz document kaydi yok." />
        <WorkspaceRecords title="Recent Exams" records={exams.slice(0, 4)} empty="Henuz exam kaydi yok." />
      </div>
    </div>
  );
}

function InsightCard({ icon: Icon, title, value, tone }) {
  return (
    <article className="panel p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="label">{title}</p>
          <p className="mt-3 text-2xl font-black text-ink">{value}</p>
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-lg border ${toneClass(tone)}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </article>
  );
}

function WorkspaceRecords({ empty, records, title }) {
  return (
    <section className="panel p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="label">Archive</p>
          <h3 className="section-title">{title}</h3>
        </div>
        <Badge tone={records.length ? "ok" : "idle"}>{records.length} records</Badge>
      </div>
      <ArchiveList records={records} empty={empty} />
    </section>
  );
}

function ActivityWorkspace({ documents, exams }) {
  const events = [...documents, ...exams].sort((left, right) => {
    return new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0);
  });

  return (
    <section className="panel p-5">
      <div className="mb-5">
        <p className="label">Activity</p>
        <h3 className="section-title">Islem gecmisi</h3>
      </div>
      {events.length ? (
        <div className="grid gap-3">
          {events.map((event) => (
            <article key={event.id || `${event.documentId}-${event.updatedAt}`} className="rounded-lg border border-space-line bg-black/25 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-bold text-ink">{event.title || event.fileName || event.documentId}</p>
                  <p className="mt-1 text-xs text-muted">{parseRecordDate(event.updatedAt || event.createdAt)}</p>
                </div>
                <Badge tone={event.status}>{event.status || "recorded"}</Badge>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">Henuz islem gecmisi yok.</p>
      )}
    </section>
  );
}

export default App;
