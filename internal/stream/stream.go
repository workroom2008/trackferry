// Package stream serves the audio TrackFerry pushes to speakers and records when a speaker
// fetches it. A speaker fetching our URL is the first hard evidence that a takeover
// landed: the play call's receipt and the player status alone do not prove it.
//
// Every stream gets an unguessable token that expires; the speaker needs no login, so the
// token is the only access control. Only files TrackFerry itself chose are served.
package stream

import (
	"bytes"
	"context"
	crand "crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"math"
	"math/rand/v2"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ttl is how long a stream URL stays valid after it was handed out.
const ttl = 6 * time.Hour

// Fetch is evidence that a speaker requested a stream.
type Fetch struct {
	At     time.Time
	Remote string // speaker's IP
	Range  string
}

// Handle is one registered stream.
type Handle struct {
	URL      string
	Label    string
	Duration time.Duration // play length when known (the tone), else 0

	it  *item
	srv *Server

	fetched   chan struct{}
	restarted chan struct{}

	mu     sync.Mutex
	first  Fetch
	count  int
	served Served
	watch  func(Served)
}

// Served is how much of a stream the speaker took so far.
type Served struct {
	Bytes    int64 // of the current request, from its range's start
	Total    int64
	Requests int
	Open     bool
}

// Watch has f called while the speaker fetches, a few times a second at most.
func (h *Handle) Watch(f func(Served)) {
	h.mu.Lock()
	h.watch = f
	h.mu.Unlock()
}

// counter reports what passes through a response.
type counter struct {
	http.ResponseWriter
	h    *Handle
	last time.Time
}

func (c *counter) Unwrap() http.ResponseWriter { return c.ResponseWriter }

func (c *counter) WriteHeader(code int) {
	h := c.h
	h.mu.Lock()
	var from, to, total int64
	if _, err := fmt.Sscanf(c.Header().Get("Content-Range"), "bytes %d-%d/%d", &from, &to, &total); err == nil {
		h.served.Bytes, h.served.Total = from, total
	} else if n, err := strconv.ParseInt(c.Header().Get("Content-Length"), 10, 64); err == nil && code == http.StatusOK {
		h.served.Bytes, h.served.Total = 0, n
	}
	h.mu.Unlock()
	c.ResponseWriter.WriteHeader(code)
}

func (c *counter) Write(b []byte) (int, error) {
	n, err := c.ResponseWriter.Write(b)
	c.add(int64(n), false)
	return n, err
}

func (c *counter) add(n int64, done bool) {
	h := c.h
	h.mu.Lock()
	h.served.Bytes += n
	h.served.Requests, h.served.Open = h.count, !done
	s, f := h.served, h.watch
	h.mu.Unlock()
	if f != nil && (done || time.Since(c.last) > 300*time.Millisecond) {
		c.last = time.Now()
		f(s)
	}
}

// Fetched is closed on the first request for the stream.
func (h *Handle) Fetched() <-chan struct{} { return h.fetched }

// Restarted is closed when the speaker requests the stream from the start again well after
// its first request: it finished the track and is playing it again (a one-item playlist
// on repeat), which is how speakers loop a pushed URL.
func (h *Handle) Restarted() <-chan struct{} { return h.restarted }

// restartGap is how long after the first fetch a request from byte 0 counts as a replay
// rather than the player probing or reconnecting while it starts.
func (h *Handle) restartGap() time.Duration {
	if h.Duration > 0 {
		return h.Duration * 9 / 10
	}
	return 15 * time.Second
}

// First returns the first fetch, if any.
func (h *Handle) First() (Fetch, int) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.first, h.count
}

type item struct {
	h     *Handle
	path  string // file on disk, or
	open  Opener // remote audio, or
	data  []byte // in-memory audio
	ctype string
	name  string
	// The rest of a song: head, then the source from off; total is the length of both.
	head       []byte
	off, total int64
	expires    time.Time
	here       bool // heard in a browser, not on a speaker
}

