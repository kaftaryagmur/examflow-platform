import {
  Activity,
  ClipboardList,
  Cloud,
  Cpu,
  Database,
  FileText,
  FileUp,
  KeyRound,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ArchiveList } from "../../components/archive";
import { Alert, Badge, StatusPill, TimelineStep } from "../../components/status";
import { defaultBaseUrl, demoPassword, demoViews, emptyTimeline, sessionKey } from "../../config/appConfig";
import { parseResponse, responseMessage } from "../../utils/api";
import { compactTimestamp, delay, displayStatus, parseRecordDate, toneClass } from "../../utils/format";
import { readStoredSession } from "../../utils/session";

export function DemoDashboard() {
  const [activeView, setActiveView] = useState("dashboard");
  const apiBaseUrl = defaultBaseUrl;
  const [session, setSession] = useState(readStoredSession);
  const [health, setHealth] = useState(null);
  const [ready, setReady] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [exams, setExams] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [source, setSource] = useState("frontend-demo");
  const [timeline, setTimeline] = useState(emptyTimeline);
  const [lastResponse, setLastResponse] = useState(null);
  const [lastDocumentId, setLastDocumentId] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const demoDocumentId = useMemo(() => `demo-${compactTimestamp(new Date())}`, [selectedFile]);

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
      throw new Error("Arşiv kayıtlarını görmek için önce demo oturumu başlatılmalı.");
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
      setError("Arşiv kayıtlarını görmek için önce demo oturumu başlatılmalı.");
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

    setNotice("Sınav kaydı henüz oluşmadı. Event akışı arka planda devam ediyor olabilir.");
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
      source: source.trim() || "frontend-demo",
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
                <h1 className="truncate text-2xl font-black text-ink sm:text-3xl">Canlı Demo Akışı</h1>
              </div>
              <Badge tone={health?.status || "idle"}>{health?.mode ? `GKE modu: ${displayStatus(health.mode)}` : "GKE bağlantısı"}</Badge>
            </div>

            <button className="btn btn-secondary" type="button" onClick={refreshStatus} disabled={busy === "status"}>
              {busy === "status" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Durumu yenile
            </button>
          </div>

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <nav className="flex flex-wrap gap-2" aria-label="Demo ekranı menüsü">
              {demoViews.map((view) => {
                const Icon = view.icon;
                const active = activeView === view.id;
                return (
                  <button key={view.id} className={`btn ${active ? "btn-primary" : "btn-secondary"}`} type="button" onClick={() => setActiveView(view.id)}>
                    <Icon className="h-4 w-4" />
                    {view.label}
                  </button>
                );
              })}
            </nav>
            <div className="flex flex-wrap gap-2">
              <StatusPill icon={ShieldCheck} label="JWT" value={session?.token ? "Oturum açık" : "Oturum yok"} tone={session?.token ? "ok" : "idle"} />
              <StatusPill icon={Database} label="MongoDB" value={displayStatus(ready?.databaseStatus)} tone={ready?.databaseStatus === "ready" ? "ok" : ready?.status} />
              <StatusPill icon={Activity} label="/health" value={displayStatus(health?.status || "pending")} tone={health?.status} />
              <StatusPill icon={Server} label="/ready" value={displayStatus(ready?.status || "pending")} tone={ready?.status} />
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
            empty="Bu kullanıcı için henüz doküman kaydı bulunamadı."
            icon={FileText}
            onRefresh={() => refreshArchive()}
            onStart={startDemoSession}
            records={documents}
            session={session}
            title="Doküman kayıtları"
          />
        ) : null}

        {activeView === "exams" ? (
          <ArchiveView
            busy={busy}
            empty="Bu kullanıcı için henüz sınav kaydı bulunamadı."
            icon={ClipboardList}
            onRefresh={() => refreshArchive()}
            onStart={startDemoSession}
            records={exams}
            session={session}
            title="Sınav kayıtları"
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
            <p className="label">Girdi</p>
            <h2 className="mt-1 text-xl font-bold text-ink">Ders notu dokümanı</h2>
          </div>
          <Badge tone={session?.token ? "ok" : "idle"}>{session?.token ? "JWT hazır" : "Oturum yok"}</Badge>
        </div>

        <form onSubmit={onSubmit}>
          <label className="block rounded-lg border border-dashed border-cyber-purple/50 bg-black/25 p-5 text-center transition hover:border-neon-cyan/70">
            <FileUp className="mx-auto h-12 w-12 text-cyber-purple" />
            <span className="mt-4 block truncate text-sm font-semibold text-ink">{selectedFile?.name || "demo-document.pdf"}</span>
            <span className="mt-1 block text-xs text-muted">documentId: {demoDocumentId}</span>
            <input className="sr-only" type="file" accept=".pdf,.docx" onChange={(event) => setSelectedFile(event.target.files?.[0] || null)} />
          </label>

          <label className="mt-4 block">
            <span className="label">Kaynak</span>
            <input className="field mt-1" value={source} onChange={(event) => setSource(event.target.value)} />
          </label>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <button className="btn btn-primary" type="button" onClick={onStart} disabled={busy === "session"}>
              {busy === "session" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Oturum başlat
            </button>
            <button className="btn btn-secondary" type="button" onClick={onReset}>
              <RotateCcw className="h-4 w-4" />
              Sıfırla
            </button>
          </div>

          <button className="btn btn-primary mt-3 w-full" type="submit" disabled={busy === "publish"}>
            {busy === "publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
            Dokümanı event olarak gönder
          </button>
        </form>
      </section>

      <WorkflowPanel busy={busy} documents={documents} exams={exams} lastDocumentId={lastDocumentId} timeline={timeline} />

      <section className="space-y-5">
        <section className="panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="label">Oluşan kayıtlar</p>
              <h2 className="mt-1 text-xl font-bold text-ink">MongoDB depolama</h2>
            </div>
            <Database className="h-5 w-5 text-neon-magenta" />
          </div>

          <div className="grid gap-3">
            <StorageCard title="Dokümanlar" subtitle="collection: documents" count={documents.length} tone="cyan" />
            <StorageCard title="Sınavlar" subtitle="collection: exams" count={exams.length} tone="green" />
          </div>
        </section>

        <section className="panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-ink">Sistem durumu</h2>
            <Cpu className="h-5 w-5 text-neon-green" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Metric label="/health" value={displayStatus(health?.status || "pending")} tone={health?.status} />
            <Metric label="/ready" value={displayStatus(ready?.status || "pending")} tone={ready?.status} />
            <Metric label="database" value={displayStatus(ready?.databaseStatus || "unknown")} tone={ready?.databaseStatus === "ready" ? "ok" : ready?.status} />
            <Metric label="mode" value={displayStatus(health?.mode || "unknown")} tone={health?.status} />
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
    { label: "API Service", icon: Server, state: stateById.received, detail: "JWT ile korunan /publish" },
    { label: "Pub/Sub", icon: Cloud, state: stateById.published, detail: "document-events kuyruğu" },
    { label: "Worker Service", icon: Cpu, state: stateById.processing, detail: "dokümanı işler" },
    { label: "Validation Service", icon: ShieldCheck, state: validationState, detail: "çıktıyı doğrular" },
    { label: "Exam Service", icon: ClipboardList, state: validationState, detail: "sınav kaydı üretir" },
    { label: "MongoDB", icon: Database, state: documents.length || exams.length ? "ok" : "waiting", detail: "doküman ve sınav arşivi" },
  ];

  return (
    <section className="panel relative min-h-[560px] overflow-hidden p-5">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-cyber-purple via-neon-cyan to-neon-magenta" />
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="label">Event-driven workflow</p>
          <h2 className="mt-1 text-xl font-bold text-ink">Doküman işleme akışı</h2>
        </div>
        <Badge tone={busy ? "running" : publishState === "ok" ? "ok" : "idle"}>{busy ? "Çalışıyor" : "Hazır"}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          {nodes.slice(0, 3).map((node) => (
            <WorkflowNode key={node.label} node={node} />
          ))}
        </div>

        <div className="flex min-w-0 items-center justify-center py-4">
          <div className="flex h-28 w-28 flex-col items-center justify-center rounded-full border border-neon-cyan/50 bg-black/40 px-2 text-center shadow-neon-cyan 2xl:h-36 2xl:w-36">
            <KeyRound className="h-6 w-6 text-neon-cyan 2xl:h-7 2xl:w-7" />
            <p className="mt-2 text-sm font-bold text-ink">Akış merkezi</p>
            <p className="text-xs text-muted">{lastDocumentId ? lastDocumentId : "doküman bekleniyor"}</p>
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          {nodes.slice(3).map((node) => (
            <WorkflowNode key={node.label} node={node} />
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
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
    <article className={`rounded-lg border p-4 transition ${active ? "border-neon-cyan/60 bg-neon-cyan/10 shadow-neon-cyan" : "border-space-line bg-black/25"}`}>
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
  const metricTone = toneClass(tone);
  const valueClass = metricTone.includes("green") ? "text-neon-green" : metricTone.includes("amber") ? "text-neon-amber" : "text-ink";
  return (
    <div className="rounded-lg border border-space-line bg-black/25 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-normal text-muted">{label}</p>
      <p className={`mt-2 truncate text-sm font-bold ${valueClass}`}>{value}</p>
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
            <p className="label">JWT ile korunan arşiv</p>
            <h2 className="mt-1 text-xl font-semibold text-ink">{title}</h2>
          </div>
        </div>
        <button className="btn btn-primary mt-5" type="button" onClick={onStart} disabled={busy === "session"}>
          {busy === "session" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Demo oturumu başlat
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
              <p className="label">Arşiv</p>
              <h2 className="mt-1 text-xl font-semibold text-ink">{title}</h2>
            </div>
          </div>
          <button className="btn btn-secondary" type="button" onClick={onRefresh} disabled={busy === "archive"}>
            {busy === "archive" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Kayıtları yenile
          </button>
        </div>
      </div>
      <ArchiveList records={records} empty={empty} />
    </section>
  );
}

function LastResponse({ lastResponse }) {
  return (
    <section className="panel p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label">API</p>
          <h2 className="section-title">Son API cevabı</h2>
        </div>
        <Badge tone={lastResponse ? "ok" : "idle"}>{lastResponse ? lastResponse.action : "bekleniyor"}</Badge>
      </div>
      <pre className="mt-4 max-h-64 overflow-auto rounded-md border border-space-line bg-black/55 p-4 text-xs leading-5 text-slate-100">
        {lastResponse ? JSON.stringify(lastResponse, null, 2) : "Henüz API cevabı yok."}
      </pre>
    </section>
  );
}
