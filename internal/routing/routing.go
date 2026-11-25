// Package routing decides who plays a request: the local library, an online platform, or
// Xiao AI. Every layer's answer is kept, so a decision can be explained afterwards.
package routing

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"time"

	"trackferry/internal/intent"
	"trackferry/internal/library"
	"trackferry/internal/live"
	"trackferry/internal/names"
	"trackferry/internal/online"
	"trackferry/internal/store"
)

// Decisions.
const (
	Local  = "local"
	Online = "online"
	Native = "native"
)

// Candidate is one song a layer considered.
type Candidate struct {
	Title      string `json:"title"`
	Artist     string `json:"artist"`
	Detail     string `json:"detail,omitempty"`
	DurationMS int64  `json:"duration_ms,omitempty"`
	Cover      string `json:"cover,omitempty"`
}

// Layer is one stop on the way.
type Layer struct {
	Name       string      `json:"name"` // library | kuwo | kugou | migu | netease | xiaomi
	State      string      `json:"state"`
	Opinion    bool        `json:"opinion,omitempty"` // only asked who sang it first, not for audio
	MS         int64       `json:"ms"`
	Detail     string      `json:"detail,omitempty"`
	Candidates []Candidate `json:"candidates"`
}

// Route is a decision.
type Route struct {
	Preview    bool     `json:"preview"` // watch-only: nothing was played
	Decision   string   `json:"decision"`
	Reason     string   `json:"reason,omitempty"` // why Xiao AI keeps it
	Source     string   `json:"source,omitempty"` // library | kuwo | kugou | migu | netease
	Title      string   `json:"title,omitempty"`
	Artist     string   `json:"artist,omitempty"`
	Path       string   `json:"path,omitempty"`
	TrackID    int64    `json:"track_id,omitempty"`
	Cover      string   `json:"cover,omitempty"`
	Album      string   `json:"album,omitempty"`
	// Platform and PlatformName say which platform an online song came from, for the page.
	Platform     string `json:"platform,omitempty"`
	PlatformName string `json:"platform_name,omitempty"`
	DurationMS int64    `json:"duration_ms,omitempty"`
	List       string   `json:"list,omitempty"`   // the list that plays on after it
	Others     []string `json:"others,omitempty"` // other singers of the same title in the library
	Basis      []Fact   `json:"basis,omitempty"`
	Layers     []Layer  `json:"layers"`
	MS         int64    `json:"ms"`

	match *library.Match
	found *online.Found
	asked string
	queue []int64
	order []int64
}

// Match is the local file chosen, if any.
func (r *Route) Match() *library.Match { return r.match }

// Found is the online song chosen, if any.
func (r *Route) Found() *online.Found { return r.found }

// Asked names the request the online song answers; the cache remembers it.
func (r *Route) Asked() string { return r.asked }

// askedKey is the same for requests that mean the same song.
func askedKey(in intent.Intent, query string) string {
	return names.Norm(in.Title) + "|" + names.Norm(in.Artist) + "|" + strings.Join(names.Versions(query), ",")
}

// Router is safe for concurrent use.
type Router struct {
	Library *library.Library
	Online  *online.Service // nil: no online layer
	// Cached returns the song kept from the last time this was asked; optional.
	Cached func(asked string) *online.Found
	// Lists reads the lists of 飞牛音乐; optional.
	Lists Lists
	// ArtistQueue reports whether an artist's other songs follow the first; nil: no.
	ArtistQueue func() bool
	Log         *slog.Logger
	// Openable reports whether a local file can be read right now (nil: assume so).
	Openable func(rel string) bool
}

// Preference keys.
const settingPrefix = "source."
const settingOrder = "source.order"

// LoadSettings applies a stored order and the stored source switches.
func (r *Router) LoadSettings(ctx context.Context, st *store.Store) {
	// The order first: it decides which platform is tried before the others.
	if v, err := st.Setting(ctx, settingOrder); err == nil && v != "" {
		var names []string
		for _, n := range strings.Split(v, ",") {
			if n = strings.TrimSpace(n); n != "" {
				names = append(names, n)
			}
		}
		r.Online.SetOrder(names)
	}
	for _, h := range r.health() {
		if v, err := st.Setting(ctx, settingPrefix+h.Source); err == nil && v != "" {
			r.Online.SetEnabled(h.Source, v == "on")
		}
	}
}

