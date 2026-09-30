export interface WeatherSoundMix { wind: number; rain: number; hail: number }

/** Filtered procedural weather ambience and distant thunder; no synthesized arcade bleeps. */
export class GameAudio {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private hailGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private rainFilter: BiquadFilterNode | null = null;
  private reverb: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  private lastThunder = -10;
  private applied: WeatherSoundMix = { wind: -1, rain: -1, hail: -1 };
  private noiseBuffer: AudioBuffer | null = null;

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) this.unlock();
    const ctx = this.ctx, master = this.master;
    if (ctx && master) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(enabled ? 0.72 : 0.0001, ctx.currentTime, enabled ? 0.5 : 0.12);
    }
  }

  /** Must be called from a user gesture; browsers otherwise suspend audio playback. */
  unlock() {
    if (!this.enabled) return;
    try {
      if (!this.ctx) this.createGraph();
      if (this.ctx?.state === 'suspended') void this.ctx.resume().catch(() => {});
      if (this.ctx && this.master) this.master.gain.setTargetAtTime(0.72, this.ctx.currentTime, 0.65);
    } catch (error) { console.warn('[MagicCloud] Audio unavailable', error); }
  }

  private createGraph() {
    const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtor) return;
    const ctx = new AudioCtor() as AudioContext; this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0.0001; this.master.connect(ctx.destination);
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
    if (!this.ctx) return;
    const ctx = this.ctx; this.ctx = null;
    void ctx.close().catch(() => {});
  }
}
