package certstore

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"sort"
	"testing"
	"time"

	"cloud.google.com/go/storage"
)

// These tests exercise OUR certmagic.Storage adapter (error mapping, key
// prefixing/trimming, directory-delete, and the distributed lock's
// conditional-create + release) against a real GCS-compatible backend
// (fsouza/fake-gcs-server) — not the GCS client itself. If docker or the
// emulator isn't available the suite skips loudly (CI runs it for real).

const (
	testBucket   = "certstore-test"
	emulatorHost = "localhost:9023"
	containerNm  = "certstore-fakegcs-test"
)

func TestMain(m *testing.M) {
	code, err := withEmulator(m)
	if err != nil {
		// In CI, a missing emulator is a hard failure — silently exiting 0
		// would turn a broken GCS adapter into a false green. Locally (no CI
		// env) we skip so `go test ./...` stays runnable without docker.
		if os.Getenv("CI") != "" {
			fmt.Println("FAIL certstore (emulator unavailable in CI):", err)
			os.Exit(1)
		}
		fmt.Println("SKIP certstore (emulator unavailable):", err)
		os.Exit(0)
	}
	os.Exit(code)
}

func withEmulator(m *testing.M) (int, error) {
	if _, err := exec.LookPath("docker"); err != nil {
		return 0, fmt.Errorf("docker not on PATH")
	}
	_ = exec.Command("docker", "rm", "-f", containerNm).Run()
	// -public-host must match the emulator address or object media downloads
	// (NewReader) resolve to the wrong host and 404, even though the JSON API
	// (Stat/List) works.
	out, err := exec.Command("docker", "run", "-d", "--name", containerNm,
		"-p", "9023:4443", "fsouza/fake-gcs-server:latest",
		"-scheme", "http", "-port", "4443", "-backend", "memory",
		"-public-host", emulatorHost).CombinedOutput()
	if err != nil {
		return 0, fmt.Errorf("docker run: %v: %s", err, out)
	}
	defer exec.Command("docker", "rm", "-f", containerNm).Run()

	os.Setenv("STORAGE_EMULATOR_HOST", emulatorHost)

	ready := false
	for i := 0; i < 80; i++ {
		resp, err := http.Get("http://" + emulatorHost + "/storage/v1/b?project=test")
		if err == nil {
			resp.Body.Close()
			ready = true
			break
		}
		time.Sleep(250 * time.Millisecond)
	}
	if !ready {
		return 0, fmt.Errorf("emulator never became ready")
	}

	ctx := context.Background()
	client, err := storage.NewClient(ctx)
	if err != nil {
		return 0, fmt.Errorf("storage client: %v", err)
	}
	if err := client.Bucket(testBucket).Create(ctx, "test", nil); err != nil {
		client.Close()
		return 0, fmt.Errorf("create bucket: %v", err)
	}
	client.Close()

	return m.Run(), nil
}

func newStore(t *testing.T, prefix string) *GCS {
	t.Helper()
	g, err := New(context.Background(), testBucket, prefix)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { g.Close() })
	return g
}

func TestLoadMissingReturnsErrNotExist(t *testing.T) {
	g := newStore(t, "certs")
	_, err := g.Load(context.Background(), "nope/missing.txt")
	if !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("Load(missing) err = %v, want fs.ErrNotExist (our mapping)", err)
	}
}

func TestStoreLoadDelete(t *testing.T) {
	g := newStore(t, "certs")
	ctx := context.Background()
	key := "roundtrip/key.pem"
	want := []byte("cert-bytes")
	if err := g.Store(ctx, key, want); err != nil {
		t.Fatal(err)
	}
	got, err := g.Load(ctx, key)
	if err != nil || string(got) != string(want) {
		t.Fatalf("Load = %q,%v", got, err)
	}
	if !g.Exists(ctx, key) {
		t.Error("Exists should be true after Store")
	}
	if err := g.Delete(ctx, key); err != nil {
		t.Fatal(err)
	}
	if _, err := g.Load(ctx, key); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("Load after Delete err = %v, want fs.ErrNotExist", err)
	}
}

func TestListTrimsPrefix(t *testing.T) {
	g := newStore(t, "certs")
	ctx := context.Background()
	for _, k := range []string{"site/a.pem", "site/b.pem"} {
		if err := g.Store(ctx, k, []byte("x")); err != nil {
			t.Fatal(err)
		}
	}
	got, err := g.List(ctx, "site", true)
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(got)
	want := []string{"site/a.pem", "site/b.pem"}
	// Crucially: keys are returned WITHOUT our internal "certs/" prefix — that
	// trimming is our adapter's responsibility (certmagic relies on it).
	if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("List = %v, want %v (prefix must be trimmed)", got, want)
	}
}

func TestDeleteDirectoryPrefix(t *testing.T) {
	g := newStore(t, "certs")
	ctx := context.Background()
	for _, k := range []string{"dir/x.pem", "dir/y.pem"} {
		if err := g.Store(ctx, k, []byte("x")); err != nil {
			t.Fatal(err)
		}
	}
	// Deleting the directory key removes everything under it.
	if err := g.Delete(ctx, "dir"); err != nil {
		t.Fatalf("Delete(dir): %v", err)
	}
	if g.Exists(ctx, "dir/x.pem") || g.Exists(ctx, "dir/y.pem") {
		t.Error("directory delete should remove all keys under the prefix")
	}
}

func TestStat(t *testing.T) {
	g := newStore(t, "certs")
	ctx := context.Background()
	if err := g.Store(ctx, "s/info.pem", []byte("hello")); err != nil {
		t.Fatal(err)
	}
	ki, err := g.Stat(ctx, "s/info.pem")
	if err != nil {
		t.Fatal(err)
	}
	if ki.Key != "s/info.pem" || ki.Size != 5 {
		t.Errorf("Stat = %+v, want Key=s/info.pem Size=5", ki)
	}
	if _, err := g.Stat(ctx, "s/missing.pem"); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("Stat(missing) err = %v, want fs.ErrNotExist", err)
	}
}

func TestLockMutualExclusionAndRelease(t *testing.T) {
	g := newStore(t, "certs")
	ctx := context.Background()
	const name = "issue-cert-lock"

	if err := g.Lock(ctx, name); err != nil {
		t.Fatalf("first Lock: %v", err)
	}

	// A second acquirer must NOT get the lock while it's held — it blocks until
	// our short context deadline.
	short, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := g.Lock(short, name); err == nil {
		t.Fatal("second Lock acquired while held — mutual exclusion broken")
	}

	// After Unlock, it can be acquired again.
	if err := g.Unlock(ctx, name); err != nil {
		t.Fatalf("Unlock: %v", err)
	}
	reacquire, cancel2 := context.WithTimeout(ctx, 5*time.Second)
	defer cancel2()
	if err := g.Lock(reacquire, name); err != nil {
		t.Fatalf("Lock after Unlock should succeed: %v", err)
	}
	_ = g.Unlock(ctx, name)
}
