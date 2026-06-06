package main

import "testing"

func TestResolveGenerationPrefsDefaults(t *testing.T) {
	out := resolveGenerationPrefs(GenerationPrefs{})
	if out.QuestionCount != defaultQuestionCount {
		t.Fatalf("expected default question count %d, got %d", defaultQuestionCount, out.QuestionCount)
	}
	if out.InfoCardCount != defaultInfoCardCount {
		t.Fatalf("expected default info card count %d, got %d", defaultInfoCardCount, out.InfoCardCount)
	}
	if out.Difficulty != difficultyMixed {
		t.Fatalf("expected default difficulty mixed, got %q", out.Difficulty)
	}
}

func TestResolveGenerationPrefsClamps(t *testing.T) {
	out := resolveGenerationPrefs(GenerationPrefs{QuestionCount: 999, InfoCardCount: 999, Difficulty: "EASY", Focus: "  konu  "})
	if out.QuestionCount != maxQuestionCount {
		t.Fatalf("expected clamp to %d, got %d", maxQuestionCount, out.QuestionCount)
	}
	if out.InfoCardCount != maxInfoCardCount {
		t.Fatalf("expected clamp to %d, got %d", maxInfoCardCount, out.InfoCardCount)
	}
	if out.Difficulty != difficultyEasy {
		t.Fatalf("expected normalized easy, got %q", out.Difficulty)
	}
	if out.Focus != "konu" {
		t.Fatalf("expected trimmed focus, got %q", out.Focus)
	}
}

func TestEvaluateExamQualityPasses(t *testing.T) {
	content := GeneratedContent{
		Questions: []ExamQuestion{
			{Question: "Q1", Options: []string{"A", "B", "C", "D"}, CorrectAnswer: "A", Explanation: "E", Difficulty: "hard", Topic: "T"},
			{Question: "Q2", Options: []string{"A", "B", "C", "D"}, CorrectAnswer: "B", Explanation: "E", Difficulty: "hard", Topic: "T"},
		},
		InfoCards: []ExamInfoCard{{Title: "C", Summary: "S"}},
	}
	status, issues := evaluateExamQuality(content, GenerationPrefs{QuestionCount: 2, Difficulty: "hard", InfoCardCount: 1})
	if status != qualityStatusPassed || len(issues) != 0 {
		t.Fatalf("expected passed with no issues, got %q %v", status, issues)
	}
}

func TestEvaluateExamQualityFlagsCountCompletenessAndDifficulty(t *testing.T) {
	content := GeneratedContent{
		Questions: []ExamQuestion{
			{Question: "Q1", Options: []string{"A", "B", "C"}, CorrectAnswer: "Z", Explanation: "", Difficulty: "easy", Topic: ""},
		},
	}
	status, issues := evaluateExamQuality(content, GenerationPrefs{QuestionCount: 3, Difficulty: "hard", InfoCardCount: 2})
	if status != qualityStatusFailed {
		t.Fatalf("expected failed, got %q", status)
	}
	// too few questions, bad options, bad answer, missing explanation, missing topic,
	// difficulty mismatch, too few info cards
	if len(issues) < 5 {
		t.Fatalf("expected several issues, got %d: %v", len(issues), issues)
	}
}

func TestEvaluateExamQualityAllowsAnyLevelWhenMixed(t *testing.T) {
	content := GeneratedContent{
		Questions: []ExamQuestion{
			{Question: "Q1", Options: []string{"A", "B", "C", "D"}, CorrectAnswer: "A", Explanation: "E", Difficulty: "easy", Topic: "T"},
			{Question: "Q2", Options: []string{"A", "B", "C", "D"}, CorrectAnswer: "C", Explanation: "E", Difficulty: "hard", Topic: "T"},
		},
		InfoCards: []ExamInfoCard{{Title: "C", Summary: "S"}},
	}
	status, issues := evaluateExamQuality(content, GenerationPrefs{QuestionCount: 2, Difficulty: difficultyMixed, InfoCardCount: 1})
	if status != qualityStatusPassed {
		t.Fatalf("expected mixed difficulty to pass with varied levels, got %q %v", status, issues)
	}
}
