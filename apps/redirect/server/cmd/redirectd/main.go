// Command redirectd is the Go redirect tier: an HTTPS server that terminates
// TLS itself (on-demand certs via CertMagic, gated on the registry and stored
// in GCS) and emits 301/302 redirects to each tenant's configured target.
//
// Because it owns port 443 to terminate TLS, it runs on GCE/GKE, not Cloud Run.
//
// Configuration (env):
//
//	CONFIG_BUCKET / CONFIG_OBJECT  GCS flat-file config (object default: config/redirects.json)
//	CONFIG_FILE                    local JSON config (dev; overrides GCS when set)
//	CERT_BUCKET / CERT_PREFIX      GCS cert storage (default: CONFIG_BUCKET, prefix "certs")
//	ACME_EMAIL                     Let's Encrypt account contact
//	ACME_STAGING                   "1"/"true" to use the LE staging CA
//	REDIRECT_STATUS                301 or 302 (default 302)
//	HTTP_ADDR / HTTPS_ADDR         listen addresses (default :80 / :443)
//	RELOAD_INTERVAL                config refresh cadence (default 30s)
package main

import (
	"context"
	"crypto/tls"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/F3-Nation/f3-nation/apps/redirect/server/internal/certstore"
	"github.com/F3-Nation/f3-nation/apps/redirect/server/internal/mappings"
	"github.com/F3-Nation/f3-nation/apps/redirect/server/internal/redirect"
	"github.com/F3-Nation/f3-nation/apps/redirect/server/internal/server"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(log); err != nil {
		log.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	store, certStorage, cleanup, err := openStorage(ctx)
	if err != nil {
		return err
	}
	defer cleanup()

	live, err := redirect.NewLive(ctx, store)
	if err != nil {
		return err
	}
	go live.Watch(ctx, parseDur(env("RELOAD_INTERVAL", "30s"), 30*time.Second), func(e error) {
		log.Warn("config reload failed; keeping last good config", "err", e)
	})
	log.Info("loaded config", "hosts", live.Config().Hosts())

	// Optional: front a configurable admin host (the web app) via reverse proxy
	// on this same TLS-terminating tier. The host can change over time (env).
	adminHost := mappings.NormalizeHost(os.Getenv("ADMIN_HOST"))
	adminUpstream := os.Getenv("ADMIN_UPSTREAM")

	// Both must be set together — a half-configured proxy (only one present)
	// would silently disable the admin host, which is a confusing misconfig.
	if (adminHost == "") != (adminUpstream == "") {
		return errors.New("ADMIN_HOST and ADMIN_UPSTREAM must be set together (or both unset)")
	}

	tlsCfg, acme, err := server.Build(server.Options{
		Storage: certStorage,
		Email:   os.Getenv("ACME_EMAIL"),
		Staging: truthy(os.Getenv("ACME_STAGING")),
		Decide: func(ctx context.Context, name string) error {
			n := mappings.NormalizeHost(name)
			if adminHost != "" && n == adminHost {
				return nil
			}
			if live.IsRegistered(n) {
				return nil
			}
			return errors.New("host not registered: " + name)
		},
	})
	if err != nil {
		return err
	}

	status := http.StatusFound
	if os.Getenv("REDIRECT_STATUS") == "301" {
		status = http.StatusMovedPermanently
	}
	handler := redirect.NewHandler(live, status)

	if adminHost != "" && adminUpstream != "" {
		proxy, perr := redirect.NewAdminProxy(adminUpstream, adminHost)
		if perr != nil {
			return perr
		}
		handler.AdminHost = adminHost
		handler.AdminProxy = proxy
		// Don't log the raw upstream URL — it can carry credentials/query
		// secrets. Log only the host being fronted.
		log.Info("admin reverse-proxy enabled", "host", adminHost)
	}

	httpsAddr := env("HTTPS_ADDR", ":443")
	httpAddr := env("HTTP_ADDR", ":80")

	httpsSrv := &http.Server{
		Addr:              httpsAddr,
		Handler:           handler,
		TLSConfig:         tlsCfg,
		ReadHeaderTimeout: 10 * time.Second,
	}
	httpSrv := &http.Server{
		Addr:              httpAddr,
		Handler:           acme.HTTPChallengeHandler(handler),
		ReadHeaderTimeout: 10 * time.Second,
	}

	errCh := make(chan error, 2)
	go func() {
		log.Info("serving HTTPS", "addr", httpsAddr)
		ln, lerr := tls.Listen("tcp", httpsAddr, tlsCfg)
		if lerr != nil {
			errCh <- lerr
			return
		}
		errCh <- httpsSrv.Serve(ln)
	}()
	go func() {
		log.Info("serving HTTP (ACME + redirect)", "addr", httpAddr)
		errCh <- httpSrv.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		log.Info("shutting down")
		sctx, scancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer scancel()
		_ = httpsSrv.Shutdown(sctx)
		_ = httpSrv.Shutdown(sctx)
		return nil
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

type storageCloser func()

func openStorage(ctx context.Context) (mappings.Store, *certstore.GCS, storageCloser, error) {
	// Cert storage is always GCS (shared, survives restarts). In pure-local dev
	// without a bucket this will fail fast — set CERT_BUCKET/CONFIG_BUCKET.
	certBucket := env("CERT_BUCKET", os.Getenv("CONFIG_BUCKET"))
	certPrefix := env("CERT_PREFIX", "certs")

	if file := os.Getenv("CONFIG_FILE"); file != "" {
		cs, err := certstore.New(ctx, certBucket, certPrefix)
		if err != nil {
			return nil, nil, func() {}, err
		}
		return mappings.NewFileStore(file), cs, func() { _ = cs.Close() }, nil
	}

	bucket := os.Getenv("CONFIG_BUCKET")
	object := env("CONFIG_OBJECT", "config/redirects.json")
	gs, err := mappings.NewGCSStore(ctx, bucket, object)
	if err != nil {
		return nil, nil, func() {}, err
	}
	cs, err := certstore.New(ctx, certBucket, certPrefix)
	if err != nil {
		_ = gs.Close()
		return nil, nil, func() {}, err
	}
	return gs, cs, func() { _ = gs.Close(); _ = cs.Close() }, nil
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func parseDur(s string, def time.Duration) time.Duration {
	if d, err := time.ParseDuration(s); err == nil {
		return d
	}
	return def
}

func truthy(s string) bool {
	b, _ := strconv.ParseBool(s)
	return b
}
