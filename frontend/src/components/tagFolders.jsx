import { Folder, Tag } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "./status";

export function TagFolderPanel({ folders, onSelect, selectedTag = "all", title = "Etiket klasorleri" }) {
  if (!folders.length) return null;

  return (
    <section className="panel p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label">Dosyalama</p>
          <h3 className="section-title">{title}</h3>
        </div>
        <Badge tone="ok">{folders.length} klasor</Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {folders.map((folder) => {
          const active = selectedTag === folder.tag;
          const content = (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan">
                  <Folder className="h-5 w-5" />
                </div>
                <Badge tone={active ? "ready" : "idle"}>{folder.total} kayit</Badge>
              </div>
              <p className="mt-3 flex items-center gap-2 break-all text-sm font-black text-ink">
                <Tag className="h-4 w-4 shrink-0 text-neon-cyan" />
                {folder.tag}
              </p>
              <p className="mt-2 text-xs text-muted">{folder.detail}</p>
              {folder.documentTo || folder.examTo ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {folder.documentTo ? (
                    <Link className="btn btn-secondary" to={folder.documentTo}>
                      Dokumanlar
                    </Link>
                  ) : null}
                  {folder.examTo ? (
                    <Link className="btn btn-secondary" to={folder.examTo}>
                      Sinavlar
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </>
          );

          if (folder.to) {
            return (
              <Link className={`rounded-lg border p-4 transition ${active ? "border-neon-cyan/60 bg-neon-cyan/10" : "border-space-line bg-black/25 hover:border-neon-cyan/50 hover:bg-neon-cyan/5"}`} key={folder.tag} to={folder.to}>
                {content}
              </Link>
            );
          }

          if (onSelect) {
            return (
              <button className={`rounded-lg border p-4 text-left transition ${active ? "border-neon-cyan/60 bg-neon-cyan/10" : "border-space-line bg-black/25 hover:border-neon-cyan/50 hover:bg-neon-cyan/5"}`} key={folder.tag} onClick={() => onSelect(folder.tag)} type="button">
                {content}
              </button>
            );
          }

          return (
            <article className="rounded-lg border border-space-line bg-black/25 p-4" key={folder.tag}>
              {content}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function buildTagFolders(records, detailForCount) {
  const counts = new Map();
  records.forEach((record) => {
    (Array.isArray(record.tags) ? record.tags : []).forEach((tag) => {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    });
  });

  return Array.from(counts.entries())
    .map(([tag, total]) => ({ detail: detailForCount(total), tag, total }))
    .sort((a, b) => b.total - a.total || a.tag.localeCompare(b.tag));
}
