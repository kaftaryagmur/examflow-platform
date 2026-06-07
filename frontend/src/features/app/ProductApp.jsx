import {
  Activity,
  ClipboardList,
  Cloud,
  Database,
  FileText,
  FileUp,
  Loader2,
  RefreshCw,
  ShieldCheck,
  User,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";

import { ArchiveList } from "../../components/archive";
import { Alert, Badge, HealthRow } from "../../components/status";
import { appNav, defaultBaseUrl, demoPassword, sessionKey } from "../../config/appConfig";
import { DocumentArchivePage, DocumentDetailPage } from "../documents";
import { ExamArchivePage, ExamDetailPage } from "../exams";
import { parseResponse, responseMessage } from "../../utils/api";
import { compactTimestamp, delay, displayStatus, parseRecordDate, sortRecordsByDate, toneClass } from "../../utils/format";
import { readStoredSession } from "../../utils/session";

export function ProductApp() {
  const apiBaseUrl = defaultBaseUrl;
  const [session, setSession] = useState(readStoredSession);
  const [health, setHealth] = useState(null);
  const [ready, setReady] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [exams, setExams] = useState([]);
  const [activities, setActivities] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [source, setSource] = useState("app-dashboard");
  const [questionCount, setQuestionCount] = useState(5);
  const [difficulty, setDifficulty] = useState("mixed");
  const [infoCardCount, setInfoCardCount] = useState(3);
  const [focus, setFocus] = useState("");
  const [lastProcess, setLastProcess] = useState(null);
  const [processNotice, setProcessNotice] = useState("");
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

  function syncLastProcessFromArchive(nextDocuments, nextExams) {
    setLastProcess((current) => {
      const activeDocumentId = current?.documentId || current?.payload?.documentId;
      if (!activeDocumentId) return current;

      const documentRecord = nextDocuments.find((item) => item.documentId === activeDocumentId);
      const examRecord = nextExams.find((item) => item.documentId === activeDocumentId);
      if (!examRecord) return current;

      const failed = isFailedExamRecord(examRecord);
      if (!failed) {
        setProcessNotice("Doküman işlendi ve sınav kaydı arşive düştü.");
      }

      return {
        ...current,
        document: documentRecord || current?.document,
        exam: examRecord,
        status: failed ? "failed" : "ready",
        stage: failed ? "Sınav kaydı hata durumunda" : "Sonuçlar görüntülenebilir",
        finishedAt: current?.finishedAt || new Date().toISOString(),
      };
    });
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

  async function loadArchive(token = session?.token, options = {}) {
    if (!token) return { documents: [], exams: [], activities: [] };
    if (!options.silent) {
      setBusy("archive");
      setError("");
    }
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [documentBody, examBody, activityBody] = await Promise.all([
        appRequest("/documents", { headers }),
        appRequest("/exams", { headers }),
        appRequest("/activity", { headers }),
      ]);
      const nextDocuments = documentBody.documents || [];
      const nextExams = examBody.exams || [];
      const nextActivities = activityBody.activities || [];
      setDocuments(nextDocuments);
      setExams(nextExams);
      setActivities(nextActivities);
      syncLastProcessFromArchive(nextDocuments, nextExams);
      return { documents: nextDocuments, exams: nextExams, activities: nextActivities };
    } catch (err) {
      setError(err.message);
      return { documents: [], exams: [], activities: [] };
    } finally {
      if (!options.silent) {
        setBusy("");
      }
    }
  }

  async function waitForAppExamRecord(token, documentId) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const archive = await loadArchive(token, { silent: true });
      const documentRecord = archive.documents.find((item) => item.documentId === documentId);
      const examRecord = archive.exams.find((item) => item.documentId === documentId);
      const failed = isFailedExamRecord(examRecord);

      if (documentRecord || examRecord) {
        setLastProcess((current) => ({
          ...current,
          document: documentRecord || current?.document,
          exam: examRecord || current?.exam,
          status: examRecord ? (failed ? "failed" : "ready") : "processing",
          stage: examRecord ? (failed ? "Sınav kaydı hata durumunda" : "Sınav kaydı oluşturuldu") : "Doküman kaydı oluşturuldu",
        }));
      }

      if (examRecord) {
        return { document: documentRecord, exam: examRecord };
      }

      await delay(2000);
    }

    return { document: null, exam: null };
  }

  async function submitAppDocument(event) {
    event.preventDefault();
    if (!session?.token) return;
    if (!selectedFile) {
      setError("PDF veya DOCX dosyasi secilmeden dokuman gonderilemez.");
      return;
    }

    const fileName = selectedFile.name;
    const documentId = `app-${compactTimestamp(new Date())}`;
    const payload = {
      documentId,
      fileName,
      fileSize: selectedFile.size,
      contentType: selectedFile.type || "application/octet-stream",
      source: source.trim() || "app-dashboard",
    };
    const formData = new FormData();
    formData.append("documentId", documentId);
    formData.append("source", payload.source);
    formData.append("file", selectedFile);
    formData.append("questionCount", String(questionCount));
    formData.append("difficulty", difficulty);
    formData.append("infoCardCount", String(infoCardCount));
    if (focus.trim()) formData.append("focus", focus.trim());

    setBusy("publish");
    setError("");
    setProcessNotice("");
    setLastProcess({
      documentId,
      fileName,
      payload,
      status: "running",
      stage: "API Service isteği alıyor",
      startedAt: new Date().toISOString(),
    });

    try {
      const publish = await appRequest("/publish", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.token}`,
        },
        body: formData,
      });

      setLastProcess((current) => ({
        ...current,
        response: publish,
        status: "processing",
        stage: "Event Pub/Sub kuyruğuna gönderildi",
      }));

      const result = await waitForAppExamRecord(session.token, documentId);
      if (result.exam) {
        const failed = isFailedExamRecord(result.exam);
        setProcessNotice(failed ? "Sınav kaydı hata durumunda arşive düştü." : "Doküman işlendi ve sınav kaydı arşive düştü.");
        setLastProcess((current) => ({
          ...current,
          document: result.document || current?.document,
          exam: result.exam,
          status: failed ? "failed" : "ready",
          stage: failed ? "Sınav kaydı hata durumunda" : "Sonuçlar görüntülenebilir",
          finishedAt: new Date().toISOString(),
        }));
      } else {
        setProcessNotice("İstek alındı; arka plan servisleri sonucu üretmeye devam ediyor olabilir. Arşivi yenileyerek tekrar kontrol edebilirsin.");
        setLastProcess((current) => ({
          ...current,
          status: "processing",
          stage: "Sonuç bekleniyor",
        }));
      }
    } catch (err) {
      setError(err.message);
      setLastProcess((current) => ({
        ...current,
        status: "failed",
        stage: "İşlem başarısız",
        error: err.message,
      }));
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
    setActivities([]);
    setLastProcess(null);
    setProcessNotice("");
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

  useEffect(() => {
    if (!session?.token || lastProcess?.status !== "processing") return undefined;

    const intervalId = window.setInterval(() => {
      loadArchive(session.token, { silent: true });
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [session?.token, lastProcess?.status, lastProcess?.documentId, lastProcess?.payload?.documentId]);

  if (!session?.token) {
    return (
      <main className="app-auth-shell">
        <AuthPanel busy={busy} error={error} onSubmit={handleAuth} />
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
            <h1 className="truncate text-lg font-black text-ink">Kullanıcı alanı</h1>
          </div>
        </div>

        <nav className="mt-8 grid gap-2" aria-label="Uygulama menüsü">
          {appNav.map((item) => (
            <AppNavItem key={item.to} item={item} />
          ))}
        </nav>

        <div className="mt-auto rounded-lg border border-space-line bg-black/25 p-4">
          <p className="label">Giriş yapan kullanıcı</p>
          <p className="mt-1 truncate text-sm font-bold text-ink">{session.user?.displayName || session.email}</p>
          <button className="btn btn-secondary mt-4 w-full" type="button" onClick={logout}>
            <User className="h-4 w-4" />
            Çıkış yap
          </button>
        </div>
      </aside>

      <section className="app-main">
        <header className="app-topbar">
          <div>
            <p className="label">Authenticated frontend</p>
            <h2 className="text-2xl font-black text-ink">ExamFlow kullanıcı paneli</h2>
          </div>
          <button className="btn btn-secondary" type="button" onClick={() => loadArchive()} disabled={busy === "archive"}>
            {busy === "archive" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Arşivi yenile
          </button>
        </header>

        {error ? <Alert tone="failed" message={error} /> : null}

        <Routes>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route
            path="dashboard"
            element={
              <AppOverview
                busy={busy}
                documents={documents}
                exams={exams}
                health={health}
                lastProcess={lastProcess}
                onSubmitDocument={submitAppDocument}
                processNotice={processNotice}
                ready={ready}
                selectedFile={selectedFile}
                setSelectedFile={setSelectedFile}
                setSource={setSource}
                source={source}
                questionCount={questionCount}
                setQuestionCount={setQuestionCount}
                difficulty={difficulty}
                setDifficulty={setDifficulty}
                infoCardCount={infoCardCount}
                setInfoCardCount={setInfoCardCount}
                focus={focus}
                setFocus={setFocus}
              />
            }
          />
          <Route path="documents" element={<DocumentArchivePage busy={busy} documents={documents} />} />
          <Route path="documents/:documentId" element={<DocumentDetailPage documents={documents} exams={exams} />} />
          <Route path="exams" element={<ExamArchivePage busy={busy} exams={exams} />} />
          <Route path="exams/:examKey" element={<ExamDetailPage exams={exams} />} />
          <Route path="activity" element={<ActivityWorkspace activities={activities} />} />
          <Route path="*" element={<Navigate to="dashboard" replace />} />
        </Routes>
      </section>
    </main>
  );
}

function AuthPanel({ busy, error, onSubmit }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("demo@examflow.local");
  const [displayName, setDisplayName] = useState("Demo Kullanıcısı");
  const [password, setPassword] = useState(demoPassword);

  function submit(event) {
    event.preventDefault();
    onSubmit({ mode, email, displayName, password });
  }

  return (
    <section className="auth-card">
      <div className="brand-mark">E</div>
      <p className="label mt-4">ExamFlow App</p>
      <h1 className="mt-2 text-2xl font-black text-ink">Akıllı sınav arşivine giriş yap.</h1>
      <p className="mt-2 text-sm leading-6 text-muted">
        Bu ekran, kullanıcı girişi yapılan ürün deneyiminin başlangıcıdır. Giriş yaptıktan sonra doküman ve sınav kayıtları aynı panelden izlenir.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-space-line bg-black/20 p-1">
        <button className={`segmented-btn ${mode === "login" ? "active" : ""}`} type="button" onClick={() => setMode("login")}>
          Giriş yap
        </button>
        <button className={`segmented-btn ${mode === "register" ? "active" : ""}`} type="button" onClick={() => setMode("register")}>
          Kayıt ol
        </button>
      </div>

      <form className="mt-4 grid gap-3" onSubmit={submit}>
        <label>
          <span className="label">Email</span>
          <input className="field mt-1" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        {mode === "register" ? (
          <label>
            <span className="label">Görünen ad</span>
            <input className="field mt-1" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
        ) : null}
        <label>
          <span className="label">Şifre</span>
          <input className="field mt-1" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy === "auth"}>
          {busy === "auth" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          {mode === "login" ? "Kullanıcı paneline gir" : "Kayıt ol ve panele gir"}
        </button>
      </form>

      {error ? <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p> : null}
    </section>
  );
}

function AuthAside({ busy, health, onRefresh, ready }) {
  return (
    <section className="auth-aside panel glass-grid p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="label">Canlı sistem</p>
          <h2 className="section-title">Backend bağlantısı</h2>
        </div>
        <button className="btn btn-secondary" type="button" onClick={onRefresh} disabled={busy === "status"}>
          {busy === "status" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Durumu yenile
        </button>
      </div>
      <div className="mt-5 grid gap-3">
        <HealthRow label="/health" value={displayStatus(health?.status || "pending")} tone={health?.status} />
        <HealthRow label="/ready" value={displayStatus(ready?.status || "pending")} tone={ready?.status} />
        <HealthRow label="database" value={displayStatus(ready?.databaseStatus || "unknown")} tone={ready?.databaseStatus === "ready" ? "ok" : ready?.status} />
      </div>
      <div className="mt-5 rounded-lg border border-neon-cyan/30 bg-neon-cyan/10 p-4">
        <p className="text-sm font-bold text-ink">Sonraki ekranlar</p>
        <p className="mt-2 text-sm leading-6 text-muted">Document detail, exam detail, favorites ve tag ekranları bu kullanıcı panelinin üzerine adım adım eklenecek.</p>
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

function AppOverview({
  busy,
  documents,
  exams,
  health,
  lastProcess,
  onSubmitDocument,
  processNotice,
  ready,
  selectedFile,
  setSelectedFile,
  setSource,
  source,
  questionCount,
  setQuestionCount,
  difficulty,
  setDifficulty,
  infoCardCount,
  setInfoCardCount,
  focus,
  setFocus,
}) {
  const recentDocuments = sortRecordsByDate(documents);
  const recentExams = sortRecordsByDate(exams);
  const latestDocument = recentDocuments[0];
  const latestExam = recentExams[0];
  const lastStatus = lastProcess?.status || latestExam?.status || latestDocument?.status || "waiting";

  return (
    <div className="grid gap-5">
      <section className="app-hero">
        <div>
          <p className="label">Genel bakış</p>
          <h3 className="mt-2 text-3xl font-black text-ink">Doküman yükle, event akışını başlat, oluşan sınavı aynı ekranda izle.</h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
            Bu panel, giriş yapan kullanıcının arşivini ve son işlem sonucunu canlı API üzerinden okur. Ana akış hâlâ API Service, Pub/Sub,
            Worker Service, Validation Service, Exam Service ve MongoDB hattı üzerinden ilerler.
          </p>
        </div>
        <Badge tone={ready?.databaseStatus === "ready" ? "ok" : ready?.status}>MongoDB {displayStatus(ready?.databaseStatus || "unknown")}</Badge>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <InsightCard icon={FileText} title="Toplam doküman" value={documents.length} tone="ok" detail={latestDocument?.fileName || "Henüz kayıt yok"} />
        <InsightCard icon={ClipboardList} title="Toplam sınav" value={exams.length} tone="ready" detail={latestExam?.title || latestExam?.documentId || "Henüz kayıt yok"} />
        <InsightCard icon={Activity} title="Son işlem" value={displayStatus(lastStatus)} tone={lastStatus} detail={lastProcess?.stage || "Yeni doküman bekleniyor"} />
        <InsightCard icon={Database} title="Database" value={displayStatus(ready?.databaseStatus || "unknown")} tone={ready?.databaseStatus === "ready" ? "ok" : ready?.status} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(320px,0.95fr)_minmax(420px,1.05fr)]">
        <DashboardPublishPanel
          busy={busy}
          difficulty={difficulty}
          focus={focus}
          infoCardCount={infoCardCount}
          onSubmit={onSubmitDocument}
          questionCount={questionCount}
          selectedFile={selectedFile}
          setDifficulty={setDifficulty}
          setFocus={setFocus}
          setInfoCardCount={setInfoCardCount}
          setQuestionCount={setQuestionCount}
          setSelectedFile={setSelectedFile}
          setSource={setSource}
          source={source}
        />
        <DashboardResultPanel lastProcess={lastProcess} latestDocument={latestDocument} latestExam={latestExam} notice={processNotice} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <WorkspaceRecords title="Son yüklenen dokümanlar" records={recentDocuments.slice(0, 4)} empty="Henüz doküman kaydı yok." />
        <WorkspaceRecords title="Son oluşturulan sınavlar" records={recentExams.slice(0, 4)} empty="Henüz sınav kaydı yok." />
      </div>
    </div>
  );
}

function DashboardPublishPanel({
  busy,
  difficulty,
  focus,
  infoCardCount,
  onSubmit,
  questionCount,
  selectedFile,
  setDifficulty,
  setFocus,
  setInfoCardCount,
  setQuestionCount,
  setSelectedFile,
  setSource,
  source,
}) {
  const isPublishing = busy === "publish";

  return (
    <section className="panel glass-grid p-5">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="label">Yeni işlem</p>
          <h3 className="section-title">Doküman gönderimi</h3>
          <p className="mt-2 text-sm leading-6 text-muted">Dosya adını ve kaynağını API’ye iletir; backend bu isteği Pub/Sub tabanlı sınav üretim akışına alır.</p>
        </div>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan">
          <FileUp className="h-5 w-5" />
        </div>
      </div>

      <form className="grid gap-4" onSubmit={onSubmit}>
        <label className="block">
          <span className="label">Doküman dosyası</span>
          <input
            className="field mt-1 h-auto cursor-pointer py-2 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-sm file:font-bold file:text-ink hover:file:bg-neon-cyan/20"
            type="file"
            accept=".pdf,.docx"
            onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
          />
        </label>

        <label className="block">
          <span className="label">Kaynak etiketi</span>
          <input className="field mt-1" value={source} onChange={(event) => setSource(event.target.value)} placeholder="app-dashboard" />
        </label>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="label">Soru sayısı</span>
            <input
              className="field mt-1"
              type="number"
              min={1}
              max={20}
              value={questionCount}
              onChange={(event) => setQuestionCount(Number(event.target.value))}
            />
          </label>
          <label className="block">
            <span className="label">Zorluk</span>
            <select className="field mt-1" value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
              <option value="mixed">Karışık</option>
              <option value="easy">Kolay</option>
              <option value="medium">Orta</option>
              <option value="hard">Zor</option>
            </select>
          </label>
          <label className="block">
            <span className="label">Bilgi kartı sayısı</span>
            <input
              className="field mt-1"
              type="number"
              min={0}
              max={10}
              value={infoCardCount}
              onChange={(event) => setInfoCardCount(Number(event.target.value))}
            />
          </label>
        </div>

        <label className="block">
          <span className="label">Odak / talimat (opsiyonel)</span>
          <input
            className="field mt-1"
            value={focus}
            onChange={(event) => setFocus(event.target.value)}
            placeholder="örn. yalnızca hücre bölünmesi konusuna odaklan"
          />
        </label>

        <div className="rounded-lg border border-space-line bg-black/25 p-4">
          <p className="text-sm font-bold text-ink">{selectedFile?.name || "PDF veya DOCX dosyasi sec"}</p>
          <p className="mt-1 text-xs leading-5 text-muted">Backend dosyayi multipart olarak alir; uzanti, boyut ve icerik tipi metadata olarak kaydedilir. Akis sonucu dokuman ve sinav arsivinden takip edilir.</p>
        </div>

        <button className="btn btn-primary w-full" type="submit" disabled={isPublishing || !selectedFile}>
          {isPublishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
          {isPublishing ? "Akış izleniyor" : "Dokümanı işle ve sonucu getir"}
        </button>
      </form>
    </section>
  );
}

function DashboardResultPanel({ lastProcess, latestDocument, latestExam, notice }) {
  const documentRecord = lastProcess?.document || latestDocument;
  const examRecord = lastProcess?.exam || latestExam;
  const status = lastProcess?.status || (examRecord ? "ready" : "waiting");

  return (
    <section className="panel p-5">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="label">Sonuç ekranı</p>
          <h3 className="section-title">Son işlem sonucu</h3>
          <p className="mt-2 text-sm leading-6 text-muted">Gönderilen dokümanın MongoDB’deki karşılığını ve üretildiyse sınav kaydını burada görürsün.</p>
        </div>
        <Badge tone={status}>{displayStatus(status)}</Badge>
      </div>

      {notice ? <Alert tone={status === "ready" ? "ok" : "pending"} message={notice} /> : null}
      {lastProcess?.error ? <Alert tone="failed" message={lastProcess.error} /> : null}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <ResultRecordCard fallback="Henüz doküman sonucu yok." icon={FileText} label="Doküman kaydı" record={documentRecord} title={documentRecord?.fileName || lastProcess?.fileName} />
        <ResultRecordCard fallback="Henüz sınav sonucu yok." icon={ClipboardList} label="Sınav kaydı" record={examRecord} title={examRecord?.title || examRecord?.documentId} />
      </div>

      {lastProcess?.payload ? (
        <div className="mt-4 rounded-lg border border-space-line bg-black/30 p-4">
          <p className="label">Gönderilen payload</p>
          <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-muted">{JSON.stringify(lastProcess.payload, null, 2)}</pre>
        </div>
      ) : null}
    </section>
  );
}

function ResultRecordCard({ fallback, icon: Icon, label, record, title }) {
  return (
    <article className="rounded-lg border border-space-line bg-black/25 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="label">{label}</p>
          <p className="mt-1 break-words text-sm font-bold text-ink">{title || fallback}</p>
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${toneClass(record ? "ok" : "idle")}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {record ? (
        <div className="grid gap-2 text-xs text-muted">
          <p>
            <span className="font-bold text-ink">documentId:</span> {record.documentId || record.id || "-"}
          </p>
          <p>
            <span className="font-bold text-ink">Durum:</span> {displayStatus(record.status || "recorded")}
          </p>
          <p>
            <span className="font-bold text-ink">Tarih:</span> {parseRecordDate(record.updatedAt || record.createdAt)}
          </p>
        </div>
      ) : (
        <p className="text-xs leading-5 text-muted">Yeni bir doküman gönderdiğinde sonuçlar burada görünecek.</p>
      )}
    </article>
  );
}

function InsightCard({ detail, icon: Icon, title, value, tone }) {
  return (
    <article className="panel p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="label">{title}</p>
          <p className="mt-3 text-2xl font-black text-ink">{value}</p>
          {detail ? <p className="mt-1 truncate text-xs text-muted">{detail}</p> : null}
        </div>
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border ${toneClass(tone)}`}>
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
          <p className="label">Arşiv</p>
          <h3 className="section-title">{title}</h3>
        </div>
        <Badge tone={records.length ? "ok" : "idle"}>{records.length} kayıt</Badge>
      </div>
      <ArchiveList records={records} empty={empty} />
    </section>
  );
}

