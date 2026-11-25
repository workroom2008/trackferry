package online

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// Subsonic takes a salted token instead of the password. The stream address is handed to the
// speaker and appears in logs, so it must not carry the password at all.
func TestLxAuthUsesAToken(t *testing.T) {
	const user, password = "hongbo", "SECRET-123"
	var sawQuery url.Values
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawQuery = r.URL.Query()
		json.NewEncoder(w).Encode(map[string]any{"subsonic-response": map[string]any{"status": "ok"}})
	}))
	defer srv.Close()

	l := &Lx{BaseURL: srv.URL + "/rest", User: user, Password: password, Client: srv.Client()}
	if err := l.Check(context.Background()); err != nil {
		t.Fatalf("check: %v", err)
	}

	if got := sawQuery.Get("p"); got != "" {
		t.Fatalf("the password went out in the clear: p=%q", got)
	}
	if sawQuery.Get("u") != user {
		t.Fatalf("user = %q", sawQuery.Get("u"))
	}
	salt, token := sawQuery.Get("s"), sawQuery.Get("t")
	if salt == "" || token == "" {
		t.Fatalf("no salt or token: s=%q t=%q", salt, token)
	}
	sum := md5.Sum([]byte(password + salt))
	if want := hex.EncodeToString(sum[:]); token != want {
		t.Fatalf("token = %q, want %q", token, want)
	}
}

// The stream address is what the speaker is given, and what ends up in logs and in database
// rows: it must not hold the password either.
func TestLxStreamAddressCarriesNoPassword(t *testing.T) {
	l := &Lx{BaseURL: "http://192.168.1.10:9527/rest", User: "hongbo", Password: "SECRET-123"}
	for _, rate := range lxFalls {
		u, err := l.ResolveAt(context.Background(), Candidate{ID: "kw_1"}, rate)
		if err != nil {
			t.Fatalf("resolve: %v", err)
		}
		if strings.Contains(u, "SECRET-123") {
			t.Fatalf("password in the address (rate %q): %s", rate, u)
		}
		if strings.Contains(u, "p=") {
			t.Fatalf("a clear password field is still there (rate %q): %s", rate, u)
		}
		parsed, err := url.Parse(u)
		if err != nil {
			t.Fatalf("address does not parse: %v", err)
		}
		q := parsed.Query()
		if q.Get("u") != "hongbo" || q.Get("s") == "" || q.Get("t") == "" {
			t.Fatalf("no token auth in the address: %s", u)
		}
		if q.Get("id") != "kw_1" {
			t.Fatalf("song lost: %s", u)
		}
		if rate != "" && q.Get("maxBitRate") != rate {
			t.Fatalf("rate lost: %s", u)
		}
	}
}

// Two requests do not share a salt: the same song asked twice does not give the same address,
// so neither can be replayed from a log.
func TestLxSaltIsFreshEachTime(t *testing.T) {
	l := &Lx{BaseURL: "http://192.168.1.10:9527/rest", User: "hongbo", Password: "SECRET-123"}
	seen := map[string]bool{}
	for range 8 {
		u, err := l.ResolveAt(context.Background(), Candidate{ID: "kw_1"}, "")
		if err != nil {
			t.Fatalf("resolve: %v", err)
		}
		salt := mustQuery(t, u).Get("s")
		if seen[salt] {
			t.Fatalf("salt %q used twice", salt)
		}
		seen[salt] = true
	}
}

func mustQuery(t *testing.T, raw string) url.Values {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse %q: %v", raw, err)
	}
	return u.Query()
}
