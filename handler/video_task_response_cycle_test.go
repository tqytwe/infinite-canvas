package handler

import (
	"encoding/json"
	"testing"
)

func TestVideoTaskEnvelopeDoesNotCreateRecursiveDataAlias(t *testing.T) {
	for _, input := range []string{
		`{"code":0,"data":{"id":"task-1","status":"failed"}}`,
		`{"code":0,"data":[{"id":"task-1","status":"failed"}]}`,
	} {
		var root any
		if err := json.Unmarshal([]byte(input), &root); err != nil {
			t.Fatal(err)
		}
		normalized := normalizeVideoPayloadMap(root)
		if _, exists := normalized["data"]; exists {
			t.Fatalf("envelope payload copied back into itself: %s", input)
		}
	}
}
