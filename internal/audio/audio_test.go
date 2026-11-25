package audio

import (
	"encoding/binary"
	"testing"
)

func TestMP3Duration(t *testing.T) {
	frame := make([]byte, 417)
	copy(frame, []byte{0xff, 0xfb, 0x90, 0x00})
	b := append(append([]byte{}, frame...), frame...)
	if d := MP3Duration(b, 160_000); d.Seconds() != 10 {
		t.Fatal(d)
	}
	if MP3Duration([]byte("<html>not audio</html>"), 1000) != 0 {
		t.Fatal("html accepted")
	}
	if n := ID3Size([]byte{'I', 'D', '3', 3, 0, 0, 0, 0, 1, 1}); n != 10+129 {
		t.Fatal(n)
	}
}

// A FLAC header: STREAMINFO with 44100 Hz, 2 channels, 16 bits and 269 s of samples.
func TestFLACDuration(t *testing.T) {
	const rate, secs = 44100, 269
	b := make([]byte, 64)
	copy(b, "fLaC")
	b[4], b[7] = 0x00, 0x22 // STREAMINFO, 34 bytes long
	b[8], b[9] = 0x10, 0x00 // min block size
	b[10], b[11] = 0x10, 0x00
	// The 64 bits after the sizes: rate, channels, depth, sample count.
	binary.BigEndian.PutUint64(b[18:], uint64(rate)<<44|1<<41|15<<36|uint64(secs*rate))
	if d := Duration(b, 33<<20); d.Seconds() != secs {
		t.Fatalf("FLAC duration = %v, want %v s", d, secs)
	}
	if Duration([]byte("fLaC\x00\x00\x00\x22"), 0) != 0 {
		t.Fatal("a header without STREAMINFO was read")
	}
}