// Server registers and serves streams.
type Server struct {
	base     string // public base URL the speakers can reach, e.g. http://10.0.0.2:18561
	musicDir string
	Log      *slog.Logger // optional: one line per speaker request (never the token)
	// Remote opens songs that are not files: those whose name starts with RemotePrefix. It
	// returns the URL extension (".flac") too; a nil Opener means it has no such song.
	Remote       func(rel string) (Opener, string)
	RemotePrefix string

	mu      sync.Mutex
	items   map[string]*item
	indexes indexes

	toneOnce sync.Once
	tone     []byte
}

// New returns a Server. base must be reachable from the speakers.
func New(base, musicDir string) *Server {
	return &Server{base: strings.TrimRight(base, "/"), musicDir: musicDir, items: map[string]*item{}}
}

// ErrNoBaseURL means public_base_url is not configured, so speakers cannot reach us.
var ErrNoBaseURL = errors.New("public_base_url is not set")

// Ready reports whether streams can be handed out.
func (s *Server) Ready() error {
	if s.base == "" {
		return ErrNoBaseURL
	}
	return nil
}

func (s *Server) register(it *item, ext string) (*Handle, error) {
	if err := s.Ready(); err != nil {
		return nil, err
	}
	b := make([]byte, 16)
	crand.Read(b)
	tok := hex.EncodeToString(b)
	// Some firmware picks the decoder from the URL's extension.
	it.h.URL = s.base + "/stream/" + tok + ext
	it.h.it, it.h.srv = it, s
	it.h.fetched = make(chan struct{})
	it.h.restarted = make(chan struct{})
	it.expires = time.Now().Add(ttl)
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for k, v := range s.items {
		if now.After(v.expires) {
			delete(s.items, k)
		}
	}
	s.items[tok] = it
	return it.h, nil
}

// ToneLength is the built-in tone's play length.
const ToneLength = 20 * time.Second

// Tone registers the built-in test tone: a gentle chime, ToneLength long, as WAV.
func (s *Server) Tone() (*Handle, error) {
	s.toneOnce.Do(func() { s.tone = chime() })
	return s.register(&item{h: &Handle{Label: "提示音", Duration: ToneLength}, data: s.tone, ctype: "audio/wav", name: "trackferry-tone.wav"}, ".wav")
}

// Opener opens remote audio; rng is the speaker's Range header ("" = everything).
type Opener func(ctx context.Context, rng string) (*http.Response, error)

// Proxy registers remote audio, fetched on demand. The speaker never sees its address. ctype is
// the type asked for; when empty, the bytes themselves decide it, so an mp3 under another name
// or an Ogg is not announced as something the speaker may refuse. d may be 0 when the length is
// not known to be right.
func (s *Server) Proxy(open Opener, label string, d time.Duration, ctype string) (*Handle, error) {
	if ctype == "" {
		open = sniffer(open)
	}
	return s.register(&item{h: &Handle{Label: label, Duration: d}, open: open, ctype: ctype}, ".mp3")
}

// proxied is remote audio as it was announced before the type was told: MP3.
func proxied(open Opener, label string, d time.Duration) *item {
	return &item{h: &Handle{Label: label, Duration: d}, open: open, ctype: "audio/mpeg"}
}

// sniffer makes an opener say what its first bytes are: the platforms hand out their own
// encodings, and a name or a header is no sign of them.
func sniffer(open Opener) Opener {
	return func(ctx context.Context, rng string) (*http.Response, error) {
		resp, err := open(ctx, rng)
		if err != nil || rng != "" || resp.StatusCode != http.StatusOK || resp.Body == nil {
			return resp, err
		}
		head, _ := io.ReadAll(io.LimitReader(resp.Body, 3<<10))
		resp.Body.Close()
		resp.Body = io.NopCloser(io.MultiReader(bytes.NewReader(head), resp.Body))
		resp.Header.Set("Content-Type", sniff(head))
		return resp, nil
	}
}

