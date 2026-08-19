package repository

import (
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
)

// LocalStorageObjectQuery controls the administrator's local-media listing.
type LocalStorageObjectQuery struct {
	UserID string
	Status string
	Page   int
	Limit  int
}

type LocalStorageObjectRow struct {
	model.StorageObject
	UserDisplayName string `json:"userDisplayName" gorm:"column:user_display_name"`
}

// SaveStorageObject 保存存储对象记录。
func SaveStorageObject(object model.StorageObject) (model.StorageObject, error) {
	db, err := DB()
	if err != nil {
		return model.StorageObject{}, err
	}
	return object, db.Save(&object).Error
}

// GetStorageObject 根据 ID 获取存储对象。
func GetStorageObject(id string) (model.StorageObject, error) {
	db, err := DB()
	if err != nil {
		return model.StorageObject{}, err
	}
	var object model.StorageObject
	err = db.First(&object, "id = ?", id).Error
	return object, err
}

func GetUserStorageObject(userID string, id string) (model.StorageObject, error) {
	db, err := DB()
	if err != nil {
		return model.StorageObject{}, err
	}
	var object model.StorageObject
	err = db.Where("id = ? AND created_by = ? AND (status = '' OR status = ?) AND deleted_at = ''", id, userID, "ready").First(&object).Error
	return object, err
}

func GetStorageObjectByTask(userID string, taskID string, kind string) (model.StorageObject, bool, error) {
	db, err := DB()
	if err != nil {
		return model.StorageObject{}, false, err
	}
	var object model.StorageObject
	query := db.Where("created_by = ? AND source_task_id = ? AND (status = '' OR status = ?) AND deleted_at = ''", userID, taskID, "ready")
	if kind != "" {
		query = query.Where("kind = ?", kind)
	}
	err = query.Order("created_at DESC").First(&object).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return model.StorageObject{}, false, nil
		}
		return model.StorageObject{}, false, err
	}
	return object, true, nil
}

func StorageUsage(backend string) (int64, error) {
	db, err := DB()
	if err != nil {
		return 0, err
	}
	var total int64
	query := db.Model(&model.StorageObject{}).Where("(status IN ? OR status = '') AND deleted_at = ''", []string{"pending", "ready"})
	if backend != "" {
		query = query.Where("backend = ?", backend)
	}
	err = query.Select("COALESCE(SUM(bytes), 0)").Scan(&total).Error
	return total, err
}

func StorageUsageForUser(userID string, backend string) (int64, error) {
	db, err := DB()
	if err != nil {
		return 0, err
	}
	var total int64
	query := db.Model(&model.StorageObject{}).Where("created_by = ? AND (status IN ? OR status = '') AND deleted_at = ''", userID, []string{"pending", "ready"})
	if backend != "" {
		query = query.Where("backend = ?", backend)
	}
	err = query.Select("COALESCE(SUM(bytes), 0)").Scan(&total).Error
	return total, err
}

func ListStorageObjects(backend string) ([]model.StorageObject, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var objects []model.StorageObject
	query := db.Where("deleted_at = ''")
	if strings.TrimSpace(backend) != "" {
		query = query.Where("backend = ?", backend)
	}
	if err := query.Find(&objects).Error; err != nil {
		return nil, err
	}
	return objects, nil
}

func ListLocalStorageObjects(query LocalStorageObjectQuery) ([]LocalStorageObjectRow, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	if query.Page <= 0 {
		query.Page = 1
	}
	if query.Limit <= 0 {
		query.Limit = 20
	}
	if query.Limit > 100 {
		query.Limit = 100
	}
	base := db.Model(&model.StorageObject{}).
		Where("storage_objects.backend = ? AND storage_objects.deleted_at = ?", "local_disk", "")
	if strings.TrimSpace(query.UserID) != "" {
		base = base.Where("storage_objects.created_by = ?", strings.TrimSpace(query.UserID))
	}
	if strings.TrimSpace(query.Status) != "" {
		base = base.Where("storage_objects.status = ?", strings.TrimSpace(query.Status))
	}
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []LocalStorageObjectRow
	err = base.Select("storage_objects.*, COALESCE(users.display_name, users.username, '') AS user_display_name").
		Joins("LEFT JOIN users ON users.id = storage_objects.created_by").
		Order("storage_objects.updated_at DESC").
		Offset((query.Page - 1) * query.Limit).
		Limit(query.Limit).
		Find(&rows).Error
	return rows, total, err
}

