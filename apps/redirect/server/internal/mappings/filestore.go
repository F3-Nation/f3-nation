package mappings

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

// FileStore persists the Config to a local JSON file. Used for local
// development and tests. A missing file loads as an empty config.
type FileStore struct {
	Path string
}

// NewFileStore returns a FileStore at path.
func NewFileStore(path string) *FileStore { return &FileStore{Path: path} }

// Load reads and parses the file; a non-existent file is an empty config.
func (s *FileStore) Load(ctx context.Context) (Config, error) {
	b, err := os.ReadFile(s.Path)
	if errors.Is(err, fs.ErrNotExist) {
		return Config{}, nil
	}
	if err != nil {
		return Config{}, err
	}
	return Unmarshal(b)
}

// Save validates then atomically writes the config (temp file + rename).
func (s *FileStore) Save(ctx context.Context, cfg Config) error {
	if err := cfg.Validate(); err != nil {
		return err
	}
	b, err := Marshal(cfg)
	if err != nil {
		return err
	}
	if dir := filepath.Dir(s.Path); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	tmp, err := os.CreateTemp(filepath.Dir(s.Path), ".redirects-*.json")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, s.Path)
}
