/* ============================================================
   ELEMENTAL QUEST — audio.js
   Procedural Web Audio API sound engine. No external assets.
   Generates SFX (jumps, footsteps, element effects, music) on the fly.
   ============================================================ */
(function (global) {
  'use strict';

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.masterGain = null;
      this.musicGain = null;
      this.sfxGain = null;
      this.vol = { master: 0.8, music: 0.6, sfx: 0.85 };
      this.muted = false;
      this.musicNodes = [];
      this.musicPlaying = false;
      this.currentMusic = null;
      this.footstepOsc = null;
      this.initialized = false;
      this.lastSfx = {};
    }

    /** Initialize audio context on first user gesture (browser policy) */
    init() {
      if (this.initialized) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        this.masterGain = this.ctx.createGain();
        this.musicGain = this.ctx.createGain();
        this.sfxGain = this.ctx.createGain();
        this.masterGain.connect(this.ctx.destination);
        this.musicGain.connect(this.masterGain);
        this.sfxGain.connect(this.masterGain);
        this.applyVolumes();
        this.initialized = true;
      } catch (e) {
        console.warn('AudioEngine init failed:', e);
      }
    }

    resume() {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }

    applyVolumes() {
      if (!this.ctx) return;
      this.masterGain.gain.value = this.muted ? 0 : this.vol.master;
      this.musicGain.gain.value = this.vol.music;
      this.sfxGain.gain.value = this.vol.sfx;
    }

    setVolume(kind, val) {
      this.vol[kind] = val;
      this.applyVolumes();
    }
    toggleMute() { this.muted = !this.muted; this.applyVolumes(); return this.muted; }

    // ----------------------------------------------------------
    // Basic tone synth helper
    // ----------------------------------------------------------
    _tone({ freq = 440, dur = 0.15, type = 'sine', gain = 0.3, attack = 0.005, decay = 0.1, slideTo = null, dest = null }) {
      if (!this.ctx) return;
      const t0 = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(dest || this.sfxGain);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
      return { osc, gain: g };
    }

    _noise({ dur = 0.15, gain = 0.2, filter = 'lowpass', freq = 1200, q = 1, dest = null }) {
      if (!this.ctx) return;
      const t0 = this.ctx.currentTime;
      const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * dur), this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const f = this.ctx.createBiquadFilter();
      f.type = filter; f.frequency.value = freq; f.Q.value = q;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      src.connect(f).connect(g).connect(dest || this.sfxGain);
      src.start(t0);
      src.stop(t0 + dur);
    }

    _throttle(key, ms) {
      const now = performance.now();
      if (this.lastSfx[key] && now - this.lastSfx[key] < ms) return true;
      this.lastSfx[key] = now;
      return false;
    }

    // ----------------------------------------------------------
    // Game SFX
    // ----------------------------------------------------------
    jump() {
      this._tone({ freq: 320, slideTo: 620, dur: 0.16, type: 'square', gain: 0.18 });
      this._tone({ freq: 480, slideTo: 920, dur: 0.12, type: 'triangle', gain: 0.10 });
    }

    land() {
      if (this._throttle('land', 60)) return;
      this._noise({ dur: 0.07, gain: 0.15, filter: 'lowpass', freq: 800 });
      this._tone({ freq: 110, dur: 0.08, type: 'sine', gain: 0.12 });
    }

    footstep(surface = 'stone') {
      if (this._throttle('step', 140)) return;
      const profiles = {
        stone:  { freq: 220, gain: 0.05, dur: 0.05 },
        dirt:   { freq: 160, gain: 0.06, dur: 0.06 },
        ice:    { freq: 600, gain: 0.04, dur: 0.08 },
        metal:  { freq: 380, gain: 0.07, dur: 0.05 },
        wood:   { freq: 260, gain: 0.06, dur: 0.05 },
      };
      const p = profiles[surface] || profiles.stone;
      this._noise({ dur: p.dur, gain: p.gain, filter: 'bandpass', freq: p.freq, q: 2 });
    }

    gem() {
      this._tone({ freq: 880, dur: 0.10, type: 'triangle', gain: 0.20 });
      setTimeout(() => this._tone({ freq: 1320, dur: 0.18, type: 'triangle', gain: 0.18 }), 60);
    }

    switchOn() {
      this._tone({ freq: 660, dur: 0.08, type: 'square', gain: 0.14 });
      setTimeout(() => this._tone({ freq: 990, dur: 0.12, type: 'square', gain: 0.12 }), 60);
    }
    switchOff() {
      this._tone({ freq: 440, dur: 0.08, type: 'square', gain: 0.12 });
      setTimeout(() => this._tone({ freq: 220, dur: 0.12, type: 'square', gain: 0.10 }), 60);
    }

    doorOpen() {
      this._tone({ freq: 220, slideTo: 660, dur: 0.45, type: 'sawtooth', gain: 0.18 });
      this._tone({ freq: 440, slideTo: 880, dur: 0.45, type: 'triangle', gain: 0.10 });
    }

    death(element) {
      const baseFreq = { fire: 220, water: 280, earth: 140, ice: 360, wind: 440 }[element] || 220;
      this._tone({ freq: baseFreq, slideTo: 60, dur: 0.6, type: 'sawtooth', gain: 0.20 });
      this._noise({ dur: 0.3, gain: 0.10, filter: 'lowpass', freq: 400 });
    }

    victory() {
      const seq = [523, 659, 784, 1047];
      seq.forEach((f, i) => setTimeout(() => this._tone({ freq: f, dur: 0.25, type: 'triangle', gain: 0.20 }), i * 120));
    }

    fail() {
      const seq = [440, 392, 330, 220];
      seq.forEach((f, i) => setTimeout(() => this._tone({ freq: f, dur: 0.3, type: 'sawtooth', gain: 0.16 }), i * 150));
    }

    elementBurst(element) {
      const profiles = {
        fire:  { f: 90,  s: 200, dur: 0.4, type: 'sawtooth', noise: true,  nf: 600, ng: 0.18 },
        water: { f: 220, s: 880, dur: 0.3, type: 'sine',     noise: true,  nf: 1800, ng: 0.10 },
        earth: { f: 60,  s: 30,  dur: 0.45, type: 'square',  noise: true,  nf: 200, ng: 0.20 },
        ice:   { f: 800, s: 1600,dur: 0.25, type: 'triangle',noise: true,  nf: 3500, ng: 0.08 },
        wind:  { f: 600, s: 1200,dur: 0.3, type: 'sine',     noise: true,  nf: 2400, ng: 0.12, q: 5 },
      };
      const p = profiles[element] || profiles.fire;
      this._tone({ freq: p.f, slideTo: p.s, dur: p.dur, type: p.type, gain: 0.16 });
      if (p.noise) this._noise({ dur: p.dur, gain: p.ng, filter: 'bandpass', freq: p.nf, q: p.q || 1 });
    }

    splash() { this._noise({ dur: 0.18, gain: 0.18, filter: 'lowpass', freq: 1400 }); this._tone({ freq: 320, slideTo: 180, dur: 0.18, type: 'sine', gain: 0.10 }); }
    melt()   { this._tone({ freq: 220, slideTo: 80, dur: 0.6, type: 'sawtooth', gain: 0.10 }); this._noise({ dur: 0.5, gain: 0.05, filter: 'lowpass', freq: 800 }); }
    freeze() { this._tone({ freq: 1200, slideTo: 1800, dur: 0.4, type: 'triangle', gain: 0.10 }); this._noise({ dur: 0.3, gain: 0.05, filter: 'highpass', freq: 4000 }); }
    burn()   { this._noise({ dur: 0.35, gain: 0.14, filter: 'lowpass', freq: 600 }); this._tone({ freq: 90, dur: 0.4, type: 'sawtooth', gain: 0.08 }); }
    glide()  { this._noise({ dur: 0.4, gain: 0.06, filter: 'bandpass', freq: 2200, q: 4 }); }

    menuHover() { this._tone({ freq: 720, dur: 0.05, type: 'sine', gain: 0.06 }); }
    menuClick() { this._tone({ freq: 540, dur: 0.08, type: 'square', gain: 0.10 }); this._tone({ freq: 360, dur: 0.06, type: 'triangle', gain: 0.06 }); }
    menuBack()  { this._tone({ freq: 360, dur: 0.08, type: 'square', gain: 0.08 }); }

    // ----------------------------------------------------------
    // Background music — generative, layered, mood-based
    // ----------------------------------------------------------
    startMusic(mood = 'menu') {
      if (!this.ctx) return;
      this.stopMusic();
      this.currentMusic = mood;
      this.musicPlaying = true;

      const ctx = this.ctx;
      const baseFreqs = {
        menu:   { root: 220, scale: [0, 2, 3, 5, 7, 8, 10], bpm: 90 },
        lobby:  { root: 261, scale: [0, 2, 4, 5, 7, 9, 11], bpm: 100 },
        game1:  { root: 196, scale: [0, 2, 3, 5, 7, 8, 10], bpm: 120 },
        game2:  { root: 174, scale: [0, 2, 3, 5, 7, 8, 10], bpm: 130 },
        boss:   { root: 146, scale: [0, 1, 3, 5, 7, 8, 11], bpm: 145 },
        win:    { root: 261, scale: [0, 2, 4, 5, 7, 9, 11], bpm: 110 },
        lose:   { root: 174, scale: [0, 1, 3, 5, 6, 8, 10], bpm: 70  },
      };
      const cfg = baseFreqs[mood] || baseFreqs.menu;
      const beatDur = 60 / cfg.bpm;

      // Pad layer (continuous)
      const padOsc1 = ctx.createOscillator();
      const padOsc2 = ctx.createOscillator();
      const padGain = ctx.createGain();
      const padFilter = ctx.createBiquadFilter();
      padOsc1.type = 'sine'; padOsc2.type = 'triangle';
      padOsc1.frequency.value = cfg.root;
      padOsc2.frequency.value = cfg.root * 1.5;
      padFilter.type = 'lowpass'; padFilter.frequency.value = 600; padFilter.Q.value = 1;
      padGain.gain.value = 0;
      padGain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 1.5);
      padOsc1.connect(padFilter); padOsc2.connect(padFilter);
      padFilter.connect(padGain).connect(this.musicGain);
      padOsc1.start(); padOsc2.start();
      this.musicNodes.push(padOsc1, padOsc2);

      // Arp / melody scheduler
      let step = 0;
      const playArp = () => {
        if (!this.musicPlaying) return;
        const note = cfg.scale[step % cfg.scale.length];
        const oct = (Math.floor(step / cfg.scale.length) % 2) ? 1 : 2;
        const freq = cfg.root * Math.pow(2, note / 12) * oct;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = mood === 'boss' ? 'sawtooth' : 'triangle';
        osc.frequency.value = freq;
        const t0 = ctx.currentTime;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.05, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + beatDur * 0.9);
        osc.connect(g).connect(this.musicGain);
        osc.start(t0);
        osc.stop(t0 + beatDur);
        step++;
        // Percussion on boss mood
        if (mood === 'boss' && step % 2 === 0) {
          this._noise({ dur: 0.1, gain: 0.08, filter: 'lowpass', freq: 200, dest: this.musicGain });
        }
        this._musicTimer = setTimeout(playArp, beatDur * 1000 * (mood === 'game2' ? 0.5 : 0.5));
      };
      // Start arp after a beat
      this._musicTimer = setTimeout(playArp, beatDur * 1000);

      // Bass on downbeats
      const playBass = () => {
        if (!this.musicPlaying) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = cfg.root * 0.5;
        const t0 = ctx.currentTime;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.10, t0 + 0.05);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + beatDur * 1.8);
        osc.connect(g).connect(this.musicGain);
        osc.start(t0); osc.stop(t0 + beatDur * 2);
        this._bassTimer = setTimeout(playBass, beatDur * 2000);
      };
      this._bassTimer = setTimeout(playBass, beatDur * 1000);

      // Store stoppers
      this._padGain = padGain;
    }

    stopMusic() {
      this.musicPlaying = false;
      if (this._musicTimer) { clearTimeout(this._musicTimer); this._musicTimer = null; }
      if (this._bassTimer)  { clearTimeout(this._bassTimer);  this._bassTimer = null; }
      const ctx = this.ctx;
      if (this._padGain && ctx) {
        try {
          this._padGain.gain.cancelScheduledValues(ctx.currentTime);
          this._padGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
        } catch (e) {}
      }
      this.musicNodes.forEach(n => {
        try { n.stop(ctx.currentTime + 0.5); } catch (e) {}
      });
      this.musicNodes = [];
    }

    setMusicMood(mood) {
      if (this.currentMusic !== mood) this.startMusic(mood);
    }
  }

  global.AudioEngine = AudioEngine;
  global.audio = new AudioEngine();
})(window);
