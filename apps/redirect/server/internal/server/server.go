// Package server wires CertMagic on-demand TLS to the redirect handler.
//
// On-demand issuance is gated by a DecisionFunc so we only ask Let's Encrypt
// for a certificate when the incoming hostname is actually registered in our
// config — this is the abuse/rate-limit guard required by the design.
package server

import (
	"context"
	"crypto/tls"
	"fmt"

	"github.com/caddyserver/certmagic"
)

// Options configure the TLS/ACME stack.
type Options struct {
	// Storage is the shared certificate store (GCS in production).
	Storage certmagic.Storage
	// Email is the ACME account contact (Let's Encrypt expiry notices).
	Email string
	// Staging uses the Let's Encrypt staging CA (untrusted certs, high rate
	// limits) — use while validating before flipping to production.
	Staging bool
	// Decide gates on-demand issuance: return nil to allow a cert for name,
	// or an error to refuse. Must consult the live registry.
	Decide func(ctx context.Context, name string) error
}

// Build constructs a *tls.Config for on-demand serving and the ACME issuer
// whose HTTPChallengeHandler must wrap the :80 listener.
func Build(o Options) (*tls.Config, *certmagic.ACMEIssuer, error) {
	if o.Storage == nil {
		return nil, nil, fmt.Errorf("server: Storage is required")
	}
	if o.Decide == nil {
		return nil, nil, fmt.Errorf("server: Decide func is required (issuance must be gated)")
	}

	template := certmagic.Config{
		Storage:  o.Storage,
		OnDemand: &certmagic.OnDemandConfig{DecisionFunc: o.Decide},
	}

	var cache *certmagic.Cache
	cache = certmagic.NewCache(certmagic.CacheOptions{
		GetConfigForCert: func(certmagic.Certificate) (*certmagic.Config, error) {
			return certmagic.New(cache, template), nil
		},
	})

	magic := certmagic.New(cache, template)

	ca := certmagic.LetsEncryptProductionCA
	if o.Staging {
		ca = certmagic.LetsEncryptStagingCA
	}
	acme := certmagic.NewACMEIssuer(magic, certmagic.ACMEIssuer{
		CA:     ca,
		Email:  o.Email,
		Agreed: true,
	})
	magic.Issuers = []certmagic.Issuer{acme}

	tlsCfg := magic.TLSConfig()
	tlsCfg.NextProtos = append([]string{"h2", "http/1.1"}, tlsCfg.NextProtos...)
	return tlsCfg, acme, nil
}
