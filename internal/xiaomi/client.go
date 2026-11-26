// Package xiaomi talks to the Xiaomi account and Mina (Xiao AI speaker) services:
// QR-code login, serviceToken exchange and renewal, and the speaker device list.
//
// The request sequence follows songloft-plugin-miot (Apache-2.0) src/qrcode/qrcode.ts and
// src/mina/auth.ts, and xiaomusic (MIT) xiaomusic/qrcode_login.py.
package xiaomi

import (
	"context"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Endpoints are the service base URLs; tests point them at a fake server.
type Endpoints struct {
	Account     string // https://account.xiaomi.com
	Mina        string // https://api2.mina.mi.com
	Miot        string // https://api.io.mi.com/app (Mi Home)
	UserProfile string // https://userprofile.mina.mi.com (Xiao AI conversation records)
}

// DefaultEndpoints are Xiaomi's production services.
var DefaultEndpoints = Endpoints{Account: "https://account.xiaomi.com", Mina: "https://api2.mina.mi.com", Miot: "https://api.io.mi.com/app", UserProfile: "https://userprofile.mina.mi.com"}

const (
	qrLoginSID = "mijia"   // sid used to obtain the QR code
	minaSID    = "micoapi" // sid whose serviceToken the Mina API accepts
	sdkVersion = "3.8.6"
	jsonPrefix = "&&&START&&&"

	codeLoginRefused = 70016
	// ServiceTokenLifetime is how long a Mina serviceToken is assumed valid.
	ServiceTokenLifetime = 12 * time.Hour
)

// Client performs Xiaomi requests with bounded timeouts.
type Client struct {
	ep   Endpoints
	http *http.Client
}

// NewClient builds a Client. Redirects are followed manually so cookies set on every hop
// (the serviceToken arrives on an intermediate STS response) can be captured.
func NewClient(ep Endpoints) *Client {
	return &Client{ep: ep, http: &http.Client{
		Timeout:       40 * time.Second,
		Transport:     transport(),
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

// transport keeps connections warm for several speakers read every second, and notices a
// connection that silently died (router restart, changed line) instead of waiting on it.
//
// No proxy: the speakers are on this network and Xiaomi's services are domestic. The proxy the
// owner may set is for reaching GitHub and nothing else (see package update); reading one from
// the environment here would send these calls through it.
func transport() *http.Transport {
	return &http.Transport{
		Proxy:               nil,
		DialContext:         (&net.Dialer{Timeout: 4 * time.Second, KeepAlive: 15 * time.Second}).DialContext,
		TLSHandshakeTimeout: 4 * time.Second,
		ForceAttemptHTTP2:   true,
		MaxIdleConns:        32,
		MaxIdleConnsPerHost: 16,
		IdleConnTimeout:     90 * time.Second,
		HTTP2:               &http.HTTP2Config{SendPingTimeout: 5 * time.Second, PingTimeout: 3 * time.Second},
	}
}

// Session is everything needed to call Mina APIs and renew access.
type Session struct {
	UserID       string    `json:"user_id"`
	CUserID      string    `json:"c_user_id,omitempty"`
	PassToken    string    `json:"pass_token"`
	DeviceID     string    `json:"device_id"`
	ServiceToken string    `json:"service_token"`
	SSecurity    string    `json:"ssecurity"`
	ObtainedAt   time.Time `json:"obtained_at"`
	LinkedAt     time.Time `json:"linked_at"`
}

// Error is a classified Xiaomi failure the UI can explain.
type Error struct {
	Kind   string // network, expired, auth, upstream, protocol
	Detail string
}

func (e *Error) Error() string { return e.Kind + ": " + e.Detail }

// Error kinds.
const (
	KindNetwork  = "network"
	KindExpired  = "expired"
	KindAuth     = "auth"
	KindUpstream = "upstream"
	KindProtocol = "protocol"
)

func errf(kind, format string, a ...any) error {
	return &Error{Kind: kind, Detail: fmt.Sprintf(format, a...)}
}

// KindOf extracts an Error kind, defaulting to network for transport errors.
func KindOf(err error) string {
	var e *Error
	if errors.As(err, &e) {
		return e.Kind
	}
	return KindNetwork
}

// NewDeviceID returns a random client device id, kept for the life of a linked account.
func NewDeviceID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func userAgent(deviceID string) string {
	return "Android-7.1.1-1.0.0-ONEPLUS A3010-136-" + deviceID + " APP/xiaomi.smarthome APPV/62830"
}

func (c *Client) get(ctx context.Context, rawURL string, cookies map[string]string, deviceID string) (*http.Response, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("User-Agent", userAgent(deviceID))
	if len(cookies) > 0 {
		parts := make([]string, 0, len(cookies))
		for k, v := range cookies {
			parts = append(parts, k+"="+v)
		}
		req.Header.Set("Cookie", strings.Join(parts, "; "))
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return resp, body, err
}

func decodeAccountJSON(body []byte) (map[string]any, error) {
	s := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(string(body)), jsonPrefix))
	dec := json.NewDecoder(strings.NewReader(s))
	dec.UseNumber() // nonce exceeds float64 precision
	var m map[string]any
	if err := dec.Decode(&m); err != nil {
		return nil, errf(KindProtocol, "unexpected account response: %.120q", s)
	}
	return m, nil
}

func str(m map[string]any, k string) string {
	switch v := m[k].(type) {
	case string:
		return v
	case json.Number:
		return v.String()
	case nil:
		return ""
	default:
		return fmt.Sprint(v)
	}
}

func code(m map[string]any) int {
	n, _ := json.Number(str(m, "code")).Int64()
	return int(n)
}

// QRCode is a pending QR login.
type QRCode struct {
	ImageURL string
	LoginURL string
	PollURL  string
	DeviceID string
	Expires  time.Time
}

// StartQR asks the account service for a login QR code.
func (c *Client) StartQR(ctx context.Context) (QRCode, error) {
	deviceID := NewDeviceID()
	cookies := map[string]string{"sdkVersion": sdkVersion, "deviceId": deviceID}
	_, body, err := c.get(ctx, c.ep.Account+"/pass/serviceLogin?sid="+qrLoginSID+"&_json=true", cookies, deviceID)
	if err != nil {
		return QRCode{}, errf(KindNetwork, "serviceLogin: %v", err)
	}
	login, err := decodeAccountJSON(body)
	if err != nil {
		return QRCode{}, err
	}
	sign, qs, callback := str(login, "_sign"), str(login, "qs"), str(login, "callback")
	if sign == "" || qs == "" || callback == "" {
		return QRCode{}, errf(KindProtocol, "serviceLogin returned no login parameters (code %d)", code(login))
	}
	q := url.Values{}
	q.Set("_qrsize", "240")
	q.Set("qs", qs)
	q.Set("sid", qrLoginSID)
	q.Set("_sign", sign)
	q.Set("callback", callback)
	q.Set("_json", "true")
	q.Set("_dc", fmt.Sprint(time.Now().UnixMilli()))
	_, body, err = c.get(ctx, c.ep.Account+"/longPolling/loginUrl?"+q.Encode(), cookies, deviceID)
	if err != nil {
		return QRCode{}, errf(KindNetwork, "loginUrl: %v", err)
	}
	qr, err := decodeAccountJSON(body)
	if err != nil {
		return QRCode{}, err
	}
	if n := code(qr); n != 0 {
		return QRCode{}, errf(KindUpstream, "QR request refused: code %d %s", n, str(qr, "desc"))
	}
	out := QRCode{ImageURL: str(qr, "qr"), LoginURL: str(qr, "loginUrl"), PollURL: str(qr, "lp"), DeviceID: deviceID}
	if out.PollURL == "" || out.ImageURL == "" {
		return QRCode{}, errf(KindProtocol, "QR response missing qr or lp")
	}
	ttl := 120 * time.Second
	if n, err := json.Number(str(qr, "timeout")).Int64(); err == nil && n > 0 && n < 3600 {
		ttl = time.Duration(n) * time.Second
	}
	out.Expires = time.Now().Add(ttl)
	return out, nil
}

// PollResult is one long-poll outcome.
type PollResult struct {
	Done      bool // scan confirmed
	Expired   bool
	UserID    string
	CUserID   string
	PassToken string
}

// PollQR performs one long poll. It returns an empty result when nothing happened yet.
func (c *Client) PollQR(ctx context.Context, qr QRCode) (PollResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 35*time.Second)
	defer cancel()
	resp, body, err := c.get(ctx, qr.PollURL, nil, qr.DeviceID)
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) || isTimeout(err) {
			return PollResult{}, nil // the server held the request open: still waiting
		}
		return PollResult{}, errf(KindNetwork, "poll: %v", err)
	}
	if resp.StatusCode == http.StatusForbidden {
		return PollResult{Expired: true}, nil
	}
	if resp.StatusCode >= 400 {
		return PollResult{}, errf(KindUpstream, "poll: HTTP %d", resp.StatusCode)
	}
	m, err := decodeAccountJSON(body)
	if err != nil {
		return PollResult{}, nil // empty keep-alive response
	}
	if n := code(m); n != 0 {
		return PollResult{}, errf(KindUpstream, "poll: code %d %s", n, str(m, "desc"))
	}
	pt, uid := str(m, "passToken"), str(m, "userId")
	if pt == "" || uid == "" {
		return PollResult{}, nil
	}
	return PollResult{Done: true, UserID: uid, CUserID: str(m, "cUserId"), PassToken: pt}, nil
}

