package model

import (
	"encoding/json"
	"testing"
)

func TestModelChannelClassificationJSONRoundTrip(t *testing.T) {
	for _, channel := range []any{&ModelChannel{}, &PublicModelChannelInfo{}} {
		if err := json.Unmarshal([]byte(`{"id":"video","models":["custom-name"],"modelCapabilities":{"custom-name":"video"}}`), channel); err != nil {
			t.Fatal(err)
		}
		encoded, err := json.Marshal(channel)
		if err != nil {
			t.Fatal(err)
		}
		var result struct {
			ModelCapabilities map[string]string `json:"modelCapabilities"`
		}
		if err := json.Unmarshal(encoded, &result); err != nil {
			t.Fatal(err)
		}
		if result.ModelCapabilities["custom-name"] != "video" {
			t.Fatalf("%T lost explicit classification: %s", channel, encoded)
		}
	}
}