// SetSourceOrder stores the order the platforms are asked in and applies it at once.
func (r *Router) SetSourceOrder(ctx context.Context, st *store.Store, names []string) error {
	if r.Online == nil {
		return nil
	}
	r.Online.SetOrder(names)
	return st.SetSetting(ctx, settingOrder, strings.Join(names, ","))
}


// SetSource switches an online source and remembers it.
func (r *Router) SetSource(ctx context.Context, st *store.Store, name string, on bool) (bool, error) {
	if r.Online == nil || !r.Online.SetEnabled(name, on) {
		return false, nil
	}
	v := "off"
	if on {
		v = "on"
	}
	return true, st.SetSetting(ctx, settingPrefix+name, v)
}

func (r *Router) health() []online.Health {
	if r.Online == nil {
		return nil
	}
	return r.Online.Health()
}

func Readings(in intent.Intent) []online.Reading {
	out := []online.Reading{{Title: in.Title, Artist: in.Artist}}
	if in.Artist != "" {
		// "我的天空" was split at 的; the whole phrase may be the title.
		return append(out, online.Reading{Title: in.Artist + "的" + in.Title})
	}
	if f := strings.Fields(in.Title); len(f) > 1 {
		a, b := strings.Join(f[:len(f)-1], " "), f[len(f)-1]
		out = []online.Reading{{Title: b, Artist: a}, {Title: a, Artist: b}, {Title: in.Title}}
		if len(f) > 2 {
			out = append(out[:2], online.Reading{Title: strings.Join(f[1:], " "), Artist: f[0]}, online.Reading{Title: in.Title})
		}
	}
	// No space to split on, and the whole phrase reads as a title: "岛岛的风的轮廓" is 岛岛's
	// 风的轮廓. Every 的 is tried, the longest singer name first, and the plain title last.
	if len(out) == 1 {
		rs := []rune(in.Title)
		var readings []online.Reading
		for i := 1; i < len(rs)-1; i++ {
			if rs[i] != '的' {
				continue
			}
			artist, title := string(rs[:i]), string(rs[i+1:])
			if len([]rune(artist)) < 1 || len([]rune(title)) < 1 {
				continue
			}
			readings = append(readings, online.Reading{Title: title, Artist: artist})
		}
		slices.Reverse(readings) // longest singer name first
		out = append(readings, out...)
	}
	return out
}


