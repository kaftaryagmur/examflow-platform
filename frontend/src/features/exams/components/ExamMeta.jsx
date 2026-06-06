export function ExamMeta({ label, value }) {
  return (
    <div className="rounded-lg border border-space-line bg-black/20 p-3">
      <dt className="label">{label}</dt>
      <dd className="mt-1 break-words font-semibold text-ink">{value}</dd>
    </div>
  );
}
