import {
  ArrowLeft,
  BadgeCheck,
  BookOpen,
  Brain,
  CheckCircle2,
  Circle,
  ClipboardList,
  FileText,
  Hash,
  Layers,
  ListChecks,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { Badge } from "../../../components/status";
import { displayStatus, parseRecordDate } from "../../../utils/format";
import { ExamMeta } from "../components/ExamMeta";

const EXAM_CONTRACT_PREVIEW = {
  examId: "exam-...",
  documentId: "doc-...",
  questions: [
    {
      type: "multiple_choice",
      question: "Dokümanın ana fikrini en iyi açıklayan seçenek hangisidir?",
      options: ["A seçeneği", "B seçeneği", "C seçeneği", "D seçeneği"],
      correctAnswer: "A",
      explanation: "Doğru cevap, dokümandaki ana kavramla doğrudan eşleşir.",
      difficulty: "medium",
      topic: "Ana kavram",
    },
  ],
  infoCards: [
    {
      title: "Temel kavram",
      summary: "Dokümandan çıkarılan kısa çalışma notu.",
      keyPoints: ["Önemli nokta", "Sınavda sorulabilecek detay"],
    },
  ],
};

const PREVIEW_QUESTIONS = [
  {
    question: "Dokümanın ana fikrini en iyi açıklayan seçenek hangisidir?",
    options: [
      "Dokümandaki temel kavramı ve amacı özetleyen seçenek",
      "Yalnızca dosya formatını açıklayan seçenek",
      "Konu dışı teknik ayrıntıya odaklanan seçenek",
      "Dokümanda geçmeyen bir varsayımı anlatan seçenek",
    ],
    correctAnswer: "A",
    explanation: "Gerçek AI çıktısı bağlandığında bu alan, doğru cevabın dokümandaki hangi bilgiye dayandığını gösterecek.",
    difficulty: "medium",
    topic: "Ana kavram",
    isPreview: true,
  },
  {
    question: "Bu dokümandan üretilecek sınavda hangi bilgi tipi öncelikli değerlendirilmelidir?",
    options: ["Tanım ve kavram ilişkileri", "Dosya adı uzunluğu", "Tarayıcı sekmesi sayısı", "Kullanıcının cihaz çözünürlüğü"],
    correctAnswer: "A",
    explanation: "Bu kart, gerçek soru JSON yapısının arayüzde nasıl görüneceğini göstermek için kullanılır.",
    difficulty: "easy",
    topic: "Öğrenme çıktısı",
    isPreview: true,
  },
];

const PREVIEW_INFO_CARDS = [
  {
    title: "Özet kartı",
    summary: "AI entegrasyonu tamamlandığında dokümandan çıkarılan kısa, tekrar edilebilir bilgi kartı burada yer alacak.",
    keyPoints: ["Ana kavram", "İlişkili açıklama", "Sınavda kullanılabilecek ipucu"],
    isPreview: true,
  },
  {
    title: "Çalışma ipucu",
    summary: "Öğrencinin sınava hazırlanırken önceliklendirmesi gereken kavramlar bu bölümde gösterilecek.",
    keyPoints: ["Kritik tanımlar", "Karşılaştırmalı başlıklar"],
    isPreview: true,
  },
];

export function ExamDetailPage({ exams }) {
  const { examKey } = useParams();
  const decodedExamKey = decodeURIComponent(examKey || "");
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const exam = exams.find((item) => item.id === decodedExamKey || item.examId === decodedExamKey || item.documentId === decodedExamKey);

  useEffect(() => {
    setSelectedAnswers({});
  }, [decodedExamKey]);

  if (!exam) {
    return (
      <section className="panel p-6">
        <Link className="btn btn-secondary mb-5" to="/app/exams">
          <ArrowLeft className="h-4 w-4" />
          Sınav arşivine dön
        </Link>
        <div className="rounded-lg border border-dashed border-space-line bg-black/20 p-8 text-center">
          <ClipboardList className="mx-auto h-10 w-10 text-muted" />
          <p className="mt-4 text-sm font-bold text-ink">Sınav kaydı bulunamadı.</p>
          <p className="mt-2 text-sm text-muted">Arşiv yenilendikten sonra kayıt değişmiş veya kaldırılmış olabilir.</p>
        </div>
      </section>
    );
  }

  const generatedQuestions = getGeneratedQuestions(exam);
  const generatedInfoCards = getGeneratedInfoCards(exam);
  const questionCards = generatedQuestions.length > 0 ? generatedQuestions : PREVIEW_QUESTIONS;
  const infoCards = generatedInfoCards.length > 0 ? generatedInfoCards : PREVIEW_INFO_CARDS;
  const hasGeneratedQuestions = generatedQuestions.length > 0;
  const hasGeneratedInfoCards = generatedInfoCards.length > 0;

  return (
    <div className="grid gap-5">
      <section className="app-hero">
        <div>
          <Link className="btn btn-secondary mb-5" to="/app/exams">
            <ArrowLeft className="h-4 w-4" />
            Sınav arşivine dön
          </Link>
          <p className="label">Sınav detayı</p>
          <h3 className="mt-2 break-words text-3xl font-black text-ink">{exam.title || "Oluşturulan sınav"}</h3>
          <p className="mt-3 break-all text-sm leading-6 text-muted">{exam.documentId || exam.id}</p>
        </div>
        <Badge tone={exam.status}>{displayStatus(exam.status || "recorded")}</Badge>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(300px,0.72fr)_minmax(0,1.28fr)]">
        <aside className="grid content-start gap-5">
          <section className="panel p-5">
            <p className="label">Metadata</p>
            <h3 className="section-title">Kayıt bilgileri</h3>
            <dl className="mt-5 grid gap-3">
              <ExamMeta label="examId" value={exam.examId || exam.id || "-"} />
              <ExamMeta label="documentId" value={exam.documentId || "-"} />
              <ExamMeta label="Validation" value={displayStatus(exam.validationResult || "-")} />
              <ExamMeta label="Durum" value={displayStatus(exam.status || "recorded")} />
              <ExamMeta label="Oluşturulma" value={parseRecordDate(exam.createdAt)} />
              <ExamMeta label="Güncelleme" value={parseRecordDate(exam.updatedAt)} />
            </dl>
          </section>

          <GenerationReadiness
            hasGeneratedInfoCards={hasGeneratedInfoCards}
            hasGeneratedQuestions={hasGeneratedQuestions}
            infoCardCount={generatedInfoCards.length}
            questionCount={generatedQuestions.length}
          />
        </aside>

        <main className="grid gap-5">
          <section className="panel glass-grid p-5">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="label">AI destekli sınav çıktısı</p>
                <h3 className="section-title">Çoktan seçmeli soru kartları</h3>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
                  Backend yapılandırılmış soru verisi döndürdüğünde bu alan gerçek sınav çıktısını gösterir. Henüz soru verisi yoksa arayüz, beklenen JSON contract yapısını örnek kartlarla gösterir.
                </p>
              </div>
              <StatusPill isReady={hasGeneratedQuestions} readyText={`${generatedQuestions.length} soru hazır`} waitingText="Contract önizlemesi" />
            </div>

            <div className="grid gap-4">
              {questionCards.map((question, index) => (
                <QuestionCard
                  key={`${normalizeQuestion(question).question}-${index}`}
                  index={index}
                  onSelect={(answer) => setSelectedAnswers((current) => ({ ...current, [index]: answer }))}
                  question={question}
                  selectedAnswer={selectedAnswers[index] || ""}
                />
              ))}
            </div>
          </section>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.75fr)]">
            <InfoCardsPanel cards={infoCards} hasGeneratedInfoCards={hasGeneratedInfoCards} />
            <AnswerKeyPanel questions={questionCards} selectedAnswers={selectedAnswers} />
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.75fr)]">
            <GenerationContractPanel exam={exam} />
            <ExamQualityPanel exam={exam} hasGeneratedQuestions={hasGeneratedQuestions} questionCount={generatedQuestions.length} />
          </div>
        </main>
      </div>
    </div>
  );
}

