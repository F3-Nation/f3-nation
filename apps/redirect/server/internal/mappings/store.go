package mappings

import (
	"context"
	"encoding/json"
	"fmt"
)

// Store loads and saves the redirect Config. Implementations: FileStore (local
// JSON file, for dev) and GCSStore (a single JSON object in a GCS bucket, the
// production source of truth).
type Store interface {
	Load(ctx context.Context) (Config, error)
	Save(ctx context.Context, cfg Config) error
}

// Marshal renders a Config as stable, pretty JSON (sorted by host) suitable for
// the flat file.
func Marshal(cfg Config) ([]byte, error) {
	out := Config{Mappings: append([]Mapping(nil), cfg.Mappings...)}
	sortMappings(out.Mappings)
	b, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(b, '\n'), nil
}

// Unmarshal parses the flat-file bytes into a Config. Empty input yields an
// empty config (a fresh deployment).
func Unmarshal(b []byte) (Config, error) {
	var cfg Config
	if len(b) == 0 {
		return cfg, nil
	}
	if err := json.Unmarshal(b, &cfg); err != nil {
		return Config{}, fmt.Errorf("parse config: %w", err)
	}
	return cfg, nil
}

func sortMappings(ms []Mapping) {
	// insertion sort by normalized host — tiny n, avoids importing sort twice
	for i := 1; i < len(ms); i++ {
		j := i
		for j > 0 && NormalizeHost(ms[j-1].Host) > NormalizeHost(ms[j].Host) {
			ms[j-1], ms[j] = ms[j], ms[j-1]
			j--
		}
	}
}
