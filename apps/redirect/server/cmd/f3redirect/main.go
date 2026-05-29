// Command f3redirect is the admin CLI for the redirect service. It reads and
// writes the flat-file config (local file or the GCS object — no database) and
// prints the DNS records a tenant must create to activate a redirect.
//
// Storage selection:
//
//	--file <path>                local JSON file
//	--bucket <b> --object <o>    GCS object (default object: config/redirects.json)
//
// Falls back to env CONFIG_FILE, or CONFIG_BUCKET/CONFIG_OBJECT, when flags are
// omitted.
//
// Subcommands:
//
//	list                       list all mappings
//	add <host> <target>        add or replace a mapping
//	remove <host>              remove a mapping
//	dns [host]                 print DNS instructions (all hosts, or one)
//	validate                   validate the current config
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"text/tabwriter"

	"github.com/F3-Nation/f3-nation/apps/redirect/server/internal/mappings"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		usage()
		return fmt.Errorf("a subcommand is required")
	}
	cmd, rest := args[0], args[1:]

	switch cmd {
	case "list":
		return cmdList(rest)
	case "add":
		return cmdAdd(rest)
	case "remove", "rm":
		return cmdRemove(rest)
	case "dns":
		return cmdDNS(rest)
	case "validate":
		return cmdValidate(rest)
	case "-h", "--help", "help":
		usage()
		return nil
	default:
		usage()
		return fmt.Errorf("unknown subcommand %q", cmd)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `f3redirect — admin CLI for the redirect service

Usage:
  f3redirect <command> [flags]

Commands:
  list                       List all mappings
  add <host> <target>        Add or replace a mapping
  remove <host>              Remove a mapping
  dns [host]                 Print DNS instructions (all, or one host)
  validate                   Validate the config

Storage flags (any command):
  --file <path>              Local JSON config file
  --bucket <name>            GCS bucket
  --object <name>            GCS object (default: config/redirects.json)

DNS flags (dns command):
  --static-ip <ip>           Static IP that apex A-records point to
  --canonical-host <host>    Hostname that subdomains CNAME to
`)
}

// storageFlags adds the storage-selection flags to fs and returns a resolver.
func storageFlags(fs *flag.FlagSet) func() (mappings.Store, func(), error) {
	file := fs.String("file", os.Getenv("CONFIG_FILE"), "local JSON config file")
	bucket := fs.String("bucket", os.Getenv("CONFIG_BUCKET"), "GCS bucket")
	object := fs.String("object", envDefault("CONFIG_OBJECT", "config/redirects.json"), "GCS object")
	return func() (mappings.Store, func(), error) {
		if *file != "" {
			return mappings.NewFileStore(*file), func() {}, nil
		}
		if *bucket == "" {
			return nil, nil, fmt.Errorf("no storage configured: pass --file, or --bucket (or set CONFIG_FILE / CONFIG_BUCKET)")
		}
		gs, err := mappings.NewGCSStore(context.Background(), *bucket, *object)
		if err != nil {
			return nil, nil, err
		}
		return gs, func() { _ = gs.Close() }, nil
	}
}

func cmdList(args []string) error {
	fs := flag.NewFlagSet("list", flag.ContinueOnError)
	open := storageFlags(fs)
	if err := fs.Parse(args); err != nil {
		return err
	}
	store, closeFn, err := open()
	if err != nil {
		return err
	}
	defer closeFn()
	cfg, err := store.Load(context.Background())
	if err != nil {
		return err
	}
	if len(cfg.Mappings) == 0 {
		fmt.Println("(no mappings)")
		return nil
	}
	tw := tabwriter.NewWriter(os.Stdout, 0, 2, 2, ' ', 0)
	fmt.Fprintln(tw, "HOST\tKIND\tTARGET")
	for _, h := range cfg.Hosts() {
		target, _ := cfg.Resolve(h)
		kind := "subdomain"
		if mappings.IsApex(h) {
			kind = "apex"
		}
		fmt.Fprintf(tw, "%s\t%s\t%s\n", h, kind, target)
	}
	return tw.Flush()
}

