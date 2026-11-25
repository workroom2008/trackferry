// Package takeover interrupts Xiao AI on a speaker and plays TrackFerry's own audio
// instead, as a closed loop rather than a single "stop then play":
//
//  1. mute, so the rest of Xiao AI's spoken answer is not heard, and stop. Both begin
//     as soon as a request is heard, the mute even before it is decided who answers;
//  2. stop again after a short settle: Xiao AI's answer is speech followed by its own
//     playlist, which starts after a single stop;
//  3. push our stream while still muted;
//  4. guard for a few seconds: whenever the speaker plays something that is not ours,
//     stop it and push ours again; unmute once the speaker fetched our stream and
//     reports playing it;
//  5. always put the volume back, even on failure, cancellation or a crash (the volume
//     to restore is kept on disk until it has been restored);
//  6. once our track has played through, stop the speaker: a pushed URL is a one-item
//     playlist that the speaker otherwise repeats forever.
//
// Every step is timed and stored with the run, so field tests show where time went.
// A newer run on the same speaker cancels the older one.
package takeover

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"sync"
	"time"

	"trackferry/internal/live"
	"trackferry/internal/logx"
	"trackferry/internal/store"
	"trackferry/internal/xiaomi"
)

// Speaker controls one speaker's player (the xiaomi.Manager).
type Speaker interface {
	PlayStatus(ctx context.Context, deviceID string) (xiaomi.PlayStatus, error)
	PlayerOp(ctx context.Context, deviceID, action string) error
	SetVolume(ctx context.Context, deviceID string, volume int) error
	PlayURL(ctx context.Context, deviceID, hardware, url string) error
	Speak(ctx context.Context, deviceID, text string) error
}

// Track is what to play.
type Track struct {
	URL       string
	Label     string
	Fetched   <-chan struct{} // closed when the speaker requests the stream
	Restarted <-chan struct{} // closed when the speaker requests it from the start again (looping); optional
	Duration  time.Duration   // play length when known; 0 = unknown
	Length    time.Duration   // the song's length; unlike Duration it ends nothing by the clock alone
	Lost      func() bool     // the speaker hung up before it had everything; optional
	// Resume prepares the same song from a point and says where it really starts; optional.
	Resume func(ctx context.Context, at time.Duration) (Track, time.Duration, error)
	// Seekable: its format can be started in the middle.
	Seekable bool
}

// Request is one takeover.
type Request struct {
	DeviceID   string
	Hardware   string
	Kind       string // test | command
	CommandID  int64
	UpstreamMS int64 // Xiaomi's recognition time of the command
	Track      Track
	Song       *store.Song // for a song sent from the library
	Trace      *live.Trace // tells the web UI; optional
	// Follows: our own last song just ended, so there is nothing to silence first.
	Follows bool
	// Quiet: the song is nowhere to be had, so the speaker is stopped and left silent rather
	// than letting Xiao AI play its own version of it. No audio is pushed.
	Quiet bool
	Answer  int // characters Xiao AI says
	// Ended is called once the run is over; optional.
	Ended func(End)
}

// Timing tunes the loop; tests shorten it.
type Timing struct {
	Settle      time.Duration // between the two stop rounds
	Guard       time.Duration // how long after the push foreign playback is fought
	Poll        time.Duration // status reads during the guard
	UnmuteAfter time.Duration // unmute this long after the fetch even without a playing status
	MaxReplays  int
	EndSlack    time.Duration // after a known duration, wait this long before stopping
	MaxWatch    time.Duration // give up watching for the end after this long
	Look        time.Duration // status reads while the song plays
	LookClose   time.Duration // and while something is going on
	Speak       time.Duration // how long Xiao AI takes to say one character
	Pause       time.Duration // after her answer
}

// DefaultTiming follows songloft-plugin-miot's interrupt settle (600 ms) and status
// verification cadence (~700 ms).
var DefaultTiming = Timing{Settle: 600 * time.Millisecond, Guard: 8 * time.Second, Poll: 700 * time.Millisecond,
	UnmuteAfter: 2500 * time.Millisecond, MaxReplays: 2, EndSlack: 1500 * time.Millisecond, MaxWatch: 3 * time.Hour,
	Look: 2500 * time.Millisecond, LookClose: 900 * time.Millisecond, Speak: 235 * time.Millisecond, Pause: 1500 * time.Millisecond}

