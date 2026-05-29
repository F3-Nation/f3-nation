package mappings

import "fmt"

// DNSRecord is a single DNS record a tenant must create to activate a redirect.
type DNSRecord struct {
	Type  string // "A" or "CNAME"
	Name  string // the record name (the host itself)
	Value string // the value: a static IP (A) or our canonical hostname (CNAME)
	Note  string // human-friendly explanation
	// Optional reports whether the record is merely recommended (true) vs.
	// required to activate the redirect (false).
	Optional bool
}

// DNSOptions describe our serving endpoint so we can tell tenants what to point
// their domains at.
type DNSOptions struct {
	// StaticIP is the reserved public IP of the redirect tier. Apex domains
	// point an A record here.
	StaticIP string
	// CanonicalHost, when set, is the hostname subdomains should CNAME to. When
	// empty, subdomains are told to CNAME to their own apex (which must itself
	// carry an A record to StaticIP).
	CanonicalHost string
}

// DNSInstructions returns the DNS record(s) required to activate the mapping.
// This mirrors the web app's dnsInstructions() exactly (see the shared
// contract in testdata/dns-instructions.json):
//
//   - apex: a required A record to StaticIP, plus a recommended CNAME so the
//     www subdomain redirects too (apex can't CNAME itself).
//   - subdomain: a single required CNAME to CanonicalHost (or, if unset, to its
//     own apex, which must carry the A record).
func DNSInstructions(m Mapping, opt DNSOptions) []DNSRecord {
	host := NormalizeHost(m.Host)

	if IsApex(host) {
		// Never emit a required A record with an empty value; if the static IP
		// isn't configured, surface a placeholder + actionable note instead.
		apexValue := opt.StaticIP
		apexNote := fmt.Sprintf("Required: %s is an apex domain and cannot use a CNAME, so point an A record at the redirect tier's static IP.", host)
		if apexValue == "" {
			apexValue = "<redirect static IP — not yet configured>"
			apexNote = fmt.Sprintf("Required: %s is an apex domain and cannot use a CNAME. The redirect tier's static IP is not configured yet — contact the administrator before creating this A record.", host)
		}
		return []DNSRecord{
			{
				Type:     "A",
				Name:     host,
				Value:    apexValue,
				Note:     apexNote,
				Optional: false,
			},
			{
				Type:     "CNAME",
				Name:     "www." + host,
				Value:    host,
				Note:     fmt.Sprintf("Recommended: so www.%s redirects too. Point it at %s (which carries the A record above).", host, host),
				Optional: true,
			},
		}
	}

	if opt.CanonicalHost != "" {
		return []DNSRecord{{
			Type:     "CNAME",
			Name:     host,
			Value:    opt.CanonicalHost,
			Note:     fmt.Sprintf("Required: %s is a subdomain; add a single CNAME to %s. No A record is needed.", host, opt.CanonicalHost),
			Optional: false,
		}}
	}

	apex := ApexOf(host)
	// Mirror the apex placeholder behavior: if the static IP isn't configured,
	// the fallback note would otherwise read "...A record to ." with no target.
	staticIPTarget := opt.StaticIP
	if staticIPTarget == "" {
		staticIPTarget = "the redirect tier's static IP (not yet configured — contact the administrator)"
	}
	return []DNSRecord{{
		Type:     "CNAME",
		Name:     host,
		Value:    apex,
		Note:     fmt.Sprintf("Required: %s is a subdomain; CNAME it to %s (which must carry an A record to %s).", host, apex, staticIPTarget),
		Optional: false,
	}}
}
