// Package certstore implements certmagic.Storage backed by Google Cloud
// Storage so that TLS certificates issued on demand are shared across all
// (ephemeral, autoscaled) instances and survive restarts — never the local
// filesystem default.
package certstore

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"strings"
	"time"

	"cloud.google.com/go/storage"
	"github.com/caddyserver/certmagic"
	"google.golang.org/api/googleapi"
	"google.golang.org/api/iterator"
)

// lockTTL is how long a lock may be held before another instance may steal it
// (guards against an instance dying mid-issuance without unlocking).
const lockTTL = 5 * time.Minute

// GCS is a certmagic.Storage backed by a GCS bucket. Cert/key material lives
// under Prefix; lock objects live under Prefix + "locks/".
type GCS struct {
	client *storage.Client
	bucket string
	prefix string
}

// compile-time assertion that GCS satisfies the interface.
var _ certmagic.Storage = (*GCS)(nil)

// New opens a GCS-backed certmagic storage rooted at gs://bucket/prefix using
// Application Default Credentials.
func New(ctx context.Context, bucket, prefix string) (*GCS, error) {
	client, err := storage.NewClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("gcs client: %w", err)
	}
	prefix = strings.Trim(prefix, "/")
	if prefix != "" {
		prefix += "/"
	}
	return &GCS{client: client, bucket: bucket, prefix: prefix}, nil
}

// Close releases the underlying client.
func (g *GCS) Close() error { return g.client.Close() }

func (g *GCS) obj(key string) *storage.ObjectHandle {
	return g.client.Bucket(g.bucket).Object(g.prefix + strings.TrimPrefix(key, "/"))
}

// Store writes value at key.
func (g *GCS) Store(ctx context.Context, key string, value []byte) error {
	w := g.obj(key).NewWriter(ctx)
	if _, err := w.Write(value); err != nil {
		_ = w.Close()
		return err
	}
	return w.Close()
}

// Load reads the value at key, returning fs.ErrNotExist if absent.
func (g *GCS) Load(ctx context.Context, key string) ([]byte, error) {
	r, err := g.obj(key).NewReader(ctx)
	if errors.Is(err, storage.ErrObjectNotExist) {
		return nil, fs.ErrNotExist
	}
	if err != nil {
		return nil, err
	}
	defer r.Close()
	return io.ReadAll(r)
}

// Delete removes key (and, if key is a directory prefix, everything under it).
func (g *GCS) Delete(ctx context.Context, key string) error {
	err := g.obj(key).Delete(ctx)
	if err == nil {
		return nil
	}
	if !errors.Is(err, storage.ErrObjectNotExist) {
		return err
	}
	// Not a leaf object — treat as a directory and delete everything under it.
	full := g.prefix + strings.TrimPrefix(key, "/")
	it := g.client.Bucket(g.bucket).Objects(ctx, &storage.Query{Prefix: full + "/"})
	deleted := false
	for {
		attrs, err := it.Next()
		if errors.Is(err, iterator.Done) {
			break
		}
		if err != nil {
			return err
		}
		if err := g.client.Bucket(g.bucket).Object(attrs.Name).Delete(ctx); err != nil &&
			!errors.Is(err, storage.ErrObjectNotExist) {
			return err
		}
		deleted = true
	}
	if !deleted {
		return fs.ErrNotExist
	}
	return nil
}

// Exists reports whether key exists as a leaf or as a directory prefix.
func (g *GCS) Exists(ctx context.Context, key string) bool {
	if _, err := g.obj(key).Attrs(ctx); err == nil {
		return true
	}
	full := g.prefix + strings.TrimPrefix(key, "/")
	it := g.client.Bucket(g.bucket).Objects(ctx, &storage.Query{Prefix: full + "/"})
	if _, err := it.Next(); err == nil {
		return true
	}
	return false
}

// List returns keys under path. With recursive=false only immediate children
// are returned (directories included, as "prefix" keys).
func (g *GCS) List(ctx context.Context, path string, recursive bool) ([]string, error) {
	full := g.prefix + strings.Trim(path, "/")
	if full != "" && !strings.HasSuffix(full, "/") {
		full += "/"
	}
	q := &storage.Query{Prefix: full}
	if !recursive {
		q.Delimiter = "/"
	}
	it := g.client.Bucket(g.bucket).Objects(ctx, q)
	var keys []string
	for {
		attrs, err := it.Next()
		if errors.Is(err, iterator.Done) {
			break
		}
		if err != nil {
			return nil, err
		}
		name := attrs.Name
		if name == "" {
			name = attrs.Prefix // a synthetic "directory" when delimited
		}
		name = strings.TrimSuffix(strings.TrimPrefix(name, g.prefix), "/")
		if name != "" {
			keys = append(keys, name)
		}
	}
	if len(keys) == 0 {
		return nil, fs.ErrNotExist
	}
	return keys, nil
}

// Stat returns metadata for key.
func (g *GCS) Stat(ctx context.Context, key string) (certmagic.KeyInfo, error) {
	attrs, err := g.obj(key).Attrs(ctx)
	if errors.Is(err, storage.ErrObjectNotExist) {
		return certmagic.KeyInfo{}, fs.ErrNotExist
	}
	if err != nil {
		return certmagic.KeyInfo{}, err
	}
	return certmagic.KeyInfo{
		Key:        key,
		Modified:   attrs.Updated,
		Size:       attrs.Size,
		IsTerminal: true,
	}, nil
}

// --- Locker ---------------------------------------------------------------

func (g *GCS) lockObj(name string) *storage.ObjectHandle {
	safe := strings.ReplaceAll(name, "/", "_")
	return g.client.Bucket(g.bucket).Object(g.prefix + "locks/" + safe + ".lock")
}

// Lock acquires a distributed lock named name, blocking until acquired, the
// context is cancelled, or a stale lock is stolen.
func (g *GCS) Lock(ctx context.Context, name string) error {
	obj := g.lockObj(name)
	for {
		// Atomic create-if-absent.
		w := obj.If(storage.Conditions{DoesNotExist: true}).NewWriter(ctx)
		_, werr := w.Write([]byte(time.Now().UTC().Format(time.RFC3339)))
		if werr == nil {
			werr = w.Close()
		}
		if werr == nil {
			return nil // acquired
		}
		if !isPreconditionFailed(werr) {
			return werr
		}
		// Someone holds it. Steal if stale.
		if attrs, err := obj.Attrs(ctx); err == nil {
			if time.Since(attrs.Created) > lockTTL {
				_ = g.client.Bucket(g.bucket).
					Object(obj.ObjectName()).
					If(storage.Conditions{GenerationMatch: attrs.Generation}).
					Delete(ctx)
				continue
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
}

// Unlock releases the named lock.
func (g *GCS) Unlock(ctx context.Context, name string) error {
	err := g.lockObj(name).Delete(ctx)
	if errors.Is(err, storage.ErrObjectNotExist) {
		return nil
	}
	return err
}

func isPreconditionFailed(err error) bool {
	var apiErr *googleapi.Error
	if errors.As(err, &apiErr) {
		return apiErr.Code == 412
	}
	return false
}
