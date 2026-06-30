/* ============================================================
   ELEMENTAL QUEST — particles.js
   Object-pooled particle engine for all element effects.
   ============================================================ */
(function (global) {
  'use strict';

  // Particle pool size per quality setting
  const POOL_SIZES = { low: 200, med: 500, high: 1200 };

  class Particle {
    constructor() { this.active = false; this.reset(); }
    reset() {
      this.x = 0; this.y = 0;
      this.vx = 0; this.vy = 0;
      this.life = 0; this.maxLife = 1;
      this.size = 4;
      this.color = '#ffffff';
      this.alpha = 1;
      this.gravity = 0;
      this.drag = 0.98;
      this.rotation = 0;
      this.rotSpeed = 0;
      this.type = 'circle'; // circle, square, streak, glow, spark
      this.glow = 0;
      this.fade = true;
      this.shrink = false;
      this.bounce = 0;
      this.floorY = null;
    }
  }

  class ParticleSystem {
    constructor() {
      this.pool = [];
      this.quality = 'med';
      this.maxParticles = POOL_SIZES.med;
      this.cursor = 0;
      this._expandPool(POOL_SIZES.med);
      this.activeCount = 0;
    }

    _expandPool(n) {
      for (let i = this.pool.length; i < n; i++) this.pool.push(new Particle());
    }

    setQuality(q) {
      this.quality = q;
      this.maxParticles = POOL_SIZES[q] || POOL_SIZES.med;
      if (this.pool.length < this.maxParticles) this._expandPool(this.maxParticles);
    }

    _acquire() {
      // Round-robin search for inactive particle
      for (let i = 0; i < this.pool.length; i++) {
        const idx = (this.cursor + i) % this.pool.length;
        if (!this.pool[idx].active) {
          this.cursor = (idx + 1) % this.pool.length;
          const p = this.pool[idx];
          p.reset();
          p.active = true;
          return p;
        }
      }
      // Pool exhausted: reuse oldest
      const p = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % this.pool.length;
      p.reset();
      p.active = true;
      return p;
    }

    spawn(opts) {
      const p = this._acquire();
      Object.assign(p, opts);
      p.active = true;
      if (p.maxLife <= 0) p.maxLife = 1;
      return p;
    }

    // ---------- High-level emitters ----------
    burst(opts) {
      const { x, y, count = 12, color = '#ffffff', speed = 200, size = 4, life = 0.6, gravity = 0, type = 'circle', glow = 0, spread = Math.PI * 2, angle = 0, drag = 0.94 } = opts;
      for (let i = 0; i < count; i++) {
        const a = angle + (Math.random() - 0.5) * spread;
        const s = speed * (0.5 + Math.random() * 0.8);
        this.spawn({
          x, y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s,
          life: life * (0.6 + Math.random() * 0.8),
          maxLife: life,
          size: size * (0.6 + Math.random() * 0.8),
          color, type, glow, gravity, drag,
          shrink: true, fade: true,
          rotation: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 10,
        });
      }
    }

    fireEmitter(x, y, intensity = 1) {
      const count = Math.ceil(2 * intensity);
      for (let i = 0; i < count; i++) {
        const colors = ['#ff5e3a', '#ffb238', '#ff7a3a', '#ffd166'];
        this.spawn({
          x: x + (Math.random() - 0.5) * 12,
          y: y + (Math.random() - 0.5) * 4,
          vx: (Math.random() - 0.5) * 30,
          vy: -50 - Math.random() * 60,
          life: 0.5 + Math.random() * 0.4,
          maxLife: 0.9,
          size: 4 + Math.random() * 4,
          color: colors[(Math.random() * colors.length) | 0],
          type: 'glow', glow: 12,
          gravity: -40, drag: 0.96,
          shrink: true, fade: true,
        });
      }
    }

    waterSplash(x, y, intensity = 1) {
      const count = Math.ceil(6 * intensity);
      for (let i = 0; i < count; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI;
        const s = 80 + Math.random() * 140;
        this.spawn({
          x, y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s,
          life: 0.5 + Math.random() * 0.4,
          maxLife: 0.9,
          size: 3 + Math.random() * 3,
          color: ['#6ef0ff', '#36c5ff', '#a8e8ff'][(Math.random() * 3) | 0],
          type: 'circle', glow: 6,
          gravity: 400, drag: 0.98,
          shrink: true, fade: true,
        });
      }
    }

    iceShatter(x, y) {
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 80 + Math.random() * 180;
        this.spawn({
          x, y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s - 60,
          life: 0.6 + Math.random() * 0.4,
          maxLife: 1.0,
          size: 4 + Math.random() * 5,
          color: ['#d8f6ff', '#8ee6ff', '#bce8ff'][(Math.random() * 3) | 0],
          type: 'square', glow: 4,
          gravity: 350, drag: 0.98,
          shrink: true, fade: true,
          rotation: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 16,
        });
      }
    }

    windStreak(x, y, dir = 1) {
      for (let i = 0; i < 3; i++) {
        this.spawn({
          x: x + (Math.random() - 0.5) * 20,
          y: y + (Math.random() - 0.5) * 20,
          vx: dir * (120 + Math.random() * 80),
          vy: (Math.random() - 0.5) * 20,
          life: 0.3 + Math.random() * 0.2,
          maxLife: 0.5,
          size: 8 + Math.random() * 6,
          color: 'rgba(220, 235, 255, 0.6)',
          type: 'streak', glow: 0,
          gravity: 0, drag: 0.99,
          shrink: true, fade: true,
        });
      }
    }

    earthDust(x, y, intensity = 1) {
      const count = Math.ceil(4 * intensity);
      for (let i = 0; i < count; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4;
        const s = 30 + Math.random() * 80;
        this.spawn({
          x, y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s,
          life: 0.5 + Math.random() * 0.5,
          maxLife: 1.0,
          size: 4 + Math.random() * 4,
          color: ['#8b6a3a', '#a07d45', '#5e4322'][(Math.random() * 3) | 0],
          type: 'circle', glow: 0,
          gravity: 100, drag: 0.92,
          shrink: false, fade: true,
        });
      }
    }

    magicActivate(x, y, color = '#ffd166') {
      // Ring + sparks
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        const s = 120 + Math.random() * 40;
        this.spawn({
          x, y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s,
          life: 0.5, maxLife: 0.5,
          size: 4, color,
          type: 'spark', glow: 8,
          gravity: 0, drag: 0.95,
          shrink: true, fade: true,
        });
      }
      this.spawn({
        x, y, vx: 0, vy: 0,
        life: 0.4, maxLife: 0.4,
        size: 30, color, type: 'glow', glow: 30,
        gravity: 0, drag: 1, shrink: true, fade: true,
      });
    }

    explosion(x, y, color = '#ff5e3a') {
      this.burst({ x, y, count: 24, color, speed: 280, size: 6, life: 0.8, glow: 12, type: 'glow', gravity: 100 });
      this.burst({ x, y, count: 12, color: '#fff8b0', speed: 200, size: 4, life: 0.5, glow: 8, type: 'spark' });
      // Smoke
      for (let i = 0; i < 8; i++) {
        this.spawn({
          x: x + (Math.random() - 0.5) * 20, y: y + (Math.random() - 0.5) * 20,
          vx: (Math.random() - 0.5) * 60,
          vy: -40 - Math.random() * 40,
          life: 1.0 + Math.random() * 0.5, maxLife: 1.5,
          size: 8 + Math.random() * 8, color: 'rgba(60, 60, 70, 0.6)',
          type: 'circle', glow: 0,
          gravity: -20, drag: 0.96,
          shrink: false, fade: true,
        });
      }
    }

    trail(x, y, color, vx = 0, vy = 0, type = 'glow') {
      this.spawn({
        x, y, vx, vy,
        life: 0.3, maxLife: 0.3,
        size: 4, color, type, glow: 6,
        gravity: 0, drag: 0.9,
        shrink: true, fade: true,
      });
    }

    ambient(x, y, color, type = 'dust') {
      // Slow drifting ambient particle
      this.spawn({
        x, y,
        vx: (Math.random() - 0.5) * 10,
        vy: -10 - Math.random() * 20,
        life: 2 + Math.random() * 2, maxLife: 4,
        size: 1 + Math.random() * 2, color,
        type: 'circle', glow: 0,
        gravity: -2, drag: 0.99,
        shrink: false, fade: true,
      });
    }

    // ---------- Update ----------
    update(dt) {
      let count = 0;
      for (let i = 0; i < this.pool.length; i++) {
        const p = this.pool[i];
        if (!p.active) continue;
        count++;
        p.life -= dt;
        if (p.life <= 0) { p.active = false; continue; }
        p.vy += p.gravity * dt;
        p.vx *= Math.pow(p.drag, dt * 60);
        p.vy *= Math.pow(p.drag, dt * 60);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rotation += p.rotSpeed * dt;
        // Bounce off floor if specified
        if (p.bounce > 0 && p.floorY !== null && p.y > p.floorY) {
          p.y = p.floorY;
          p.vy = -p.vy * p.bounce;
          p.vx *= 0.8;
        }
        const t = p.life / p.maxLife;
        if (p.fade) p.alpha = Math.max(0, Math.min(1, t));
        if (p.shrink) p.size = Math.max(0.1, p.size * (0.5 + 0.5 * t));
      }
      this.activeCount = count;
    }

    // ---------- Render ----------
    render(ctx, camera) {
      ctx.save();
      // Use additive blending for glow particles
      const ox = -camera.x;
      const oy = -camera.y;
      const scale = camera.zoom;
      ctx.translate(ox, oy);
      ctx.scale(scale, scale);

      // First pass: additive glow
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < this.pool.length; i++) {
        const p = this.pool[i];
        if (!p.active) continue;
        if (p.glow <= 0 && p.type !== 'spark' && p.type !== 'streak') continue;
        this._drawParticle(ctx, p);
      }

      // Second pass: normal
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < this.pool.length; i++) {
        const p = this.pool[i];
        if (!p.active) continue;
        if (p.glow > 0 || p.type === 'spark' || p.type === 'streak') continue;
        this._drawParticle(ctx, p);
      }
      ctx.restore();
    }

    _drawParticle(ctx, p) {
      const a = p.alpha;
      if (a <= 0) return;
      ctx.globalAlpha = a;
      switch (p.type) {
        case 'circle':
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'square':
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
          ctx.restore();
          break;
        case 'streak': {
          // Elongated streak in direction of motion
          const len = Math.hypot(p.vx, p.vy) * 0.04;
          const ang = Math.atan2(p.vy, p.vx);
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(ang);
          ctx.fillStyle = p.color;
          ctx.fillRect(-len, -p.size * 0.2, len * 2, p.size * 0.4);
          ctx.restore();
          break;
        }
        case 'glow': {
          const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * (1 + p.glow * 0.3));
          grd.addColorStop(0, p.color);
          grd.addColorStop(0.4, p.color);
          grd.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = grd;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 + p.glow * 0.3), 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'spark': {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(Math.atan2(p.vy, p.vx));
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size * 1.5, -p.size * 0.3, p.size * 3, p.size * 0.6);
          ctx.restore();
          break;
        }
      }
      ctx.globalAlpha = 1;
    }

    clear() {
      for (const p of this.pool) p.active = false;
      this.activeCount = 0;
    }
  }

  global.ParticleSystem = ParticleSystem;
  global.particles = new ParticleSystem();
})(window);
