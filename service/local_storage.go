package service

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

const LocalStorageBackend = "local_disk"

var localStorageReservationMu sync.Mutex
var localStorageReservedBytes int64
var localStorageReservedByUser = map[string]int64{}
var localStorageReferenceMu sync.RWMutex

var ErrStorageObjectNotFound = errors.New("存储对象不存在")

type LocalStorageUserUsage struct {
	UserID          string `json:"userId"`
	UserDisplayName string `json:"userDisplayName"`
	Bytes           int64  `json:"bytes"`
	ObjectCount     int64  `json:"objectCount"`
}

type LocalStorageOrphan struct {
	Path       string `json:"path"`
	Location   string `json:"location"`
	Bytes      int64  `json:"bytes"`
	ModifiedAt string `json:"modifiedAt"`
}

type LocalStorageStatus struct {
	Enabled                  bool                     `json:"enabled"`
	Root                     string                   `json:"root"`
	FilesystemTotalBytes     int64                    `json:"filesystemTotalBytes"`
	FilesystemUsedBytes      int64                    `json:"filesystemUsedBytes"`
	FilesystemAvailableBytes int64                    `json:"filesystemAvailableBytes"`
	DataDirectoryBytes       int64                    `json:"dataDirectoryBytes"`
	MediaDirectoryBytes      int64                    `json:"mediaDirectoryBytes"`
	TemporaryDirectoryBytes  int64                    `json:"temporaryDirectoryBytes"`
	QuarantineDirectoryBytes int64                    `json:"quarantineDirectoryBytes"`
	IndexedBytes             int64                    `json:"indexedBytes"`
	IndexedObjectCount       int64                    `json:"indexedObjectCount"`
	MediaLimitBytes          int64                    `json:"mediaLimitBytes"`
	ReserveBytes             int64                    `json:"reserveBytes"`
	CleanupThresholdBytes    int64                    `json:"cleanupThresholdBytes"`
	UserLimitBytes           int64                    `json:"userLimitBytes"`
	OrphanCount              int64                    `json:"orphanCount"`
	OrphanBytes              int64                    `json:"orphanBytes"`
	Users                    []model.StorageUserUsage `json:"users"`
	CheckedAt                string                   `json:"checkedAt"`
}

type LocalStorageObjectDetails struct {
	model.StorageObject
	UserDisplayName string                         `json:"userDisplayName"`
	References      []model.StorageObjectReference `json:"references"`
	Reclaimable     bool                           `json:"reclaimable"`
}

type LocalStorageObjectPage struct {
	Items   []LocalStorageObjectDetails `json:"items"`
	Page    int                         `json:"page"`
	Limit   int                         `json:"limit"`
	Total   int64                       `json:"total"`
	HasMore bool                        `json:"hasMore"`
}

type LocalStorageReclaimResult struct {
	TemporaryBytes int64  `json:"temporaryBytes"`
	ObjectBytes    int64  `json:"objectBytes"`
	ObjectCount    int    `json:"objectCount"`
	OrphanBytes    int64  `json:"orphanBytes"`
	Message        string `json:"message"`
}

func LocalStorageEnabled() bool {
	return strings.TrimSpace(config.Cfg.CanvasDataDir) != ""
}

func LocalStorageRoot() string {
	root := strings.TrimSpace(config.Cfg.CanvasDataDir)
	if root == "" {
		return "/data/infinite-canvas"
	}
	return filepath.Clean(root)
}

func EnsureLocalStorageDirs() error {
	for _, dir := range []string{
		LocalStorageRoot(),
		filepath.Join(LocalStorageRoot(), "media"),
		filepath.Join(LocalStorageRoot(), "tmp"),
		filepath.Join(LocalStorageRoot(), "quarantine"),
	} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return err
		}
	}
	return nil
}

// StartLocalStorageReconciler removes stale staging files and quarantines files
// that are no longer represented by the database. It deliberately waits before
// touching unindexed media so an in-flight atomic commit can finish.
func StartLocalStorageReconciler() {
	if !LocalStorageEnabled() {
		return
	}
	go func() {
		ReconcileLocalStorage()
		ticker := time.NewTicker(6 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			ReconcileLocalStorage()
		}
	}()
}

