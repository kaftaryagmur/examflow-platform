import {
  Activity,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  Cloud,
  Cpu,
  Database,
  FileText,
  FileUp,
  KeyRound,
  Loader2,
  Maximize2,
  Play,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { ArchiveList } from "../../components/archive";
import { Alert, Badge, StatusPill, TimelineStep } from "../../components/status";
import { defaultBaseUrl, demoPassword, demoViews, emptyTimeline, sessionKey } from "../../config/appConfig";
import { parseResponse, responseMessage } from "../../utils/api";
import { compactTimestamp, delay, displayStatus, parseRecordDate, sortRecordsByDate, toneClass } from "../../utils/format";
import { readStoredSession } from "../../utils/session";

const markLogoSrc = "/assets/logo2.png";

export function DemoDashboard() {
  const [activeView, setActiveView] = useState("dashboard");
  const apiBaseUrl = defaultBaseUrl;
  const [session, setSession] = useState(readStoredSession);
  const [health, setHealth] = useState(null);
  const [ready, setReady] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [exams, setExams] = useState([]);
  const [activities, setActivities] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [source, setSource] = useState("frontend-demo");
  const [timeline, setTimeline] = useState(emptyTimeline);
  const [lastResponse, setLastResponse] = useState(null);
  const [lastDocumentId, setLastDocumentId] = useState("");
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const demoDocumentId = useMemo(() => `demo-${compactTimestamp(new Date())}`, [selectedFile]);
  const appTarget = session?.token ? "/app/dashboard" : "/login";

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
      const error = new Error(responseMessage(options.method || "GET", path, parsed.status, parsed.body, apiBaseUrl));
      error.status = parsed.status;
      error.body = parsed.body;
      throw error;
    }
    return parsed.body;
  }

  function isAuthError(err) {
    const text = `${err?.message || ""} ${typeof err?.body === "string" ? err.body : JSON.stringify(err?.body || "")}`.toLowerCase();
    return err?.status === 401 || text.includes("invalid token") || text.includes("unauthorized") || text.includes("jwt");
  }

  function clearDemoSession() {
    window.localStorage.removeItem(sessionKey);
    setSession(null);
    setDocuments([]);
    setExams([]);
    setActivities([]);
  }

  function showSessionRequiredNotice() {
    setError("");
    setNotice("Demo arşivi ve doküman gönderimi JWT ile korunur. Devam etmek için sol paneldeki Oturum başlat butonuna tıkla.");
  }

  async function refreshStatus() {
    setBusy("status");
    setError("");
    try {
      const [healthBody, readyBody] = await Promise.all([request("/health"), request("/ready")]);
      setHealth(healthBody);
      setReady(readyBody);
      if (session?.token) {
        try {
          await loadArchive(session.token);
        } catch (archiveErr) {
          if (isAuthError(archiveErr)) {
            clearDemoSession();
            showSessionRequiredNotice();
          } else {
            setError(archiveErr.message);
          }
        }
      }
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
    const email = session?.token || !session?.email ? `demo-${Date.now()}@examflow.local` : session.email;
    const shouldRegister = !session?.email || email !== session.email;
    const displayName = "Demo User";

    try {
      if (shouldRegister) {
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
      return { documents: [], exams: [], activities: [] };
    }

    const headers = { Authorization: `Bearer ${token}` };
    const [documentBody, examBody, activityBody] = await Promise.all([
      request("/documents", { headers }),
      request("/exams", { headers }),
      request("/activity", { headers }),
    ]);
    const nextDocuments = documentBody.documents || [];
    const nextExams = examBody.exams || [];
    const nextActivities = activityBody.activities || [];
    setDocuments(nextDocuments);
    setExams(nextExams);
    setActivities(nextActivities);
    return { documents: nextDocuments, exams: nextExams, activities: nextActivities };
  }

  async function refreshArchive(token = session?.token) {
    if (!token) {
      showSessionRequiredNotice();
      return null;
    }

    setBusy("archive");
    setError("");
    try {
      return await loadArchive(token);
    } catch (err) {
      if (isAuthError(err)) {
        clearDemoSession();
        showSessionRequiredNotice();
      } else {
        setError(err.message);
      }
      return null;
    } finally {
      setBusy("");
    }
  }

  async function waitForExamRecord(token, documentId) {
    setStep("processing", "running");
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await delay(attempt === 0 ? 900 : 2000);
      const archive = await loadArchive(token);
      const exam = archive.exams.find((record) => record.documentId === documentId);
      if (!exam) continue;

      if (exam.status === "failed" || exam.validationResult === "invalid") {
        setStep("processing", "ok");
        setStep("failed", "failed");
      } else {
        setStep("processing", "ok");
        setStep("validated", "ok");
        setStep("failed", "waiting");
      }
      setNotice("");
      return exam;
    }

    setNotice("Sınav kaydı henüz oluşmadı. AI üretimi arka planda devam ediyor olabilir; kayıtlar otomatik yenilenmeye devam etmezse tekrar kontrol et.");
    return null;
  }

  async function submitDocument(event) {
    event.preventDefault();
    if (!selectedFile) {
      setError("PDF veya DOCX dosyasi secilmeden dokuman gonderilemez.");
      return;
    }

    let activeSession = session;
    if (!activeSession?.token) {
      activeSession = await startDemoSession();
    }
    if (!activeSession?.token) return;

    const documentId = `demo-${compactTimestamp(new Date())}`;
    const payload = {
      documentId,
      fileName: selectedFile.name,
      fileSize: selectedFile.size,
      contentType: selectedFile.type || "application/octet-stream",
      source: source.trim() || "frontend-demo",
    };
    const formData = new FormData();
    formData.append("documentId", documentId);
    formData.append("source", payload.source);
    formData.append("file", selectedFile);

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
          Authorization: `Bearer ${activeSession.token}`,
        },
        body: formData,
      });
      setLastResponse({ action: "publish", request: payload, body });
      setStep("received", "ok");
      setStep("published", "ok");
      await waitForExamRecord(activeSession.token, documentId);
      setActiveView("dashboard");
    } catch (err) {
      setStep("failed", "failed");
      if (isAuthError(err)) {
        clearDemoSession();
        showSessionRequiredNotice();
      } else {
        setError(err.message);
      }
    } finally {
      setBusy("");
    }
  }

  function resetSession() {
    window.localStorage.removeItem(sessionKey);
    setSession(null);
    setDocuments([]);
    setExams([]);
    setActivities([]);
    setLastResponse(null);
    setLastDocumentId("");
    setNotice("");
    setError("");
    resetTimeline();
    setActiveView("dashboard");
    setSelectedRecord(null);
  }

  function openDocumentDetail(document) {
    setSelectedRecord(document);
    setActiveView("document-detail");
  }

  function openExamDetail(exam) {
    setSelectedRecord(exam);
    setActiveView("exam-detail");
  }

  function backToArchive(view) {
    setSelectedRecord(null);
    setActiveView(view);
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
              <img className="brand-logo" src={markLogoSrc} alt="ExamFlow logo" />
              <div className="min-w-0">
                <p className="label">ExamFlow</p>
                <h1 className="truncate text-2xl font-black text-ink sm:text-3xl">Canlı Demo Akışı</h1>
              </div>
              <Badge tone={health?.status || "idle"}>{health?.mode ? `GKE modu: ${displayStatus(health.mode)}` : "GKE bağlantısı"}</Badge>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link className="btn btn-primary" to={appTarget}>
                <ArrowLeft className="h-4 w-4 rotate-180" />
                Uygulamaya git
              </Link>
              <button className="btn btn-secondary" type="button" onClick={refreshStatus} disabled={busy === "status"}>
                {busy === "status" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Durumu yenile
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <nav className="flex flex-wrap gap-2" aria-label="Demo ekranı menüsü">
              {demoViews.map((view) => {
                const Icon = view.icon;
                const active = activeView === view.id;
                return (
                  <button
                    key={view.id}
                    className={`btn ${active ? "btn-primary" : "btn-secondary"}`}
                    type="button"
                    onClick={() => {
                      setSelectedRecord(null);
                      setActiveView(view.id);
                    }}
                  >
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
            activities={activities}
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
            onOpenRecord={openDocumentDetail}
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
            onOpenRecord={openExamDetail}
            onRefresh={() => refreshArchive()}
            onStart={startDemoSession}
            records={exams}
            session={session}
            title="Sınav kayıtları"
          />
        ) : null}

        {activeView === "document-detail" ? (
          <DemoDocumentDetail activities={activities} document={selectedRecord} exams={exams} onBack={() => backToArchive("documents")} onOpenExam={openExamDetail} />
        ) : null}

        {activeView === "exam-detail" ? (
          <DemoExamDetail exam={selectedRecord} documents={documents} onBack={() => backToArchive("exams")} onOpenDocument={openDocumentDetail} />
        ) : null}
      </div>
    </main>
  );
}

function Dashboard({
  activities,
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
            <span className="mt-4 block truncate text-sm font-semibold text-ink">{selectedFile?.name || "PDF veya DOCX dosyasi sec"}</span>
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

          <button className="btn btn-primary mt-3 w-full" type="submit" disabled={busy === "publish" || !selectedFile}>
            {busy === "publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
            Dokümanı event olarak gönder
          </button>
        </form>
      </section>

      <WorkflowPanel activities={activities} busy={busy} documents={documents} exams={exams} lastDocumentId={lastDocumentId} timeline={timeline} />

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

function WorkflowPanel({ activities = [], busy, documents, exams, lastDocumentId, timeline }) {
  const [expanded, setExpanded] = useState(false);
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
  const logs = buildWorkflowLogs({ activities, busy, documents, exams, lastDocumentId, timeline });

  return (
    <>
      <section className="panel relative min-h-[560px] overflow-hidden p-5">
        <WorkflowMap
          busy={busy}
          lastDocumentId={lastDocumentId}
          nodes={nodes}
          publishState={publishState}
          timeline={timeline}
          onExpand={() => setExpanded(true)}
        />
      </section>

      {expanded ? (
        <WorkflowFullscreenModal
          busy={busy}
          lastDocumentId={lastDocumentId}
          logs={logs}
          nodes={nodes}
          onClose={() => setExpanded(false)}
          publishState={publishState}
          timeline={timeline}
        />
      ) : null}
    </>
  );
}

function WorkflowMap({ busy, lastDocumentId, nodes, onExpand, publishState, timeline }) {
  return (
    <>
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-cyber-purple via-neon-cyan to-neon-magenta" />
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="label">Event-driven workflow</p>
          <h2 className="mt-1 text-xl font-bold text-ink">Doküman işleme akışı</h2>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={busy ? "running" : publishState === "ok" ? "ok" : "idle"}>{busy ? "Çalışıyor" : "Hazır"}</Badge>
          {onExpand ? (
            <button className="btn btn-secondary" type="button" onClick={onExpand} title="Tam ekran izleme">
              <Maximize2 className="h-4 w-4" />
              Tam ekran
            </button>
          ) : null}
        </div>
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
    </>
  );
}

function WorkflowFullscreenModal({ busy, lastDocumentId, logs, nodes, onClose, publishState, timeline }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 p-3 backdrop-blur-xl sm:p-5" role="dialog" aria-modal="true" aria-label="Tam ekran workflow izleme">
      <section className="grid h-full overflow-hidden rounded-lg border border-neon-cyan/35 bg-[#080719] shadow-neon-cyan xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
        <div className="relative min-h-0 overflow-auto p-5 lg:p-7">
          <WorkflowMap busy={busy} lastDocumentId={lastDocumentId} nodes={nodes} publishState={publishState} timeline={timeline} />
        </div>

        <aside className="min-h-0 border-t border-space-line bg-black/35 p-5 xl:border-l xl:border-t-0">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="label">Canlı loglar</p>
              <h2 className="mt-1 text-xl font-black text-ink">Event ve servis kayıtları</h2>
            </div>
            <button className="btn btn-secondary" type="button" onClick={onClose}>
              <X className="h-4 w-4" />
              Kapat
            </button>
          </div>

          <div className="grid max-h-[calc(100vh-8.5rem)] gap-3 overflow-auto pr-1">
            {logs.length ? (
              logs.map((log) => <WorkflowLogCard key={log.id} log={log} />)
            ) : (
              <p className="rounded-lg border border-dashed border-space-line bg-black/25 p-4 text-sm text-muted">Henüz workflow log kaydı yok. Bir doküman gönderildiğinde event adımları burada akacak.</p>
            )}
          </div>
        </aside>
      </section>
    </div>
  );
}

function WorkflowLogCard({ log }) {
  return (
    <article className={`rounded-lg border p-4 ${toneClass(log.tone)}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="break-words text-sm font-black text-ink">{log.title}</p>
        <Badge tone={log.tone}>{displayStatus(log.status)}</Badge>
      </div>
      <p className="mt-2 break-words text-xs leading-5 text-muted">{log.message}</p>
      <div className="mt-3 grid gap-1 text-xs text-muted">
        <p><span className="font-bold text-ink">Servis:</span> {log.service}</p>
        <p><span className="font-bold text-ink">documentId:</span> <span className="break-all">{log.documentId || "-"}</span></p>
        <p><span className="font-bold text-ink">Zaman:</span> {parseRecordDate(log.createdAt)}</p>
      </div>
      {log.raw ? (
        <pre className="mt-3 max-h-32 overflow-auto rounded-md border border-space-line bg-black/40 p-3 text-[11px] leading-5 text-slate-200">{JSON.stringify(log.raw, null, 2)}</pre>
      ) : null}
    </article>
  );
}

function buildWorkflowLogs({ activities, busy, documents, exams, lastDocumentId, timeline }) {
  const activityLogs = sortRecordsByDate(activities)
    .filter((event) => !lastDocumentId || event.documentId === lastDocumentId)
    .map((event) => ({
      createdAt: event.createdAt || event.updatedAt,
      documentId: event.documentId,
      id: event.id || `${event.eventId}-${event.eventType}-${event.createdAt}`,
      message: event.message || readableDemoActivityMessage(event),
      raw: event,
      service: event.service || serviceFromEventType(event.eventType),
      status: event.status || "recorded",
      title: readableDemoActivityTitle(event),
      tone: event.status || "idle",
    }));

  const timelineLogs = timeline
    .filter((item) => item.status && item.status !== "waiting")
    .map((item) => ({
      createdAt: new Date().toISOString(),
      documentId: lastDocumentId,
      id: `timeline-${item.id}-${item.status}`,
      message: item.description || `${item.label} adımı ${displayStatus(item.status)} durumunda.`,
      service: item.service || item.label,
      status: item.status,
      title: item.label,
      tone: item.status,
    }));

  const storageLogs = [
    documents.length ? { createdAt: new Date().toISOString(), documentId: lastDocumentId, id: "storage-documents", message: `${documents.length} doküman kaydı MongoDB documents collection içinde görünüyor.`, service: "MongoDB", status: "ok", title: "Documents collection", tone: "ok" } : null,
    exams.length ? { createdAt: new Date().toISOString(), documentId: lastDocumentId, id: "storage-exams", message: `${exams.length} sınav kaydı MongoDB exams collection içinde görünüyor.`, service: "MongoDB", status: "ok", title: "Exams collection", tone: "ok" } : null,
    busy ? { createdAt: new Date().toISOString(), documentId: lastDocumentId, id: "busy", message: `${busy} işlemi devam ediyor.`, service: "Demo UI", status: "running", title: "Canlı işlem", tone: "running" } : null,
  ].filter(Boolean);

  return [...activityLogs, ...timelineLogs, ...storageLogs];
}

function serviceFromEventType(eventType = "") {
  const type = String(eventType).toLowerCase();
  if (type.includes("publish") || type.includes("received")) return "api-service";
  if (type.includes("worker") || type.includes("processed")) return "worker-service";
  if (type.includes("valid")) return "validation-service";
  if (type.includes("exam")) return "exam-service";
  return "event-stream";
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

function ArchiveView({ busy, empty, icon: Icon, onOpenRecord, onRefresh, onStart, records, session, title }) {
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
      <ArchiveList records={records} empty={empty} onSelectRecord={onOpenRecord} />
    </section>
  );
}

function DemoDocumentDetail({ activities = [], document, exams, onBack, onOpenExam }) {
  if (!document) {
    return <DemoMissingDetail icon={FileText} label="Doküman kaydı bulunamadı." onBack={onBack} />;
  }

  const linkedExams = exams.filter((exam) => exam.documentId === document.documentId || exam.documentId === document.id);
  const documentActivities = sortRecordsByDate(activities.filter((event) => event.documentId === document.documentId || event.documentId === document.id));

  return (
    <div className="grid gap-5">
      <section className="panel glass-grid p-5">
        <button className="btn btn-secondary mb-5" type="button" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Doküman kayıtlarına dön
        </button>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="label">Demo doküman detayı</p>
            <h2 className="mt-2 break-words text-2xl font-black text-ink">{document.fileName || document.title || "İsimsiz doküman"}</h2>
            <p className="mt-2 break-all text-sm leading-6 text-muted">{document.documentId || document.id}</p>
          </div>
          <Badge tone={document.status}>{displayStatus(document.status || "recorded")}</Badge>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(280px,0.75fr)_minmax(0,1.25fr)]">
        <section className="panel p-5">
          <p className="label">Metadata</p>
          <h3 className="section-title">Kayıt özeti</h3>
          <DemoMetaGrid
            rows={[
              ["documentId", document.documentId || document.id || "-"],
              ["Dosya adı", document.fileName || "-"],
              ["Kaynak", document.source || "-"],
              ["Validation", displayStatus(document.validationResult || "-")],
              ["Oluşturulma", parseRecordDate(document.createdAt)],
              ["Güncelleme", parseRecordDate(document.updatedAt)],
            ]}
          />
        </section>

        <section className="panel p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="label">Bağlı sınavlar</p>
              <h3 className="section-title">Bu dokümandan üretilen kayıtlar</h3>
            </div>
            <Badge tone={linkedExams.length ? "ok" : "idle"}>{linkedExams.length} sınav</Badge>
          </div>

          {linkedExams.length ? (
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {linkedExams.map((exam) => (
                <button
                  className="rounded-lg border border-space-line bg-black/25 p-4 text-left transition hover:border-neon-cyan/50 hover:bg-neon-cyan/10"
                  key={exam.id || exam.examId || exam.documentId}
                  onClick={() => onOpenExam(exam)}
                  type="button"
                >
                  <div className="flex items-start gap-3">
                    <ClipboardList className="mt-1 h-5 w-5 shrink-0 text-neon-cyan" />
                    <div className="min-w-0">
                      <p className="break-words text-sm font-black text-ink">{exam.title || "Oluşturulan sınav"}</p>
                      <p className="mt-1 break-all text-xs text-muted">{exam.examId || exam.id || exam.documentId}</p>
                      <p className="mt-2 text-xs text-muted">{parseRecordDate(exam.updatedAt || exam.createdAt)}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-5 rounded-lg border border-dashed border-space-line bg-black/20 p-4 text-sm text-muted">
              Bu dokümana bağlı sınav kaydı henüz görünmüyor. Event akışı tamamlandığında burada listelenecek.
            </p>
          )}
        </section>

        <DemoDocumentActivityPanel activities={documentActivities} />
      </div>
    </div>
  );
}

function DemoDocumentActivityPanel({ activities }) {
  return (
    <section className="panel p-5 xl:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label">İşlem geçmişi</p>
          <h3 className="section-title">Bu dokümanın event akışı</h3>
        </div>
        <Badge tone={activities.length ? "ok" : "idle"}>{activities.length} olay</Badge>
      </div>

      {activities.length ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {activities.map((event) => (
            <article className="rounded-lg border border-space-line bg-black/25 p-4" key={event.id || `${event.eventId}-${event.eventType}-${event.createdAt}`}>
              <div className="flex items-start gap-3">
                <Activity className="mt-1 h-5 w-5 shrink-0 text-neon-cyan" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-black text-ink">{readableDemoActivityTitle(event)}</p>
                    <Badge tone={event.status}>{displayStatus(event.status || "recorded")}</Badge>
                  </div>
                  <p className="mt-2 break-words text-xs leading-5 text-muted">{event.message || readableDemoActivityMessage(event)}</p>
                  <p className="mt-2 text-xs text-muted">{parseRecordDate(event.createdAt || event.updatedAt)}</p>
                  {event.error ? <p className="mt-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger">{event.error}</p> : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-5 rounded-lg border border-dashed border-space-line bg-black/20 p-4 text-sm text-muted">
          Bu doküman için işlem geçmişi henüz görünmüyor. Activity kayıtları geldiğinde API, Pub/Sub, Worker, Validation ve Exam adımları burada listelenecek.
        </p>
      )}
    </section>
  );
}

function DemoExamDetail({ documents, exam, onBack, onOpenDocument }) {
  if (!exam) {
    return <DemoMissingDetail icon={ClipboardList} label="Sınav kaydı bulunamadı." onBack={onBack} />;
  }

  const linkedDocument = documents.find((document) => document.documentId === exam.documentId || document.id === exam.documentId);
  const questions = getDemoQuestions(exam);
  const cards = getDemoInfoCards(exam);

  return (
    <div className="grid gap-5">
      <section className="panel glass-grid p-5">
        <button className="btn btn-secondary mb-5" type="button" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Sınav kayıtlarına dön
        </button>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="label">Demo sınav detayı</p>
            <h2 className="mt-2 break-words text-2xl font-black text-ink">{exam.title || "Oluşturulan sınav"}</h2>
            <p className="mt-2 break-all text-sm leading-6 text-muted">{exam.examId || exam.id || exam.documentId}</p>
          </div>
          <Badge tone={exam.status}>{displayStatus(exam.status || "recorded")}</Badge>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(280px,0.75fr)_minmax(0,1.25fr)]">
        <aside className="grid content-start gap-5">
          <section className="panel p-5">
            <p className="label">Metadata</p>
            <h3 className="section-title">Kayıt özeti</h3>
            <DemoMetaGrid
              rows={[
                ["examId", exam.examId || exam.id || "-"],
                ["documentId", exam.documentId || "-"],
                ["Durum", displayStatus(exam.status || "recorded")],
                ["Validation", displayStatus(exam.validationResult || "-")],
                ["Oluşturulma", parseRecordDate(exam.createdAt)],
                ["Güncelleme", parseRecordDate(exam.updatedAt)],
              ]}
            />
          </section>

          <section className="panel p-5">
            <p className="label">Bağlı doküman</p>
            <h3 className="section-title">Kaynak kayıt</h3>
            {linkedDocument ? (
              <button className="mt-4 w-full rounded-lg border border-space-line bg-black/25 p-4 text-left transition hover:border-neon-cyan/50 hover:bg-neon-cyan/10" type="button" onClick={() => onOpenDocument(linkedDocument)}>
                <FileText className="mb-3 h-5 w-5 text-neon-cyan" />
                <p className="break-words text-sm font-black text-ink">{linkedDocument.fileName || linkedDocument.title || "Doküman"}</p>
                <p className="mt-1 break-all text-xs text-muted">{linkedDocument.documentId || linkedDocument.id}</p>
              </button>
            ) : (
              <p className="mt-4 rounded-lg border border-dashed border-space-line bg-black/20 p-4 text-sm text-muted">Kaynak doküman bu demo arşivinde bulunamadı.</p>
            )}
          </section>
        </aside>

        <main className="grid gap-5">
          <section className="panel p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="label">Soru önizlemesi</p>
                <h3 className="section-title">Üretilen sorular</h3>
              </div>
              <Badge tone={questions.length ? "ok" : "idle"}>{questions.length} soru</Badge>
            </div>

            {questions.length ? (
              <div className="mt-5 grid gap-3">
                {questions.slice(0, 5).map((question, index) => (
                  <DemoQuestionCard key={`${question.question || question.prompt || index}-${index}`} index={index} question={question} />
                ))}
              </div>
            ) : (
              <p className="mt-5 rounded-lg border border-dashed border-space-line bg-black/20 p-4 text-sm text-muted">Bu sınav kaydında soru içeriği henüz yok; metadata kaydı görüntüleniyor.</p>
            )}
          </section>

          <section className="panel p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="label">Bilgi kartları</p>
                <h3 className="section-title">Çalışma özeti</h3>
              </div>
              <Badge tone={cards.length ? "ok" : "idle"}>{cards.length} kart</Badge>
            </div>

            {cards.length ? (
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {cards.slice(0, 4).map((card, index) => (
                  <article className="rounded-lg border border-space-line bg-black/25 p-4" key={`${card.title || index}-${index}`}>
                    <BookOpen className="mb-3 h-5 w-5 text-neon-cyan" />
                    <p className="break-words text-sm font-black text-ink">{card.title || `Bilgi kartı ${index + 1}`}</p>
                    <p className="mt-2 break-words text-sm leading-6 text-muted">{card.summary || card.text || "-"}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="mt-5 rounded-lg border border-dashed border-space-line bg-black/20 p-4 text-sm text-muted">Bu sınav kaydında bilgi kartı içeriği henüz yok.</p>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

function DemoMissingDetail({ icon: Icon, label, onBack }) {
  return (
    <section className="panel p-6">
      <button className="btn btn-secondary mb-5" type="button" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" />
        Arşive dön
      </button>
      <div className="rounded-lg border border-dashed border-space-line bg-black/20 p-8 text-center">
        <Icon className="mx-auto h-10 w-10 text-muted" />
        <p className="mt-4 text-sm font-bold text-ink">{label}</p>
      </div>
    </section>
  );
}

function DemoMetaGrid({ rows }) {
  return (
    <dl className="mt-5 grid gap-3">
      {rows.map(([label, value]) => (
        <div className="rounded-lg border border-space-line bg-black/20 p-3" key={label}>
          <dt className="text-xs font-bold uppercase text-muted">{label}</dt>
          <dd className="mt-1 break-words text-sm font-bold text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DemoQuestionCard({ index, question }) {
  const normalized = normalizeDemoQuestion(question);

  return (
    <article className="rounded-lg border border-space-line bg-black/25 p-4">
      <div className="flex gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 text-sm font-black text-neon-cyan">{index + 1}</span>
        <div className="min-w-0">
          <p className="break-words text-sm font-black text-ink">{normalized.question}</p>
          <div className="mt-3 grid gap-2">
            {normalized.options.slice(0, 4).map((option, optionIndex) => {
              const letter = String.fromCharCode(65 + optionIndex);
              const isCorrect = letter === normalized.correctAnswer;
              return (
                <div className={`flex gap-2 rounded-lg border p-2 text-sm ${isCorrect ? "border-neon-green/40 bg-neon-green/10 text-ink" : "border-space-line bg-black/20 text-muted"}`} key={`${letter}-${option}`}>
                  <span className="font-black">{letter}</span>
                  <span className="break-words">{option}</span>
                  {isCorrect ? <CheckCircle2 className="ml-auto h-4 w-4 shrink-0 text-neon-green" /> : null}
                </div>
              );
            })}
          </div>
          {normalized.explanation ? <p className="mt-3 break-words text-xs leading-5 text-muted">{normalized.explanation}</p> : null}
        </div>
      </div>
    </article>
  );
}

function getDemoQuestions(exam) {
  const candidates = [exam.questions, exam.multipleChoiceQuestions, exam.questionCards, exam.items, exam.content?.questions, exam.generatedContent?.questions, exam.result?.questions];
  return candidates.find((candidate) => Array.isArray(candidate) && candidate.length > 0) || [];
}

function getDemoInfoCards(exam) {
  const candidates = [exam.infoCards, exam.cards, exam.studyCards, exam.content?.infoCards, exam.generatedContent?.infoCards, exam.result?.infoCards];
  return candidates.find((candidate) => Array.isArray(candidate) && candidate.length > 0) || [];
}

function normalizeDemoQuestion(question) {
  const options = question.options || question.choices || question.answers || [];
  const normalizedOptions = Array.isArray(options) && options.length ? options : ["Seçenek A", "Seçenek B", "Seçenek C", "Seçenek D"];
  return {
    correctAnswer: resolveDemoAnswerLetter(question.correctAnswer ?? question.answer ?? question.correctOption, normalizedOptions),
    explanation: question.explanation || question.rationale || "",
    options: normalizedOptions,
    question: question.question || question.prompt || question.text || "Soru metni bulunamadı.",
  };
}

function resolveDemoAnswerLetter(answer, options) {
  if (typeof answer === "number") return String.fromCharCode(65 + answer);
  const text = String(answer || "").trim();
  const upper = text.toUpperCase();
  if (["A", "B", "C", "D"].includes(upper)) return upper;
  const optionIndex = options.findIndex((option) => String(option).trim().toLowerCase() === text.toLowerCase());
  return optionIndex >= 0 ? String.fromCharCode(65 + optionIndex) : upper || "-";
}

function readableDemoActivityTitle(event) {
  const status = String(event.status || "").toLowerCase();
  const type = String(event.eventType || "").toLowerCase();
  if (status === "received" || type.includes("received")) return "Doküman alındı";
  if (status === "published" || type.includes("published")) return "Pub/Sub event yayınlandı";
  if (status === "processing" || type.includes("processing")) return "Worker işleme başladı";
  if (status === "processed" || type.includes("processed")) return "Doküman işleme tamamlandı";
  if (status === "validated" || type.includes("validated")) return "Doğrulama tamamlandı";
  if (status === "failed" || type.includes("failed")) return "Akış hata aldı";
  if (type.includes("exam")) return "Sınav kaydı oluşturuldu";
  return "Activity kaydı";
}

function readableDemoActivityMessage(event) {
  const status = String(event.status || "").toLowerCase();
  if (status === "received") return "API Service doküman isteğini aldı.";
  if (status === "published") return "Doküman event'i Pub/Sub hattına yayınlandı.";
  if (status === "processing") return "Worker Service dokümanı işliyor.";
  if (status === "processed") return "Doküman işleme adımı tamamlandı.";
  if (status === "validated") return "Validation sonucu üretildi ve sınav kaydı hazırlandı.";
  if (status === "failed") return "Bu dokümanın event akışında hata oluştu.";
  return "Bu dokümana ait activity kaydı oluşturuldu.";
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
