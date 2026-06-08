import { useEffect, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ClipboardList,
  Download,
  Eye,
  ExternalLink,
  FileText,
  LockKeyhole,
  Loader2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { RecordMetadataControls } from "../../../components/recordMetadata";
import { Badge } from "../../../components/status";
import { defaultBaseUrl } from "../../../config/appConfig";
import { displayStatus, parseRecordDate, sortRecordsByDate } from "../../../utils/format";
import { readStoredSession } from "../../../utils/session";
import { DocumentMeta } from "../components/DocumentMeta";

export function DocumentDetailPage({ activities = [], busy, documents, exams = [], onUpdateMetadata }) {
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
  const recordKey = document.documentId || document.id || "";
  const linkedExams = exams.filter((exam) => exam.documentId === document.documentId || exam.documentId === document.id);
  const documentActivities = sortRecordsByDate(activities.filter((event) => event.documentId === document.documentId || event.documentId === document.id));

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
        <div className="grid gap-3">
          <Badge tone={document.status}>{displayStatus(document.status || "recorded")}</Badge>
          <RecordMetadataControls
            busy={busy === `metadata-document-${recordKey}`}
            onChange={(metadata) => onUpdateMetadata?.(recordKey, metadata)}
            record={document}
            type="document"
          />
        </div>
      </section>

      <main className="grid gap-5">
        <DocumentViewer document={document} fileInfo={fileInfo} />
        <LinkedExamPanel exams={linkedExams} />
      </main>
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
  const secureFile = useSecureDocumentFile(fileInfo);

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
        <ViewerActions fileInfo={fileInfo} secureFile={secureFile} />
      </div>

      <SecureViewerBody document={document} fileInfo={fileInfo} secureFile={secureFile} />
    </section>
  );
}

function SecureViewerBody({ document, fileInfo, secureFile }) {
  if (!fileInfo.url) {
    return <MissingFileState fileInfo={fileInfo} />;
  }

  if (secureFile.status === "loading" || secureFile.status === "idle") {
    return <FileLoadingState />;
  }

  if (secureFile.status === "error") {
    return <FileErrorState error={secureFile.error} />;
  }

  return <ResolvedViewer fileInfo={{ ...fileInfo, url: secureFile.url }} title={document.fileName || document.title || "Doküman"} />;
}

function FileLoadingState() {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center rounded-lg border border-dashed border-space-line bg-black/25 p-8 text-center">
      <Loader2 className="h-10 w-10 animate-spin text-neon-cyan" />
      <p className="mt-4 text-base font-bold text-ink">Güvenli dosya hazırlanıyor.</p>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted">Viewer dosyayı JWT ile backend endpointinden alıyor.</p>
    </div>
  );
}

function FileErrorState({ error }) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center rounded-lg border border-dashed border-neon-amber/40 bg-neon-amber/10 p-8 text-center">
      <LockKeyhole className="h-12 w-12 text-neon-amber" />
      <p className="mt-4 text-base font-bold text-ink">Dosya güvenli endpointten alınamadı.</p>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted">{error || "Oturum veya dosya erişim kontrolü başarısız oldu."}</p>
    </div>
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

