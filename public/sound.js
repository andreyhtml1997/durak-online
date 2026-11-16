/* Quiet, layered table sounds. Generated locally so they also work offline. */
(() => {
  let enabled = true;
  try { enabled = localStorage.getItem('durak_sound_enabled') !== '0'; } catch (_) {}

  const Sound = {
    ctx: null,
    output: null,
    noiseBuffer: null,

    get enabled() { return enabled; },
    set enabled(value) {
      enabled = !!value;
      try { localStorage.setItem('durak_sound_enabled', enabled ? '1' : '0'); } catch (_) {}
      if (this.ctx && this.output) {
        this.output.gain.setTargetAtTime(enabled ? 0.78 : 0, this.ctx.currentTime, 0.012);
      }
      if (enabled) this.init();
    },

    init() {
      if (!enabled) return;
      try {
        if (!this.ctx || this.ctx.state === 'closed') {
          const Audio = window.AudioContext || window.webkitAudioContext;
          if (!Audio) return;
          this.ctx = new Audio();
          this.prepare(this.ctx);
        }
        // Safari and Android WebView require resume from a real tap, including
        // after returning from the background. A blocked resume is harmless.
        if (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted') {
          const result = this.ctx.resume();
          if (result && result.catch) result.catch(() => {});
        }
      } catch (_) {}
    },

    prepare(context) {
      this.output = context.createGain();
      this.output.gain.value = enabled ? 0.78 : 0;
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -15;
      compressor.knee.value = 12;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.14;
      this.output.connect(compressor);
      compressor.connect(context.destination);

      this.noiseBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.5), context.sampleRate);
      const samples = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    },

    tone(time, frequency, duration, volume, endFrequency = frequency) {
      const oscillator = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, time);
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency, time + duration);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(volume, time + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
      oscillator.connect(gain);
      gain.connect(this.output);
      oscillator.start(time);
      oscillator.stop(time + duration + 0.015);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    },

    paper(time, duration, volume, brightness = 1800) {
      const source = this.ctx.createBufferSource();
      const filter = this.ctx.createBiquadFilter();
      const softener = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      source.buffer = this.noiseBuffer;
      source.playbackRate.value = 0.94 + Math.random() * 0.12;
      filter.type = 'bandpass';
      filter.Q.value = 0.65;
      filter.frequency.setValueAtTime(brightness, time);
      filter.frequency.exponentialRampToValueAtTime(brightness * 0.58, time + duration);
      softener.type = 'lowpass';
      softener.frequency.value = 4200;
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(volume, time + duration * 0.2);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
      source.connect(filter);
      filter.connect(softener);
      softener.connect(gain);
      gain.connect(this.output);
      source.start(time, Math.random() * 0.18);
      source.stop(time + duration + 0.015);
      source.onended = () => { source.disconnect(); filter.disconnect(); softener.disconnect(); gain.disconnect(); };
    },

    card(time, defending = false, strength = 1) {
      this.paper(time, defending ? 0.105 : 0.078, 0.17 * strength, defending ? 2100 : 1650);
      // A soft contact with the felt, rather than the old electronic beep.
      this.tone(time + 0.027, defending ? 190 : 160, 0.085, (defending ? 0.095 : 0.065) * strength, 88);
      this.paper(time + 0.028, 0.022, 0.085 * strength, 760);
    },

    play(type) {
      if (!enabled) return;
      this.init();
      // Do not queue old network sounds while the browser is awaiting a tap.
      if (!this.ctx || this.ctx.state !== 'running' || !this.output) return;
      this.schedule(type, this.ctx.currentTime + 0.005);
    },

    schedule(type, time) {
      switch (type) {
        case 'attack':
        case 'card':
          this.card(time);
          break;
        case 'defend':
          this.card(time, true);
          break;
        case 'deal':
          [0, 0.065, 0.13, 0.195].forEach(delay => this.card(time + delay, false, 0.63));
          break;
        case 'pass':
          this.tone(time, 392, 0.15, 0.038, 349.23);
          break;
        case 'take':
          [0, 0.048, 0.105].forEach((delay, i) => this.paper(time + delay, 0.12, 0.16 - i * 0.025, 1200 - i * 180));
          this.tone(time + 0.13, 132, 0.13, 0.05, 85);
          break;
        case 'bito':
          this.paper(time, 0.15, 0.13, 1600);
          this.tone(time + 0.035, 523.25, 0.27, 0.065);
          this.tone(time + 0.1, 659.25, 0.32, 0.055);
          this.tone(time + 0.16, 1046.5, 0.29, 0.026);
          break;
        case 'win':
          [523.25, 659.25, 783.99, 1046.5].forEach((frequency, i) => {
            this.tone(time + i * 0.105, frequency, 0.46, 0.085 - i * 0.009);
            this.tone(time + i * 0.105, frequency * 2, 0.2, 0.012);
          });
          this.tone(time + 0.315, 261.63, 0.65, 0.036);
          this.tone(time + 0.315, 392, 0.65, 0.026);
          break;
      }
    }
  };

  window.DurakSound = Sound;
  // Network guests can join without pressing a game button; unlock from their
  // first gesture and resume again when returning from Safari's share sheet.
  for (const event of ['pointerdown', 'touchend', 'keydown']) {
    document.addEventListener(event, () => Sound.init(), { capture: true, passive: true });
  }
})();
