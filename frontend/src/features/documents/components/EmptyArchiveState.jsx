import { FileText } from "lucide-react";

export function EmptyArchiveState({ hasDocuments }) {
  return (
    <div className="rounded-lg border border-dashed border-space-line bg-black/20 p-8 text-center">
      <FileText className="mx-auto h-10 w-10 text-muted" />
      <p className="mt-4 text-sm font-bold text-ink">{hasDocuments ? "Filtrelere uygun doküman bulunamadı." : "Henüz doküman kaydı yok."}</p>
      <p className="mt-2 text-sm leading-6 text-muted">
        {hasDocuments ? "Arama metnini veya filtreleri değiştirerek tekrar deneyebilirsin." : "Dashboard üzerinden bir doküman işlediğinde kayıtlar burada listelenecek."}
      </p>
    </div>
  );
}
