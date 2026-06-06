import {
  ArrowLeft,
  ClipboardList,
  Download,
  Eye,
  ExternalLink,
  FileText,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { Badge } from "../../../components/status";
import { displayStatus, parseRecordDate } from "../../../utils/format";
import { DocumentMeta } from "../components/DocumentMeta";

export function DocumentDetailPage({ documents, exams = [] }) {
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

  const fileInfo = getFileInfo(document);
  const linkedExams = exams.filter((exam) => exam.documentId === document.documentId || exam.documentId === document.id);

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

      <div className="grid gap-5 xl:grid-cols-[minmax(300px,0.72fr)_minmax(0,1.28fr)]">
        <aside className="grid content-start gap-5">
          <DocumentMetadata document={document} fileInfo={fileInfo} />
          <LinkedExamPanel exams={linkedExams} />
          <StorageReadiness fileInfo={fileInfo} />
        </aside>

        <main className="grid gap-5">
          <DocumentViewer document={document} fileInfo={fileInfo} />
          <ProcessingContext document={document} linkedExamCount={linkedExams.length} />
        </main>
      </div>
    </div>
  );
}

function DocumentMetadata({ document, fileInfo }) {
  return (
    <section className="panel p-5">
      <p className="label">Metadata</p>
      <h3 className="section-title">Kayıt bilgileri</h3>
      <dl className="mt-5 grid gap-3">
        <DocumentMeta label="documentId" value={document.documentId || document.id || "-"} />
        <DocumentMeta label="Dosya adı" value={document.fileName || "-"} />
        <DocumentMeta label="Dosya türü" value={fileInfo.extension ? `.${fileInfo.extension}` : "-"} />
        <DocumentMeta label="Kaynak" value={document.source || "-"} />
        <DocumentMeta label="Validation" value={displayStatus(document.validationResult || "-")} />
        <DocumentMeta label="Oluşturulma" value={parseRecordDate(document.createdAt)} />
        <DocumentMeta label="Güncelleme" value={parseRecordDate(document.updatedAt)} />
      </dl>
    </section>
  );
}

function DocumentViewer({ document, fileInfo }) {
  const viewerTitle = fileInfo.extension === "pdf" ? "PDF görüntüleyici" : fileInfo.extension === "docx" ? "DOCX görüntüleme" : "Dosya görüntüleme";

  return (
    <section className="panel glass-grid p-5">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label">Güvenli dosya görüntüleme</p>
          <h3 className="section-title">{viewerTitle}</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            PDF içerikleri uygulama teması içinde, sandbox edilmiş viewer alanında gösterilir. DOCX için tarayıcı önizlemesi güvenilir olmadığından güvenli dosya bağlantısı veya backend dönüşümü beklenir.
          </p>
        </div>
        <ViewerActions fileInfo={fileInfo} />
      </div>

      {fileInfo.url ? <ResolvedViewer fileInfo={fileInfo} title={document.fileName || document.title || "Doküman"} /> : <MissingFileState fileInfo={fileInfo} />}
    </section>
  );
}

function ResolvedViewer({ fileInfo, title }) {
  if (fileInfo.extension === "pdf") {
    return (
      <div className="overflow-hidden rounded-lg border border-space-line bg-black/30">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-space-line bg-black/30 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-black text-ink">{title}</p>
            <p className="mt-1 text-xs text-muted">Sandbox edilmiş PDF önizleme</p>
          </div>
          <Badge tone="ready">PDF hazır</Badge>
        </div>
        <iframe
          className="h-[68vh] min-h-[520px] w-full bg-white"
          referrerPolicy="no-referrer"
          sandbox="allow-same-origin allow-scripts"
          src={fileInfo.url}
          title={title}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center rounded-lg border border-dashed border-space-line bg-black/25 p-8 text-center">
      <FileText className="h-12 w-12 text-neon-cyan" />
      <p className="mt-4 text-base font-bold text-ink">Dosya bağlantısı hazır.</p>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
        Bu dosya türü uygulama içinde güvenilir şekilde render edilmiyor. Dosyayı yeni sekmede açarak veya indirerek görüntüleyebilirsin.
      </p>
      <a className="btn btn-primary mt-5" href={fileInfo.url} rel="noreferrer" target="_blank">
        <ExternalLink className="h-4 w-4" />
        Dosyayı yeni sekmede aç
      </a>
    </div>
  );
}

function MissingFileState({ fileInfo }) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center rounded-lg border border-dashed border-space-line bg-black/25 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan">
        <Eye className="h-8 w-8" />
      </div>
      <p className="mt-4 text-base font-bold text-ink">Dosya içeriği henüz frontend’e ulaşmıyor.</p>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
        Backend şu anda doküman metadata kaydını saklıyor. Gerçek PDF/DOCX içeriği için API’nin güvenli bir dosya URL’i, signed URL veya binary endpoint sağlaması gerekiyor.
      </p>
      <div className="mt-5 grid w-full max-w-2xl gap-3 text-left md:grid-cols-3">
        <ReadinessStep title="1. Metadata" text="Kayıt arşivde görünüyor." tone="ok" />
        <ReadinessStep title="2. Storage" text="Dosya URL alanı bekleniyor." tone="pending" />
        <ReadinessStep title="3. Viewer" text={`${fileInfo.extension === "pdf" ? "PDF" : "Dosya"} burada açılacak.`} tone="idle" />
      </div>
    </div>
  );
}