function GenerationReadiness({ hasGeneratedInfoCards, hasGeneratedQuestions, infoCardCount, questionCount }) {
  const items = [
    {
      icon: ListChecks,
      label: "Soru üretimi",
      value: hasGeneratedQuestions ? `${questionCount} soru alındı` : "Backend çıktısı bekleniyor",
      isReady: hasGeneratedQuestions,
    },
    {
      icon: BookOpen,
      label: "Bilgi kartları",
      value: hasGeneratedInfoCards ? `${infoCardCount} kart alındı` : "AI contract içinde planlandı",
      isReady: hasGeneratedInfoCards,
    },
    {
      icon: Brain,
      label: "AI entegrasyonu",
      value: "Ayrı backend görevi olarak ele alınmalı",
      isReady: false,
    },
  ];

  return (
    <section className="panel p-5">
      <p className="label">Üretim durumu</p>
      <h3 className="section-title">İçerik hazırlığı</h3>
      <div className="mt-5 grid gap-3">
        {items.map((item) => (
          <div className="rounded-lg border border-space-line bg-black/20 p-4" key={item.label}>
            <div className="flex items-start gap-3">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${item.isReady ? "border-neon-green/40 bg-neon-green/10 text-neon-green" : "border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan"}`}>
                <item.icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-ink">{item.label}</p>
                <p className="mt-1 break-words text-xs leading-5 text-muted">{item.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function QuestionCard({ index, onSelect, question, selectedAnswer }) {
  const normalized = normalizeQuestion(question);
  const correctAnswer = resolveCorrectAnswerLetter(normalized);
  const hasSelection = Boolean(selectedAnswer);
  const isSelectionCorrect = hasSelection && selectedAnswer === correctAnswer;

  return (
    <article className="rounded-lg border border-space-line bg-black/25 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 text-sm font-black text-neon-cyan">{index + 1}</span>
            {normalized.isPreview && <Badge tone="warning">Önizleme</Badge>}
            <Badge tone={normalized.difficulty}>{displayDifficulty(normalized.difficulty)}</Badge>
          </div>
          <h4 className="mt-3 break-words text-lg font-black text-ink">{normalized.question}</h4>
          <p className="mt-2 flex items-center gap-2 text-xs font-bold uppercase text-muted">
            <Hash className="h-4 w-4" />
            {normalized.topic}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        {normalized.options.map((option, optionIndex) => {
          const optionLetter = String.fromCharCode(65 + optionIndex);
          const isSelected = selectedAnswer === optionLetter;
          const isCorrect = correctAnswer === optionLetter;
          const stateClass = !hasSelection
            ? "border-space-line bg-black/20 hover:border-neon-cyan/45 hover:bg-neon-cyan/10"
            : isSelected && isCorrect
              ? "border-neon-green/45 bg-neon-green/10"
              : isSelected
                ? "border-danger/45 bg-danger/10"
                : isCorrect
                  ? "border-neon-green/45 bg-neon-green/10"
                  : "border-space-line bg-black/20 opacity-75";
          const letterClass = !hasSelection
            ? "bg-white/5 text-muted"
            : isSelected && isCorrect
              ? "bg-neon-green/20 text-neon-green"
              : isSelected
                ? "bg-danger/20 text-danger"
                : isCorrect
                  ? "bg-neon-green/20 text-neon-green"
                  : "bg-white/5 text-muted";
          return (
            <button
              aria-pressed={isSelected}
              className={`flex w-full gap-3 rounded-lg border p-3 text-left transition ${stateClass}`}
              key={`${optionLetter}-${option}`}
              onClick={() => onSelect(optionLetter)}
              type="button"
            >
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-black ${letterClass}`}>{optionLetter}</span>
              <p className="min-w-0 break-words text-sm leading-6 text-ink">{option}</p>
              {hasSelection && isSelected ? (
                isCorrect ? <CheckCircle2 className="ml-auto h-5 w-5 shrink-0 text-neon-green" /> : <XCircle className="ml-auto h-5 w-5 shrink-0 text-danger" />
              ) : hasSelection && isCorrect ? (
                <CheckCircle2 className="ml-auto h-5 w-5 shrink-0 text-neon-green" />
              ) : null}
            </button>
          );
        })}
      </div>

      {hasSelection ? (
        <div className={`mt-4 rounded-lg border p-3 ${isSelectionCorrect ? "border-neon-green/30 bg-neon-green/10" : "border-neon-amber/30 bg-neon-amber/10"}`}>
          <p className={`flex items-center gap-2 text-xs font-black uppercase ${isSelectionCorrect ? "text-neon-green" : "text-neon-amber"}`}>
            {isSelectionCorrect ? <CheckCircle2 className="h-4 w-4" /> : <BadgeCheck className="h-4 w-4" />}
            {isSelectionCorrect ? "Doğru cevap" : `Seçimin ${selectedAnswer}; doğru cevap ${correctAnswer}`}
          </p>
          <p className="mt-2 break-words text-sm leading-6 text-muted">{normalized.explanation}</p>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-space-line bg-black/20 p-3">
          <p className="flex items-center gap-2 text-xs font-black uppercase text-muted">
            <Circle className="h-4 w-4" />
            Cevabını işaretle
          </p>
          <p className="mt-2 break-words text-sm leading-6 text-muted">Bir seçenek seçtiğinde doğru cevap ve açıklama burada açılacak.</p>
        </div>
      )}
    </article>
  );
}

