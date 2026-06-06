import { ArrowLeft, Eye, FileText } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { Badge } from "../../../components/status";
import { displayStatus, parseRecordDate } from "../../../utils/format";
import { DocumentMeta } from "../components/DocumentMeta";

export function DocumentDetailPage({ documents }) {
  const { documentId } = useParams();
  const decodedDocumentId = decodeURIComponent(documentId || "");
  const document = documents.find((item) => item.documentId === decodedDocumentId || item.id === decodedDocumentId);

  if (!document) {
    return (
      <section className="panel p-6">
        <Link className="btn btn-secondary mb-5" to="/app/documents">
          <ArrowLeft className="h-4 w-4" />
          Doküman arşivine dön
        </Link>
        <div className="rounded-lg border border-dashed border-space-line bg-black/20 p-8 text-center">
          <FileText className="mx-auto h-10 w-10 text-muted" />
          <p className="mt-4 text-sm font-bold text-ink">Doküman kaydı bulunamadı.</p>
          <p className="mt-2 text-sm text-muted">Arşiv yenilendikten sonra kayıt değişmiş veya kaldırılmış olabilir.</p>
        </div>
      </section>
    );
  }

  const extension = String(document.fileName || "").split(".").pop()?.toLowerCase();
  const viewerType = extension === "pdf" ? "PDF viewer" : extension === "docx" ? "DOCX önizleme" : "Dosya önizleme";

  return (
    <div className="grid gap-5">
      <section className="app-hero">
        <div>
          <Link className="btn btn-secondary mb-5" to="/app/documents">
            <ArrowLeft className="h-4 w-4" />
            Doküman arşivine dön
          </Link>
          <p className="label">Doküman detayı</p>
          <h3 className="mt-2 break-words text-3xl font-black text-ink">{document.fileName || document.title || "İsimsiz doküman"}</h3>
          <p className="mt-3 break-all text-sm leading-6 text-muted">{document.documentId || document.id}</p>
        </div>
        <Badge tone={document.status}>{displayStatus(document.status || "recorded")}</Badge>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(320px,0.8fr)_minmax(420px,1.2fr)]">
        <section className="panel p-5">
          <p className="label">Metadata</p>
          <h3 className="section-title">Kayıt bilgileri</h3>
          <dl className="mt-5 grid gap-3">
            <DocumentMeta label="documentId" value={document.documentId || document.id || "-"} />
            <DocumentMeta label="Dosya adı" value={document.fileName || "-"} />
            <DocumentMeta label="Kaynak" value={document.source || "-"} />
            <DocumentMeta label="Validation" value={displayStatus(document.validationResult || "-")} />
            <DocumentMeta label="Oluşturulma" value={parseRecordDate(document.createdAt)} />
            <DocumentMeta label="Güncelleme" value={parseRecordDate(document.updatedAt)} />
          </dl>
        </section>

        <section className="panel glass-grid p-5">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="label">SCRUM-80 hazırlığı</p>
              <h3 className="section-title">{viewerType}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">
                Bu alan SCRUM-80 kapsamında güvenli dosya görüntüleme için ayrıldı. Backend dosya binary saklama veya güvenli dosya URL’i sağladığında PDF burada tema içinde açılacak.
              </p>
            </div>
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan">
              <Eye className="h-5 w-5" />
            </div>
          </div>

          <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-space-line bg-black/25 p-8 text-center">
            <FileText className="h-12 w-12 text-muted" />
            <p className="mt-4 text-base font-bold text-ink">Güvenli görüntüleyici SCRUM-80’de bağlanacak.</p>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
              Şu an backend yalnızca doküman metadata kaydını saklıyor. Gerçek PDF/DOCX içeriği saklandığında bu route kullanıcıyı arşivden koparmadan dosya önizlemesini gösterecek.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