function ViewerActions({ fileInfo }) {
  if (!fileInfo.url) {
    return (
      <span className="inline-flex items-center gap-2 rounded-lg border border-neon-amber/40 bg-neon-amber/10 px-3 py-2 text-xs font-black text-neon-amber">
        <LockKeyhole className="h-4 w-4" />
        Storage bağlantısı yok
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <a className="btn btn-secondary" href={fileInfo.url} rel="noreferrer" target="_blank">
        <ExternalLink className="h-4 w-4" />
        Yeni sekmede aç
      </a>
      <a className="btn btn-secondary" download href={fileInfo.url}>
        <Download className="h-4 w-4" />
        İndir
      </a>
    </div>
  );
}

function LinkedExamPanel({ exams }) {
  return (
    <section className="panel p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label">Bağlı çıktı</p>
          <h3 className="section-title">Üretilen sınavlar</h3>
        </div>
        <Badge tone={exams.length ? "ok" : "idle"}>{exams.length} kayıt</Badge>
      </div>

      <div className="mt-5 grid gap-3">
        {exams.length ? (
          exams.map((exam) => {
            const examKey = encodeURIComponent(exam.id || exam.examId || exam.documentId || "");
            return (
              <Link className="rounded-lg border border-space-line bg-black/25 p-4 transition hover:border-neon-cyan/50 hover:bg-neon-cyan/5" key={exam.id || exam.examId || exam.documentId} to={`/app/exams/${examKey}`}>
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-neon-purple/40 bg-neon-purple/10 text-neon-purple">
                    <ClipboardList className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="break-words text-sm font-black text-ink">{exam.title || "Oluşturulan sınav"}</p>
                    <p className="mt-1 break-all text-xs text-muted">{exam.examId || exam.id || exam.documentId}</p>
                    <p className="mt-2 text-xs text-muted">{parseRecordDate(exam.updatedAt || exam.createdAt)}</p>
                  </div>
                </div>
              </Link>
            );
          })
        ) : (
          <div className="rounded-lg border border-dashed border-space-line bg-black/20 p-4">
            <p className="text-sm font-bold text-ink">Bu dokümana bağlı sınav henüz görünmüyor.</p>
            <p className="mt-2 text-xs leading-5 text-muted">Event akışı tamamlandığında Exam Service kaydı burada listelenecek.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function StorageReadiness({ fileInfo }) {
  const rows = [
    { label: "Desteklenen tür", value: fileInfo.extension === "pdf" || fileInfo.extension === "docx" ? `.${fileInfo.extension}` : "Bilinmiyor", isReady: fileInfo.extension === "pdf" || fileInfo.extension === "docx" },
    { label: "Güvenli URL", value: fileInfo.url ? "Hazır" : "Bekleniyor", isReady: Boolean(fileInfo.url) },
    { label: "Viewer modu", value: fileInfo.extension === "pdf" ? "Tema içinde PDF" : "Yeni sekme / dönüşüm", isReady: fileInfo.extension === "pdf" && Boolean(fileInfo.url) },
  ];

  return (
    <section className="panel p-5">
      <p className="label">Dosya erişimi</p>
      <h3 className="section-title">Hazırlık kontrolü</h3>
      <div className="mt-5 grid gap-2">
        {rows.map((row) => (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-space-line bg-black/20 p-3" key={row.label}>
            <span className="text-sm font-bold text-muted">{row.label}</span>
            <span className={`text-sm font-black ${row.isReady ? "text-neon-green" : "text-neon-amber"}`}>{row.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProcessingContext({ document, linkedExamCount }) {
  return (
    <section className="grid gap-5 md:grid-cols-2">
      <article className="panel p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-neon-green/40 bg-neon-green/10 text-neon-green">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="label">Sahiplik ve güvenlik</p>
            <h3 className="section-title">Kullanıcıya ait kayıt</h3>
            <p className="mt-2 text-sm leading-6 text-muted">
              Bu ekran authenticated arşivden gelen kaydı gösterir. Dosya görüntüleme bağlandığında URL veya binary endpoint de JWT korumalı olmalı.
            </p>
          </div>
        </div>
      </article>

      <article className="panel p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="label">Sınav üretim bağı</p>
            <h3 className="section-title">{linkedExamCount ? `${linkedExamCount} sınav bağlı` : "Sınav bekleniyor"}</h3>
            <p className="mt-2 text-sm leading-6 text-muted">
              documentId: <span className="break-all font-bold text-ink">{document.documentId || document.id}</span> üzerinden exam kayıtlarıyla ilişki kuruluyor.
            </p>
          </div>
        </div>
      </article>
    </section>
  );
}

function ReadinessStep({ text, title, tone }) {
  const toneClass = tone === "ok" ? "border-neon-green/35 bg-neon-green/10 text-neon-green" : tone === "pending" ? "border-neon-amber/35 bg-neon-amber/10 text-neon-amber" : "border-space-line bg-black/20 text-muted";

  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <p className="text-xs font-black uppercase">{title}</p>
      <p className="mt-2 text-xs leading-5 text-muted">{text}</p>
    </div>
  );
}

function getFileInfo(document) {
  const fileName = document.fileName || document.title || "";
  const extension = String(fileName).split(".").pop()?.toLowerCase() || "";
  const url = document.fileUrl || document.downloadUrl || document.signedUrl || document.publicUrl || document.storageUrl || document.url || "";

  return {
    extension,
    url,
  };
}