// Decide routes a recognised command.
func (r *Router) Decide(ctx context.Context, in intent.Intent, query string) *Route {
	start := time.Now()
	tr := live.From(ctx)
	rt := &Route{Decision: Native, Layers: []Layer{}}
	version := in.Kind == intent.KindVersion // "another version" must not find the same one
	rt.Because("听成", "%s", Heard(query, in))
	defer func() {
		final := Layer{Name: "xiaomi", State: online.StateSkipped, Candidates: []Candidate{}}
		if rt.Decision == Native {
			final.State = online.StateHit
		}
		rt.Layers = append(rt.Layers, final)
		rt.MS = time.Since(start).Milliseconds()
		tr.Route(*rt)
	}()
	switch in.Kind {
	case intent.KindControl:
		rt.Reason = "播放控制由小爱处理"
		return rt
	case intent.KindArtist, intent.KindRandom:
		// "范特西的专辑" may be an album by its name.
		if in.Kind == intent.KindArtist && strings.Contains(query, "专辑") && len(r.Library.ArtistIDs(in.Artist)) == 0 {
			if as := r.Library.FindAlbums(in.Artist, ""); len(as) > 0 {
				r.album(rt, intent.Intent{Kind: intent.KindList, Control: intent.ListAlbum, Title: in.Artist}, 0)
				tr.Layer("library", rt.Layers[0])
				return rt
			}
		}
		r.pick(rt, in)
		tr.Layer("library", rt.Layers[0])
		return rt
	case intent.KindList:
		if in.Control == intent.ListAlbum {
			prev, _ := ctx.Value(prevKey{}).(Previous)
			r.album(rt, in, prev.Track)
			tr.Layer("library", rt.Layers[0])
			return rt
		}
		tr.Layer("library", Layer{Name: "library", State: online.StateAsking, Candidates: []Candidate{}})
		r.list(ctx, rt, in)
		tr.Layer("library", rt.Layers[0])
		return rt
	case intent.KindVersion:
		var ok bool
		prev, _ := ctx.Value(prevKey{}).(Previous)
		if prev.Title != "" {
			rt.Because("上一首", "%s", strings.TrimSpace(prev.Title+" "+prev.Artist))
		}
		if in, ok = r.version(ctx, in, query); !ok {
			rt.Reason = "没有别的版本"
			return rt
		}
		rt.Because("改成找", "%s", strings.TrimSpace(strings.Join([]string{in.Artist, in.Title}, " ")))
		if in.Kind == intent.KindArtist {
			r.pick(rt, in)
			tr.Layer("library", rt.Layers[0])
			return rt
		}
	case intent.KindSong:
	default:
		rt.Reason = "不是点歌"
		return rt
	}
	tr.Layer("library", Layer{Name: "library", State: online.StateAsking, Candidates: []Candidate{}})
	hit, rivals := r.local(rt, in, query)
	tr.Layer("library", rt.Layers[0])
	if hit {
		return rt
	}
	if len(rivals) > 0 && (r.Online == nil || r.sure(rivals)) {
		r.settle(rt, rivals, nil)
		return rt
	}
	if r.Online == nil {
		if version || !r.near(rt, in, query) {
			rt.Reason = "曲库没有这首歌"
		}
		return rt
	}
	if !version {
		rt.asked = askedKey(in, query)
	}
	if rt.asked != "" && len(rivals) == 0 && r.Cached != nil {
		if f := r.Cached(rt.asked); f != nil && r.Online.Enabled(f.Candidate.Source) {
			rt.takeOnline(f)
			l := Layer{Name: rt.Source, State: online.StateHit, Detail: "以前放过，缓存里有", Candidates: []Candidate{}}
			rt.Layers = append(rt.Layers, l)
			tr.Layer(rt.Source, l)
			rt.Because("选它", "以前放过，缓存里有，不用再去找")
			return rt
		}
	}
	if len(rivals) > 0 {
		// The platforms are only asked for an opinion, so they get less time.
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 2500*time.Millisecond)
		defer cancel()
	}
	if tr != nil {
		ctx = online.WithProgress(ctx, func(o online.Outcome) { tr.Layer(o.Source, opinion(layer(o), rivals)) })
	}
	found, outs := r.Online.Find(ctx, Readings(in), query)
	restricted, exact := false, false
	for _, o := range outs {
		restricted = restricted || o.State == online.StateRestricted
		exact = exact || o.State == online.StateRestricted && !o.Near
		rt.Layers = append(rt.Layers, opinion(layer(o), rivals))
	}
	if len(rivals) > 0 {
		if found != nil && found.Near {
			found = nil
		}
		r.settle(rt, rivals, found)
		return rt
	}
	// Nothing is as it was said: the library may have what was meant.
	if (found == nil || found.Near) && !exact && !version && r.near(rt, in, query) {
		tr.Layer("library", rt.Layers[0])
		return rt
	}
	if found != nil && found.Near {
		rt.asked = "" // a guess is not kept as the answer
	}
	if found == nil {
		rt.Reason = reason(outs, restricted)
		return rt
	}
	rt.takeOnline(found)
	rt.online(outs)
	return rt
}


