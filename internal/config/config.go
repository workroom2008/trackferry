// Package config loads and validates TrackFerry's runtime configuration.
package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// Config is the whole runtime configuration.
type Config struct {
	Listen        string `yaml:"listen"`
	PublicBaseURL string `yaml:"public_base_url"`
	DataDir       string `yaml:"data_dir"`
	MusicDir      string `yaml:"music_dir"`
	// TakeoverSpeakers are (parts of) the names of speakers that may be taken over; "*" = all.
	TakeoverSpeakers []string `yaml:"takeover_speakers"`
	// Legacy carries the removed "devices" list so Load can warn about it. Speakers are
	// now discovered from the linked Xiaomi account and stored in the database.
	Legacy []any `yaml:"devices"`
	// UpdateCheck asks GitHub for newer releases.
	UpdateCheck bool `yaml:"update_check"`
	// Lx is a self-hosted 洛雪音乐 server, asked alongside the platforms for what they keep
	// for members. Empty disables it.
	Lx LxConfig `yaml:"lx"`
}

// LxConfig is the Subsonic endpoint of a 洛雪音乐 server.
type LxConfig struct {
	URL      string `yaml:"url"` // e.g. http://192.168.1.10:9527/rest
	User     string `yaml:"user"`
	Password string `yaml:"password"`
}

// Ready reports whether the server is configured.
func (l LxConfig) Ready() bool { return l.URL != "" && l.User != "" }

// fromEnv lets compose.yaml carry the whole configuration.
func (c *Config) fromEnv() {
	set := func(name string, to *string) {
		if v := strings.TrimSpace(os.Getenv(name)); v != "" {
			*to = v
		}
	}
	set("TRACKFERRY_LISTEN", &c.Listen)
	set("TRACKFERRY_URL", &c.PublicBaseURL)
	c.PublicBaseURL = strings.TrimRight(c.PublicBaseURL, "/")
	if v, ok := os.LookupEnv("TRACKFERRY_TAKEOVER"); ok {
		c.TakeoverSpeakers = nil
		for _, n := range strings.FieldsFunc(v, func(r rune) bool { return r == ',' || r == '，' }) {
			if n = strings.TrimSpace(n); n != "" {
				c.TakeoverSpeakers = append(c.TakeoverSpeakers, n)
			}
		}
	}
	switch strings.ToLower(os.Getenv("TRACKFERRY_UPDATE_CHECK")) {
	case "off", "false", "0":
		c.UpdateCheck = false
	case "on", "true", "1":
		c.UpdateCheck = true
	}
	set("TRACKFERRY_LX_URL", &c.Lx.URL)
	set("TRACKFERRY_LX_USER", &c.Lx.User)
	if v, ok := os.LookupEnv("TRACKFERRY_LX_PASSWORD"); ok {
		c.Lx.Password = v
	}
}

// TakeoverAllowed reports whether a speaker of this name may be set to takeover. Speakers
// are released one by one after they passed the tests at home.
func (c Config) TakeoverAllowed(name string) bool {
	for _, n := range c.TakeoverSpeakers {
		if n == "*" || n != "" && strings.Contains(name, n) {
			return true
		}
	}
	return false
}

// Default returns the configuration used when no file is present.
func Default() Config {
	return Config{Listen: ":18561", DataDir: "/data", MusicDir: "/music", UpdateCheck: true}
}

// Load reads path and then the environment, which wins. A missing file yields Default(); any
// other read or parse error is returned.
func Load(path string) (Config, error) {
	cfg := Default()
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		cfg.fromEnv()
		return cfg, cfg.Validate()
	}
	if err != nil {
		return Config{}, fmt.Errorf("read config: %w", err)
	}
	if err := yaml.Unmarshal(raw, &cfg); err != nil {
		return Config{}, fmt.Errorf("parse config %s: %w", path, err)
	}
	cfg.fromEnv()
	return cfg, cfg.Validate()
}

// Validate checks the configuration for values TrackFerry cannot run with.
func (c Config) Validate() error {
	var errs []error
	if _, err := ListenPort(c.Listen); err != nil {
		errs = append(errs, err)
	}
	if u, err := url.Parse(c.PublicBaseURL); c.PublicBaseURL != "" && (err != nil || u.Scheme != "http" && u.Scheme != "https" || u.Host == "") {
		errs = append(errs, fmt.Errorf("TRACKFERRY_URL %q: want something like http://192.168.1.10:18561", c.PublicBaseURL))
	}
	if c.DataDir == "" {
		errs = append(errs, errors.New("data_dir is required"))
	}
	if c.MusicDir == "" {
		errs = append(errs, errors.New("music_dir is required"))
	}
	return errors.Join(errs...)
}

// LocalURL is where the server is reached from inside its own container.
func (c Config) LocalURL() (string, error) {
	port, err := ListenPort(c.Listen)
	if err != nil {
		return "", err
	}
	host, _, _ := net.SplitHostPort(c.Listen)
	if ip := net.ParseIP(host); host == "" || ip != nil && ip.IsUnspecified() {
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, strconv.Itoa(port)), nil
}

// ListenPort extracts the TCP port from a listen address such as ":18561".
func ListenPort(listen string) (int, error) {
	_, portStr, err := net.SplitHostPort(listen)
	if err != nil {
		return 0, fmt.Errorf("listen %q: %w", listen, err)
	}
	port, err := strconv.Atoi(portStr)
	if err != nil || port < 1 || port > 65535 {
		return 0, fmt.Errorf("listen %q: invalid port", listen)
	}
	return port, nil
}