function ActivityWorkspace({ activities }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const terminalStatusByDocument = useMemo(() => {
    const statuses = new Map();
    for (const event of activities) {
      if (!event.documentId) continue;
      const status = String(event.status || "").toLowerCase();
      if (status === "failed") statuses.set(event.documentId, "failed");
      if (status === "validated" && statuses.get(event.documentId) !== "failed") statuses.set(event.documentId, "validated");
    }
    return statuses;
  }, [activities]);
  const events = useMemo(
    () =>
      sortRecordsByDate(activities).map((event) => {
        const displayStatusValue = resolveActivityDisplayStatus(event, terminalStatusByDocument);
        return {
          ...event,
          displayStatus: displayStatusValue,
          displayMessage: resolveActivityDisplayMessage(event, displayStatusValue, terminalStatusByDocument),
        };
      }),
    [activities, terminalStatusByDocument],
  );
  const statusOptions = useMemo(() => Array.from(new Set(events.map((event) => event.displayStatus).filter(Boolean))).sort(), [events]);
  const filteredEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return events.filter((event) => {
      const searchable = [event.documentId, event.eventId, event.eventType, event.displayStatus, event.service, event.displayMessage, event.error].filter(Boolean).join(" ").toLowerCase();
      const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
      const matchesStatus = statusFilter === "all" || event.displayStatus === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [events, query, statusFilter]);

  return (
    <div className="grid gap-5">
      <section className="app-hero">
        <div>
          <p className="label">Activity</p>
          <h3 className="mt-2 text-3xl font-black text-ink">İşlem geçmişi</h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
            API, Worker, Validation ve Exam servislerinden gelen kalıcı event kayıtları documentId üzerinden izlenir.
          </p>
        </div>
        <Badge tone={activities.length ? "ok" : "idle"}>{activities.length} olay</Badge>
      </section>

      <section className="panel p-5">
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="label">Arama ve filtreler</p>
            <h3 className="section-title">Event geçmişi</h3>
          </div>
          <Badge tone={filteredEvents.length ? "ok" : "idle"}>{filteredEvents.length} sonuç</Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
          <label>
            <span className="label">documentId, event veya hata ara</span>
            <input className="field mt-1" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="örn. app-2026, validation, failed" />
          </label>
          <label>
            <span className="label">Durum</span>
            <select className="field mt-1" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">Tüm durumlar</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {displayStatus(status)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {filteredEvents.length ? (
          <div className="mt-5 grid gap-3">
            {filteredEvents.map((event) => (
              <article key={event.id || `${event.eventId}-${event.eventType}-${event.createdAt}`} className="rounded-lg border border-space-line bg-black/25 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold text-ink">{event.eventType || "activity.event"}</p>
                      <Badge tone={event.displayStatus}>{displayStatus(event.displayStatus || "recorded")}</Badge>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted">{event.displayMessage || readableActivityMessage(event)}</p>
                    {event.error ? <p className="mt-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{readableActivityError(event)}</p> : null}
                    <div className="mt-3 grid gap-2 text-xs text-muted md:grid-cols-2">
                      <p>
                        <span className="font-bold text-ink">documentId:</span> <span className="break-all">{event.documentId || "-"}</span>
                      </p>
                      <p>
                        <span className="font-bold text-ink">Servis:</span> {event.service || "-"}
                      </p>
                      <p>
                        <span className="font-bold text-ink">eventId:</span> <span className="break-all">{event.eventId || "-"}</span>
                      </p>
                      <p>
                        <span className="font-bold text-ink">Tarih:</span> {parseRecordDate(event.createdAt)}
                      </p>
                    </div>
                  </div>
                  {event.documentId ? (
                    <Link className="btn btn-secondary shrink-0" to={`/app/documents/${encodeURIComponent(event.documentId)}`}>
                      <FileText className="h-4 w-4" />
                      Dokümana git
                    </Link>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-5 text-sm text-muted">Henüz işlem geçmişi yok.</p>
        )}
      </section>
    </div>
  );
}

function isFailedExamRecord(exam) {
  const status = String(exam?.status || exam?.validationResult || "").toLowerCase();
  return ["failed", "invalid", "error"].includes(status);
}

function resolveActivityDisplayStatus(event, terminalStatusByDocument) {
  const status = String(event.status || "").toLowerCase();
  if (status === "processing" && event.documentId) {
    const terminal = terminalStatusByDocument.get(event.documentId);
    if (terminal === "failed") return "failed";
    if (terminal === "validated") return "processed";
  }
  return event.status;
}

function resolveActivityDisplayMessage(event, displayStatusValue, terminalStatusByDocument) {
  const status = String(event.status || "").toLowerCase();
  const terminal = event.documentId ? terminalStatusByDocument.get(event.documentId) : "";
  if (status === "processing" && terminal === "validated") {
    return "Bu adım sonraki event ile tamamlandı.";
  }
  if (status === "processing" && terminal === "failed") {
    return "Bu adım sonrasında akış hata durumuna geçti.";
  }
  return event.message || readableActivityMessage({ ...event, status: displayStatusValue });
}

function readableActivityMessage(event) {
  if (event.status === "received") return "Doküman backend tarafından alındı.";
  if (event.status === "published") return "Event Pub/Sub hattına yayınlandı.";
  if (event.status === "processing") return "Arka plan servisi işlemi sürdürüyor.";
  if (event.status === "processed") return "Doküman işleme adımı tamamlandı.";
  if (event.status === "validated") return "Doğrulama ve sınav kaydı tamamlandı.";
  if (event.status === "failed") return "İşlem sırasında hata oluştu.";
  return "Activity kaydı oluşturuldu.";
}

function readableActivityError(event) {
  return event.error || "İşlem sırasında hata oluştu.";
}
