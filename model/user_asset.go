package model

// UserAsset 用户自己的资产元数据索引。媒体二进制通过 StorageObject 关联。
type UserAsset struct {
	ID        string `json:"id" gorm:"primaryKey"`
	UserID    string `json:"userId" gorm:"index:idx_user_assets_user_updated,priority:1"`
	Kind      string `json:"kind" gorm:"index:idx_user_assets_user_kind_updated,priority:2"`
	Title     string `json:"title"`
	Source    string `json:"source"`
	Payload   string `json:"payload" gorm:"type:text"`
	CreatedAt string `json:"createdAt" gorm:"index"`
	UpdatedAt string `json:"updatedAt" gorm:"index:idx_user_assets_user_updated,priority:2;index:idx_user_assets_user_kind_updated,priority:3"`
}
