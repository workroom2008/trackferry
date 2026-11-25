package stream

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func quick(t *testing.T) {
	t.Helper()
	a, b := stallAfter, reopenWait
	stallAfter, reopenWait = 150*time.Millisecond, []time.Duration{time.Millisecond, time.Millisecond, time.Millisecond}
	t.Cleanup(func() { stallAfter, reopenWait = a, b })
}

// breaking serves data but breaks off (or goes quiet) after every chunk bytes.
func breaking(t *testing.T, data []byte, chunk int, stall, ranges bool) (Opener, *atomic.Int32) {
	var n atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n.Add(1)
		from, to := 0, len(data)-1
		if rng := r.Header.Get("Range"); rng != "" && ranges {
			fmt.Sscanf(rng, "bytes=%d-%d", &from, &to)
			w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", from, to, len(data)))
			w.Header().Set("Content-Length", fmt.Sprint(to-from+1))
			w.WriteHeader(206)
		} else {
			w.Header().Set("Content-Length", fmt.Sprint(len(data)))
		}
		end := min(from+chunk, to+1)
		w.Write(data[from:end])
		if end <= to {
			w.(http.Flusher).Flush()
			if stall {
				<-r.Context().Done()
				return
			}
			panic(http.ErrAbortHandler)
		}
	}))
	t.Cleanup(srv.Close)
	return func(ctx context.Context, rng string) (*http.Response, error) {
		req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL, nil)
		if rng != "" {
			req.Header.Set("Range", rng)
		}
		return http.DefaultClient.Do(req)
	}, &n
}

func fetch(t *testing.T, open Opener, rng string) (*http.Response, []byte, error) {
	s := New("http://nas", t.TempDir())
	h, err := s.Proxy(open, "x", 0, "audio/mpeg")
	if err != nil {
		t.Fatal(err)
	}
	front := httptest.NewServer(s)
	t.Cleanup(front.Close)
	req, _ := http.NewRequest("GET", strings.Replace(h.URL, "http://nas", front.URL, 1), nil)
	if rng != "" {
		req.Header.Set("Range", rng)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	return resp, b, err
}

func song() []byte {
	b := make([]byte, 3<<20)
	for i := range b {
		b[i] = byte(i * 7 >> 3)
	}
	return b
}

func TestBrokenSourceIsPickedUp(t *testing.T) {
	quick(t)
	data := song()
	for _, stall := range []bool{false, true} {
		open, n := breaking(t, data, 700<<10, stall, true)
		_, got, err := fetch(t, open, "")
		if err != nil || !bytes.Equal(got, data) || n.Load() < 4 {
			t.Fatalf("stall %v: %d bytes, %v, %d requests", stall, len(got), err, n.Load())
		}
		resp, got, err := fetch(t, open, "bytes=1000-2000999")
		if err != nil || resp.StatusCode != 206 || !bytes.Equal(got, data[1000:2001000]) {
			t.Fatalf("range, stall %v: %d bytes, %v", stall, len(got), err)
		}
	}
}

func TestBrokenSourceThatCannotSeekEndsWithAnError(t *testing.T) {
	quick(t)
	data := song()
	open, n := breaking(t, data, 700<<10, false, false)
	if _, got, err := fetch(t, open, ""); err == nil || !bytes.HasPrefix(data, got) || n.Load() != 2 {
		t.Fatalf("%d bytes, %v, %d requests", len(got), err, n.Load())
	}
}

func TestDeadSourceGivesUp(t *testing.T) {
	quick(t)
	data := song()
	open, n := breaking(t, data, 0, false, true)
	if _, got, err := fetch(t, open, ""); err == nil || len(got) != 0 || n.Load() > 5 {
		t.Fatalf("%d bytes, %v, %d requests", len(got), err, n.Load())
	}
}

func TestFirstOpenIsTriedAgain(t *testing.T) {
	data := song()
	open, _ := breaking(t, data, len(data), false, true)
	failed := false
	_, got, err := fetch(t, func(ctx context.Context, rng string) (*http.Response, error) {
		if !failed {
			failed = true
			return nil, errors.New("reset")
		}
		return open(ctx, rng)
	}, "")
	if err != nil || !bytes.Equal(got, data) {
		t.Fatal(len(got), err)
	}
}