func ReconcileLocalStorage() {
	if err := EnsureLocalStorageDirs(); err != nil {
		return
	}
	objects, err := repository.ListStorageObjects(LocalStorageBackend)
	if err != nil {
		return
	}
	known := make(map[string]struct{}, len(objects))
	cutoff := time.Now().Add(-time.Hour)
	for _, object := range objects {
		path, pathErr := localStoragePath(object.ObjectKey)
		if pathErr != nil {
			continue
		}
		known[filepath.Clean(path)] = struct{}{}
		info, statErr := os.Stat(path)
		if statErr == nil && !info.IsDir() {
			if object.Status == "pending" && info.ModTime().Before(cutoff) {
				_ = os.Remove(path)
				object.Status = "missing"
				object.LastError = "待提交媒体超过清理期限"
				object.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
				_, _ = repository.SaveStorageObject(object)
			}
			continue
		}
		if object.Status == "ready" {
			object.Status = "missing"
			object.LastError = "媒体文件不存在"
			object.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
			_, _ = repository.SaveStorageObject(object)
		}
	}

	mediaRoot := filepath.Join(LocalStorageRoot(), "media")
	_ = filepath.WalkDir(mediaRoot, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return nil
		}
		info, statErr := entry.Info()
		if statErr != nil || !info.ModTime().Before(cutoff) {
			return nil
		}
		cleanPath := filepath.Clean(path)
		if _, ok := known[cleanPath]; ok {
			return nil
		}
		relative, relErr := filepath.Rel(mediaRoot, cleanPath)
		if relErr != nil || relative == "." || strings.HasPrefix(relative, ".."+string(os.PathSeparator)) {
			return nil
		}
		quarantinePath := filepath.Join(LocalStorageRoot(), "quarantine", time.Now().UTC().Format("20060102"), relative)
		if mkdirErr := os.MkdirAll(filepath.Dir(quarantinePath), 0o700); mkdirErr == nil {
			_ = os.Rename(cleanPath, quarantinePath)
		}
		return nil
	})
	_ = cleanupLocalStorageTmp(cutoff)
	if used, usageErr := repository.StorageUsage(LocalStorageBackend); usageErr == nil && used > localStorageCleanupThreshold() {
		_, _ = ReclaimLocalStorage(context.Background(), "", used-localStorageCleanupThreshold())
	}
}

func cleanupLocalStorageTmp(cutoff time.Time) error {
	_, err := cleanupLocalStorageTmpBytes(cutoff)
	return err
}

func cleanupLocalStorageTmpBytes(cutoff time.Time) (int64, error) {
	tmpRoot := filepath.Join(LocalStorageRoot(), "tmp")
	var removed int64
	err := filepath.WalkDir(tmpRoot, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err == nil && info.ModTime().Before(cutoff) {
			if removeErr := os.Remove(path); removeErr == nil || os.IsNotExist(removeErr) {
				removed += info.Size()
			}
		}
		return nil
	})
	return removed, err
}

func localDirectoryBytes(root string) (int64, error) {
	var total int64
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			return nil
		}
		info, err := entry.Info()
		if err == nil {
			total += info.Size()
		}
		return nil
	})
	return total, err
}

func localFilesystemStats(root string) (int64, int64, int64, error) {
	var stats syscall.Statfs_t
	if err := syscall.Statfs(root, &stats); err != nil {
		return 0, 0, 0, err
	}
	blockSize := uint64(stats.Bsize)
	total := uint64(stats.Blocks) * blockSize
	available := uint64(stats.Bavail) * blockSize
	used := total
	if available <= total {
		used = total - available
	}
	return int64(total), int64(used), int64(available), nil
}