// sniff names the audio in the first bytes of a stream; unsniffable bytes are announced as a
// binary file, which is what they were.
func sniff(b []byte) string {
	if len(b) >= 4 && (string(b[:4]) == "fLaC" || string(b[:4]) == "OggS") {
		return map[bool]string{true: "audio/flac", false: "audio/ogg"}[string(b[:4]) == "fLaC"]
	}
	if len(b) >= 3 && string(b[:3]) == "ID3" || len(b) >= 2 && b[0] == 0xff && b[1]&0xe6 == 0xe2 {
		return "audio/mpeg"
	}
	return "application/octet-stream"
}

// Song registers a library file whose play length is known (0 = unknown).
func (s *Server) Song(rel, label string, d time.Duration) (*Handle, error) {
	it, ext, err := s.song(rel, label, d)
	if err != nil {
		return nil, err
	}
	return s.register(it, ext)
}

func (s *Server) song(rel, label string, d time.Duration) (*item, string, error) {
	if s.Remote != nil && strings.HasPrefix(rel, s.RemotePrefix) {
		open, ext := s.Remote(rel)
		if open == nil {
			return nil, "", errors.New("song is no longer in the library")
		}
		ctype := audioTypes[ext]
		if ctype == "" {
			ctype = "application/octet-stream"
		}
		return &item{h: &Handle{Label: label, Duration: d}, open: open, ctype: ctype}, ext, nil
	}
	it, ext, err := s.file(rel, label)
	if err == nil {
		it.h.Duration = d
	}
	return it, ext, err
}

// ProxyHere answers a browser's request for remote MP3 audio.
func (s *Server) ProxyHere(w http.ResponseWriter, r *http.Request, open Opener, label string) {
	s.heard(w, r, proxied(open, label, 0))
}

func (s *Server) heard(w http.ResponseWriter, r *http.Request, it *item) {
	it.here, it.h.fetched, it.h.restarted = true, make(chan struct{}), make(chan struct{})
	s.serve(w, r, it)
}

// Openable reports whether a song can be opened right now.
func (s *Server) Openable(rel string) bool {
	if s.Remote != nil && strings.HasPrefix(rel, s.RemotePrefix) {
		open, _ := s.Remote(rel)
		if open == nil {
			return false
		}
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		defer cancel()
		resp, err := open(ctx, "bytes=0-0")
		if err != nil {
			return false
		}
		resp.Body.Close()
		return true
	}
	f, err := os.Open(filepath.Join(s.musicDir, filepath.FromSlash(rel)))
	if err != nil {
		return false
	}
	f.Close()
	return true
}

// File registers a file below the music directory. rel must stay inside it.
func (s *Server) File(rel, label string) (*Handle, error) {
	it, ext, err := s.file(rel, label)
	if err != nil {
		return nil, err
	}
	return s.register(it, ext)
}

func (s *Server) file(rel, label string) (*item, string, error) {
	root, err := filepath.Abs(s.musicDir)
	if err != nil {
		return nil, "", err
	}
	p := filepath.Join(root, filepath.FromSlash(rel))
	if p != root && !strings.HasPrefix(p, root+string(filepath.Separator)) {
		return nil, "", errors.New("path escapes the music directory")
	}
	if fi, err := os.Stat(p); err != nil || !fi.Mode().IsRegular() {
		return nil, "", errors.New("not a readable file")
	}
	ext := strings.ToLower(filepath.Ext(p))
	ctype := mime.TypeByExtension(ext)
	if ctype == "" {
		ctype = audioTypes[ext]
	}
	if label == "" {
		label = filepath.Base(p)
	}
	return &item{h: &Handle{Label: label}, path: p, ctype: ctype, name: filepath.Base(p)}, ext, nil
}