func ListLocalStorageReclaimCandidates(ownerID string, before string, limit int) ([]model.StorageObject, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	query := db.Where("backend = ? AND status = ? AND deleted_at = ?", "local_disk", "ready", "").
		Where("created_at <= ?", before)
	if strings.TrimSpace(ownerID) != "" {
		query = query.Where("created_by = ?", strings.TrimSpace(ownerID))
	}
	var objects []model.StorageObject
	err = query.Order("created_at ASC, id ASC").Limit(limit).Find(&objects).Error
	return objects, err
}

func ListLocalStorageUserUsage(limit int) ([]model.StorageUserUsage, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	var result []model.StorageUserUsage
	err = db.Model(&model.StorageObject{}).
		Select("storage_objects.created_by AS user_id, COALESCE(users.display_name, users.username, '') AS user_display_name, COALESCE(SUM(storage_objects.bytes), 0) AS bytes, COUNT(storage_objects.id) AS object_count").
		Joins("LEFT JOIN users ON users.id = storage_objects.created_by").
		Where("storage_objects.backend = ? AND storage_objects.status IN ? AND storage_objects.deleted_at = ?", "local_disk", []string{"pending", "ready"}, "").
		Group("storage_objects.created_by, users.display_name, users.username").
		Order("bytes DESC").Limit(limit).Find(&result).Error
	return result, err
}

func StorageObjectReferences(id string) ([]model.StorageObjectReference, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, nil
	}
	key := "server:" + id
	like := "%" + key + "%"
	result := make([]model.StorageObjectReference, 0)
	var userAssets []struct {
		ID     string
		UserID string
	}
	if err := db.Table("user_assets").Select("id, user_id").Where("payload LIKE ?", like).Find(&userAssets).Error; err != nil {
		return nil, err
	}
	for _, row := range userAssets {
		result = append(result, model.StorageObjectReference{Type: "user_asset", ID: row.ID, UserID: row.UserID})
	}
	var projects []struct{ ID, UserID string }
	if err := db.Table("canvas_projects").Select("id, user_id").Where("deleted_at = ? AND project_data LIKE ?", "", like).Find(&projects).Error; err != nil {
		return nil, err
	}
	for _, row := range projects {
		result = append(result, model.StorageObjectReference{Type: "canvas", ID: row.ID, UserID: row.UserID})
	}
	var videoLogs []struct{ ID, UserID string }
	if err := db.Table("video_generation_logs").Select("id, user_id").Where("deleted_at = ? AND payload_json LIKE ?", "", like).Find(&videoLogs).Error; err != nil {
		return nil, err
	}
	for _, row := range videoLogs {
		result = append(result, model.StorageObjectReference{Type: "video_history", ID: row.ID, UserID: row.UserID})
	}
	var imageLogs []struct{ ID, UserID string }
	if err := db.Table("image_generation_logs").Select("id, user_id").Where("deleted_at = ? AND payload_json LIKE ?", "", like).Find(&imageLogs).Error; err != nil {
		return nil, err
	}
	for _, row := range imageLogs {
		result = append(result, model.StorageObjectReference{Type: "image_history", ID: row.ID, UserID: row.UserID})
	}
	var configs []struct{ UserID string }
	if err := db.Table("user_configs").Select("user_id").Where("asset_data LIKE ? OR image_history LIKE ?", like, like).Find(&configs).Error; err != nil {
		return nil, err
	}
	for _, row := range configs {
		result = append(result, model.StorageObjectReference{Type: "legacy_user_data", ID: row.UserID, UserID: row.UserID})
	}
	var imageTasks []struct{ ID, UserID string }
	if err := db.Table("canvas_image_tasks").Select("id, user_id").Where("storage_key = ?", key).Find(&imageTasks).Error; err != nil {
		return nil, err
	}
	for _, row := range imageTasks {
		result = append(result, model.StorageObjectReference{Type: "image_task", ID: row.ID, UserID: row.UserID})
	}
	var audioTasks []struct{ ID, UserID string }
	if err := db.Table("canvas_audio_tasks").Select("id, user_id").Where("storage_key = ?", key).Find(&audioTasks).Error; err != nil {
		return nil, err
	}
	for _, row := range audioTasks {
		result = append(result, model.StorageObjectReference{Type: "audio_task", ID: row.ID, UserID: row.UserID})
	}
	var videoTasks []struct{ ID, UserID string }
	if err := db.Table("video_tasks").Select("id, user_id").Where("storage_key = ?", key).Find(&videoTasks).Error; err != nil {
		return nil, err
	}
	for _, row := range videoTasks {
		result = append(result, model.StorageObjectReference{Type: "video_task", ID: row.ID, UserID: row.UserID})
	}
	var assets []struct{ ID string }
	if err := db.Table("assets").Select("id").Where("cover_url LIKE ? OR url LIKE ? OR content LIKE ?", like, like, like).Find(&assets).Error; err != nil {
		return nil, err
	}
	for _, row := range assets {
		result = append(result, model.StorageObjectReference{Type: "catalog_asset", ID: row.ID})
	}
	return result, nil
}

