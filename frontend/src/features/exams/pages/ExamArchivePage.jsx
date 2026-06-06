import { Activity, ClipboardList, Database, Loader2, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "../../../components/status";
import { displayStatus, parseRecordDate, sortRecordsByDate, toneClass } from "../../../utils/format";
import { EmptyExamState } from "../components/EmptyExamState";
import { ExamArchiveCard } from "../components/ExamArchiveCard";
import { ExamFilters } from "../components/ExamFilters";

export function ExamArchivePage({ busy, exams }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [validationFilter, setValidationFilter] = useState("all");

  const recentExams = useMemo(() => sortRecordsByDate(exams), [exams]);
  const statusOptions = useMemo(() => Array.from(new Set(exams.map((exam) => exam.status).filter(Boolean))).sort(), [exams]);
  const validationOptions = useMemo(() => Array.from(new Set(exams.map((exam) => exam.validationResult).filter(Boolean))).sort(), [exams]);
  const filteredExams = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return recentExams.filter((exam) => {
      const searchable = [exam.title, exam.documentId, exam.id, exam.status, exam.validationResult].filter(Boolean).join(" ").toLowerCase();
      const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
      const matchesStatus = statusFilter === "all" || exam.status === statusFilter;
      const matchesValidation = validationFilter === "all" || exam.validationResult === validationFilter;
      return matchesQuery && matchesStatus && matchesValidation;
    });
  }, [query, recentExams, statusFilter, validationFilter]);

  const latestExam = recentExams[0];
  const validCount = exams.filter((exam) => String(exam.validationResult || exam.status || "").toLowerCase().includes("valid")).length;
  const failedCount = exams.filter((exam) => ["failed", "invalid", "error"].includes(String(exam.validationResult || exam.status || "").toLowerCase())).length;
  const linkedDocuments = new Set(exams.map((exam) => exam.documentId).filter(Boolean)).size;

  return (
    <div className="grid gap-5">
      <section className="app-hero">
        <div>
          <p className="label">Sınav arşivi</p>
          <h3 className="mt-2 text-3xl font-black text-ink">Üretilen sınav kayıtlarını kalite ve kaynak bilgisiyle izle.</h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
            Exam Service tarafından oluşturulan sınav kayıtları burada listelenir. Her kayıt bağlı olduğu doküman, validation sonucu ve işlem zamanı ile takip edilir.
          </p>
        </div>
        <Badge tone={exams.length ? "ok" : "idle"}>{exams.length} sınav</Badge>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ExamInsightCard icon={ClipboardList} title="Toplam sınav" value={exams.length} tone="ok" detail="exams collection" />
        <ExamInsightCard icon={ShieldCheck} title="Valid kayıt" value={validCount} tone={validCount ? "ready" : "idle"} detail="validation sonucu" />
        <ExamInsightCard icon={Activity} title="Hatalı kayıt" value={failedCount} tone={failedCount ? "failed" : "ok"} detail="failed / invalid" />
        <ExamInsightCard icon={Database} title="Bağlı doküman" value={linkedDocuments} tone={linkedDocuments ? "ok" : "idle"} detail={latestExam ? parseRecordDate(latestExam.updatedAt || latestExam.createdAt) : "Henüz kayıt yok"} />
      </div>

      <section className="panel p-5">
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="label">Arama ve filtreler</p>
            <h3 className="section-title">Sınav kayıtları</h3>
          </div>
          <Badge tone={filteredExams.length ? "ok" : "idle"}>{filteredExams.length} sonuç</Badge>
        </div>

        <ExamFilters
          query={query}
          setQuery={setQuery}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          statusOptions={statusOptions}
          validationFilter={validationFilter}
          setValidationFilter={setValidationFilter}
          validationOptions={validationOptions}
        />

        {busy === "archive" ? (
          <div className="mt-5 flex items-center gap-2 rounded-lg border border-neon-cyan/30 bg-neon-cyan/10 p-4 text-sm font-semibold text-neon-cyan">
            <Loader2 className="h-4 w-4 animate-spin" />
            Sınav arşivi yenileniyor.
          </div>
        ) : null}

        <div className="mt-5 grid gap-3">
          {filteredExams.length ? (
            filteredExams.map((exam) => <ExamArchiveCard key={exam.id || exam.examId || `${exam.documentId}-${exam.createdAt}`} exam={exam} />)
          ) : (
            <EmptyExamState hasExams={exams.length > 0} />
          )}
        </div>
      </section>
    </div>
  );
}

function ExamInsightCard({ detail, icon: Icon, title, value, tone }) {
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
