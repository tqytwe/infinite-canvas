package handler

import (
	"net/http"

	"github.com/tigerowo/infinite-canvas/service"
)

// PlatformBootstrap exposes only the server-owned capability contract. The
// platform managed API keys remain encrypted in the Canvas shadow account.
func PlatformBootstrap(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok || user.ID == "" {
		FailWithStatus(w, http.StatusUnauthorized, "未登录或权限不足")
		return
	}
	payload, err := service.PlatformManagedBootstrap(r.Context(), user.ID)
	if err != nil {
		FailError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	OK(w, payload)
}