func ScanLocalStorageOrphans(limit int) ([]LocalStorageOrphan, int64, int64, error) {
	if err := EnsureLocalStorageDirs(); err != nil {
		return nil, 0, 0, err
	}
	objects, err := repository.ListStorageObjects(LocalStorageBackend)
	if err != nil {
		return nil, 0, 0, err
	}
	known := make(map[string]struct{}, len(objects))
	for _, object := range objects {
		path, pathErr := localStoragePath(object.ObjectKey)
		if pathErr == nil {
			known[filepath.Clean(path)] = struct{}{}
		}
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	items := make([]LocalStorageOrphan, 0, limit)
	var count, bytes int64
	visit := func(root string, location string) error {
		return filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil || entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
				return nil
			}
			if location == "media" {
				if _, ok := known[filepath.Clean(path)]; ok {
					return nil
				}
			}
			info, statErr := entry.Info()
			if statErr != nil {
				return nil
			}
			relative, relErr := filepath.Rel(root, path)
			if relErr != nil || relative == "." || strings.HasPrefix(relative, ".."+string(os.PathSeparator)) {
				return nil
			}
			count++
			bytes += info.Size()
			if len(items) < limit {
				items = append(items, LocalStorageOrphan{Path: filepath.ToSlash(relative), Location: location, Bytes: info.Size(), ModifiedAt: info.ModTime().UTC().Format(time.RFC3339Nano)})
			}
			return nil
		})
	}
	if err := visit(filepath.Join(LocalStorageRoot(), "media"), "media"); err != nil {
		return nil, 0, 0, err
	}
	if err := visit(filepath.Join(LocalStorageRoot(), "quarantine"), "quarantine"); err != nil {
		return nil, 0, 0, err
	}
	return items, count, bytes, nil
}

func LocalStorageStatusSnapshot() (LocalStorageStatus, error) {
	if err := EnsureLocalStorageDirs(); err != nil {
		return LocalStorageStatus{}, err
	}
	objects, err := repository.ListStorageObjects(LocalStorageBackend)
	if err != nil {
		return LocalStorageStatus{}, err
	}
	indexedBytes, err := repository.StorageUsage(LocalStorageBackend)
	if err != nil {
		return LocalStorageStatus{}, err
	}
	mediaBytes, err := localDirectoryBytes(filepath.Join(LocalStorageRoot(), "media"))
	if err != nil {
		return LocalStorageStatus{}, err
	}
	tmpBytes, err := localDirectoryBytes(filepath.Join(LocalStorageRoot(), "tmp"))
	if err != nil {
		return LocalStorageStatus{}, err
	}
	quarantineBytes, err := localDirectoryBytes(filepath.Join(LocalStorageRoot(), "quarantine"))
	if err != nil {
		return LocalStorageStatus{}, err
	}
	dataBytes, err := localDirectoryBytes(LocalStorageRoot())
	if err != nil {
		return LocalStorageStatus{}, err
	}
	total, used, available, err := localFilesystemStats(LocalStorageRoot())
	if err != nil {
		return LocalStorageStatus{}, err
	}
	_, orphanCount, orphanBytes, err := ScanLocalStorageOrphans(1)
	if err != nil {
		return LocalStorageStatus{}, err
	}
	users, err := repository.ListLocalStorageUserUsage(20)
	if err != nil {
		return LocalStorageStatus{}, err
	}
	return LocalStorageStatus{
		Enabled: true, Root: LocalStorageRoot(), FilesystemTotalBytes: total,
		FilesystemUsedBytes: used, FilesystemAvailableBytes: available,
		DataDirectoryBytes: dataBytes, MediaDirectoryBytes: mediaBytes,
		TemporaryDirectoryBytes: tmpBytes, QuarantineDirectoryBytes: quarantineBytes,
		IndexedBytes: indexedBytes, IndexedObjectCount: int64(len(objects)),
		MediaLimitBytes: localStorageLimit(), ReserveBytes: config.Cfg.CanvasStorageReserve,
		CleanupThresholdBytes: localStorageCleanupThreshold(), UserLimitBytes: localUserStorageLimit(),
		OrphanCount: orphanCount, OrphanBytes: orphanBytes, Users: users,
		CheckedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}, nil
}

func localStorageCleanupThreshold() int64 {
	threshold := config.Cfg.CanvasCleanupThreshold
	if threshold <= 0 || threshold > localStorageLimit() {
		threshold = localStorageLimit() * 8 / 9
	}
	return threshold
}

func protectedStorageReferences(references []model.StorageObjectReference) []model.StorageObjectReference {
	protected := make([]model.StorageObjectReference, 0, len(references))
	for _, reference := range references {
		switch reference.Type {
		case "user_asset", "canvas", "video_history", "image_history", "legacy_user_data", "catalog_asset", "image_task", "audio_task", "video_task":
			protected = append(protected, reference)
		}
	}
	return protected
}