// longestAnswer bounds the wait for Xiao AI to finish.
const longestAnswer = 15 * time.Second

// Step names stored with a run.
const (
	StepStatus    = "status"    // read player state and volume
	StepMute      = "mute"      // volume to 0
	StepStop1     = "stop1"     // first pause + stop
	StepQuiet     = "quiet"     // nothing was found: the speaker is stopped and left silent
	StepWait      = "wait"      // for Xiao AI to finish what she says
	StepStop2     = "stop2"     // second pause + stop after settle
	StepPlay      = "play"      // pushed our stream
	StepFetched   = "fetched"   // speaker requested our stream
	StepForeign   = "foreign"   // speaker was playing something else again; stopped
	StepReplay    = "replay"    // pushed our stream again
	StepConfirmed = "confirmed" // fetched and the speaker reports playing ours
	StepRestore   = "restore"   // volume back
	StepCancelled = "cancelled" // superseded
	StepReleased  = "released"  // the user said something Xiao AI keeps; stopped guarding
	StepPaused    = "paused"    // the song stopped sounding
	StepContinued = "continued" // and went on by itself
	StepTalked    = "talked"    // someone talked to Xiao AI over the song
	StepResume    = "resume"    // we continued the song from where it was
	StepSeek      = "seek"      // moved to another point of the song
	StepStopped   = "stopped"   // the listener stopped it, or something else plays
	StepEnded     = "ended"     // our track played through (or started over); stopped the repeat
)

// Engine runs takeovers. It is safe for concurrent use.
type Engine struct {
	sp     Speaker
	st     *store.Store
	log    *slog.Logger
	timing Timing
	now    func() time.Time

	// Deep mutes and pauses a speaker through Mi Home, or lifts that mute; optional.
	Deep func(ctx context.Context, deviceID string, on bool) error
	// Style is how a speaker is kept quiet; optional.
	Style func(deviceID string) string
	// Floor is the least volume of a speaker, which 0 leads to; optional.
	Floor func(deviceID string) int

	mu      sync.Mutex
	devs    map[string]*device
	checks  []time.Duration
	volumes map[string]known
}

type device struct {
	run    sync.Mutex // one run at a time per speaker
	cancel context.CancelCauseFunc
	gen    int
	hold   int // runs and answers that own the speaker's volume right now
	// letGo is when the last of them ended.
	letGo   time.Time
	touched int // counts what was done to the volume
	// released is closed when the user spoke a command that Xiao AI keeps: the guard must
	// stop fighting whatever she plays next.
	released chan struct{}
	heard    chan Heard
	watching bool          // the song is past its guard; what is heard takes effect
	cut      bool          // paused by a stop, so "play" alone does not bring it back
	hands    chan struct{} // a button was pressed: what is on is what is wanted
	seeks    chan seek

	vol     sync.Mutex // one mute at a time
	quiets  int        // requests being decided on
	quieted int        // the volume they turned down, 0: none
	deep    sync.Mutex
	deepOn  bool // muted through Mi Home
	// deepKnown: deepOn tells; until then an earlier process may have left a mute.
	deepKnown bool
}

// New returns an Engine.
func New(sp Speaker, st *store.Store, log *slog.Logger, timing Timing) *Engine {
	return &Engine{sp: prompt{sp}, st: st, log: log, timing: timing, now: time.Now, devs: map[string]*device{}, checks: checkAfter, volumes: map[string]known{}}
}

