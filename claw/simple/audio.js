const phases = {
  READY_X: 'ready', READY_Y: 'aim', MOVING_X: 'moveX', MOVING_Y: 'moveY',
  OPEN_BEFORE_LOWER: 'open', LOWERING: 'lower', CLOSING: 'close', LIFTING: 'lift',
  MOVING_CENTER: 'moveX', RELEASING: 'release', RECLOSING: 'close', RETURNING: 'moveY',
  ROD_RELEASE: 'open', ROD_BLOCKED: 'stop', HOOK_DWELL: 'aim', HOOK_BLOCKED: 'stop', WIN: 'win',
};
const loops = new Set(['moveX','moveY','lower','lift']);
const catalogUrl = new URL('../assets/sounds/manifest.json?v=coffee-jazz-1', import.meta.url);
const percent = n => Math.max(0, Math.min(100, Number(n) || 0));

function retire(voice, now, fade) {
  if (!voice) return;
  const gain = voice.envelope.gain;
  gain.cancelScheduledValues(now);
  gain.setTargetAtTime(0, now, fade / 5);
  voice.source.stop(now + fade);
}

export class Sounds {
  constructor(notify) {
    this.notify = notify;
    this.enabled = true; this.volume = 55;
    this.musicEnabled = true; this.musicVolume = 30;
    this.buffers = new Map();
    this.effectVersion = 0; this.musicVersion = 0; this.musicOffset = 0;
    this.paused = false;
  }

  unlock() {
    if (!this.enabled && !this.musicEnabled) return;
    if (!this.context) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      try { this.context = new Audio(); }
      catch { this.notify('이 브라우저에서 오디오 출력을 열 수 없습니다.'); return; }
      this.fxBus = this.context.createGain();
      this.musicBus = this.context.createGain();
      this.duck = this.context.createGain();
      this.fxBus.connect(this.context.destination);
      this.musicBus.connect(this.duck).connect(this.context.destination);
      this.fxBus.gain.value = this.volume / 100;
      this.musicBus.gain.value = this.musicVolume / 100;
      this.updateEffect();
      this.updateMusic();
    }
    if (this.context.state !== 'running') this.context.resume().catch(() => {});
  }

  async fetchBuffer(key) {
    if (!this.catalog) {
      this.catalog = fetch(catalogUrl).then(response => {
        if (!response.ok) throw new Error('사운드 목록을 불러오지 못했습니다.');
        return response.json();
      }).catch(error => { this.catalog = null; throw error; });
    }
    const catalog = await this.catalog;
    const item = key === 'music' ? catalog.music : catalog.clips[key];
    const response = await fetch(new URL(item.file, catalogUrl));
    if (!response.ok) throw new Error('음원을 불러오지 못했습니다.');
    const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
    return {buffer, duration: Math.min(item.loop_seconds ?? buffer.duration, buffer.duration), level: 10 ** ((item.gain_db ?? 0) / 20)};
  }

  load(key) {
    if (!this.buffers.has(key)) {
      this.buffers.set(key, this.fetchBuffer(key).catch(error => {
        this.buffers.delete(key); throw error;
      }));
    }
    return this.buffers.get(key);
  }

  voice(buffer, bus, loop, offset = 0, duration = buffer.duration, level = 1) {
    const now = this.context.currentTime;
    const source = this.context.createBufferSource(), envelope = this.context.createGain();
    source.buffer = buffer; source.loop = loop;
    if (loop) source.loopEnd = duration;
    source.connect(envelope).connect(bus);
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(level, now + (bus === this.musicBus ? .22 : .012));
    source.onended = () => {
      source.disconnect(); envelope.disconnect();
      if (this.effect?.source === source) this.effect = null;
    };
    source.start(now, offset);
    return {source, envelope, startedAt: now, duration};
  }

  setVolume(value) {
    this.volume = percent(value);
    if (this.fxBus) this.fxBus.gain.setTargetAtTime(this.volume / 100, this.context.currentTime, .025);
  }
  setMusicVolume(value) {
    this.musicVolume = percent(value);
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(this.musicVolume / 100, this.context.currentTime, .035);
  }
  setEnabled(value) {
    if (this.enabled === value) return;
    this.enabled = value; this.updateEffect(true);
  }
  setMusicEnabled(value) {
    if (this.musicEnabled === value) return;
    this.musicEnabled = value; this.updateMusic();
  }
  setPaused(value) {
    if (this.paused === value) return;
    this.paused = value;
    this.updateEffect(true); this.updateMusic();
    if (!value && this.context?.state === 'suspended') this.context.resume().catch(() => {});
  }
  play(state) {
    if (this.state === state) return;
    this.state = state; this.updateEffect();
  }

  async updateEffect(loopsOnly = false) {
    if (!this.context) return;
    const key = phases[this.state], loop = loops.has(key);
    const version = ++this.effectVersion;
    if (loop && this.effect?.key === key && this.enabled && !this.paused) return;
    retire(this.effect, this.context.currentTime, .035); this.effect = null;
    if (!this.enabled || this.paused || !key || (loopsOnly && !loop)) return;
    try {
      const {buffer} = await this.load(key);
      if (version !== this.effectVersion) return;
      if (key === 'win') {
        const now = this.context.currentTime, level = this.duck.gain;
        level.cancelScheduledValues(now);
        level.setTargetAtTime(.43, now, .045);
        level.setTargetAtTime(1, now + buffer.duration, .27);
      }
      this.effect = this.voice(buffer, this.fxBus, loop); this.effect.key = key;
    } catch (error) { if (version === this.effectVersion) this.notify(error.message); }
  }

  async updateMusic() {
    if (!this.context) return;
    const version = ++this.musicVersion;
    if (!this.musicEnabled || this.paused) {
      if (this.music) {
        const now = this.context.currentTime;
        this.musicOffset = (this.musicOffset + now - this.music.startedAt) % this.music.duration;
        retire(this.music, now, .09); this.music = null;
      }
      return;
    }
    if (this.music) return;
    try {
      const {buffer, duration, level} = await this.load('music');
      if (version !== this.musicVersion) return;
      this.music = this.voice(buffer, this.musicBus, true, this.musicOffset, duration, level);
    } catch (error) { if (version === this.musicVersion) this.notify(error.message); }
  }
}
