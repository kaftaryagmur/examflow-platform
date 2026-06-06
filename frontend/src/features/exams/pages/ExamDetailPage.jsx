import { ArrowLeft, ClipboardList, Sparkles } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { Badge } from "../../../components/status";
import { displayStatus, parseRecordDate } from "../../../utils/format";
import { ExamMeta } from "../components/ExamMeta";

export function ExamDetailPage({ exams }) {
  const { examKey } = useParams();
  const decodedExamKey = decodeURIComponent(examKey || "");
  const exam = exams.find((item) => item.id === decodedExamKey || item.examId === decodedExamKey || item.documentId === decodedExamKey);

  if (!exam) {
    return (
      <section className="panel p-6">
        <Link className="btn btn-secondary mb-5" to="/app/exams">
          <ArrowLeft className="h-4 w-4" />
          Sınav arşivine dön
        </Link>
        <div className="rounded-lg border border-dashed border-space-line bg-black/20 p-8 text-center">
          <ClipboardList className="mx-auto h-10 w-10 text-muted" />
          <p className="mt-4 text-sm font-bold text-ink">Sınav kaydı bulunamadı.</p>
          <p className="mt-2 text-sm text-muted">Arşiv yenilendikten sonra kayıt değişmiş veya kaldırılmış olabilir.</p>
        </div>
      </section>
    );
  }

  return (
    <div className="grid gap-5">
      <section className="app-hero">
        <div>
          <Link className="btn btn-secondary mb-5" to="/app/exams">
            <ArrowLeft className="h-4 w-4" />
            Sınav arşivine dön
          </Link>
          <p className="label">Sınav detayı</p>
          <h3 className="mt-2 break-words text-3xl font-black text-ink">{exam.title || "Oluşturulan sınav"}</h3>
          <p className="mt-3 break-all text-sm leading-6 text-muted">{exam.documentId || exam.id}</p>
        </div>
        <Badge tone={exam.status}>{displayStatus(exam.status || "recorded")}</Badge>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(320px,0.8fr)_minmax(420px,1.2fr)]">
        <section className="panel p-5">
          <p className="label">Metadata</p>
          <h3 className="section-title">Kayıt bilgileri</h3>
          <dl className="mt-5 grid gap-3">
            <ExamMeta label="examId" value={exam.examId || exam.id || "-"} />
            <ExamMeta label="documentId" value={exam.documentId || "-"} />
            <ExamMeta label="Validation" value={displayStatus(exam.validationResult || "-")} />
            <ExamMeta label="Durum" value={displayStatus(exam.status || "recorded")} />
            <ExamMeta label="Oluşturulma" value={parseRecordDate(exam.createdAt)} />
            <ExamMeta label="Güncelleme" value={parseRecordDate(exam.updatedAt)} />
          </dl>
        </section>

        <section className="panel glass-grid p-5">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="label">AI destekli sınav çıktısı</p>
              <h3 className="section-title">Soru kartları ve bilgi kartları</h3>
              <p className="mt-2 text-sm leading-6 text-muted">
                Bu alan ileride AI destekli sınav üretimi için kullanılacak. Çoktan seçmeli sorular, cevap anahtarı, açıklamalar ve NotebookLM benzeri bilgi kartları burada gösterilecek.
              </p>
            </div>
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan">
              <Sparkles className="h-5 w-5" />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <FutureExamCard title="Çoktan seçmeli sorular" text="AI çıktısı bağlandığında soru, seçenekler, doğru cevap ve açıklama bu alanda listelenecek." />
            <FutureExamCard title="Bilgi kartları" text="Dokümandan çıkarılan ana kavramlar, özetler ve çalışma kartları burada gösterilecek." />
            <FutureExamCard title="Zorluk ve konu etiketleri" text="Sorulara difficulty, topic ve learning outcome metadata alanları eklenebilecek." />
            <FutureExamCard title="Cevap anahtarı" text="Öğrenciye veya eğitmene yönelik cevap anahtarı ve gerekçeli açıklama bölümü hazırlanacak." />
          </div>
        </section>
      </div>
    </div>
  );
}

function FutureExamCard({ text, title }) {
  return (
    <article className="rounded-lg border border-space-line bg-black/25 p-4">
      <p className="text-sm font-bold text-ink">{title}</p>
      <p className="mt-2 text-xs leading-5 text-muted">{text}</p>
    </article>
  );
}
