import {
  ArrowRight,
  BookOpenCheck,
  ClipboardList,
  FileText,
  LockKeyhole,
  Play,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { useEffect } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";

import { LoginPage, ProductApp } from "./features/app/ProductApp";
import { DemoDashboard } from "./features/demo/DemoDashboard";
import { readStoredSession } from "./utils/session";

const heroLogoSrc = "/assets/logo.png";
const markLogoSrc = "/assets/logo2.png";

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
  if (path === "/") return "ExamFlow | Akıllı sınav hazırlama";
  if (path.startsWith("/login")) return "ExamFlow | Giriş yap";
  if (path.startsWith("/demo")) return "ExamFlow | Demo";
  if (path.startsWith("/app/documents")) return "ExamFlow | Doküman arşivi";
  if (path.startsWith("/app/exams")) return "ExamFlow | Sınav arşivi";
  if (path.startsWith("/app/profile")) return "ExamFlow | Profil";
  if (path.startsWith("/app/admin")) return "ExamFlow | Admin panel";
  if (path.startsWith("/app")) return "ExamFlow | Panel";
  return "ExamFlow";
}

function HomePage() {
  const session = readStoredSession();
  const appTarget = session?.token ? "/app/dashboard" : "/login";

  const flowSteps = [
    "Doküman yükle",
    "İçerik analiz edilsin",
    "Sorular oluşturulsun",
    "Sınavı incele",
    "Kaydet ve çözümle",
  ];

  const highlights = [
    {
      icon: FileText,
      title: "Dokümandan başlar",
      description: "PDF veya ders notlarını yükleyerek sınav hazırlama sürecini başlatın.",
    },
    {
      icon: Sparkles,
      title: "Akıllı akış",
      description: "İçerik işlenir, doğrulanır ve sınav çıktısı düzenli şekilde hazırlanır.",
    },
    {
      icon: BookOpenCheck,
      title: "Kontrol sizde",
      description: "Oluşan sınavı inceleyin, arşivleyin ve gerektiğinde tekrar erişin.",
    },
  ];

  return (
    <main className="home-shell">
      <header className="home-nav">
        <Link className="flex items-center gap-3" to="/">
          <img className="brand-logo" src={markLogoSrc} alt="ExamFlow logo" />
          <div>
            <p className="label">ExamFlow</p>
            <h1 className="text-lg font-black text-ink">
              Akıllı sınav hazırlama platformu
            </h1>
          </div>
        </Link>

        <nav className="flex flex-wrap items-center gap-2" aria-label="Ana menü">
          <Link className="btn btn-secondary" to="/demo/">
            <Play className="h-4 w-4" />
            Demo
          </Link>
          <Link className="btn btn-primary" to={appTarget}>
            <LockKeyhole className="h-4 w-4" />
            {session?.token ? "Panele git" : "Başla"}
          </Link>
        </nav>
      </header>

      <section className="home-hero">
        <div className="min-w-0">
          <p className="label">Öğretmenler ve eğitim ekipleri için</p>

          <h2 className="mt-3 max-w-4xl text-4xl font-black leading-tight text-ink sm:text-5xl lg:text-6xl">
            Dokümandan sınava giden süreci tek ekrandan yönetin.
          </h2>

          <p className="mt-5 max-w-2xl text-base leading-7 text-muted">
            Ders notlarınızı veya PDF dokümanlarınızı yükleyin. ExamFlow içeriği
            işler, doğrular ve sınav çıktısını sizin için hazırlar.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link className="btn btn-primary h-11" to={appTarget}>
              <ShieldCheck className="h-4 w-4" />
              {session?.token ? "Panele git" : "Sınav oluşturmaya başla"}
              <ArrowRight className="h-4 w-4" />
            </Link>

            <Link className="btn btn-secondary h-11" to="/demo/">
              <Workflow className="h-4 w-4" />
              Demo sınav akışını gör
            </Link>
          </div>

          <div className="mt-10 grid max-w-4xl gap-3 sm:grid-cols-3">
            {highlights.map(({ icon: Icon, title, description }) => (
              <article
                key={title}
                className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-sm backdrop-blur"
              >
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg border border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan">
                  <Icon className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-black text-ink">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
              </article>
            ))}
          </div>
        </div>

        <aside className="grid gap-4" aria-label="ExamFlow sınav hazırlama akışı">
          <div className="home-logo-panel">
            <img src={heroLogoSrc} alt="ExamFlow logo" />
          </div>

          <div className="home-flow">
            <div className="mb-4">
              <p className="label">Süreç</p>
              <h3 className="mt-1 text-xl font-black text-ink">
                Sınav hazırlama adımları
              </h3>
            </div>

            {flowSteps.map((item, index) => (
              <div key={item} className="home-flow-row">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-neon-cyan/40 bg-neon-cyan/10 text-sm font-black text-neon-cyan">
                  {index + 1}
                </span>
                <span className="truncate text-sm font-bold text-ink">{item}</span>
                <ClipboardList className="ml-auto h-4 w-4 text-muted" />
              </div>
            ))}
          </div>

        </aside>
      </section>
    </main>
  );
}

export default App;
