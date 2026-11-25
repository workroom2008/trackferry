package online

import "testing"

// The song a person names need not be the song a platform lists word for word: 黄凯芹's is
// 「雨中的恋人们」, and asking for 「雨中的恋人」 must find it. The singer named decides it too.
func TestChooseFindsAOneCharacterLongerTitle(t *testing.T) {
	cands := []Candidate{
		{Source: "lx", Title: "雨中的恋人 (Cover 黃凱芹)", Artist: "邱邱"},
		{Source: "lx", Title: "雨中的恋人们", Artist: "黄凯芹"},
		{Source: "lx", Title: "雨中的恋人（翻自 黄凯芹）", Artist: "薄荷绿豆糖"},
		{Source: "lx", Title: "雨中的恋人们 (Live)", Artist: "黄凯芹"},
	}
	readings := []Reading{{Title: "雨中的恋人", Artist: "黄凯芹"}}
	got := choose(cands, readings, "播放黄凯芹的雨中的恋人")
	if len(got) == 0 {
		t.Fatal("nothing chosen, though the singer's own song is there")
	}
	if got[0].c.Artist != "黄凯芹" {
		t.Fatalf("chose %q by %q", got[0].c.Title, got[0].c.Artist)
	}
	if got[0].c.Title != "雨中的恋人们" {
		t.Fatalf("chose %q, want the plain one over a version", got[0].c.Title)
	}
}

// A title that only shares a few characters is not the song.
func TestChooseRefusesADifferentTitle(t *testing.T) {
	cands := []Candidate{
		{Source: "lx", Title: "雨中的城市", Artist: "黄凯芹"},
		{Source: "lx", Title: "恋人未满", Artist: "黄凯芹"},
	}
	readings := []Reading{{Title: "雨中的恋人", Artist: "黄凯芹"}}
	if got := choose(cands, readings, "播放黄凯芹的雨中的恋人"); len(got) != 0 {
		t.Fatalf("chose %+v", got)
	}
}

// The singer still has to be the one asked for: another singer's song of the same name is not
// the answer when a singer was named.
func TestChooseKeepsTheSinger(t *testing.T) {
	cands := []Candidate{
		{Source: "lx", Title: "雨中的恋人们", Artist: "某个翻唱"},
	}
	readings := []Reading{{Title: "雨中的恋人", Artist: "黄凯芹"}}
	if got := choose(cands, readings, "播放黄凯芹的雨中的恋人"); len(got) != 0 {
		t.Fatalf("chose another singer's song: %+v", got)
	}
}

// With no singer named, a title one character off is still the song.
func TestChooseFindsWithoutASinger(t *testing.T) {
	cands := []Candidate{
		{Source: "lx", Title: "雨中的恋人们", Artist: "黄凯芹"},
	}
	readings := []Reading{{Title: "雨中的恋人"}}
	if got := choose(cands, readings, "播放雨中的恋人"); len(got) == 0 {
		t.Fatal("nothing chosen")
	}
}
