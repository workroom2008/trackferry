package api

import (
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"trackferry/internal/intent"
	"trackferry/internal/library"
	"trackferry/internal/live"
)

func (s *Server) libraryStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"library": s.Library.Status(), "sources": s.Router.Online.Health(),
		"every_minutes": s.Library.Every(r.Context())})
}

// libraryEvery sets how often the library is read again.
func (s *Server) libraryEvery(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Minutes int `json:"minutes"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if !slices.Contains(library.Minutes, req.Minutes) {
		writeError(w, http.StatusBadRequest, "bad_minutes", "只能是 0（不自动同步）、5、15、30、60、180、360、720 或 1440 分钟")
		return
	}
	if err := s.Library.SetEvery(r.Context(), req.Minutes); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"every_minutes": req.Minutes})
}

func (s *Server) libraryScan(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusAccepted, map[string]bool{"started": s.Library.Rescan()})
}

func (s *Server) librarySearch(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(q)) > 100 {
		writeError(w, http.StatusBadRequest, "too_long", "搜索词太长了")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tracks": s.Library.Find(q, 50)})
}

// routeTry answers "who would play this" without touching a speaker.
func (s *Server) routeTry(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Text string `json:"text"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	text := strings.TrimSpace(req.Text)
	if text == "" || len([]rune(text)) > 100 {
		writeError(w, http.StatusBadRequest, "bad_text", "说一句点歌的话，100 字以内")
		return
	}
	in := intent.Parse(text)
	if !in.Music() {
		in = intent.Parse("播放" + text) // a bare song name
	}
	tr := s.Live.Begin(live.Flow{Kind: "try", Said: text, Intent: in})
	rt := s.Router.Decide(live.With(r.Context(), tr), in, text)
	tr.Done("")
	rt.Preview = true
	writeJSON(w, http.StatusOK, map[string]any{"intent": in, "route": rt})
}

// intentGuide lists what is understood; intentExplain says how one sentence is.
func (s *Server) intentGuide(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, intent.TheGuide())
}

func (s *Server) intentExplain(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Text string `json:"text"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if len([]rune(req.Text)) > 100 {
		writeError(w, http.StatusBadRequest, "bad_text", "100 字以内")
		return
	}
	writeJSON(w, http.StatusOK, intent.Explain(req.Text))
}

func (s *Server) isFavorite(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	t, _ := s.Library.Track(id)
	writeJSON(w, http.StatusOK, map[string]any{"favorite": t.Favorite})
}

func (s *Server) favorite(w http.ResponseWriter, r *http.Request) {
	var req struct {
		On bool `json:"on"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	t, err := s.Library.SetFavorite(r.Context(), id, req.On)
	if errors.Is(err, library.ErrNotRemote) {
		writeError(w, http.StatusNotFound, "not_remote", err.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, "feiniu", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"favorite": t.Favorite})
}

func (s *Server) sourceUpdate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	ok, err := s.Router.SetSource(r.Context(), s.Store, r.PathValue("name"), req.Enabled)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "no_source", "没有这个音源")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sources": s.Router.Online.Health()})
}

// sourceOrder puts the platforms in the order they are asked in. The library is always asked
// before any of them, so this only orders the online sources among themselves.
func (s *Server) sourceOrder(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Order []string `json:"order"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if err := s.Router.SetSourceOrder(r.Context(), s.Store, req.Order); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sources": s.Router.Online.Health()})
}
