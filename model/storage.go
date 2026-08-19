package model

// StorageObject 存储对象（本地磁盘、S3/R2、WebDAV 共用文件索引）。
type StorageObject struct {
	ID           string `json:"id" gorm:"primaryKey"`
	Backend      string `json:"backend" gorm:"index"`
	ProviderID   string `json:"providerId" gorm:"index"`
	Bucket       string `json:"bucket"`
	ObjectKey    string `json:"objectKey" gorm:"uniqueIndex"`
	PublicURL    string `json:"publicUrl"`
	MimeType     string `json:"mimeType"`
	Bytes        int64  `json:"bytes"`
	Width        int    `json:"width"`
	Height       int    `json:"height"`
	SHA256       string `json:"sha256"`
	CreatedBy    string `json:"createdBy" gorm:"index"`
	Status       string `json:"status" gorm:"index"`
	Kind         string `json:"kind" gorm:"index"`
	SourceTaskID string `json:"sourceTaskId" gorm:"index"`
	RefCount     int    `json:"refCount"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
	DeletedAt    string `json:"deletedAt"`
	LastError    string `json:"lastError" gorm:"type:text"`
}

// StorageObjectReference identifies a persisted record that protects media from deletion.
type StorageObjectReference struct {
	Type   string `json:"type"`
	ID     string `json:"id"`
	UserID string `json:"userId"`
}

// StorageUserUsage is the aggregated local-media usage for an account.
type StorageUserUsage struct {
	UserID          string `json:"userId"`
	UserDisplayName string `json:"userDisplayName"`
	Bytes           int64  `json:"bytes"`
	ObjectCount     int64  `json:"objectCount"`
}
