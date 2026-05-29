package mappings

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
)

// The DNS-instruction rules are implemented in BOTH Go (here) and TypeScript
// (web/src/lib/domains.ts). This test asserts the Go implementation matches the
// shared contract in testdata/dns-instructions.json; an equivalent test in the
// web suite asserts the TS side. If either drifts, one suite goes red.

type parityRecord struct {
	Type     string `json:"type"`
	Name     string `json:"name"`
	Value    string `json:"value"`
	Optional bool   `json:"optional"`
}

type parityCase struct {
	Name    string `json:"name"`
	Host    string `json:"host"`
	Options struct {
		StaticIP      string `json:"staticIP"`
		CanonicalHost string `json:"canonicalHost"`
	} `json:"options"`
	Records []parityRecord `json:"records"`
}

func sortParity(rs []parityRecord) {
	sort.Slice(rs, func(i, j int) bool {
		if rs[i].Type != rs[j].Type {
			return rs[i].Type < rs[j].Type
		}
		return rs[i].Name < rs[j].Name
	})
}

func TestDNSInstructionsParity(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "shared", "dns-instructions.json"))
	if err != nil {
		t.Fatalf("read shared fixture: %v", err)
	}
	var fx struct {
		Cases []parityCase `json:"cases"`
	}
	if err := json.Unmarshal(b, &fx); err != nil {
		t.Fatalf("parse fixture: %v", err)
	}
	if len(fx.Cases) == 0 {
		t.Fatal("fixture has no cases")
	}

	for _, c := range fx.Cases {
		got := DNSInstructions(
			Mapping{Host: c.Host},
			DNSOptions{StaticIP: c.Options.StaticIP, CanonicalHost: c.Options.CanonicalHost},
		)
		gotRecs := make([]parityRecord, 0, len(got))
		for _, r := range got {
			gotRecs = append(gotRecs, parityRecord{Type: r.Type, Name: r.Name, Value: r.Value, Optional: r.Optional})
		}
		want := append([]parityRecord(nil), c.Records...)
		sortParity(gotRecs)
		sortParity(want)
		if !reflect.DeepEqual(gotRecs, want) {
			t.Errorf("case %q (host %s): \n got=%+v\nwant=%+v", c.Name, c.Host, gotRecs, want)
		}
	}
}
