package online

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A 洛雪 server answers in Subsonic's shape, wrapped once. Each platform is asked on its own,
// and the first with songs answers: the id says which platform a song came from.
func TestLxSearchAsksPlatformsAtOnce(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query().Get("query")
		if r.URL.Path != "/rest/search3" || r.URL.Query().Get("u") != "u" {
			t.Errorf("unexpected request %s?%s", r.URL.Path, r.URL.RawQuery)
		}
		platform, _, _ := strings.Cut(q, ":")
		var songs []map[string]any
		if platform == "kg" {
			songs = []map[string]any{{"id": "kg_1", "title": "模特", "artist": "李荣浩", "duration": 308, "suffix": "flac"}}
		}
		json.NewEncoder(w).Encode(map[string]any{"subsonic-response": map[string]any{"status": "ok",
			"searchResult3": map[string]any{"song": songs}}})
	}))
	defer srv.Close()
	l := &Lx{BaseURL: srv.URL + "/rest", User: "u", Password: "p", Client: srv.Client()}
	cs, err := l.Search(context.Background(), "李荣浩 模特")
	if err != nil || len(cs) != 1 {
		t.Fatalf("search = %+v, %v", cs, err)
	}
	if cs[0].ID != "kg_1" || cs[0].Duration != 308_000_000_000 {
		t.Fatalf("candidate = %+v", cs[0])
	}
	if got := LxName(lxPlatformOf(cs[0].ID)); got != "酷狗" {
		t.Fatalf("platform = %q", got)
	}
	if u, err := l.Resolve(context.Background(), cs[0]); err != nil || u == "" {
		t.Fatalf("resolve = %q, %v", u, err)
	}
}

// A server on this network is reached by its own client, which is allowed a private address.
func TestLxClientReachesAPrivateAddress(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"subsonic-response": map[string]any{"status": "ok"}})
	}))
	defer srv.Close()
	c := ClientWith(LxHosts(srv.URL + "/rest"))
	if _, err := c.Get(srv.URL + "/rest/ping"); err != nil {
		t.Fatalf("private address refused: %v", err)
	}
	// The platforms' own client still refuses anything it does not know.
	if _, err := Client().Get(srv.URL + "/rest/ping"); err == nil {
		t.Fatal("the shared client reached a private address")
	}
}
