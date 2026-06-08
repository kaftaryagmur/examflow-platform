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
  Trash2,
  User,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";

import { ArchiveList } from "../../components/archive";
import { Alert, Badge } from "../../components/status";
import {
  appNav,
  defaultBaseUrl,
  demoPassword,
  sessionKey,
} from "../../config/appConfig";
import { DocumentArchivePage, DocumentDetailPage } from "../documents";
import { ExamArchivePage, ExamDetailPage } from "../exams";
import { parseResponse, responseMessage } from "../../utils/api";
import {
  compactTimestamp,
  delay,
  displayStatus,
  parseRecordDate,
  sortRecordsByDate,
  toneClass,
} from "../../utils/format";
import { readStoredSession } from "../../utils/session";

const markLogoSrc = "/assets/logo2.png";

export function LoginPage() {
  const apiBaseUrl = defaultBaseUrl;
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = location.state?.from?.pathname || "/app/dashboard";

  function apiPath(path) {
    return `${apiBaseUrl.replace(/\/+$/, "")}${path}`;
  }

  async function authRequest(path, options = {}) {
    const response = await fetch(apiPath(path), options);
    const parsed = await parseResponse(response);
    if (!parsed.ok) {
      throw new Error(
        responseMessage(
          options.method || "GET",
          path,
          parsed.status,
          parsed.body,
          apiBaseUrl,
        ),
      );
    }
    return parsed.body;
  }

  async function handleAuth(values) {
    setBusy("auth");
    setError("");
    try {
      if (values.mode === "register") {
        await authRequest("/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: values.email,
            displayName: values.displayName || "ExamFlow User",
            password: values.password,
          }),
        });
      }

      const login = await authRequest("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: values.email,
          password: values.password,
        }),
      });
      const nextSession = {
        email: values.email,
        token: login.token,
        user: login.user,
      };
      window.localStorage.setItem(sessionKey, JSON.stringify(nextSession));
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    if (readStoredSession()?.token) {
      navigate(redirectTo, { replace: true });
      return;
    }
  }, []);

  return (
    <main className="login-shell">
      <AuthPanel busy={busy} error={error} onSubmit={handleAuth} />
    </main>
  );
}

