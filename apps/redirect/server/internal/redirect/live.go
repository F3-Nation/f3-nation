package redirect

import (
	"context"
	"sync/atomic"
	"time"

	"github.com/F3-Nation/f3-nation/apps/redirect/server/internal/mappings"
)

// Live is a hot-reloading view of the redirect config. It satisfies Resolver
// and supplies the on-demand TLS decision gate, so new mappings take effect
// without a restart (and without a database).
type Live struct {
	store mappings.Store
	cfg   atomic.Pointer[mappings.Config]
}

// NewLive loads the initial config from store. It errors only if the first
// load fails; subsequent background reload failures keep the last good config.
func NewLive(ctx context.Context, store mappings.Store) (*Live, error) {
	l := &Live{store: store}
	cfg, err := store.Load(ctx)
	if err != nil {
		return nil, err
	}
	l.cfg.Store(&cfg)
	return l, nil
}

// Config returns a defensive copy of the current config snapshot.
// mappings.Config holds a slice, so returning *l.cfg.Load() directly would
// expose the live backing array; a caller mutating cfg.Mappings could corrupt
// the snapshot and race with concurrent readers.
func (l *Live) Config() mappings.Config {
	cfg := l.cfg.Load()
	if cfg == nil {
		return mappings.Config{}
	}
	return mappings.Config{
		Mappings: append([]mappings.Mapping(nil), cfg.Mappings...),
	}
}

// Resolve looks up the target for host in the current config.
func (l *Live) Resolve(host string) (string, bool) { return l.cfg.Load().Resolve(host) }

// IsRegistered reports whether host is currently registered.
func (l *Live) IsRegistered(host string) bool { return l.cfg.Load().IsRegistered(host) }

// Reload fetches the latest config once, replacing the snapshot on success.
func (l *Live) Reload(ctx context.Context) error {
	cfg, err := l.store.Load(ctx)
	if err != nil {
		return err
	}
	l.cfg.Store(&cfg)
	return nil
}

// Watch reloads on an interval until ctx is cancelled. onErr (optional) is
// called with any reload error; the previous config is retained.
func (l *Live) Watch(ctx context.Context, interval time.Duration, onErr func(error)) {
	// time.NewTicker panics on a non-positive duration; a misconfigured
	// RELOAD_INTERVAL must not crash the watcher goroutine. Fall back to 30s.
	if interval <= 0 {
		interval = 30 * time.Second
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := l.Reload(ctx); err != nil && onErr != nil {
				onErr(err)
			}
		}
	}
}
