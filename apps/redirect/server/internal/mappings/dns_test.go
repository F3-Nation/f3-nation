package mappings

import "testing"

func TestDNSInstructionsApex(t *testing.T) {
	recs := DNSInstructions(
		Mapping{Host: "f3muletown.com", Target: "https://regions.f3nation.com/muletown"},
		DNSOptions{StaticIP: "203.0.113.10"},
	)
	// Required A record first.
	if recs[0].Type != "A" || recs[0].Name != "f3muletown.com" || recs[0].Value != "203.0.113.10" || recs[0].Optional {
		t.Errorf("apex required A record = %+v", recs[0])
	}
	// Plus a recommended www CNAME pointing at the apex.
	var www *DNSRecord
	for i := range recs {
		if recs[i].Name == "www.f3muletown.com" {
			www = &recs[i]
		}
	}
	if www == nil || www.Type != "CNAME" || www.Value != "f3muletown.com" || !www.Optional {
		t.Errorf("apex should also recommend a www CNAME, got %+v", recs)
	}
}

func TestDNSInstructionsSubdomainCanonical(t *testing.T) {
	recs := DNSInstructions(
		Mapping{Host: "stats.f3muletown.com", Target: "https://x"},
		DNSOptions{StaticIP: "203.0.113.10", CanonicalHost: "redirect.f3nation.com"},
	)
	if len(recs) != 1 || recs[0].Type != "CNAME" {
		t.Fatalf("subdomain should yield 1 CNAME, got %+v", recs)
	}
	if recs[0].Value != "redirect.f3nation.com" {
		t.Errorf("CNAME value = %q, want canonical host", recs[0].Value)
	}
}

func TestDNSInstructionsSubdomainFallsBackToApex(t *testing.T) {
	recs := DNSInstructions(
		Mapping{Host: "www.f3marshall.com", Target: "https://x"},
		DNSOptions{StaticIP: "203.0.113.10"}, // no canonical host
	)
	if recs[0].Type != "CNAME" || recs[0].Value != "f3marshall.com" {
		t.Errorf("subdomain fallback = %+v, want CNAME to apex", recs[0])
	}
}