func localStorageObjectDetails(object repository.LocalStorageObjectRow) (LocalStorageObjectDetails, error) {
	references, err := repository.StorageObjectReferences(object.ID)
	if err != nil {
		return LocalStorageObjectDetails{}, err
	}
	return LocalStorageObjectDetails{
		StorageObject: object.StorageObject, UserDisplayName: object.UserDisplayName,
		References:  references,
		Reclaimable: object.Status == "ready" && object.DeletedAt == "" && len(protectedStorageReferences(references)) == 0,
	}, nil
}

func AdminLocalStorageObjects(userID string, status string, page int, limit int) (LocalStorageObjectPage, error) {
	rows, total, err := repository.ListLocalStorageObjects(repository.LocalStorageObjectQuery{UserID: userID, Status: status, Page: page, Limit: limit})
	if err != nil {
		return LocalStorageObjectPage{}, err
	}
	if page <= 0 {
		page = 1
	}
	if limit <= 0 {
		limit = 20
	}
	items := make([]LocalStorageObjectDetails, 0, len(rows))
	for _, row := range rows {
		detail, detailErr := localStorageObjectDetails(row)
		if detailErr != nil {
			return LocalStorageObjectPage{}, detailErr
		}
		items = append(items, detail)
	}
	return LocalStorageObjectPage{Items: items, Page: page, Limit: limit, Total: total, HasMore: int64(page*limit) < total}, nil
}

func deleteLocalStorageObjectLocked(object model.StorageObject) error {
	if object.Backend != LocalStorageBackend || object.DeletedAt != "" {
		return ErrStorageObjectNotFound
	}
	path, err := localStoragePath(object.ObjectKey)
	if err != nil {
		return err
	}
	object.Status = "deleting"
	object.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := repository.SaveStorageObject(object); err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		object.Status = "ready"
		object.LastError = err.Error()
		object.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		_, _ = repository.SaveStorageObject(object)
		return err
	}
	object.DeletedAt = time.Now().UTC().Format(time.RFC3339Nano)
	object.UpdatedAt = object.DeletedAt
	object.LastError = ""
	if _, err := repository.SaveStorageObject(object); err != nil {
		return err
	}
	return repository.ClearStorageObjectTaskReferences(object.ID)
}

func DeleteLocalStorageObject(id string) error {
	localStorageReferenceMu.Lock()
	defer localStorageReferenceMu.Unlock()
	object, err := repository.GetStorageObject(strings.TrimSpace(id))
	if err != nil {
		return err
	}
	references, err := repository.StorageObjectReferences(object.ID)
	if err != nil {
		return err
	}
	if protected := protectedStorageReferences(references); len(protected) > 0 {
		return fmt.Errorf("媒体仍被 %d 处资产、画布或历史引用，不能删除", len(protected))
	}
	return deleteLocalStorageObjectLocked(object)
}

func localStorageUnreferencedCutoff() string {
	hours := config.Cfg.CanvasUnreferencedRetentionHours
	if hours < 1 {
		hours = 72
	}
	return time.Now().UTC().Add(-time.Duration(hours) * time.Hour).Format(time.RFC3339Nano)
}

