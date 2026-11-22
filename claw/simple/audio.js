const phaseSounds = {
  READY_X: ['ready', false], MOVING_X: ['move', true], MOVING_Y: ['move', true],
  OPEN_BEFORE_LOWER: ['open', false], LOWERING: ['lower', true], CLOSING: ['close', false],
  LIFTING: ['lift', true], MOVING_CENTER: ['move', true], RELEASING: ['release', false],
  RECLOSING: ['close', false], RETURNING: ['move', true], WIN: ['win', false],
};
export class Sounds {
  constructor(notify) { this.notify = notify; this.enabled = true; this.volume = 55; this.buffers = new Map(); this.state = null; }
  async unlock() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context = new AudioContext(); this.gain = this.context.createGain(); this.gain.connect(this.context.destination);
      this.setVolume(this.volume);
      this.loading = (async () => {
        const response = await fetch('../assets/sounds/manifest.json');
        if (!response.ok) throw new Error('사운드 목록을 불러오지 못했습니다.');
        const manifest = await response.json(); this.clips = manifest.clips;
        await Promise.all([...new Set(Object.values(this.clips).map(c => c.file))].map(async file => {
          const response = await fetch('../assets/sounds/' + file);
          if (!response.ok) throw new Error('효과음을 불러오지 못했습니다.');
          this.buffers.set(file, await this.context.decodeAudioData(await response.arrayBuffer()));
        }));
        this.play(this.state);
      })().catch(error => this.notify(error.message));
    }
    try { await this.context.resume(); } catch { /* Another gesture can resume audio. */ }
  }
  setVolume(value) { this.volume = Number(value); if (this.gain) this.gain.gain.value = this.volume / 100; }
  setEnabled(value) { this.enabled = value; if (!value) this.stop(); else { this.unlock(); this.play(this.state); } }
  stop() { if (this.source) { try { this.source.stop(); } catch {} this.source.disconnect(); this.source = null; } }
  play(state) {
    this.state = state; const cue = phaseSounds[state];
    if (!this.enabled || this.paused || !cue || !this.context || !this.clips) { this.stop(); return; }
    const [key, loop] = cue, file = this.clips[key]?.file, buffer = this.buffers.get(file);
    if (!buffer) return;
    // Several motion phases intentionally share the same real-machine loop.
    if (this.source && this.currentFile === file && this.source.loop && loop) return;
    this.stop(); const source = this.context.createBufferSource(); source.buffer = buffer; source.loop = loop;
    source.connect(this.gain); source.start(); this.source = source; this.currentFile = file;
  }
  setPaused(value) { this.paused = value; if (value) this.stop(); else this.play(this.state); }
}