func (rt *Route) takeOnline(f *online.Found) {
	c := f.Candidate
	rt.Decision, rt.Source, rt.Title, rt.Artist, rt.found = Online, c.Source, c.Title, c.Artist, f
	// The online source keeps the picture and the words: the page fetches them by this id.
	if online.IsOnlineID(c.ID) {
		rt.Cover = c.ID
	}
	rt.Platform, rt.PlatformName = online.PlatformOf(c.ID), online.LxName(online.PlatformOf(c.ID))
	rt.DurationMS = f.Stream.Duration.Milliseconds()
	if f.Unprobed {
		rt.DurationMS = c.DurationMS // the listing's, as nothing was read to check it
	}
}
func layer(o online.Outcome) Layer {

	l := Layer{Name: o.Source, State: o.State, MS: o.MS, Detail: o.Detail, Candidates: []Candidate{}}
	for _, c := range o.Candidates {
		d := c.Why
		if d == "" && c.Restricted {
			d = "要会员"
		}
		l.Candidates = append(l.Candidates, Candidate{Title: c.Title, Artist: c.Artist, Detail: d, DurationMS: c.DurationMS, Cover: onlineCover(c.ID)})
	}
	return l
}

// opinion turns a platform's answer into who it thinks sang the song first. Whether it would
// let us play it does not matter.
func opinion(l Layer, rivals []library.Match) Layer {
	if len(rivals) == 0 {
		return l
	}
	l.Opinion, l.Detail = true, ""
	if l.State == online.StateAsking || l.State == online.StateDisabled || l.State == online.StateOpen {
		return l
	}
	if who := l.vote(rivals); who != "" {
		l.State, l.Detail = online.StateHit, "原唱是"+who
	} else if l.State != online.StateError && l.State != online.StateTimeout {
		l.State, l.Detail = online.StateMiss, "说不准原唱"
	}
	return l
}

func (l Layer) vote(rivals []library.Match) string {
	for _, c := range l.Candidates {
		for _, m := range rivals {
			if names.Norm(c.Title) == names.Norm(m.Title) && names.SameArtist(m.Artist, c.Artist) {
				return m.Artist
			}
		}
	}
	return ""
}

// sure reports that the library alone settles it: a favourite, or a singer it has far more of.
func (r *Router) sure(rivals []library.Match) bool {
	count := map[string]int{}
	for _, m := range rivals {
		if m.Favorite {
			return true
		}
		count[m.Artist] = r.Library.Count(m.Artist)
	}
	best, next := 0, 0
	for _, n := range count {
		if n > best {
			best, next = n, best
		} else if n > next {
			next = n
		}
	}
	return best >= 6 && best >= next*4
}

// settle picks one of several same-named songs in the library: the singer the platforms agree
// on, else the favourite, else the singer the library has most of. A song that is there is
// always played; the others stay listed so another can be asked for by its singer.
func (r *Router) settle(rt *Route, rivals []library.Match, found *online.Found) {
	play := func(m library.Match, why string) bool {
		if !r.openable(m) {
			return false
		}
		l := &rt.Layers[0]
		l.State, l.Detail = online.StateHit, why
		rt.Reason = ""
		rt.Because("选它", "%s", why)
		rt.take(m)
		for _, o := range rivals {
			if !names.ArtistMatch(o.Artist, m.Artist) && !slices.Contains(rt.Others, o.Artist) && len(rt.Others) < 4 {
				rt.Others = append(rt.Others, o.Artist)
			}
		}
		return true
	}
	for _, l := range rt.Layers {
		if !l.Opinion {
			continue
		}
		if who := l.vote(rivals); who != "" {
			for _, m := range rivals {
				if m.Artist == who && play(m, "同名歌曲，原唱是"+who) {
					return
				}
			}
		}
	}
	if found != nil {
		for _, m := range rivals {
			if names.SameArtist(m.Artist, found.Candidate.Artist) && play(m, "同名歌曲，线上公认是"+m.Artist) {
				return
			}
		}
	}
	order := slices.Clone(rivals)
	// Versions and formats first decide, then how much of the singer is in the library.
	slices.SortStableFunc(order, func(a, b library.Match) int {
		if a.Favorite != b.Favorite {
			if a.Favorite {
				return -1
			}
			return 1
		}
		if x, y := a.Score/10, b.Score/10; x != y {
			return x - y
		}
		return r.Library.Count(b.Artist) - r.Library.Count(a.Artist)
	})
	for i, m := range order[:min(4, len(order))] {
		why := "没有更多依据"
		if i == 0 && len(order) > 1 {
			o := order[1]
			switch {
			case m.Favorite && !o.Favorite:
				why = "你收藏了它"
			case m.Score/10 != o.Score/10:
				why = "歌名或版本更贴近你说的"
			default:
				if n, k := r.Library.Count(m.Artist), r.Library.Count(o.Artist); n > k {
					why = fmt.Sprintf("曲库里 %d 首，比%s的 %d 首多", n, o.Artist, k)
				}
			}
		}
		if play(m, "几位歌手都唱过，先放"+m.Artist+"的："+why) {
			return
		}
	}
	rt.Layers[0].State, rt.Layers[0].Detail = online.StateError, "文件暂时读不到"
	rt.Reason = "曲库里的文件暂时读不到"
}

