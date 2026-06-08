import { Activity, Database, FileText, Loader2, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Badge } from "../../../components/status";
import { TagFolderPanel, buildTagFolders } from "../../../components/tagFolders";
import { displayStatus, parseRecordDate, sortRecordsByDate, toneClass } from "../../../utils/format";
import { DocumentArchiveCard } from "../components/DocumentArchiveCard";
import { DocumentFilters } from "../components/DocumentFilters";
import { EmptyArchiveState } from "../components/EmptyArchiveState";

export function DocumentArchivePage({ busy, documents, onUpdateMetadata }) {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [favoriteFilter, setFavoriteFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState(() => searchParams.get("tag") || "all");

  const recentDocuments = useMemo(() => sortRecordsByDate(documents), [documents]);
  const statusOptions = useMemo(() => Array.from(new Set(documents.map((document) => document.status).filter(Boolean))).sort(), [documents]);
  const sourceOptions = useMemo(() => Array.from(new Set(documents.map((document) => document.source).filter(Boolean))).sort(), [documents]);
  const tagOptions = useMemo(() => Array.from(new Set(documents.flatMap((document) => (Array.isArray(document.tags) ? document.tags : [])).filter(Boolean))).sort(), [documents]);
  const tagFolders = useMemo(() => buildTagFolders(documents, (count) => `${count} dokuman`), [documents]);

  useEffect(() => {
    setTagFilter(searchParams.get("tag") || "all");
  }, [searchParams]);
  const filteredDocuments = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return recentDocuments.filter((document) => {
      const tags = Array.isArray(document.tags) ? document.tags : [];
      const searchable = [document.fileName, document.title, document.documentId, document.source, document.status, ...tags].filter(Boolean).join(" ").toLowerCase();
      const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
      const matchesStatus = statusFilter === "all" || document.status === statusFilter;
      const matchesSource = sourceFilter === "all" || document.source === sourceFilter;
      const matchesFavorite = favoriteFilter === "all" || Boolean(document.favorite);
      const matchesTag = tagFilter === "all" || tags.includes(tagFilter);
      return matchesQuery && matchesStatus && matchesSource && matchesFavorite && matchesTag;
    });
  }, [favoriteFilter, query, recentDocuments, sourceFilter, statusFilter, tagFilter]);

  const latestDocument = recentDocuments[0];
  const processedCount = documents.filter((document) => ["processed", "validated", "ready", "accepted", "uploaded"].includes(String(document.status || "").toLowerCase())).length;
  const uniqueSources = sourceOptions.length;

  return (
    <div className="grid gap-5">
      <section className="app-hero">
        <div>
          <p className="label">Doküman arşivi</p>
          <h3 className="mt-2 text-3xl font-black text-ink">Yüklenen dokümanları izlenebilir bir ürün arşivinde yönet.</h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
            Bu ekran, kullanıcıya ait doküman kayıtlarını backend arşivinden okur; durum, kaynak ve tarih bilgileriyle hızlı kontrol sağlar.
          </p>
        </div>
        <Badge tone={documents.length ? "ok" : "idle"}>{documents.length} doküman</Badge>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ArchiveInsightCard icon={FileText} title="Toplam kayıt" value={documents.length} tone="ok" detail="documents collection" />
        <ArchiveInsightCard icon={Activity} title="İşlenen kayıt" value={processedCount} tone={processedCount ? "ready" : "idle"} detail="event akışından dönenler" />
        <ArchiveInsightCard icon={SlidersHorizontal} title="Kaynak sayısı" value={uniqueSources} tone={uniqueSources ? "ok" : "idle"} detail="source alanına göre" />
        <ArchiveInsightCard icon={Database} title="Son doküman" value={latestDocument ? parseRecordDate(latestDocument.updatedAt || latestDocument.createdAt) : "-"} tone={latestDocument?.status || "idle"} detail={latestDocument?.fileName || "Henüz kayıt yok"} />
      </div>

      <TagFolderPanel folders={tagFolders} onSelect={setTagFilter} selectedTag={tagFilter} />

      <section className="panel p-5">
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="label">Arama ve filtreler</p>
            <h3 className="section-title">Doküman kayıtları</h3>
          </div>
          <Badge tone={filteredDocuments.length ? "ok" : "idle"}>{filteredDocuments.length} sonuç</Badge>
        </div>

        <DocumentFilters
          query={query}
          setQuery={setQuery}
          sourceFilter={sourceFilter}
          setSourceFilter={setSourceFilter}
          sourceOptions={sourceOptions}
          favoriteFilter={favoriteFilter}
          setFavoriteFilter={setFavoriteFilter}
          tagFilter={tagFilter}
          setTagFilter={setTagFilter}
          tagOptions={tagOptions}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          statusOptions={statusOptions}
        />

        {busy === "archive" ? (
          <div className="mt-5 flex items-center gap-2 rounded-lg border border-neon-cyan/30 bg-neon-cyan/10 p-4 text-sm font-semibold text-neon-cyan">
            <Loader2 className="h-4 w-4 animate-spin" />
            Doküman arşivi yenileniyor.
          </div>
        ) : null}

        <div className="mt-5 grid gap-3">
          {filteredDocuments.length ? (
            filteredDocuments.map((document) => <DocumentArchiveCard busy={busy} key={document.id || `${document.documentId}-${document.createdAt}`} document={document} onUpdateMetadata={onUpdateMetadata} />)
          ) : (
            <EmptyArchiveState hasDocuments={documents.length > 0} />
          )}
        </div>
      </section>
    </div>
  );
}

function ArchiveInsightCard({ detail, icon: Icon, title, value, tone }) {
  return (
    <article className="panel p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="label">{title}</p>
          <p className="mt-3 text-2xl font-black text-ink">{value}</p>
          {detail ? <p className="mt-1 truncate text-xs text-muted">{detail}</p> : null}
        </div>
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border ${toneClass(tone)}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </article>
  );
}
