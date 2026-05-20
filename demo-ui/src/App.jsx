import {
  Activity,
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
  XCircle,
} from "lucide-react";
import React from "react";
import { useEffect, useMemo, useState } from "react";

const defaultBaseUrl = "/api";
const demoPassword = "ExamFlowDemo2026";
const sessionKey = "examflow-demo-session";

const initialFlow = [
  { id: "session", label: "JWT Session", status: "waiting" },
  { id: "publish", label: "Document Event", status: "waiting" },
  { id: "documents", label: "Documents", status: "waiting" },
  { id: "exams", label: "Exams", status: "waiting" },
];

const views = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "exams", label: "Exams", icon: ClipboardList },
];

function readStoredSession() {
  const raw = window.localStorage.getItem(sessionKey);
  if (!raw) {
    return null;
  }

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

function statusTone(status) {
  if (status === "ok" || status === "ready" || status === "authenticated") {
    return "border-neon-green/40 bg-neon-green/10 text-neon-green";
  }
  if (status === "degraded" || status === "pending" || status === "running") {
    return "border-neon-amber/40 bg-neon-amber/10 text-neon-amber";
  }
  if (status === "error" || status === "failed") {
    return "border-danger/50 bg-danger/10 text-danger";
  }
  return "border-space-line bg-white/5 text-muted";
}

function Badge({ children, tone = "idle" }) {
  return (
    <span className={`inline-flex h-7 items-center rounded-full border px-3 text-xs font-semibold ${statusTone(tone)}`}>
      {children}
    </span>
  );
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
  const [flow, setFlow] = useState(initialFlow);
  const [lastResponse, setLastResponse] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const documentId = useMemo(() => {
    return `demo-${compactTimestamp(new Date())}`;
  }, [selectedFile]);

  function apiPath(path) {
    return `${apiBaseUrl.replace(/\/+$/, "")}${path}`;
  }

  function updateFlow(id, status) {
    setFlow((items) => items.map((item) => (item.id === id ? { ...item, status } : item)));
  }

  async function request(path, options = {}) {
    const response = await fetch(apiPath(path), options);
    const parsed = await parseResponse(response);
    if (!parsed.ok) {
      const message = typeof parsed.body === "string" ? parsed.body : JSON.stringify(parsed.body);
      throw new Error(`${options.method || "GET"} ${path} returned ${parsed.status}: ${message || "request failed"}`);
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
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function startDemoSession() {
    setBusy("session");
    setError("");
    updateFlow("session", "running");
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
      updateFlow("session", "ok");
      setLastResponse({ action: "demo-session", body: login });
      await refreshArchive(nextSession.token);
      return nextSession;
    } catch (err) {
      updateFlow("session", "failed");
      setError(err.message);
      return null;
    } finally {
      setBusy("");
    }
  }

  async function refreshArchive(token = session?.token) {
    if (!token) {
      setError("Archive kayitlarini okumak icin once Demo Baslat ile JWT session olusturun.");
      return;
    }
    setBusy("archive");
    setError("");
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [documentBody, examBody] = await Promise.all([
        request("/documents", { headers }),
        request("/exams", { headers }),
      ]);
      setDocuments(documentBody.documents || []);
      setExams(examBody.exams || []);
      updateFlow("documents", "ok");
      updateFlow("exams", "ok");
    } catch (err) {
      if (err.message.includes("returned 404")) {
        setError("Archive endpointleri bu GKE deploy'unda henuz yok. SCRUM-40 kodu develop'ta, ancak canli api-service image'i /documents veya /exams endpointlerini icermiyor.");
      } else {
        setError(err.message);
      }
    } finally {
      setBusy("");
    }
  }

  async function submitDocument(event) {
    event.preventDefault();
    let activeSession = session;
    if (!activeSession?.token) {
      activeSession = await startDemoSession();
    }
    if (!activeSession?.token) {
      return;
    }

    const fileName = selectedFile?.name || "demo-document.pdf";
    const payload = { documentId, fileName, source };
    setBusy("publish");
    setError("");
    updateFlow("publish", "running");

    try {
      const body = await request("/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${activeSession.token}` },
        body: JSON.stringify(payload),
      });
      setLastResponse({ action: "publish", request: payload, body });
      updateFlow("publish", "ok");
      await refreshArchive(activeSession.token);
      setActiveView("documents");
    } catch (err) {
      updateFlow("publish", "failed");
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
    setFlow(initialFlow);
    setLastResponse(null);
    setActiveView("dashboard");
  }

  useEffect(() => {
    refreshStatus();
  }, []);

  useEffect(() => {
    if (session?.token) {
      updateFlow("session", "ok");
    }
  }, [session?.token]);

  return (
    <main className="min-h-screen overflow-hidden">
      <header className="border-b border-space-line bg-black/30 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-neon-cyan/40 bg-gradient-to-br from-cyber-purple/80 to-neon-cyan/60 text-xl font-black shadow-neon-cyan">
                E
              </div>
              <div>
                <p className="label">ExamFlow</p>
                <h1 className="text-2xl font-black text-ink sm:text-3xl">Live Analysis Dashboard</h1>
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
              <Signal icon={ShieldCheck} label="JWT" value={session?.token ? "Authenticated" : "Idle"} tone={session?.token ? "ok" : "idle"} />
              <Signal icon={Database} label="MongoDB" value={ready?.databaseStatus || "Unknown"} tone={ready?.databaseStatus === "ready" ? "ok" : ready?.status} />
              <Signal icon={Activity} label="/health" value={health?.status || "Pending"} tone={health?.status} />
              <Signal icon={Server} label="/ready" value={ready?.status || "Pending"} tone={ready?.status} />
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
        {activeView === "dashboard" ? (
          <DashboardView
            busy={busy}
            documents={documents}
            error={error}
            exams={exams}
            flow={flow}
            health={health}
            lastResponse={lastResponse}
            onResetSession={resetSession}
            onStartSession={startDemoSession}
            onSubmitDocument={submitDocument}
            ready={ready}
            selectedFile={selectedFile}
            session={session}
            setSelectedFile={setSelectedFile}
            setSource={setSource}
            source={source}
          />
        ) : null}

        {activeView === "documents" ? (
          <ArchiveView
            busy={busy}
            empty="Henuz document kaydi yok."
            error={error}
            icon={FileText}
            onStartSession={startDemoSession}
            onRefresh={() => refreshArchive()}
            records={documents}
            session={session}
            title="Documents"
          />
        ) : null}

        {activeView === "exams" ? (
          <ArchiveView
            busy={busy}
            empty="Henuz exam kaydi yok."
            error={error}
            icon={ClipboardList}
            onStartSession={startDemoSession}
            onRefresh={() => refreshArchive()}
            records={exams}
            session={session}
            title="Exams"
          />
        ) : null}
      </div>
    </main>
  );
}

function DashboardView({
  busy,
  documents,
  error,
  exams,
  flow,
  health,
  lastResponse,
  onResetSession,
  onStartSession,
  onSubmitDocument,
  ready,
  selectedFile,
  session,
  setSelectedFile,
  setSource,
  source,
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(260px,0.8fr)_minmax(420px,1.3fr)_minmax(300px,0.9fr)]">
      <section className="panel glass-grid p-5">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="label">Input</p>
            <h2 className="mt-1 text-xl font-bold">Lecture Note</h2>
          </div>
          <Badge tone={session?.token ? "ok" : "idle"}>{session?.token ? "Token Ready" : "No Token"}</Badge>
        </div>

        <form onSubmit={onSubmitDocument}>
          <label className="block rounded-lg border border-dashed border-cyber-purple/50 bg-black/25 p-5 text-center transition hover:border-neon-cyan/70">
            <FileUp className="mx-auto h-12 w-12 text-cyber-purple" />
            <span className="mt-4 block truncate text-sm font-semibold text-ink">{selectedFile?.name || "demo-document.pdf"}</span>
            <span className="mt-1 block text-xs text-muted">document.uploaded</span>
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
            <button className="btn btn-primary" type="button" onClick={onStartSession} disabled={busy === "session"}>
              {busy === "session" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Demo Baslat
            </button>
            <button className="btn btn-secondary" type="button" onClick={onResetSession}>
              <RotateCcw className="h-4 w-4" />
              Sifirla
            </button>
          </div>

          <button className="btn btn-primary mt-3 w-full" type="submit" disabled={busy === "publish"}>
            {busy === "publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
            Publish Event
          </button>
        </form>

        {error ? <div className="mt-4 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm font-medium text-danger">{error}</div> : null}
      </section>

      <WorkflowPanel flow={flow} busy={busy} />

      <section className="space-y-5">
        <section className="panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="label">Generated Content</p>
              <h2 className="mt-1 text-xl font-bold">MongoDB Storage</h2>
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
            <h2 className="text-lg font-bold">Infrastructure Metrics</h2>
            <Cpu className="h-5 w-5 text-neon-green" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Metric label="/health" value={health?.status || "pending"} tone={health?.status} />
            <Metric label="/ready" value={ready?.status || "pending"} tone={ready?.status} />
            <Metric label="database" value={ready?.databaseStatus || "unknown"} tone={ready?.databaseStatus === "ready" ? "ok" : ready?.status} />
            <Metric label="mode" value={health?.mode || "unknown"} tone={health?.status} />
          </div>
        </section>

        <LastResponsePanel lastResponse={lastResponse} />
      </section>
    </div>
  );
}

function WorkflowPanel({ flow, busy }) {
  const sessionState = flow.find((item) => item.id === "session")?.status;
  const publishState = flow.find((item) => item.id === "publish")?.status;
  const documentsState = flow.find((item) => item.id === "documents")?.status;
  const examsState = flow.find((item) => item.id === "exams")?.status;

  const nodes = [
    { label: "API Service", icon: Server, state: publishState, detail: "protected /publish" },
    { label: "Pub/Sub", icon: Cloud, state: publishState, detail: "document-events" },
    { label: "Worker", icon: Cpu, state: publishState === "ok" ? "running" : publishState, detail: "processing" },
    { label: "Validation", icon: ShieldCheck, state: examsState, detail: "validation result" },
    { label: "Exam Service", icon: ClipboardList, state: examsState, detail: "exam lifecycle" },
    { label: "MongoDB", icon: Database, state: documentsState, detail: "documents / exams" },
  ];

  return (
    <section className="panel relative min-h-[560px] overflow-hidden p-5">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-cyber-purple via-neon-cyan to-neon-magenta" />
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="label">Event-Drıven Workflow</p>
          <h2 className="mt-1 text-xl font-bold">Note Processed</h2>
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
            <p className="mt-2 text-sm font-bold">System Core</p>
            <p className="text-xs text-muted">{sessionState === "ok" ? "JWT verified" : "waiting"}</p>
          </div>
        </div>

        <div className="space-y-4">
          {nodes.slice(3).map((node) => (
            <WorkflowNode key={node.label} node={node} />
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        {flow.map((item) => (
          <FlowStep key={item.id} item={item} />
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
          <p className="truncate text-sm font-bold">{node.label}</p>
          <p className="truncate text-xs text-muted">{node.detail}</p>
        </div>
      </div>
    </article>
  );
}

function ArchiveView({ busy, empty, error, icon: Icon, onRefresh, onStartSession, records, session, title }) {
  if (!session?.token) {
    return (
      <section className="panel glass-grid p-6">
        <p className="label">Authenticated Area</p>
        <div className="mt-2 flex items-center gap-3">
          <Icon className="h-6 w-6 text-neon-cyan" />
          <h2 className="text-xl font-semibold">{title}</h2>
        </div>
        <button className="btn btn-primary mt-5" type="button" onClick={onStartSession} disabled={busy === "session"}>
          {busy === "session" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Demo Baslat
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="panel glass-grid p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Icon className="h-6 w-6 text-neon-cyan" />
            <div>
              <p className="label">Archive</p>
              <h2 className="mt-1 text-xl font-semibold">{title}</h2>
            </div>
          </div>
          <button className="btn btn-secondary" type="button" onClick={onRefresh} disabled={busy === "archive"}>
            {busy === "archive" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
        </div>
      </div>
      {error ? <div className="rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm font-medium text-danger">{error}</div> : null}
      <ArchivePanel records={records} empty={empty} />
    </section>
  );
}

function Signal({ icon: Icon, label, value, tone }) {
  return (
    <div className={`flex h-10 items-center gap-2 rounded-md border px-3 ${statusTone(tone)}`}>
      <Icon className="h-4 w-4" />
      <span className="text-xs font-semibold">{label}</span>
      <span className="text-xs">{value}</span>
    </div>
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
      <p className={`mt-2 truncate text-sm font-bold ${statusTone(tone).includes("green") ? "text-neon-green" : statusTone(tone).includes("amber") ? "text-neon-amber" : "text-ink"}`}>
        {value}
      </p>
    </div>
  );
}

function LastResponsePanel({ lastResponse }) {
  return (
    <section className="panel p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Last API Response</h2>
        <Badge tone={lastResponse ? "ok" : "idle"}>{lastResponse ? lastResponse.action : "Waiting"}</Badge>
      </div>
      <pre className="max-h-56 overflow-auto rounded-md border border-space-line bg-black/55 p-4 text-xs leading-5 text-slate-100">
        {lastResponse ? JSON.stringify(lastResponse, null, 2) : "No response yet."}
      </pre>
    </section>
  );
}

function FlowStep({ item }) {
  const done = item.status === "ok";
  const failed = item.status === "failed";
  const running = item.status === "running";
  const Icon = done ? CheckCircle2 : failed ? XCircle : running ? Loader2 : Activity;
  return (
    <div className="rounded-lg border border-space-line bg-black/25 p-3">
      <Icon className={`h-5 w-5 ${running ? "animate-spin text-neon-amber" : done ? "text-neon-green" : failed ? "text-danger" : "text-muted"}`} />
      <p className="mt-3 text-sm font-semibold">{item.label}</p>
      <p className="mt-1 text-xs capitalize text-muted">{item.status}</p>
    </div>
  );
}

function ArchivePanel({ records, empty }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {records.length ? (
        records.map((record) => (
          <article key={record.id || `${record.documentId}-${record.createdAt}`} className="panel p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{record.title || record.fileName || record.documentId}</p>
                <p className="mt-1 truncate text-xs text-muted">{record.documentId}</p>
              </div>
              <Badge tone={record.status}>{record.status || "unknown"}</Badge>
            </div>
            <dl className="mt-4 grid gap-2 text-xs text-muted">
              <div className="flex justify-between gap-3">
                <dt>Result</dt>
                <dd className="text-right text-ink">{record.validationResult || record.source || "-"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Updated</dt>
                <dd className="text-right text-ink">{record.updatedAt || record.createdAt || "-"}</dd>
              </div>
            </dl>
          </article>
        ))
      ) : (
        <p className="panel p-5 text-sm text-muted">{empty}</p>
      )}
    </div>
  );
}

export default App;
