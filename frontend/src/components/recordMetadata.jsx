import { Plus, Star, Tag, X } from "lucide-react";
import { useState } from "react";

export function RecordMetadataControls({
  busy,
  onChange,
  record,
  size = "normal",
  type = "record",
}) {
  const [tagInput, setTagInput] = useState("");
  const tags = normalizeTags(record?.tags);
  const isFavorite = Boolean(record?.favorite);
  const disabled = Boolean(busy);
  const compact = size === "compact";

  function submitTag(event) {
    event.preventDefault();
    const nextTag = cleanTag(tagInput);
    if (!nextTag || tags.includes(nextTag)) {
      setTagInput("");
      return;
    }
    onChange?.({ favorite: isFavorite, tags: [...tags, nextTag] });
    setTagInput("");
  }

  function removeTag(tag) {
    onChange?.({ favorite: isFavorite, tags: tags.filter((item) => item !== tag) });
  }

  function toggleFavorite() {
    onChange?.({ favorite: !isFavorite, tags });
  }

  return (
    <div className={`grid gap-3 ${compact ? "" : "rounded-lg border border-space-line bg-black/20 p-3"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          aria-pressed={isFavorite}
          className={`btn ${isFavorite ? "btn-primary" : "btn-secondary"}`}
          disabled={disabled}
          onClick={toggleFavorite}
          title={isFavorite ? "Favorilerden çıkar" : "Favorilere ekle"}
          type="button"
        >
          <Star className={`h-4 w-4 ${isFavorite ? "fill-current" : ""}`} />
          {isFavorite ? "Favori" : "Favoriye ekle"}
        </button>

        {tags.length ? (
          <div className="flex min-w-0 flex-wrap gap-2">
            {tags.map((tag) => (
              <span className="inline-flex max-w-full items-center gap-1 rounded-lg border border-neon-cyan/35 bg-neon-cyan/10 px-2 py-1 text-xs font-black text-neon-cyan" key={tag}>
                <Tag className="h-3.5 w-3.5 shrink-0" />
                <span className="break-all">{tag}</span>
                <button
                  className="rounded-md p-0.5 text-neon-cyan transition hover:bg-neon-cyan/15"
                  disabled={disabled}
                  onClick={() => removeTag(tag)}
                  title="Etiketi kaldır"
                  type="button"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <span className="text-xs font-bold text-muted">Etiket yok</span>
        )}
      </div>

      <form className={`grid gap-2 ${compact ? "sm:grid-cols-[minmax(160px,1fr)_auto]" : "sm:grid-cols-[minmax(180px,1fr)_auto]"}`} onSubmit={submitTag}>
        <input
          className="field"
          disabled={disabled}
          maxLength={32}
          onChange={(event) => setTagInput(event.target.value)}
          placeholder={`${type === "exam" ? "Sınav" : "Doküman"} etiketi`}
          value={tagInput}
        />
        <button className="btn btn-secondary" disabled={disabled || !cleanTag(tagInput)} type="submit">
          <Plus className="h-4 w-4" />
          Ekle
        </button>
      </form>
    </div>
  );
}

export function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.map(cleanTag).filter(Boolean);
}

function cleanTag(tag) {
  return String(tag || "").trim().replace(/^#+/, "").toLowerCase();
}