func ClearStorageObjectTaskReferences(id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	key := "server:" + strings.TrimSpace(id)
	if key == "server:" {
		return nil
	}
	return db.Transaction(func(tx *gorm.DB) error {
		for _, table := range []string{"canvas_image_tasks", "canvas_audio_tasks", "video_tasks"} {
			if err := tx.Table(table).Where("storage_key = ?", key).Update("storage_key", "").Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func SyncUserAssets(userID string, assets []model.UserAsset) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ?", userID).Delete(&model.UserAsset{}).Error; err != nil {
			return err
		}
		if len(assets) == 0 {
			return nil
		}
		return tx.Create(&assets).Error
	})
}

func ListUserAssets(userID string, kind string, query string, cursorTime string, cursorID string, limit int) ([]model.UserAsset, bool, error) {
	db, err := DB()
	if err != nil {
		return nil, false, err
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	queryDB := userAssetsQuery(db, userID, kind, query)
	if cursorTime != "" {
		queryDB = queryDB.Where("updated_at < ? OR (updated_at = ? AND id < ?)", cursorTime, cursorTime, cursorID)
	}
	var items []model.UserAsset
	if err := queryDB.Order("updated_at DESC, id DESC").Limit(limit + 1).Find(&items).Error; err != nil {
		return nil, false, err
	}
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	return items, hasMore, nil
}

func CountUserAssets(userID string, kind string, query string) (int64, error) {
	db, err := DB()
	if err != nil {
		return 0, err
	}
	var count int64
	if err := userAssetsQuery(db, userID, kind, query).Count(&count).Error; err != nil {
		return 0, err
	}
	return count, nil
}

func userAssetsQuery(db *gorm.DB, userID string, kind string, query string) *gorm.DB {
	queryDB := db.Model(&model.UserAsset{}).Where("user_id = ?", userID)
	if strings.TrimSpace(kind) != "" {
		queryDB = queryDB.Where("kind = ?", strings.TrimSpace(kind))
	}
	if strings.TrimSpace(query) != "" {
		like := "%" + strings.TrimSpace(query) + "%"
		queryDB = queryDB.Where("title LIKE ? OR source LIKE ? OR payload LIKE ?", like, like, like)
	}
	return queryDB
}

// DeleteStorageObjectRecord 删除存储对象记录（软删除）。
func DeleteStorageObjectRecord(id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Delete(&model.StorageObject{}, "id = ?", id).Error
}
