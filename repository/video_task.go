package repository

import (
	"errors"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func SaveVideoTask(task model.VideoTask) (model.VideoTask, error) {
	db, err := DB()
	if err != nil {
		return task, err
	}
	return task, db.Save(&task).Error
}

func GetVideoTask(id string) (model.VideoTask, bool, error) {
	db, err := DB()
	if err != nil {
		return model.VideoTask{}, false, err
	}
	var task model.VideoTask
	err = db.First(&task, "id = ?", id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.VideoTask{}, false, nil
		}
		return model.VideoTask{}, false, err
	}
	return task, true, nil
}

func GetUserVideoTask(userID string, id string) (model.VideoTask, bool, error) {
	db, err := DB()
	if err != nil {
		return model.VideoTask{}, false, err
	}
	var task model.VideoTask
	err = db.First(&task, "user_id = ? AND (id = ? OR upstream_task_id = ? OR upstream_video_id = ?)", userID, id, id, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.VideoTask{}, false, nil
		}
		return model.VideoTask{}, false, err
	}
	return task, true, nil
}

func ListUserVideoTasks(userID string, source string, limit int) ([]model.VideoTask, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 100
	}
	var tasks []model.VideoTask
	query := db.Where("user_id = ? AND hidden = ?", userID, false)
	if source != "" {
		if source == "video-workbench" {
			query = query.Where("(source = ? OR source = '' OR source IS NULL)", source)
		} else {
			query = query.Where("source = ?", source)
		}
	}
	err = query.
		Where("status IN ?", []string{"queued", "in_progress", "processing", "running"}).
		Order("created_at DESC").
		Limit(limit).
		Find(&tasks).Error
	return tasks, err
}

func DeleteUserVideoTask(userID string, id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		scope := "user_id = ? AND (id = ? OR upstream_task_id = ? OR upstream_video_id = ?)"
		if err := tx.Model(&model.VideoTask{}).Where(scope, userID, id, id, id).Where("submission_claim = ?", true).Update("hidden", true).Error; err != nil {
			return err
		}
		return tx.Where(scope, userID, id, id, id).Where("submission_claim = ?", false).Delete(&model.VideoTask{}).Error
	})
}

func ListDueVideoTasks(limit int) ([]model.VideoTask, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 100
	}
	var tasks []model.VideoTask
	err = db.Where("status IN ?", []string{"queued", "in_progress", "processing", "running"}).Where("(workflow_ref = '' OR workflow_ref IS NULL)").
		Order("created_at ASC").
		Limit(limit).
		Find(&tasks).Error
	return tasks, err
}

func DeleteFinishedVideoTasksBefore(before string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.
		Where("completed_at <> ? AND completed_at < ?", "", before).
		Where("submission_claim = ?", false).
		Where("status IN ?", []string{"completed", "failed", "cancelled", "canceled"}).
		Delete(&model.VideoTask{}).Error
}

// SaveOwnedVideoTask preserves ordinary provider retries without allowing an
// ID collision to overwrite another user or a permanent StarFrame claim.
func SaveOwnedVideoTask(task model.VideoTask) (model.VideoTask, error) {
	db, err := DB()
	if err != nil {
		return task, err
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		created := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&task)
		if created.Error != nil {
			return created.Error
		}
		if created.RowsAffected == 1 {
			return nil
		}
		updated := tx.Model(&model.VideoTask{}).Where("id = ? AND user_id = ? AND submission_claim = ?", task.ID, task.UserID, false).Select("*").Updates(&task)
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
	return task, err
}

func CompleteClaimedVideoTask(task model.VideoTask) error {
	db, err := DB()
	if err != nil {
		return err
	}
	query := db.Model(&model.VideoTask{}).Where("id = ? AND user_id = ? AND submission_claim = ?", task.ID, task.UserID, true)
	if task.Status != "completed" {
		query = query.Where("status <> ?", "completed")
	}
	result := query.Select("upstream_task_id", "upstream_video_id", "status", "progress", "seconds", "size", "video_url", "error", "error_detail", "response_body", "last_response", "updated_at", "completed_at", "last_polled_at").Updates(&task)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		var count int64
		err := db.Model(&model.VideoTask{}).Where("id = ? AND user_id = ? AND submission_claim = ? AND status = ?", task.ID, task.UserID, true, "completed").Count(&count).Error
		if err != nil {
			return err
		}
		if count == 1 {
			return nil
		}
		return gorm.ErrRecordNotFound
	}
	return nil
}