func isTimeout(err error) bool {
	var t interface{ Timeout() bool }
	return errors.As(err, &t) && t.Timeout()
}

// Exchange trades a passToken for a Mina serviceToken.
func (c *Client) Exchange(ctx context.Context, s Session) (Session, error) {
	return c.exchange(ctx, s, minaSID)
}

// exchange trades a passToken for a serviceToken of one service.
func (c *Client) exchange(ctx context.Context, s Session, sid string) (Session, error) {
	cookies := map[string]string{"passToken": s.PassToken, "userId": s.UserID, "deviceId": s.DeviceID, "sdkVersion": sdkVersion}
	if s.CUserID != "" {
		cookies["cUserId"] = s.CUserID
	}
	resp, body, err := c.get(ctx, c.ep.Account+"/pass/serviceLogin?sid="+sid+"&_json=true", cookies, s.DeviceID)
	if err != nil {
		return s, errf(KindNetwork, "serviceLogin(%s): %v", sid, err)
	}
	m, err := decodeAccountJSON(body)
	if err != nil {
		return s, err
	}
	if n := code(m); n != 0 {
		// 70016 means the passToken no longer authenticates: the user must scan again.
		// Anything else is the account service's own trouble and may pass.
		if n == codeLoginRefused {
			return s, errf(KindAuth, "passToken rejected: code %d %s", n, str(m, "desc"))
		}
		return s, errf(KindUpstream, "serviceLogin(%s): code %d %s", sid, n, str(m, "desc"))
	}
	location, ssecurity, nonce := str(m, "location"), str(m, "ssecurity"), str(m, "nonce")
	if location == "" || ssecurity == "" || nonce == "" {
		return s, errf(KindProtocol, "serviceLogin(%s) missing location, ssecurity or nonce", sid)
	}
	if uid := str(m, "userId"); uid != "" {
		s.UserID = uid
	}
	if pt := cookieValue(resp, "passToken"); pt != "" {
		s.PassToken = pt // the account service may rotate it
	}
	sum := sha1.Sum([]byte("nonce=" + nonce + "&" + ssecurity))
	sep := "?"
	if strings.Contains(location, "?") {
		sep = "&"
	}
	next := location + sep + "_userIdNeedEncrypt=true&clientSign=" + url.QueryEscape(base64.StdEncoding.EncodeToString(sum[:]))

	token := ""
	for hop := 0; hop < 10 && next != "" && token == ""; hop++ {
		r, _, err := c.get(ctx, next, nil, s.DeviceID)
		if err != nil {
			return s, errf(KindNetwork, "STS: %v", err)
		}
		token = cookieValue(r, "serviceToken")
		next = ""
		if loc, err := r.Location(); err == nil {
			next = loc.String()
		}
	}
	if token == "" {
		return s, errf(KindProtocol, "STS returned no serviceToken")
	}
	s.ServiceToken, s.SSecurity, s.ObtainedAt = token, ssecurity, time.Now()
	return s, nil
}

