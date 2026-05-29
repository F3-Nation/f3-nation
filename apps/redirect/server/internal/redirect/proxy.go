package redirect

import (
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
