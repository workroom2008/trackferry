package api

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"trackferry/internal/feiniu"
	"trackferry/internal/online"
)

func (s *Server) feiniuStatus(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"feiniu": s.Feiniu.Status(), "suggested": s.suggestedFeiniu()})
}

// suggestedFeiniu guesses the NAS address: TrackFerry runs on it.
func (s *Server) suggestedFeiniu() string {
	if s.Config.PublicBaseURL == "" {
		return ""
	}
	b, err := feiniu.Base(strings.Replace(s.Config.PublicBaseURL, "http://", "https://", 1))
	if err != nil {
		return ""
	}
	if i := strings.LastIndexByte(b, ':'); i > len("https:") {
		b = b[:i]
	}
	return b + ":5667"
}

// feiniuDiscover looks for 飞牛音乐 around this machine.
func (s *Server) feiniuDiscover(w http.ResponseWriter, r *http.Request) {
	var hosts []string
	if u, err := url.Parse(s.Config.PublicBaseURL); err == nil && u.Hostname() != "" {
		hosts = append(hosts, u.Hostname())
	}
	writeJSON(w, http.StatusOK, feiniu.Discover(r.Context(), hosts))
}

func (s *Server) feiniuLogin(w http.ResponseWriter, r *http.Request) {
	key := "feiniu:" + clientKey(r)
	if ok, wait := s.fnLimiter.Allow(key, time.Now()); !ok {
		w.Header().Set("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
		writeError(w, http.StatusTooManyRequests, "throttled", "失败次数太多，请 15 分钟后再试")
		return
	}
	var in struct {
		Base     string `json:"base"`
		User     string `json:"user"`
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	err := s.Feiniu.Login(ctx, in.Base, in.User, in.Password, in.Code)
	in.Password, in.Code = "", ""
	var ae *feiniu.APIError
	switch {
	case err == nil:
	case errors.As(err, &ae):
		s.fnLimiter.Fail(key, time.Now())
		msg := "飞牛音乐没有接受这个用户名和密码。要填的是飞牛音乐里的用户；只用飞牛授权登录过的账号，先在飞牛音乐里设一个密码"
		if ae.Code == 120002 {
			msg = "这个飞牛音乐用户被停用了"
		}
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "feiniu_refused", "message": msg, "detail": err.Error()})
		return
	case errors.Is(err, feiniu.ErrGate):
		writeError(w, http.StatusBadGateway, "feiniu_gate", "这台飞牛要先过访问码。填上访问码再连；没有开访问码的话，看看地址是不是飞牛的")
		return
	case errors.Is(err, feiniu.ErrGateCode):
		s.fnLimiter.Fail(key, time.Now())
		writeError(w, http.StatusBadGateway, "feiniu_gate", "飞牛没有接受这个访问码")
		return
	default:
		writeError(w, http.StatusBadGateway, "feiniu_unreachable", err.Error())
		return
	}
	s.fnLimiter.Reset(key)
	s.Log.Info("飞牛音乐　已连接")
	s.Library.Restart()
	s.feiniuStatus(w, r)
}

func (s *Server) feiniuLogout(w http.ResponseWriter, r *http.Request) {
	if err := s.Feiniu.Logout(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	s.Library.Restart()
	s.feiniuStatus(w, r)
}

// cover passes a cover through. Cover IDs name fixed images, so browsers may keep them.
func (s *Server) cover(w http.ResponseWriter, r *http.Request) {
	size := r.URL.Query().Get("size")
	if size != "160" && size != "600" && size != "1024" {
		size = "600"
	}
	// A cover id like "kw_12" belongs to an online song, which only 洛雪 has a picture for.
	if online.IsOnlineID(r.PathValue("id")) {
		s.lxCover(w, r, r.PathValue("id"), size)
		return
	}
	resp, err := s.Feiniu.Cover(r.Context(), r.PathValue("id"), size)
	if err != nil {
		writeError(w, http.StatusNotFound, "no_cover", "没有这张封面")
		return
	}
	defer resp.Body.Close()
	ctype := resp.Header.Get("Content-Type")
	switch ctype {
	case "image/jpeg", "image/png", "image/webp", "image/avif", "image/gif":
	default:
		writeError(w, http.StatusNotFound, "no_cover", "没有这张封面")
		return
	}
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Cache-Control", "private, max-age=2592000, immutable")
	io.Copy(w, io.LimitReader(resp.Body, 8<<20))
}

func (s *Server) libraryShelf(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.Library.Shelf())
}

func (s *Server) libraryAlbum(w http.ResponseWriter, r *http.Request) {
	a, ts := s.Library.AlbumTracks(r.PathValue("id"))
	if a.ID == "" {
		writeError(w, http.StatusNotFound, "no_album", "曲库里没有这张专辑")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"album": a, "tracks": ts})
}

func (s *Server) libraryArtist(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"tracks": s.Library.ArtistTracks(r.URL.Query().Get("name"), 200)})
}

func (s *Server) libraryLyrics(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	t, ok := s.Library.Track(id)
	if !ok {
		writeError(w, http.StatusNotFound, "no_track", "曲库里没有这首歌了")
		return
	}
	text := ""
	if t.GUID != "" && s.Feiniu != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
		defer cancel()
		var err error
		if text, err = s.Feiniu.Lyrics(ctx, t.GUID); err != nil {
			writeError(w, http.StatusBadGateway, "no_lyrics", err.Error())
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"track": t, "lyrics": text, "offset_ms": s.offset(r, id)})
}

const settingOffset = "lyrics.offset."

// maxOffset bounds how far lyrics can be moved, in ms.
const maxOffset = 60_000

// offset is how much sooner than they say the lines of a song's lyrics come, in ms.
func (s *Server) offset(r *http.Request, id int64) int {
	v, _ := s.Store.Setting(r.Context(), settingOffset+strconv.FormatInt(id, 10))
	n, _ := strconv.Atoi(v)
	return n
}

func (s *Server) lyricsOffset(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OffsetMS int `json:"offset_ms"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if _, ok := s.Library.Track(id); !ok {
		writeError(w, http.StatusNotFound, "no_track", "曲库里没有这首歌了")
		return
	}
	if req.OffsetMS < -maxOffset || req.OffsetMS > maxOffset {
		writeError(w, http.StatusBadRequest, "bad_offset", "歌词最多提前或延后 60 秒")
		return
	}
	if err := s.Store.SetSetting(r.Context(), settingOffset+strconv.FormatInt(id, 10), strconv.Itoa(req.OffsetMS)); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"offset_ms": req.OffsetMS})
}
