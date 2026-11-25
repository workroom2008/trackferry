package stream

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func proxyGet(t *testing.T, s *Server, open Opener, method, rng string) *httptest.ResponseRecorder {
	t.Helper()
	h, err := s.Proxy(open, "x", time.Minute, "audio/mpeg")
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(h.URL)
	r := httptest.NewRequest(method, u.Path, nil)
	if rng != "" {
		r.Header.Set("Range", rng)
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}

func TestProxyForwardsRange(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Set-Cookie", "secret=1")
		http.ServeContent(w, r, "a.mp3", time.Time{}, strings.NewReader("0123456789"))
	}))
	defer up.Close()
	open := func(ctx context.Context, rng string) (*http.Response, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", up.URL, nil)
		if rng != "" {
			req.Header.Set("Range", rng)
		}
		return http.DefaultClient.Do(req)
	}
	s := New("http://10.0.0.2:1", t.TempDir())
	w := proxyGet(t, s, open, "GET", "bytes=2-5")
	if w.Code != 206 || w.Body.String() != "2345" || w.Header().Get("Content-Range") != "bytes 2-5/10" {
		t.Fatalf("%d %q %v", w.Code, w.Body, w.Header())
	}
	if w.Header().Get("Content-Type") != "audio/mpeg" || w.Header().Get("Set-Cookie") != "" {
		t.Fatalf("headers %v", w.Header())
	}
	if w = proxyGet(t, s, open, "HEAD", ""); w.Code != 200 || w.Body.Len() != 0 || w.Header().Get("Content-Length") != "10" {
		t.Fatalf("head %d %v", w.Code, w.Header())
	}
}

func TestProxySourceFailureHidesAddress(t *testing.T) {
	w := proxyGet(t, New("http://10.0.0.2:1", t.TempDir()), func(context.Context, string) (*http.Response, error) {
		return nil, errors.New("dial https://cdn.example/secret")
	}, "GET", "")
	b, _ := io.ReadAll(w.Result().Body)
	if w.Code != http.StatusBadGateway || strings.Contains(string(b), "secret") {
		t.Fatalf("%d %s", w.Code, b)
	}
}
