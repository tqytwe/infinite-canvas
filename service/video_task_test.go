package service

import (
	"errors"
	"testing"

	"github.com/tigerowo/infinite-canvas/model"
)

func TestVideoTaskPollErrorClassifiesPermanentChannelFailures(t *testing.T) {
	permanent := videoTaskPollErrorUpdate(model.VideoTask{Status: "processing"}, errors.New("本地渠道不支持该模型"))
	if permanent.Status != "failed" || permanent.Error == "" {
		t.Fatalf("permanent poll error = %#v, want failed with error", permanent)
	}
	transient := videoTaskPollErrorUpdate(model.VideoTask{Status: "processing", Progress: 42}, errors.New("dial tcp: connection reset by peer"))
	if transient.Status != "processing" || transient.Error != "" || transient.Progress != 42 {
		t.Fatalf("transient poll error = %#v, want preserved processing state", transient)
	}
}

func TestNormalizeVideoTaskStatusUnknownValuesStayProcessing(t *testing.T) {
	if got := NormalizeVideoTaskStatus("provider_specific_pending"); got != "processing" {
		t.Fatalf("unknown status = %q, want processing", got)
	}
}