var audioTypes = map[string]string{".mp3": "audio/mpeg", ".flac": "audio/flac", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".wav": "audio/wav"}

// RandomFile picks an audio file from the music directory for a playback test, preferring
// MP3 (the format every speaker decodes). It looks at a bounded number of entries so a
// large library does not stall the request.
func (s *Server) RandomFile() (string, error) {
	root := s.musicDir
	var mp3, other []string
	seen := 0
	deadline := time.Now().Add(3 * time.Second)
	stop := errors.New("enough")
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // unreadable folder: skip it
		}
		if seen++; seen > 20000 || time.Now().After(deadline) || len(mp3) >= 500 {
			return stop
		}
		if d.IsDir() {
			if strings.HasPrefix(d.Name(), ".") || strings.HasPrefix(d.Name(), "@") {
				return filepath.SkipDir // hidden and NAS system folders
			}
			return nil
		}
		ext := strings.ToLower(filepath.Ext(p))
		if _, ok := audioTypes[ext]; !ok {
			return nil
		}
		rel, _ := filepath.Rel(root, p)
		if ext == ".mp3" {
			mp3 = append(mp3, filepath.ToSlash(rel))
		} else {
			other = append(other, filepath.ToSlash(rel))
		}
		return nil
	})
	if err != nil && err != stop {
		return "", err
	}
	pool := mp3
	if len(pool) == 0 {
		pool = other
	}
	if len(pool) == 0 {
		return "", errors.New("no audio files found in the music directory")
	}
	return pool[rand.IntN(len(pool))], nil
}

// ServeHTTP serves GET/HEAD /stream/{token}[.ext].
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	tok := strings.TrimPrefix(r.URL.Path, "/stream/")
	if i := strings.IndexByte(tok, '.'); i >= 0 {
		tok = tok[:i]
	}
	s.mu.Lock()
	it := s.items[tok]
	s.mu.Unlock()
	if it == nil || time.Now().After(it.expires) {
		http.NotFound(w, r)
		return
	}
	s.serve(w, r, it)
}

func (s *Server) serve(w http.ResponseWriter, r *http.Request, it *item) {
	h := it.h
	rng := r.Header.Get("Range")
	now := time.Now()
	h.mu.Lock()
	if h.count == 0 {
		h.first = Fetch{At: now, Remote: remoteIP(r), Range: rng}
		close(h.fetched)
	} else if fromStart(rng) && now.Sub(h.first.At) >= h.restartGap() {
		select {
		case <-h.restarted:
		default:
			close(h.restarted)
		}
	}
	h.count++
	n, since := h.count, now.Sub(h.first.At)
	h.mu.Unlock()
	if s.Log != nil && !it.here {
		s.Log.Info("音频　音箱来取", "音频", h.Label, "第几次", n, "投放后ms", since.Milliseconds(), "方式", r.Method, "范围", rng, "来自", remoteIP(r))
	}

	// Audio outlives the server's general write timeout.
	http.NewResponseController(w).SetWriteDeadline(time.Now().Add(3 * time.Hour))
	if it.ctype != "" {
		w.Header().Set("Content-Type", it.ctype)
	}
	w.Header().Set("Cache-Control", "no-store")
	c := &counter{ResponseWriter: w, h: h}
	defer c.add(0, true)
	w = c
	if it.head != nil {
		s.middle(w, r, it)
		return
	}
	if it.data != nil {
		http.ServeContent(w, r, it.name, time.Time{}, bytes.NewReader(it.data))
		return
	}
	if it.open != nil {
		s.proxy(w, r, it)
		return
	}
	f, err := os.Open(it.path)
	if err != nil {
		http.Error(w, "unavailable", http.StatusNotFound)
		return
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		http.Error(w, "unavailable", http.StatusNotFound)
		return
	}
	http.ServeContent(w, r, it.name, fi.ModTime(), f)
}

