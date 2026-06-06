import { Search } from "lucide-react";

import { displayStatus } from "../../../utils/format";

export function ExamFilters({
  query,
  setQuery,
  statusFilter,
  setStatusFilter,
  statusOptions,
  validationFilter,
  setValidationFilter,
  validationOptions,
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_220px_220px]">
      <label className="block">
        <span className="label">Başlık, documentId veya durum ara</span>
        <div className="relative mt-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="field pl-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="örn. quiz, app-2026, validated..." />
        </div>
      </label>

      <label className="block">
        <span className="label">Durum</span>
        <select className="field mt-1" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">Tüm durumlar</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {displayStatus(status)}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="label">Validation</span>
        <select className="field mt-1" value={validationFilter} onChange={(event) => setValidationFilter(event.target.value)}>
          <option value="all">Tüm sonuçlar</option>
          {validationOptions.map((validation) => (
            <option key={validation} value={validation}>
              {displayStatus(validation)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