func ReclaimLocalStorage(ctx context.Context, ownerID string, targetBytes int64) (LocalStorageReclaimResult, error) {
	var result LocalStorageReclaimResult
	if !LocalStorageEnabled() {
		result.Message = "本地磁盘存储未启用"
		return result, nil
	}
	tmpBytes, err := cleanupLocalStorageTmpBytes(time.Now().Add(-time.Hour))
	if err != nil {
		return result, err
	}
	result.TemporaryBytes = tmpBytes
	reclaimAll := targetBytes < 0
	if targetBytes == 0 {
		result.Message = "已清理过期临时文件，没有达到回收条件的媒体"
		return result, nil
	}
	if strings.TrimSpace(ownerID) != "" {
		ownerID = strings.TrimSpace(ownerID)
	}
	for reclaimAll || result.ObjectBytes < targetBytes {
		candidates, candidateErr := repository.ListLocalStorageReclaimCandidates(ownerID, localStorageUnreferencedCutoff(), 100)
		if candidateErr != nil {
			return result, candidateErr
		}
		if len(candidates) == 0 {
			break
		}
		progress := false
		for _, object := range candidates {
			localStorageReferenceMu.Lock()
			refs, referenceErr := repository.StorageObjectReferences(object.ID)
			if referenceErr == nil && len(refs) == 0 {
				if deleteErr := deleteLocalStorageObjectLocked(object); deleteErr == nil {
					result.ObjectBytes += object.Bytes
					result.ObjectCount++
					progress = true
				}
			} else if referenceErr == nil && len(protectedStorageReferences(refs)) == 0 {
				if deleteErr := deleteLocalStorageObjectLocked(object); deleteErr == nil {
					result.ObjectBytes += object.Bytes
					result.ObjectCount++
					progress = true
				}
			}
			localStorageReferenceMu.Unlock()
			if !reclaimAll && result.ObjectBytes >= targetBytes {
				break
			}
		}
		if !progress {
			break
		}
	}
	result.Message = fmt.Sprintf("已回收 %d 个无引用媒体对象", result.ObjectCount)
	return result, nil
}

func PurgeLocalStorageQuarantine() (int64, int, error) {
	root := filepath.Join(LocalStorageRoot(), "quarantine")
	var bytes int64
	var count int
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return nil
		}
		if removeErr := os.Remove(path); removeErr == nil || os.IsNotExist(removeErr) {
			bytes += info.Size()
			count++
		}
		return nil
	})
	return bytes, count, err
}

func localStorageLimit() int64 {
	limit := config.Cfg.CanvasStorageLimit - config.Cfg.CanvasStorageReserve
	if limit <= 0 {
		return 27_000_000_000
	}
	return limit
}

