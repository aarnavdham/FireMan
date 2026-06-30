/* ============================================================
   ELEMENTAL QUEST — main.js
   Entry point. Boots all systems, runs the game.
   ============================================================ */
(function (global) {
  'use strict';

  // ===========================================================
  // BOOT SEQUENCE
  // ===========================================================
  async function boot() {
    const statusEl = document.getElementById('boot-status');
    const steps = [
      'Initializing engine…',
      'Loading audio engine…',
      'Warming particle pool…',
      'Building level database…',
      'Preparing lobby system…',
      'Calibrating renderer…',
      'Ready!',
    ];
    for (let i = 0; i < steps.length; i++) {
      if (statusEl) statusEl.textContent = steps[i];
      await sleep(180 + Math.random() * 120);
    }
    // Done — show menu
    ui.show('menu');
    audio.startMusic('menu');
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ===========================================================
  // GLOBAL INIT
  // ===========================================================
  window.addEventListener('load', () => {
    // Canvas + Engine
    const canvas = document.getElementById('game-canvas');
    global.engine = new GameEngine(canvas);
    global.multiplayer = new MultiplayerManager();
    global.ui = new UIManager();

    // Apply saved settings
    engine.applySettings();

    // First user gesture unlocks audio
    const unlockAudio = () => {
      audio.init();
      audio.resume();
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
    window.addEventListener('click', unlockAudio);
    window.addEventListener('keydown', unlockAudio);

    // Resize handler (renderer handles its own resize internally)
    window.addEventListener('resize', () => {
      // Renderer._resize is bound to its own resize event already
    });

    // Start the loop
    engine.start();

    // Boot animation
    boot();
  });

  // ===========================================================
  // DEBUG HELPERS (exposed for power users)
  // ===========================================================
  global.EQ_DEBUG = {
    skipToLevel: (i) => {
      if (global.engine && global.ui) {
        ui.startLevel(i);
      }
    },
    godMode: () => {
      if (global.engine && engine.scene) {
        for (const p of engine.scene.players) {
          p.body.profile = Object.assign({}, p.body.profile, { weakHazards: [], safeHazards: ['lava', 'water', 'ice', 'spikes'] });
        }
      }
    },
    unlockAll: () => {
      if (global.engine) {
        for (const lv of LEVELS) {
          engine.progress.completed[lv.id] = { time: 60, stars: 3, gems: lv.gemCount || 0 };
        }
        engine._saveProgress();
        if (global.ui) ui.toast('All levels unlocked!');
      }
    },
  };
})(window);
