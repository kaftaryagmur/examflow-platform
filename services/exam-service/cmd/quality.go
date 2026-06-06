package main

import (
	"fmt"
	"strings"
)

// resolveGenerationPrefs fills defaults and clamps values for preferences that
// may be missing (older documents) or out of range.
func resolveGenerationPrefs(p GenerationPrefs) GenerationPrefs {
	out := p
	if out.QuestionCount <= 0 {
		out.QuestionCount = defaultQuestionCount
	}
	if out.QuestionCount > maxQuestionCount {
		out.QuestionCount = maxQuestionCount
	}
	if out.InfoCardCount < 0 {
		out.InfoCardCount = 0
	}
	if out.InfoCardCount == 0 {
		out.InfoCardCount = defaultInfoCardCount
	}
	if out.InfoCardCount > maxInfoCardCount {
		out.InfoCardCount = maxInfoCardCount
	}
	out.Difficulty = normalizeDifficulty(out.Difficulty)
	out.Focus = strings.TrimSpace(out.Focus)
	return out
}

func normalizeDifficulty(d string) string {
	switch strings.ToLower(strings.TrimSpace(d)) {
	case difficultyEasy, difficultyMedium, difficultyHard, difficultyMixed:
		return strings.ToLower(strings.TrimSpace(d))
	default:
		return difficultyMixed
	}
}

// evaluateExamQuality checks generated content against the requested prefs and
// per-question completeness, returning a pass/fail status plus specific issues.
// SCRUM-92: the result is persisted on the exam so invalid output is visible
// rather than silently accepted.
func evaluateExamQuality(content GeneratedContent, prefs GenerationPrefs) (string, []string) {
	var issues []string

	if len(content.Questions) < prefs.QuestionCount {
		issues = append(issues, fmt.Sprintf("istenen %d soruya karşılık %d soru üretildi", prefs.QuestionCount, len(content.Questions)))
	}

	for i, q := range content.Questions {
		n := i + 1
		if len(q.Options) != 4 {
			issues = append(issues, fmt.Sprintf("soru %d: 4 seçenek olmalı (%d var)", n, len(q.Options)))
		}
		answer := strings.ToUpper(strings.TrimSpace(q.CorrectAnswer))
		if answer != "A" && answer != "B" && answer != "C" && answer != "D" {
			issues = append(issues, fmt.Sprintf("soru %d: doğru cevap A-D olmalı (%q)", n, q.CorrectAnswer))
		}
		if strings.TrimSpace(q.Explanation) == "" {
			issues = append(issues, fmt.Sprintf("soru %d: açıklama eksik", n))
		}
		if strings.TrimSpace(q.Topic) == "" {
			issues = append(issues, fmt.Sprintf("soru %d: konu etiketi eksik", n))
		}

		difficulty := strings.ToLower(strings.TrimSpace(q.Difficulty))
		switch difficulty {
		case difficultyEasy, difficultyMedium, difficultyHard:
			if prefs.Difficulty != difficultyMixed && difficulty != prefs.Difficulty {
				issues = append(issues, fmt.Sprintf("soru %d: zorluk %q istendi, %q geldi", n, prefs.Difficulty, difficulty))
			}
		default:
			issues = append(issues, fmt.Sprintf("soru %d: geçersiz zorluk (%q)", n, q.Difficulty))
		}
	}

	if len(content.InfoCards) < prefs.InfoCardCount {
		issues = append(issues, fmt.Sprintf("istenen %d bilgi kartına karşılık %d kart üretildi", prefs.InfoCardCount, len(content.InfoCards)))
	}

	if len(issues) == 0 {
		return qualityStatusPassed, nil
	}
	return qualityStatusFailed, issues
}