func UploadLocalObject(ctx context.Context, filename string, contentType string, reader io.Reader, kind string, sourceTaskID string) (UploadedStorageObject, error) {
	user, ok := UserFromContext(ctx)
	if !ok || strings.TrimSpace(user.ID) == "" || user.Role == model.UserRoleGuest {
		return UploadedStorageObject{}, errors.New("请先登录后保存媒体")
	}
	if err := EnsureLocalStorageDirs(); err != nil {
		return UploadedStorageObject{}, fmt.Errorf("本地存储不可用: %w", err)
	}
	if reader == nil {
		return UploadedStorageObject{}, errors.New("媒体内容为空")
	}

	maxBytes := config.Cfg.CanvasMaxObjectBytes
	if maxBytes <= 0 {
		maxBytes = 2 * 1024 * 1024 * 1024
	}
	reservation := maxBytes
	if seeker, ok := reader.(interface {
		Seek(int64, int) (int64, error)
	}); ok {
		if current, err := seeker.Seek(0, io.SeekCurrent); err == nil {
			if end, endErr := seeker.Seek(0, io.SeekEnd); endErr == nil && end >= current {
				reservation = end - current
			}
			_, _ = seeker.Seek(current, io.SeekStart)
		}
	}
	if reservation <= 0 || reservation > maxBytes {
		reservation = maxBytes
	}
	if err := reserveLocalStorage(ctx, reservation); err != nil {
		return UploadedStorageObject{}, err
	}
	reserved := reservation
	ownerID := user.ID
	defer func() { releaseLocalStorage(ownerID, reserved) }()

	objectID := uuid.NewString()
	ext := safeStorageExtension(contentType, filename)
	now := time.Now().UTC()
	relativeKey := filepath.ToSlash(filepath.Join("media", "users", storageOwnerPath(user.ID), now.Format("2006"), now.Format("01"), objectID+ext))
	finalPath, err := localStoragePath(relativeKey)
	if err != nil {
		return UploadedStorageObject{}, err
	}
	if err := os.MkdirAll(filepath.Dir(finalPath), 0o700); err != nil {
		return UploadedStorageObject{}, err
	}
	tmp, err := os.CreateTemp(filepath.Join(LocalStorageRoot(), "tmp"), objectID+"-*.part")
	if err != nil {
		return UploadedStorageObject{}, fmt.Errorf("创建临时文件失败: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	hasher := sha256.New()
	writer := io.MultiWriter(tmp, hasher)
	limited := io.LimitReader(reader, maxBytes+1)
	bytesWritten, copyErr := io.Copy(writer, limited)
	if copyErr != nil {
		_ = tmp.Close()
		return UploadedStorageObject{}, fmt.Errorf("保存媒体失败: %w", copyErr)
	}
	if bytesWritten <= 0 {
		_ = tmp.Close()
		return UploadedStorageObject{}, errors.New("媒体文件为空")
	}
	if bytesWritten > maxBytes {
		_ = tmp.Close()
		return UploadedStorageObject{}, fmt.Errorf("媒体文件超过 %d 字节限制", maxBytes)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return UploadedStorageObject{}, fmt.Errorf("同步媒体文件失败: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return UploadedStorageObject{}, fmt.Errorf("关闭媒体文件失败: %w", err)
	}
	if err := os.Rename(tmpPath, finalPath); err != nil {
		return UploadedStorageObject{}, fmt.Errorf("提交媒体文件失败: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = os.Remove(finalPath)
		}
	}()

	object := model.StorageObject{
		ID: objectID, Backend: LocalStorageBackend, ObjectKey: relativeKey,
		MimeType: normalizeStoredMimeType(contentType), Bytes: bytesWritten,
		SHA256: base64.RawURLEncoding.EncodeToString(hasher.Sum(nil)), CreatedBy: user.ID,
		Status: "pending", Kind: strings.TrimSpace(kind), SourceTaskID: strings.TrimSpace(sourceTaskID),
		CreatedAt: now.Format(time.RFC3339Nano), UpdatedAt: now.Format(time.RFC3339Nano),
	}
	if object.MimeType == "" || object.MimeType == "application/octet-stream" {
		object.MimeType = detectStoredMimeType(finalPath)
	}
	if _, err := repository.SaveStorageObject(object); err != nil {
		return UploadedStorageObject{}, fmt.Errorf("保存媒体索引失败: %w", err)
	}
	object.Status = "ready"
	object.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := repository.SaveStorageObject(object); err != nil {
		return UploadedStorageObject{}, fmt.Errorf("提交媒体索引失败: %w", err)
	}
	committed = true
	err = nil
	return UploadedStorageObject{
		ID: object.ID, URL: SignedStorageURL(object.ID, object.CreatedBy), StorageKey: "server:" + object.ID,
		Bytes: object.Bytes, MimeType: object.MimeType,
	}, nil
}

func PersistRemoteStorageObject(ctx context.Context, remoteURL string, kind string, sourceTaskID string) (UploadedStorageObject, error) {
	remoteURL = strings.TrimSpace(remoteURL)
	if remoteURL == "" {
		return UploadedStorageObject{}, errors.New("上游媒体地址为空")
	}
	if existing, found, err := repository.GetStorageObjectByTask(userIDFromContext(ctx), sourceTaskID, kind); err == nil && found {
		return UploadedStorageObject{ID: existing.ID, URL: SignedStorageURL(existing.ID, existing.CreatedBy), StorageKey: "server:" + existing.ID, Bytes: existing.Bytes, MimeType: existing.MimeType}, nil
	}
	if strings.HasPrefix(strings.ToLower(remoteURL), "data:") {
		parts := strings.SplitN(remoteURL, ",", 2)
		if len(parts) != 2 {
			return UploadedStorageObject{}, errors.New("上游媒体数据无效")
		}
		meta := strings.TrimPrefix(parts[0], "data:")
		contentType := strings.TrimSuffix(strings.SplitN(meta, ";", 2)[0], ";base64")
		encoded := parts[1]
		var data []byte
		var err error
		if strings.Contains(meta, ";base64") {
			data, err = base64.StdEncoding.DecodeString(encoded)
		} else {
			decoded, decodeErr := url.PathUnescape(encoded)
			data = []byte(decoded)
			err = decodeErr
		}
		if err != nil {
			return UploadedStorageObject{}, errors.New("上游媒体数据解码失败")
		}
		return UploadLocalObject(ctx, "generated"+safeStorageExtension(contentType, ""), contentType, bytes.NewReader(data), kind, sourceTaskID)
	}
	parsed, err := url.Parse(remoteURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return UploadedStorageObject{}, errors.New("上游媒体地址无效")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return UploadedStorageObject{}, err
	}
	response, err := SafeProxyHTTPClient().Do(request)
	if err != nil {
		return UploadedStorageObject{}, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return UploadedStorageObject{}, fmt.Errorf("上游媒体下载失败: %s", response.Status)
	}
	contentType := response.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	var reader io.Reader = response.Body
	if response.ContentLength >= 0 {
		reader = &sizedRemoteReader{Reader: response.Body, Size: response.ContentLength}
	}
	return UploadLocalObject(ctx, filepath.Base(parsed.Path), contentType, reader, kind, sourceTaskID)
}

type sizedRemoteReader struct {
	io.Reader
	Size int64
}

func (reader *sizedRemoteReader) Seek(offset int64, whence int) (int64, error) {
	switch {
	case whence == io.SeekCurrent && offset == 0:
		return 0, nil
	case whence == io.SeekEnd && offset == 0:
		return reader.Size, nil
	case whence == io.SeekStart && offset == 0:
		return 0, nil
	default:
		return 0, errors.New("远程媒体不支持定位读取")
	}
}

func userIDFromContext(ctx context.Context) string {
	user, ok := UserFromContext(ctx)
	if !ok {
		return ""
	}
	return strings.TrimSpace(user.ID)
}

func reserveLocalStorage(ctx context.Context, bytes int64) error {
	if bytes <= 0 {
		return errors.New("无效的媒体大小")
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	ownerID := userIDFromContext(ctx)
	if ownerID == "" {
		return errors.New("请先登录后保存媒体")
	}
	for attempt := 0; attempt < 2; attempt++ {
		localStorageReservationMu.Lock()
		used, err := repository.StorageUsage(LocalStorageBackend)
		if err != nil {
			localStorageReservationMu.Unlock()
			return err
		}
		userUsed, err := repository.StorageUsageForUser(ownerID, LocalStorageBackend)
		if err != nil {
			localStorageReservationMu.Unlock()
			return err
		}
		if userUsed+localStorageReservedByUser[ownerID]+bytes > localUserStorageLimit() {
			localStorageReservationMu.Unlock()
			return errors.New("已达到个人媒体空间上限，请删除旧素材后重试")
		}
		_, _, available, statErr := localFilesystemStats(LocalStorageRoot())
		projected := used + localStorageReservedBytes + bytes
		needsCleanup := projected > localStorageCleanupThreshold() || (statErr == nil && available < bytes+config.Cfg.CanvasStorageReserve)
		if !needsCleanup {
			if projected > localStorageLimit() {
				localStorageReservationMu.Unlock()
				return errors.New("服务端媒体空间不足，请稍后重试")
			}
			localStorageReservedBytes += bytes
			localStorageReservedByUser[ownerID] += bytes
			localStorageReservationMu.Unlock()
			return nil
		}
		localStorageReservationMu.Unlock()
		if attempt == 0 {
			need := projected - localStorageCleanupThreshold()
			if statErr == nil && bytes+config.Cfg.CanvasStorageReserve-available > need {
				need = bytes + config.Cfg.CanvasStorageReserve - available
			}
			if need < bytes {
				need = bytes
			}
			if _, reclaimErr := ReclaimLocalStorage(ctx, "", need); reclaimErr != nil {
				return reclaimErr
			}
			continue
		}
		return errors.New("服务端媒体空间接近上限，已清理无引用文件但空间仍不足")
	}
	return errors.New("服务端媒体空间不足，请稍后重试")
}

func releaseLocalStorage(ownerID string, bytes int64) {
	localStorageReservationMu.Lock()
	localStorageReservedBytes -= bytes
	if localStorageReservedBytes < 0 {
		localStorageReservedBytes = 0
	}
	localStorageReservedByUser[ownerID] -= bytes
	if localStorageReservedByUser[ownerID] <= 0 {
		delete(localStorageReservedByUser, ownerID)
	}
	localStorageReservationMu.Unlock()
}

func localUserStorageLimit() int64 {
	limit := config.Cfg.CanvasUserStorageLimit
	if limit <= 0 || limit > localStorageLimit() {
		return localStorageLimit()
	}
	return limit
}

func localStoragePath(relativeKey string) (string, error) {
	normalized := filepath.FromSlash(relativeKey)
	for _, part := range strings.Split(normalized, string(os.PathSeparator)) {
		if part == ".." {
			return "", errors.New("存储路径无效")
		}
	}
	clean := filepath.Clean(normalized)
	if clean == "." || filepath.IsAbs(clean) || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) || clean == ".." {
		return "", errors.New("存储路径无效")
	}
	root := LocalStorageRoot()
	full := filepath.Join(root, clean)
	rel, err := filepath.Rel(root, full)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", errors.New("存储路径越界")
	}
	return full, nil
}

func storageOwnerPath(userID string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(userID)))
	return hex.EncodeToString(digest[:])
}

