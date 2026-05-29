package mappings

import (
	"context"
	"path/filepath"
	"testing"
)

func TestMarshalUnmarshalRoundTrip(t *testing.T) {
	in := sample()
	b, err := Marshal(in)
	if err != nil {
		t.Fatal(err)
	}
	out, err := Unmarshal(b)
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Mappings) != len(in.Mappings) {
		t.Fatalf("roundtrip len = %d want %d", len(out.Mappings), len(in.Mappings))
	}
	// Marshal sorts by host: first should be the alphabetically-first host.
	if out.Mappings[0].Host != "f3marshall.com" {
		t.Errorf("Marshal not sorted: first host = %q", out.Mappings[0].Host)
	}
}

func TestUnmarshalEmpty(t *testing.T) {
	c, err := Unmarshal(nil)
	if err != nil || len(c.Mappings) != 0 {
		t.Errorf("empty unmarshal = %+v, %v", c, err)
	}
}

func TestFileStoreRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "redirects.json")
	store := NewFileStore(path)
	ctx := context.Background()

	// Missing file loads empty.
	c, err := store.Load(ctx)
	if err != nil || len(c.Mappings) != 0 {
		t.Fatalf("missing file should load empty: %+v %v", c, err)
	}

	if err := store.Save(ctx, sample()); err != nil {
		t.Fatalf("save: %v", err)
	}
	got, err := store.Load(ctx)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(got.Mappings) != len(sample().Mappings) {
		t.Errorf("reloaded len = %d want %d", len(got.Mappings), len(sample().Mappings))
	}
	if tgt, ok := got.Resolve("f3muletown.com"); !ok || tgt == "" {
		t.Error("reloaded config lost a mapping")
	}
}

func TestFileStoreRejectsInvalid(t *testing.T) {
	store := NewFileStore(filepath.Join(t.TempDir(), "c.json"))
	err := store.Save(context.Background(), Config{Mappings: []Mapping{{Host: "bad", Target: "nope"}}})
	if err == nil {
		t.Error("saving invalid config should fail validation")
	}
}
