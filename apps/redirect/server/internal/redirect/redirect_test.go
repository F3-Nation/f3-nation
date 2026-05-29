package redirect

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/F3-Nation/f3-nation/apps/redirect/server/internal/mappings"
)

func liveFrom(t *testing.T, c mappings.Config) *Live {
	t.Helper()
	dir := t.TempDir()
	store := mappings.NewFileStore(dir + "/c.json")
	if err := store.Save(context.Background(), c); err != nil {
		t.Fatal(err)
	}
	l, err := NewLive(context.Background(), store)
	if err != nil {
		t.Fatal(err)
	}
	return l
}

func cfg() mappings.Config {
	return mappings.Config{Mappings: []mappings.Mapping{
		{Host: "f3muletown.com", Target: "https://regions.f3nation.com/muletown"},
		{Host: "stats.f3muletown.com", Target: "https://pax-vault.f3nation.com/stats/region/35838"},
	}}
}

func TestHandlerRedirects(t *testing.T) {
	h := NewHandler(liveFrom(t, cfg()), http.StatusFound)

	req := httptest.NewRequest(http.MethodGet, "http://f3muletown.com/anything?q=1", nil)
	req.Host = "f3muletown.com"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d want 302", rec.Code)
	}
	if loc := rec.Header().Get("Location"); loc != "https://regions.f3nation.com/muletown" {
		t.Errorf("Location = %q", loc)
	}
}

func TestHandlerUnknownHost404(t *testing.T) {
	h := NewHandler(liveFrom(t, cfg()), http.StatusMovedPermanently)
	req := httptest.NewRequest(http.MethodGet, "http://nope.example.com/", nil)
	req.Host = "nope.example.com"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("unknown host status = %d want 404", rec.Code)
	}
}

func TestHandlerHealthz(t *testing.T) {
	h := NewHandler(liveFrom(t, cfg()), http.StatusFound)
	req := httptest.NewRequest(http.MethodGet, "http://anything/healthz", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Body.String() != "ok" {
		t.Errorf("healthz = %d %q", rec.Code, rec.Body.String())
	}
}

func TestHandlerAdminProxy(t *testing.T) {
	proxied := false
	stub := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxied = true
		w.WriteHeader(http.StatusTeapot)
	})
	h := NewHandler(liveFrom(t, cfg()), http.StatusFound)
	h.AdminHost = "admin.example.com"
	h.AdminProxy = stub

	// admin host → proxied, not redirected
	req := httptest.NewRequest(http.MethodGet, "http://admin.example.com/x", nil)
	req.Host = "admin.example.com"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if !proxied || rec.Code != http.StatusTeapot {
		t.Errorf("admin host should be proxied: proxied=%v code=%d", proxied, rec.Code)
	}

	// a normal registered host still redirects
	proxied = false
	req2 := httptest.NewRequest(http.MethodGet, "http://f3muletown.com/", nil)
	req2.Host = "f3muletown.com"
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req2)
	if proxied || rec2.Code != http.StatusFound {
		t.Errorf("registered host should redirect, not proxy: proxied=%v code=%d", proxied, rec2.Code)
	}
}

func TestNewHandlerStatusFallback(t *testing.T) {
	if h := NewHandler(nil, 307); h.Status != http.StatusFound {
		t.Errorf("invalid status should fall back to 302, got %d", h.Status)
	}
	if h := NewHandler(nil, http.StatusMovedPermanently); h.Status != http.StatusMovedPermanently {
		t.Errorf("301 should be honored, got %d", h.Status)
	}
}

func TestLiveConfigAndWatch(t *testing.T) {
	dir := t.TempDir()
	store := mappings.NewFileStore(dir + "/c.json")
	if err := store.Save(context.Background(), cfg()); err != nil {
		t.Fatal(err)
	}
	l, err := NewLive(context.Background(), store)
	if err != nil {
		t.Fatal(err)
	}
	if len(l.Config().Mappings) != 2 {
		t.Errorf("Config() snapshot len = %d want 2", len(l.Config().Mappings))
	}

	// Watch should reload at least once, then exit promptly on cancel.
	updated := cfg().Upsert("watched.f3muletown.com", "https://example.com/w")
	if err := store.Save(context.Background(), updated); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { l.Watch(ctx, time.Millisecond, nil); close(done) }()
	deadline := time.After(2 * time.Second)
	for !l.IsRegistered("watched.f3muletown.com") {
		select {
		case <-deadline:
			cancel()
			t.Fatal("Watch did not reload within deadline")
		case <-time.After(2 * time.Millisecond):
		}
	}
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Watch did not return after cancel")
	}
}

func TestLiveReload(t *testing.T) {
	dir := t.TempDir()
	store := mappings.NewFileStore(dir + "/c.json")
	if err := store.Save(context.Background(), cfg()); err != nil {
		t.Fatal(err)
	}
	l, err := NewLive(context.Background(), store)
	if err != nil {
		t.Fatal(err)
	}
	if l.IsRegistered("new.f3muletown.com") {
		t.Fatal("should not be registered yet")
	}
	updated := cfg().Upsert("new.f3muletown.com", "https://example.com/new")
	if err := store.Save(context.Background(), updated); err != nil {
		t.Fatal(err)
	}
	if err := l.Reload(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !l.IsRegistered("new.f3muletown.com") {
		t.Error("reload should pick up the new mapping")
	}
}
