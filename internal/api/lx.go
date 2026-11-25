package api

import (
	"context"
	"io"
	"net/http"
	"strings"
	"time"

	"trackferry/internal/config"
	"trackferry/internal/online"
)

// lxSetting is what the page shows: the address and the account, never the password.
type lxSetting struct {
	URL     string `json:"url"`
	User    string `json:"user"`
	HasPass bool   `json:"has_password"`
	Ready   bool   `json:"ready"`
}

func (s *Server) lxShow() lxSetting {
	l := s.Config.Lx
	// The server part is what the page asks for; /rest is added on the way out.
	u := strings.TrimRight(l.URL, "/")
	u = strings.TrimSuffix(u, "/rest")
	return lxSetting{URL: u, User: l.User, HasPass: l.Password != "", Ready: l.Ready()}
}

// lxStatus reports the 洛雪 server in use.
func (s *Server) lxStatus(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"lx": s.lxShow()})
}

// lxSave stores a 洛雪 server, tries it once, and keeps it only if it answers. The source is
// swapped in place, so it is asked after the library without a restart. An empty address
// removes it.
func (s *Server) lxSave(w http.ResponseWriter, r *http.Request) {
	var in struct {
		URL      string `json:"url"`
		User     string `json:"user"`
		Password string `json:"password"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	ctx := r.Context()
	next := config.LxConfig{URL: strings.TrimSpace(in.URL), User: strings.TrimSpace(in.User), Password: s.Config.Lx.Password}
	if in.Password != "" {
		next.Password = in.Password
	}
	// The page may be given the plain address; the Subsonic endpoint is what is asked.
	if next.URL != "" && !strings.HasSuffix(strings.TrimRight(next.URL, "/"), "/rest") {
		next.URL = strings.TrimRight(next.URL, "/") + "/rest"
	}
	if !next.Ready() {
		if s.LxFile != "" {
			if err := online.RemoveLx(s.LxFile); err != nil {
				writeError(w, http.StatusInternalServerError, "internal", err.Error())
				return
			}
		}
		s.Router.Online.SetLx(nil)
		s.Config.Lx = config.LxConfig{}
		writeJSON(w, http.StatusOK, map[string]any{"lx": s.lxShow(), "sources": s.Router.Online.Health()})
		return
	}
	lx := &online.Lx{BaseURL: next.URL, User: next.User, Password: next.Password,
		Client: online.ClientForServer(next.URL)}
	tctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if err := lx.Check(tctx); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lx_refused", "message": err.Error()})
		return
	}
	if s.LxFile != "" {
		if err := online.SaveLx(s.LxFile, online.LxFile{URL: next.URL, User: next.User, Password: next.Password}); err != nil {
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
	}
	s.Router.Online.SetLx(lx)
	s.Config.Lx = next
	s.Log.Info("洛雪　已连接", "地址", next.URL, "账号", next.User)
	writeJSON(w, http.StatusOK, map[string]any{"lx": s.lxShow(), "sources": s.Router.Online.Health()})
}

// lx is the 洛雪 server, or nil when none is set up.
func (s *Server) lx() *online.Lx {
	if s.Router == nil || s.Router.Online == nil {
		return nil
	}
	return s.Router.Online.Lx()
}

// lxCover serves the picture of an online song from the 洛雪 server.
func (s *Server) lxCover(w http.ResponseWriter, r *http.Request, id, size string) {
	l := s.lx()
	if l == nil {
		writeError(w, http.StatusNotFound, "no_cover", "没有这张封面")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	resp, err := l.Cover(ctx, id, size)
	if err != nil {
		writeError(w, http.StatusNotFound, "no_cover", "没有这张封面")
		return
	}
	defer resp.Body.Close()
	ctype := resp.Header.Get("Content-Type")
	switch ctype {
	case "image/jpeg", "image/png", "image/webp", "image/gif":
	default:
		writeError(w, http.StatusNotFound, "no_cover", "没有这张封面")
		return
	}
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Cache-Control", "private, max-age=2592000, immutable")
	io.Copy(w, io.LimitReader(resp.Body, 8<<20))
}

// lxLyrics serves the words of an online song, in the shape a library song's come in.
func (s *Server) lxLyrics(w http.ResponseWriter, r *http.Request) {
	l := s.lx()
	if l == nil {
		writeError(w, http.StatusNotFound, "no_lx", "还没有设置洛雪")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	text, err := l.Lyrics(ctx, r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadGateway, "no_lyrics", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"lyrics": text})
}
