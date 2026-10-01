export type UiSoundKind = 'click' | 'open' | 'close' | 'toggle' | 'slider' | 'transition' | 'skill' | 'equip';

export interface WeatherSoundMix { wind: number; rain: number; hail: number }

type ToneOptions = {
  from: number;
  to: number;
  duration: number;
  volume: number;
  wave?: OscillatorType;
  delay?: number;
  pan?: number;
  space?: number;
  filterType?: BiquadFilterType;
  filterFrom?: number;
  filterTo?: number;
  q?: number;
  attack?: number;
};

/** Diegetic procedural combat feedback, reactor ambience, weather beds, and local music routing. */
export class GameAudio {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private uiGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private hailGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private rainFilter: BiquadFilterNode | null = null;
  private reverb: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  private arenaDroneGain: GainNode | null = null;
  private arenaMode = false;
  private lastPlayerHitAt = -Infinity;
  private lastPlayerAttackAt = -Infinity;
  private lastEnemyDownAt = -Infinity;
  private lastThunder = -10;
  private applied: WeatherSoundMix = { wind: -1, rain: -1, hail: -1 };
  private noiseBuffer: AudioBuffer | null = null;
  private masterArmed = false;
  private musicElement: HTMLMediaElement | null = null;
  private musicTag: 'audio' | 'video' | null = null;
  private musicSource: MediaElementAudioSourceNode | null = null;
  private musicGain: GainNode | null = null;
  private musicUrl: string | null = null;
  private musicVolume = 0.35;
  private musicRate = 1;
  private musicDuration = 0;
  private musicTrimStart = 0;
  private musicTrimEnd = 0;
  private musicTimeUpdate: (() => void) | null = null;
  private musicPlayHandler: (() => void) | null = null;
  private musicPauseHandler: (() => void) | null = null;
  private musicEndedHandler: (() => void) | null = null;
  private musicTrimTimer: number | null = null;
  private musicLoadId = 0;

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) this.unlock();
    const ctx = this.ctx, master = this.master;
    if (ctx && master) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(enabled ? 0.72 : 0.0001, ctx.currentTime, enabled ? 0.055 : 0.12);
      if (this.uiGain) {
        this.uiGain.gain.cancelScheduledValues(ctx.currentTime);
        this.uiGain.gain.setTargetAtTime(enabled ? 0.82 : 0.0001, ctx.currentTime, enabled ? 0.025 : 0.08);
      }
      if (this.arenaDroneGain) {
        this.arenaDroneGain.gain.cancelScheduledValues(ctx.currentTime);
        this.arenaDroneGain.gain.setTargetAtTime(enabled && this.arenaMode ? 0.022 : 0.0001, ctx.currentTime, enabled ? 0.8 : 0.25);
      }
    }
  }

  /** Must be called from a user gesture; browsers otherwise suspend audio playback. */
  unlock() {
    if (!this.enabled) return;
    try {
      if (!this.ctx) this.createGraph();
      if (this.ctx) {
        const waking = this.ctx.state !== 'running';
        if (waking) void this.ctx.resume().catch(() => {});
        // Arm the master once (or when waking a suspended context), rather than restarting a slow fade on every click.
        if (this.master && (waking || !this.masterArmed)) {
          this.master.gain.cancelScheduledValues(this.ctx.currentTime);
          this.master.gain.setTargetAtTime(0.72, this.ctx.currentTime, 0.035);
          this.masterArmed = true;
        }
      }
    } catch (error) { console.warn('[MagicCloud] Audio unavailable', error); }
  }

  private createGraph() {
    const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtor) return;
    const ctx = new AudioCtor() as AudioContext; this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0.0001; this.master.connect(ctx.destination);
    // UI feedback gets its own direct bus so ambience fades can never bury a brief click/transition cue.
    this.uiGain = ctx.createGain(); this.uiGain.gain.value = this.enabled ? 0.82 : 0.0001; this.uiGain.connect(ctx.destination);
    const frames = Math.ceil(ctx.sampleRate * 4);
    this.noiseBuffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    // A long, decorrelated noise bed avoids short-loop clicks and gives filters natural broadband material.
    let pink = 0, brown = 0;
    for (let i = 0; i < frames; i++) {
      const white = Math.random() * 2 - 1;
      pink = pink * 0.985 + white * 0.17;
      brown = brown * 0.995 + white * 0.045;
      data[i] = Math.max(-1, Math.min(1, white * 0.45 + pink * 0.36 + brown * 0.35));
    }
    const loop = (filterType: BiquadFilterType, low: number, high: number, gain: GainNode) => {
      const source = ctx.createBufferSource(); source.buffer = this.noiseBuffer; source.loop = true;
      const filter = ctx.createBiquadFilter(); filter.type = filterType; filter.frequency.value = high; filter.Q.value = 0.55;
      source.connect(filter);
      if (low > 0) { const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = low; hp.Q.value = 0.55; filter.connect(hp); hp.connect(gain); }
      else filter.connect(gain);
      gain.connect(this.master!); source.start(); return filter;
    };
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.018;
    this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0.0001;
    this.hailGain = ctx.createGain(); this.hailGain.gain.value = 0.0001;
    this.windFilter = loop('lowpass', 35, 420, this.windGain);
    this.rainFilter = loop('lowpass', 750, 8500, this.rainGain);
    loop('bandpass', 1800, 5200, this.hailGain);

    // Slow, shallow gust modulation gives the wind bed movement without a synthesized tone.
    const lfo = ctx.createOscillator(), lfoDepth = ctx.createGain();
    lfo.frequency.value = 0.075; lfoDepth.gain.value = 0.012; lfo.connect(lfoDepth); lfoDepth.connect(this.windGain.gain); lfo.start();

    const impulseSeconds = 2.2, impulseFrames = Math.floor(ctx.sampleRate * impulseSeconds);
    const impulse = ctx.createBuffer(2, impulseFrames, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const samples = impulse.getChannelData(ch); for (let i = 0; i < impulseFrames; i++) samples[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / impulseFrames, 2.8) * 0.22; }
    this.reverb = ctx.createConvolver(); this.reverb.buffer = impulse;
    this.reverbGain = ctx.createGain(); this.reverbGain.gain.value = 0.2; this.reverb.connect(this.reverbGain); this.reverbGain.connect(this.master);
    // A low, evolving carrier makes the arena feel powered-on, not like a menu beep loop.
    // It is faded in only after deployment and remains well below the weather mix.
    this.arenaDroneGain = ctx.createGain(); this.arenaDroneGain.gain.value = 0.0001;
    const droneFilter = ctx.createBiquadFilter(); droneFilter.type = 'lowpass'; droneFilter.frequency.value = 420; droneFilter.Q.value = 0.8;
    const droneA = ctx.createOscillator(), droneB = ctx.createOscillator();
    droneA.type = 'sine'; droneA.frequency.value = 49;
    droneB.type = 'triangle'; droneB.frequency.value = 73.42; droneB.detune.value = -5;
    droneA.connect(droneFilter); droneB.connect(droneFilter); droneFilter.connect(this.arenaDroneGain); this.arenaDroneGain.connect(this.master);
    const droneLfo = ctx.createOscillator(), droneDepth = ctx.createGain();
    droneLfo.frequency.value = 0.065; droneDepth.gain.value = 150; droneLfo.connect(droneDepth); droneDepth.connect(droneFilter.frequency);
    droneA.start(); droneB.start(); droneLfo.start();
    if (this.arenaMode && this.enabled) this.arenaDroneGain.gain.setTargetAtTime(0.022, ctx.currentTime, 0.7);
  }

  setWeatherMix(mix: WeatherSoundMix) {
    if (!this.enabled || !this.ctx || !this.windGain || !this.rainGain || !this.hailGain) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const next = { wind: Math.max(0, Math.min(1, mix.wind)), rain: Math.max(0, Math.min(1, mix.rain)), hail: Math.max(0, Math.min(1, mix.hail)) };
    if (Math.abs(next.wind - this.applied.wind) > 0.025) {
      this.applied.wind = next.wind; this.windGain.gain.setTargetAtTime(0.018 + next.wind * 0.115, t, 0.8);
      this.windFilter!.frequency.setTargetAtTime(280 + next.wind * 460, t, 1.1);
    }
    if (Math.abs(next.rain - this.applied.rain) > 0.025) {
      this.applied.rain = next.rain; this.rainGain.gain.setTargetAtTime(next.rain * 0.11, t, 0.55);
      this.rainFilter!.frequency.setTargetAtTime(6200 + next.rain * 2600, t, 0.7);
    }
    if (Math.abs(next.hail - this.applied.hail) > 0.025) {
      this.applied.hail = next.hail; this.hailGain.gain.setTargetAtTime(next.hail * 0.045, t, 0.35);
    }
  }

  private clearMusicLoopHandlers(element: HTMLMediaElement | null = this.musicElement) {
    if (this.musicTrimTimer !== null) { window.clearInterval(this.musicTrimTimer); this.musicTrimTimer = null; }
    if (element) {
      if (this.musicTimeUpdate) element.removeEventListener('timeupdate', this.musicTimeUpdate);
      if (this.musicPlayHandler) element.removeEventListener('play', this.musicPlayHandler);
      if (this.musicPauseHandler) element.removeEventListener('pause', this.musicPauseHandler);
      if (this.musicEndedHandler) element.removeEventListener('ended', this.musicEndedHandler);
    }
    this.musicTimeUpdate = null; this.musicPlayHandler = null; this.musicPauseHandler = null; this.musicEndedHandler = null;
  }

  /** Load local audio or video media, route its soundtrack through the music fader, and prepare a looping trim. */
  loadMusic(file: File): Promise<number> {
    this.unlock();
    const ctx = this.ctx, master = this.master, loadId = ++this.musicLoadId;
    if (!ctx || !master) return Promise.reject(new Error('Web Audio is unavailable on this device.'));
    const hasVideoStream = /\.(mp4|m4v|webm|mov|ogv|mkv|avi)$/i.test(file.name) && !file.type.startsWith('audio/');
    const tag = file.type.startsWith('video/') || hasVideoStream ? 'video' : 'audio';
    if (this.musicElement && this.musicTag !== tag) {
      this.clearMusicLoopHandlers(this.musicElement);
      this.musicElement.pause(); this.musicElement.removeAttribute('src'); this.musicElement.load();
      this.musicSource?.disconnect(); this.musicSource = null; this.musicElement = null; this.musicTag = null;
    }
    let element = this.musicElement;
    if (!element) {
      element = tag === 'video' ? document.createElement('video') : new Audio();
      element.preload = 'metadata'; element.loop = false;
      if (tag === 'video') (element as HTMLVideoElement).playsInline = true;
      this.musicSource = ctx.createMediaElementSource(element);
      if (!this.musicGain) { this.musicGain = ctx.createGain(); this.musicGain.gain.value = this.musicVolume; this.musicGain.connect(master); }
      this.musicSource.connect(this.musicGain); this.musicElement = element; this.musicTag = tag;
    }
    this.clearMusicLoopHandlers(element);
    element.pause();
    const media = element as HTMLMediaElement & { webkitPreservesPitch?: boolean; mozPreservesPitch?: boolean };
    media.preservesPitch = false; media.webkitPreservesPitch = false; media.mozPreservesPitch = false;
    element.playbackRate = this.musicRate; element.loop = false;
    const previousUrl = this.musicUrl, nextUrl = URL.createObjectURL(file);
    this.musicUrl = nextUrl; element.src = nextUrl; element.load();
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    const metadata = new Promise<number>((resolve, reject) => {
      const onError = () => {
        element!.removeEventListener('loadedmetadata', onMetadata);
        reject(new Error('The selected media could not be decoded by this browser.'));
      };
      const onMetadata = () => {
        element!.removeEventListener('error', onError);
        if (loadId !== this.musicLoadId) { reject(new Error('A newer media file was selected.')); return; }
        const duration = Math.floor(element!.duration * 10) / 10;
        if (!Number.isFinite(duration) || duration < 0.1) { reject(new Error('This file has no usable audio duration.')); return; }
        this.musicDuration = duration; this.musicTrimStart = 0; this.musicTrimEnd = duration;
        const startTrimClock = () => {
          if (this.musicTrimTimer === null) this.musicTrimTimer = window.setInterval(() => this.musicTimeUpdate?.(), 50);
        };
        const stopTrimClock = () => {
          if (this.musicTrimTimer !== null) { window.clearInterval(this.musicTrimTimer); this.musicTrimTimer = null; }
        };
        this.musicTimeUpdate = () => {
          const current = this.musicElement;
          if (!current || current.paused || current.currentTime < this.musicTrimEnd) return;
          current.currentTime = this.musicTrimStart;
          void current.play().catch(() => {});
        };
        this.musicPlayHandler = startTrimClock; this.musicPauseHandler = stopTrimClock;
        this.musicEndedHandler = () => {
          const current = this.musicElement;
          if (!current) return;
          current.currentTime = this.musicTrimStart;
          void current.play().then(startTrimClock).catch(() => {});
        };
        element!.addEventListener('timeupdate', this.musicTimeUpdate);
        element!.addEventListener('play', this.musicPlayHandler);
        element!.addEventListener('pause', this.musicPauseHandler);
        element!.addEventListener('ended', this.musicEndedHandler);
        if (!element!.paused) startTrimClock();
        resolve(duration);
      };
      element!.addEventListener('loadedmetadata', onMetadata, { once: true });
      element!.addEventListener('error', onError, { once: true });
    });
    let playback: Promise<void>;
    try { playback = element.play(); }
    catch (error) { return Promise.reject(error); }
    return Promise.all([metadata, playback]).then(([duration]) => duration);
  }

  setMusicTrim(start: number, end: number) {
    const duration = this.musicDuration;
    if (duration < 0.1) return { start: 0, end: 0 };
    const gap = Math.min(0.1, duration);
    this.musicTrimStart = Math.max(0, Math.min(duration - gap, Number.isFinite(start) ? start : 0));
    this.musicTrimEnd = Math.max(this.musicTrimStart + gap, Math.min(duration, Number.isFinite(end) ? end : duration));
    if (this.musicElement && (this.musicElement.currentTime < this.musicTrimStart || this.musicElement.currentTime >= this.musicTrimEnd)) {
      this.musicElement.currentTime = this.musicTrimStart;
    }
    return { start: this.musicTrimStart, end: this.musicTrimEnd };
  }

  setMusicVolume(value: number) {
    this.musicVolume = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.35));
    if (this.musicGain && this.ctx) this.musicGain.gain.setTargetAtTime(this.musicVolume, this.ctx.currentTime, 0.025);
  }

  setMusicPlaybackRate(value: number) {
    this.musicRate = Math.max(0.5, Math.min(1.5, Number.isFinite(value) ? value : 1));
    if (this.musicElement) this.musicElement.playbackRate = this.musicRate;
  }

  async toggleMusic(): Promise<boolean> {
    if (!this.musicElement?.src) return false;
    if (this.musicElement.paused) { await this.musicElement.play(); return true; }
    this.musicElement.pause(); return false;
  }

  /** Crossfade the restrained reactor bed only after the player deploys into the field. */
  setArenaMode(active: boolean) {
    this.arenaMode = active;
    if (active && this.enabled && !this.ctx) this.unlock();
    if (!this.ctx || !this.arenaDroneGain) return;
    const t = this.ctx.currentTime;
    this.arenaDroneGain.gain.cancelScheduledValues(t);
    this.arenaDroneGain.gain.setTargetAtTime(active && this.enabled ? 0.022 : 0.0001, t, active ? 0.8 : 0.28);
  }

  private tone(options: ToneOptions) {
    const ctx = this.ctx, output = this.uiGain;
    if (!ctx || !output) return;
    const duration = Math.max(0.018, options.duration);
    const start = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const osc = ctx.createOscillator(), filter = ctx.createBiquadFilter(), envelope = ctx.createGain();
    osc.type = options.wave ?? 'sine';
    osc.frequency.setValueAtTime(Math.max(20, options.from), start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, options.to), start + duration);
    filter.type = options.filterType ?? 'lowpass';
    filter.Q.value = Math.max(0.0001, options.q ?? 0.8);
    filter.frequency.setValueAtTime(Math.max(40, options.filterFrom ?? 12000), start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, options.filterTo ?? options.filterFrom ?? 12000), start + duration);
    const peak = Math.max(0.0002, options.volume);
    const attack = Math.min(duration * 0.42, Math.max(0.003, options.attack ?? 0.008));
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(peak, start + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(filter); filter.connect(envelope);
    const pan = Math.max(-1, Math.min(1, options.pan ?? 0));
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner(); panner.pan.setValueAtTime(pan, start);
      envelope.connect(panner); panner.connect(output);
      if ((options.space ?? 0) > 0 && this.reverb) {
        const send = ctx.createGain(); send.gain.value = Math.max(0, Math.min(0.65, options.space ?? 0));
        panner.connect(send); send.connect(this.reverb);
      }
    } else {
      envelope.connect(output);
      if ((options.space ?? 0) > 0 && this.reverb) {
        const send = ctx.createGain(); send.gain.value = Math.max(0, Math.min(0.65, options.space ?? 0));
        envelope.connect(send); send.connect(this.reverb);
      }
    }
    osc.start(start); osc.stop(start + duration + 0.025);
  }

  /** A tiny layered sound vocabulary: relay ticks, hologram shutters, weapon charge and deployment. */
  uiSound(kind: UiSoundKind = 'click', variation = 0) {
    if (!this.enabled) return;
    this.unlock();
    const ctx = this.ctx, output = this.uiGain; if (!ctx || !output) return;
    const pan = (Math.random() - 0.5) * 0.16;
    switch (kind) {
      case 'click':
        this.noiseSweep(5200, 1450, 0.038, 0.026, 0, output, pan, 0.04);
        this.tone({ from: 760, to: 360, duration: 0.067, volume: 0.048, wave: 'square', filterFrom: 3600, filterTo: 1050, q: 2.8, space: 0.05, pan });
        this.tone({ from: 1520, to: 880, duration: 0.045, volume: 0.012, delay: 0.006, filterFrom: 6400, space: 0.12, pan: -pan });
        break;
      case 'open':
        this.noiseSweep(420, 6200, 0.32, 0.06, 0, output, 0, 0.2);
        this.tone({ from: 164.8, to: 329.6, duration: 0.27, volume: 0.047, wave: 'triangle', filterFrom: 1000, filterTo: 3400, space: 0.22 });
        this.tone({ from: 247, to: 494, duration: 0.24, volume: 0.03, delay: 0.045, wave: 'sine', filterFrom: 4200, space: 0.3 });
        this.tone({ from: 494, to: 988, duration: 0.18, volume: 0.018, delay: 0.095, wave: 'sine', filterFrom: 5600, space: 0.32 });
        this.noiseSweep(2200, 520, 0.12, 0.043, 0.18, output, 0, 0.12);
        break;
      case 'close':
        this.noiseSweep(6500, 260, 0.28, 0.052, 0, output, 0, 0.2);
        this.tone({ from: 523, to: 196, duration: 0.24, volume: 0.05, wave: 'triangle', filterFrom: 3200, filterTo: 500, space: 0.23 });
        this.tone({ from: 130.8, to: 65.4, duration: 0.31, volume: 0.036, wave: 'sine', filterFrom: 500, filterTo: 170, space: 0.25 });
        this.noiseSweep(900, 3400, 0.075, 0.028, 0.17, output, 0, 0.08);
        break;
      case 'toggle':
        this.noiseSweep(4600, 1800, 0.045, 0.022, 0, output, pan, 0.04);
        this.tone({ from: 1046, to: 740, duration: 0.062, volume: 0.033, wave: 'square', filterFrom: 5200, filterTo: 2200, q: 3.2, pan });
        this.tone({ from: 1568, to: 1174, duration: 0.055, volume: 0.016, delay: 0.016, filterFrom: 6500, space: 0.12, pan: -pan });
        break;
      case 'slider':
        this.noiseSweep(7200, 3600, 0.032, 0.014, 0, output, pan, 0.02);
        this.tone({ from: 1760, to: 1320, duration: 0.034, volume: 0.018, wave: 'sine', filterFrom: 8000, filterTo: 4200, pan });
        break;
      case 'transition':
        // A pressure-building warp coil, sub drop, then a wide, glassy gate opening.
        this.noiseSweep(180, 7600, 0.48, 0.07, 0, output, 0, 0.22);
        this.noiseSweep(7200, 170, 0.66, 0.065, 0.27, output, 0, 0.28);
        this.tone({ from: 55, to: 32, duration: 0.82, volume: 0.115, wave: 'sine', filterFrom: 180, filterTo: 68, space: 0.24 });
        this.tone({ from: 110, to: 41, duration: 0.69, volume: 0.052, delay: 0.035, wave: 'sawtooth', filterFrom: 260, filterTo: 92, q: 1.2, space: 0.16 });
        this.tone({ from: 174.6, to: 698.5, duration: 0.4, volume: 0.032, delay: 0.12, wave: 'triangle', filterFrom: 1800, filterTo: 5200, space: 0.34 });
        this.tone({ from: 261.6, to: 1046.5, duration: 0.34, volume: 0.018, delay: 0.2, filterFrom: 6000, space: 0.38 });
        break;
      case 'skill': {
        const scale = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24, 27];
        const root = 293.66 * Math.pow(2, scale[Math.abs(Math.trunc(variation)) % scale.length] / 12);
        this.noiseSweep(620, 5400, 0.16, 0.052, 0, output, pan, 0.18);
        this.noiseSweep(3600, 180, 0.13, 0.045, 0.042, output, -pan, 0.2);
        this.tone({ from: root, to: root * 2.1, duration: 0.2, volume: 0.064, wave: 'sawtooth', filterFrom: 1800, filterTo: 5200, q: 1.5, space: 0.2, pan });
        this.tone({ from: root * 1.5, to: root * 2.5, duration: 0.17, volume: 0.026, delay: 0.035, wave: 'sine', filterFrom: 6400, space: 0.34, pan: -pan });
        this.tone({ from: 73.4, to: 46.2, duration: 0.17, volume: 0.038, wave: 'sine', filterFrom: 220, filterTo: 115, space: 0.12 });
        break;
      }
      case 'equip':
        this.noiseSweep(5700, 840, 0.095, 0.05, 0, output, pan, 0.14);
        this.tone({ from: 146.8, to: 293.7, duration: 0.18, volume: 0.048, wave: 'square', filterFrom: 950, filterTo: 3100, q: 2.3, space: 0.2 });
        this.tone({ from: 369.99, to: 739.99, duration: 0.15, volume: 0.026, delay: 0.045, wave: 'triangle', filterFrom: 4200, space: 0.32, pan: -pan });
        this.tone({ from: 55, to: 42, duration: 0.21, volume: 0.053, wave: 'sine', filterFrom: 180, filterTo: 110, space: 0.2 });
        this.noiseSweep(2100, 540, 0.075, 0.035, 0.11, output, 0, 0.11);
        break;
    }
  }

  enemyShot(distance = 0, pan = 0) {
    if (!this.enabled) return;
    this.unlock();
    const ctx = this.ctx, output = this.uiGain;
    if (!ctx || !output) return;
    const attenuation = Math.max(0.18, 1 / (1 + Math.max(0, distance) / 48));
    const side = Math.max(-1, Math.min(1, pan));
    this.noiseSweep(5900, 280, 0.22, 0.08 * attenuation, 0, output, side, 0.18);
    this.tone({ from: 310, to: 68, duration: 0.22, volume: 0.065 * attenuation, wave: 'sawtooth', filterFrom: 1900, filterTo: 390, q: 1.4, pan: side, space: 0.2 });
    this.tone({ from: 930, to: 465, duration: 0.13, volume: 0.022 * attenuation, delay: 0.018, filterFrom: 3900, space: 0.28, pan: side * 0.7 });
  }

  weaponAttack(projectile = false, combo = 1, color = 0x67efff) {
    if (!this.enabled) return;
    this.unlock();
    if (!this.ctx || !this.uiGain) return;
    const now = this.ctx.currentTime;
    const minGap = projectile ? 0.045 : 0.065;
    if (now - this.lastPlayerAttackAt < minGap) return;
    this.lastPlayerAttackAt = now;
    const hue = ((color >>> 8) & 0xff) / 255;
    const tilt = 0.86 + hue * 0.34 + (combo > 1 ? 0.12 : 0);
    if (projectile) {
      this.noiseSweep(6400, 720, 0.1, 0.052, 0, this.uiGain, 0, 0.12);
      this.tone({ from: 420 * tilt, to: 112, duration: 0.14, volume: 0.055, wave: 'square', filterFrom: 2500, filterTo: 520, q: 2.2, space: 0.14 });
      this.tone({ from: 1260 * tilt, to: 680, duration: 0.1, volume: 0.018, delay: 0.012, filterFrom: 5200, space: 0.22 });
    } else {
      this.noiseSweep(2600, 185, 0.16, 0.062, 0, this.uiGain, 0, 0.16);
      this.tone({ from: 260 * tilt, to: 74, duration: 0.16, volume: 0.058, wave: 'sawtooth', filterFrom: 1350, filterTo: 250, q: 1.4, space: 0.15 });
      this.tone({ from: (combo > 1 ? 1320 : 980) * tilt, to: 285, duration: 0.115, volume: 0.027, delay: 0.015, wave: 'triangle', filterFrom: 4400, filterTo: 900, space: 0.22 });
      if (combo > 1) this.noiseSweep(4300, 1500, 0.075, 0.025, 0.032, this.uiGain, 0, 0.12);
    }
  }

  playerHit(intensity = 1, pan = 0) {
    if (!this.enabled || !this.ctx || !this.uiGain) return;
    const now = this.ctx.currentTime;
    if (now - this.lastPlayerHitAt < 0.11) return;
    this.lastPlayerHitAt = now;
    const power = Math.max(0.55, Math.min(1.45, intensity));
    const side = Math.max(-1, Math.min(1, pan));
    this.noiseSweep(3400, 180, 0.2, 0.09 * power, 0, this.uiGain, side, 0.18);
    this.tone({ from: 98, to: 38, duration: 0.25, volume: 0.105 * power, wave: 'sine', filterFrom: 250, filterTo: 72, space: 0.15, pan: side });
    this.tone({ from: 740, to: 270, duration: 0.13, volume: 0.027 * power, wave: 'triangle', filterFrom: 2100, filterTo: 680, q: 1.8, space: 0.16, pan: side * 0.7 });
  }

  enemyDown(scale = 1, boss = false) {
    if (!this.enabled || !this.ctx || !this.uiGain) return;
    const now = this.ctx.currentTime;
    if (!boss && now - this.lastEnemyDownAt < 0.14) return;
    this.lastEnemyDownAt = now;
    const size = Math.max(0.7, Math.min(2.5, scale));
    this.noiseSweep(boss ? 3800 : 4600, 170, boss ? 0.42 : 0.2, (boss ? 0.11 : 0.044) * Math.min(1.25, size), 0, this.uiGain, 0, boss ? 0.42 : 0.18);
    this.tone({ from: boss ? 164.8 : 392, to: boss ? 41 : 98, duration: boss ? 0.62 : 0.22, volume: (boss ? 0.105 : 0.035) * Math.min(1.3, size), wave: 'sine', filterFrom: boss ? 520 : 2400, filterTo: 90, space: boss ? 0.46 : 0.2 });
    if (boss) this.tone({ from: 987.8, to: 246.9, duration: 0.42, volume: 0.043, delay: 0.12, wave: 'triangle', filterFrom: 4200, space: 0.52 });
  }

  gustFront(distance=0,intensity=1) {
    if(!this.enabled)return; this.unlock(); const ctx=this.ctx,master=this.master; if(!ctx||!master)return;
    const attenuation=Math.max(.12,1/(1+Math.max(0,distance)/1000))*Math.max(.35,Math.min(1.5,intensity));
    const delay=Math.min(2,Math.max(0,distance)/343); this.noiseSweep(1700,130,1.35,.09*attenuation,delay);
    const now=ctx.currentTime+delay,osc=ctx.createOscillator(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
    osc.type='sine';osc.frequency.setValueAtTime(74,now);osc.frequency.exponentialRampToValueAtTime(34,now+1.2);filter.type='lowpass';filter.frequency.value=150;
    gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.07*attenuation,now+.1);gain.gain.exponentialRampToValueAtTime(.0001,now+1.5);
    osc.connect(filter);filter.connect(gain);gain.connect(master);osc.start(now);osc.stop(now+1.55);
  }

  private noiseSweep(from: number, to: number, duration: number, volume: number, delay = 0, output?: AudioNode, pan = 0, space = 0) {
    const ctx = this.ctx, sink = output ?? this.master, buffer = this.noiseBuffer;
    if (!ctx || !sink || !buffer) return;
    const length = Math.max(0.018, duration), start = ctx.currentTime + Math.max(0, delay);
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), envelope = ctx.createGain();
    source.buffer = buffer;
    filter.type = 'bandpass'; filter.Q.value = 0.72;
    filter.frequency.setValueAtTime(Math.max(40, from), start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), start + length);
    const peak = Math.max(0.0002, volume), attack = Math.min(length * 0.45, Math.max(0.003, Math.min(0.025, length * 0.2)));
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(peak, start + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);
    source.connect(filter); filter.connect(envelope);
    const side = Math.max(-1, Math.min(1, pan));
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner(); panner.pan.setValueAtTime(side, start);
      envelope.connect(panner); panner.connect(sink);
      if (space > 0 && this.reverb) { const send = ctx.createGain(); send.gain.value = Math.max(0, Math.min(0.65, space)); panner.connect(send); send.connect(this.reverb); }
    } else {
      envelope.connect(sink);
      if (space > 0 && this.reverb) { const send = ctx.createGain(); send.gain.value = Math.max(0, Math.min(0.65, space)); envelope.connect(send); send.connect(this.reverb); }
    }
    const offset = Math.random() * Math.max(0, buffer.duration - length);
    source.start(start, offset, length); source.stop(start + length + 0.025);
  }

  /** Delayed filtered thunder roll, with distance-based propagation and attenuation. */
  thunder(distance = 800, intensity = 1) {
    if (!this.enabled || !this.ctx || !this.master || !this.noiseBuffer) return;
    const ctx = this.ctx, now = ctx.currentTime;
    if (now - this.lastThunder < 0.18) return;
    this.lastThunder = now;
    const delay = Math.min(7, Math.max(0, distance) / 343), start = now + delay;
    const attenuation = Math.max(0.12, 1 / (1 + distance / 1300)) * Math.max(0.25, Math.min(1.4, intensity));
    const makeLayer = (type: BiquadFilterType, frequency: number, q: number, peak: number, attack: number, duration: number, reverb = false) => {
      const source = ctx.createBufferSource(); source.buffer = this.noiseBuffer; source.loop = true;
      const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = frequency; filter.Q.value = q;
      const gain = ctx.createGain(); gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * attenuation), start + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      source.connect(filter); filter.connect(gain);
      if (reverb && this.reverb) { gain.connect(this.master!); gain.connect(this.reverb); }
      else gain.connect(this.master!);
      source.start(start); source.stop(start + duration + 0.04);
    };
    // A brief distant crack sits over a much longer low-frequency rumble.
    makeLayer('bandpass', 1450, 0.45, 0.14, 0.012, 0.22, true);
    makeLayer('lowpass', 185, 0.7, 0.23, 0.07, 2.8 + Math.random() * 1.8, true);
  }

  private lastHail = -10;
  /** Throttled, filtered ice-on-ground ticks layer naturally into the hail noise bed. */
  hailImpact(distance = 0) {
    if (!this.enabled || !this.ctx || !this.master || !this.noiseBuffer) return;
    const ctx=this.ctx, now=ctx.currentTime;
    if(now-this.lastHail<0.075)return; this.lastHail=now;
    const source=ctx.createBufferSource(); source.buffer=this.noiseBuffer; source.loop=false;
    const hp=ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=900;
    const knock=ctx.createBiquadFilter(); knock.type='bandpass'; knock.frequency.value=1850+Math.random()*900; knock.Q.value=.8;
    const gain=ctx.createGain(), peak=Math.max(.008,.055/(1+distance/500));
    gain.gain.setValueAtTime(.0001,now); gain.gain.exponentialRampToValueAtTime(peak,now+.003);
    gain.gain.exponentialRampToValueAtTime(.0001,now+.065);
    source.connect(hp); hp.connect(knock); knock.connect(gain); gain.connect(this.master); if(this.reverb)gain.connect(this.reverb);
    source.start(now); source.stop(now+.08);
  }

  dispose() {
    this.musicLoadId++;
    this.clearMusicLoopHandlers(this.musicElement);
    this.musicElement?.pause();
    if (this.musicElement) { this.musicElement.removeAttribute('src'); this.musicElement.load(); }
    this.musicSource?.disconnect(); this.musicGain?.disconnect();
    this.musicElement = null; this.musicTag = null; this.musicSource = null; this.musicGain = null;
    if (this.musicUrl) { URL.revokeObjectURL(this.musicUrl); this.musicUrl = null; }
    if (!this.ctx) return;
    const ctx = this.ctx; this.ctx = null;
    void ctx.close().catch(() => {});
  }
}