func (s *Server) proxy(w http.ResponseWriter, r *http.Request, it *item) {
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	resp, err := openAgain(ctx, it.open, r.Header.Get("Range"))
	if err != nil {
		if s.Log != nil && r.Context().Err() == nil {
			s.Log.Warn("音频　来源中断", "音频", it.h.Label) // the error may carry the address
		}
		http.Error(w, "source unavailable", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	for _, k := range []string{"Content-Length", "Content-Range", "Accept-Ranges"} {
		if v := resp.Header.Get(k); v != "" {
			w.Header().Set(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	if r.Method != http.MethodHead {
		body := io.Reader(resp.Body)
		if st := s.steady(r.Context(), it, resp, cancel); st != nil {
			defer st.Close()
			body = st
		}
		n, err := io.Copy(w, body)
		if s.Log != nil && !it.here {
			s.Log.Info("音频　传完", "音频", it.h.Label, "字节", n, "完整", err == nil)
		}
	}
}

// steady wraps a response so it survives its source breaking off; nil when the response does
// not say which bytes it holds.
func (s *Server) steady(ctx context.Context, it *item, resp *http.Response, cancel context.CancelFunc) *steady {
	st := &steady{ctx: ctx, open: it.open, body: resp.Body, cancel: cancel, note: s.reopened(it)}
	switch resp.StatusCode {
	case http.StatusOK:
		if resp.ContentLength <= 0 {
			return nil
		}
		st.end, st.total = resp.ContentLength, resp.ContentLength
	case http.StatusPartialContent:
		var last int64
		if _, err := fmt.Sscanf(resp.Header.Get("Content-Range"), "bytes %d-%d/%d", &st.off, &last, &st.total); err != nil {
			return nil
		}
		st.end = last + 1
	default:
		return nil
	}
	return st
}

func (s *Server) reopened(it *item) func(int64) {
	return func(off int64) {
		if s.Log != nil {
			s.Log.Warn("音频　来源断了，已接着读", "音频", it.h.Label, "从字节", off)
		}
	}
}

// fromStart reports whether a request reads the stream from its first byte.
func fromStart(rng string) bool {
	return rng == "" || strings.HasPrefix(strings.ReplaceAll(rng, " ", ""), "bytes=0-")
}

func remoteIP(r *http.Request) string {
	host := r.RemoteAddr
	if i := strings.LastIndexByte(host, ':'); i > 0 {
		host = host[:i]
	}
	return strings.Trim(host, "[]")
}

// chime renders a soft two-note chime repeated over ~20 s: 16-bit mono PCM WAV, 22.05 kHz.
func chime() []byte {
	const rate, secs = 22050, 20
	n := rate * secs
	pcm := make([]int16, n)
	notes := []float64{659.25, 523.25} // E5, C5
	for start := 0; start < n; start += rate * 2 {
		for k, f := range notes {
			off := start + k*rate/2
			for i := 0; i < rate*3/2 && off+i < n; i++ {
				t := float64(i) / rate
				v := math.Sin(2*math.Pi*f*t) * math.Exp(-3*t) * 0.3
				s := float64(pcm[off+i]) + v*math.MaxInt16
				pcm[off+i] = int16(max(-math.MaxInt16, min(math.MaxInt16, s)))
			}
		}
	}
	var b bytes.Buffer
	le := binary.LittleEndian
	b.WriteString("RIFF")
	binary.Write(&b, le, uint32(36+n*2))
	b.WriteString("WAVEfmt ")
	binary.Write(&b, le, uint32(16))
	binary.Write(&b, le, uint16(1)) // PCM
	binary.Write(&b, le, uint16(1)) // mono
	binary.Write(&b, le, uint32(rate))
	binary.Write(&b, le, uint32(rate*2))
	binary.Write(&b, le, uint16(2))
	binary.Write(&b, le, uint16(16))
	b.WriteString("data")
	binary.Write(&b, le, uint32(n*2))
	binary.Write(&b, le, pcm)
	return b.Bytes()
}
