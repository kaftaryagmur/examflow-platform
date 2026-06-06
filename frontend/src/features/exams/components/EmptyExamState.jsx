import { ClipboardList } from "lucide-react";

export function EmptyExamState({ hasExams }) {
  return (
    <div className="rounded-lg border border-dashed border-space-line bg-black/20 p-8 text-center">
      <ClipboardList className="mx-auto h-10 w-10 text-muted" />
      <p className="mt-4 text-sm font-bold text-ink">{hasExams ? "Filtrelere uygun sınav bulunamadı." : "Henüz sınav kaydı yok."}</p>
      <p className="mt-2 text-sm leading-6 text-muted">
        {hasExams ? "Arama metnini veya filtreleri değiştirerek tekrar deneyebilirsin." : "Dashboard üzerinden doküman işlediğinde üretilen sınavlar burada listelenecek."}
      </p>
    </div>
  );
}