func LocalStorageFile(object model.StorageObject) (*os.File, os.FileInfo, error) {
	if object.Backend != LocalStorageBackend || object.Status != "ready" || object.DeletedAt != "" {
		return nil, nil, ErrStorageObjectNotFound
	}
	path, err := localStoragePath(object.ObjectKey)
	if err != nil {
		return nil, nil, err
	}
	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil, ErrStorageObjectNotFound
		}
		return nil, nil, err
	}
	info, err := file.Stat()
	if err != nil || info.IsDir() {
		_ = file.Close()
		return nil, nil, ErrStorageObjectNotFound
	}
	return file, info, nil
}

func StorageObjectForRequest(ctx context.Context, id string, expires string, signature string) (model.StorageObject, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return model.StorageObject{}, ErrStorageObjectNotFound
	}
	if user, ok := UserFromContext(ctx); ok && user.ID != "" {
		object, err := repository.GetUserStorageObject(user.ID, id)
		if err == nil {
			return object, nil
		}
		return model.StorageObject{}, ErrStorageObjectNotFound
	}
	object, err := repository.GetStorageObject(id)
	if err != nil || object.Status == "deleting" || object.DeletedAt != "" {
		return model.StorageObject{}, ErrStorageObjectNotFound
	}
	if !verifyStorageSignature(object.ID, object.CreatedBy, expires, signature) {
		return model.StorageObject{}, ErrStorageObjectNotFound
	}
	return object, nil
}