func reason(outs []online.Outcome, restricted bool) string {
	n := map[string]int{}
	for _, o := range outs {
		n[o.State]++
	}
	switch {
	case restricted:
		return "曲库没有，线上只有会员或试听版本"
	case n[online.StateDisabled] == len(outs):
		return "曲库没有，线上音源都关着"
	case n[online.StateMiss] == len(outs):
		return "曲库和线上都没有这首歌"
	case n[online.StateMiss] > 0:
		return "曲库没有，线上没找到（有音源没答上来）"
	}
	return "曲库没有，线上音源都没答上来"
}

func (r *Router) local(rt *Route, in intent.Intent, query string) (bool, []library.Match) {
	start := time.Now()
	l := Layer{Name: "library", State: online.StateMiss, Candidates: []Candidate{}}
	defer func() { l.MS = time.Since(start).Milliseconds(); rt.Layers = append([]Layer{l}, rt.Layers...) }()
	if r.Library.Size() == 0 {
		l.State, l.Detail = online.StateError, "曲库还没有索引到歌"
		return false, nil
	}
	res, ok := library.Result{}, false
	for _, rd := range Readings(in) {
		if res = r.Library.Song(rd.Title, rd.Artist, query); len(res.Matches) > 0 {
			ok = true
			break
		}
	}
	if !ok {
		if in.Artist == "" {
			res, _, _ = r.Library.Split(in.Title, query)
		}
		if len(res.Matches) == 0 {
			// Same title by someone else explains the miss.
			if in.Artist != "" {
				if other := r.Library.Song(in.Title, "", query); len(other.Matches) > 0 {
					l.Detail = fmt.Sprintf("有《%s》，但不是%s唱的", in.Title, in.Artist)
					l.Candidates = show(other.Matches)
				}
			}
			if l.Detail == "" {
				l.Detail = fmt.Sprintf("%d 首里没有歌名叫《%s》的", r.Library.Size(), in.Title)
			}
			return false, nil
		}
	}
	l.Candidates = show(res.Matches)
	if res.Ambiguous {
		l.State = online.StateAmbiguous
		l.Detail = "同名歌曲：" + strings.Join(res.Artists[:min(4, len(res.Artists))], "、")
		return false, res.Matches
	}
	for _, m := range res.Matches[:min(3, len(res.Matches))] {
		if !r.openable(m) {
			l.Detail = "文件暂时读不到"
			continue
		}
		l.State, l.Detail = online.StateHit, ""
		rt.Because("选它", "%s", chose(m, res.Matches, query))
		rt.take(m)
		return true, nil
	}
	l.State = online.StateError
	return false, nil
}

// near plays the song of the library that was meant, if a character of it was misheard.
func (r *Router) near(rt *Route, in intent.Intent, query string) bool {
	start := time.Now()
	for _, rd := range Readings(in) {
		res := r.Library.Near(rd.Title, rd.Artist, query)
		if len(res.Matches) == 0 {
			continue
		}
		was, basis := rt.Layers[0], len(rt.Basis)
		rt.Layers[0].Candidates = show(res.Matches)
		if res.Ambiguous {
			for i := range rt.Layers {
				rt.Layers[i].Opinion = false
			}
		}
		r.settle(rt, res.Matches, nil)
		if rt.Decision != Local {
			rt.Layers[0], rt.Basis, rt.Reason = was, rt.Basis[:basis], ""
			continue
		}
		why := "按听错一个字，放" + strings.TrimSpace(rt.Artist+"的《"+rt.Title+"》")
		rt.Layers[0].MS += time.Since(start).Milliseconds()
		rt.Layers[0].Detail = why
		rt.Basis = append(rt.Basis[:basis], Fact{"选它", why})
		rt.asked = ""
		return true
	}
	return false
}

