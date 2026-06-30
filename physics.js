/* ============================================================
   ELEMENTAL QUEST — physics.js
   Professional platformer physics: AABB collisions, slopes,
   moving platforms, coyote time, jump buffer, element friction,
   water buoyancy, wind zones. No jitter, no clipping.
   ============================================================ */
(function (global) {
  'use strict';

  // Element physics profiles — tuned for forgiving, fun platforming
  const ELEMENT_PROFILES = {
    fire: {
      walkAccel: 2000, maxSpeed: 250, friction: 1700,
      gravity: 1400, jumpVel: 580, fallMult: 1.5, lowJumpMult: 1.0,
      iceFrictionMult: 0.6, maxFall: 900, weight: 1.0,
      sprintMult: 1.6, sprintAccelMult: 1.4,
      safeHazards: ['lava'], weakHazards: ['water', 'ice'],
      glow: '#ff5e3a',
    },
    water: {
      walkAccel: 1900, maxSpeed: 240, friction: 1600,
      gravity: 1400, jumpVel: 570, fallMult: 1.4, lowJumpMult: 1.0,
      iceFrictionMult: 0.7, maxFall: 900, weight: 0.9,
      sprintMult: 1.6, sprintAccelMult: 1.4,
      safeHazards: ['water'], weakHazards: ['lava'],
      glow: '#36c5ff',
    },
    earth: {
      walkAccel: 2600, maxSpeed: 190, friction: 2300,
      gravity: 1600, jumpVel: 520, fallMult: 1.7, lowJumpMult: 1.1,
      iceFrictionMult: 0.85, maxFall: 1100, weight: 2.0,
      sprintMult: 1.4, sprintAccelMult: 1.3,
      safeHazards: [], weakHazards: ['lava', 'water', 'ice'],
      glow: '#b9853d', heavy: true,
    },
    ice: {
      walkAccel: 1200, maxSpeed: 270, friction: 400,
      gravity: 1400, jumpVel: 580, fallMult: 1.4, lowJumpMult: 1.0,
      iceFrictionMult: 0.3, maxFall: 900, weight: 1.0,
      sprintMult: 1.5, sprintAccelMult: 1.2,
      safeHazards: [], weakHazards: ['lava', 'water'],
      glow: '#8ee6ff', slippery: true,
    },
    wind: {
      walkAccel: 1600, maxSpeed: 230, friction: 1300,
      gravity: 1200, jumpVel: 500, fallMult: 1.0, lowJumpMult: 0.6,
      iceFrictionMult: 0.7, maxFall: 400, weight: 0.6,
      sprintMult: 1.7, sprintAccelMult: 1.5,
      safeHazards: [], weakHazards: ['lava', 'water'],
      glow: '#e6f0ff', glide: true, light: true,
    },
  };

  // Forgiving platformer timing — generous coyote time & jump buffer
  const COYOTE_TIME = 0.16;     // seconds after leaving ground you can still jump
  const JUMP_BUFFER = 0.18;     // seconds before landing a jump press is remembered

  class PhysicsBody {
    constructor(opts) {
      this.x = opts.x || 0;
      this.y = opts.y || 0;
      this.w = opts.w || 24;
      this.h = opts.h || 36;
      this.vx = 0; this.vy = 0;
      this.onGround = false;
      this.onCeiling = false;
      this.onWall = 0; // -1 left, 1 right, 0 none
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.jumping = false;
      this.jumpHeld = false;
      this.gliding = false;
      this.sprinting = false;
      this.platform = null; // moving platform we're riding
      this.element = opts.element || 'fire';
      this.dead = false;
      this.reachedExit = false;
      this.facing = 1;
      this.surfaceType = 'stone';
      this.inWater = false;
      this.inWindZone = false;
      this.windForce = 0;
      this.stunTimer = 0;
      this.justLanded = false;
      this.lastFootstep = 0;
      this.walkPhase = 0;
      this.spawnX = this.x; this.spawnY = this.y;
    }

    get profile() { return ELEMENT_PROFILES[this.element]; }

    rect() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
  }

  class PhysicsWorld {
    constructor() {
      this.gravity = 1500;
      this.tileSize = 32;
      this.solids = [];        // array of {x,y,w,h, type, ...}
      this.tiles = null;       // 2D array of chars from level
      this.movingPlatforms = [];
      this.hazards = [];       // {x,y,w,h, type}
      this.waterZones = [];    // {x,y,w,h}
      this.windZones = [];     // {x,y,w,h, dir, force}
      this.iceZones = [];      // tiles that are slippery
      this.bodies = [];
      this.boxes = [];         // pushable boxes
      this.weakFloors = [];    // breakable from height by earth
      this.slopes = [];        // {x,y,w,h, dir}  dir: -1 (left-low), 1 (right-low)
    }

    setLevel(level) {
      this.solids = [];
      this.movingPlatforms = [];
      this.hazards = [];
      this.waterZones = [];
      this.windZones = [];
      this.iceZones = [];
      this.boxes = [];
      this.weakFloors = [];
      this.slopes = [];
      this.bodies = [];
      this.tileSize = level.tileSize || 32;
      this.tiles = level.tiles;
      this.width = level.width;
      this.height = level.height;
      this.parseTiles();
      // Custom entities from level
      if (level.entities) {
        for (const e of level.entities) this.addEntity(e);
      }
    }

    parseTiles() {
      const ts = this.tileSize;
      const rows = this.tiles;
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        for (let c = 0; c < row.length; c++) {
          const ch = row[c];
          const x = c * ts, y = r * ts;
          switch (ch) {
            case '#': // solid stone
              this.solids.push({ x, y, w: ts, h: ts, type: 'stone' });
              break;
            case 'D': // dirt
              this.solids.push({ x, y, w: ts, h: ts, type: 'dirt' });
              break;
            case 'M': // metal
              this.solids.push({ x, y, w: ts, h: ts, type: 'metal' });
              break;
            case 'W': // wood (burnable)
              this.solids.push({ x, y, w: ts, h: ts, type: 'wood', burnable: true, burned: false });
              break;
            case 'I': // ice (slippery)
              this.solids.push({ x, y, w: ts, h: ts, type: 'ice' });
              this.iceZones.push({ x, y, w: ts, h: ts });
              break;
            case 'B': // weak floor (earth breaks)
              this.solids.push({ x, y, w: ts, h: ts, type: 'weak', breakable: true });
              this.weakFloors.push({ x, y, w: ts, h: ts, broken: false, hp: 1 });
              break;
            case 'L': // lava hazard
              this.hazards.push({ x, y, w: ts, h: ts, type: 'lava' });
              break;
            case '~': // water hazard (deep water - drowns non-water)
              this.hazards.push({ x, y, w: ts, h: ts, type: 'water' });
              this.waterZones.push({ x, y, w: ts, h: ts, deep: true });
              break;
            case '.': // shallow water (buoyant, safe for water)
              this.waterZones.push({ x, y, w: ts, h: ts, deep: false });
              break;
            case '^': // spikes
              this.hazards.push({ x, y, w: ts, h: ts, type: 'spikes' });
              break;
            case 'S': // slope left-low (like  ╲ )
              this.slopes.push({ x, y, w: ts, h: ts, dir: -1 });
              break;
            case 'Z': // slope right-low (like ╱ )
              this.slopes.push({ x, y, w: ts, h: ts, dir: 1 });
              break;
          }
        }
      }
    }

    addEntity(e) {
      switch (e.type) {
        case 'platform': this.movingPlatforms.push(Object.assign({ t: 0 }, e)); break;
        case 'box': this.boxes.push(Object.assign({ x: e.x, y: e.y, w: e.w || 28, h: e.h || 28, vx: 0, vy: 0, onGround: false, weight: e.weight || 1, type: 'box' }, e)); break;
        case 'wind': this.windZones.push(e); break;
        case 'hazard': this.hazards.push(e); break;
        case 'solid': this.solids.push(e); break;
        case 'water': this.waterZones.push(e); break;
      }
    }

    addBody(b) { this.bodies.push(b); }
    removeBody(b) { this.bodies = this.bodies.filter(x => x !== b); }

    // ----------------------------------------------------------
    // Collision: AABB swept axis-separated
    // ----------------------------------------------------------
    _getSolids(body) {
      // Include static solids + moving platforms + boxes (other than self) + weak floors not broken
      const solids = [];
      for (const s of this.solids) {
        if (s.burned) continue;
        if (s.breakable) {
          const wf = this.weakFloors.find(w => w.x === s.x && w.y === s.y);
          if (wf && wf.broken) continue;
        }
        solids.push(s);
      }
      for (const p of this.movingPlatforms) solids.push(p);
      for (const b of this.boxes) {
        if (b === body) continue;
        solids.push(b);
      }
      return solids;
    }

    update(dt, time) {
      // Update moving platforms
      for (const p of this.movingPlatforms) {
        p.t = (p.t || 0) + dt;
        const phase = (p.t / (p.period || 4)) * Math.PI * 2;
        const prevX = p.x, prevY = p.y;
        if (p.axis === 'x') {
          p.x = p.x0 + Math.sin(phase) * (p.amplitude || 100);
        } else if (p.axis === 'y') {
          p.y = p.y0 + Math.sin(phase) * (p.amplitude || 100);
        } else if (p.axis === 'circle') {
          p.x = p.x0 + Math.cos(phase) * (p.amplitude || 100);
          p.y = p.y0 + Math.sin(phase) * (p.amplitude || 60);
        }
        p.dx = p.x - prevX;
        p.dy = p.y - prevY;
      }

      // Update boxes (simple gravity, allow body to push)
      for (const box of this.boxes) {
        if (box === undefined) continue;
        box.vy += this.gravity * dt * (box.weight || 1);
        box.vy = Math.min(box.vy, 1100);
        this._moveBox(box, dt);
      }

      // Update bodies
      for (const body of this.bodies) {
        if (body.dead || body.reachedExit) {
          // Still apply gravity to dead body briefly for animation
          if (body.dead) {
            body.vy += this.gravity * dt;
            body.y += body.vy * dt;
          }
          continue;
        }
        if (body.stunTimer > 0) body.stunTimer -= dt;
        this._updateBody(body, dt, time);
      }
    }

    _updateBody(body, dt, time) {
      const p = body.profile;
      // === Riding platform: apply delta ===
      if (body.platform) {
        body.x += body.platform.dx || 0;
        body.y += body.platform.dy || 0;
      }
      body.platform = null;

      // === Water buoyancy ===
      body.inWater = false;
      for (const wz of this.waterZones) {
        if (body.x + body.w > wz.x && body.x < wz.x + wz.w &&
            body.y + body.h > wz.y && body.y < wz.y + wz.h) {
          body.inWater = true;
          break;
        }
      }

      // === Wind zones ===
      body.inWindZone = false;
      body.windForce = 0;
      for (const wz of this.windZones) {
        if (body.x + body.w > wz.x && body.x < wz.x + wz.w &&
            body.y + body.h > wz.y && body.y < wz.y + wz.h) {
          body.inWindZone = true;
          body.windForce = (wz.force || 200) * (wz.dir || 1);
          break;
        }
      }

      // === Horizontal input already applied by engine via body.vx ===
      // Apply friction
      const onIce = this._onIce(body);
      const frictionMult = onIce ? p.iceFrictionMult : 1;
      if (Math.abs(body.inputX || 0) < 0.01) {
        const fr = p.friction * frictionMult * dt;
        if (Math.abs(body.vx) < fr) body.vx = 0;
        else body.vx -= Math.sign(body.vx) * fr;
      }

      // Gravity
      let g = p.gravity;
      if (body.inWater) {
        // Buoyancy: water element floats, others sink slowly
        if (body.element === 'water') {
          g = -200; // floats up
          body.vy = Math.max(body.vy - 600 * dt, -120);
        } else {
          g = 300; // sinks slowly
        }
      }
      if (body.gliding && body.vy > 0) {
        g *= 0.15;
        body.vy = Math.min(body.vy, 80);
      }
      body.vy += g * dt;
      // Variable jump: if jump released while going up, apply extra gravity
      if (!body.jumpHeld && body.vy < 0 && !body.inWater) {
        body.vy += (p.gravity * (p.lowJumpMult - 1)) * dt * 4;
      }
      body.vy = Math.min(body.vy, p.maxFall);

      // Wind force
      if (body.inWindZone) body.vx += body.windForce * dt;

      // Clamp horizontal speed (sprint increases max)
      const sprintBonus = body.sprinting ? (p.sprintMult || 1.5) : 1;
      const maxSpd = p.maxSpeed * sprintBonus * (body.inWater ? 0.7 : 1);
      body.vx = Math.max(-maxSpd, Math.min(maxSpd, body.vx));

      // === Coyote time ===
      if (body.onGround) body.coyote = COYOTE_TIME;
      else body.coyote = Math.max(0, body.coyote - dt);
      // === Jump buffer ===
      body.jumpBuffer = Math.max(0, body.jumpBuffer - dt);
      if (body.jumpBuffer > 0 && body.coyote > 0 && !body.jumping) {
        this._doJump(body);
        body.jumpBuffer = 0;
      }

      // === Move & collide ===
      body.justLanded = false;
      const wasGround = body.onGround;
      body.onGround = false;
      body.onCeiling = false;
      body.onWall = 0;

      this._moveAxis(body, dt, 'x');
      this._moveAxis(body, dt, 'y');

      // Landing detection
      if (!wasGround && body.onGround) {
        body.justLanded = true;
        body.jumping = false;
      }

      // === Slope handling ===
      this._resolveSlopes(body);

      // === Hazards ===
      this._checkHazards(body);

      // === Footstep timing ===
      if (body.onGround && Math.abs(body.vx) > 20) {
        body.walkPhase += Math.abs(body.vx) * dt * 0.03;
        const interval = 0.32 - Math.min(0.18, Math.abs(body.vx) * 0.0006);
        if (time - body.lastFootstep > interval) {
          body.lastFootstep = time;
          if (global.audio) global.audio.footstep(body.surfaceType);
        }
      }
    }

    _doJump(body) {
      const p = body.profile;
      let jv = p.jumpVel;
      if (body.inWater && body.element === 'water') jv *= 1.1;
      body.vy = -jv;
      body.jumping = true;
      body.onGround = false;
      body.coyote = 0;
      if (global.audio) global.audio.jump();
      if (global.particles) {
        const c = p.glow;
        global.particles.burst({
          x: body.x + body.w / 2, y: body.y + body.h,
          count: 8, color: c, speed: 100, size: 3, life: 0.3,
          glow: 4, type: 'glow', gravity: 200,
        });
      }
    }

    requestJump(body) {
      body.jumpBuffer = JUMP_BUFFER;
      body.jumpHeld = true;
    }
    releaseJump(body) { body.jumpHeld = false; }
    requestGlide(body, on) { body.gliding = on && body.profile.glide; }

    _onIce(body) {
      for (const iz of this.iceZones) {
        if (body.x + body.w > iz.x && body.x < iz.x + iz.w &&
            body.y + body.h > iz.y - 2 && body.y + body.h <= iz.y + iz.h) {
          return true;
        }
      }
      return false;
    }

    _moveAxis(body, dt, axis) {
      const v = axis === 'x' ? body.vx : body.vy;
      if (v === 0) return;
      const move = v * dt;
      let newPos = (axis === 'x' ? body.x : body.y) + move;
      if (axis === 'x') body.x = newPos; else body.y = newPos;

      const solids = this._getSolids(body);
      const bodyRect = body.rect();
      for (const s of solids) {
        if (s.burned) continue;
        if (this._aabbOverlap(bodyRect, s)) {
          // Resolve
          if (axis === 'x') {
            if (v > 0) {
              body.x = s.x - body.w;
              body.onWall = 1;
            } else {
              body.x = s.x + s.w;
              body.onWall = -1;
            }
            body.vx = 0;
            bodyRect.x = body.x;
          } else {
            if (v > 0) {
              body.y = s.y - body.h;
              body.vy = 0;
              body.onGround = true;
              body.surfaceType = s.type || 'stone';
              body.platform = (s.type === 'platform') ? s : null;
              if (s.type === 'weak' && body.profile.heavy) {
                // Schedule break if earth is heavy
                const wf = this.weakFloors.find(w => w.x === s.x && w.y === s.y);
                if (wf && !wf.broken) {
                  wf.hp -= dt * 4; // breaks in ~0.25s
                  if (wf.hp <= 0) {
                    wf.broken = true;
                    if (global.particles) global.particles.burst({ x: wf.x + 16, y: wf.y + 16, count: 14, color: '#8b6a3a', speed: 140, size: 5, life: 0.6, type: 'square' });
                    if (global.audio) global.audio.elementBurst('earth');
                  }
                }
              }
            } else {
              body.y = s.y + s.h;
              body.vy = 0;
              body.onCeiling = true;
            }
            bodyRect.y = body.y;
          }
        }
      }
    }

    _moveBox(box, dt) {
      // Horizontal
      const dx = box.vx * dt;
      if (dx !== 0) {
        box.x += dx;
        const solids = this._getSolids(box);
        for (const s of solids) {
          if (s === box) continue;
          if (this._aabbOverlap(box, s)) {
            if (dx > 0) box.x = s.x - box.w;
            else box.x = s.x + s.w;
            box.vx = 0;
          }
        }
        box.vx *= 0.7;
        if (Math.abs(box.vx) < 5) box.vx = 0;
      }
      // Vertical
      box.onGround = false;
      const dy = box.vy * dt;
      if (dy !== 0) {
        box.y += dy;
        const solids = this._getSolids(box);
        for (const s of solids) {
          if (s === box) continue;
          if (this._aabbOverlap(box, s)) {
            if (dy > 0) {
              box.y = s.y - box.h;
              box.vy = 0;
              box.onGround = true;
            } else {
              box.y = s.y + s.h;
              box.vy = 0;
            }
          }
        }
      }
    }

    _resolveSlopes(body) {
      // Simple slope handling: if body's bottom-center is on a slope tile, raise body to the slope surface
      const cx = body.x + body.w / 2;
      const by = body.y + body.h;
      for (const s of this.slopes) {
        if (cx >= s.x && cx <= s.x + s.w) {
          // Determine slope Y at this X
          let surfaceY;
          if (s.dir === 1) {
            // Right-low: y = s.y + ((cx - s.x) / s.w) * s.h
            surfaceY = s.y + ((cx - s.x) / s.w) * s.h;
          } else {
            // Left-low: y = s.y + (1 - (cx - s.x) / s.w) * s.h
            surfaceY = s.y + (1 - (cx - s.x) / s.w) * s.h;
          }
          if (by >= surfaceY - 2 && by <= surfaceY + s.h * 0.5 && body.vy >= 0) {
            body.y = surfaceY - body.h;
            body.vy = 0;
            body.onGround = true;
            body.surfaceType = 'stone';
          }
        }
      }
    }

    _aabbOverlap(a, b) {
      return a.x < b.x + b.w && a.x + a.w > b.x &&
             a.y < b.y + b.h && a.y + a.h > b.y;
    }

    _checkHazards(body) {
      for (const h of this.hazards) {
        if (h.type === 'spikes') {
          // Spikes only hurt if body is descending onto them
          if (this._aabbOverlap(body.rect(), h) && body.vy >= 0) {
            if (!body.profile.safeHazards.includes('spikes')) {
              body.dead = true;
              if (global.audio) global.audio.death(body.element);
              if (global.particles) global.particles.explosion(body.x + body.w / 2, body.y + body.h / 2, body.profile.glow);
            }
          }
        } else if (h.type === 'lava') {
          if (this._aabbOverlap(body.rect(), h)) {
            if (body.element === 'fire') {
              // Safe — emit fire embers
              if (global.particles && Math.random() < 0.3) {
                global.particles.fireEmitter(body.x + body.w / 2, body.y + body.h, 0.5);
              }
            } else {
              body.dead = true;
              if (global.audio) global.audio.death(body.element);
              if (global.particles) global.particles.explosion(body.x + body.w / 2, body.y + body.h / 2, '#ff5e3a');
            }
          }
        } else if (h.type === 'water') {
          if (this._aabbOverlap(body.rect(), h)) {
            if (body.element === 'water') {
              if (global.particles && Math.random() < 0.2) {
                global.particles.waterSplash(body.x + body.w / 2, body.y + body.h, 0.3);
              }
            } else if (body.element === 'ice') {
              // Ice slowly melts in deep water — kill after 1.5s exposure
              body.stunTimer = (body.stunTimer || 0) + 0.016;
              if (body.stunTimer > 1.5) {
                body.dead = true;
                if (global.audio) global.audio.death('ice');
                if (global.particles) global.particles.iceShatter(body.x + body.w / 2, body.y + body.h / 2);
              }
            } else {
              body.dead = true;
              if (global.audio) global.audio.death(body.element);
              if (global.particles) global.particles.waterSplash(body.x + body.w / 2, body.y + body.h / 2, 1);
            }
          }
        }
      }
      // Out-of-bounds
      if (body.y > this.height + 200) {
        body.dead = true;
        if (global.audio) global.audio.death(body.element);
      }
    }

    // Push a box by body (called when body's inputX is non-zero and collides)
    tryPushBox(body) {
      if (!body.profile || body.profile.heavy || body.profile.light) {
        // earth too heavy to push easily, wind too light to push — but allow normal
      }
      // Find a box adjacent in the direction of motion
      const dir = body.facing || (body.vx > 0 ? 1 : -1);
      const probe = { x: body.x + (dir > 0 ? body.w : -4), y: body.y + 4, w: 4, h: body.h - 8 };
      for (const box of this.boxes) {
        if (this._aabbOverlap(probe, box)) {
          const pushForce = body.profile.heavy ? 200 : 100;
          box.vx += dir * pushForce * 0.016;
          return true;
        }
      }
      return false;
    }

    burnTileAt(x, y) {
      // Burn a wood tile (called by fire action)
      for (const s of this.solids) {
        if (s.burnable && !s.burned && x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) {
          s.burned = true;
          if (global.particles) global.particles.explosion(s.x + s.w / 2, s.y + s.h / 2, '#ff7a3a');
          if (global.audio) global.audio.burn();
          return true;
        }
      }
      return false;
    }

    freezeWaterAt(x, y, w = 64, h = 16) {
      // Ice action: convert a water zone into a temporary platform
      for (let i = this.waterZones.length - 1; i >= 0; i--) {
        const wz = this.waterZones[i];
        if (wz.deep && x >= wz.x - 8 && x <= wz.x + wz.w + 8 && y >= wz.y - 8 && y <= wz.y + wz.h + 8) {
          // Create a temporary solid ice platform
          const plat = { x: wz.x, y: wz.y, w: wz.w, h: 12, type: 'ice', temp: true, ttl: 6.0 };
          this.solids.push(plat);
          this.iceZones.push(plat);
          if (global.particles) global.particles.iceShatter(plat.x + plat.w / 2, plat.y);
          if (global.audio) global.audio.freeze();
          return plat;
        }
      }
      return null;
    }
  }

  global.PhysicsBody = PhysicsBody;
  global.PhysicsWorld = PhysicsWorld;
  global.ELEMENT_PROFILES = ELEMENT_PROFILES;
})(window);