// Start begins a takeover in the background, cancelling any run in progress on the same
// speaker, and returns the stored run (state running).
func (e *Engine) Start(ctx context.Context, req Request) (store.TakeoverRun, error) {
	run := store.TakeoverRun{DeviceID: req.DeviceID, CommandID: req.CommandID, Kind: req.Kind, Source: req.Track.Label,
		StartedMS: e.now().UnixMilli(), UpstreamMS: req.UpstreamMS, Steps: []store.Step{}, Song: req.Song}
	if err := e.st.StartRun(ctx, &run); err != nil {
		return run, err
	}
	e.mu.Lock()
	d := e.devs[req.DeviceID]
	if d == nil {
		d = &device{}
		e.devs[req.DeviceID] = d
	}
	if d.cancel != nil {
		d.cancel(nil)
	}
	runCtx, cancel := context.WithCancelCause(context.WithoutCancel(ctx))
	d.gen++
	d.hold++ // a newer run owns the volume from here on, though the older one is still leaving
	gen := d.gen
	d.cancel = cancel
	released := make(chan struct{})
	d.released = released
	heard := make(chan Heard, 8)
	d.heard = heard
	hands, seeks := make(chan struct{}, 1), make(chan seek, 4)
	d.hands, d.seeks = hands, seeks
	d.watching, d.cut = false, false
	e.mu.Unlock()

	own := run // the goroutine's copy; the caller gets the snapshot below
	go func() {
		how := EndOther
		if req.Ended != nil {
			defer func() {
				defer logx.Recover(e.log, "连播")
				req.Ended(how)
			}()
		}
		defer cancel(nil)
		d.run.Lock()
		defer d.run.Unlock()
		letGo := e.letGo(d)
		defer func() {
			letGo()
			e.mu.Lock()
			if d.gen == gen {
				d.cancel, d.released, d.heard, d.watching = nil, nil, nil, false
				d.hands, d.seeks = nil, nil
				for len(seeks) > 0 {
					(<-seeks).done <- ErrNoSeek
				}
			}
			e.mu.Unlock()
		}()
		defer logx.Recover(e.log, "接管")
		how = e.execute(runCtx, req, &own, released, heard, hands, seeks, func() bool {
			e.mu.Lock()
			defer e.mu.Unlock()
			return d.gen != gen
		}, letGo)
	}()
	return run, nil
}

// Release ends the guard of a run in progress, if any. The run still puts the volume back
// and still stops its own track from repeating.
func (e *Engine) Release(deviceID string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if d := e.devs[deviceID]; d != nil && d.released != nil {
		close(d.released)
		d.released = nil
	}
}

// Heard is something said to a speaker while our song plays.
type Heard struct {
	Control string // pause | resume | next | previous | stop
	Stop    bool   // asks for silence in other words
	Audio   bool   // Xiao AI plays something in reply
	Answer  int    // characters she says
	Quiet   bool   // not worth a step of its own
	Button  bool   // pressed, not said
	Woke    bool   // the speaker was woken and listens
	Cut     bool   // the speaker had to be stopped to be paused
	At      time.Time
}