func cookieValue(r *http.Response, name string) string {
	for _, ck := range r.Cookies() {
		if ck.Name == name && ck.Value != "" && ck.Value != "EXPIRED" {
			return ck.Value
		}
	}
	return ""
}

// Device is one entry of the Mina device list.
type Device struct {
	DeviceID string `json:"deviceID"`
	Name     string `json:"name"`
	Alias    string `json:"alias"`
	Model    string `json:"model"`
	Hardware string `json:"hardware"`
	MiotDID  string `json:"miotDID"`
	Presence string `json:"presence"`
}

// ErrUnauthorized means the serviceToken was rejected and must be renewed.
var ErrUnauthorized = &Error{Kind: KindAuth, Detail: "serviceToken rejected"}

// DeviceList fetches the account's speakers. master selects the list variant: the plain
// list and master=1 have been seen to differ between accounts, so the caller tries both.
func (c *Client) DeviceList(ctx context.Context, s Session, master bool) ([]Device, error) {
	q := url.Values{}
	if master {
		q.Set("master", "1")
	}
	q.Set("requestId", "app_android_"+NewDeviceID()[:24])
	cookies := map[string]string{"userId": s.UserID, "serviceToken": s.ServiceToken, "channel": "MI_APP_STORE"}
	resp, body, err := c.get(ctx, c.ep.Mina+"/admin/v2/device_list?"+q.Encode(), cookies, s.DeviceID)
	if err != nil {
		return nil, errf(KindNetwork, "device_list: %v", err)
	}
	if resp.StatusCode == http.StatusUnauthorized {
		return nil, ErrUnauthorized
	}
	if resp.StatusCode >= 400 {
		return nil, errf(KindUpstream, "device_list: HTTP %d", resp.StatusCode)
	}
	var out struct {
		Code    int      `json:"code"`
		Message string   `json:"message"`
		Data    []Device `json:"data"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, errf(KindProtocol, "device_list: %.120q", body)
	}
	if out.Code != 0 {
		return nil, errf(KindUpstream, "device_list: code %d %s", out.Code, out.Message)
	}
	return out.Data, nil
}

// Record is one Xiao AI conversation entry.
type Record struct {
	RequestID   string   // upstream request id; empty on some firmware
	Time        int64    // upstream recognition time, Unix ms (Xiaomi's clock)
	Query       string   // recognised speech
	Answer      string   // first TTS answer
	AnswerTypes []string // e.g. TTS, AUDIO: whether Xiao AI spoke and/or started playback
}

// Conversations fetches the newest conversation records of one speaker, newest first.
// An empty slice means the speaker really has no records; failures are errors, so a caller
// never mistakes "could not read" for "nothing new".
func (c *Client) Conversations(ctx context.Context, s Session, deviceID, hardware string, limit int) ([]Record, error) {
	q := url.Values{}
	q.Set("source", "dialogu")
	q.Set("hardware", hardware)
	q.Set("timestamp", fmt.Sprint(time.Now().UnixMilli()))
	q.Set("limit", fmt.Sprint(limit))
	cookies := map[string]string{"userId": s.UserID, "serviceToken": s.ServiceToken, "deviceId": deviceID}
	resp, body, err := c.get(ctx, c.ep.UserProfile+"/device_profile/v2/conversation?"+q.Encode(), cookies, s.DeviceID)
	if err != nil {
		return nil, errf(KindNetwork, "conversation: %v", err)
	}
	if resp.StatusCode == http.StatusUnauthorized {
		return nil, ErrUnauthorized
	}
	if resp.StatusCode >= 400 {
		return nil, errf(KindUpstream, "conversation: HTTP %d", resp.StatusCode)
	}
	var outer struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    string `json:"data"`
	}
	if err := json.Unmarshal(body, &outer); err != nil {
		return nil, errf(KindProtocol, "conversation: %.80q", body)
	}
	if outer.Code != 0 {
		return nil, errf(KindUpstream, "conversation: code %d %s", outer.Code, outer.Message)
	}
	if outer.Data == "" {
		return []Record{}, nil
	}
	var data struct {
		Records []struct {
			RequestID string `json:"requestId"`
			Time      int64  `json:"time"`
			Query     string `json:"query"`
			Answers   []struct {
				Type string `json:"type"`
				TTS  struct {
					Text string `json:"text"`
				} `json:"tts"`
			} `json:"answers"`
		} `json:"records"`
	}
	if err := json.Unmarshal([]byte(outer.Data), &data); err != nil {
		return nil, errf(KindProtocol, "conversation data unreadable")
	}
	out := make([]Record, 0, len(data.Records))
	for _, r := range data.Records {
		rec := Record{RequestID: r.RequestID, Time: r.Time, Query: strings.TrimSpace(r.Query)}
		for _, a := range r.Answers {
			if a.Type != "" {
				rec.AnswerTypes = append(rec.AnswerTypes, a.Type)
			}
			if rec.Answer == "" && a.TTS.Text != "" {
				rec.Answer = strings.TrimSpace(a.TTS.Text)
			}
		}
		out = append(out, rec)
	}
	return out, nil
}
