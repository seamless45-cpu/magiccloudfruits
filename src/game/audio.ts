export type UiSoundKind = 'click' | 'open' | 'close' | 'toggle' | 'slider' | 'transition' | 'skill' | 'equip';

export interface WeatherSoundMix { wind: number; rain: number; hail: number }

/** Filtered procedural weather ambience and distant thunder; no synthesized arcade bleeps. */
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
  private lastThunder = -10;
  private applied: WeatherSoundMix = { wind: -1, rain: -1, hail: -1 };
  private noiseBuffer: AudioBuffer | null = null;
  private masterArmed = false;

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

  /** Procedural console feedback plus broadband mechanical sweeps; no external audio assets. */
  uiSound(kind: UiSoundKind = 'click') {
    if (!this.enabled) return;
    this.unlock();
    const ctx=this.ctx, output=this.uiGain; if(!ctx||!output)return;
    const profile: Record<UiSoundKind,{from:number;to:number;duration:number;volume:number;type:OscillatorType}> = {
      click:{from:680,to:390,duration:.075,volume:.12,type:'triangle'},
      open:{from:300,to:760,duration:.2,volume:.13,type:'triangle'},
      close:{from:620,to:150,duration:.22,volume:.13,type:'triangle'},
      toggle:{from:920,to:520,duration:.085,volume:.085,type:'triangle'},
      slider:{from:1450,to:920,duration:.045,volume:.045,type:'sine'},
      transition:{from:190,to:48,duration:.72,volume:.18,type:'sawtooth'},
      skill:{from:360,to:920,duration:.14,volume:.12,type:'triangle'},
      equip:{from:230,to:520,duration:.12,volume:.1,type:'square'},
    };
    const p=profile[kind], now=ctx.currentTime, osc=ctx.createOscillator(), filter=ctx.createBiquadFilter(), gain=ctx.createGain();
    osc.type=p.type; osc.frequency.setValueAtTime(p.from,now); osc.frequency.exponentialRampToValueAtTime(p.to,now+p.duration);
    filter.type='lowpass'; filter.frequency.setValueAtTime(kind==='transition'?900:kind==='slider'?5200:3200,now); filter.frequency.exponentialRampToValueAtTime(kind==='transition'?180:kind==='slider'?2600:700,now+p.duration);
    gain.gain.setValueAtTime(.0001,now); gain.gain.linearRampToValueAtTime(p.volume,now+Math.min(.018,p.duration*.2)); gain.gain.exponentialRampToValueAtTime(.0001,now+p.duration);
    osc.connect(filter); filter.connect(gain); gain.connect(output); osc.start(now); osc.stop(now+p.duration+.02);
    if(kind==='open'||kind==='close'||kind==='transition') this.noiseSweep(kind==='transition'?2200:1500,kind==='transition'?120:420,kind==='transition'?.62:.2,kind==='transition'?.14:.085,0,output);
    else if(kind==='slider') this.noiseSweep(5200,2600,.045,.012,0,output);
    else if(kind==='toggle') this.noiseSweep(3600,1800,.065,.02,0,output);
  }

  enemyShot(distance=0) {
    if(!this.enabled)return; this.unlock(); const ctx=this.ctx,output=this.uiGain; if(!ctx||!output)return;
    const attenuation=Math.max(.2,1/(1+Math.max(0,distance)/45)),now=ctx.currentTime;
    this.noiseSweep(1550,260,.23,.105*attenuation,0,output);
    const osc=ctx.createOscillator(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
    osc.type='sawtooth';osc.frequency.setValueAtTime(280,now);osc.frequency.exponentialRampToValueAtTime(82,now+.2);
    filter.type='lowpass';filter.frequency.value=1100;gain.gain.setValueAtTime(.0001,now);
    gain.gain.exponentialRampToValueAtTime(.12*attenuation,now+.025);gain.gain.exponentialRampToValueAtTime(.0001,now+.24);
    osc.connect(filter);filter.connect(gain);gain.connect(output);osc.start(now);osc.stop(now+.26);
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

  private noiseSweep(from:number,to:number,duration:number,volume:number,delay=0,output?:AudioNode) {
    const ctx=this.ctx,sink=output??this.master,buffer=this.noiseBuffer;if(!ctx||!sink||!buffer)return;
    const now=ctx.currentTime+delay,source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
    source.buffer=buffer;filter.type='bandpass';filter.Q.value=.65;filter.frequency.setValueAtTime(from,now);filter.frequency.exponentialRampToValueAtTime(to,now+duration);
    gain.gain.setValueAtTime(.0001,now);gain.gain.linearRampToValueAtTime(volume,now+.06);gain.gain.exponentialRampToValueAtTime(.0001,now+duration);
    source.connect(filter);filter.connect(gain);gain.connect(sink);source.start(now,0,duration);source.stop(now+duration+.02);
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
