// Package mappings is the pure-logic core of the redirect service: the config
// model (host -> target URL), host resolution, validation, and the DNS
// instructions a tenant must apply to point their domain at us.
//
// It has no cloud dependencies so it can be unit-tested in full. Storage
// backends (local file, GCS) live alongside in this package but behind the
// Store interface; cloud wiring lives in other packages.
package mappings

import (
	"fmt"
	"net/url"
	"sort"
	"strings"

	"golang.org/x/net/publicsuffix"
)

// Mapping is a single redirect rule: any request whose Host equals Host is
// redirected to Target.
type Mapping struct {
	Host   string `json:"host"`
	Target string `json:"target"`
}

// Config is the entire redirect configuration — a flat list of mappings. This
// is what lives in the single JSON file in GCS. No database.
type Config struct {
	Mappings []Mapping `json:"mappings"`
}

// NormalizeHost lower-cases a hostname and strips a trailing dot and any port.
func NormalizeHost(host string) string {
	host = strings.TrimSpace(strings.ToLower(host))
	host = strings.TrimSuffix(host, ".")
	if i := strings.IndexByte(host, ':'); i >= 0 {
		host = host[:i]
	}
	return host
}

// Validate checks that every mapping has a usable host and an absolute http(s)
// target, and that no host is registered twice.
func (c Config) Validate() error {
	seen := make(map[string]struct{}, len(c.Mappings))
	for i, m := range c.Mappings {
		host := NormalizeHost(m.Host)
		if host == "" {
			return fmt.Errorf("mapping %d: empty host", i)
		}
		if !strings.Contains(host, ".") {
			return fmt.Errorf("mapping %d (%q): host must be a fully-qualified domain", i, m.Host)
		}
		if _, dup := seen[host]; dup {
			return fmt.Errorf("mapping %d: duplicate host %q", i, host)
		}
		seen[host] = struct{}{}

		u, err := url.Parse(m.Target)
		if err != nil {
			return fmt.Errorf("mapping %d (%q): invalid target: %w", i, m.Host, err)
		}
		if u.Scheme != "http" && u.Scheme != "https" {
			return fmt.Errorf("mapping %d (%q): target must be an absolute http(s) URL", i, m.Host)
		}
		if u.Host == "" {
			return fmt.Errorf("mapping %d (%q): target must include a host", i, m.Host)
		}
	}
	return nil
}

// index builds a normalized host -> target lookup. Callers should treat it as
// read-only.
func (c Config) index() map[string]string {
	m := make(map[string]string, len(c.Mappings))
	for _, mp := range c.Mappings {
		m[NormalizeHost(mp.Host)] = mp.Target
	}
	return m
}

// Resolve returns the target URL for the given request host, or ("", false) if
// the host is not registered.
//
// As a convenience, the "www." variant of a registered host inherits that
// host's target (e.g. registering f3muletown.com also serves
// www.f3muletown.com). An explicit mapping for the www host always wins. This
// keeps the "recommended www CNAME" honest: the redirect tier serves www and,
// because IsRegistered flows through here, the on-demand TLS gate issues its
// certificate too.
func (c Config) Resolve(host string) (string, bool) {
	idx := c.index()
	h := NormalizeHost(host)
	if t, ok := idx[h]; ok {
		return t, true
	}
	if rest, found := strings.CutPrefix(h, "www."); found {
		if t, ok := idx[rest]; ok {
			return t, true
		}
	}
	return "", false
}

// IsRegistered reports whether host has a mapping. This is the gate the
// on-demand TLS decision function uses before allowing a certificate to be
// issued for an incoming hostname.
func (c Config) IsRegistered(host string) bool {
	_, ok := c.Resolve(host)
	return ok
}

// Hosts returns the registered hostnames, normalized and sorted.
func (c Config) Hosts() []string {
	hosts := make([]string, 0, len(c.Mappings))
	for _, m := range c.Mappings {
		hosts = append(hosts, NormalizeHost(m.Host))
	}
	sort.Strings(hosts)
	return hosts
}

// Upsert adds or replaces the mapping for host. Returns a new Config; the
// receiver is not mutated.
func (c Config) Upsert(host, target string) Config {
	host = NormalizeHost(host)
	out := Config{Mappings: make([]Mapping, 0, len(c.Mappings)+1)}
	replaced := false
	for _, m := range c.Mappings {
		if NormalizeHost(m.Host) == host {
			out.Mappings = append(out.Mappings, Mapping{Host: host, Target: target})
			replaced = true
			continue
		}
		out.Mappings = append(out.Mappings, m)
	}
	if !replaced {
		out.Mappings = append(out.Mappings, Mapping{Host: host, Target: target})
	}
	return out
}

// Remove deletes the mapping for host. Returns the new Config and whether a
// mapping was actually removed.
func (c Config) Remove(host string) (Config, bool) {
	host = NormalizeHost(host)
	out := Config{Mappings: make([]Mapping, 0, len(c.Mappings))}
	removed := false
	for _, m := range c.Mappings {
		if NormalizeHost(m.Host) == host {
			removed = true
			continue
		}
		out.Mappings = append(out.Mappings, m)
	}
	return out, removed
}

// IsApex reports whether host is a registrable (apex/root) domain — i.e. it
// equals its own eTLD+1 (e.g. "f3muletown.com") rather than a subdomain
// ("stats.f3muletown.com"). Apex domains cannot use a CNAME.
func IsApex(host string) bool {
	host = NormalizeHost(host)
	etld1, err := publicsuffix.EffectiveTLDPlusOne(host)
	if err != nil {
		// Fall back to a label count if the suffix list can't classify it.
		return strings.Count(host, ".") == 1
	}
	return host == etld1
}

// ApexOf returns the registrable (eTLD+1) domain for host, e.g.
// "stats.f3muletown.com" -> "f3muletown.com".
func ApexOf(host string) string {
	host = NormalizeHost(host)
	if etld1, err := publicsuffix.EffectiveTLDPlusOne(host); err == nil {
		return etld1
	}
	return host
}
