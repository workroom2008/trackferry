package online

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The server's address carries its password in the query. Go sends the address a redirect came
// from as the Referer of the next request, so following a 302 to a platform's CDN would hand
// that password to a third party. It is dropped before the request goes out.
func TestRedirectDoesNotLeakTheServerPassword(t *testing.T) {
	var leaked string
	cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		leaked = r.Header.Get("Referer")
		w.Write([]byte("audio"))
	}))
	defer cdn.Close()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, cdn.URL+"/song.flac", http.StatusFound)
	}))
	defer srv.Close()

	c := ClientForServer(srv.URL + "/rest")
	resp, err := c.Get(srv.URL + "/rest/stream?u=hongbo&p=SECRET-123&id=kw_1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)

	if strings.Contains(leaked, "SECRET-123") {
		t.Fatalf("the password went to the CDN in the Referer: %q", leaked)
	}
	if leaked != "" {
		t.Fatalf("a Referer was sent anyway: %q", leaked)
	}
}

// The redirect still has to be followed, and the song still has to come.
func TestRedirectIsStillFollowed(t *testing.T) {
	cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("fLaC and the rest"))
	}))
	defer cdn.Close()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, cdn.URL+"/song.flac", http.StatusFound)
	}))
	defer srv.Close()

	resp, err := ClientForServer(srv.URL+"/rest").Get(srv.URL + "/rest/stream?id=kw_1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if !strings.HasPrefix(string(b), "fLaC") {
		t.Fatalf("body = %q", b)
	}
	if resp.Request.URL.Host != strings.TrimPrefix(cdn.URL, "http://") {
		t.Fatalf("ended at %s, want the CDN", resp.Request.URL)
	}
}

// A circle of redirects is refused rather than followed forever.
func TestRedirectLimit(t *testing.T) {
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, srv.URL+"/again", http.StatusFound)
	}))
	defer srv.Close()

	_, err := ClientForServer(srv.URL + "/rest").Get(srv.URL + "/rest/stream")
	if err == nil {
		t.Fatal("followed a redirect loop")
	}
	_ = context.Background()
}
