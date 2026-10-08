package service

import (
	"crypto/sha256"
	"fmt"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

// ClaimStarframeVideoTask persists the task and credit debit in the same
// transaction. A claim is never reclaimed, even after deletion or an unknown
// network outcome: replaying a paid POST is not a recovery strategy.
func ClaimStarframeVideoTask(input VideoTaskCreateInput) (model.VideoTask, bool, error) {
	if strings.TrimSpace(input.ClientTaskID) == "" || strings.TrimSpace(input.UserID) == "" {
		return model.VideoTask{}, false, fmt.Errorf("缺少原视频任务 ID")
	}
	digest := fmt.Sprintf("%x", sha256.Sum256([]byte(input.RequestBody)))
	task := model.VideoTask{ID: input.ClientTaskID, UserID: input.UserID, UserDisplayName: input.UserDisplayName, Model: input.Model, ChannelID: input.ChannelID, UserChannelID: input.UserChannelID, ChannelName: input.ChannelName, Source: normalizeVideoTaskSource(input.Source), SourceID: input.SourceID, Status: "submission_unknown", RequestBody: input.RequestBody, RequestHash: digest, SubmissionClaim: true, Credits: normalizeCredits(input.Credits), CreatedAt: now(), UpdatedAt: now()}
	err := ConsumeUserCredits(input.UserID, input.Model, input.Credits, "/videos", &task)
	if err == nil {
		return task, true, nil
	}
	existing, found, readErr := repository.GetVideoTask(input.ClientTaskID)
	if readErr != nil {
		return task, false, readErr
	}
	if !found {
		return task, false, err
	}
	if !existing.SubmissionClaim || existing.UserID != task.UserID || existing.Model != task.Model || existing.ChannelID != task.ChannelID || existing.UserChannelID != task.UserChannelID || existing.RequestHash != digest {
		return task, false, fmt.Errorf("视频任务归属或请求与原提交不一致")
	}
	return existing, false, nil
}

func CompleteStarframeVideoTask(task model.VideoTask, input VideoTaskCreateInput) (model.VideoTask, error) {
	task.UpstreamTaskID, task.UpstreamVideoID = input.UpstreamTaskID, input.UpstreamVideoID
	task.Status, task.Progress = NormalizeVideoTaskStatus(input.Status), input.Progress
	task.Seconds, task.Size, task.VideoURL = input.Seconds, input.Size, input.VideoURL
	task.Error, task.ErrorDetail = input.Error, input.ErrorDetail
	task.ResponseBody, task.LastResponse = input.ResponseBody, input.ResponseBody
	task.UpdatedAt = now()
	if IsCompletedVideoTaskStatus(task.Status) || IsFailedVideoTaskStatus(task.Status) {
		task.CompletedAt = now()
	}
	err := repository.CompleteClaimedVideoTask(task)
	if err == nil && !IsCompletedVideoTaskStatus(task.Status) && !IsFailedVideoTaskStatus(task.Status) {
		WakeVideoTaskPoller()
	}
	return task, err
}
