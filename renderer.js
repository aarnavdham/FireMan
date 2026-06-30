/* ============================================================
   ELEMENTAL QUEST — renderer.js
   Canvas 2D rendering: parallax backgrounds, dynamic lighting,
   glow, screen shake, camera follow, animated environment.
   ============================================================ */
(function (global) {
  'use strict';

  const ELEMENT_COLORS = {
    fire:  { main: '#ff5e3a', glow: '#ffb238', light: 'rgba(255, 94, 58, 0.4)' },
    water: { main: '#36c5ff', glow: '#6ef0ff', light: 'rgba(54, 197, 255, 0.4)' },
    earth: { main: '#b9853d', glow: '#6cbf5e', light: 'rgba(185, 133, 61, 0.4)' },
    ice:   { main: '#8ee6ff', glow: '#d8f6ff', light: 'rgba(142, 230, 255, 0.4)' },
    wind:  { main: '#e6f0ff', glow: '#b6c8e6', light: 'rgba(230, 240, 255, 0.4)' },
  };

  class Camera {
    constructor() {
      this.x = 0; this.y = 0;
      this.targetX = 0; this.targetY = 0;
      this.zoom = 1; this.targetZoom = 1;
      this.shakeX = 0; this.shakeY = 0;
      this.shakeTime = 0; this.shakeMag = 0;
      this.viewportW = 1280; this.viewportH = 720;
    }
    follow(x, y, multipleTargets = []) {
      // Center on centroid of targets if multiple
      if (multipleTargets.length > 0) {
        let cx = 0, cy = 0, n = 0;
        for (const t of multipleTargets) { cx += t.x; cy += t.y; n++; }
        cx /= n; cy /= n;
        this.targetX = cx - this.viewportW / (2 * this.zoom);
        this.targetY = cy - this.viewportH / (2 * this.zoom);
      } else {
        this.targetX = x - this.viewportW / (2 * this.zoom);
        this.targetY = y - this.viewportH / (2 * this.zoom);
      }
    }
    update(dt) {
      // Smooth follow
      const lerp = 1 - Math.pow(0.001, dt);
      this.x += (this.targetX - this.x) * lerp;
      this.y += (this.targetY - this.y) * lerp;
      this.zoom += (this.targetZoom - this.zoom) * lerp;
      // Shake
      if (this.shakeTime > 0) {
        this.shakeTime -= dt;
        const mag = this.shakeMag * (this.shakeTime / 0.4);
        this.shakeX = (Math.random() - 0.5) * mag;
        this.shakeY = (Math.random() - 0.5) * mag;
      } else {
        this.shakeX *= 0.85; this.shakeY *= 0.85;
      }
    }
    shake(mag = 8, dur = 0.4) {
      this.shakeMag = Math.max(this.shakeMag, mag);
      this.shakeTime = Math.max(this.shakeTime, dur);
    }
    setZoom(z) { this.targetZoom = z; }
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.camera = new Camera();
      this.time = 0;
      this.showFps = false;
      this.fpsHistory = [];
      this.lastFrameTime = performance.now();
      this._parallaxOffset = 0;
      this._resize();
      window.addEventListener('resize', () => this._resize());
    }

    _resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.camera.viewportW = w;
      this.camera.viewportH = h;
      this.dpr = dpr;
    }

    shake(mag, dur) { this.camera.shake(mag, dur); }

    setZoom(z) { this.camera.targetZoom = z; }

    // ----------------------------------------------------------
    // Main render entry
    // ----------------------------------------------------------
    render(scene) {
      const ctx = this.ctx;
      const cam = this.camera;
      const now = performance.now();
      const dt = (now - this.lastFrameTime) / 1000;
      this.lastFrameTime = now;
      this.time += dt;
      this.fpsHistory.push(1 / Math.max(dt, 0.001));
      if (this.fpsHistory.length > 30) this.fpsHistory.shift();

      // Background fill (clear)
      ctx.fillStyle = '#05060a';
      ctx.fillRect(0, 0, this.camera.viewportW, this.camera.viewportH);

      if (!scene) return;

      // Parallax background
      this._renderParallax(ctx, scene, cam);

      // World transform
      ctx.save();
      ctx.translate(-cam.x + cam.shakeX, -cam.y + cam.shakeY);
      ctx.scale(cam.zoom, cam.zoom);

      // Render level tiles / solids
      this._renderSolids(ctx, scene, cam);

      // Render hazards
      this._renderHazards(ctx, scene, cam);

      // Render water/wind zones
      this._renderZones(ctx, scene, cam);

      // Render interactive objects (doors, switches, gems, exits)
      this._renderObjects(ctx, scene, cam);

      // Render boxes
      this._renderBoxes(ctx, scene, cam);

      // Render bodies (players)
      this._renderBodies(ctx, scene, cam);

      // Render particles (additive + normal passes)
      if (global.particles) global.particles.render(ctx, cam);

      ctx.restore();

      // Lighting overlay (darkness mask + element light sources)
      this._renderLighting(ctx, scene, cam);

      // Vignette
      this._renderVignette(ctx);

      // FPS counter
      if (this.showFps) this._renderFps(ctx);
    }

    // ----------------------------------------------------------
    // Parallax background — multi-layer with theme-specific silhouettes
    // ----------------------------------------------------------
    _renderParallax(ctx, scene, cam) {
      const theme = scene.theme || 'cave';
      // Sky / far background — richer gradients with more stops
      const gradients = {
        cave:   ['#08060f', '#15102a', '#1d1838', '#120e22', '#08060f'],
        forest: ['#06120c', '#0e2418', '#1a3a26', '#0e2418', '#06120c'],
        ice:    ['#06122a', '#0e2450', '#1a4070', '#0e2450', '#06122a'],
        fire:   ['#180404', '#2e0a08', '#4a1810', '#2e0a08', '#180404'],
        sky:    ['#06102a', '#0e2050', '#1a4080', '#2a60b0', '#1a4080'],
        temple: ['#180818', '#2a1030', '#3a1845', '#2a1030', '#180818'],
      };
      const cols = gradients[theme] || gradients.cave;
      const grd = ctx.createLinearGradient(0, 0, 0, this.camera.viewportH);
      const stops = cols.length;
      for (let i = 0; i < stops; i++) grd.addColorStop(i / (stops - 1), cols[i]);
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, this.camera.viewportW, this.camera.viewportH);

      // Theme-specific far layer (stars/sun/moon)
      this._renderFarLayer(ctx, theme, cam);

      // Far parallax silhouettes — theme-specific shapes
      const farShapes = {
        cave:   { color: 'rgba(10, 8, 20, 0.7)',   spacing: 220, baseY: 0.62, heightFn: i => 160 + Math.sin(i * 1.3) * 50, type: 'mountain' },
        forest: { color: 'rgba(8, 18, 12, 0.7)',   spacing: 180, baseY: 0.68, heightFn: i => 140 + Math.sin(i * 0.9) * 60, type: 'tree' },
        ice:    { color: 'rgba(10, 24, 50, 0.7)',  spacing: 200, baseY: 0.60, heightFn: i => 180 + Math.sin(i * 1.1) * 70, type: 'icicle' },
        fire:   { color: 'rgba(30, 8, 4, 0.7)',    spacing: 240, baseY: 0.65, heightFn: i => 150 + Math.sin(i * 1.5) * 40, type: 'volcano' },
        sky:    { color: 'rgba(14, 32, 80, 0.5)',  spacing: 260, baseY: 0.55, heightFn: i => 120 + Math.sin(i * 0.7) * 80, type: 'cloud' },
        temple: { color: 'rgba(26, 16, 40, 0.7)',  spacing: 200, baseY: 0.62, heightFn: i => 170 + Math.sin(i * 1.2) * 50, type: 'pillar' },
      };
      const far = farShapes[theme] || farShapes.cave;
      const px = -cam.x * 0.15;
      ctx.fillStyle = far.color;
      ctx.beginPath();
      const baseY = this.camera.viewportH * far.baseY;
      ctx.moveTo(0, this.camera.viewportH);
      for (let i = -2; i < 14; i++) {
        const x = ((i * far.spacing + px) % (this.camera.viewportW + far.spacing * 2)) - far.spacing;
        const h = far.heightFn(i);
        this._drawFarShape(ctx, x, baseY, far.spacing, h, far.type);
      }
      ctx.lineTo(this.camera.viewportW, this.camera.viewportH);
      ctx.closePath();
      ctx.fill();

      // Mid parallax — closer, darker
      const midShapes = {
        cave:   { color: 'rgba(5, 4, 10, 0.8)',   spacing: 160, baseY: 0.78, heightFn: i => 90 + Math.sin(i * 0.9 + 1) * 35 },
        forest: { color: 'rgba(4, 10, 6, 0.8)',   spacing: 140, baseY: 0.80, heightFn: i => 80 + Math.sin(i * 1.1) * 30 },
        ice:    { color: 'rgba(6, 16, 36, 0.8)',  spacing: 150, baseY: 0.76, heightFn: i => 100 + Math.sin(i * 0.8) * 40 },
        fire:   { color: 'rgba(20, 4, 2, 0.8)',   spacing: 170, baseY: 0.78, heightFn: i => 85 + Math.sin(i * 1.3) * 30 },
        sky:    { color: 'rgba(10, 24, 60, 0.6)', spacing: 180, baseY: 0.72, heightFn: i => 70 + Math.sin(i * 0.6) * 25 },
        temple: { color: 'rgba(18, 10, 28, 0.8)', spacing: 150, baseY: 0.78, heightFn: i => 95 + Math.sin(i * 1.0) * 35 },
      };
      const mid = midShapes[theme] || midShapes.cave;
      const px2 = -cam.x * 0.35;
      ctx.fillStyle = mid.color;
      ctx.beginPath();
      const baseY2 = this.camera.viewportH * mid.baseY;
      ctx.moveTo(0, this.camera.viewportH);
      for (let i = -2; i < 16; i++) {
        const x = ((i * mid.spacing + px2) % (this.camera.viewportW + mid.spacing * 2)) - mid.spacing;
        const h = mid.heightFn(i);
        ctx.lineTo(x, baseY2);
        ctx.lineTo(x + mid.spacing / 2, baseY2 - h);
        ctx.lineTo(x + mid.spacing, baseY2);
      }
      ctx.lineTo(this.camera.viewportW, this.camera.viewportH);
      ctx.closePath();
      ctx.fill();

      // Atmospheric fog (theme-tinted)
      const fogColors = {
        cave:   'rgba(40, 30, 60, 0.15)',
        forest: 'rgba(40, 80, 50, 0.12)',
        ice:    'rgba(120, 180, 220, 0.12)',
        fire:   'rgba(120, 40, 20, 0.18)',
        sky:    'rgba(120, 160, 220, 0.15)',
        temple: 'rgba(80, 50, 90, 0.15)',
      };
      const fogColor = fogColors[theme] || fogColors.cave;
      const fogGrd = ctx.createLinearGradient(0, this.camera.viewportH * 0.5, 0, this.camera.viewportH);
      fogGrd.addColorStop(0, 'rgba(0,0,0,0)');
      fogGrd.addColorStop(1, fogColor);
      ctx.fillStyle = fogGrd;
      ctx.fillRect(0, this.camera.viewportH * 0.5, this.camera.viewportW, this.camera.viewportH * 0.5);

      // Ambient floating particles (theme-tinted)
      if (global.particles && Math.random() < 0.35) {
        const cx = cam.x + Math.random() * this.camera.viewportW / cam.zoom;
        const cy = cam.y + Math.random() * this.camera.viewportH / cam.zoom;
        const color = { fire: '#ff7a3a', water: '#6ef0ff', ice: '#d8f6ff', forest: '#6cbf5e', cave: '#8a93a8', sky: '#b6c8e6', temple: '#ffd166' }[theme] || '#8a93a8';
        global.particles.ambient(cx, cy, color);
      }
    }

    /** Theme-specific far background elements (stars, sun, etc.) */
    _renderFarLayer(ctx, theme, cam) {
      if (theme === 'sky') {
        // Sun glow
        const sunX = this.camera.viewportW * 0.75;
        const sunY = this.camera.viewportH * 0.25;
        const sunGrd = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 120);
        sunGrd.addColorStop(0, 'rgba(255, 230, 180, 0.6)');
        sunGrd.addColorStop(0.4, 'rgba(255, 200, 140, 0.3)');
        sunGrd.addColorStop(1, 'rgba(255, 180, 100, 0)');
        ctx.fillStyle = sunGrd;
        ctx.fillRect(sunX - 120, sunY - 120, 240, 240);
        // Sun disc
        ctx.fillStyle = 'rgba(255, 240, 200, 0.8)';
        ctx.beginPath();
        ctx.arc(sunX, sunY, 28, 0, Math.PI * 2);
        ctx.fill();
      } else if (theme === 'cave' || theme === 'temple') {
        // Stars / glowing dots
        const seed = Math.floor(cam.x * 0.01);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        for (let i = 0; i < 40; i++) {
          const sx = ((i * 137 + seed * 13) % this.camera.viewportW);
          const sy = ((i * 89) % (this.camera.viewportH * 0.6));
          const twinkle = 0.3 + Math.sin(this.time * 2 + i) * 0.2;
          ctx.globalAlpha = twinkle;
          ctx.beginPath();
          ctx.arc(sx, sy, 1 + (i % 3) * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else if (theme === 'fire') {
        // Ember glow at bottom
        const emberGrd = ctx.createLinearGradient(0, this.camera.viewportH * 0.7, 0, this.camera.viewportH);
        emberGrd.addColorStop(0, 'rgba(0,0,0,0)');
        emberGrd.addColorStop(1, 'rgba(255, 80, 20, 0.25)');
        ctx.fillStyle = emberGrd;
        ctx.fillRect(0, this.camera.viewportH * 0.7, this.camera.viewportW, this.camera.viewportH * 0.3);
      } else if (theme === 'ice') {
        // Aurora effect
        ctx.globalAlpha = 0.15;
        for (let i = 0; i < 3; i++) {
          const auroraY = this.camera.viewportH * (0.15 + i * 0.08);
          const auroraGrd = ctx.createLinearGradient(0, auroraY - 20, 0, auroraY + 20);
          auroraGrd.addColorStop(0, 'rgba(100, 200, 255, 0)');
          auroraGrd.addColorStop(0.5, i === 0 ? 'rgba(140, 230, 255, 0.8)' : i === 1 ? 'rgba(180, 140, 255, 0.6)' : 'rgba(140, 255, 200, 0.5)');
          auroraGrd.addColorStop(1, 'rgba(100, 200, 255, 0)');
          ctx.fillStyle = auroraGrd;
          ctx.beginPath();
          ctx.moveTo(0, auroraY);
          for (let x = 0; x <= this.camera.viewportW; x += 20) {
            ctx.lineTo(x, auroraY + Math.sin(this.time * 0.5 + x * 0.01 + i) * 15);
          }
          ctx.lineTo(this.camera.viewportW, auroraY + 30);
          ctx.lineTo(0, auroraY + 30);
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }

    /** Draw a single far-layer silhouette shape. */
    _drawFarShape(ctx, x, baseY, spacing, h, type) {
      const half = spacing / 2;
      switch (type) {
        case 'mountain':
          ctx.lineTo(x, baseY);
          ctx.lineTo(x + half * 0.5, baseY - h * 0.7);
          ctx.lineTo(x + half, baseY - h);
          ctx.lineTo(x + half * 1.5, baseY - h * 0.6);
          ctx.lineTo(x + spacing, baseY);
          break;
        case 'tree':
          ctx.lineTo(x, baseY);
          ctx.lineTo(x + half * 0.3, baseY - h * 0.4);
          ctx.lineTo(x + half * 0.5, baseY - h);
          ctx.lineTo(x + half * 0.7, baseY - h * 0.4);
          ctx.lineTo(x + spacing, baseY);
          break;
        case 'icicle':
          ctx.lineTo(x, baseY);
          ctx.lineTo(x + half * 0.3, baseY - h * 0.5);
          ctx.lineTo(x + half, baseY - h);
          ctx.lineTo(x + half * 1.7, baseY - h * 0.5);
          ctx.lineTo(x + spacing, baseY);
          break;
        case 'volcano':
          ctx.lineTo(x, baseY);
          ctx.lineTo(x + half * 0.4, baseY - h * 0.8);
          ctx.lineTo(x + half * 0.6, baseY - h);
          ctx.lineTo(x + half, baseY - h * 0.9);
          ctx.lineTo(x + half * 1.4, baseY - h * 0.7);
          ctx.lineTo(x + spacing, baseY);
          break;
        case 'cloud':
          ctx.lineTo(x, baseY);
          ctx.bezierCurveTo(x + half * 0.3, baseY - h * 0.6, x + half * 0.7, baseY - h, x + half, baseY - h * 0.8);
          ctx.bezierCurveTo(x + half * 1.3, baseY - h * 0.4, x + half * 1.7, baseY - h * 0.7, x + spacing, baseY);
          break;
        case 'pillar':
          ctx.lineTo(x, baseY);
          ctx.lineTo(x + half * 0.2, baseY - h);
          ctx.lineTo(x + half * 0.8, baseY - h);
          ctx.lineTo(x + spacing, baseY);
          break;
        default:
          ctx.lineTo(x, baseY);
          ctx.lineTo(x + half, baseY - h);
          ctx.lineTo(x + spacing, baseY);
      }
    }

    // ----------------------------------------------------------
    // Solids / tiles
    // ----------------------------------------------------------
    _renderSolids(ctx, scene, cam) {
      const world = scene.physics;
      // Cull to viewport
      const viewLeft = cam.x - 50, viewRight = cam.x + this.camera.viewportW / cam.zoom + 50;
      const viewTop = cam.y - 50, viewBottom = cam.y + this.camera.viewportH / cam.zoom + 50;
      for (const s of world.solids) {
        if (s.burned) continue;
        if (s.x + s.w < viewLeft || s.x > viewRight || s.y + s.h < viewTop || s.y > viewBottom) continue;
        this._drawTile(ctx, s);
      }
      // Moving platforms (drawn with motion trail)
      for (const p of world.movingPlatforms) {
        if (p.x + p.w < viewLeft || p.x > viewRight || p.y + p.h < viewTop || p.y > viewBottom) continue;
        this._drawPlatform(ctx, p);
      }
      // Slopes
      for (const s of world.slopes) {
        if (s.x + s.w < viewLeft || s.x > viewRight) continue;
        ctx.fillStyle = '#3a3550';
        ctx.beginPath();
        if (s.dir === 1) {
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(s.x + s.w, s.y + s.h);
          ctx.lineTo(s.x + s.w, s.y);
        } else {
          ctx.moveTo(s.x, s.y + s.h);
          ctx.lineTo(s.x + s.w, s.y);
          ctx.lineTo(s.x, s.y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    _drawTile(ctx, s) {
      const colors = {
        stone:  ['#2a2538', '#3a3550'],
        dirt:   ['#3a2818', '#4a3a20'],
        metal:  ['#2a2a3a', '#4a4a5a'],
        wood:   ['#3a2010', '#5a3520'],
        ice:    ['#4a8aa0', '#6ec0e0'],
        weak:   ['#3a2818', '#5a3a20'],
        platform: ['#2a3a5a', '#4a5a8a'],
      };
      const c = colors[s.type] || colors.stone;
      // Main fill with vertical gradient for depth
      const tileGrd = ctx.createLinearGradient(s.x, s.y, s.x, s.y + s.h);
      tileGrd.addColorStop(0, c[1]);
      tileGrd.addColorStop(0.3, c[0]);
      tileGrd.addColorStop(1, this._darken(c[0], 0.7));
      ctx.fillStyle = tileGrd;
      ctx.fillRect(s.x, s.y, s.w, s.h);
      // Top highlight (bright)
      ctx.fillStyle = this._lighten(c[1], 0.3);
      ctx.fillRect(s.x, s.y, s.w, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(s.x, s.y, s.w, 1);
      // Bottom shadow bevel
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(s.x, s.y + s.h - 4, s.w, 4);
      ctx.fillRect(s.x + s.w - 3, s.y, 3, s.h);
      // Texture pattern per type
      if (s.type === 'stone') {
        // Crystalline specks
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(s.x + 4, s.y + 8, 3, 3);
        ctx.fillRect(s.x + 16, s.y + 20, 3, 3);
        ctx.fillRect(s.x + 24, s.y + 10, 2, 2);
        // Subtle vein
        ctx.strokeStyle = 'rgba(0,0,0,0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y + 12);
        ctx.lineTo(s.x + 10, s.y + 14);
        ctx.lineTo(s.x + 20, s.y + 11);
        ctx.lineTo(s.x + s.w, s.y + 13);
        ctx.stroke();
      } else if (s.type === 'ice') {
        // Crystal facets
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.moveTo(s.x + 4, s.y + 4);
        ctx.lineTo(s.x + 12, s.y + 12);
        ctx.lineTo(s.x + 4, s.y + 20);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.moveTo(s.x + 20, s.y + 8);
        ctx.lineTo(s.x + 26, s.y + 16);
        ctx.lineTo(s.x + 20, s.y + 24);
        ctx.fill();
        // Glow
        const iceGrd = ctx.createRadialGradient(s.x + s.w/2, s.y + s.h/2, 0, s.x + s.w/2, s.y + s.h/2, s.w);
        iceGrd.addColorStop(0, 'rgba(140, 230, 255, 0.2)');
        iceGrd.addColorStop(1, 'rgba(140, 230, 255, 0)');
        ctx.fillStyle = iceGrd;
        ctx.fillRect(s.x, s.y, s.w, s.h);
      } else if (s.type === 'wood') {
        // Wood grain
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y + s.h * 0.35);
        ctx.bezierCurveTo(s.x + 8, s.y + s.h * 0.3, s.x + 20, s.y + s.h * 0.4, s.x + s.w, s.y + s.h * 0.35);
        ctx.moveTo(s.x, s.y + s.h * 0.65);
        ctx.bezierCurveTo(s.x + 10, s.y + s.h * 0.7, s.x + 22, s.y + s.h * 0.6, s.x + s.w, s.y + s.h * 0.65);
        ctx.stroke();
        // Knot
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.arc(s.x + 8, s.y + s.h * 0.5, 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (s.type === 'weak') {
        // Crack pattern — more elaborate
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(s.x + 6, s.y + 6);
        ctx.lineTo(s.x + 14, s.y + 16);
        ctx.lineTo(s.x + 10, s.y + 26);
        ctx.moveTo(s.x + 20, s.y + 4);
        ctx.lineTo(s.x + 24, s.y + 14);
        ctx.lineTo(s.x + 28, s.y + 24);
        ctx.moveTo(s.x + 4, s.y + 18);
        ctx.lineTo(s.x + 18, s.y + 22);
        ctx.stroke();
        // Warning glow
        ctx.fillStyle = 'rgba(255, 100, 50, 0.08)';
        ctx.fillRect(s.x, s.y, s.w, s.h);
      } else if (s.type === 'dirt') {
        // Pebble texture
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.arc(s.x + 6, s.y + 10, 2, 0, Math.PI * 2);
        ctx.arc(s.x + 18, s.y + 22, 1.5, 0, Math.PI * 2);
        ctx.arc(s.x + 26, s.y + 12, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.beginPath();
        ctx.arc(s.x + 10, s.y + 8, 1, 0, Math.PI * 2);
        ctx.arc(s.x + 22, s.y + 18, 1, 0, Math.PI * 2);
        ctx.fill();
      } else if (s.type === 'metal') {
        // Rivets
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        ctx.arc(s.x + 5, s.y + 5, 2, 0, Math.PI * 2);
        ctx.arc(s.x + s.w - 5, s.y + 5, 2, 0, Math.PI * 2);
        ctx.arc(s.x + 5, s.y + s.h - 5, 2, 0, Math.PI * 2);
        ctx.arc(s.x + s.w - 5, s.y + s.h - 5, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.arc(s.x + 5, s.y + 5, 1, 0, Math.PI * 2);
        ctx.arc(s.x + s.w - 5, s.y + 5, 1, 0, Math.PI * 2);
        ctx.fill();
      }
      if (s.temp) {
        // Temporary ice platform — fade as ttl decreases
        const alpha = Math.max(0, Math.min(1, (s.ttl || 0) / 6));
        ctx.fillStyle = `rgba(140, 230, 255, ${0.3 * alpha})`;
        ctx.fillRect(s.x, s.y, s.w, s.h);
        ctx.strokeStyle = `rgba(216, 246, 255, ${alpha})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(s.x, s.y, s.w, s.h);
      }
    }

    _drawPlatform(ctx, p) {
      // Glow trail
      ctx.fillStyle = 'rgba(74, 90, 138, 0.2)';
      ctx.fillRect(p.x - (p.dx || 0) * 4, p.y - (p.dy || 0) * 4, p.w, p.h);
      // Main
      ctx.fillStyle = '#2a3a5a';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = '#4a5a8a';
      ctx.fillRect(p.x, p.y, p.w, 4);
      ctx.fillStyle = '#6a8aca';
      ctx.fillRect(p.x, p.y, p.w, 2);
      // Direction arrows
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      const ax = p.x + p.w / 2, ay = p.y + p.h / 2;
      ctx.beginPath();
      if (p.axis === 'x') {
        ctx.moveTo(ax - 6, ay); ctx.lineTo(ax + 6, ay); ctx.lineTo(ax, ay - 4); ctx.closePath();
        ctx.moveTo(ax - 6, ay); ctx.lineTo(ax + 6, ay); ctx.lineTo(ax, ay + 4); ctx.closePath();
      } else if (p.axis === 'y') {
        ctx.moveTo(ax, ay - 6); ctx.lineTo(ax, ay + 6); ctx.lineTo(ax - 4, ay); ctx.closePath();
        ctx.moveTo(ax, ay - 6); ctx.lineTo(ax, ay + 6); ctx.lineTo(ax + 4, ay); ctx.closePath();
      }
      ctx.fill();
    }

    // ----------------------------------------------------------
    // Hazards
    // ----------------------------------------------------------
    _renderHazards(ctx, scene, cam) {
      const world = scene.physics;
      for (const h of world.hazards) {
        if (h.x + h.w < cam.x - 50 || h.x > cam.x + this.camera.viewportW / cam.zoom + 50) continue;
        if (h.type === 'lava') {
          // Animated lava
          const grd = ctx.createLinearGradient(h.x, h.y, h.x, h.y + h.h);
          grd.addColorStop(0, '#ffd166');
          grd.addColorStop(0.3, '#ff7a3a');
          grd.addColorStop(1, '#aa2a10');
          ctx.fillStyle = grd;
          ctx.fillRect(h.x, h.y, h.w, h.h);
          // Bubbling
          ctx.fillStyle = 'rgba(255, 209, 102, 0.6)';
          for (let i = 0; i < 3; i++) {
            const bx = h.x + ((this.time * 30 + i * 50) % h.w);
            const by = h.y + 4 + Math.sin(this.time * 3 + i) * 3;
            ctx.beginPath();
            ctx.arc(bx, by, 3 + Math.sin(this.time * 4 + i) * 2, 0, Math.PI * 2);
            ctx.fill();
          }
          // Glow on top
          ctx.fillStyle = 'rgba(255, 209, 102, 0.3)';
          ctx.fillRect(h.x, h.y - 8, h.w, 8);
        } else if (h.type === 'water') {
          const grd = ctx.createLinearGradient(h.x, h.y, h.x, h.y + h.h);
          grd.addColorStop(0, 'rgba(110, 240, 255, 0.7)');
          grd.addColorStop(1, 'rgba(20, 80, 140, 0.9)');
          ctx.fillStyle = grd;
          ctx.fillRect(h.x, h.y, h.w, h.h);
          // Wavy top
          ctx.fillStyle = 'rgba(110, 240, 255, 0.6)';
          ctx.beginPath();
          ctx.moveTo(h.x, h.y);
          for (let x = 0; x <= h.w; x += 8) {
            ctx.lineTo(h.x + x, h.y + Math.sin(this.time * 3 + x * 0.1) * 2);
          }
          ctx.lineTo(h.x + h.w, h.y - 4);
          ctx.lineTo(h.x, h.y - 4);
          ctx.closePath();
          ctx.fill();
        } else if (h.type === 'spikes') {
          ctx.fillStyle = '#8a93a8';
          ctx.fillRect(h.x, h.y + h.h - 6, h.w, 6);
          ctx.fillStyle = '#d8e0f0';
          const spikes = Math.floor(h.w / 8);
          for (let i = 0; i < spikes; i++) {
            ctx.beginPath();
            ctx.moveTo(h.x + i * 8, h.y + h.h - 4);
            ctx.lineTo(h.x + i * 8 + 4, h.y);
            ctx.lineTo(h.x + i * 8 + 8, h.y + h.h - 4);
            ctx.closePath();
            ctx.fill();
          }
          // Highlight
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          for (let i = 0; i < spikes; i++) {
            ctx.beginPath();
            ctx.moveTo(h.x + i * 8 + 3, h.y + 4);
            ctx.lineTo(h.x + i * 8 + 4, h.y);
            ctx.lineTo(h.x + i * 8 + 5, h.y + 4);
            ctx.closePath();
            ctx.fill();
          }
        }
      }
    }

    _renderZones(ctx, scene, cam) {
      const world = scene.physics;
      // Shallow water (.)
      for (const wz of world.waterZones) {
        if (wz.deep) continue;
        ctx.fillStyle = 'rgba(54, 197, 255, 0.3)';
        ctx.fillRect(wz.x, wz.y, wz.w, wz.h);
        ctx.fillStyle = 'rgba(110, 240, 255, 0.5)';
        ctx.fillRect(wz.x, wz.y, wz.w, 3);
      }
      // Wind zones
      for (const wz of world.windZones) {
        ctx.fillStyle = 'rgba(230, 240, 255, 0.08)';
        ctx.fillRect(wz.x, wz.y, wz.w, wz.h);
        // Animated streaks
        ctx.strokeStyle = 'rgba(230, 240, 255, 0.4)';
        ctx.lineWidth = 1.5;
        const dir = wz.dir || 1;
        for (let i = 0; i < 5; i++) {
          const y = wz.y + ((i * 30 + this.time * 100 * dir) % wz.h);
          const x1 = wz.x + ((this.time * 200 * dir + i * 50) % wz.w);
          ctx.beginPath();
          ctx.moveTo(x1, y);
          ctx.lineTo(x1 + 20 * dir, y);
          ctx.stroke();
        }
      }
    }

    // ----------------------------------------------------------
    // Interactive objects
    // ----------------------------------------------------------
    _renderObjects(ctx, scene, cam) {
      if (!scene.objects) return;
      for (const obj of scene.objects) {
        if (obj.type === 'door') this._drawDoor(ctx, obj);
        else if (obj.type === 'switch') this._drawSwitch(ctx, obj);
        else if (obj.type === 'gem') this._drawGem(ctx, obj);
        else if (obj.type === 'exit') this._drawExit(ctx, obj);
        else if (obj.type === 'lever') this._drawLever(ctx, obj);
        else if (obj.type === 'portal') this._drawPortal(ctx, obj);
        else if (obj.type === 'laser') this._drawLaser(ctx, obj, scene);
        else if (obj.type === 'button') this._drawButton(ctx, obj);
        else if (obj.type === 'collectible') this._drawCollectible(ctx, obj);
      }
    }

    _drawDoor(ctx, d) {
      const c = ELEMENT_COLORS[d.element] || ELEMENT_COLORS.fire;
      // Frame
      ctx.fillStyle = '#1a2030';
      ctx.fillRect(d.x - 4, d.y - 4, d.w + 8, d.h + 8);
      // Door body (slides open based on d.open 0..1)
      const slide = (d.open || 0) * (d.h / 2);
      ctx.fillStyle = c.main;
      ctx.fillRect(d.x, d.y - slide, d.w, d.h / 2);
      ctx.fillRect(d.x, d.y + d.h / 2, d.w, d.h / 2 + slide);
      // Glow
      if (d.open > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${d.open * 0.4})`;
        ctx.fillRect(d.x, d.y + d.h / 2 - 4, d.w, 8);
      }
      // Element icon
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px Segoe UI';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const icon = { fire: 'F', water: 'W', earth: 'E', ice: 'I', wind: 'A' }[d.element] || '?';
      ctx.shadowColor = c.glow;
      ctx.shadowBlur = 12;
      ctx.fillText(icon, d.x + d.w / 2, d.y + d.h / 2);
      ctx.shadowBlur = 0;
    }

    _drawSwitch(ctx, s) {
      const c = ELEMENT_COLORS[s.element] || ELEMENT_COLORS.fire;
      // Base
      ctx.fillStyle = '#2a2030';
      ctx.fillRect(s.x, s.y + s.h - 6, s.w, 6);
      // Plate
      ctx.fillStyle = s.active ? c.glow : '#4a3a50';
      ctx.fillRect(s.x + 2, s.y + (s.active ? 6 : 2), s.w - 4, s.h - 8);
      // Glow when active
      if (s.active) {
        ctx.fillStyle = `${c.light}`;
        ctx.fillRect(s.x - 4, s.y - 4, s.w + 8, s.h + 8);
      }
      // Element icon
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px Segoe UI';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const icon = { fire: 'F', water: 'W', earth: 'E', ice: 'I', wind: 'A' }[s.element] || '?';
      ctx.fillText(icon, s.x + s.w / 2, s.y + s.h / 2 + 2);
    }

    _drawButton(ctx, b) {
      ctx.fillStyle = '#2a2030';
      ctx.fillRect(b.x, b.y + b.h - 4, b.w, 4);
      const press = b.pressed ? 4 : 0;
      ctx.fillStyle = b.pressed ? '#ffd166' : '#4a5a8a';
      ctx.fillRect(b.x + 2, b.y + press, b.w - 4, b.h - 4 - press);
      if (b.pressed) {
        ctx.fillStyle = 'rgba(255, 209, 102, 0.3)';
        ctx.fillRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
      }
    }

    _drawLever(ctx, l) {
      ctx.fillStyle = '#2a2030';
      ctx.fillRect(l.x + l.w / 2 - 4, l.y + l.h - 8, 8, 8);
      // Arm
      ctx.strokeStyle = l.active ? '#ffd166' : '#8a93a8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(l.x + l.w / 2, l.y + l.h - 4);
      ctx.lineTo(l.x + l.w / 2 + (l.active ? 10 : -10), l.y + 4);
      ctx.stroke();
      // Ball
      ctx.fillStyle = l.active ? '#ffd166' : '#8a93a8';
      ctx.beginPath();
      ctx.arc(l.x + l.w / 2 + (l.active ? 10 : -10), l.y + 4, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    _drawGem(ctx, g) {
      if (g.collected) return;
      const c = ELEMENT_COLORS[g.element] || ELEMENT_COLORS.fire;
      const bob = Math.sin(this.time * 3 + g.x * 0.01) * 4;
      const cx = g.x + g.w / 2, cy = g.y + g.h / 2 + bob;
      // Glow halo
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, 24);
      grd.addColorStop(0, c.light);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(cx - 24, cy - 24, 48, 48);
      // Gem shape (diamond)
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.time * 1.5);
      ctx.fillStyle = c.main;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(6, 0);
      ctx.lineTo(0, 8);
      ctx.lineTo(-6, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = c.glow;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(4, -2);
      ctx.lineTo(0, 0);
      ctx.lineTo(-4, -2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    _drawCollectible(ctx, c) {
      if (c.collected) return;
      const bob = Math.sin(this.time * 4 + c.x * 0.01) * 3;
      const cx = c.x + c.w / 2, cy = c.y + c.h / 2 + bob;
      ctx.fillStyle = '#ffd166';
      ctx.shadowColor = '#ffd166';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    _drawExit(ctx, e) {
      const c = ELEMENT_COLORS[e.element] || ELEMENT_COLORS.fire;
      // Beam
      const grd = ctx.createLinearGradient(e.x, e.y, e.x, e.y + e.h);
      grd.addColorStop(0, `${c.light}`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(e.x, e.y, e.w, e.h);
      // Active beam (when player is on it)
      if (e.activated) {
        ctx.fillStyle = c.glow;
        ctx.globalAlpha = 0.6 + Math.sin(this.time * 4) * 0.2;
        ctx.fillRect(e.x + e.w / 2 - 2, e.y, 4, e.h);
        ctx.globalAlpha = 1;
      }
      // Frame
      ctx.strokeStyle = c.main;
      ctx.lineWidth = 3;
      ctx.strokeRect(e.x, e.y, e.w, e.h);
      // Element label
      ctx.fillStyle = c.glow;
      ctx.font = 'bold 12px Segoe UI';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const icon = { fire: 'FIRE', water: 'WATER', earth: 'EARTH', ice: 'ICE', wind: 'WIND' }[e.element] || '';
      ctx.shadowColor = c.main;
      ctx.shadowBlur = 10;
      ctx.fillText(icon, e.x + e.w / 2, e.y - 16);
      ctx.shadowBlur = 0;
    }

    _drawPortal(ctx, p) {
      const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      const r = p.w / 2;
      // Outer ring
      for (let i = 3; i >= 0; i--) {
        ctx.strokeStyle = `rgba(180, 100, 220, ${0.2 + i * 0.15})`;
        ctx.lineWidth = 4 - i;
        ctx.beginPath();
        ctx.arc(cx, cy, r - i * 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Inner swirl
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.time * 2);
      const grd = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      grd.addColorStop(0, 'rgba(255, 200, 255, 0.8)');
      grd.addColorStop(0.6, 'rgba(180, 100, 220, 0.4)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    _drawLaser(ctx, l, scene) {
      // Emitter
      ctx.fillStyle = '#3a2030';
      ctx.fillRect(l.x, l.y, l.w, l.h);
      ctx.fillStyle = l.active ? '#ff4d6d' : '#4a3a50';
      ctx.fillRect(l.x + 2, l.y + 2, l.w - 4, l.h - 4);
      // Beam (if active and not blocked)
      if (l.active) {
        const end = l.endX || (l.x + 800);
        ctx.strokeStyle = '#ff4d6d';
        ctx.lineWidth = 3;
        ctx.shadowColor = '#ff4d6d';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(l.x + l.w, l.y + l.h / 2);
        ctx.lineTo(end, l.y + l.h / 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
        // Inner bright line
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(l.x + l.w, l.y + l.h / 2);
        ctx.lineTo(end, l.y + l.h / 2);
        ctx.stroke();
      }
    }

    // ----------------------------------------------------------
    // Boxes
    // ----------------------------------------------------------
    _renderBoxes(ctx, scene, cam) {
      for (const box of scene.physics.boxes) {
        ctx.fillStyle = '#5a4a3a';
        ctx.fillRect(box.x, box.y, box.w, box.h);
        ctx.fillStyle = '#7a6a4a';
        ctx.fillRect(box.x, box.y, box.w, 3);
        ctx.strokeStyle = '#3a2a1a';
        ctx.lineWidth = 2;
        ctx.strokeRect(box.x, box.y, box.w, box.h);
        // Cross pattern
        ctx.beginPath();
        ctx.moveTo(box.x, box.y);
        ctx.lineTo(box.x + box.w, box.y + box.h);
        ctx.moveTo(box.x + box.w, box.y);
        ctx.lineTo(box.x, box.y + box.h);
        ctx.stroke();
      }
    }

    // ----------------------------------------------------------
    // Bodies (players)
    // ----------------------------------------------------------
    _renderBodies(ctx, scene, cam) {
      for (let i = 0; i < scene.physics.bodies.length; i++) {
        const body = scene.physics.bodies[i];
        if (body.dead && body.deathAnim > 1) continue;
        this._drawBody(ctx, body);
        // Draw nametag above body
        const player = scene.players[i];
        if (player && player.name && !body.dead) {
          this._drawNametag(ctx, body, player.name, player.isLocal);
        }
      }
    }

    /** Draw a floating nametag above a character. */
    _drawNametag(ctx, body, name, isLocal) {
      const cx = body.x + body.w / 2;
      const cy = body.y - 12; // above the head
      const c = ELEMENT_COLORS[body.element] || ELEMENT_COLORS.fire;
      // Measure text
      ctx.font = 'bold 11px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const metrics = ctx.measureText(name);
      const padX = 6, padY = 3;
      const boxW = metrics.width + padX * 2;
      const boxH = 16;
      const boxX = cx - boxW / 2;
      const boxY = cy - boxH / 2;
      // Background pill
      ctx.fillStyle = isLocal ? 'rgba(255, 209, 102, 0.92)' : 'rgba(10, 14, 24, 0.85)';
      this._roundRect(ctx, boxX, boxY, boxW, boxH, 4);
      ctx.fill();
      // Border (element-colored)
      ctx.strokeStyle = c.main;
      ctx.lineWidth = 1.5;
      this._roundRect(ctx, boxX, boxY, boxW, boxH, 4);
      ctx.stroke();
      // Text
      ctx.fillStyle = isLocal ? '#1a0e00' : '#ffffff';
      ctx.fillText(name, cx, cy);
      // Small "YOU" indicator arrow for local player
      if (isLocal) {
        ctx.fillStyle = 'rgba(255, 209, 102, 0.9)';
        ctx.beginPath();
        ctx.moveTo(cx - 3, boxY + boxH);
        ctx.lineTo(cx + 3, boxY + boxH);
        ctx.lineTo(cx, boxY + boxH + 3);
        ctx.closePath();
        ctx.fill();
      }
      // Reset
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }

    /** Helper: rounded rectangle path. */
    _roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    _drawBody(ctx, body) {
      const c = ELEMENT_COLORS[body.element] || ELEMENT_COLORS.fire;
      const cx = body.x + body.w / 2;
      const cy = body.y + body.h / 2;
      const t = this.time;

      // Death animation
      if (body.dead) {
        body.deathAnim = (body.deathAnim || 0) + 0.05;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - body.deathAnim);
        ctx.translate(cx, cy);
        ctx.rotate(body.deathAnim * 4);
        ctx.scale(1 - body.deathAnim * 0.5, 1 - body.deathAnim * 0.5);
        ctx.translate(-cx, -cy);
      }

      // Outer glow halo
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, body.w);
      grd.addColorStop(0, c.light);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(cx - body.w, cy - body.w, body.w * 2, body.w * 2);

      // Body shape per element
      ctx.save();
      ctx.translate(cx, cy);
      // Squash/stretch from velocity
      const sx = 1 + Math.min(0.2, Math.abs(body.vx) * 0.0005);
      const sy = body.onGround ? 1 : (body.vy < 0 ? 1.1 : 0.95);
      ctx.scale(sx * (body.facing < 0 ? -1 : 1), sy);

      // Walking animation
      const walkBob = body.onGround && Math.abs(body.vx) > 20 ? Math.sin(body.walkPhase * 4) * 2 : 0;

      // Body
      ctx.fillStyle = c.main;
      this._drawElementShape(ctx, body, walkBob);
      // Inner highlight
      ctx.fillStyle = c.glow;
      ctx.globalAlpha = 0.6;
      this._drawElementShape(ctx, body, walkBob, true);
      ctx.globalAlpha = 1;

      // Eyes
      ctx.fillStyle = '#fff';
      const eyeY = -body.h / 4 + walkBob;
      const eyeOff = body.facing * 2;
      ctx.beginPath();
      ctx.arc(-3 + eyeOff, eyeY, 2.5, 0, Math.PI * 2);
      ctx.arc(3 + eyeOff, eyeY, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(-3 + eyeOff + body.facing, eyeY, 1.2, 0, Math.PI * 2);
      ctx.arc(3 + eyeOff + body.facing, eyeY, 1.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      // Element-specific aura particles
      if (!body.dead && global.particles) {
        if (body.element === 'fire' && Math.random() < 0.5) {
          global.particles.fireEmitter(cx, body.y + body.h - 4, 0.3);
        } else if (body.element === 'water' && Math.random() < 0.15) {
          global.particles.trail(cx, body.y + 4, c.glow, 0, -10);
        } else if (body.element === 'ice' && Math.random() < 0.15) {
          global.particles.trail(cx, cy, c.glow, (Math.random() - 0.5) * 30, -10);
        } else if (body.element === 'wind' && (body.gliding || Math.abs(body.vx) > 100) && Math.random() < 0.4) {
          global.particles.windStreak(cx - body.facing * 10, cy, -body.facing);
        } else if (body.element === 'earth' && body.onGround && Math.abs(body.vx) > 50 && Math.random() < 0.3) {
          global.particles.earthDust(cx - body.facing * 8, body.y + body.h - 2, 0.4);
        }
      }

      if (body.dead) ctx.restore();
    }

    _drawElementShape(ctx, body, walkBob, highlight = false) {
      const w = body.w, h = body.h;
      if (body.element === 'fire') {
        // Flame-like body
        ctx.beginPath();
        ctx.moveTo(0, -h / 2 - 4 + walkBob);
        ctx.quadraticCurveTo(-w / 2, -h / 4, -w / 2, h / 4);
        ctx.quadraticCurveTo(-w / 2, h / 2, 0, h / 2);
        ctx.quadraticCurveTo(w / 2, h / 2, w / 2, h / 4);
        ctx.quadraticCurveTo(w / 2, -h / 4, 0, -h / 2 - 4 + walkBob);
        ctx.closePath();
        ctx.fill();
        if (!highlight) {
          // Top flame wisp
          ctx.fillStyle = '#ffd166';
          ctx.beginPath();
          ctx.moveTo(0, -h / 2 - 4 + walkBob);
          ctx.quadraticCurveTo(-4, -h / 2 + 2, 0, -h / 2 + 6);
          ctx.quadraticCurveTo(4, -h / 2 + 2, 0, -h / 2 - 4 + walkBob);
          ctx.fill();
        }
      } else if (body.element === 'water') {
        // Droplet body
        ctx.beginPath();
        ctx.moveTo(0, -h / 2 + walkBob);
        ctx.quadraticCurveTo(w / 2, -h / 4, w / 2, h / 4);
        ctx.quadraticCurveTo(w / 2, h / 2, 0, h / 2);
        ctx.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 4);
        ctx.quadraticCurveTo(-w / 2, -h / 4, 0, -h / 2 + walkBob);
        ctx.closePath();
        ctx.fill();
      } else if (body.element === 'earth') {
        // Blocky body
        const r = 4;
        ctx.beginPath();
        ctx.moveTo(-w / 2 + r, -h / 2 + walkBob);
        ctx.lineTo(w / 2 - r, -h / 2 + walkBob);
        ctx.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
        ctx.lineTo(w / 2, h / 2 - r);
        ctx.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
        ctx.lineTo(-w / 2 + r, h / 2);
        ctx.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
        ctx.lineTo(-w / 2, -h / 2 + r);
        ctx.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2 + walkBob);
        ctx.closePath();
        ctx.fill();
      } else if (body.element === 'ice') {
        // Crystal body
        ctx.beginPath();
        ctx.moveTo(0, -h / 2 + walkBob);
        ctx.lineTo(w / 2, 0);
        ctx.lineTo(0, h / 2);
        ctx.lineTo(-w / 2, 0);
        ctx.closePath();
        ctx.fill();
      } else if (body.element === 'wind') {
        // Swirl body
        ctx.beginPath();
        ctx.ellipse(0, walkBob, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        if (!highlight) {
          // Wind swirl lines
          ctx.strokeStyle = c_glow(body);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(0, walkBob, w / 3, 0.5, 2.5);
          ctx.stroke();
        }
      }
    }

    // ----------------------------------------------------------
    // Lighting overlay
    // ----------------------------------------------------------
    _renderLighting(ctx, scene, cam) {
      // Build a darkness overlay; element bodies & active doors punch holes
      const off = document.createElement('canvas');
      off.width = this.camera.viewportW;
      off.height = this.camera.viewportH;
      const offCtx = off.getContext('2d');

      // Darkness
      offCtx.fillStyle = `rgba(0, 0, 8, ${scene.darkness || 0.55})`;
      offCtx.fillRect(0, 0, off.width, off.height);

      // Cut holes (light sources)
      offCtx.globalCompositeOperation = 'destination-out';
      const drawLight = (wx, wy, radius, intensity = 1) => {
        const sx = (wx - cam.x) * cam.zoom + cam.shakeX;
        const sy = (wy - cam.y) * cam.zoom + cam.shakeY;
        const grd = offCtx.createRadialGradient(sx, sy, 0, sx, sy, radius * cam.zoom);
        grd.addColorStop(0, `rgba(0,0,0,${intensity})`);
        grd.addColorStop(0.6, `rgba(0,0,0,${intensity * 0.5})`);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        offCtx.fillStyle = grd;
        offCtx.fillRect(sx - radius * cam.zoom, sy - radius * cam.zoom, radius * 2 * cam.zoom, radius * 2 * cam.zoom);
      };

      if (scene.physics) {
        for (const body of scene.physics.bodies) {
          if (body.dead) continue;
          const c = ELEMENT_COLORS[body.element];
          drawLight(body.x + body.w / 2, body.y + body.h / 2, 120, 1);
        }
        // Light from lava
        for (const h of scene.physics.hazards) {
          if (h.type === 'lava') drawLight(h.x + h.w / 2, h.y + h.h / 2, 80, 0.7);
        }
        // Light from active doors / exits
        if (scene.objects) {
          for (const o of scene.objects) {
            if ((o.type === 'exit' && o.activated) || (o.type === 'door' && o.open > 0)) {
              drawLight(o.x + o.w / 2, o.y + o.h / 2, 100, 0.8);
            }
          }
        }
      }

      offCtx.globalCompositeOperation = 'source-over';
      ctx.drawImage(off, 0, 0);

      // Add colored light tints (additive)
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      if (scene.physics) {
        for (const body of scene.physics.bodies) {
          if (body.dead) continue;
          const c = ELEMENT_COLORS[body.element];
          const sx = (body.x + body.w / 2 - cam.x) * cam.zoom + cam.shakeX;
          const sy = (body.y + body.h / 2 - cam.y) * cam.zoom + cam.shakeY;
          const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, 80 * cam.zoom);
          grd.addColorStop(0, c.light);
          grd.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = grd;
          ctx.fillRect(sx - 80 * cam.zoom, sy - 80 * cam.zoom, 160 * cam.zoom, 160 * cam.zoom);
        }
      }
      ctx.restore();
    }

    _renderVignette(ctx) {
      const grd = ctx.createRadialGradient(
        this.camera.viewportW / 2, this.camera.viewportH / 2, this.camera.viewportH * 0.4,
        this.camera.viewportW / 2, this.camera.viewportH / 2, this.camera.viewportH * 0.85
      );
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, this.camera.viewportW, this.camera.viewportH);
    }

    _renderFps(ctx) {
      const avg = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(8, 8, 110, 26);
      ctx.fillStyle = '#62e69b';
      ctx.font = 'bold 12px Consolas';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`FPS: ${avg.toFixed(1)}`, 14, 14);
      ctx.fillStyle = '#8a93a8';
      ctx.font = '10px Consolas';
      ctx.fillText(`Particles: ${global.particles ? particles.activeCount : 0}`, 14, 28);
    }

    /** Darken a hex color by a factor (0-1). */
    _darken(hex, factor) {
      const c = this._hexToRgb(hex);
      return `rgb(${Math.floor(c.r * factor)},${Math.floor(c.g * factor)},${Math.floor(c.b * factor)})`;
    }

    /** Lighten a hex color by blending toward white. */
    _lighten(hex, factor) {
      const c = this._hexToRgb(hex);
      return `rgb(${Math.floor(c.r + (255 - c.r) * factor)},${Math.floor(c.g + (255 - c.g) * factor)},${Math.floor(c.b + (255 - c.b) * factor)})`;
    }

    /** Convert hex color to {r, g, b}. */
    _hexToRgb(hex) {
      const h = hex.replace('#', '');
      return {
        r: parseInt(h.substring(0, 2), 16),
        g: parseInt(h.substring(2, 4), 16),
        b: parseInt(h.substring(4, 6), 16),
      };
    }
  }

  // Helper used internally
  function c_glow(body) {
    return (ELEMENT_COLORS[body.element] || {}).glow || '#fff';
  }

  global.Renderer = Renderer;
  global.ELEMENT_COLORS = ELEMENT_COLORS;
})(window);
