/* ============================================================
   ELEMENTAL QUEST — engine.js
   Core game engine: state machine, scene management, level
   logic, switches/doors/gems/lasers, win/lose detection.
   ============================================================ */
(function (global) {
  'use strict';

  const STATES = {
    BOOT: 'boot',
    MENU: 'menu',
    LOBBY: 'lobby',
    LEVELSELECT: 'levelselect',
    SETTINGS: 'settings',
    HOWTO: 'howto',
    PLAYING: 'playing',
    PAUSED: 'paused',
    WIN: 'win',
    LOSE: 'lose',
  };

  class GameScene {
    constructor(level, players) {
      this.level = level;
      this.players = players; // array of {slot, element, body}
      this.physics = new PhysicsWorld();
      this.physics.setLevel(level);
      this.objects = level.objects.map(o => Object.assign({}, o));
      this.theme = level.theme || 'cave';
      this.darkness = level.theme === 'fire' ? 0.4 : (level.theme === 'temple' ? 0.7 : 0.55);
      this.time = 0;
      this.startTime = performance.now();
      this.gemsCollected = 0;
      this.gemsTotal = level.gemCount || 0;
      this.switchesActive = 0;
      this.switchesTotal = this.objects.filter(o => o.type === 'switch').length;
      this.platesActive = 0;
      this.platesTotal = this.objects.filter(o => o.type === 'button').length;
      this.exitsReached = 0;
      this.exitsTotal = players.length;
      this.won = false;
      this.lost = false;
      this.hint = level.hint || '';
      this.hintShown = false;
      this._spawnPlayers();
    }

    _spawnPlayers() {
      // Map player slot -> element -> body
      const spawns = this.level.spawns;
      for (const p of this.players) {
        const spawn = spawns[p.element] || spawns.fire || { x: 50, y: 50 };
        p.body = new PhysicsBody({
          x: spawn.x, y: spawn.y,
          w: 24, h: 36,
          element: p.element,
        });
        p.body.spawnX = spawn.x; p.body.spawnY = spawn.y;
        // Preserve isLocal flag for client-side prediction
        if (p.isLocal === undefined) p.isLocal = true;
        // Ensure name is set
        if (!p.name) p.name = p.element.charAt(0).toUpperCase() + p.element.slice(1);
        this.physics.addBody(p.body);
      }
    }

    // ----------------------------------------------------------
    // Update logic
    // ----------------------------------------------------------
    update(dt) {
      this.time += dt;
      const phys = this.physics;

      // Apply inputs to bodies
      for (const p of this.players) {
        const b = p.body;
        const inp = p.input;
        if (b.dead) continue;
        // Horizontal input
        const prof = b.profile;
        b.sprinting = !!inp.sprint && (inp.left || inp.right);
        const sprintMul = b.sprinting ? (prof.sprintAccelMult || 1.3) : 1;
        let ax = 0;
        if (inp.left)  ax -= prof.walkAccel * sprintMul;
        if (inp.right) ax += prof.walkAccel * sprintMul;
        if (b.inWater) ax *= 0.6;
        b.vx += ax * dt;
        if (ax !== 0) b.facing = ax > 0 ? 1 : -1;
        // Box push
        if (inp.left || inp.right) phys.tryPushBox(b);
        // Jump
        if (inp.jumpPressed) phys.requestJump(b);
        phys.releaseJump(b);
        if (!inp.up) phys.releaseJump(b);
        // Glide (wind)
        if (prof.glide) phys.requestGlide(b, inp.action);
        else phys.requestGlide(b, false);
        // Element actions
        if (inp.actionPressed) this._doElementAction(p);
        // Continuous actions
        if (inp.action && p.element === 'fire' && Math.random() < 0.3) {
          // Continuous fire burn attempt
          const reachX = b.x + b.facing * (b.w / 2 + 16);
          const reachY = b.y + b.h / 2;
          phys.burnTileAt(reachX, reachY);
        }
      }

      // Update physics
      phys.update(dt, this.time);

      // Update objects (switches, plates, gems, doors, exits)
      this._updateObjects(dt);

      // Check exit / win
      this._checkExits();
      this._checkLose();
    }

    _doElementAction(player) {
      const b = player.body;
      const cx = b.x + b.w / 2 + b.facing * (b.w / 2 + 20);
      const cy = b.y + b.h / 2;
      switch (player.element) {
        case 'fire':
          // Burn wood tile in front
          if (this.physics.burnTileAt(cx, cy)) {
            if (global.audio) global.audio.burn();
          }
          break;
        case 'water':
          // Splash + extinguish nearby fire hazards (none for now, but emit particles)
          if (global.particles) global.particles.waterSplash(cx, cy, 1);
          if (global.audio) global.audio.splash();
          break;
        case 'earth':
          // Heavy smash — break any weak floor in front/below
          for (const wf of this.physics.weakFloors) {
            if (!wf.broken && Math.abs(wf.x + wf.w / 2 - cx) < 32 && Math.abs(wf.y + wf.h / 2 - cy) < 48) {
              wf.hp -= 5;
              if (wf.hp <= 0) {
                wf.broken = true;
                if (global.particles) global.particles.burst({ x: wf.x + 16, y: wf.y + 16, count: 16, color: '#8b6a3a', speed: 160, size: 5, life: 0.7, type: 'square' });
                if (global.audio) global.audio.elementBurst('earth');
                if (global.renderer) global.renderer.shake(6, 0.3);
              }
            }
          }
          break;
        case 'ice':
          // Freeze water in front
          this.physics.freezeWaterAt(cx, cy);
          break;
        case 'wind':
          // Wind burst — push light objects & self boost
          if (global.particles) global.particles.windStreak(cx, cy, b.facing);
          if (global.audio) global.audio.glide();
          // Push boxes
          for (const box of this.physics.boxes) {
            if (Math.abs(box.x + box.w / 2 - cx) < 60 && Math.abs(box.y + box.h / 2 - cy) < 40) {
              box.vx += b.facing * 200;
            }
          }
          break;
      }
    }

    _updateObjects(dt) {
      const phys = this.physics;
      // Reset transient state
      let activePlates = 0;
      let activeSwitches = 0;

      // Plates / buttons
      for (const o of this.objects) {
        if (o.type !== 'button') continue;
        o.pressed = false;
        // Check bodies
        for (const p of this.players) {
          const b = p.body;
          if (b.dead) continue;
          if (o.heavy && p.element !== 'earth') continue;
          if (this._aabb({ x: b.x, y: b.y, w: b.w, h: b.h }, o)) {
            o.pressed = true;
            break;
          }
        }
        // Check boxes
        if (!o.pressed) {
          for (const box of phys.boxes) {
            if (this._aabb(box, o)) { o.pressed = true; break; }
          }
        }
        if (o.pressed) activePlates++;
      }

      // Levers — toggled by action press near them
      for (const o of this.objects) {
        if (o.type !== 'lever') continue;
        for (const p of this.players) {
          if (p.input.actionPressed) {
            const b = p.body;
            const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
            const ox = o.x + o.w / 2, oy = o.y + o.h / 2;
            if (Math.abs(cx - ox) < 50 && Math.abs(cy - oy) < 50) {
              o.active = !o.active;
              if (global.audio) o.active ? global.audio.switchOn() : global.audio.switchOff();
              if (global.particles && o.active) global.particles.magicActivate(ox, oy);
            }
          }
        }
        if (o.active) activeSwitches++;
      }

      // Switches — auto-activate when matching element is near
      for (const o of this.objects) {
        if (o.type !== 'switch') continue;
        let near = false;
        for (const p of this.players) {
          if (o.element && p.element !== o.element) continue;
          const b = p.body;
          if (Math.abs(b.x + b.w / 2 - (o.x + o.w / 2)) < 40 &&
              Math.abs(b.y + b.h / 2 - (o.y + o.h / 2)) < 50) {
            near = true; break;
          }
        }
        const wasActive = o.active;
        o.active = near;
        if (o.active && !wasActive) {
          if (global.audio) global.audio.switchOn();
          if (global.particles) global.particles.magicActivate(o.x + o.w / 2, o.y + o.h / 2, (global.ELEMENT_COLORS || {})[o.element || 'fire']?.glow || '#ffd166');
        } else if (!o.active && wasActive) {
          if (global.audio) global.audio.switchOff();
        }
        if (o.active) activeSwitches++;
      }

      // Doors — open if all linked switches/plates/levers active
      // Group doors by their linked controllers (same id prefix or proximity)
      // Simple rule: a door opens if ANY switch/plate/lever with the same suffix is active.
      // For our levels, doors open when all plates or switches in the level are active.
      const allControllers = this.objects.filter(o => o.type === 'switch' || o.type === 'button' || o.type === 'lever');
      const allActive = allControllers.length > 0 && allControllers.every(o => o.active || o.pressed);
      for (const o of this.objects) {
        if (o.type !== 'door') continue;
        const target = allActive ? 1 : 0;
        o.open += (target - o.open) * Math.min(1, dt * 6);
      }

      // Gems — collect on contact
      for (const o of this.objects) {
        if (o.type !== 'gem' && o.type !== 'collectible') continue;
        if (o.collected) continue;
        for (const p of this.players) {
          const b = p.body;
          if (b.dead) continue;
          if (this._aabb({ x: b.x, y: b.y, w: b.w, h: b.h }, o)) {
            o.collected = true;
            this.gemsCollected++;
            if (global.audio) global.audio.gem();
            if (global.particles) global.particles.magicActivate(o.x + o.w / 2, o.y + o.h / 2, '#ffd166');
            break;
          }
        }
      }

      // Lasers — disabled if any switch active OR any plate pressed
      const lasers = this.objects.filter(o => o.type === 'laser');
      for (const l of lasers) {
        l.active = !(allControllers.some(o => o.active || o.pressed));
        // Damage players touching the beam
        if (l.active) {
          const beam = { x: l.x + l.w, y: l.y, w: 1000, h: 4 };
          for (const p of this.players) {
            const b = p.body;
            if (b.dead) continue;
            if (this._aabb({ x: b.x, y: b.y, w: b.w, h: b.h }, beam)) {
              b.dead = true;
              if (global.audio) global.audio.death(p.element);
              if (global.particles) global.particles.explosion(b.x + b.w / 2, b.y + b.h / 2, '#ff4d6d');
            }
          }
        }
      }

      // Portals — teleport on contact
      const portals = this.objects.filter(o => o.type === 'portal');
      if (portals.length >= 2) {
        for (const p of this.players) {
          const b = p.body;
          if (b.dead) continue;
          // Check each portal
          for (let i = 0; i < portals.length; i++) {
            const portal = portals[i];
            if (this._aabb({ x: b.x, y: b.y, w: b.w, h: b.h }, portal)) {
              if (b.lastPortal !== portal.id) {
                // Find paired portal (different id)
                const other = portals.find((pp, idx) => idx !== i);
                if (other) {
                  b.x = other.x + other.w / 2 - b.w / 2;
                  b.y = other.y + other.h / 2 - b.h / 2;
                  b.lastPortal = other.id;
                  if (global.particles) global.particles.magicActivate(other.x + other.w / 2, other.y + other.h / 2, '#b464dc');
                  if (global.audio) global.audio.switchOn();
                }
              }
              break;
            } else {
              // Clear last portal when not touching any
              if (b.lastPortal === portal.id) {
                // Check if not touching any portal
                let touching = false;
                for (const pp of portals) {
                  if (this._aabb({ x: b.x, y: b.y, w: b.w, h: b.h }, pp)) { touching = true; break; }
                }
                if (!touching) b.lastPortal = null;
              }
            }
          }
        }
      }

      this.platesActive = activePlates;
      this.switchesActive = activeSwitches;
    }

    _checkExits() {
      if (this.won) return;
      let reached = 0;
      for (const p of this.players) {
        const b = p.body;
        if (b.reachedExit) { reached++; continue; }
        // Find matching exit
        const exit = this.objects.find(o => o.type === 'exit' && o.element === p.element);
        if (exit && this._aabb({ x: b.x, y: b.y, w: b.w, h: b.h }, exit)) {
          b.reachedExit = true;
          exit.activated = true;
          reached++;
          if (global.audio) global.audio.doorOpen();
          if (global.particles) global.particles.magicActivate(exit.x + exit.w / 2, exit.y + exit.h / 2, (global.ELEMENT_COLORS || {})[p.element]?.glow || '#fff');
          if (global.ui) global.ui.toast(`${p.element.toUpperCase()} reached the exit!`);
        }
      }
      this.exitsReached = reached;
      if (reached === this.players.length) {
        this.won = true;
        if (global.audio) global.audio.victory();
      }
    }

    _checkLose() {
      if (this.won || this.lost) return;
      // Lose as soon as any player dies — show "___ died" and auto-restart
      for (const p of this.players) {
        if (p.body.dead && !p.body.deathAnim) p.body.deathAnim = 0;
        if (p.body.dead && !this._deathRecorded) {
          this._deathRecorded = true;
          this.deadPlayerName = p.name || p.element;
          this.deadPlayerElement = p.element;
          this.lost = true;
          this.lostAt = this.time;
          if (global.audio) global.audio.fail();
          return;
        }
      }
    }

    _aabb(a, b) {
      return a.x < b.x + b.w && a.x + a.w > b.x &&
             a.y < b.y + b.h && a.y + a.h > b.y;
    }

    // Compute camera target as centroid of alive players
    cameraTarget() {
      const alive = this.players.filter(p => !p.body.dead);
      const list = alive.length > 0 ? alive : this.players;
      let cx = 0, cy = 0;
      for (const p of list) { cx += p.body.x + p.body.w / 2; cy += p.body.y + p.body.h / 2; }
      cx /= list.length; cy /= list.length;
      return { x: cx, y: cy, targets: list.map(p => ({ x: p.body.x + p.body.w / 2, y: p.body.y + p.body.h / 2 })) };
    }
  }

  // ===========================================================
  // Engine — manages state, scene, loop
  // ===========================================================
  class Engine {
    constructor(canvas) {
      this.canvas = canvas;
      this.renderer = new Renderer(canvas);
      this.state = STATES.BOOT;
      this.scene = null;
      this.keys = {};
      this.lastTime = performance.now();
      this.frameId = null;
      this.currentLevelIndex = 0;
      this.progress = this._loadProgress();
      this.settings = this._loadSettings();
      this._setupInput();
    }

    _loadProgress() {
      try {
        const p = JSON.parse(localStorage.getItem('eq_progress') || '{}');
        return {
          completed: p.completed || {},
          stars: p.stars || {},
          gems: p.gems || {},
        };
      } catch (e) { return { completed: {}, stars: {}, gems: {} }; }
    }

    _saveProgress() {
      try { localStorage.setItem('eq_progress', JSON.stringify(this.progress)); } catch (e) {}
    }

    _loadSettings() {
      try {
        const s = JSON.parse(localStorage.getItem('eq_settings') || '{}');
        return Object.assign({
          volMaster: 80, volMusic: 60, volSfx: 85,
          shake: true, particles: 'med', fps: false, zoom: 100,
        }, s);
      } catch (e) {
        return { volMaster: 80, volMusic: 60, volSfx: 85, shake: true, particles: 'med', fps: false, zoom: 100 };
      }
    }

    _saveSettings() {
      try { localStorage.setItem('eq_settings', JSON.stringify(this.settings)); } catch (e) {}
    }

    _loadUsername() {
      try { return localStorage.getItem('eq_username') || ''; } catch (e) { return ''; }
    }

    applySettings() {
      const s = this.settings;
      if (global.audio) {
        audio.vol.master = s.volMaster / 100;
        audio.vol.music = s.volMusic / 100;
        audio.vol.sfx = s.volSfx / 100;
        audio.applyVolumes();
      }
      if (global.particles) particles.setQuality(s.particles);
      this.renderer.showFps = s.fps;
      this.renderer.setZoom(s.zoom / 100);
    }

    _setupInput() {
      window.addEventListener('keydown', (e) => {
        // Ignore game keys when typing in an input/textarea
        const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea') return;
        this.keys[e.code] = true;
        // Prevent page scroll on arrows / space
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
        // Escape = pause
        if (e.code === 'Escape' && this.state === STATES.PLAYING) {
          this.setState(STATES.PAUSED);
          if (global.ui) global.ui.showOverlay('pause-overlay');
        } else if (e.code === 'Escape' && this.state === STATES.PAUSED) {
          this.setState(STATES.PLAYING);
          if (global.ui) global.ui.hideOverlay('pause-overlay');
        }
      });
      window.addEventListener('keyup', (e) => {
        const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea') return;
        this.keys[e.code] = false;
      });
      window.addEventListener('blur', () => { this.keys = {}; });
    }

    setState(s) { this.state = s; }

    loadLevel(index, players) {
      const level = global.LEVELS[index];
      if (!level) return false;
      this.currentLevelIndex = index;
      this.scene = new GameScene(level, players);
      if (global.audio) audio.startMusic(level.boss ? 'boss' : (level.theme === 'fire' ? 'game2' : 'game1'));
      if (global.particles) particles.clear();
      return true;
    }

    restartLevel() {
      if (!this.scene) return;
      const players = this.scene.players.map(p => ({
        slot: p.slot, element: p.element, name: p.name, isLocal: p.isLocal,
        input: { left: false, right: false, up: false, action: false, sprint: false, jumpPressed: false, actionPressed: false }
      }));
      this._loseTimer = 0;
      this.loadLevel(this.currentLevelIndex, players);
    }

    nextLevel() {
      if (this.currentLevelIndex + 1 < global.LEVELS.length) {
        const players = this.scene.players.map(p => ({
          slot: p.slot, element: p.element, name: p.name, isLocal: p.isLocal,
          input: { left: false, right: false, up: false, action: false, sprint: false, jumpPressed: false, actionPressed: false }
        }));
        this._loseTimer = 0;
        this.loadLevel(this.currentLevelIndex + 1, players);
        return true;
      }
      return false;
    }

    recordWin() {
      const id = this.scene.level.id;
      const time = (performance.now() - this.scene.startTime) / 1000;
      const stars = this._computeStars(time);
      const prev = this.progress.completed[id] || {};
      this.progress.completed[id] = {
        time: prev.time ? Math.min(prev.time, time) : time,
        stars: Math.max(prev.stars || 0, stars),
        gems: Math.max(prev.gems || 0, this.scene.gemsCollected),
      };
      // Unlock next level by recording completion
      this._saveProgress();
      return { time, stars, gems: this.scene.gemsCollected, totalGems: this.scene.gemsTotal };
    }

    _computeStars(time) {
      // 3 stars: all gems + fast time; 2 stars: all gems OR fast time; 1 star: complete
      const gems = this.scene.gemsCollected;
      const total = this.scene.gemsTotal;
      const fastThreshold = 60 + this.scene.level.id * 5;
      let stars = 1;
      if (gems >= total && time < fastThreshold) stars = 3;
      else if (gems >= total || time < fastThreshold) stars = 2;
      return stars;
    }

    isLevelUnlocked(index) {
      if (index === 0) return true;
      const prevId = global.LEVELS[index - 1].id;
      return !!this.progress.completed[prevId];
    }

    // ----------------------------------------------------------
    // Main loop
    // ----------------------------------------------------------
    start() {
      this.lastTime = performance.now();
      const loop = (t) => {
        this.frameId = requestAnimationFrame(loop);
        let dt = (t - this.lastTime) / 1000;
        this.lastTime = t;
        // Clamp dt to prevent physics tunneling
        if (dt > 0.1) dt = 0.1;
        this._tick(dt);
      };
      this.frameId = requestAnimationFrame(loop);
    }

    stop() { if (this.frameId) cancelAnimationFrame(this.frameId); }

    _tick(dt) {
      // Gamepad polling
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      if (global.multiplayer) multiplayer.pollGamepads(gamepads);

      const isOnline = global.net && net.connected;
      const isHost = isOnline && net.isHost;
      const isClient = isOnline && !net.isHost;

      // Update scene
      if (this.state === STATES.PLAYING && this.scene) {
        if (isClient) {
          // === CLIENT MODE ===
          // 1. Sample only our own input
          multiplayer.sampleLocalInput(this.keys, gamepads);
          // 2. Send our input to host (throttled)
          net.maybeSendInput(multiplayer.localSlot, multiplayer.slots[multiplayer.localSlot].input, dt);
          // 3. Apply latest received state from host to all bodies/objects
          if (net._lastState) net.applyState(this.scene, net._lastState);
          // 4. Run prediction for our own body only (smooth local feel)
          this._predictLocalPlayer(dt);
          // 5. Camera follow
          const t = this.scene.cameraTarget();
          this.renderer.camera.follow(t.x, t.y, t.targets);
          this.renderer.camera.update(dt);
          // 6. Win/lose (driven by host state)
          if (this.scene.won) {
            this.setState(STATES.WIN);
            if (global.ui) {
              const stats = this.recordWin();
              global.ui.showWin(stats);
            }
          } else if (this.scene.lost) {
            if (this.state !== STATES.LOSE) {
              this.setState(STATES.LOSE);
              if (global.ui) global.ui.showLose(this.scene.deadPlayerName, this.scene.deadPlayerElement);
            }
            // Auto-restart countdown (client follows host timing)
            this._loseTimer = (this._loseTimer || 0) + dt;
            const countdown = Math.max(0, Math.ceil(3 - this._loseTimer));
            if (global.ui) global.ui.updateLoseCountdown(countdown);
            if (this._loseTimer >= 3) {
              this._loseTimer = 0;
              // Client auto-restarts locally (host will also send restart broadcast)
              this.restartLevel();
              this.setState(STATES.PLAYING);
              if (global.ui) { global.ui.hideAllOverlays(); global.ui._refreshLevelHUD(); }
            }
          }
        } else {
          // === HOST or LOCAL MODE ===
          if (isHost) {
            // Host: sample only own input; remote inputs arrive via net.onInput
            multiplayer.sampleLocalInput(this.keys, gamepads);
          } else {
            // Local: sample all slots from shared keyboard
            multiplayer.sampleInput(this.keys, gamepads);
          }
          // Push inputs to player objects
          for (let i = 0; i < this.scene.players.length; i++) {
            const slot = multiplayer.slots[i];
            if (slot) {
              this.scene.players[i].input = slot.input;
              this.scene.players[i].isLocal = slot.isLocal;
            }
          }
          this.scene.update(dt);
          // Host: broadcast state to clients (throttled)
          if (isHost) net.maybeBroadcastState(this.scene, dt);
          // Camera follow
          const t = this.scene.cameraTarget();
          this.renderer.camera.follow(t.x, t.y, t.targets);
          this.renderer.camera.update(dt);
          // Win/lose
          if (this.scene.won) {
            this.setState(STATES.WIN);
            if (global.ui) {
              const stats = this.recordWin();
              global.ui.showWin(stats);
            }
          } else if (this.scene.lost) {
            if (this.state !== STATES.LOSE) {
              this.setState(STATES.LOSE);
              if (global.ui) global.ui.showLose(this.scene.deadPlayerName, this.scene.deadPlayerElement);
              // If hosting online, broadcast restart to clients after the countdown
              if (isHost && global.net) {
                setTimeout(() => {
                  if (this.scene && this.scene.lost && net.connected) {
                    net.broadcastRestart(this.currentLevelIndex, this.scene.players);
                  }
                }, 3000);
              }
            }
            // Auto-restart countdown
            this._loseTimer = (this._loseTimer || 0) + dt;
            const countdown = Math.max(0, Math.ceil(3 - this._loseTimer));
            if (global.ui) global.ui.updateLoseCountdown(countdown);
            if (this._loseTimer >= 3) {
              this._loseTimer = 0;
              this.restartLevel();
              this.setState(STATES.PLAYING);
              if (global.ui) { global.ui.hideAllOverlays(); global.ui._refreshLevelHUD(); }
            }
          }
        }
      } else {
        // Update camera even when paused (for shake decay)
        this.renderer.camera.update(dt);
      }

      // Render
      if (this.scene) this.renderer.render(this.scene);
      else {
        // Clear canvas
        const ctx = this.renderer.ctx;
        ctx.fillStyle = '#05060a';
        ctx.fillRect(0, 0, this.renderer.camera.viewportW, this.renderer.camera.viewportH);
      }

      // Update HUD
      if (global.ui && (this.state === STATES.PLAYING || this.state === STATES.PAUSED)) {
        global.ui.updateHUD(this.scene);
      }
    }

    /** Client-side prediction: run physics only for the local player's body. */
    _predictLocalPlayer(dt) {
      if (!this.scene || !multiplayer) return;
      const localP = this.scene.players[multiplayer.localSlot];
      if (!localP || !localP.body || localP.body.dead) return;
      // Update moving platforms so collision works correctly
      const phys = this.scene.physics;
      for (const p of phys.movingPlatforms) {
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
      // Apply input to local body only
      const p = localP;
      const b = p.body;
      const inp = p.input || {};
      const prof = b.profile;
      b.sprinting = !!inp.sprint && (inp.left || inp.right);
      const sprintMul = b.sprinting ? (prof.sprintAccelMult || 1.3) : 1;
      let ax = 0;
      if (inp.left)  ax -= prof.walkAccel * sprintMul;
      if (inp.right) ax += prof.walkAccel * sprintMul;
      if (b.inWater) ax *= 0.6;
      b.vx += ax * dt;
      if (ax !== 0) b.facing = ax > 0 ? 1 : -1;
      if (inp.jumpPressed) phys.requestJump(b);
      phys.releaseJump(b);
      if (!inp.up) phys.releaseJump(b);
      if (prof.glide) phys.requestGlide(b, inp.action);
      else phys.requestGlide(b, false);
      // Run physics for this body only
      phys._updateBody(b, dt, this.scene.time);
      phys._checkHazards(b);
    }
  }

  global.GameEngine = Engine;
  global.GAME_STATES = STATES;
  global.GameScene = GameScene;
})(window);
