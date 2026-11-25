package online

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

// flacHead is the start of a real FLAC file: the marker and a STREAMINFO block header.
func flacHead(seconds int) []byte {
	b := []byte("fLaC\x00\x00\x00\x22\x10\x00\x10\x00\x00\x00\x10\x00")
	for range 34 {
		b = append(b, 0)
	}
	return b
}

// mp3Head is an ID3 tag followed by the first MPEG frame of a real 128 kbps file.
func mp3Head() []byte {
	b := []byte("ID3\x03\x00\x00\x00\x00\x00\x35")
	b = append(b, make([]byte, 0x35)...)
	return append(b, 0xff, 0xfb, 0xe0, 0x64)
}

// lxServer answers the searches and hands out whatever bodies says for a rate.
func lxServer(t *testing.T, bodies map[string][]byte) (*httptest.Server, *[]string) {
	t.Helper()
	var asked []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/rest/search3":
			var songs []map[string]any
			if strings.HasPrefix(r.URL.Query().Get("query"), "kw:") {
				songs = []map[string]any{{"id": "kw_1", "title": "雨中的恋人", "artist": "曼丽", "duration": 294, "suffix": "mp3"}}
			}
			json.NewEncoder(w).Encode(map[string]any{"subsonic-response": map[string]any{"status": "ok",
				"searchResult3": map[string]any{"song": songs}}})
		case "/rest/stream":
			rate := r.URL.Query().Get("maxBitRate")
			asked = append(asked, rate)
			b, ok := bodies[rate]
			if !ok {
				b = bodies["*"]
			}
			w.Header().Set("Content-Length", strconv.Itoa(len(b)))
			w.Write(b)
		default:
			t.Errorf("unexpected request %s", r.URL.Path)
		}
	}))
	return srv, &asked
}

func lxService(srv *httptest.Server) *Service {
	l := &Lx{BaseURL: srv.URL + "/rest", User: "u", Password: "p", Client: srv.Client()}
	return New(slog.New(slog.NewTextHandler(io.Discard, nil)), srv.Client(), l)
}

// A 洛雪 song whose best form is no audio at all comes back from the rate that does play it,
// before the speaker is ever sent to it. 酷我 hands over an encrypted .mflac for some songs at
// some rates; a smaller rate is what the platform serves a playable file for.
func TestLxStreamFallsToARateThatPlays(t *testing.T) {
	srv, asked := lxServer(t, map[string][]byte{
		"":    {0x29, 0x17, 0x55, 0x67, 0x33, 0x46, 0x79, 0x6e}, // the encrypted container
		"320": flacHead(285),
		"128": flacHead(285),
	})
	defer srv.Close()
	svc := lxService(srv)
	f, outs := svc.Find(context.Background(), []Reading{{Title: "雨中的恋人", Artist: "曼丽"}}, "雨中的恋人 曼丽")
	if f == nil {
		t.Fatalf("nothing found: %+v", outs)
	}
	if f.Stream.Type != "320" {
		t.Fatalf("stream taken at %q, want the first rate that plays", f.Stream.Type)
	}
	if want := []string{"", "320"}; strings.Join(*asked, ",") != strings.Join(want, ",") {
		t.Fatalf("asked %v, want %v", *asked, want)
	}
}

// A song whose best form is audio is taken as it is, without asking again.
func TestLxStreamThatPlaysIsTakenAsItIs(t *testing.T) {
	srv, asked := lxServer(t, map[string][]byte{"*": flacHead(285)})
	defer srv.Close()
	svc := lxService(srv)
	f, outs := svc.Find(context.Background(), []Reading{{Title: "雨中的恋人", Artist: "曼丽"}}, "雨中的恋人 曼丽")
	if f == nil {
		t.Fatalf("nothing found: %+v", outs)
	}
	if len(*asked) != 1 || (*asked)[0] != "" {
		t.Fatalf("asked %v, want the best form only", *asked)
	}
	if f.Stream.Type != "" {
		t.Fatalf("stream taken at %q, want its own quality", f.Stream.Type)
	}
}

// A song that is no audio at any rate is not offered: the speaker is never sent to silence.
func TestLxStreamThatNeverPlaysIsRefused(t *testing.T) {
	srv, asked := lxServer(t, map[string][]byte{"*": {0x29, 0x17, 0x55, 0x67, 0x33, 0x46}})
	defer srv.Close()
	svc := lxService(srv)
	f, _ := svc.Find(context.Background(), []Reading{{Title: "雨中的恋人", Artist: "曼丽"}}, "雨中的恋人 曼丽")
	if f != nil {
		t.Fatalf("offered a stream that is no audio: %+v", f.Stream)
	}
	if len(*asked) != len(lxFalls) {
		t.Fatalf("asked %v, want every rate tried", *asked)
	}
}

// A container is recognised from its marker; what these bytes say is not whether the song has
// a length, only whether they are audio at all.
func TestLxPlaysSeesRealAudio(t *testing.T) {
	for _, tc := range []struct {
		name string
		head []byte
		want bool
	}{
		{"flac", flacHead(200), true},
		{"mp3", mp3Head(), true},
		{"ogg", []byte("OggS\x00\x02"), true},
		{"mp4", []byte("\x00\x00\x00\x20ftypmp42"), true},
		{"bare frame", []byte{0xff, 0xfb, 0xe0, 0x64}, true},
		{"encrypted", []byte{0x29, 0x17, 0x55, 0x67}, false},
		{"empty", nil, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := audioHead(tc.head); got != tc.want {
				t.Fatalf("audioHead = %v, want %v", got, tc.want)
			}
		})
	}
}