func SignedStorageURL(objectID string, ownerID string) string {
	expires := time.Now().Add(15 * time.Minute).Unix()
	return "/api/files/" + objectID + "/content?expires=" + strconv.FormatInt(expires, 10) + "&signature=" + storageSignature(objectID, ownerID, expires)
}

func storageSignature(objectID string, ownerID string, expires int64) string {
	mac := hmac.New(sha256.New, []byte(config.Cfg.JWTSecret))
	_, _ = io.WriteString(mac, objectID+"\n"+ownerID+"\n"+strconv.FormatInt(expires, 10))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func verifyStorageSignature(objectID string, ownerID string, expires string, signature string) bool {
	value, err := strconv.ParseInt(strings.TrimSpace(expires), 10, 64)
	if err != nil || value < time.Now().Unix() || strings.TrimSpace(signature) == "" {
		return false
	}
	expected := storageSignature(objectID, ownerID, value)
	return hmac.Equal([]byte(expected), []byte(signature))
}

func safeStorageExtension(contentType string, filename string) string {
	contentType = normalizeStoredMimeType(contentType)
	switch contentType {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "video/mp4":
		return ".mp4"
	case "video/webm":
		return ".webm"
	case "audio/mpeg":
		return ".mp3"
	case "audio/wav", "audio/x-wav":
		return ".wav"
	}
	ext := strings.ToLower(filepath.Ext(filename))
	for _, allowed := range []string{".jpg", ".jpeg", ".png", ".webp", ".mp4", ".webm", ".mp3", ".wav"} {
		if ext == allowed {
			if ext == ".jpeg" {
				return ".jpg"
			}
			return ext
		}
	}
	return ".bin"
}

func normalizeStoredMimeType(value string) string {
	return strings.ToLower(strings.TrimSpace(strings.Split(value, ";")[0]))
}

func detectStoredMimeType(path string) string {
	file, err := os.Open(path)
	if err != nil {
		return "application/octet-stream"
	}
	defer file.Close()
	buffer := make([]byte, 512)
	n, _ := file.Read(buffer)
	if n == 0 {
		return "application/octet-stream"
	}
	return http.DetectContentType(buffer[:n])
}
