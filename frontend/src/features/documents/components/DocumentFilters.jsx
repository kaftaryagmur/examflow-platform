import { Search } from "lucide-react";

import { displayStatus } from "../../../utils/format";

export function DocumentFilters({
  favoriteFilter,
  query,
  setFavoriteFilter,
  setQuery,
  setSourceFilter,
  setStatusFilter,
  setTagFilter,
  sourceFilter,
  sourceOptions,
  statusFilter,
  statusOptions,
  tagFilter,
  tagOptions,
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_180px_180px_180px_180px]">
      <label className="block">
        <span className="label">Dosya adı, documentId veya kaynak ara</span>
        <div className="relative mt-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="field pl-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="örn. ders-notu, app-dashboard, app-2026..." />
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
        <span className="label">Kaynak</span>
        <select className="field mt-1" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
          <option value="all">Tüm kaynaklar</option>
          {sourceOptions.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="label">Favori</span>
        <select className="field mt-1" value={favoriteFilter} onChange={(event) => setFavoriteFilter(event.target.value)}>
          <option value="all">Tüm kayıtlar</option>
          <option value="favorites">Favoriler</option>
        </select>
      </label>

      <label className="block">
        <span className="label">Etiket</span>
        <select className="field mt-1" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
          <option value="all">Tüm etiketler</option>
          {tagOptions.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