function InfoCardsPanel({ cards, hasGeneratedInfoCards }) {
  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label">Çalışma kartları</p>
          <h3 className="section-title">Bilgi kartları</h3>
        </div>
        <StatusPill isReady={hasGeneratedInfoCards} readyText={`${cards.length} kart hazır`} waitingText="Önizleme" />
      </div>
      <div className="mt-5 grid gap-3">
        {cards.map((card, index) => (
          <article className="rounded-lg border border-space-line bg-black/25 p-4" key={`${card.title}-${index}`}>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-neon-purple/40 bg-neon-purple/10 text-neon-purple">
                <Layers className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="break-words text-sm font-black text-ink">{card.title || `Bilgi kartı ${index + 1}`}</p>
                  {card.isPreview && <Badge tone="warning">Önizleme</Badge>}
                </div>
                <p className="mt-2 break-words text-sm leading-6 text-muted">{card.summary || card.text || "-"}</p>
                {Array.isArray(card.keyPoints) && card.keyPoints.length > 0 && (
                  <ul className="mt-3 grid gap-2">
                    {card.keyPoints.map((point) => (
                      <li className="flex gap-2 text-xs leading-5 text-muted" key={point}>
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-neon-green" />
                        <span className="break-words">{point}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function AnswerKeyPanel({ questions, selectedAnswers }) {
  const answeredCount = Object.keys(selectedAnswers).filter((key) => selectedAnswers[key]).length;
  const correctCount = questions.reduce((count, question, index) => {
    const normalized = normalizeQuestion(question);
    return selectedAnswers[index] === resolveCorrectAnswerLetter(normalized) ? count + 1 : count;
  }, 0);

  return (
    <section className="panel p-5">
      <p className="label">Değerlendirme</p>
      <h3 className="section-title">Yanıt durumu</h3>
      <p className="mt-2 text-sm leading-6 text-muted">
        {answeredCount}/{questions.length} soru işaretlendi. Doğru sayısı: {correctCount}.
      </p>
      <div className="mt-5 grid gap-2">
        {questions.map((question, index) => {
          const normalized = normalizeQuestion(question);
          const selected = selectedAnswers[index] || "";
          const correct = resolveCorrectAnswerLetter(normalized);
          const answered = Boolean(selected);
          const isCorrect = answered && selected === correct;
          return (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-space-line bg-black/20 p-3" key={`${normalized.question}-${index}`}>
              <span className="text-sm font-bold text-muted">Soru {index + 1}</span>
              <span className={`rounded-lg border px-3 py-1 text-sm font-black ${!answered ? "border-space-line bg-black/20 text-muted" : isCorrect ? "border-neon-green/40 bg-neon-green/10 text-neon-green" : "border-danger/40 bg-danger/10 text-danger"}`}>
                {answered ? `${selected} / ${correct}` : "Bekliyor"}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function GenerationContractPanel({ exam }) {
  const contract = {
    ...EXAM_CONTRACT_PREVIEW,
    examId: exam.examId || exam.id || EXAM_CONTRACT_PREVIEW.examId,
    documentId: exam.documentId || EXAM_CONTRACT_PREVIEW.documentId,
  };

  return (
    <section className="panel p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="label">Backend contract</p>
          <h3 className="section-title">Beklenen AI çıktısı</h3>
          <p className="mt-2 text-sm leading-6 text-muted">
            Exam Service ileride bu yapıda veri döndürdüğünde ekran otomatik olarak gerçek soru ve bilgi kartlarını gösterecek.
          </p>
        </div>
      </div>
      <pre className="mt-5 max-h-80 overflow-auto rounded-lg border border-space-line bg-black/40 p-4 text-xs leading-5 text-muted">
        {JSON.stringify(contract, null, 2)}
      </pre>
    </section>
  );
}

function ExamQualityPanel({ exam, hasGeneratedQuestions, questionCount }) {
  const qualityStatus = exam.qualityStatus;
  const issues = Array.isArray(exam.qualityIssues) ? exam.qualityIssues : [];
  const prefs = exam.generationPrefs || {};
  const hasQuality = Boolean(qualityStatus);
  const passed = qualityStatus === "passed";

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label">Kalite kontrol</p>
          <h3 className="section-title">Üretim kalite doğrulaması</h3>
        </div>
        {hasQuality && <Badge tone={passed ? "ok" : "warning"}>{passed ? "Doğrulandı" : "Sorun var"}</Badge>}
      </div>

      {hasQuality ? (
        <>
          <p className="mt-3 text-sm leading-6 text-muted">
            İstenen: {prefs.questionCount || "-"} soru · {displayDifficulty(prefs.difficulty)} · {prefs.infoCardCount ?? "-"} bilgi kartı. Üretilen: {questionCount} soru.
          </p>
          {passed ? (
            <div className="mt-4 flex items-center gap-3 rounded-lg border border-neon-green/35 bg-neon-green/10 p-3">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-neon-green" />
              <span className="text-sm font-bold text-ink">Tüm kalite kontrolleri geçti.</span>
            </div>
          ) : (
            <div className="mt-4 grid gap-2">
              {issues.map((issue, index) => (
                <div className="flex items-start gap-3 rounded-lg border border-neon-amber/35 bg-neon-amber/10 p-3" key={`${issue}-${index}`}>
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-neon-amber" />
                  <span className="break-words text-sm leading-5 text-ink">{issue}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="mt-2 text-sm leading-6 text-muted">
            Bu ekranda {questionCount > 0 ? `${questionCount} gerçek soru` : "henüz gerçek soru"} görüntüleniyor. Kalite doğrulaması backend üretimi tamamlandığında görünür.
          </p>
          <div className="mt-5 grid gap-2">
            {[
              { label: "Çoktan seçmeli soru yapısı", isReady: hasGeneratedQuestions },
              { label: "Doğru cevap alanı", isReady: hasGeneratedQuestions },
              { label: "Açıklama ve konu etiketi", isReady: hasGeneratedQuestions },
            ].map((check) => (
              <div className="flex items-center gap-3 rounded-lg border border-space-line bg-black/20 p-3" key={check.label}>
                <CheckCircle2 className={`h-4 w-4 shrink-0 ${check.isReady ? "text-neon-green" : "text-muted"}`} />
                <span className="text-sm font-bold text-ink">{check.label}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function StatusPill({ isReady, readyText, waitingText }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-black ${isReady ? "border-neon-green/40 bg-neon-green/10 text-neon-green" : "border-neon-amber/40 bg-neon-amber/10 text-neon-amber"}`}>
      <FileText className="h-4 w-4" />
      {isReady ? readyText : waitingText}
    </span>
  );
}

function getGeneratedQuestions(exam) {
  const candidates = [
    exam.questions,
    exam.multipleChoiceQuestions,
    exam.questionCards,
    exam.items,
    exam.content?.questions,
    exam.generatedContent?.questions,
    exam.result?.questions,
  ];

  return candidates.find((candidate) => Array.isArray(candidate) && candidate.length > 0) || [];
}

function getGeneratedInfoCards(exam) {
  const candidates = [exam.infoCards, exam.cards, exam.studyCards, exam.content?.infoCards, exam.generatedContent?.infoCards, exam.result?.infoCards];

  return candidates.find((candidate) => Array.isArray(candidate) && candidate.length > 0) || [];
}

function normalizeQuestion(question) {
  const options = question.options || question.choices || question.answers || [];
  return {
    correctAnswer: question.correctAnswer ?? question.answer ?? question.correctOption ?? "-",
    difficulty: question.difficulty || question.level || "medium",
    explanation: question.explanation || question.rationale || "Açıklama alanı backend çıktısında bekleniyor.",
    isPreview: Boolean(question.isPreview),
    options: Array.isArray(options) && options.length > 0 ? options : ["Seçenek A", "Seçenek B", "Seçenek C", "Seçenek D"],
    question: question.question || question.prompt || question.text || "Soru metni backend çıktısında bekleniyor.",
    topic: question.topic || question.tag || question.learningOutcome || "Konu etiketi",
  };
}

function resolveCorrectAnswerLetter(question) {
  const raw = question.correctAnswer;
  if (typeof raw === "number") {
    return String.fromCharCode(65 + raw);
  }

  const rawText = String(raw || "").trim();
  const upper = rawText.toUpperCase();
  if (["A", "B", "C", "D"].includes(upper)) {
    return upper;
  }

  const optionIndex = question.options.findIndex((option) => String(option).trim().toLowerCase() === rawText.toLowerCase());
  if (optionIndex >= 0) {
    return String.fromCharCode(65 + optionIndex);
  }

  return upper || "-";
}

function displayDifficulty(difficulty) {
  const value = String(difficulty || "").toLowerCase();
  if (value === "easy") return "Kolay";
  if (value === "hard") return "Zor";
  if (value === "medium") return "Orta";
  return difficulty || "-";
}