export function ProductApp() {
  const apiBaseUrl = defaultBaseUrl;
  const [session, setSession] = useState(readStoredSession);
  const [health, setHealth] = useState(null);
  const [ready, setReady] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [exams, setExams] = useState([]);
  const [activities, setActivities] = useState([]);
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminDocuments, setAdminDocuments] = useState([]);
  const [adminExams, setAdminExams] = useState([]);
  const [adminActivities, setAdminActivities] = useState([]);
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
  const isAdmin = isAdminSession(session);

  function apiPath(path) {
    return `${apiBaseUrl.replace(/\/+$/, "")}${path}`;
  }

  async function appRequest(path, options = {}) {
    const response = await fetch(apiPath(path), options);
    const parsed = await parseResponse(response);
    if (!parsed.ok) {
      throw new Error(
        responseMessage(
          options.method || "GET",
          path,
          parsed.status,
          parsed.body,
          apiBaseUrl,
        ),
      );
    }
    return parsed.body;
  }

  function syncLastProcessFromArchive(nextDocuments, nextExams) {
    setLastProcess((current) => {
      const activeDocumentId =
        current?.documentId || current?.payload?.documentId;
      if (!activeDocumentId) return current;

      const documentRecord = nextDocuments.find(
        (item) => item.documentId === activeDocumentId,
      );
      const examRecord = nextExams.find(
        (item) => item.documentId === activeDocumentId,
      );
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
        stage: failed
          ? "Sınav kaydı hata durumunda"
          : "Sonuçlar görüntülenebilir",
        finishedAt: current?.finishedAt || new Date().toISOString(),
      };
    });
  }

  async function refreshStatus() {
    setBusy("status");
    setError("");
    try {
      const [healthBody, readyBody] = await Promise.all([
        appRequest("/health"),
        appRequest("/ready"),
      ]);
      setHealth(healthBody);
      setReady(readyBody);
    } catch (err) {
      setHealth({
        status: "error",
        service: "api-service",
        mode: "unreachable",
      });
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
      return {
        documents: nextDocuments,
        exams: nextExams,
        activities: nextActivities,
      };
    } catch (err) {
      setError(err.message);
      return { documents: [], exams: [], activities: [] };
    } finally {
      if (!options.silent) {
        setBusy("");
      }
    }
  }

  async function updateRecordMetadata(type, recordKey, metadata) {
    if (!session?.token || !recordKey) return false;
    const path = `/${type === "exam" ? "exams" : "documents"}/${encodeURIComponent(recordKey)}/metadata`;
    setBusy(`metadata-${type}-${recordKey}`);
    setError("");
    try {
      await appRequest(path, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(metadata),
      });
      await loadArchive(session.token, { silent: true });
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy("");
    }
  }

  async function waitForAppExamRecord(token, documentId) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const archive = await loadArchive(token, { silent: true });
      const documentRecord = archive.documents.find(
        (item) => item.documentId === documentId,
      );
      const examRecord = archive.exams.find(
        (item) => item.documentId === documentId,
      );
      const failed = isFailedExamRecord(examRecord);

      if (documentRecord || examRecord) {
        setLastProcess((current) => ({
          ...current,
          document: documentRecord || current?.document,
          exam: examRecord || current?.exam,
          status: examRecord ? (failed ? "failed" : "ready") : "processing",
          stage: examRecord
            ? failed
              ? "Sınav kaydı hata durumunda"
              : "Sınav kaydı oluşturuldu"
            : "Doküman kaydı oluşturuldu",
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
        setProcessNotice(
          failed
            ? "Sınav kaydı hata durumunda arşive düştü."
            : "Doküman işlendi ve sınav kaydı arşive düştü.",
        );
        setLastProcess((current) => ({
          ...current,
          document: result.document || current?.document,
          exam: result.exam,
          status: failed ? "failed" : "ready",
          stage: failed
            ? "Sınav kaydı hata durumunda"
            : "Sonuçlar görüntülenebilir",
          finishedAt: new Date().toISOString(),
        }));
      } else {
        setProcessNotice(
          "İstek alındı; arka plan servisleri sonucu üretmeye devam ediyor olabilir. Arşivi yenileyerek tekrar kontrol edebilirsin.",
        );
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

  function logout() {
    window.localStorage.removeItem(sessionKey);
    setSession(null);
    setDocuments([]);
    setExams([]);
    setActivities([]);
    setAdminUsers([]);
    setAdminDocuments([]);
    setAdminExams([]);
    setAdminActivities([]);
    setLastProcess(null);
    setProcessNotice("");
    navigate("/login", { replace: true });
  }

  async function loadAdminWorkspace(token = session?.token) {
    if (!token || !isAdmin) return [];
    setBusy("admin-data");
    setError("");
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [userBody, documentBody, examBody, activityBody] =
        await Promise.all([
          appRequest("/admin/users", { headers }),
          appRequest("/admin/documents", { headers }),
          appRequest("/admin/exams", { headers }),
          appRequest("/admin/activity", { headers }),
        ]);
      const nextUsers = userBody.users || [];
      const nextDocuments = documentBody.documents || [];
      const nextExams = examBody.exams || [];
      const nextActivities = activityBody.activities || [];
      setAdminUsers(nextUsers);
      setAdminDocuments(nextDocuments);
      setAdminExams(nextExams);
      setAdminActivities(nextActivities);
      return {
        users: nextUsers,
        documents: nextDocuments,
        exams: nextExams,
        activities: nextActivities,
      };
    } catch (err) {
      setError(err.message);
      return { users: [], documents: [], exams: [], activities: [] };
    } finally {
      setBusy("");
    }
  }

  async function createAdminUser(values) {
    if (!session?.token || !isAdmin) return false;
    setBusy("admin-create-user");
    setError("");
    try {
      await appRequest("/admin/users", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(values),
      });
      await loadAdminWorkspace(session.token);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy("");
    }
  }

  async function deleteAdminUser(userId) {
    if (!session?.token || !isAdmin || !userId) return false;
    setBusy(`admin-delete-user-${userId}`);
    setError("");
    try {
      await appRequest(`/admin/users/${encodeURIComponent(userId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.token}` },
      });
      await loadAdminWorkspace(session.token);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy("");
    }
  }

  async function updateProfile(values) {
    setBusy("profile");
    setError("");
    try {
      const body = await appRequest("/auth/me", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(values),
      });
      const nextSession = {
        email: body.user.email,
        token: body.token || session.token,
        user: body.user,
      };
      setSession(nextSession);
      window.localStorage.setItem(sessionKey, JSON.stringify(nextSession));
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    refreshStatus();
  }, []);

  useEffect(() => {
    if (session?.token) {
      loadArchive(session.token);
      if (isAdminSession(session)) {
        loadAdminWorkspace(session.token);
      }
    }
  }, [session?.token]);

  useEffect(() => {
    if (!session?.token || lastProcess?.status !== "processing")
      return undefined;

    const intervalId = window.setInterval(() => {
      loadArchive(session.token, { silent: true });
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [
    session?.token,
    lastProcess?.status,
    lastProcess?.documentId,
    lastProcess?.payload?.documentId,
  ]);

  if (!session?.token) {
    return <Navigate to="/login" replace />;
  }

  return (
    <main className="app-shell">
      <aside className="app-sidebar">
        <div className="flex items-center gap-3">
          <img className="brand-logo" src={markLogoSrc} alt="ExamFlow logo" />
          <div className="min-w-0">
            <p className="label">ExamFlow</p>
            <h1 className="truncate text-lg font-black text-ink">
              Kontrol Paneli
            </h1>
          </div>
        </div>

        <nav className="mt-8 grid gap-2" aria-label="Uygulama menüsü">
          {appNav
            .filter((item) => item.to !== "/app/admin" || isAdmin)
            .map((item) => (
              <AppNavItem key={item.to} item={item} />
            ))}
        </nav>
      </aside>

      <section className="app-main">
        <header className="app-topbar">
          <div className="self-start">
            <h2 className="text-2xl font-black text-ink">
              ExamFlow Kullanıcı Paneli
            </h2>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => loadArchive()}
              disabled={busy === "archive"}
            >
              {busy === "archive" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Arşivi yenile
            </button>
            <div className="flex min-w-[320px] items-center gap-4 rounded-lg border border-space-line bg-black/25 px-4 py-3">
              <div className="min-w-0">
                <p className="label">Giriş yapan kullanıcı</p>
                <p className="mt-1 truncate text-sm font-bold text-ink">
                  {session.user?.displayName || session.email}
                </p>
              </div>
              <button
                className="btn btn-secondary ml-auto"
                type="button"
                onClick={() => navigate("/app/profile")}
              >
                <User className="h-4 w-4" />
                Profil
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={logout}
              >
                <User className="h-4 w-4" />
                Çıkış yap
              </button>
            </div>
          </div>
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
          <Route
            path="documents"
            element={<DocumentArchivePage busy={busy} documents={documents} onUpdateMetadata={(recordKey, metadata) => updateRecordMetadata("document", recordKey, metadata)} />}
          />
          <Route
            path="documents/:documentId"
            element={
              <DocumentDetailPage
                activities={activities}
                busy={busy}
                documents={documents}
                exams={exams}
                onUpdateMetadata={(recordKey, metadata) => updateRecordMetadata("document", recordKey, metadata)}
              />
            }
          />
          <Route
            path="exams"
            element={<ExamArchivePage busy={busy} exams={exams} onUpdateMetadata={(recordKey, metadata) => updateRecordMetadata("exam", recordKey, metadata)} />}
          />
          <Route
            path="exams/:examKey"
            element={<ExamDetailPage busy={busy} exams={exams} onUpdateMetadata={(recordKey, metadata) => updateRecordMetadata("exam", recordKey, metadata)} />}
          />
          <Route
            path="profile"
            element={
              <ProfileWorkspace
                busy={busy}
                onSubmit={updateProfile}
                session={session}
              />
            }
          />
          <Route
            path="admin"
            element={
              isAdmin ? (
                <AdminWorkspace
                  activities={activities}
                  adminActivities={adminActivities}
                  adminDocuments={adminDocuments}
                  adminExams={adminExams}
                  busy={busy}
                  documents={documents}
                  exams={exams}
                  health={health}
                  onCreateUser={createAdminUser}
                  onDeleteUser={deleteAdminUser}
                  onRefresh={() => loadAdminWorkspace()}
                  ready={ready}
                  session={session}
                  users={adminUsers}
                />
              ) : (
                <Navigate to="/app/dashboard" replace />
              )
            }
          />
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
      <div className="flex items-center gap-3">
        <img className="brand-logo" src={markLogoSrc} alt="ExamFlow logo" />
        <div>
          <p className="label">ExamFlow</p>
          <h1 className="text-xl font-black text-ink">Hesabına giriş yap</h1>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-space-line bg-black/20 p-1">
        <button
          className={`segmented-btn ${mode === "login" ? "active" : ""}`}
          type="button"
          onClick={() => setMode("login")}
        >
          Giriş yap
        </button>
        <button
          className={`segmented-btn ${mode === "register" ? "active" : ""}`}
          type="button"
          onClick={() => setMode("register")}
        >
          Kayıt ol
        </button>
      </div>

      <form className="mt-4 grid gap-3" onSubmit={submit}>
        <label>
          <span className="label">Email</span>
          <input
            className="field mt-1"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        {mode === "register" ? (
          <label>
            <span className="label">Görünen ad</span>
            <input
              className="field mt-1"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
        ) : null}
        <label>
          <span className="label">Şifre</span>
          <input
            className="field mt-1"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        <button
          className="btn btn-primary"
          type="submit"
          disabled={busy === "auth"}
        >
          {busy === "auth" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ShieldCheck className="h-4 w-4" />
          )}
          {mode === "login" ? "Giriş yap" : "Hesap oluştur"}
        </button>
      </form>

      {error ? (
        <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function AppNavItem({ item }) {
  const Icon = item.icon;
  return (
    <NavLink
      className={({ isActive }) => `app-nav-item ${isActive ? "active" : ""}`}
      to={item.to}
    >
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
  const lastStatus =
    lastProcess?.status ||
    latestExam?.status ||
    latestDocument?.status ||
    "waiting";

  return (
    <div className="grid gap-5">
      <section className="app-hero">
        <div>
          <p className="label">Genel bakış</p>
          <h3 className="mt-2 text-3xl font-black text-ink">
            Doküman yükle, sınavını oluştur, sonucu aynı ekranda izle.
          </h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
            Ders notlarını yükleyerek sınav soruları ve çalışma kartları
            oluşturabilirsin. Geçmiş doküman ve sınavlarına arşivden
            ulaşabilirsin.
          </p>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <InsightCard
          icon={FileText}
          title="Toplam doküman"
          value={documents.length}
          tone="ok"
          detail={latestDocument?.fileName || "Henüz kayıt yok"}
        />
        <InsightCard
          icon={ClipboardList}
          title="Toplam sınav"
          value={exams.length}
          tone="ready"
          detail={
            latestExam?.title || latestExam?.documentId || "Henüz kayıt yok"
          }
        />
        <InsightCard
          icon={Activity}
          title="Son işlem"
          value={displayStatus(lastStatus)}
          tone={lastStatus}
          detail={lastProcess?.stage || "Yeni doküman bekleniyor"}
        />
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
          source={source}
        />
        <DashboardResultPanel
          lastProcess={lastProcess}
          latestDocument={latestDocument}
          latestExam={latestExam}
          notice={processNotice}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <WorkspaceRecords
          title="Son yüklenen dokümanlar"
          records={recentDocuments.slice(0, 4)}
          empty="Henüz doküman kaydı yok."
        />
        <WorkspaceRecords
          title="Son oluşturulan sınavlar"
          records={recentExams.slice(0, 4)}
          empty="Henüz sınav kaydı yok."
        />
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
  source,
}) {
  const isPublishing = busy === "publish";

  return (
    <section className="panel glass-grid p-5">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="label">Yeni işlem</p>
          <h3 className="section-title">Doküman gönderimi</h3>
          <p className="mt-2 text-sm leading-6 text-muted">
            Ders notunu yükle; sistem bu dokümandan sınav soruları ve çalışma
            kartları oluştursun.
          </p>
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
            onChange={(event) =>
              setSelectedFile(event.target.files?.[0] || null)
            }
          />
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
            <select
              className="field mt-1"
              value={difficulty}
              onChange={(event) => setDifficulty(event.target.value)}
            >
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
          <p className="text-sm font-bold text-ink">
            {selectedFile?.name || "PDF veya DOCX dosyasi sec"}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted">
            Yükleme tamamlandığında sonucu bu ekranda ve arşivlerde
            görebilirsin.
          </p>
        </div>

        <button
          className="btn btn-primary w-full"
          type="submit"
          disabled={isPublishing || !selectedFile}
        >
          {isPublishing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Cloud className="h-4 w-4" />
          )}
          {isPublishing ? "Akış izleniyor" : "Dokümanı işle ve sonucu getir"}
        </button>
      </form>
    </section>
  );
}

function DashboardResultPanel({
  lastProcess,
  latestDocument,
  latestExam,
  notice,
}) {
  const documentRecord = lastProcess?.document || latestDocument;
  const examRecord = lastProcess?.exam || latestExam;
  const status = lastProcess?.status || (examRecord ? "ready" : "waiting");

  return (
    <section className="panel p-5">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="label">Sonuç ekranı</p>
          <h3 className="section-title">Son işlem sonucu</h3>
          <p className="mt-2 text-sm leading-6 text-muted">
            Yüklediğin dokümanın işlenme durumunu ve oluşan sınavı burada
            görebilirsin.
          </p>
        </div>
        <Badge tone={status}>{displayStatus(status)}</Badge>
      </div>

      {notice ? (
        <Alert tone={status === "ready" ? "ok" : "pending"} message={notice} />
      ) : null}
      {lastProcess?.error ? (
        <Alert tone="failed" message={lastProcess.error} />
      ) : null}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <ResultRecordCard
          fallback="Henüz doküman sonucu yok."
          icon={FileText}
          label="Doküman kaydı"
          record={documentRecord}
          title={documentRecord?.fileName || lastProcess?.fileName}
        />
        <ResultRecordCard
          fallback="Henüz sınav sonucu yok."
          icon={ClipboardList}
          label="Sınav kaydı"
          record={examRecord}
          title={examRecord?.title || "Oluşturulan sınav"}
        />
      </div>
    </section>
  );
}

function ResultRecordCard({ fallback, icon: Icon, label, record, title }) {
  return (
    <article className="rounded-lg border border-space-line bg-black/25 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="label">{label}</p>
          <p className="mt-1 break-words text-sm font-bold text-ink">
            {title || fallback}
          </p>
        </div>
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${toneClass(record ? "ok" : "idle")}`}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {record ? (
        <div className="grid gap-2 text-xs text-muted">
          <p>
            <span className="font-bold text-ink">Durum:</span>{" "}
            {displayStatus(record.status || "recorded")}
          </p>
          <p>
            <span className="font-bold text-ink">Tarih:</span>{" "}
            {parseRecordDate(record.updatedAt || record.createdAt)}
          </p>
        </div>
      ) : (
        <p className="text-xs leading-5 text-muted">
          Yeni bir doküman gönderdiğinde sonuçlar burada görünecek.
        </p>
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
          {detail ? (
            <p className="mt-1 truncate text-xs text-muted">{detail}</p>
          ) : null}
        </div>
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border ${toneClass(tone)}`}
        >
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
        <Badge tone={records.length ? "ok" : "idle"}>
          {records.length} kayıt
        </Badge>
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
      if (status === "validated" && statuses.get(event.documentId) !== "failed")
        statuses.set(event.documentId, "validated");
    }
    return statuses;
  }, [activities]);
  const events = useMemo(
    () =>
      sortRecordsByDate(activities).map((event) => {
        const displayStatusValue = resolveActivityDisplayStatus(
          event,
          terminalStatusByDocument,
        );
        return {
          ...event,
          displayStatus: displayStatusValue,
          displayMessage: resolveActivityDisplayMessage(
            event,
            displayStatusValue,
            terminalStatusByDocument,
          ),
        };
      }),
    [activities, terminalStatusByDocument],
  );
  const statusOptions = useMemo(
    () =>
      Array.from(
        new Set(events.map((event) => event.displayStatus).filter(Boolean)),
      ).sort(),
    [events],
  );
  const filteredEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return events.filter((event) => {
      const searchable = [
        event.documentId,
        event.eventId,
        event.eventType,
        event.displayStatus,
        event.service,
        event.displayMessage,
        event.error,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesQuery =
        !normalizedQuery || searchable.includes(normalizedQuery);
      const matchesStatus =
        statusFilter === "all" || event.displayStatus === statusFilter;
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
            API, Worker, Validation ve Exam servislerinden gelen kalıcı event
            kayıtları documentId üzerinden izlenir.
          </p>
        </div>
        <Badge tone={activities.length ? "ok" : "idle"}>
          {activities.length} olay
        </Badge>
      </section>

      <section className="panel p-5">
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="label">Arama ve filtreler</p>
            <h3 className="section-title">Event geçmişi</h3>
          </div>
          <Badge tone={filteredEvents.length ? "ok" : "idle"}>
            {filteredEvents.length} sonuç
          </Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
          <label>
            <span className="label">documentId, event veya hata ara</span>
            <input
              className="field mt-1"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="örn. app-2026, validation, failed"
            />
          </label>
          <label>
            <span className="label">Durum</span>
            <select
              className="field mt-1"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
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
              <article
                key={
                  event.id ||
                  `${event.eventId}-${event.eventType}-${event.createdAt}`
                }
                className="rounded-lg border border-space-line bg-black/25 p-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold text-ink">
                        {event.eventType || "activity.event"}
                      </p>
                      <Badge tone={event.displayStatus}>
                        {displayStatus(event.displayStatus || "recorded")}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted">
                      {event.displayMessage || readableActivityMessage(event)}
                    </p>
                    {event.error ? (
                      <p className="mt-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
                        {readableActivityError(event)}
                      </p>
                    ) : null}
                    <div className="mt-3 grid gap-2 text-xs text-muted md:grid-cols-2">
                      <p>
                        <span className="font-bold text-ink">documentId:</span>{" "}
                        <span className="break-all">
                          {event.documentId || "-"}
                        </span>
                      </p>
                      <p>
                        <span className="font-bold text-ink">Servis:</span>{" "}
                        {event.service || "-"}
                      </p>
                      <p>
                        <span className="font-bold text-ink">eventId:</span>{" "}
                        <span className="break-all">
                          {event.eventId || "-"}
                        </span>
                      </p>
                      <p>
                        <span className="font-bold text-ink">Tarih:</span>{" "}
                        {parseRecordDate(event.createdAt)}
                      </p>
                    </div>
                  </div>
                  {event.documentId ? (
                    <Link
                      className="btn btn-secondary shrink-0"
                      to={`/app/documents/${encodeURIComponent(event.documentId)}`}
                    >
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

function ProfileWorkspace({ busy, onSubmit, session }) {
  const [displayName, setDisplayName] = useState(
    session.user?.displayName || "",
  );
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event) {
    event.preventDefault();
    setNotice("");
    const ok = await onSubmit({
      displayName,
      currentPassword,
      newPassword,
    });
    if (ok) {
      setCurrentPassword("");
      setNewPassword("");
      setNotice("Profil bilgileri güncellendi.");
    }
  }

  return (
    <div className="grid gap-5">
      <section className="app-hero">
        <div>
          <p className="label">Profil</p>
          <h3 className="mt-2 text-3xl font-black text-ink">Hesap bilgileri</h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
            Adını ve şifreni buradan güncelleyebilirsin.
          </p>
        </div>
        <Badge tone="ok">{session.user?.status || "active"}</Badge>
      </section>

      {notice ? <Alert tone="ok" message={notice} /> : null}

      <section className="panel p-5">
        <form className="grid max-w-xl gap-4" onSubmit={submit}>
          <label>
            <span className="label">Email</span>
            <input className="field mt-1" disabled value={session.email} />
          </label>
          <label>
            <span className="label">Görünen ad</span>
            <input
              className="field mt-1"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
            />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label>
              <span className="label">Mevcut şifre</span>
              <input
                className="field mt-1"
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label>
              <span className="label">Yeni şifre</span>
              <input
                className="field mt-1"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
          </div>
          <button
            className="btn btn-primary w-fit"
            type="submit"
            disabled={busy === "profile"}
          >
            {busy === "profile" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            Profili güncelle
          </button>
        </form>
      </section>
    </div>
  );
}

function AdminWorkspace({
  adminActivities,
  adminDocuments,
  adminExams,
  busy,
  health,
  onCreateUser,
  onDeleteUser,
  onRefresh,
  ready,
  session,
  users,
}) {
  const [activeTab, setActiveTab] = useState("documents");
  const tabs = [
    { id: "users", label: "Kullanıcılar", count: users.length },
    { id: "documents", label: "Dokümanlar", count: adminDocuments.length },
    { id: "exams", label: "Sınavlar", count: adminExams.length },
    { id: "activity", label: "İşlem geçmişi", count: adminActivities.length },
  ];

  return (
    <div className="grid gap-5">
      <section className="app-hero">
        <div>
          <p className="label">Admin panel</p>
          <h3 className="mt-2 text-3xl font-black text-ink">
            Kayıtlar ve teknik izleme
          </h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
            Teknik metadata, event akışı, API durumu ve kayıt ayrıntıları bu
            alanda toplanır.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={health?.status}>
            API {displayStatus(health?.status || "pending")}
          </Badge>
          <Badge
            tone={ready?.databaseStatus === "ready" ? "ok" : ready?.status}
          >
            MongoDB {displayStatus(ready?.databaseStatus || "unknown")}
          </Badge>
        </div>
      </section>

      <section className="panel p-5">
        <div className="mb-5 flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              className={`btn ${activeTab === tab.id ? "btn-primary" : "btn-secondary"}`}
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              <span className="rounded-md bg-black/25 px-2 py-0.5 text-xs">
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        <div className="mb-5 flex justify-end">
          <button
            className="btn btn-secondary"
            type="button"
            onClick={onRefresh}
            disabled={busy === "admin-data"}
          >
            {busy === "admin-data" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Admin verilerini yenile
          </button>
        </div>

        {activeTab === "users" ? (
          <AdminUsersPanel
            busy={busy}
            currentUserId={session.user?.id}
            onCreateUser={onCreateUser}
            onDeleteUser={onDeleteUser}
            onRefreshUsers={onRefresh}
            users={users}
          />
        ) : null}
        {activeTab === "documents" ? (
          <AdminRecordList
            records={adminDocuments}
            type="document"
            users={users}
          />
        ) : null}
        {activeTab === "exams" ? (
          <AdminRecordList records={adminExams} type="exam" users={users} />
        ) : null}
        {activeTab === "activity" ? (
          <AdminActivityList activities={adminActivities} users={users} />
        ) : null}
      </section>
    </div>
  );
}

function AdminUsersPanel({
  busy,
  currentUserId,
  onCreateUser,
  onDeleteUser,
  onRefreshUsers,
  users,
}) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event) {
    event.preventDefault();
    setNotice("");
    const ok = await onCreateUser({ email, displayName, password });
    if (ok) {
      setEmail("");
      setDisplayName("");
      setPassword("");
      setNotice("Kullanıcı oluşturuldu.");
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
      <section className="rounded-lg border border-space-line bg-black/25 p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="label">Kullanıcı yönetimi</p>
            <h3 className="section-title">Yeni kullanıcı</h3>
          </div>
          <button
            className="btn btn-secondary"
            type="button"
            onClick={onRefreshUsers}
            disabled={busy === "admin-data"}
          >
            {busy === "admin-data" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Yenile
          </button>
        </div>
        {notice ? <Alert tone="ok" message={notice} /> : null}
        <form className="grid gap-3" onSubmit={submit}>
          <label>
            <span className="label">Email</span>
            <input
              className="field mt-1"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            <span className="label">Görünen ad</span>
            <input
              className="field mt-1"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
            />
          </label>
          <label>
            <span className="label">Geçici şifre</span>
            <input
              className="field mt-1"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
            />
          </label>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy === "admin-create-user"}
          >
            {busy === "admin-create-user" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <User className="h-4 w-4" />
            )}
            Kullanıcı ekle
          </button>
        </form>
      </section>

      <section className="grid content-start gap-3">
        {users.length ? (
          users.map((user) => (
            <article
              className="rounded-lg border border-space-line bg-black/25 p-4"
              key={user.id || user.email}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-black text-ink">
                    {user.displayName || user.email}
                  </p>
                  <p className="mt-1 break-all text-xs text-muted">
                    {user.email}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone={user.role === "admin" ? "ready" : "idle"}>
                    {user.role || "user"}
                  </Badge>
                  <Badge tone={user.status}>
                    {displayStatus(user.status || "active")}
                  </Badge>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() => onDeleteUser(user.id)}
                    disabled={
                      !user.id ||
                      user.id === currentUserId ||
                      busy === `admin-delete-user-${user.id}`
                    }
                  >
                    {busy === `admin-delete-user-${user.id}` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    Sil
                  </button>
                </div>
              </div>
            </article>
          ))
        ) : (
          <p className="rounded-lg border border-dashed border-space-line bg-black/20 p-5 text-sm text-muted">
            Kullanıcı kaydı bulunamadı.
          </p>
        )}
      </section>
    </div>
  );
}

function AdminRecordList({ records, type, users }) {
  if (!records.length) {
    return (
      <p className="rounded-lg border border-dashed border-space-line bg-black/20 p-5 text-sm text-muted">
        Henüz kayıt yok.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {records.map((record) => (
        <article
          className="rounded-lg border border-space-line bg-black/25 p-4"
          key={
            record.id ||
            record.examId ||
            `${record.documentId}-${record.createdAt}`
          }
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="label">
                {type === "document" ? "Doküman kaydı" : "Sınav kaydı"}
              </p>
              <h4 className="mt-1 break-words text-base font-black text-ink">
                {record.title ||
                  record.fileName ||
                  record.documentId ||
                  record.examId}
              </h4>
              <p className="mt-1 break-all text-xs text-muted">
                {record.documentId || record.examId || record.id}
              </p>
              <p className="mt-2 text-xs text-muted">
                Kullanıcı: {userLabelForId(users, record.userId)}
              </p>
            </div>
            <Badge tone={record.status}>
              {displayStatus(record.status || "recorded")}
            </Badge>
          </div>
          <pre className="mt-4 max-h-52 overflow-auto rounded-lg border border-space-line bg-black/35 p-3 text-xs leading-5 text-muted">
            {JSON.stringify(record, null, 2)}
          </pre>
        </article>
      ))}
    </div>
  );
}

function AdminActivityList({ activities, users }) {
  const [selectedUserId, setSelectedUserId] = useState("all");
  const filteredActivities =
    selectedUserId === "all"
      ? activities
      : activities.filter(
          (event) => String(event.userId || "") === selectedUserId,
        );

  if (!activities.length) {
    return (
      <p className="rounded-lg border border-dashed border-space-line bg-black/20 p-5 text-sm text-muted">
        Henüz işlem kaydı yok.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      <label className="max-w-sm">
        <span className="label">Kullanıcı filtresi</span>
        <select
          className="field mt-1"
          value={selectedUserId}
          onChange={(event) => setSelectedUserId(event.target.value)}
        >
          <option value="all">Tüm kullanıcılar</option>
          {users.map((user) => (
            <option key={user.id || user.email} value={user.id}>
              {user.displayName || user.email}
            </option>
          ))}
        </select>
      </label>

      {sortRecordsByDate(filteredActivities).map((event) => (
        <article
          className="rounded-lg border border-space-line bg-black/25 p-4"
          key={
            event.id || `${event.eventId}-${event.eventType}-${event.createdAt}`
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold text-ink">
              {event.eventType || "activity.event"}
            </p>
            <Badge tone={event.status}>
              {displayStatus(event.status || "recorded")}
            </Badge>
          </div>
          <p className="mt-2 text-xs text-muted">
            Kullanıcı: {userLabelForId(users, event.userId)}
          </p>
          <p className="mt-2 break-all text-xs text-muted">
            documentId: {event.documentId || "-"}
          </p>
          <p className="mt-2 text-sm leading-6 text-muted">
            {event.message || readableActivityMessage(event)}
          </p>
          <pre className="mt-4 max-h-44 overflow-auto rounded-lg border border-space-line bg-black/35 p-3 text-xs leading-5 text-muted">
            {JSON.stringify(event, null, 2)}
          </pre>
        </article>
      ))}
      {!filteredActivities.length ? (
        <p className="rounded-lg border border-dashed border-space-line bg-black/20 p-5 text-sm text-muted">
          Bu kullanıcı için işlem kaydı yok.
        </p>
      ) : null}
    </div>
  );
}

function userLabelForId(users, userId) {
  const normalizedUserId = String(userId || "");
  const user = users.find((item) => String(item.id || "") === normalizedUserId);
  if (!user) return normalizedUserId || "-";
  return `${user.displayName || user.email} (${user.email})`;
}

function isFailedExamRecord(exam) {
  const status = String(
    exam?.status || exam?.validationResult || "",
  ).toLowerCase();
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

function resolveActivityDisplayMessage(
  event,
  displayStatusValue,
  terminalStatusByDocument,
) {
  const status = String(event.status || "").toLowerCase();
  const terminal = event.documentId
    ? terminalStatusByDocument.get(event.documentId)
    : "";
  if (status === "processing" && terminal === "validated") {
    return "Bu adım sonraki event ile tamamlandı.";
  }
  if (status === "processing" && terminal === "failed") {
    return "Bu adım sonrasında akış hata durumuna geçti.";
  }
  return (
    event.message ||
    readableActivityMessage({ ...event, status: displayStatusValue })
  );
}

function readableActivityMessage(event) {
  if (event.status === "received") return "Doküman backend tarafından alındı.";
  if (event.status === "published") return "Event Pub/Sub hattına yayınlandı.";
  if (event.status === "processing")
    return "Arka plan servisi işlemi sürdürüyor.";
  if (event.status === "processed") return "Doküman işleme adımı tamamlandı.";
  if (event.status === "validated")
    return "Doğrulama ve sınav kaydı tamamlandı.";
  if (event.status === "failed") return "İşlem sırasında hata oluştu.";
  return "Activity kaydı oluşturuldu.";
}

function readableActivityError(event) {
  return event.error || "İşlem sırasında hata oluştu.";
}

function isAdminSession(session) {
  const role = String(session?.user?.role || "").toLowerCase();
  const email = String(
    session?.user?.email || session?.email || "",
  ).toLowerCase();
  return role === "admin" || email === "admin@examflow.com";
}