function ViewerActions({ fileInfo, secureFile }) {
  if (!fileInfo.url) {
    return (
      <span className="inline-flex items-center gap-2 rounded-lg border border-neon-amber/40 bg-neon-amber/10 px-3 py-2 text-xs font-black text-neon-amber">
        <LockKeyhole className="h-4 w-4" />
        Storage bağlantısı yok
      </span>
    );
  }

  if (secureFile.status !== "ready") {
    return (
      <span className="inline-flex items-center gap-2 rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 px-3 py-2 text-xs font-black text-neon-cyan">
        <Loader2 className="h-4 w-4 animate-spin" />
        Dosya hazırlanıyor
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <a className="btn btn-secondary" href={secureFile.url} rel="noreferrer" target="_blank">
        <ExternalLink className="h-4 w-4" />
        Yeni sekmede aç
      </a>
      <a className="btn btn-secondary" download={fileInfo.fileName || true} href={secureFile.url}>
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

function DocumentActivityPanel({ activities }) {
  return (
    <section className="panel p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label">İşlem geçmişi</p>
          <h3 className="section-title">Bu dokümanın event akışı</h3>
        </div>
        <Badge tone={activities.length ? "ok" : "idle"}>{activities.length} olay</Badge>
      </div>

      {activities.length ? (
        <div className="mt-5 grid gap-3">
          {activities.map((event) => (
            <article className="rounded-lg border border-space-line bg-black/25 p-4" key={event.id || `${event.eventId}-${event.eventType}-${event.createdAt}`}>
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan">
                  <Activity className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-black text-ink">{readableDocumentActivityTitle(event)}</p>
                    <Badge tone={event.status}>{displayStatus(event.status || "recorded")}</Badge>
                  </div>
                  <p className="mt-2 break-words text-xs leading-5 text-muted">{event.message || readableDocumentActivityMessage(event)}</p>
                  <p className="mt-2 text-xs text-muted">{parseRecordDate(event.createdAt || event.updatedAt)}</p>
                  {event.error ? <p className="mt-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger">{event.error}</p> : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-5 rounded-lg border border-dashed border-space-line bg-black/20 p-4">
          <p className="text-sm font-bold text-ink">Bu doküman için işlem geçmişi henüz görünmüyor.</p>
          <p className="mt-2 text-xs leading-5 text-muted">API, Worker, Validation ve Exam servislerinden gelen activity kayıtları burada aynı documentId altında listelenecek.</p>
        </div>
      )}
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
  const documentId = document.documentId || document.id || "";
  const secureUrl = document.fileUrl || (documentId ? `/documents/${encodeURIComponent(documentId)}/file` : "");
  const url = secureUrl || document.downloadUrl || document.signedUrl || document.publicUrl || document.storageUrl || document.url || "";

  return {
    extension,
    fileName,
    url,
  };
}

function useSecureDocumentFile(fileInfo) {
  const [state, setState] = useState({ error: "", status: fileInfo.url ? "loading" : "idle", url: "" });

  useEffect(() => {
    if (!fileInfo.url) {
      setState({ error: "", status: "idle", url: "" });
      return undefined;
    }

    const session = readStoredSession();
    if (!session?.token) {
      setState({ error: "Oturum tokeni bulunamadı. Dosyayı görüntülemek için yeniden giriş yap.", status: "error", url: "" });
      return undefined;
    }

    const controller = new AbortController();
    let objectUrl = "";
    let isActive = true;

    async function loadFile() {
      setState({ error: "", status: "loading", url: "" });

      try {
        const response = await fetch(resolveDocumentFileUrl(fileInfo.url), {
          headers: {
            Authorization: `Bearer ${session.token}`,
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          throw new Error(`Dosya isteği başarısız oldu (${response.status})${errorText ? `: ${errorText.trim()}` : ""}.`);
        }

        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);

        if (isActive) {
          setState({ error: "", status: "ready", url: objectUrl });
        }
      } catch (error) {
        if (error.name === "AbortError" || !isActive) return;
        setState({ error: error.message || "Dosya alınamadı.", status: "error", url: "" });
      }
    }

    loadFile();

    return () => {
      isActive = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileInfo.url]);

  return state;
}

function resolveDocumentFileUrl(fileUrl) {
  if (!fileUrl) return "";
  if (/^https?:\/\//i.test(fileUrl) || fileUrl.startsWith("blob:")) return fileUrl;
  if (fileUrl.startsWith(`${defaultBaseUrl}/`)) return fileUrl;
  if (fileUrl.startsWith("/")) return `${defaultBaseUrl}${fileUrl}`;
  return `${defaultBaseUrl}/${fileUrl}`;
}

function readableDocumentActivityTitle(event) {
  const status = String(event.status || "").toLowerCase();
  const type = String(event.eventType || "").toLowerCase();
  if (status === "received" || type.includes("received")) return "Doküman alındı";
  if (status === "published" || type.includes("published")) return "Pub/Sub event yayınlandı";
  if (status === "processing" || type.includes("processing")) return "Worker işleme başladı";
  if (status === "processed" || type.includes("processed")) return "Doküman işleme tamamlandı";
  if (status === "validated" || type.includes("validated")) return "Doğrulama tamamlandı";
  if (status === "failed" || type.includes("failed")) return "Akış hata aldı";
  if (type.includes("exam")) return "Sınav kaydı oluşturuldu";
  return "Activity kaydı";
}

function readableDocumentActivityMessage(event) {
  const status = String(event.status || "").toLowerCase();
  if (status === "received") return "API Service doküman isteğini aldı.";
  if (status === "published") return "Doküman event'i Pub/Sub hattına yayınlandı.";
  if (status === "processing") return "Worker Service dokümanı işliyor.";
  if (status === "processed") return "Doküman işleme adımı tamamlandı.";
  if (status === "validated") return "Validation sonucu üretildi ve sınav kaydı hazırlandı.";
  if (status === "failed") return "Bu dokümanın event akışında hata oluştu.";
  return "Bu dokümana ait activity kaydı oluşturuldu.";
}
