import { Eye, FileText } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "../../../components/status";
import { displayStatus, parseRecordDate } from "../../../utils/format";
import { DocumentMeta } from "./DocumentMeta";

export function DocumentArchiveCard({ document }) {
  const documentKey = encodeURIComponent(document.documentId || document.id || "");

  return (
    <article className="rounded-lg border border-space-line bg-black/25 p-4 transition hover:border-neon-cyan/50 hover:bg-neon-cyan/5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h4 className="break-words text-base font-black text-ink">{document.fileName || document.title || "İsimsiz doküman"}</h4>
              <p className="mt-1 break-all text-xs text-muted">{document.documentId || document.id || "-"}</p>
            </div>
          </div>
        </div>
        <Badge tone={document.status}>{displayStatus(document.status || "recorded")}</Badge>
      </div>

      <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
        <DocumentMeta label="Kaynak" value={document.source || "-"} />
        <DocumentMeta label="Validation" value={displayStatus(document.validationResult || "-")} />
        <DocumentMeta label="Oluşturulma" value={parseRecordDate(document.createdAt)} />
        <DocumentMeta label="Güncelleme" value={parseRecordDate(document.updatedAt)} />
      </dl>

      <div className="mt-4 flex justify-end">
        <Link className="btn btn-secondary" to={`/app/documents/${documentKey}`}>
          <Eye className="h-4 w-4" />
          Detay ve görüntüleme
        </Link>
      </div>
    </article>
  );
}