func cmdAdd(args []string) error {
	fs := flag.NewFlagSet("add", flag.ContinueOnError)
	open := storageFlags(fs)
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 2 {
		return fmt.Errorf("usage: f3redirect add <host> <target>")
	}
	host, target := fs.Arg(0), fs.Arg(1)
	store, closeFn, err := open()
	if err != nil {
		return err
	}
	defer closeFn()
	ctx := context.Background()
	cfg, err := store.Load(ctx)
	if err != nil {
		return err
	}
	cfg = cfg.Upsert(host, target)
	if err := store.Save(ctx, cfg); err != nil {
		return err
	}
	fmt.Printf("added %s -> %s\n", mappings.NormalizeHost(host), target)
	return nil
}

func cmdRemove(args []string) error {
	fs := flag.NewFlagSet("remove", flag.ContinueOnError)
	open := storageFlags(fs)
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 1 {
		return fmt.Errorf("usage: f3redirect remove <host>")
	}
	store, closeFn, err := open()
	if err != nil {
		return err
	}
	defer closeFn()
	ctx := context.Background()
	cfg, err := store.Load(ctx)
	if err != nil {
		return err
	}
	cfg, removed := cfg.Remove(fs.Arg(0))
	if !removed {
		return fmt.Errorf("no mapping for %q", fs.Arg(0))
	}
	if err := store.Save(ctx, cfg); err != nil {
		return err
	}
	fmt.Printf("removed %s\n", mappings.NormalizeHost(fs.Arg(0)))
	return nil
}

func cmdValidate(args []string) error {
	fs := flag.NewFlagSet("validate", flag.ContinueOnError)
	open := storageFlags(fs)
	if err := fs.Parse(args); err != nil {
		return err
	}
	store, closeFn, err := open()
	if err != nil {
		return err
	}
	defer closeFn()
	cfg, err := store.Load(context.Background())
	if err != nil {
		return err
	}
	if err := cfg.Validate(); err != nil {
		return err
	}
	fmt.Printf("ok: %d mapping(s) valid\n", len(cfg.Mappings))
	return nil
}

func cmdDNS(args []string) error {
	fs := flag.NewFlagSet("dns", flag.ContinueOnError)
	open := storageFlags(fs)
	staticIP := fs.String("static-ip", os.Getenv("STATIC_IP"), "static IP for apex A-records")
	canonical := fs.String("canonical-host", os.Getenv("CANONICAL_HOST"), "hostname subdomains CNAME to")
	if err := fs.Parse(args); err != nil {
		return err
	}
	store, closeFn, err := open()
	if err != nil {
		return err
	}
	defer closeFn()
	cfg, err := store.Load(context.Background())
	if err != nil {
		return err
	}

	opt := mappings.DNSOptions{StaticIP: *staticIP, CanonicalHost: *canonical}
	if opt.StaticIP == "" {
		fmt.Fprintln(os.Stderr, "warning: --static-ip not set; apex A-records will show an empty value")
	}

	only := ""
	if fs.NArg() > 1 {
		return fmt.Errorf("usage: f3redirect dns [host]")
	}
	if fs.NArg() == 1 {
		only = mappings.NormalizeHost(fs.Arg(0))
	}

	tw := tabwriter.NewWriter(os.Stdout, 0, 2, 2, ' ', 0)
	fmt.Fprintln(tw, "TYPE\tNAME\tVALUE\tNEEDED")
	for _, m := range cfg.Mappings {
		if only != "" && mappings.NormalizeHost(m.Host) != only {
			continue
		}
		for _, rec := range mappings.DNSInstructions(m, opt) {
			needed := "required"
			if rec.Optional {
				needed = "recommended"
			}
			fmt.Fprintf(tw, "%s\t%s\t%s\t%s\n", rec.Type, rec.Name, rec.Value, needed)
		}
	}
	return tw.Flush()
}

func envDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
