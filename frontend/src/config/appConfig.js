import { ClipboardList, FileText, LayoutDashboard, ShieldCheck, UserCog } from "lucide-react";

export const defaultBaseUrl = "/api";
export const demoPassword = "ExamFlowDemo2026";
export const sessionKey = "examflow-demo-session";

export const demoViews = [
  { id: "dashboard", label: "Demo akışı", icon: LayoutDashboard },
  { id: "documents", label: "Doküman kayıtları", icon: FileText },
  { id: "exams", label: "Sınav kayıtları", icon: ClipboardList },
];

export const appNav = [
  { to: "/app/dashboard", label: "İçerik Üretimi", icon: LayoutDashboard },
  { to: "/app/documents", label: "Doküman arşivi", icon: FileText },
  { to: "/app/exams", label: "Sınav arşivi", icon: ClipboardList },
  { to: "/app/profile", label: "Profil", icon: UserCog },
  { to: "/app/admin", label: "Admin panel", icon: ShieldCheck },
];

export const emptyTimeline = [
  { id: "received", label: "Alındı", detail: "API Service isteği aldı", status: "waiting" },
  { id: "published", label: "Yayınlandı", detail: "Pub/Sub event üretildi", status: "waiting" },
  { id: "processing", label: "İşleniyor", detail: "Worker Service çalışıyor", status: "waiting" },
  { id: "validated", label: "Doğrulandı", detail: "Validation Service sonucu", status: "waiting" },
  { id: "failed", label: "Hata", detail: "Akışta hata oluştu", status: "waiting" },
];
