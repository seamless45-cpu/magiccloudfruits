import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent, type AnimationEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Game, PRESETS, defaultSettings } from './game/Game';
import type { GraphicsSettings } from './game/types';
import type { UiSoundKind } from './game/audio';
import { SkillBar } from './ui/SkillBar';
import { Inventory, Settings, MobileControls, ZoomControl } from './ui/Panels';
import { UpdateLog } from './ui/UpdateLog';

type Snap = ReturnType<Game['snapshot']>;
type BeforeInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};
const fmt = (n: number) => (n >= 1e12 ? (n / 1e12).toFixed(2) + 'T' : n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : n.toFixed(0));
const reportBoot = (progress: number, phase: string, message: string) => {
  (window as any).__arenaBootUpdate?.(progress, phase, message);
};

/** `?safe=1` starts with minimal graphics: a heavy preset can stall or fail to boot on weak GPUs. */
const safeSettings = (): GraphicsSettings => ({ ...defaultSettings(), ...PRESETS.low, preset: 'low' });

/** Stored settings are user-writable, so validate everything: NaN/out-of-range values would
 *  otherwise be passed straight into pixel ratio, camera planes and shadow map sizes. */
const clampSettings = (raw: unknown): GraphicsSettings => {
  const d = defaultSettings();
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<GraphicsSettings>;
  const num = (v: unknown, lo: number, hi: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  const preset = (['low', 'medium', 'high', 'ultra'] as const).includes(s.preset as GraphicsSettings['preset'])
    ? (s.preset as GraphicsSettings['preset']) : d.preset;
  return {
    preset,
    sandbox: bool(s.sandbox, d.sandbox),
    resolution: num(s.resolution, 0.4, 1.5, d.resolution),
    shadows: bool(s.shadows, d.shadows),
    shadowRes: [512, 1024, 2048, 4096].includes(s.shadowRes as number) ? (s.shadowRes as number) : d.shadowRes,
    bloom: bool(s.bloom, d.bloom),
    bloomStrength: num(s.bloomStrength, 0, 2.5, d.bloomStrength),
    particles: num(s.particles, 0.1, 1, d.particles),
    debris: num(s.debris, 0.1, 1, d.debris),
    maxBolts: num(s.maxBolts, 20, 500, d.maxBolts),
    fog: bool(s.fog, d.fog),
    exposure: num(s.exposure, 0.5, 2, d.exposure),
    shake: num(s.shake, 0, 2, d.shake),
    positionShake: bool(s.positionShake, d.positionShake),
    rotationShake: bool(s.rotationShake, d.rotationShake),
    showFps: bool(s.showFps, d.showFps),
    antialiasFxaa: bool(s.antialiasFxaa, d.antialiasFxaa),
    frameInterpolation: bool(s.frameInterpolation, d.frameInterpolation),
    frameInterpolationMethod: s.frameInterpolationMethod === 'frameHold' ? 'frameHold' : 'linear',
    motionBlur: bool(s.motionBlur, d.motionBlur),
    motionBlurStrength: num(s.motionBlurStrength, 0.4, 0.86, d.motionBlurStrength),
    lightningSegments: num(s.lightningSegments, 6, 48, d.lightningSegments),
    lightningRealignInterval: num(s.lightningRealignInterval, 0.005, 0.1, d.lightningRealignInterval),
    lightningJitter: num(s.lightningJitter, 0, 2.5, d.lightningJitter),
    lightningBranches: num(s.lightningBranches, 0, 6, d.lightningBranches),
    lightningJaggedness: num(s.lightningJaggedness, 0.1, 3, d.lightningJaggedness),
    lightningWidth: num(s.lightningWidth, 0.4, 2.5, d.lightningWidth),
    lightningHeight: num(s.lightningHeight, 0.5, 2.5, d.lightningHeight),
    lightningImpactEffects: bool(s.lightningImpactEffects, d.lightningImpactEffects),
    lightningImpactScale: num(s.lightningImpactScale, 0.5, 2.5, d.lightningImpactScale),
    drawDistance: num(s.drawDistance, 1000, 60000, d.drawDistance),
    clouds: num(s.clouds, 0.3, 1.5, d.clouds),
  };
};

/** Weak devices (few cores / little memory) start on a lighter preset so booting stays quick. */
const devicePreset = (): GraphicsSettings => {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const weak = (nav.hardwareConcurrency || 8) <= 4 || (nav.deviceMemory !== undefined && nav.deviceMemory <= 4);
  return weak ? { ...defaultSettings(), ...PRESETS.medium, preset: 'medium' } : defaultSettings();
};

/** Safe mode is reachable by path (`/safe`) as well as by query, because a proxy that
 *  strips query strings would otherwise make the escape hatch unreachable. */
const safeRequested = () => {
  const p = location.pathname.replace(/\/+$/, '');
  return p.endsWith('/safe') || p.endsWith('/arena') || new URLSearchParams(location.search).has('safe');
};

const UPDATE_LOG_VERSION = '1.5.8';
const initialUpdateLogVisibility = () => {
  try { return localStorage.getItem('f1090seenUpdateLog') !== UPDATE_LOG_VERSION; }
  catch { return true; }
};

const initialSettings = (): GraphicsSettings => {
  try {
    if (safeRequested()) return safeSettings();
    const stored = localStorage.getItem('f1090gfx');
    return stored ? clampSettings(JSON.parse(stored)) : devicePreset();
  } catch {
    return defaultSettings();
  }
};

const initialMasterVolume = () => {
  try {
    const stored = localStorage.getItem('f1090masterVolume');
    if (stored === null) return 1;
    const value = Number(stored);
    return Number.isFinite(value) ? Math.max(0, Math.min(2, value)) : 1;
  } catch { return 1; }
};

export default function App() {
  const host = useRef<HTMLDivElement>(null); const overlay = useRef<HTMLDivElement>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [snap, setSnap] = useState<Snap | null>(null);
  const [settings, setSettings] = useState<GraphicsSettings>(initialSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [closingSettings, setClosingSettings] = useState(false);
  const [showUpdates, setShowUpdates] = useState(initialUpdateLogVisibility);
  const [releaseNotesUnseen, setReleaseNotesUnseen] = useState(initialUpdateLogVisibility);
  const [closingUpdates, setClosingUpdates] = useState(false);
  const [showTitle, setShowTitle] = useState(true);
  const [leavingTitle, setLeavingTitle] = useState(false);
  const [showGui, setShowGui] = useState(true);
  const [guiClosing, setGuiClosing] = useState(false);
  const [help, setHelp] = useState(true);
  const [helpClosing, setHelpClosing] = useState(false);
  const [showMenuControls, setShowMenuControls] = useState(false);
  const settingsOpenRef = useRef(showSettings); settingsOpenRef.current = showSettings;
  const settingsClosingRef = useRef(closingSettings); settingsClosingRef.current = closingSettings;
  const helpOpenRef = useRef(help); helpOpenRef.current = help;
  const helpClosingRef = useRef(helpClosing); helpClosingRef.current = helpClosing;
  const [showTelemetry, setShowTelemetry] = useState(true);
  const [closingTelemetry, setClosingTelemetry] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; m: string; c: string; leaving: boolean }[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(() => !!document.fullscreenElement || !!(document as any).webkitFullscreenElement);
  const [fullscreenError, setFullscreenError] = useState('');
  const [musicName, setMusicName] = useState('');
  const [masterVolume, setMasterVolumeValue] = useState<number>(initialMasterVolume);
  const [musicVolume, setMusicVolumeValue] = useState(0.35);
  const [musicRate, setMusicRateValue] = useState(1);
  const [musicDuration, setMusicDuration] = useState(0);
  const [musicTrimStart, setMusicTrimStartValue] = useState(0);
  const [musicTrimEnd, setMusicTrimEndValue] = useState(0);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [musicError, setMusicError] = useState('');
  const [installPromptReady, setInstallPromptReady] = useState(false);
  const [appInstalled, setAppInstalled] = useState(false);
  const [installMessage, setInstallMessage] = useState('');
  const installPrompt = useRef<BeforeInstallPrompt | null>(null);
  const lastControlSoundAt = useRef(0);
  const musicRequestId = useRef(0);
  const toggleSound = () => { const next=!soundEnabled; if (!next) game?.audio.uiSound('toggle'); game?.audio.setEnabled(next); setSoundEnabled(next); if (next) game?.audio.uiSound('toggle'); };
  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || !!(navigator as Navigator & { standalone?: boolean }).standalone;
    setAppInstalled(isStandalone);
    const onBeforeInstallPrompt = (event: Event) => {
      const installEvent = event as BeforeInstallPrompt;
      if (typeof installEvent.prompt !== 'function') return;
      event.preventDefault();
      installPrompt.current = installEvent;
      (window as any).__magicCloudInstallPrompt = installEvent;
      setInstallPromptReady(true);
    };
    const onAppInstalled = () => {
      installPrompt.current = null;
      (window as any).__magicCloudInstallPrompt = null;
      setInstallPromptReady(false);
      setAppInstalled(true);
      setInstallMessage('MagicCloud is installed. Launch it from your apps any time.');
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt as EventListener);
    window.addEventListener('appinstalled', onAppInstalled);
    const earlyInstallPrompt = (window as any).__magicCloudInstallPrompt as BeforeInstallPrompt | null;
    if (!isStandalone && earlyInstallPrompt && typeof earlyInstallPrompt.prompt === 'function') {
      installPrompt.current = earlyInstallPrompt;
      setInstallPromptReady(true);
    }

    const localSecureHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    const viteDevEntry = !!document.querySelector('script[src*="/src/main.tsx"]');
    if (!viteDevEntry && 'serviceWorker' in navigator && (window.isSecureContext || localSecureHost)) {
      const workerUrl = new URL('./sw.js', window.location.href);
      const scopeUrl = new URL('./', window.location.href);
      navigator.serviceWorker.register(workerUrl, { scope: scopeUrl.pathname })
        .catch(error => console.info('[MagicCloud] Offline support is unavailable on this origin.', error));
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt as EventListener);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);
  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(!!document.fullscreenElement || !!(document as any).webkitFullscreenElement);
    document.addEventListener('fullscreenchange', syncFullscreen);
    document.addEventListener('webkitfullscreenchange', syncFullscreen as EventListener);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen);
      document.removeEventListener('webkitfullscreenchange', syncFullscreen as EventListener);
    };
  }, []);
  const toggleFullscreen = async () => {
    try {
      const doc = document as any;
      if (doc.fullscreenElement || doc.webkitFullscreenElement) {
        const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
        if (!exit) throw new Error('Fullscreen exit is unavailable.');
        await exit.call(doc);
      } else {
        const root = document.documentElement as any;
        const enter = root.requestFullscreen ?? root.webkitRequestFullscreen;
        if (!enter) throw new Error('Fullscreen is not supported by this browser.');
        await enter.call(root);
      }
      setFullscreenError('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fullscreen could not be changed.';
      setFullscreenError(message);
      game?.toast('FULLSCREEN UNAVAILABLE — CONTINUING WINDOWED', '#ffd28b');
    }
  };
  const loadMusicFile = (file: File) => {
    if (!game) { setMusicError('Audio engine is still starting. Try again in a moment.'); return; }
    const supported = file.type.startsWith('audio/') || file.type.startsWith('video/') || /\.(mp3|wav|ogg|opus|flac|aac|m4a|aiff?|mp4|m4v|webm|mov|ogv|mkv|avi)$/i.test(file.name);
    if (!supported) { setMusicError('Choose an audio file or a video containing an audio track.'); return; }
    const requestId = ++musicRequestId.current;
    setMusicError(''); setMusicName(''); setMusicPlaying(false); setMusicDuration(0); setMusicTrimStartValue(0); setMusicTrimEndValue(0);
    game.audio.loadMusic(file).then(duration => {
      if (requestId !== musicRequestId.current) return;
      setMusicName(file.name); setMusicDuration(duration); setMusicTrimStartValue(0); setMusicTrimEndValue(duration); setMusicPlaying(true);
    }).catch(error => {
      if (requestId === musicRequestId.current) setMusicError(error instanceof Error ? error.message : 'This media file could not be played.');
    });
  };
  const changeMasterVolume = (value: number) => {
    const next = Math.max(0, Math.min(2, Number.isFinite(value) ? value : 1));
    setMasterVolumeValue(next); game?.audio.setMasterVolume(next);
    try { localStorage.setItem('f1090masterVolume', String(next)); } catch { /* optional preference persistence */ }
  };
  const changeMusicVolume = (value: number) => { const next = Math.max(0, Math.min(1, value)); setMusicVolumeValue(next); game?.audio.setMusicVolume(next); };
  useEffect(() => { game?.audio.setMasterVolume(masterVolume); }, [game, masterVolume]);
  const changeMusicRate = (value: number) => { const next = Math.max(0.5, Math.min(1.5, value)); setMusicRateValue(next); game?.audio.setMusicPlaybackRate(next); };
  const changeMusicTrimStart = (value: number) => {
    const start = Math.max(0, Math.min(musicDuration - 0.1, Math.round(value * 10) / 10));
    const trim = game?.audio.setMusicTrim(start, Math.max(start + 0.1, musicTrimEnd));
    setMusicTrimStartValue(trim?.start ?? start); setMusicTrimEndValue(trim?.end ?? musicTrimEnd);
  };
  const changeMusicTrimEnd = (value: number) => {
    const end = Math.max(musicTrimStart + 0.1, Math.min(musicDuration, Math.round(value * 10) / 10));
    const trim = game?.audio.setMusicTrim(musicTrimStart, end);
    setMusicTrimStartValue(trim?.start ?? musicTrimStart); setMusicTrimEndValue(trim?.end ?? end);
  };
  const toggleMusic = async () => {
    if (!game || !musicName) return;
    try { setMusicPlaying(await game.audio.toggleMusic()); setMusicError(''); }
    catch (error) { setMusicError(error instanceof Error ? error.message : 'Playback could not be changed.'); }
  };
  const enterArena = () => {
    if (!game || leavingTitle) return;
    // Fullscreen is user-gesture gated by browsers, so request it on the deployment click.
    // A denial is non-fatal: continue into the arena in a normal window.
    if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) void toggleFullscreen();
    game.audio.unlock(); game.audio.setArenaMode(true); game.paused = false; setLeavingTitle(true);
  };
  const installApp = async () => {
    setInstallMessage('');
    if (appInstalled) return;
    const promptEvent = installPrompt.current;
    if (!promptEvent) {
      const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
      setInstallMessage(isIos
        ? 'On iPhone or iPad: open Share, then choose “Add to Home Screen”.'
        : 'In Chrome, open ⋮ and choose “Install MagicCloud” (or “Install page as app”).');
      return;
    }
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      setInstallMessage(choice.outcome === 'accepted'
        ? 'Install accepted. MagicCloud will appear in your apps.'
        : 'Install dismissed. You can install later from the browser menu.');
      if (choice.outcome === 'accepted') setAppInstalled(true);
    } catch (error) {
      console.info('[MagicCloud] The browser install prompt could not be opened.', error);
      setInstallMessage('Open the browser menu and choose “Install MagicCloud” to add the app.');
    } finally {
      installPrompt.current = null;
      (window as any).__magicCloudInstallPrompt = null;
      setInstallPromptReady(false);
    }
  };
  const onUiClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    const button = (e.target as HTMLElement).closest('button');
    if (!button || button.disabled || button.dataset.uiSound === 'none') return;
    game?.audio.uiSound((button.dataset.uiSound as UiSoundKind | undefined) ?? 'click');
  };
  const onUiChangeCapture = (e: ChangeEvent<HTMLDivElement>) => {
    const control = e.target;
    if (control instanceof HTMLInputElement && control.type === 'range') {
      const now = performance.now();
      if (now - lastControlSoundAt.current < 85) return;
      lastControlSoundAt.current = now;
      game?.audio.uiSound('slider');
    } else if (control instanceof HTMLInputElement && control.type === 'file') {
      game?.audio.uiSound('open');
    } else if (control instanceof HTMLSelectElement) {
      game?.audio.uiSound('toggle');
    }
  };
  const openSettings = () => { setClosingSettings(false); setShowSettings(true); };
  const closeSettings = () => { if (showSettings) setClosingSettings(true); };
  const finishSettingsClose = () => { setShowSettings(false); setClosingSettings(false); };
  const openUpdates = () => { setClosingUpdates(false); setShowUpdates(true); };
  const closeUpdates = () => { if (showUpdates) setClosingUpdates(true); };
  const finishUpdatesClose = () => {
    setShowUpdates(false); setClosingUpdates(false); setReleaseNotesUnseen(false);
    try { localStorage.setItem('f1090seenUpdateLog', UPDATE_LOG_VERSION); } catch { /* optional release-note preference */ }
  };
  const toggleHelp = () => { if (help && !helpClosing) setHelpClosing(true); else { setHelpClosing(false); setHelp(true); } };
  const toggleMenuControls = () => setShowMenuControls(value => !value);
  const toggleGui = () => { if (showGui) { setGuiClosing(true); if (showSettings) closeSettings(); } else { setShowGui(true); setGuiClosing(false); } };
  const onGuiCloseAnimationEnd = (e: AnimationEvent<HTMLDivElement>) => { if (e.target === e.currentTarget && guiClosing) { setShowGui(false); setGuiClosing(false); } };
  const toggleTelemetry = () => {
    if (showTelemetry) setClosingTelemetry(value => !value);
    else { setClosingTelemetry(false); setShowTelemetry(true); }
  };
  const onTelemetryAnimationEnd = (e: AnimationEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && closingTelemetry && e.animationName === 'ui-panel-retract') {
      setShowTelemetry(false); setClosingTelemetry(false);
    }
  };
  const moveMenuCard = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = Math.max(-0.5, Math.min(0.5, (e.clientX - box.left) / box.width - 0.5));
    const y = Math.max(-0.5, Math.min(0.5, (e.clientY - box.top) / box.height - 0.5));
    e.currentTarget.style.setProperty('--menu-tilt-x', `${(x * 3.2).toFixed(2)}deg`);
    e.currentTarget.style.setProperty('--menu-tilt-y', `${(-y * 3.2).toFixed(2)}deg`);
    e.currentTarget.style.setProperty('--menu-glow-x', `${((x + 0.5) * 100).toFixed(1)}%`);
    e.currentTarget.style.setProperty('--menu-glow-y', `${((y + 0.5) * 100).toFixed(1)}%`);
  };
  const resetMenuCard = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.style.setProperty('--menu-tilt-x', '0deg');
    e.currentTarget.style.setProperty('--menu-tilt-y', '0deg');
    e.currentTarget.style.setProperty('--menu-glow-x', '50%');
    e.currentTarget.style.setProperty('--menu-glow-y', '50%');
  };

  useEffect(() => {
    // Keep the HTML safety loader in place until Game reports its first successful render.
    // This makes the hand-off reflect a real renderer milestone rather than React mounting.
    const boot = document.getElementById('boot');
    if (!boot) return;
    const finish = () => {
      if (boot.classList.contains('boot-leaving')) return;
      requestAnimationFrame(() => boot.classList.add('boot-leaving'));
      window.setTimeout(() => boot.remove(), 560);
    };
    const onReady = () => finish();
    window.addEventListener('arena-ready', onReady, { once: true });
    if ((window as any).__arenaBootReady) finish();
    if (fatal) {
      reportBoot((window as any).__arenaBootProgress ?? 0, 'ERROR', 'Renderer could not start · showing diagnostics');
      finish();
    }
    return () => window.removeEventListener('arena-ready', onReady);
  }, [fatal]);

  useEffect(() => {
    // Pre-flight: three.js r150+ needs WebGL2. Report precisely what is missing instead of a black screen.
    reportBoot(24, 'GPU CHECK', 'Checking WebGL2 support');
    const probe = document.createElement('canvas');
    const gl2 = probe.getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl2) {
      const gl1 = probe.getContext('webgl') || probe.getContext('experimental-webgl');
      setFatal(`WebGL2 context unavailable (WebGL1 ${gl1 ? 'present' : 'absent'}) · ${navigator.userAgent}`);
      return;
    }
    reportBoot(42, 'GPU READY', 'WebGL2 available · preparing the arena renderer');
    try { (gl2.getExtension('WEBGL_lose_context') as { loseContext?: () => void } | null)?.loseContext?.(); } catch { /* ignore */ }
    const onErr = (e: ErrorEvent) => setFatal(f => f ?? `Uncaught error: ${e.message || 'unknown'} (${e.filename}:${e.lineno})`);
    const onRej = (e: PromiseRejectionEvent) => setFatal(f => f ?? `Unhandled rejection: ${String((e as PromiseRejectionEvent).reason)}`);
    window.addEventListener('error', onErr); window.addEventListener('unhandledrejection', onRej);
    let g: Game;
    try { g = new Game(host.current!, settings); } catch (e) {
      console.error('[MagicCloud] failed to start', e);
      setFatal((e instanceof Error ? `${e.name}: ${e.message}` : String(e)) + ' · ' + navigator.userAgent);
      return;
    }
    g.onFatal = m => setFatal(`Render loop stopped — ${m}`);
    reportBoot(76, 'WORLD BUILT', 'Arena systems assembled · waiting for first frame');
    setGame(g); (window as any).game = g;
    let tid = 0;
    g.onToast = (m, c) => {
      const id = ++tid;
      setToasts(t => [...t.slice(-4), { id, m, c, leaving: false }]);
      setTimeout(() => setToasts(t => t.map(x => x.id === id ? { ...x, leaving: true } : x)), 1850);
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2150);
    };
    const iv = setInterval(() => setSnap(g.snapshot()), 100);
    let raf = 0; const ov = () => { raf = requestAnimationFrame(ov); if (overlay.current) { overlay.current.style.background = g.overlay.color; overlay.current.style.opacity = String(Math.min(0.85, g.overlay.a)); } }; ov();
    const kd = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'o' || e.key === 'O') {
        if (settingsOpenRef.current && !settingsClosingRef.current) { g.audio.uiSound('close'); setClosingSettings(true); }
        else if (!settingsOpenRef.current) { g.audio.uiSound('open'); setClosingSettings(false); setShowSettings(true); }
      }
      if (e.key === 'h' || e.key === 'H') {
        if (helpOpenRef.current && !helpClosingRef.current) { g.audio.uiSound('close'); setHelpClosing(true); }
        else { g.audio.uiSound('open'); setHelpClosing(false); setHelp(true); }
      }
    };
    window.addEventListener('keydown', kd);
    return () => { clearInterval(iv); cancelAnimationFrame(raf); window.removeEventListener('keydown', kd); window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onRej); g.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const changeSettings = (s: GraphicsSettings) => { setSettings(clampSettings(s)); game?.applySettings(clampSettings(s)); localStorage.setItem('f1090gfx', JSON.stringify(clampSettings(s))); };
  const touch = game?.isTouch ?? false;
  const item = game && snap && snap.equipped >= 0 ? game.items[snap.equipped] : null;

  return (
    <div className="fixed inset-0 overflow-hidden" onClickCapture={onUiClickCapture} onChangeCapture={onUiChangeCapture}>
      <div ref={host} className="absolute inset-0" />
      <div ref={overlay} className="absolute inset-0 pointer-events-none" style={{ opacity: 0, mixBlendMode: 'screen' }} />
      {fatal && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="sf-panel max-w-[620px] p-5 text-[12px] leading-relaxed select-text">
            <div className="font-orb text-[12px] sf-glow text-cyan-200 mb-2">3D ARENA FAILED TO START</div>
            <div className="text-cyan-300/70 mb-2">Diagnostic — copy this line if you report the problem:</div>
            <div className="font-orb text-[10px] text-rose-200/90 break-all mb-3 bg-black/30 p-2">{fatal}</div>
            <div className="mb-1">The 2D interface still works; only the 3D view could not start.</div>
            <div className="text-cyan-300/70 mb-3">Common causes: WebGL2 disabled or unsupported, blocklisted GPU driver, browser running in a restricted/headless mode, or graphics settings that are too heavy.</div>
            <div className="flex gap-2 pointer-events-auto">
              <button className="sf-btn px-3 py-1 font-orb text-[10px]" onClick={() => location.reload()}>RETRY</button>
              <button className="sf-btn px-3 py-1 font-orb text-[10px]" onClick={() => { try { localStorage.removeItem('f1090gfx'); } catch { /* ignore */ } location.href = location.pathname + '?safe=1'; }}>SAFE MODE</button>
            </div>
          </div>
        </div>
      )}
      {game && snap && !showTitle && (showGui || guiClosing) && (
        <div className={`absolute inset-0 pointer-events-none ${guiClosing ? 'ui-hud-closing' : ''}`} onAnimationEnd={onGuiCloseAnimationEnd}>
          <div className="damage-indicator-layer absolute inset-0 overflow-hidden" aria-hidden="true">
            {snap.damageIndicators.map(d => <div key={d.id} className={`damage-indicator ${d.crit ? 'damage-indicator-crit' : ''}`} style={{ left: `${d.x}%`, top: `${d.y}%` }}>{d.crit && <span>CRIT </span>}{fmt(d.amount)}</div>)}
          </div>
          {/* Left rail: vitals and controls stack in one column, so they cannot overlap */}
          <div className="absolute left-2 top-2 hud-rail-left w-[250px] max-sm:w-[44vw] flex flex-col gap-2 pointer-events-none" style={{ bottom: 'var(--hud-bottom)' }}>
          <div data-panel="vitals" className={`sf-panel p-2.5 w-full shrink-0 pointer-events-auto ${snap.hp / snap.maxHp <= 0.25 ? 'hp-critical' : ''}`}>
            <div className="flex justify-between items-baseline"><span className="font-orb text-[11px] sf-glow text-cyan-200">MAGIC CLOUD // OPERATOR</span>{settings.sandbox && <span className="text-[9px] font-orb text-emerald-200 sandbox-tag">SANDBOX</span>}{snap.invincible && <span className="text-[9px] font-orb text-yellow-200">INVULN</span>}</div>
            <div className="hex-bar mt-1.5"><div className="h-full" style={{ width: `${(snap.hp / snap.maxHp) * 100}%`, background: 'linear-gradient(90deg,#16ffb0,#33e0ff)', boxShadow: '0 0 10px #33e0ff' }} /></div>
            <div className="flex justify-between text-[10px] mt-0.5 font-orb text-cyan-100/80"><span>HP {fmt(snap.hp)} / {fmt(snap.maxHp)}</span><span>{((snap.hp / snap.maxHp) * 100).toFixed(0)}%</span></div>
            <div className="grid grid-cols-3 gap-1 mt-1.5 text-[10px]">
              <div><div className="text-cyan-300/60">KILLS</div><div className="font-orb">{snap.kills}</div></div>
              <div><div className="text-cyan-300/60">DPS</div><div className="font-orb">{fmt(snap.dps)}</div></div>
              <div><div className="text-cyan-300/60">HOSTILES</div><div className="font-orb">{snap.alive}</div></div>
            </div>
            {item?.id === 'gblade' && <div className="mt-1.5"><div className="flex justify-between text-[9px] font-orb text-violet-200"><span>LIGHTNING CHARGE</span><span>{snap.charge.toFixed(0)}%</span></div><div className="hex-bar"><div className="h-full" style={{ width: `${snap.charge}%`, background: 'linear-gradient(90deg,#7a5cff,#e080ff)', boxShadow: '0 0 8px #b080ff' }} /></div></div>}
            {snap.buffs.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{snap.buffs.map(b => <span key={b.k} className="text-[9px] font-orb px-1.5 py-0.5 border border-rose-300/50 bg-rose-500/15 text-rose-100">{b.k.toUpperCase()} {b.rem.toFixed(1)}s</span>)}</div>}
          </div>
          {help && !touch && (
            <div data-panel="controls" className={`sf-panel p-2.5 w-full text-[10.5px] leading-snug pointer-events-auto ui-scroll min-h-0 ${helpClosing ? 'ui-panel-closing' : ''}`} onAnimationEnd={e => { if (e.target === e.currentTarget && helpClosing) { setHelp(false); setHelpClosing(false); } }}>
              <div className="flex justify-between font-orb text-[10px] text-cyan-200 mb-1"><span>CONTROLS</span><button className="sf-btn px-1" onClick={toggleHelp} data-ui-sound="close">✕</button></div>
              <div><b className="text-cyan-300">WASD</b> move · <b className="text-cyan-300">Shift</b> sprint · <b className="text-cyan-300">Space</b> jump</div>
              <div><b className="text-cyan-300">LMB / E</b> M1 attack / fire (manual)</div>
              <div><b className="text-cyan-300">RMB drag</b> orbit · <b className="text-cyan-300">P</b> view · <b className="text-cyan-300">Wheel / +/- / PgUp/PgDn</b> zoom (≤900m)</div>
              <div><b className="text-cyan-300">Z X C V B F G N M L K J</b> skills (hold for charge skills)</div>
              <div><b className="text-cyan-300">1-9, 0, -</b> equip / unequip · <b className="text-cyan-300">O/Esc</b> graphics · <b className="text-cyan-300">H</b> help</div>
              <div className="text-cyan-200/60 mt-1">Controller: LS move · RS orbit · LT zoom in · Select zoom out · RT fire · A jump · X/Y/B/LB/RB/D-pad skills · Start cycle item</div>
            </div>
          )}
          </div>
          {/* Right rail: telemetry, skills and zoom stack in one column, so they cannot overlap */}
          <div className="absolute right-2 top-2 hud-rail-right w-[236px] max-sm:w-[44vw] flex flex-col gap-2 pointer-events-none" style={{ bottom: 'var(--hud-bottom)' }}>
          <button className="telemetry-toggle sf-btn self-end pointer-events-auto font-orb" onClick={toggleTelemetry} aria-expanded={showTelemetry && !closingTelemetry} aria-label={showTelemetry && !closingTelemetry ? 'Hide range telemetry' : 'Show range telemetry'}>{showTelemetry && !closingTelemetry ? 'RANGE ▾' : 'RANGE ▸'}</button>
          {showTelemetry && <div data-panel="telemetry" className={`sf-panel telemetry-panel p-2 w-full text-[9px] shrink-0 pointer-events-auto ${closingTelemetry ? 'ui-panel-closing' : ''}`} onAnimationEnd={onTelemetryAnimationEnd}>
            <div className="telemetry-head"><span className="font-orb text-[10px] sf-glow text-cyan-200">FIELD TELEMETRY</span>{settings.showFps && <span className="font-orb telemetry-fps" style={{ color:snap.fps>45?'#a8d8a4':snap.fps>25?'#e5d49f':'#d99183' }}>{snap.fps} FPS · {snap.bolts}B · {snap.effects}FX</span>}</div>
            <div className="telemetry-grid">
              <div className="telemetry-cell"><span>AIM GND</span><b>{snap.aimDist.toFixed(1)}m</b></div>
              <div className="telemetry-cell"><span>AIM 3D</span><b>{snap.aim3D.toFixed(1)}m</b></div>
              <div className="telemetry-cell"><span>NEAREST</span><b>{snap.nearest.toFixed(0)}m</b></div>
              <div className="telemetry-cell"><span>CAMERA</span><b>{game.firstPerson?'FP':`${snap.camDist.toFixed(0)}m`}</b></div>
              <div className="telemetry-cell"><span>POSITION</span><b>{snap.pos[0].toFixed(0)},{snap.pos[1].toFixed(0)}</b></div>
              <div className="telemetry-cell"><span>HOSTILES</span><b>{snap.alive}</b></div>
            </div>
            <div className="telemetry-actions pointer-events-auto">
              <button className="sf-btn font-orb" onClick={openSettings} data-ui-sound="open" title="Settings" aria-label="Settings">SET</button>
              <button className={`sf-btn font-orb ${game.firstPerson ? 'on' : ''}`} onClick={() => game.toggleFirstPerson()} title="Toggle first/third person" aria-label="Toggle camera">{game.firstPerson?'FP':'TP'}</button>
              <button className="sf-btn font-orb" onClick={toggleHelp} data-ui-sound="toggle" title="Controls" aria-label="Controls">HELP</button>
              <button className={`sf-btn font-orb ${soundEnabled ? 'on' : ''}`} onClick={toggleSound} data-ui-sound="none" title={soundEnabled?'Mute all game audio':'Enable all game audio'} aria-label={soundEnabled?'Mute all game audio':'Enable all game audio'}>SND</button>
            </div>
          </div>}
          {/* Toasts */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1">
            {toasts.map(t => <div key={t.id} className={`toast-in sf-panel px-4 py-1 font-orb text-[11px] tracking-widest ${t.leaving ? 'toast-out' : ''}`} style={{ color: t.c, textShadow: `0 0 10px ${t.c}` }}>{t.m}</div>)}
          </div>
          <SkillBar game={game} equipped={snap.equipped} touch={touch} />
          <ZoomControl game={game} zoom={snap.zoomTarget} />
          </div>
          <Inventory game={game} equipped={snap.equipped} />
          {!item && <div className="absolute left-1/2 -translate-x-1/2 font-orb text-[10px] text-cyan-200/70 sf-glow" style={{ bottom: 'calc(var(--hud-bottom) + 4px)' }}>SELECT A FRUIT OR SWORD FROM INVENTORY {touch ? '' : '(1-9, 0, -)'}</div>}
          {touch && item && <div className="mobile-tap-hint absolute left-1/2 -translate-x-1/2 font-orb text-[9px] text-cyan-100/75" style={{ bottom: 'calc(var(--hud-bottom) + 4px)' }}>TAP SCREEN TO ATTACK</div>}
          {touch && <MobileControls game={game} />}
          {/* crosshair */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-5 opacity-60"><div className="absolute left-1/2 top-0 bottom-0 w-px bg-cyan-300" /><div className="absolute top-1/2 left-0 right-0 h-px bg-cyan-300" /></div>
        </div>
      )}
      {showTitle && !fatal && (
        <div className={`title-screen absolute inset-0 z-40 grid place-items-center p-5 pointer-events-auto ${leavingTitle ? 'title-screen-exit' : ''}`} onAnimationEnd={e => { if (e.target === e.currentTarget && e.animationName === 'ui-title-shutdown' && leavingTitle) setShowTitle(false); }}>
          <div className="title-card main-menu-card sf-panel" onPointerMove={moveMenuCard} onPointerLeave={resetMenuCard}>
            <header className="menu-header">
              <div className="menu-branding">
                <div className="title-mark" aria-hidden="true"><span>MC</span><i /></div>
                <div className="menu-brand-copy">
                  <p className="menu-overline font-orb">MAGICCLOUD <span>//</span> FIELD OPERATIONS</p>
                  <h1 className="menu-wordmark font-orb">MAGIC<span className="menu-title-second">CLOUD</span></h1>
                </div>
              </div>
              <div className="menu-head-controls">
                <div className="menu-release font-orb"><i aria-hidden="true" />BUILD 1.5.8 <span>LIVE</span></div>
                <button className={`menu-install font-orb ${installPromptReady ? 'is-ready' : ''}`} type="button" onClick={installApp} disabled={appInstalled} aria-label={appInstalled ? 'MagicCloud is already installed' : installPromptReady ? 'Install MagicCloud app' : 'Show instructions to install MagicCloud'} aria-describedby={installMessage ? 'menu-install-note' : undefined} data-ui-sound="open">
                  <span className="menu-install-icon" aria-hidden="true">{appInstalled ? '✓' : '↓'}</span>
                  <span>{appInstalled ? 'INSTALLED' : 'INSTALL APP'}</span>
                  <i aria-hidden="true">{installPromptReady ? '↗' : ''}</i>
                </button>
              </div>
            </header>

            <div className="menu-hairline" aria-hidden="true"><i /></div>

            <div className="menu-columns">
              <section className="menu-brief" aria-label="Arena briefing">
                <div className="menu-live-line font-orb"><span className="menu-live-orb" />WEATHER LINK ACTIVE <b>FIELD 01</b></div>
                <p className="menu-tagline font-orb">MASTER THE STORM.<br /><span>OWN THE ARENA.</span></p>
                <p className="menu-copy">Elemental power. Living weather. One open battlefield.</p>
                <div className="menu-readouts" aria-label="Arena status">
                  <div><b>FIELD</b><span><i />OPEN</span></div>
                  <div><b>WEATHER</b><span><i />LIVE</span></div>
                  <div><b>HOSTILES</b><span className="menu-hot"><i />ACTIVE</span></div>
                </div>
                <div className="menu-threat-strip"><span>THREAT INDEX</span><b>STALKER <i>·</i> CASTER <i>·</i> BRUTE</b></div>
              </section>

              <nav className="menu-actions" aria-label="Main menu">
                <div className="menu-nav-heading font-orb"><span>SELECT OPERATION</span><b>01 — 04</b></div>
                <button className="play-btn menu-enter" type="button" onClick={enterArena} data-ui-sound="transition" disabled={!game || leavingTitle}>
                  <span className="menu-action-index">01 / DEPLOY</span>
                  <strong>{leavingTitle ? 'ENTERING ARENA' : 'DROP INTO ARENA'}</strong>
                  <small>BREACH THE CONTAINMENT FIELD</small>
                  <i aria-hidden="true">↗</i>
                </button>
                {fullscreenError && <p className="menu-fullscreen-note" role="status" aria-live="polite">Fullscreen unavailable; continuing windowed. {fullscreenError}</p>}
                <div className="menu-utility-grid">
                  <button className="menu-utility sf-btn" type="button" onClick={openSettings} data-ui-sound="open"><b>02</b><span>SETTINGS</span><i aria-hidden="true">⚙</i></button>
                  <button className="menu-utility sf-btn" type="button" onClick={toggleMenuControls} aria-expanded={showMenuControls} data-ui-sound="toggle"><b>03</b><span>CONTROLS</span><i aria-hidden="true">⌘</i></button>
                  <button className="menu-utility menu-update-utility sf-btn" type="button" onClick={openUpdates} aria-label={releaseNotesUnseen ? 'Open new update notes, version 1.5.8' : 'Open update log'} title={releaseNotesUnseen ? 'New release notes · v1.5.8' : 'Release notes · v1.5.8'} data-ui-sound="open"><b>04</b><span>UPDATE LOG</span><i className={releaseNotesUnseen ? 'menu-new-badge' : ''} aria-hidden="true">{releaseNotesUnseen ? 'NEW' : '✦'}</i></button>
                  <button className={`menu-utility sf-btn ${soundEnabled ? 'on' : ''}`} type="button" onClick={toggleSound} disabled={!game} aria-pressed={soundEnabled} data-ui-sound="none"><b>05</b><span>{soundEnabled ? 'SOUND ON' : 'SOUND OFF'}</span><i aria-hidden="true">{soundEnabled ? '♫' : '×'}</i></button>
                </div>
              </nav>
            </div>

            {showMenuControls && <div className="menu-control-note" id="menu-control-note"><b>CONTROLS</b><span>WASD MOVE · SHIFT SPRINT · SPACE JUMP · RMB ORBIT · LMB ATTACK</span><span>Z/X/C/V/B/F/G/N/M/L/K/J SKILLS</span></div>}
            {installMessage && <div className="menu-install-note" id="menu-install-note" role="status" aria-live="polite"><span>{installMessage}</span><button type="button" aria-label="Dismiss install message" onClick={() => setInstallMessage('')}>×</button></div>}
            <footer className="menu-footer font-orb"><span><i />ARENA SYSTEMS · {game ? 'ONLINE' : 'BOOTING'}</span><span>WASD <i>·</i> SPACE <i>·</i> RMB ORBIT</span></footer>
          </div>
        </div>
      )}
      {showSettings && showGui && <Settings settings={settings} closing={closingSettings} onChange={changeSettings} onClose={closeSettings} onExited={finishSettingsClose} isFullscreen={isFullscreen} fullscreenError={fullscreenError} onToggleFullscreen={toggleFullscreen} musicAvailable={!!game} musicName={musicName} masterVolume={masterVolume} onMasterVolume={changeMasterVolume} musicVolume={musicVolume} musicRate={musicRate} musicPlaying={musicPlaying} musicError={musicError} musicDuration={musicDuration} musicTrimStart={musicTrimStart} musicTrimEnd={musicTrimEnd} onMusicFile={loadMusicFile} onMusicVolume={changeMusicVolume} onMusicRate={changeMusicRate} onMusicTrimStart={changeMusicTrimStart} onMusicTrimEnd={changeMusicTrimEnd} onToggleMusic={toggleMusic} />}
      {showUpdates && showTitle && <UpdateLog closing={closingUpdates} onClose={closeUpdates} onExited={finishUpdatesClose} />}
      {game && snap && !showTitle && (
        <button className={`gui-toggle ${showGui ? 'gui-toggle-visible' : 'gui-toggle-hidden'}`} onClick={toggleGui} data-ui-sound={showGui ? "close" : "open"} aria-label={showGui ? 'Hide interface' : 'Show interface'} title={showGui ? 'Hide interface' : 'Show interface'}>
          <span aria-hidden="true">{showGui ? '◉' : '◌'}</span><span>{showGui ? 'HIDE GUI' : 'SHOW GUI'}</span>
        </button>
      )}
    </div>
  );
}
