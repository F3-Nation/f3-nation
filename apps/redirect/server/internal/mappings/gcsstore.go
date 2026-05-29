package mappings

import (
	"context"
	"errors"
	"fmt"
	"io"

	"cloud.google.com/go/storage"
)

// GCSStore persists the Config as a single JSON object in a GCS bucket. This is
// the production source of truth — a flat file, no database.
type GCSStore struct {
	client *storage.Client
	bucket string
	object string
}

// NewGCSStore opens a GCS-backed store for gs://bucket/object using Application
// Default Credentials. Call Close when done.
func NewGCSStore(ctx context.Context, bucket, object string) (*GCSStore, error) {
	client, err := storage.NewClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("gcs client: %w", err)
	}
	return &GCSStore{client: client, bucket: bucket, object: object}, nil
}

// Close releases the underlying GCS client.
func (s *GCSStore) Close() error { return s.client.Close() }

// Load reads the config object; a missing object loads as an empty config.
func (s *GCSStore) Load(ctx context.Context) (Config, error) {
	r, err := s.client.Bucket(s.bucket).Object(s.object).NewReader(ctx)
	if errors.Is(err, storage.ErrObjectNotExist) {
		return Config{}, nil
	}
	if err != nil {
		return Config{}, fmt.Errorf("gcs read %s/%s: %w", s.bucket, s.object, err)
	}
	defer r.Close()
	b, err := io.ReadAll(r)
	if err != nil {
		return Config{}, err
	}
	return Unmarshal(b)
}

// Save validates then writes the config object.
func (s *GCSStore) Save(ctx context.Context, cfg Config) error {
	if err := cfg.Validate(); err != nil {
		return err
	}
	b, err := Marshal(cfg)
	if err != nil {
		return err
	}
	w := s.client.Bucket(s.bucket).Object(s.object).NewWriter(ctx)
	w.ContentType = "application/json"
	if _, err := w.Write(b); err != nil {
		_ = w.Close()
		return fmt.Errorf("gcs write %s/%s: %w", s.bucket, s.object, err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("gcs write %s/%s: %w", s.bucket, s.object, err)
	}
	return nil
}
