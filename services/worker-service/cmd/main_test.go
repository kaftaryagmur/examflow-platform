package main

import "testing"

func TestProcessEventBuildsVisibleResult(t *testing.T) {
	result := processEvent(Event{
		DocumentID: "doc-7",
		FileName:   "lecture-1.pdf",
	})

	if result.DocumentID != "doc-7" {
		t.Fatalf("expected doc-7, got %s", result.DocumentID)
	}
	if result.Status != "processed" {
		t.Fatalf("expected processed status, got %s", result.Status)
	}
	if result.SummaryPreview == "" {
		t.Fatal("expected summary preview to be populated")
	}
}
