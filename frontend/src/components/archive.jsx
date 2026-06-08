import { Eye } from "lucide-react";

import { Badge } from "./status";
import { displayStatus, parseRecordDate } from "../utils/format";

export function ArchiveList({ records, empty, onSelectRecord, viewLabel = "Detayı görüntüle" }) {
  if (!records.length) {
    return <p className="panel p-5 text-sm text-muted">{empty}</p>;
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {records.map((record) => (
        <article key={record.id || `${record.documentId}-${record.createdAt}`} className="panel p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold text-ink">{record.title || record.fileName || record.documentId}</h3>
              <p className="mt-1 truncate text-xs text-muted">{record.documentId}</p>
            </div>
            <Badge tone={record.status}>{displayStatus(record.status || "unknown")}</Badge>
          </div>
          <dl className="mt-4 space-y-2 text-xs">
            <ArchiveRow label="Sonuç" value={displayStatus(record.validationResult || record.source || "-")} />
            <ArchiveRow label="Oluşturulma" value={parseRecordDate(record.createdAt)} />
            <ArchiveRow label="Güncelleme" value={parseRecordDate(record.updatedAt)} />
          </dl>
          {onSelectRecord ? (
            <button className="btn btn-secondary mt-4 w-full" type="button" onClick={() => onSelectRecord(record)}>
              <Eye className="h-4 w-4" />
              {viewLabel}
            </button>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function ArchiveRow({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="truncate text-right font-medium text-ink">{value}</dd>
    </div>
  );
}
