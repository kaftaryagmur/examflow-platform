import { ArrowRight, ClipboardList, LockKeyhole, Play, ShieldCheck, Workflow } from "lucide-react";
import { useEffect } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";

import { LoginPage, ProductApp } from "./features/app/ProductApp";
import { DemoDashboard } from "./features/demo/DemoDashboard";
import { readStoredSession } from "./utils/session";

function App() {
  usePageTitle();

  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/demo/*" element={<DemoDashboard />} />
      <Route
        path="/app/*"
        element={
          <RequireAuth>
            <ProductApp />
          </RequireAuth>
        }
      />
      <Route path="*" element={<ProtectedFallback />} />
    </Routes>
  );
}

function RequireAuth({ children }) {
  const location = useLocation();
  const session = readStoredSession();

  if (!session?.token) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}

function ProtectedFallback() {
  const session = readStoredSession();
  return <Navigate to={session?.token ? "/app/dashboard" : "/login"} replace />;
}

function usePageTitle() {
  const location = useLocation();

  useEffect(() => {
    document.title = resolvePageTitle(location.pathname);
  }, [location.pathname]);
}

function resolvePageTitle(path) {
  if (path === "/") return "ExamFlow | Ana sayfa";
  if (path.startsWith("/login")) return "ExamFlow | Giriş yap";
  if (path.startsWith("/demo")) return "ExamFlow | Demo";
  if (path.startsWith("/app/documents")) return "ExamFlow | Doküman arşivi";
  if (path.startsWith("/app/exams")) return "ExamFlow | Sınav arşivi";
  if (path.startsWith("/app/profile")) return "ExamFlow | Profil";
  if (path.startsWith("/app/admin")) return "ExamFlow | Admin panel";
  if (path.startsWith("/app")) return "ExamFlow | Ana sayfa";
  return "ExamFlow";
}

function HomePage() {
  const session = readStoredSession();
  const appTarget = session?.token ? "/app/dashboard" : "/login";

  return (
    <main className="home-shell">
      <header className="home-nav">
        <Link className="flex items-center gap-3" to="/">
          <div className="brand-mark">E</div>
          <div>
            <p className="label">ExamFlow</p>
            <h1 className="text-lg font-black text-ink">Cloud-native exam platform</h1>
          </div>
        </Link>
        <nav className="flex flex-wrap items-center gap-2" aria-label="Ana menü">
          <Link className="btn btn-secondary" to="/demo/">
            <Play className="h-4 w-4" />
            Demo
          </Link>
          <Link className="btn btn-primary" to={appTarget}>
            <LockKeyhole className="h-4 w-4" />
            {session?.token ? "Panele git" : "Giriş yap"}
          </Link>
        </nav>
      </header>

      <section className="home-hero">
        <div className="min-w-0">
          <p className="label">API, Pub/Sub, Worker, Validation, Exam Service</p>
          <h2 className="mt-3 max-w-4xl text-4xl font-black leading-tight text-ink sm:text-5xl lg:text-6xl">
            Event-driven sınav üretim akışını tek ekrandan başlat ve izle.
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted">
            ExamFlow; JWT ile korunan yayınlama akışı, MongoDB arşivi ve Kubernetes üzerinde çalışan servisleriyle mezuniyet projesi demosu için hazırlanmış
            bulut yerel bir sınav üretim platformudur.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link className="btn btn-primary h-11" to={appTarget}>
              <ShieldCheck className="h-4 w-4" />
              {session?.token ? "Panele git" : "Giriş yap"}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link className="btn btn-secondary h-11" to="/demo/">
              <Workflow className="h-4 w-4" />
              Public demo akışını gör
            </Link>
          </div>
        </div>

        <div className="home-flow" aria-label="ExamFlow servis akışı">
          {["API Service", "Pub/Sub", "Worker", "Validation", "Exam Service", "MongoDB"].map((item, index) => (
            <div key={item} className="home-flow-row">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-neon-cyan/40 bg-neon-cyan/10 text-sm font-black text-neon-cyan">
                {index + 1}
              </span>
              <span className="truncate text-sm font-bold text-ink">{item}</span>
              <ClipboardList className="ml-auto h-4 w-4 text-muted" />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
