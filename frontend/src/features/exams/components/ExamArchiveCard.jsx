import { ClipboardList, Eye } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "../../../components/status";
import { RecordMetadataControls } from "../../../components/recordMetadata";
import { displayStatus, parseRecordDate } from "../../../utils/format";
import { ExamMeta } from "./ExamMeta";

export function ExamArchiveCard({ busy, exam, onUpdateMetadata }) {
  const examKey = encodeURIComponent(exam.id || exam.examId || exam.documentId || "");
  const recordKey = exam.id || exam.examId || exam.documentId || "";

  return (
    <article className="rounded-lg border border-space-line bg-black/25 p-4 transition hover:border-neon-cyan/50 hover:bg-neon-cyan/5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-neon-green/40 bg-neon-green/10 text-neon-green">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h4 className="break-words text-base font-black text-ink">{exam.title || "Oluşturulan sınav"}</h4>
              <p className="mt-1 break-all text-xs text-muted">{exam.documentId || exam.id || "-"}</p>
            </div>
          </div>
        </div>
        <Badge tone={exam.status}>{displayStatus(exam.status || "recorded")}</Badge>
      </div>

      <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
        <ExamMeta label="Document" value={exam.documentId || "-"} />
        <ExamMeta label="Validation" value={displayStatus(exam.validationResult || "-")} />
        <ExamMeta label="Oluşturulma" value={parseRecordDate(exam.createdAt)} />
        <ExamMeta label="Güncelleme" value={parseRecordDate(exam.updatedAt)} />
      </dl>

      <div className="mt-4">
        <RecordMetadataControls
          busy={busy === `metadata-exam-${recordKey}`}
          onChange={(metadata) => onUpdateMetadata?.(recordKey, metadata)}
          record={exam}
          size="compact"
          type="exam"
        />
      </div>

      <div className="mt-4 flex justify-end">
        <Link className="btn btn-secondary" to={`/app/exams/${examKey}`}>
          <Eye className="h-4 w-4" />
          Detay ve sorular
        </Link>
      </div>
    </article>
  );
}
