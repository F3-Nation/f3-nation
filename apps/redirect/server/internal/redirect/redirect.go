// Package redirect provides the HTTP handler that turns an incoming request
// into a 301/302 to the configured target for its Host.
package redirect

import (
	"net/http"

	"github.com/F3-Nation/f3-nation/apps/redirect/server/internal/mappings"
)

// Resolver returns the target URL for a request host.
type Resolver interface {
	Resolve(host string) (string, bool)
}

// Handler redirects each request to the target configured for its Host header.
// Unknown hosts get 404. The redirect status is Status (301 or 302).
//
// Optionally, requests for AdminHost are reverse-proxied to AdminProxy instead
// of redirected — this lets the same TLS-terminating tier also front the admin
// web app (its certificate is issued on-demand like any other host).
type Handler struct {
	Resolver   Resolver
	Status     int
	AdminHost  string
	AdminProxy http.Handler
}

// NewHandler builds a redirect handler. status must be 301 or 302; any other
// value falls back to 302 (safer default while DNS/cert setup settles).
func NewHandler(r Resolver, status int) *Handler {
	if status != http.StatusMovedPermanently && status != http.StatusFound {
		status = http.StatusFound
	}
	return &Handler{Resolver: r, Status: status}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// A bare health check (no Host match needed) for load balancers / probes.
	if r.URL.Path == "/healthz" {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
		return
	}

	host := mappings.NormalizeHost(r.Host)

	// Admin host is reverse-proxied (e.g. to the Cloud Run web app), not redirected.
	// Normalize the configured AdminHost the same way r.Host is normalized so a
	// value with uppercase letters or a trailing dot still matches.
	if h.AdminHost != "" && h.AdminProxy != nil && host == mappings.NormalizeHost(h.AdminHost) {
		h.AdminProxy.ServeHTTP(w, r)
		return
	}

	// NewHandler(nil, ...) is permitted (e.g. an admin-proxy-only instance), so
	// guard the resolver rather than panicking on a non-health request.
	if h.Resolver == nil {
		http.Error(w, "no redirect resolver configured", http.StatusServiceUnavailable)
		return
	}

	target, ok := h.Resolver.Resolve(host)
	if !ok {
		http.Error(w, "no redirect configured for this host", http.StatusNotFound)
		return
	}
	http.Redirect(w, r, target, h.Status)
}
