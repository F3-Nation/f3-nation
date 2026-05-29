package redirect

import (
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
)

// NewAdminProxy builds a reverse proxy to upstream that presents itself to the
// upstream as the upstream's own host (so e.g. Cloud Run routes correctly)
// while forwarding the public adminHost via X-Forwarded-Host.
func NewAdminProxy(upstream, adminHost string) (http.Handler, error) {
	u, err := url.Parse(upstream)
	if err != nil {
		return nil, err
	}
	// url.Parse also accepts relative URLs and values without a scheme/host;
	// reject those up front so a bad admin_upstream fails at construction
	// rather than becoming a runtime proxy outage.
	if u.Scheme == "" || u.Host == "" {
		return nil, fmt.Errorf("upstream must be an absolute URL: %q", upstream)
	}
	proxy := httputil.NewSingleHostReverseProxy(u)
	base := proxy.Director
	proxy.Director = func(req *http.Request) {
		base(req)
		req.Host = u.Host
		req.Header.Set("X-Forwarded-Host", adminHost)
		req.Header.Set("X-Forwarded-Proto", "https")
	}
	return proxy, nil
}