// Hear tells a run in progress what was said. The words themselves are not passed on.
func (e *Engine) Hear(deviceID string, h Heard) {
	if h.At.IsZero() {
		h.At = e.now()
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if d := e.devs[deviceID]; d != nil && d.heard != nil {
		select {
		case d.heard <- h:
		default:
		}
		if h.Button {
			d.handOver()
		}
	}
}

// Run performs a takeover synchronously (tests and callers that wait).
func (e *Engine) Run(ctx context.Context, req Request) (store.TakeoverRun, error) {
	run := store.TakeoverRun{DeviceID: req.DeviceID, CommandID: req.CommandID, Kind: req.Kind, Source: req.Track.Label,
		StartedMS: e.now().UnixMilli(), UpstreamMS: req.UpstreamMS, Steps: []store.Step{}, Song: req.Song}
	if err := e.st.StartRun(ctx, &run); err != nil {
		return run, err
	}
	e.mu.Lock()
	d := e.devs[req.DeviceID]
	if d == nil {
		d = &device{}
		e.devs[req.DeviceID] = d
	}
	d.hold++
	e.mu.Unlock()
	letGo := e.letGo(d)
	defer letGo()
	d.run.Lock()
	defer d.run.Unlock()
	e.execute(ctx, req, &run, nil, nil, nil, nil, func() bool { return false }, letGo)
	return run, nil
}

type runner struct {
	e       *Engine
	ctx     context.Context
	req     Request
	run     *store.TakeoverRun
	start   time.Time
	mu      sync.Mutex
	elapsed time.Duration
	phase   string
	held    bool // the song does not sound

	saving bool // a write of the progress is on its way
	dirty  bool // and there is more to write
	closed bool // the final write has been made
}

func (r *runner) step(name string, ok bool, detail string) {
	r.mu.Lock()
	r.run.Steps = append(r.run.Steps, store.Step{Step: name, AtMS: r.e.now().Sub(r.start).Milliseconds(), OK: ok, Detail: detail})
	r.tell()
	// Progress is visible while the run is going. Writing it must not hold up the speaker.
	r.dirty = true
	if !r.saving && !r.closed {
		r.saving = true
		go r.save()
	}
	r.mu.Unlock()
}

// save writes the progress until there is nothing new.
func (r *runner) save() {
	for {
		r.mu.Lock()
		if !r.dirty || r.closed {
			r.saving = false
			r.mu.Unlock()
			return
		}
		r.dirty = false
		c := *r.run
		c.Steps = slices.Clone(c.Steps)
		r.mu.Unlock()
		r.e.st.SaveRun(context.WithoutCancel(r.ctx), &c)
	}
}

// settle waits for writes under way and makes the last one. Steps after it start over.
func (r *runner) settle() {
	for {
		r.mu.Lock()
		if !r.saving {
			r.closed = true
			c := *r.run
			c.Steps = slices.Clone(c.Steps)
			r.mu.Unlock()
			r.e.st.SaveRun(context.WithoutCancel(r.ctx), &c)
			r.mu.Lock()
			r.closed, r.dirty = false, false
			r.mu.Unlock()
			return
		}
		r.mu.Unlock()
		time.Sleep(5 * time.Millisecond)
	}
}

// tell hands the web UI a copy of the run. Call with r.mu held or before steps are shared.
func (r *runner) tell() {
	c := *r.run
	c.Steps = slices.Clone(c.Steps)
	r.req.Trace.Run(c)
}

// status reads the player, for the decision at hand and for whoever is watching.
func (r *runner) status() (xiaomi.PlayStatus, error) {
	p, err := r.e.sp.PlayStatus(r.ctx, r.req.DeviceID)
	if err == nil {
		if r.e.calm(r.req.DeviceID) {
			r.e.learn(r.req.DeviceID, p.Volume)
		}
		r.req.Trace.Player(live.Player{Status: p.Status, Position: p.Position, Duration: p.Duration, Volume: p.Volume,
			Ours: p.Playing() && (p.AudioID == "" || p.AudioID == xiaomi.OurAudioID), Held: r.held, Elapsed: r.elapsed.Milliseconds(), Phase: r.phase, Seek: r.req.Track.Seekable})
	}
	return p, err
}

func describe(err error) string {
	if err == nil {
		return ""
	}
	var de *xiaomi.DeviceError
	if errors.As(err, &de) {
		return fmt.Sprintf("音箱拒绝（%d）", de.Code)
	}
	if errors.Is(err, context.Canceled) {
		return "已取消"
	}
	switch xiaomi.KindOf(err) {
	case xiaomi.KindNetwork:
		return "连不上小米服务器"
	case xiaomi.KindAuth:
		return "小米登录失效"
	case xiaomi.KindUpstream:
		return "小米没有送达（音箱可能离线）"
	}
	if errors.Is(err, xiaomi.ErrNotLinked) {
		return "没有可用的小米登录"
	}
	return err.Error()
}

// stop silences the player.
func (r *runner) stop(name string) error {
	err := r.e.halt(r.ctx, r.req.DeviceID)
	r.step(name, err == nil, describe(err))
	return err
}

func (e *Engine) sleep(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

func (e *Engine) execute(ctx context.Context, req Request, run *store.TakeoverRun, released <-chan struct{}, heard <-chan Heard, hands <-chan struct{}, seeks <-chan seek, superseded func() bool, letGo func()) (how End) {
	r := &runner{e: e, ctx: ctx, req: req, run: run, start: time.UnixMilli(run.StartedMS)}
	defer r.settle()
	finish := func(outcome, detail string) {
		r.mu.Lock()
		run.Outcome, run.Detail, run.FinishedMS = outcome, detail, e.now().UnixMilli()
		r.tell()
		r.mu.Unlock()
		r.settle()
		if outcome != store.OutcomeConfirmed && outcome != store.OutcomeFetched {
			req.Trace.Done("")
		}
		e.log.Info("接管　结束", "种类", req.Kind, "结果", outcome,
			"用时ms", run.FinishedMS-run.StartedMS, "说明", detail)
	}
	dev := req.DeviceID
	bg := context.WithoutCancel(ctx)

	// 1. Mute, remembering the volume to come back to, and stop: all at once, because every
	// call may take a speaker a second. The restore is deferred before anything can fail.
	remute := false
	volume, muted, restored := -1, false, false
	restore := func() {
		if !muted || restored {
			return
		}
		restored = true
		defer letGo()
		if superseded() {
			return // the newer run keeps the mute and finds the volume to come back to
		}
		v, err := e.putBack(dev, volume)
		r.step(StepRestore, err == nil, fmt.Sprintf("音量 %d %s", v, describe(err)))
	}
	defer restore()
	stop1 := make(chan error, 1)
	if req.Follows {
		// A mute that is still on is an earlier run's, left for us to lift.
		if v, ok, err := e.st.PendingVolume(bg, dev); err == nil && ok {
			volume, muted = v, true
		}
	} else {
		go func() { stop1 <- e.halt(ctx, dev) }()
		m := e.mute(ctx, dev)
		volume, muted = m.volume, m.muted
		r.step(StepStatus, m.statusOK, m.status)
		if m.muted || m.err != nil || m.note != "" {
			r.step(StepMute, m.err == nil && m.note == "", m.note+describe(m.err))
		}
		remute = m.muted && m.err != nil
	}
	if !muted {
		letGo()
	}

	cancelled := func() bool {
		if ctx.Err() == nil {
			return false
		}
		if context.Cause(ctx) == errStopped {
			r.step(StepStopped, true, "按了停止")
			finish(store.OutcomeCancelled, "按了停止")
			return true
		}
		r.step(StepCancelled, true, "同一台音箱有了更新的指令")
		finish(store.OutcomeCancelled, "被更新的指令取代")
		return true
	}

	// 2. Stop again: Xiao AI's playlist starts after a single stop.
	if !req.Follows {
		err := <-stop1
		r.step(StepStop1, err == nil, describe(err))
		if e.sleep(ctx, e.timing.Settle); cancelled() {
			return
		}
		if remute {
			e.sp.SetVolume(ctx, dev, 0)
		}
		r.stop(StepStop2)
		if muted && e.style(dev) == HushWait {
			left := max(0, min(longestAnswer, e.timing.Pause+time.Duration(req.Answer)*e.timing.Speak-time.Duration(e.now().UnixMilli()-req.UpstreamMS)*time.Millisecond))
			if req.Answer > 0 && left > 0 {
				r.step(StepWait, true, fmt.Sprintf("等小爱说完，约 %.1f 秒", left.Seconds()))
				if e.sleep(ctx, left); cancelled() {
					return
				}
				r.stop(StepStop2)
			}
		}
	}
	if cancelled() {
		return
	}

	// Nothing to play: Xiao AI's answer is stopped, and her own version of a song it could not
	// be given here must not be heard either. The volume goes back with the run, as for any
	// request that ends without a song of ours playing.
	if req.Quiet {
		r.step(StepQuiet, true, "曲库和线上都没有，停住不出声")
		finish(store.OutcomeFailed, "曲库和线上都没有这首歌，没有出声")
		return EndUnplayed
	}

	e.deepened(dev)
	if cancelled() {
		return
	}

	// 3. Push our stream.
	push := func(name string) error {
		err := e.sp.PlayURL(ctx, dev, req.Hardware, req.Track.URL)
		for i := 0; err != nil && ctx.Err() == nil && i < 2; i++ {
			r.step(name, false, describe(err)+"，再试")
			if e.sleep(ctx, 300*time.Millisecond) != nil {
				break
			}
			err = e.sp.PlayURL(ctx, dev, req.Hardware, req.Track.URL)
		}
		r.step(name, err == nil, describe(err))
		return err
	}
	if err := push(StepPlay); err != nil {
		if cancelled() {
			return
		}
		finish(store.OutcomeFailed, "推送播放失败："+describe(err))
		return EndUnplayed
	}

	// 4. Guard.
	musicAPI := xiaomi.UsesMusicAPI(req.Hardware)
	deadline := e.now().Add(e.timing.Guard)
	var fetchedAt time.Time
	confirmed, left := false, false
	replays := 0
	pushed := e.now()
	fast := e.timing.Poll / 2 // until it sounds: the mute lifts that much sooner
	tick := time.NewTimer(fast)
	defer tick.Stop()
	fetched := req.Track.Fetched
	onFetched := func() {
		fetched = nil
		fetchedAt = e.now()
		r.step(StepFetched, true, "")
	}
	// The stream is being pulled: do not keep the user waiting on a status that is late.
	statusOrUnmute := func() (p xiaomi.PlayStatus, err error) {
		done := make(chan struct{})
		go func() {
			defer close(done)
			defer logx.Recover(e.log, "接管")
			err = errors.New("状态读不懂")
			p, err = r.status()
		}()
		var due <-chan time.Time
		arm := func() {
			if !fetchedAt.IsZero() && !confirmed {
				due = time.After(e.timing.UnmuteAfter - e.now().Sub(fetchedAt))
			}
		}
		arm()
		for {
			select {
			case <-done:
				return p, err
			case <-fetched:
				onFetched()
				arm()
			case <-due:
				if ctx.Err() == nil {
					restore()
				}
			}
		}
	}
guard:
	for e.now().Before(deadline) {
		select {
		case <-ctx.Done():
			cancelled()
			return
		case <-fetched:
			onFetched()
			tick.Reset(fast / 2)
			continue
		case <-released:
			left = true
			r.step(StepReleased, true, "有新的口令交给小爱，不再守护")
			break guard
		case <-touched(hands, confirmed):
			break guard
		case <-tick.C:
		}
		if confirmed {
			r.elapsed = max(0, e.now().Sub(fetchedAt)-startLag)
			tick.Reset(e.timing.Poll)
		} else {
			tick.Reset(fast)
		}
		if !fetchedAt.IsZero() && !confirmed && e.now().Sub(fetchedAt) >= e.timing.UnmuteAfter {
			restore()
		}
		p, err := statusOrUnmute()
		if err != nil {
			continue
		}
		foreign := p.Playing() && musicAPI && p.AudioID != "" && p.AudioID != xiaomi.OurAudioID
		if foreign {
			if replays >= e.timing.MaxReplays {
				r.step(StepForeign, false, "小爱反复抢回播放，放弃")
				if cancelled() {
					return
				}
				finish(store.OutcomeFailed, "小爱的播放列表反复抢回音箱")
				return
			}
			replays++
			r.stop(StepForeign)
			if err := push(StepReplay); err != nil {
				continue
			}
			pushed = e.now()
			confirmed, r.phase = false, ""
			e.setWatching(dev, heard, false)
			continue
		}
		// Accepted, but the speaker neither came for it nor plays anything: it got lost.
		if fetched != nil && !p.Playing() && replays < e.timing.MaxReplays && e.now().Sub(pushed) >= e.timing.Guard*3/8 {
			replays++
			push(StepReplay)
			pushed = e.now()
			continue
		}
		if !confirmed && !fetchedAt.IsZero() && p.Playing() {
			confirmed, r.phase = true, phasePlaying
			e.setWatching(dev, heard, true) // buttons work from here on
			r.step(StepConfirmed, true, fmt.Sprintf("播放中，进度 %d ms", p.Position))
			restore()
		}
	}
	restore()
	switch {
	case confirmed:
		finish(store.OutcomeConfirmed, "")
	case !fetchedAt.IsZero():
		finish(store.OutcomeFetched, "音箱取了流，但播放状态没有确认")
	default:
		finish(store.OutcomeDispatched, "播放指令已受理，音箱没有来取流")
		if left {
			return EndOther
		}
		return EndUnplayed
	}
	e.setWatching(dev, heard, true)
	how = r.watch(fetchedAt, heard, seeks)
	req.Trace.Done("")
	return how
}

// touched is hands while a button may end the guard.
func touched(hands <-chan struct{}, confirmed bool) <-chan struct{} {
	if confirmed {
		return hands
	}
	return nil
}

// setWatching says whether what is heard takes effect, for the run that owns heard.
func (e *Engine) setWatching(dev string, heard <-chan Heard, on bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if d := e.devs[dev]; d != nil && heard != nil && d.heard == heard {
		d.watching = on
	}
}

// handOver ends a guard whose song is on. Needs e.mu.
func (d *device) handOver() {
	select {
	case d.hands <- struct{}{}:
	default:
	}
}

// refused reports that a speaker or Xiaomi certainly did not do what it was asked.
func refused(err error) bool {
	var de *xiaomi.DeviceError
	return errors.As(err, &de) || errors.Is(err, xiaomi.ErrNotLinked) || errors.Is(err, xiaomi.ErrUnauthorized)
}

// putBack gives a muted speaker its volume again: the one it had, or what was asked for
// since (Engine.SetVolume).
func (e *Engine) putBack(dev string, volume int) (int, error) {
	bg := context.Background()
	var err error
	for i := 0; i < 3; i++ {
		v, pending, _ := e.st.PendingVolume(bg, dev)
		if !pending {
			v = volume
		}
		// Usually lifted long since (deepened). If not, first: it may change the volume.
		lifted, lift := e.undeepen(dev)
		c, cancel := context.WithTimeout(bg, 6*time.Second)
		err = e.sp.SetVolume(c, dev, v)
		if err == nil && lifted && v > 0 {
			// And it may take effect after it was answered.
			e.sleep(c, liftLag)
			if p, serr := e.sp.PlayStatus(c, dev); serr != nil || v > e.floor(dev) && p.Volume <= e.floor(dev) {
				err = e.sp.SetVolume(c, dev, v)
			}
		}
		cancel()
		if err == nil {
			err = lift
		}
		e.know(dev, v)
		if volume = v; err != nil {
			time.Sleep(300 * time.Millisecond)
			continue
		}
		e.st.VolumeRestored(bg, dev, v)
		if _, changed, _ := e.st.PendingVolume(bg, dev); !changed {
			break
		}
	}
	e.check(dev, volume)
	return volume, err
}

// liftLag is how long after lifting a mute the volume is looked at again.
const liftLag = 400 * time.Millisecond

// hold marks a speaker's volume as being looked after and returns what ends that.
func (e *Engine) hold(dev string) func() {
	e.mu.Lock()
	defer e.mu.Unlock()
	d := e.devs[dev]
	if d == nil {
		d = &device{}
		e.devs[dev] = d
	}
	d.hold++
	return e.letGo(d)
}

// letGo returns what ends one hold, however often it is called.
func (e *Engine) letGo(d *device) func() {
	return sync.OnceFunc(func() {
		e.mu.Lock()
		d.hold--
		d.letGo = e.now()
		e.mu.Unlock()
	})
}

func (e *Engine) held(dev string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	d := e.devs[dev]
	return d != nil && d.hold > 0
}

// recoverEvery is between looks for speakers left muted.
const recoverEvery = 20 * time.Second

// RecoverVolumes puts back volumes that a previous process, or a run that could not reach
// the speaker, left muted. It runs until ctx ends.
func (e *Engine) RecoverVolumes(ctx context.Context) {
	for {
		e.recoverOnce(ctx)
		if e.sleep(ctx, recoverEvery) != nil {
			return
		}
	}
}

func (e *Engine) recoverOnce(ctx context.Context) {
	defer logx.Recover(e.log, "接管")
	pending, err := e.st.PendingVolumes(ctx)
	if err != nil {
		e.log.Warn("接管　读不到待恢复的音量", "原因", err)
		return
	}
	for dev, v := range pending {
		e.recoverVolume(ctx, dev, v)
	}
}

func (e *Engine) recoverVolume(ctx context.Context, dev string, v int) {
	if e.held(dev) {
		return
	}
	c, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	// Lifting the mute may change the volume, so it comes before looking.
	if _, err := e.undeepen(dev); err != nil {
		return
	}
	if e.style(dev) != HushNormal {
		if e.Unhush(ctx, dev) != nil {
			e.log.Warn("接管　没能确认米家静音已解除")
		}
		e.sleep(c, liftLag)
	}
	p, err := e.sp.PlayStatus(c, dev)
	if err != nil || e.held(dev) {
		return
	}
	if p.Volume > e.floor(dev) { // somebody turned it up already, or the mute never arrived
		e.st.ClearPendingVolume(ctx, dev)
		return
	}
	if err := e.sp.SetVolume(c, dev, v); err != nil || e.held(dev) {
		return // a run that began meanwhile found the pending volume and restores it
	}
	e.st.ClearPendingVolume(ctx, dev)
	e.log.Info("接管　已恢复留下的静音", "音量", v)
}
