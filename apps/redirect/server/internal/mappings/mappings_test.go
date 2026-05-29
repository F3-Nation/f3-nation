package mappings

import "testing"

func sample() Config {
	return Config{Mappings: []Mapping{
		{Host: "f3muletown.com", Target: "https://regions.f3nation.com/muletown"},
		{Host: "www.f3muletown.com", Target: "https://regions.f3nation.com/muletown"},
		{Host: "stats.f3muletown.com", Target: "https://pax-vault.f3nation.com/stats/region/35838"},
		{Host: "f3marshall.com", Target: "https://regions.f3nation.com/marshall-tn"},
	}}
}

func TestNormalizeHost(t *testing.T) {
	cases := map[string]string{
		"F3Muletown.com":         "f3muletown.com",
		"f3muletown.com.":        "f3muletown.com",
		"  STATS.f3muletown.com": "stats.f3muletown.com",
		"f3muletown.com:443":     "f3muletown.com",
	}
	for in, want := range cases {
		if got := NormalizeHost(in); got != want {
			t.Errorf("NormalizeHost(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestResolveAndRegistered(t *testing.T) {
	c := sample()
	if tgt, ok := c.Resolve("F3Muletown.com"); !ok || tgt != "https://regions.f3nation.com/muletown" {
		t.Errorf("Resolve apex (case-insensitive) = %q,%v", tgt, ok)
	}
	if tgt, ok := c.Resolve("stats.f3muletown.com."); !ok || tgt != "https://pax-vault.f3nation.com/stats/region/35838" {
		t.Errorf("Resolve subdomain = %q,%v", tgt, ok)
	}
	if _, ok := c.Resolve("evil.example.com"); ok {
		t.Error("unregistered host should not resolve")
	}
	if !c.IsRegistered("www.f3muletown.com") {
		t.Error("IsRegistered should be true for registered host")
	}
	if c.IsRegistered("nope.f3muletown.com") {
		t.Error("IsRegistered should be false for unregistered host")
	}
}

func TestResolveWWWInheritsApex(t *testing.T) {
	c := Config{Mappings: []Mapping{
		{Host: "f3muletown.com", Target: "https://regions.f3nation.com/muletown"},
	}}
	// www of a registered apex inherits the apex's target...
	if tgt, ok := c.Resolve("www.f3muletown.com"); !ok || tgt != "https://regions.f3nation.com/muletown" {
		t.Errorf("www should inherit apex target: got %q ok=%v", tgt, ok)
	}
	// ...and is considered registered (so the on-demand TLS gate issues a cert).
	if !c.IsRegistered("www.f3muletown.com") {
		t.Error("www of a registered apex should be registered for the TLS gate")
	}
	// www of an unregistered host stays unregistered.
	if c.IsRegistered("www.notregistered.com") {
		t.Error("www of an unregistered host must not be registered")
	}
	// An explicit www registration wins over the apex inheritance.
	c2 := Config{Mappings: []Mapping{
		{Host: "f3muletown.com", Target: "https://apex"},
		{Host: "www.f3muletown.com", Target: "https://explicit-www"},
	}}
	if tgt, _ := c2.Resolve("www.f3muletown.com"); tgt != "https://explicit-www" {
		t.Errorf("explicit www mapping should take precedence: got %q", tgt)
	}
}

func TestUpsertAndRemove(t *testing.T) {
	c := sample()
	n := len(c.Mappings)

	c2 := c.Upsert("new.example.com", "https://example.org/x")
	if len(c2.Mappings) != n+1 {
		t.Fatalf("Upsert add: len=%d want %d", len(c2.Mappings), n+1)
	}
	if tgt, _ := c2.Resolve("new.example.com"); tgt != "https://example.org/x" {
		t.Errorf("Upsert add target = %q", tgt)
	}

	c3 := c2.Upsert("NEW.example.com", "https://example.org/y")
	if len(c3.Mappings) != n+1 {
		t.Errorf("Upsert replace should not grow: len=%d want %d", len(c3.Mappings), n+1)
	}
	if tgt, _ := c3.Resolve("new.example.com"); tgt != "https://example.org/y" {
		t.Errorf("Upsert replace target = %q", tgt)
	}

	c4, removed := c3.Remove("new.example.com")
	if !removed || len(c4.Mappings) != n {
		t.Errorf("Remove: removed=%v len=%d want %d", removed, len(c4.Mappings), n)
	}
	if _, gone := c4.Remove("does-not-exist.com"); gone {
		t.Error("Remove of missing host should report false")
	}

	// receiver immutability
	if len(c.Mappings) != n {
		t.Errorf("original mutated: len=%d want %d", len(c.Mappings), n)
	}
}

func TestValidate(t *testing.T) {
	if err := sample().Validate(); err != nil {
		t.Fatalf("sample should be valid: %v", err)
	}
	bad := []Config{
		{Mappings: []Mapping{{Host: "", Target: "https://x.com"}}},
		{Mappings: []Mapping{{Host: "nodot", Target: "https://x.com"}}},
		{Mappings: []Mapping{{Host: "a.com", Target: "ftp://x.com"}}},
		{Mappings: []Mapping{{Host: "a.com", Target: "/relative"}}},
		{Mappings: []Mapping{{Host: "a.com", Target: "https://x.com"}, {Host: "A.com", Target: "https://y.com"}}},
	}
	for i, c := range bad {
		if err := c.Validate(); err == nil {
			t.Errorf("bad config %d should fail validation", i)
		}
	}
}

func TestApex(t *testing.T) {
	cases := map[string]bool{
		"f3muletown.com":       true,
		"f3marshall.com":       true,
		"www.f3muletown.com":   false,
		"stats.f3muletown.com": false,
	}
	for host, want := range cases {
		if got := IsApex(host); got != want {
			t.Errorf("IsApex(%q) = %v, want %v", host, got, want)
		}
	}
	if got := ApexOf("stats.f3muletown.com"); got != "f3muletown.com" {
		t.Errorf("ApexOf = %q", got)
	}
}

func TestHosts(t *testing.T) {
	got := sample().Hosts()
	want := []string{"f3marshall.com", "f3muletown.com", "stats.f3muletown.com", "www.f3muletown.com"}
	if len(got) != len(want) {
		t.Fatalf("Hosts len = %d want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("Hosts[%d] = %q want %q (not sorted?)", i, got[i], want[i])
		}
	}
}
