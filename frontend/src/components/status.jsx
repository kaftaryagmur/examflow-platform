import { Activity, AlertCircle, CheckCircle2, Loader2, XCircle } from "lucide-react";

import { toneClass } from "../utils/format";

export function Badge({ children, tone = "idle" }) {
  return <span className={`inline-flex h-7 items-center rounded-full border px-3 text-xs font-semibold ${toneClass(tone)}`}>{children}</span>;
}

export function StatusPill({ icon: Icon, label, value, tone }) {
  return (
    <div className={`flex h-9 items-center gap-2 rounded-md border px-3 ${toneClass(tone)}`}>
      <Icon className="h-4 w-4" />
      <span className="text-xs font-semibold">{label}</span>
      <span className="text-xs">{value}</span>
    </div>
  );
}

export function Alert({ message, tone }) {
  const Icon = tone === "failed" ? AlertCircle : Activity;
  return (
    <div className={`mb-4 flex items-start gap-3 rounded-lg border p-4 text-sm font-medium backdrop-blur ${toneClass(tone)}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function TimelineStep({ item }) {
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

export function HealthRow({ label, value, tone }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-space-line pb-3 last:border-0 last:pb-0">
      <span className="text-sm font-medium text-muted">{label}</span>
      <Badge tone={tone}>{value}</Badge>
    </div>
  );
}
