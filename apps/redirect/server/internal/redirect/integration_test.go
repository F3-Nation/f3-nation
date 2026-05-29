package redirect_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/F3-Nation/f3-nation/apps/redirect/server/internal/mappings"
	"github.com/F3-Nation/f3-nation/apps/redirect/server/internal/redirect"
)

// Integration test: a real HTTP server through the handler, backed by a
// file-store-backed Live config, exercising redirect, 404, healthz, and the
// admin reverse-proxy path end-to-end over the wire.
func TestServerIntegration(t *testing.T) {
	dir := t.TempDir()
	store := mappings.NewFileStore(dir + "/c.json")
	cfg := mappings.Config{Mappings: []mappings.Mapping{
		{Host: "f3muletown.com", Target: "https://regions.f3nation.com/muletown"},
	}}
	if err := store.Save(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}
	live, err := redirect.NewLive(context.Background(), store)
	if err != nil {
		t.Fatal(err)
	}

	// Upstream the admin proxy forwards to.
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "ADMIN-APP host="+r.Header.Get("X-Forwarded-Host"))
	}))
	defer upstream.Close()
	up, err := redirect.NewAdminProxy(upstream.URL, "admin.example.com")
	if err != nil {
		t.Fatal(err)
	}

	h := redirect.NewHandler(live, http.StatusFound)
	h.AdminHost = "admin.example.com"
	h.AdminProxy = up

	srv := httptest.NewServer(h)
	defer srv.Close()

	// no-redirect client so we can read the 302 Location.
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

	t.Run("redirect", func(t *testing.T) {
		req, _ := http.NewRequest(http.MethodGet, srv.URL+"/whatever", nil)
		req.Host = "f3muletown.com"
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusFound {
			t.Fatalf("status=%d want 302", resp.StatusCode)
		}
		if loc := resp.Header.Get("Location"); loc != "https://regions.f3nation.com/muletown" {
			t.Errorf("Location=%q", loc)
		}
	})

	t.Run("unknown host 404", func(t *testing.T) {
		req, _ := http.NewRequest(http.MethodGet, srv.URL+"/", nil)
		req.Host = "nope.example.com"
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("status=%d want 404", resp.StatusCode)
		}
	})

	t.Run("healthz", func(t *testing.T) {
		resp, err := client.Get(srv.URL + "/healthz")
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK || string(b) != "ok" {
			t.Errorf("healthz=%d %q", resp.StatusCode, b)
		}
	})

	t.Run("admin proxied with forwarded host", func(t *testing.T) {
		req, _ := http.NewRequest(http.MethodGet, srv.URL+"/", nil)
		req.Host = "admin.example.com"
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		if !strings.Contains(string(b), "ADMIN-APP") || !strings.Contains(string(b), "host=admin.example.com") {
			t.Errorf("admin proxy body=%q (want ADMIN-APP + forwarded host)", b)
		}
	})
}