func (r *Router) openable(m library.Match) bool {
	return r.Openable == nil || r.Openable(m.Path)
}

func (rt *Route) take(m library.Match) {
	rt.Decision, rt.Source, rt.Title, rt.Artist, rt.Path, rt.DurationMS, rt.match = Local, "library", m.Title, m.Artist, m.Path, m.DurationMS, &m
	rt.TrackID, rt.Cover, rt.Album = m.ID, m.Cover, m.Album
}

func (r *Router) pick(rt *Route, in intent.Intent) {
	start := time.Now()
	l := Layer{Name: "library", State: online.StateMiss, Candidates: []Candidate{}}
	if in.Kind == intent.KindArtist && len(r.Library.ArtistIDs(in.Artist)) == 0 {
		if a := r.Library.NearArtist(in.Artist); a != "" {
			rt.Because("改成找", "曲库里没有%s，按听错一个字找%s", in.Artist, a)
			in.Artist = a
		}
	}
	for range 5 {
		var m library.Match
		n := 0
		if in.Kind == intent.KindArtist {
			m, n = r.Library.Artist(in.Artist)
		} else {
			m, n = r.Library.Random()
		}
		if n == 0 {
			break
		}
		if !r.openable(m) {
			l.State, l.Detail = online.StateError, "文件暂时读不到"
			continue
		}
		l.State, l.Detail = online.StateHit, fmt.Sprintf("从 %d 首里随机", n)
		l.Candidates = show([]library.Match{m})
		rt.Because("选它", "从 %d 首里随机抽到", n)
		rt.take(m)
		if in.Kind == intent.KindArtist && r.ArtistQueue != nil && r.ArtistQueue() {
			if ids := r.Library.ArtistIDs(in.Artist); len(ids) > 1 {
				rt.List, rt.queue, rt.order = in.Artist+"的歌", shuffled(ids, m.ID), ids
				l.Detail = fmt.Sprintf("%s的 %d 首歌，连着放", in.Artist, len(ids))
				rt.Basis[len(rt.Basis)-1].Text = l.Detail
			}
		}
		break
	}
	if l.State != online.StateHit {
		rt.Reason = "曲库里没有可以随机的歌"
		if in.Kind == intent.KindArtist {
			rt.Reason = "曲库里没有" + in.Artist + "的歌"
		}
	}
	l.MS = time.Since(start).Milliseconds()
	rt.Layers = append(rt.Layers, l)
}

func show(ms []library.Match) []Candidate {
	out := []Candidate{}
	for _, m := range ms[:min(6, len(ms))] {
		c := Candidate{Title: m.Title, Artist: m.Artist, Detail: m.Path, DurationMS: m.DurationMS, Cover: m.Cover}
		if m.GUID != "" {
			c.Detail = m.Album
		}
		out = append(out, c)
	}
	return out
}

// JSON encodes the route for storage.
func (r *Route) JSON() []byte {
	b, _ := json.Marshal(r)
	return b
}

// Label names the song for people.
func (r *Route) Label() string {
	s := r.Title
	if r.Artist != "" {
		s = r.Artist + " - " + s
	}
	return s
}

// ForTest is an online route for other packages' tests.
func ForTest(title, artist string) *Route {
	return &Route{Decision: Online, Source: "kuwo", Title: title, Artist: artist, Layers: []Layer{}, found: &online.Found{}}
}

// onlineCover is the picture id of an online song: only a source with its own ids has one.
func onlineCover(id string) string {
	if online.IsOnlineID(id) {
		return id
	}
	return ""
}
