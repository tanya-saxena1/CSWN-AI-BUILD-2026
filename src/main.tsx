import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { startVision, type CameraMode, type Detection, type VisionSession } from './vision';
import './style.css';

type Mode = CameraMode | 'scan' | 'keyboard';
type Settings = { sensitivity: number; dwellMs: number };
type DesktopState = {active:boolean;overlay:boolean;ready:boolean;pausedReason?:string|null};
const defaultSettings: Settings = { sensitivity: 5.5, dwellMs: 1300 };
const slides = [
  { label: '01 / THE IDEA', title: 'Technology should respond to you.', body: 'A computer interface shaped around the movement a person can use.', color: 'violet' },
  { label: '02 / THE SYSTEM', title: 'One action. More ways to reach it.', body: 'Hands, head movement, dwell selection, or one key can activate the same command.', color: 'blue' },
  { label: '03 / THE IMPACT', title: 'Choice is the feature.', body: 'Personal calibration lets people choose their input instead of adapting to a fixed gesture.', color: 'orange' }
];
const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));
const CommandContext = React.createContext<(name: string) => void>(() => {});
function Action({name, children, className=''}: {name:string; children:React.ReactNode; className?:string}) {
  const run = React.useContext(CommandContext);
  return <button type="button" data-command={name} className={className} onClick={() => run(name)}>{children}</button>;
}
function readSettings(): Settings {
  try { return { ...defaultSettings, ...JSON.parse(localStorage.getItem('openinput-settings') || '{}') }; }
  catch { return defaultSettings; }
}
function App() {
  const [mode, setMode] = useState<Mode>('keyboard');
  const [settings, setSettings] = useState<Settings>(readSettings);
  const [cameraOn, setCameraOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Choose an input mode to begin.');
  const [signal, setSignal] = useState('No signal');
  const [lastCommand, setLastCommand] = useState('None yet');
  const [paused, setPaused] = useState(false);
  const [cursor, setCursor] = useState<{x: number; y: number} | null>(null);
  const [dwell, setDwell] = useState<{id: string; progress: number} | null>(null);
  const [slide, setSlide] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<'slides' | 'sound' | 'launchpad'>('slides');
  const [actionCount, setActionCount] = useState(0);
  const [desktopState, setDesktopState] = useState<DesktopState>({active:false, overlay:false, ready:false});
  const [desktopError, setDesktopError] = useState('');
  const desktopRef = useRef(desktopState);
  const desktopDwell = useRef<{x:number;y:number;start:number;fired:boolean}|null>(null);
  const desktopOrigin = useRef<{x:number;y:number}|null>(null);
  const desktopArmed = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<VisionSession | null>(null);
  const sessionVersion = useRef(0);
  const modeRef = useRef(mode), pausedRef = useRef(paused), settingsRef = useRef(settings);
  const faceCenter = useRef<{x: number; y: number} | null>(null);
  const lastFace = useRef<{x: number; y: number} | null>(null);
  const smoothed = useRef<{x: number; y: number} | null>(null);
  const dwellRef = useRef<{id: string; start: number; fired: boolean} | null>(null);
  const gestureRef = useRef({ pinchStart: 0, pinchFired: false, palmStart: 0, palmFired: false, lastAction: 0 });
  const lastUiUpdate = useRef(0);
  const audioRef = useRef<{context: AudioContext; oscillator: OscillatorNode; gain: GainNode} | null>(null);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { desktopRef.current = desktopState; }, [desktopState]);
  useEffect(() => window.desktop?.onState(state => {
    const wasActive=desktopRef.current.active;
    desktopRef.current = state; setDesktopState(state);
    desktopDwell.current=null; setDwell(null);
    if (!wasActive && state.active) {
      desktopOrigin.current=smoothed.current ? {...smoothed.current}:null;
      desktopArmed.current=false;
    }
  }), []);
  useEffect(() => { settingsRef.current = settings; localStorage.setItem('openinput-settings', JSON.stringify(settings)); }, [settings]);

  const command = useCallback((name: string) => {
    setLastCommand(name.replaceAll('_', ' '));
    setActionCount(x => x + 1);
    if (name === 'NEXT_SLIDE') { setView('slides'); setSlide(x => (x + 1) % slides.length); }
    if (name === 'PREV_SLIDE') { setView('slides'); setSlide(x => (x + slides.length - 1) % slides.length); }
    if (name === 'TOGGLE_PLAY') { setView('sound'); setPlaying(x => !x); }
    if (name === 'SHOW_SLIDES') setView('slides');
    if (name === 'SHOW_SOUND') setView('sound');
    if (name === 'SHOW_LAUNCHPAD') setView('launchpad');
    if (name === 'PAUSE_INPUT') setPaused(x => !x);
    if (name === 'RECALIBRATE') { faceCenter.current = lastFace.current ? {...lastFace.current} : null; dwellRef.current = null; setDwell(null); setStatus(faceCenter.current ? 'Head center saved. Move gently to aim.' : 'Show your face, then recalibrate.'); }
  }, []);
  const commandRef = useRef(command); commandRef.current = command;

  // A tiny generated tone means the audio demo works without external media or network.
  useEffect(() => {
    if (playing) {
      try {
        const context = new AudioContext();
        const oscillator = context.createOscillator(), gain = context.createGain();
        oscillator.type = 'sine'; oscillator.frequency.value = 220;
        gain.gain.value = .025;
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(); audioRef.current = {context, oscillator, gain};
      } catch { setStatus('Audio unavailable. Visual playback controls still work.'); }
    } else if (audioRef.current) {
      const {context, oscillator} = audioRef.current;
      oscillator.stop(); void context.close(); audioRef.current = null;
    }
    return () => { if (audioRef.current) { audioRef.current.oscillator.stop(); void audioRef.current.context.close(); audioRef.current = null; } };
  }, [playing]);

  function activateAt(x: number, y: number) {
    const target = document.elementFromPoint(x * innerWidth, y * innerHeight)?.closest<HTMLElement>('[data-command]');
    if (!target || target.hasAttribute('disabled')) return null;
    target.click();
    return target.dataset.command || null;
  }
  function processFrame(r: Detection) {
    const now = performance.now();
    if (now - lastUiUpdate.current > 110) {
      setSignal(r.found ? r.label : 'Tracking lost');
      lastUiUpdate.current = now;
    }
    if (!r.found || r.x === undefined || r.y === undefined) {
      dwellRef.current = null; smoothed.current = null; setDwell(null); setCursor(null);
      desktopDwell.current = null;
      gestureRef.current.pinchStart = 0; gestureRef.current.pinchFired = false;
      gestureRef.current.palmStart = 0; gestureRef.current.palmFired = false;
      return;
    }
    let point = {x:r.x, y:r.y};
    if (modeRef.current === 'head') {
      lastFace.current = point;
      if (!faceCenter.current) {
        faceCenter.current = {...point};
        setStatus('Head center saved automatically. Move gently to aim.');
      }
      const center = faceCenter.current;
      const dx = point.x - center.x, dy = point.y - center.y;
      const dead = .012;
      point = {
        x: clamp(.5 + (Math.abs(dx) < dead ? 0 : dx - Math.sign(dx)*dead) * settingsRef.current.sensitivity),
        y: clamp(.5 + (Math.abs(dy) < dead ? 0 : dy - Math.sign(dy)*dead) * settingsRef.current.sensitivity)
      };
    }
    const prev = smoothed.current;
    smoothed.current = prev ? {x:prev.x*.58 + point.x*.42, y:prev.y*.58 + point.y*.42} : point;
    const at = smoothed.current;
    setCursor(at);
    if (desktopRef.current.active && !pausedRef.current) window.desktop?.move(at.x, at.y);
    if (modeRef.current === 'hand') {
      if (r.openPalm) {
        if (!gestureRef.current.palmStart) gestureRef.current.palmStart = now;
        if (!gestureRef.current.palmFired && now - gestureRef.current.palmStart > 750) {
          if (desktopRef.current.overlay) {
            void (desktopRef.current.active ? window.desktop?.pause() : window.desktop?.resume());
          } else commandRef.current('PAUSE_INPUT');
          gestureRef.current.palmFired = true;
          gestureRef.current.lastAction = now;
        }
      } else { gestureRef.current.palmStart = 0; gestureRef.current.palmFired = false; }
      if (!r.pinch || pausedRef.current || (desktopRef.current.overlay && !desktopRef.current.active)) { gestureRef.current.pinchStart = 0; gestureRef.current.pinchFired = false; return; }
      if (!gestureRef.current.pinchStart) gestureRef.current.pinchStart = now;
      if (!gestureRef.current.pinchFired && now - gestureRef.current.pinchStart > 300 && now - gestureRef.current.lastAction > 650) {
        if (desktopRef.current.active) {
          window.desktop?.click(); setLastCommand('WINDOWS CLICK'); setActionCount(x=>x+1); gestureRef.current.lastAction = now;
        } else if (activateAt(at.x, at.y)) gestureRef.current.lastAction = now;
        gestureRef.current.pinchFired = true;
      }
    }
    if (modeRef.current === 'head') {
      if (desktopRef.current.overlay) {
        if (pausedRef.current) {desktopDwell.current=null; setDwell(null); return;}
        if (!desktopArmed.current) {
          if (!desktopOrigin.current) desktopOrigin.current={...at};
          if (Math.hypot(at.x-desktopOrigin.current.x,at.y-desktopOrigin.current.y)<.05) {
            setDwell(null); return;
          }
          desktopArmed.current=true;
        }
        const previous=desktopDwell.current;
        if (!previous || Math.hypot(at.x-previous.x,at.y-previous.y)>.03)
          desktopDwell.current={x:at.x,y:at.y,start:now,fired:false};
        const state=desktopDwell.current!;
        const isCorner=at.x<.07 && at.y<.1;
        const scrollUp=at.x>.93 && at.y<.1;
        const scrollDown=at.x>.93 && at.y>.9;
        const pauseCorner=at.x<.07 && at.y>.9;
        if (!desktopRef.current.active && !isCorner && !scrollUp) {desktopDwell.current=null; setDwell(null); return;}
        const duration=(isCorner || pauseCorner || (!desktopRef.current.active && scrollUp)) ? settingsRef.current.dwellMs*1.5 : settingsRef.current.dwellMs;
        const progress=clamp((now-state.start)/duration);
        setDwell({id:isCorner?'STOP':!desktopRef.current.active?'RESUME':pauseCorner?'PAUSE':scrollUp?'SCROLL UP':scrollDown?'SCROLL DOWN':'CLICK',progress});
        if (progress>=1 && !state.fired) {
          state.fired=true;
          if (isCorner) {void window.desktop?.stop(); setLastCommand('STOP WINDOWS CONTROL');}
          else if (!desktopRef.current.active) {void window.desktop?.resume(); setLastCommand('RESUME WINDOWS CONTROL');}
          else if (pauseCorner) {void window.desktop?.pause(); setLastCommand('PAUSE WINDOWS CONTROL');}
          else if (scrollUp || scrollDown) {
            window.desktop?.wheel(scrollUp?120:-120); setLastCommand(scrollUp?'SCROLL UP':'SCROLL DOWN');
            setActionCount(x=>x+1);
          } else {window.desktop?.click(); setLastCommand('WINDOWS CLICK'); setActionCount(x=>x+1);}
        }
        return;
      }
      const target = document.elementFromPoint(at.x * innerWidth, at.y * innerHeight)?.closest<HTMLElement>('[data-command]');
      const id = target?.dataset.command || '';
      if (!id || (pausedRef.current && id !== 'PAUSE_INPUT')) { dwellRef.current = null; setDwell(null); return; }
      if (!dwellRef.current || dwellRef.current.id !== id) dwellRef.current = {id, start:now, fired:false};
      const state = dwellRef.current;
      const progress = clamp((now - state.start) / settingsRef.current.dwellMs);
      setDwell({id, progress});
      if (progress >= 1 && !state.fired) {
        state.fired = true; target?.click();
      }
    }
  }

  async function startCamera(next: CameraMode) {
    const version = ++sessionVersion.current;
    sessionRef.current?.stop(); sessionRef.current = null;
    setCameraOn(false); setLoading(true); setError(''); setMode(next); setPaused(false);
    faceCenter.current = null; smoothed.current = null; dwellRef.current = null; setCursor(null); setDwell(null);
    try {
      if (!videoRef.current) throw new Error('Video element unavailable.');
      const session = await startVision(next, videoRef.current, processFrame, (cause) => {
        if (version !== sessionVersion.current) return;
        sessionRef.current = null;
        setCameraOn(false); setCursor(null); setDwell(null);
        setError('Vision processing stopped: ' + cause.message);
        setStatus('Switch to keyboard or one-key scanning, then check your browser graphics support.');
        setMode('keyboard');
      });
      if (version !== sessionVersion.current) { session.stop(); return; }
      sessionRef.current = session;
      setCameraOn(true); setStatus(next === 'hand' ? 'Show a hand. Aim with your index finger and pinch to select.' : 'Face the camera. Your neutral position will be saved automatically.');
    } catch (e) {
      if (version !== sessionVersion.current) return;
      const message = e instanceof Error ? e.message : String(e);
      setError('Camera could not start: ' + message);
      setStatus('Use keyboard or scanning while you check camera permission.');
      setMode('keyboard');
    } finally { if (version === sessionVersion.current) setLoading(false); }
  }
  function switchMode(next: Mode) {
    if (desktopRef.current.active) void window.desktop?.stop();
    ++sessionVersion.current;
    sessionRef.current?.stop(); sessionRef.current = null; setCameraOn(false); setError('');
    setCursor(null); setDwell(null); setPaused(false); setMode(next);
    setStatus(next === 'scan' ? 'Focus moves automatically. Press Space to select.' : 'Use Tab to focus and Enter to activate.');
  }
  useEffect(() => () => { ++sessionVersion.current; sessionRef.current?.stop(); if (audioRef.current) {audioRef.current.oscillator.stop(); void audioRef.current.context.close();} }, []);

  useEffect(() => {
    if (mode !== 'scan') return;
    const targets = () => [...document.querySelectorAll<HTMLElement>('[data-command]')].filter(el => el.offsetParent !== null && !el.hasAttribute('disabled'));
    let index = -1;
    let highlighted: HTMLElement | undefined;
    const timer = window.setInterval(() => {
      const all = targets(); if (!all.length) return;
      highlighted?.classList.remove('scanning');
      index = (index + 1) % all.length;
      highlighted = all[index];
      highlighted.classList.add('scanning');
      highlighted.scrollIntoView({block:'nearest', inline:'nearest'});
    }, 1150);
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return;
      event.preventDefault();
      highlighted?.click();
    };
    window.addEventListener('keydown', onKey);
    return () => { clearInterval(timer); highlighted?.classList.remove('scanning'); window.removeEventListener('keydown', onKey); };
  }, [mode, view]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); if (pausedRef.current) commandRef.current('PAUSE_INPUT'); else switchMode('keyboard'); }
      if (e.code === 'Space' && modeRef.current === 'keyboard' && document.activeElement === document.body) { e.preventDefault(); switchMode('scan'); }
      if (e.altKey && e.code === 'ArrowRight') { e.preventDefault(); commandRef.current('NEXT_SLIDE'); }
      if (e.altKey && e.code === 'ArrowLeft') { e.preventDefault(); commandRef.current('PREV_SLIDE'); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  const current = slides[slide];
  async function startDesktop() {
    if (!window.desktop) return;
    setDesktopError('');
    if (!cameraOn || (mode!=='head' && mode!=='hand')) {setDesktopError('Start hand or head camera mode first.'); return;}
    const result=await window.desktop.start();
    if (!result.ok) setDesktopError(result.reason || 'Windows control could not start.');
    else {desktopDwell.current=null; desktopOrigin.current=smoothed.current ? {...smoothed.current} : null; desktopArmed.current=false; setStatus('Controlling Windows. Move away from center to begin. Hold at top left to stop.');}
  }
  return <CommandContext.Provider value={command}><div className={'app '+(desktopState.overlay?'desktop-active':'')}>
    {desktopState.overlay && <div className="overlay-message"><strong>{desktopState.active?'OpenInput controls Windows':'Pointer control paused'}</strong><span>{desktopState.active?(mode==='head'?'Aim with your head · hold to click':'Aim with your hand · pinch to click'):(desktopState.pausedReason==='keyboard'?'Keyboard detected. Type normally.':'Your pointer is free to use.')}</span><small>Head: top-left stop · bottom-left pause · top-right resume/scroll</small><small>Ctrl+Shift+Space pause/resume · Ctrl+Shift+O or tray opens controls</small><b>{!desktopState.active?'PAUSED':paused?'PAUSED':dwell?dwell.id+' '+Math.round(dwell.progress*100)+'%':'TRACKING'}</b></div>}
    <header><div className="brand"><span className="brand-mark">◉</span><div><strong>OpenInput</strong><small>Human movement, your way</small></div></div>
      <div className="header-right"><span className={'live-dot '+(cameraOn?'active':'')}/>{cameraOn?'VISION LIVE':'CAMERA OFF'}<span className="header-divider"/><span>HACKATHON DEMO</span></div></header>
    <main>
      <aside className="sidebar">
        <div className="eyebrow">INPUT STUDIO</div>
        <h1>Control on<br/><em>your terms.</em></h1>
        <p className="intro">Choose an input. The actions stay the same.</p>
        <div className="section-label">CHOOSE YOUR MODE</div>
        <div className="mode-list">
          <button data-command="SWITCH_HAND" className={'mode-card '+(mode==='hand'?'selected':'')} onClick={() => void startCamera('hand')} aria-pressed={mode==='hand'}><span className="mode-icon">↗</span><span><strong>Hand gestures</strong><small>Point · pinch · pause</small></span><span className="mode-arrow">↗</span></button>
          <button data-command="SWITCH_HEAD" className={'mode-card '+(mode==='head'?'selected':'')} onClick={() => void startCamera('head')} aria-pressed={mode==='head'}><span className="mode-icon">◌</span><span><strong>Head + dwell</strong><small>No hands needed</small></span><span className="mode-arrow">↗</span></button>
          <button data-command="SWITCH_SCAN" className={'mode-card '+(mode==='scan'?'selected':'')} onClick={() => switchMode('scan')} aria-pressed={mode==='scan'}><span className="mode-icon">⇥</span><span><strong>One-key scanning</strong><small>Space selects focused target</small></span><span className="mode-arrow">↗</span></button>
          <button data-command="SWITCH_KEYBOARD" className={'mode-card '+(mode==='keyboard'?'selected':'')} onClick={() => switchMode('keyboard')} aria-pressed={mode==='keyboard'}><span className="mode-icon">⌨</span><span><strong>Keyboard</strong><small>Tab + Enter</small></span><span className="mode-arrow">↗</span></button>
        </div>
        <div className="section-label settings-label">MAKE IT YOURS</div>
        <label className="range-row"><span>Sensitivity <b>{settings.sensitivity.toFixed(1)}×</b></span><input aria-label="Head movement sensitivity" type="range" min="2.5" max="10" step=".5" value={settings.sensitivity} onChange={e=>setSettings({...settings,sensitivity:Number(e.target.value)})}/></label>
        <label className="range-row"><span>Dwell time <b>{(settings.dwellMs/1000).toFixed(1)}s</b></span><input aria-label="Dwell selection time" type="range" min="700" max="2800" step="100" value={settings.dwellMs} onChange={e=>setSettings({...settings,dwellMs:Number(e.target.value)})}/></label>
        <div className="side-actions"><Action name="RECALIBRATE" className="text-button">Recenter head</Action><button className="text-button" onClick={()=>setSettings(defaultSettings)}>Reset settings</button></div>
        <p className="hint">Camera stays on this device. All controls also work with a keyboard.</p>
      </aside>
      <section className="workspace">
        <div className="workspace-top"><div><span className="eyebrow">INTERACTIVE WORKSPACE</span><h2>Same actions. Different inputs.</h2></div><div className="task-counter"><strong>{actionCount}</strong><span>actions<br/>completed</span></div></div>
        <nav className="tabs" aria-label="Demo applications"><Action name="SHOW_SLIDES" className={view==='slides'?'tab active':'tab'}>▧ &nbsp; Presentation</Action><Action name="SHOW_SOUND" className={view==='sound'?'tab active':'tab'}>♫ &nbsp; Sound studio</Action><Action name="SHOW_LAUNCHPAD" className={view==='launchpad'?'tab active':'tab'}>⊞ &nbsp; Launchpad</Action></nav>
        {view==='slides' && <div className={'slide-card '+current.color}><div className="slide-top"><span>{current.label}</span><span>OPENINPUT / DEMO</span></div><div className="slide-copy"><span className="slide-accent">✳</span><h3>{current.title}</h3><p>{current.body}</p></div><div className="slide-bottom"><span>DESIGNED FOR DIFFERENT WAYS OF MOVING</span><span>0{slide+1} / 03</span></div></div>}
        {view==='sound' && <div className="experience sound"><div className="sound-art"><div className={'record '+(playing?'spinning':'')}><span>◉</span></div></div><div><span className="eyebrow">SOUND STUDIO</span><h3>Ambient tone</h3><p>Generate a gentle tone directly on your laptop. Select the button below with any input mode.</p><Action name="TOGGLE_PLAY" className="primary-action">{playing?'❚❚  Pause sound':'▶  Play sound'}</Action></div></div>}
        {view==='launchpad' && <div className="experience launchpad"><span className="eyebrow">QUICK ACTIONS</span><h3>Pick what happens next.</h3><p>These large targets are intentionally easy to focus and select.</p><div className="launch-grid"><Action name="SHOW_SLIDES">▧<strong>Open slides</strong><small>Show the presentation</small></Action><Action name="SHOW_SOUND">♫<strong>Open sound</strong><small>Control audio</small></Action><Action name="NEXT_SLIDE">→<strong>Next slide</strong><small>Advance the story</small></Action></div></div>}
        <div className="control-bar"><Action name="PREV_SLIDE" className="control-button">← &nbsp; Previous</Action><div className="control-center">{view==='slides'?'PRESENTATION CONTROL':'UNIVERSAL COMMANDS'}</div><Action name="NEXT_SLIDE" className="control-button">Next &nbsp; →</Action></div>
        <div className="status-strip" role="status" aria-live="polite"><div><span className="status-caption">SYSTEM STATUS</span><strong>{loading?'Loading vision models…':error || status}</strong></div><div className="status-actions">{mode==='head' && <button data-command="EXIT_HEAD" className="pause" onClick={()=>switchMode('keyboard')}>Exit head mode</button>}<Action name="PAUSE_INPUT" className={'pause '+(paused?'paused':'')}>{paused?'Resume control':'Pause control'}</Action></div></div>
        {window.desktop && <div className="desktop-launch"><div><strong>Control Windows itself</strong><small>Move and click in other apps using the selected camera input.</small>{desktopError && <small className="desktop-error">{desktopError}</small>}</div><button data-command="START_DESKTOP" onClick={()=>void (desktopState.active?window.desktop?.stop():startDesktop())} disabled={!cameraOn && !desktopState.active}>{desktopState.active?'Stop Windows control':'Start Windows control'}</button></div>}
      </section>
      <aside className="telemetry">
        <div className="eyebrow">LIVE INPUT</div><h2>See what the<br/>system sees.</h2>
        <div className="camera-box"><video ref={videoRef} autoPlay muted playsInline aria-label="Webcam preview"/>{!cameraOn && <div className="camera-placeholder"><span>◎</span><strong>{loading?'Loading model…':'Camera preview'}</strong><small>Choose hand or head mode to start</small></div>}<span className="camera-label">{cameraOn?'● LIVE CAMERA':'○ CAMERA OFF'}</span></div>
        <div className="telemetry-row"><span>INPUT MODE</span><strong>{mode==='head'?'HEAD + DWELL':mode==='hand'?'HAND GESTURES':mode==='scan'?'ONE-KEY SCAN':'KEYBOARD'}</strong></div>
        <div className="telemetry-row"><span>DETECTED SIGNAL</span><strong>{cameraOn?signal:mode==='scan'?'Scanning targets':'Waiting for input'}</strong></div>
        <div className="telemetry-row"><span>LAST ACTION</span><strong>{lastCommand}</strong></div>
        <div className="dwell-box"><div><span>SELECTION PROGRESS</span><strong>{dwell?Math.round(dwell.progress*100)+'%':'—'}</strong></div><div className="progress-track"><div style={{width:(dwell?.progress||0)*100+'%'}}/></div><small>{mode==='head'?'Hold over a control to select it.':mode==='scan'?'Wait for the highlight, then press Space.':'Use your chosen input to select.'}</small></div>
        <div className="howto"><span className="eyebrow">QUICK GUIDE</span><p>{mode==='hand'?'Move your index finger to aim. Pinch and hold briefly to select. Hold an open palm to pause or resume.':mode==='head'?'Face the camera for automatic centering. Move your head gently to aim. Hold on a button until the ring completes.':mode==='scan'?'The highlight moves between buttons. Press Space once to activate the highlighted one.':'Use Tab and Enter, or choose a camera mode. Press Space on the page to start one-key scanning.'}</p></div>
      </aside>
    </main>
    {cursor && cameraOn && !desktopState.overlay && <div className={'vision-cursor '+(paused?'cursor-paused':'')} style={{left:cursor.x*100+'%',top:cursor.y*100+'%'}} aria-hidden="true"><div className="cursor-inner"/>{dwell && <svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" className="ring-bg"/><circle cx="24" cy="24" r="20" className="ring-progress" style={{strokeDashoffset:125.7*(1-dwell.progress)}}/></svg>}</div>}
  </div></CommandContext.Provider>;
}

createRoot(document.getElementById('root')!).render(<App/>);
