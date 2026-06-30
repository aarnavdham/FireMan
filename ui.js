/* ============================================================
   ELEMENTAL QUEST — ui.js
   UI manager: screens, lobby, HUD, overlays, transitions,
   chat, emotes, level select grid, settings persistence.
   ============================================================ */
(function (global) {
  'use strict';

  const ELEMENT_COLORS_CSS = {
    fire:  '#ff5e3a',
    water: '#36c5ff',
    earth: '#b9853d',
    ice:   '#8ee6ff',
    wind:  '#e6f0ff',
  };

  class UIManager {
    constructor() {
      this.screens = ['boot', 'menu', 'lobby', 'levelselect', 'settings', 'howto', 'game'];
      this.current = 'boot';
      this._bindActions();
      this._bindSettings();
      this._initLobby();
    }

    show(name) {
      this.current = name;
      for (const s of this.screens) {
        const el = document.getElementById('screen-' + s);
        if (el) el.classList.toggle('active', s === name);
      }
      // Special: game screen has no .active display (transparent)
      const game = document.getElementById('screen-game');
      if (game) game.style.display = (name === 'game') ? 'block' : 'none';
      if (global.audio) audio.resume();
    }

    // ----------------------------------------------------------
    // Action binding (event delegation for [data-action])
    // ----------------------------------------------------------
    _bindActions() {
      document.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action]');
        if (!target) return;
        const action = target.dataset.action;
        if (global.audio) audio.menuClick();
        this.handle(action, target);
      });
      document.addEventListener('mouseenter', (e) => {
        const t = e.target.closest('.btn, .ls-cell, .btn-mini, .emote, .count-selector button');
        if (t && global.audio) audio.menuHover();
      }, true);
    }

    handle(action, target) {
      switch (action) {
        case 'play':
          // Play = LOCAL mode. One keyboard controls ALL active slots.
          // No online hosting. Great for solo or same-couch co-op.
          this._enterLocalLobby();
          break;
        case 'multiplayer':
          // Multiplayer = ONLINE mode. Go to lobby, default to Host tab.
          // Each keyboard controls only ONE slot.
          this.setLobbyMode('host');
          this.show('lobby');
          this.refreshLobby();
          // Do NOT auto-host — let the user click "Create Room" so they
          // see the status and can retry if the broker is flaky.
          break;
        case 'levelselect':
          this.show('levelselect');
          this.buildLevelGrid();
          break;
        case 'settings':
          this.show('settings');
          this.loadSettingsUI();
          break;
        case 'howto':
          this.show('howto');
          break;
        case 'back':
          if (global.engine && engine.state === 'paused') {
            // From pause back to menu
            engine.scene = null;
            if (global.audio) audio.startMusic('menu');
          }
          // If in lobby and online, disconnect
          if (global.net && net.connected) {
            net.disconnect();
          }
          if (global.multiplayer) {
            multiplayer.networkMode = 'local';
            multiplayer.role = 'host';
            multiplayer.localSlot = 0;
          }
          this.show('menu');
          if (global.audio && engine.state !== 'paused') audio.startMusic('menu');
          break;
        case 'start-game':
          // Only the host (or local mode) can start the game
          if (global.net && net.connected && !net.isHost) {
            this.toast('Only the host can start the game. Wait for them!');
            return;
          }
          this.startGame();
          break;
        case 'pause':
          if (global.engine && engine.state === 'playing') {
            engine.setState('paused');
            this.showOverlay('pause-overlay');
          }
          break;
        case 'resume':
          engine.setState('playing');
          this.hideOverlay('pause-overlay');
          break;
        case 'restart-level':
          engine._loseTimer = 0; // cancel auto-restart countdown
          engine.restartLevel();
          this.hideAllOverlays();
          engine.setState('playing');
          this._refreshLevelHUD();
          // Broadcast restart to online clients
          if (global.net && net.connected && net.isHost) {
            net.broadcastRestart(engine.currentLevelIndex, engine.scene.players);
          }
          break;
        case 'next-level':
          if (engine.nextLevel()) {
            this.hideAllOverlays();
            engine.setState('playing');
            this._refreshLevelHUD();
            // Broadcast next-level to online clients
            if (global.net && net.connected && net.isHost) {
              net.broadcastNextLevel(engine.currentLevelIndex, engine.scene.players);
            }
          } else {
            this.show('menu');
          }
          break;
        case 'quit-menu':
          engine.scene = null;
          this.hideAllOverlays();
          // Disconnect from online session when leaving
          if (global.net && net.connected) net.disconnect();
          if (global.multiplayer) {
            multiplayer.networkMode = 'local';
            multiplayer.role = 'host';
            multiplayer.localSlot = 0;
            multiplayer._initSlots();
            multiplayer.setPlayerCount(2);
          }
          this.show('menu');
          if (global.audio) audio.startMusic('menu');
          break;
        case 'copy-room':
          navigator.clipboard?.writeText(multiplayer.roomCode);
          this.toast('Room code copied!');
          break;
        case 'regen-room':
          multiplayer.regenerateCode();
          this.refreshLobby();
          break;
        case 'join-room':
          this.handleJoinRoom();
          break;
        case 'create-room':
          // Explicit "Create Online Room" button in Host tab
          this.handleHostRoom();
          break;
        case 'reset-progress':
          if (confirm('Reset all progress?')) {
            engine.progress = { completed: {}, stars: {}, gems: {} };
            engine._saveProgress();
            this.toast('Progress reset');
          }
          break;
      }
    }

    // ----------------------------------------------------------
    // Settings bindings
    // ----------------------------------------------------------
    _bindSettings() {
      const binds = [
        ['vol-master', 'volMaster', 'vol-master-val', v => v + '', v => +v],
        ['vol-music',  'volMusic',  'vol-music-val',  v => v + '', v => +v],
        ['vol-sfx',    'volSfx',    'vol-sfx-val',    v => v + '', v => +v],
        ['set-zoom',   'zoom',      'set-zoom-val',   v => v + '%', v => +v],
      ];
      for (const [id, key, valId, fmt, parse] of binds) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.addEventListener('input', () => {
          engine.settings[key] = parse(el.value);
          const valEl = document.getElementById(valId);
          if (valEl) valEl.textContent = fmt(el.value);
          engine.applySettings();
          engine._saveSettings();
        });
      }
      const shake = document.getElementById('set-shake');
      if (shake) shake.addEventListener('change', () => {
        engine.settings.shake = shake.checked;
        engine._saveSettings();
      });
      const part = document.getElementById('set-particles');
      if (part) part.addEventListener('change', () => {
        engine.settings.particles = part.value;
        engine.applySettings();
        engine._saveSettings();
      });
      const fps = document.getElementById('set-fps');
      if (fps) fps.addEventListener('change', () => {
        engine.settings.fps = fps.checked;
        engine.applySettings();
        engine._saveSettings();
      });
    }

    loadSettingsUI() {
      const s = engine.settings;
      document.getElementById('vol-master').value = s.volMaster;
      document.getElementById('vol-master-val').textContent = s.volMaster;
      document.getElementById('vol-music').value = s.volMusic;
      document.getElementById('vol-music-val').textContent = s.volMusic;
      document.getElementById('vol-sfx').value = s.volSfx;
      document.getElementById('vol-sfx-val').textContent = s.volSfx;
      document.getElementById('set-shake').checked = s.shake;
      document.getElementById('set-particles').value = s.particles;
      document.getElementById('set-fps').checked = s.fps;
      document.getElementById('set-zoom').value = s.zoom;
      document.getElementById('set-zoom-val').textContent = s.zoom + '%';
    }

    // ----------------------------------------------------------
    // Lobby
    // ----------------------------------------------------------
    _initLobby() {
      const cs = document.getElementById('count-selector');
      if (!cs) return;
      cs.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => {
          const n = +b.dataset.count;
          multiplayer.setPlayerCount(n);
          if (global.audio) audio.menuClick();
          this.refreshLobby();
        });
      });
      // Emotes
      document.querySelectorAll('.emote').forEach(b => {
        b.addEventListener('click', () => {
          this._sendChatMessage(b.dataset.emote);
        });
      });
      // Chat input (typeable)
      const chatInput = document.getElementById('chat-input');
      const chatSendBtn = document.getElementById('chat-send-btn');
      if (chatInput) {
        chatInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this._sendChatMessage(chatInput.value);
            chatInput.value = '';
          }
          // Stop keystrokes from reaching the game while typing
          e.stopPropagation();
        });
      }
      if (chatSendBtn) {
        chatSendBtn.addEventListener('click', () => {
          const chatInput = document.getElementById('chat-input');
          if (chatInput) {
            this._sendChatMessage(chatInput.value);
            chatInput.value = '';
            chatInput.focus();
          }
        });
      }
      // Host / Join tabs
      document.querySelectorAll('.lobby-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          const mode = tab.dataset.mode;
          this.setLobbyMode(mode);
        });
      });
      // Join input: auto-uppercase + Enter key submits
      const joinInput = document.getElementById('join-code-input');
      if (joinInput) {
        joinInput.addEventListener('input', () => {
          joinInput.value = joinInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        });
        joinInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') this.handleJoinRoom();
        });
      }
      // Username input
      const usernameInput = document.getElementById('username-input');
      if (usernameInput) {
        // Load saved name
        const saved = engine._loadUsername();
        if (saved) usernameInput.value = saved;
        else usernameInput.value = 'Player' + ((Math.random() * 89 + 10) | 0);
        this._applyUsername();
        usernameInput.addEventListener('input', () => {
          this._applyUsername();
        });
        usernameInput.addEventListener('change', () => {
          // If already hosting online, re-broadcast lobby with new name
          if (global.net && net.connected && net.isHost) {
            net.broadcastLobby(multiplayer);
          }
          // If connected as client, send hello again with new name
          if (global.net && net.connected && !net.isHost) {
            net.broadcast({ t: 'hello', name: multiplayer.localName });
          }
        });
      }
    }

    /** Read the username input and store it on the multiplayer manager. */
    _applyUsername() {
      const input = document.getElementById('username-input');
      if (!input) return;
      const name = input.value.trim().substring(0, 14) || 'Player';
      if (global.multiplayer) {
        multiplayer.localName = name;
        // In local mode, apply the name to slot 0
        if (multiplayer.networkMode === 'local' || !multiplayer.networkMode) {
          multiplayer.slots[0].name = name;
        } else if (multiplayer.role === 'host') {
          multiplayer.slots[0].name = name;
        }
      }
      // Save to localStorage
      try { localStorage.setItem('eq_username', name); } catch (e) {}
      // Update hint
      const hint = document.getElementById('username-hint');
      if (hint) hint.textContent = 'This shows above your character in-game';
      this.refreshLobby();
    }

    setLobbyMode(mode) {
      const isHost = mode === 'host';
      // Show the tabs (they may have been hidden in local mode)
      const tabsEl = document.querySelector('.lobby-tabs');
      if (tabsEl) tabsEl.style.display = '';
      // Tab active states
      document.querySelectorAll('.lobby-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.mode === mode);
      });
      // Toggle headers
      const hostHeader = document.getElementById('host-header');
      const joinHeader = document.getElementById('join-header');
      if (hostHeader) hostHeader.style.display = isHost ? '' : 'none';
      if (joinHeader) joinHeader.style.display = isHost ? 'none' : '';
      // Restore header text/visibility (in case local mode changed it)
      const h2 = hostHeader?.querySelector('h2');
      if (h2) h2.textContent = 'Host Lobby';
      const roomInfo = hostHeader?.querySelector('.room-info');
      if (roomInfo) roomInfo.style.display = '';
      // In Join mode: hide the lobby body (slots, count selector, etc.) — joiners only enter a code.
      // Once connected, the host will push lobby state and we'll show the body again (read-only).
      const lobbyBody = document.getElementById('lobby-body');
      const lobbyFooter = document.querySelector('.lobby-footer');
      if (isHost) {
        if (lobbyBody) lobbyBody.style.display = '';
        if (lobbyFooter) lobbyFooter.style.display = '';
      } else {
        // Hide body until connected
        const isConnected = global.net && net.connected;
        if (lobbyBody) lobbyBody.style.display = isConnected ? '' : 'none';
        if (lobbyFooter) lobbyFooter.style.display = isConnected ? '' : 'none';
      }
      // Update role
      if (global.multiplayer) {
        multiplayer.role = isHost ? 'host' : 'join';
        if (isHost) {
          // Generate a fresh code to show (will be used when Create Room is clicked)
          if (!multiplayer.roomCode || multiplayer.roomCode === '------') {
            multiplayer.regenerateCode();
          }
          // Update note
          const note = document.getElementById('lobby-note');
          if (note) note.textContent = 'Click "Create Room" to go online. Share the code so friends can join from their own device.';
          const statusEl = document.getElementById('join-status');
          if (statusEl) { statusEl.textContent = 'Click Create Room to start hosting.'; statusEl.className = 'join-status'; }
        } else {
          const codeEl = document.getElementById('room-code');
          if (codeEl) codeEl.textContent = '------';
          const statusEl = document.getElementById('join-status');
          if (statusEl) { statusEl.textContent = 'Enter the 6-character code and click Join.'; statusEl.className = 'join-status'; }
          const joinInput = document.getElementById('join-code-input');
          if (joinInput) joinInput.value = '';
          if (joinInput) setTimeout(() => joinInput.focus(), 50);
        }
        this.refreshLobby();
      }
      if (global.audio) audio.menuClick();
    }

    /** Enter LOCAL lobby mode — one keyboard controls all active slots, no online. */
    _enterLocalLobby() {
      // Reset to local mode
      if (global.net && net.connected) net.disconnect();
      if (global.multiplayer) {
        multiplayer.networkMode = 'local';
        multiplayer.role = 'host';
        multiplayer.localSlot = 0;
        // In local mode, ALL slots are "local" (controlled from this keyboard)
        for (let i = 0; i < 5; i++) multiplayer.slots[i].isLocal = true;
      }
      // Show the lobby with a local-mode banner (hide the tabs since it's local-only)
      const tabsEl = document.querySelector('.lobby-tabs');
      if (tabsEl) tabsEl.style.display = 'none';
      const hostHeader = document.getElementById('host-header');
      const joinHeader = document.getElementById('join-header');
      if (hostHeader) hostHeader.style.display = '';
      if (joinHeader) joinHeader.style.display = 'none';
      // Customize header for local mode
      const h2 = hostHeader?.querySelector('h2');
      if (h2) h2.textContent = 'Local Co-op';
      const roomInfo = hostHeader?.querySelector('.room-info');
      if (roomInfo) roomInfo.style.display = 'none';
      // Show a local-mode note
      const note = document.getElementById('lobby-note');
      if (note) note.textContent = 'LOCAL MODE: One keyboard controls all players. Set player count above. Switch to Multiplayer for online play.';
      this.show('lobby');
      this.refreshLobby();
      if (global.audio) audio.menuClick();
    }

    /** Called when user clicks "Create Room" — creates a real P2P room. */
    handleHostRoom() {
      if (!global.net || !NetManager.isAvailable()) {
        const statusEl = document.getElementById('join-status');
        if (statusEl) { statusEl.textContent = '✗ Online mode unavailable — PeerJS failed to load. You can still play local co-op via the Play button.'; statusEl.className = 'join-status error'; }
        return;
      }
      // Already hosting? Don't re-create.
      if (net.connected && net.isHost) {
        this.toast('Already hosting room ' + multiplayer.roomCode);
        return;
      }
      // Disconnect any previous session
      net.disconnect();
      const code = multiplayer.roomCode;
      const statusEl = document.getElementById('join-status');
      const createBtn = document.getElementById('create-room-btn');
      if (createBtn) { createBtn.disabled = true; createBtn.textContent = 'Creating…'; }
      if (statusEl) { statusEl.textContent = 'Creating room ' + code + '…'; statusEl.className = 'join-status'; }
      // Wire callbacks before hosting
      this._wireNetCallbacks();
      // Try to create the P2P peer with our room code
      net.hostRoom(code).then(() => {
        multiplayer.networkMode = 'online';
        multiplayer.role = 'host';
        multiplayer.localSlot = 0;
        // In online host mode, ONLY slot 0 is local (this keyboard). Other slots are remote.
        for (let i = 0; i < 5; i++) multiplayer.slots[i].isLocal = (i === 0);
        // Default player count to 2 in online mode (host + first joiner)
        multiplayer.setPlayerCount(2);
        if (statusEl) {
          statusEl.textContent = '✓ Room ' + code + ' is LIVE! Share this code with friends so they can join.';
          statusEl.className = 'join-status success';
        }
        if (createBtn) { createBtn.disabled = false; createBtn.textContent = 'Room Live ✓'; createBtn.classList.add('btn-hosting'); }
        this.toast('Room ' + code + ' live! Share the code.');
        this.refreshLobby();
        if (global.audio) audio.switchOn();
      }).catch((err) => {
        console.warn('Host failed:', err);
        if (statusEl) {
          statusEl.textContent = '✗ ' + (err.message || 'Could not create room.');
          statusEl.className = 'join-status error';
        }
        if (createBtn) { createBtn.disabled = false; createBtn.textContent = 'Create Room'; }
        if (global.audio) audio.fail();
      });
    }

    handleJoinRoom() {
      const input = document.getElementById('join-code-input');
      const statusEl = document.getElementById('join-status');
      if (!input || !statusEl) return;
      const code = input.value.trim().toUpperCase();
      if (code.length < 6) {
        statusEl.textContent = 'Code must be 6 characters.';
        statusEl.className = 'join-status error';
        return;
      }
      if (!global.net || !NetManager.isAvailable()) {
        statusEl.textContent = '✗ Online mode unavailable — PeerJS failed to load. Check internet connection.';
        statusEl.className = 'join-status error';
        return;
      }
      const joinBtn = document.querySelector('[data-action="join-room"]');
      if (joinBtn) { joinBtn.disabled = true; joinBtn.textContent = 'Connecting…'; }
      statusEl.textContent = 'Connecting to room ' + code + '… (this may take a few seconds)';
      statusEl.className = 'join-status';
      // Disconnect any previous session
      net.disconnect();
      // In online client mode, NO slots are local yet — host will assign our slot via lobby update
      for (let i = 0; i < 5; i++) multiplayer.slots[i].isLocal = false;
      // Wire callbacks before joining
      this._wireNetCallbacks();
      net.joinRoom(code).then(() => {
        multiplayer.networkMode = 'online';
        multiplayer.role = 'join';
        multiplayer.roomCode = code;
        // localSlot will be assigned by host via lobby update; default to 1
        multiplayer.localSlot = 1;
        multiplayer.slots[1].isLocal = true; // tentative until host assigns
        statusEl.textContent = '✓ Connected to room ' + code + '! Waiting for host to start the game…';
        statusEl.className = 'join-status success';
        const codeEl = document.getElementById('room-code');
        if (codeEl) codeEl.textContent = code;
        // Show the lobby body now that we're connected (read-only view of slots)
        const lobbyBody = document.getElementById('lobby-body');
        const lobbyFooter = document.querySelector('.lobby-footer');
        if (lobbyBody) lobbyBody.style.display = '';
        if (lobbyFooter) lobbyFooter.style.display = '';
        // Send hello to host with our username
        net.broadcast({ t: 'hello', name: multiplayer.localName || 'Player' });
        if (global.audio) audio.switchOn();
        if (joinBtn) { joinBtn.disabled = false; joinBtn.textContent = 'Join'; }
      }).catch((err) => {
        console.warn('Join failed:', err);
        statusEl.textContent = '✗ ' + (err.message || 'Could not join room.');
        statusEl.className = 'join-status error';
        if (global.audio) audio.fail();
        if (joinBtn) { joinBtn.disabled = false; joinBtn.textContent = 'Join'; }
      });
    }

    /** Wire up NetManager callbacks to update local state/UI. */
    _wireNetCallbacks() {
      if (!global.net) return;
      // Host: a new client connected
      net.onPeerJoin = (peerId, conn, name) => {
        // Assign next available slot to this client
        const slotIdx = multiplayer.playerCount;
        if (slotIdx >= 5) {
          // Room full
          net.sendTo(conn, { t: 'chat', a: 'System', m: 'Room is full.' });
          return;
        }
        // Increase player count to include this client
        multiplayer.setPlayerCount(slotIdx + 1);
        multiplayer.slots[slotIdx].isLocal = false;
        multiplayer.slots[slotIdx].peerId = peerId;
        multiplayer.slots[slotIdx].name = name || `Player ${slotIdx + 1}`;
        // Send lobby state to all clients (with their slot index)
        net.broadcastLobby(multiplayer);
        this.refreshLobby();
        multiplayer.sendChat('System', `${multiplayer.slots[slotIdx].name} joined`);
        this.refreshChat();
        if (global.audio) audio.switchOn();
      };
      // Host: a client disconnected
      net.onPeerLeave = (peerId) => {
        const idx = multiplayer.slots.findIndex(s => s.peerId === peerId);
        if (idx >= 0) {
          multiplayer.slots[idx].isLocal = true; // reclaim as local AI slot
          multiplayer.slots[idx].peerId = null;
        }
        net.broadcastLobby(multiplayer);
        this.refreshLobby();
        multiplayer.sendChat('System', `Player ${idx + 1} left`);
        this.refreshChat();
      };
      // Host: received input from a client
      net.onInput = (slotIndex, input) => {
        if (slotIndex < 0 || slotIndex >= multiplayer.slots.length) return;
        const slot = multiplayer.slots[slotIndex];
        if (input._element) {
          // Element change request
          multiplayer.setElement(slotIndex, input._element);
          net.broadcastLobby(multiplayer);
          this.refreshLobby();
          return;
        }
        // Decode compact input
        slot.input.left = !!input.l;
        slot.input.right = !!input.r;
        slot.input.up = !!input.u;
        slot.input.action = !!input.a;
        slot.input.sprint = !!input.sp;
        slot.input.jumpPressed = !!input.jp;
        slot.input.actionPressed = !!input.ap;
      };
      // Client: received lobby state from host
      net.onLobbyUpdate = (state) => {
        multiplayer.playerCount = state.count;
        if (state.localSlot >= 0) multiplayer.localSlot = state.localSlot;
        for (let i = 0; i < state.slots.length; i++) {
          multiplayer.slots[i].element = state.slots[i].element;
          multiplayer.slots[i].name = state.slots[i].name;
          multiplayer.slots[i].ready = state.slots[i].ready;
          multiplayer.slots[i].isLocal = (i === multiplayer.localSlot);
        }
        // Mark our own slot as local
        if (multiplayer.localSlot >= 0 && multiplayer.localSlot < 5) {
          multiplayer.slots[multiplayer.localSlot].isLocal = true;
        }
        this.refreshLobby();
      };
      // Client: host told us to start a level
      net.onLevelStart = (levelIndex, players, isRestart) => {
        // Build player objects from the host's player list
        const playerObjs = players.map(p => ({
          slot: p.slot,
          element: p.element,
          input: { left: false, right: false, up: false, action: false, sprint: false, jumpPressed: false, actionPressed: false },
          isLocal: p.slot === multiplayer.localSlot,
        }));
        engine.loadLevel(levelIndex, playerObjs);
        engine.setState('playing');
        this.show('game');
        this.hideAllOverlays();
        this._refreshLevelHUD();
        if (isRestart) this.toast('Host restarted the level');
        else this.toast('Level started!');
      };
      // Both: chat
      net.onChat = (author, text) => {
        multiplayer.chatLog.push({ author, text, t: Date.now() });
        if (multiplayer.chatLog.length > 30) multiplayer.chatLog.shift();
        this.refreshChat();
      };
      // Client: disconnected from host
      net.onDisconnect = () => {
        this.toast('Disconnected from host.');
        this.show('menu');
        if (global.audio) audio.startMusic('menu');
      };
    }

    refreshLobby() {
      // Room code
      document.getElementById('room-code').textContent = multiplayer.roomCode;
      // Count selector
      const cs = document.getElementById('count-selector');
      cs.querySelectorAll('button').forEach(b => {
        b.classList.toggle('active', +b.dataset.count === multiplayer.playerCount);
      });
      // Determine mode for slot labels
      const isOnline = global.net && net.connected;
      const isClient = isOnline && !net.isHost;
      // In online mode, hide the count selector (host controls it; clients receive it)
      cs.style.display = isClient ? 'none' : '';
      const csHeader = cs.parentElement.querySelector('h3');
      if (csHeader) csHeader.textContent = isClient ? 'Player Count (host sets)' : 'Player Count';
      // Player slots
      const slotsEl = document.getElementById('player-slots');
      slotsEl.innerHTML = '';
      for (let i = 0; i < 5; i++) {
        const slot = multiplayer.slots[i];
        const active = i < multiplayer.playerCount;
        const el = document.createElement('div');
        el.className = 'player-slot ' + (active ? 'filled' : 'empty');
        if (active) {
          el.style.setProperty('--slot-color', ELEMENT_COLORS_CSS[slot.element]);
          // Build status label based on mode
          let statusLabel;
          if (isOnline) {
            if (slot.isLocal) statusLabel = '⌨ YOU (this keyboard)';
            else if (slot.peerId) statusLabel = '🌐 Remote player';
            else if (net.isHost) statusLabel = '⏳ Waiting for player…';
            else statusLabel = 'Remote';
          } else {
            // Local mode: all active slots are controlled by this keyboard
            statusLabel = '⌨ This keyboard';
          }
          // Show controls hint only for local slots
          const controlsHTML = slot.isLocal || !isOnline
            ? `<div class="ps-controls">${slot.scheme.label}</div>`
            : '';
          el.innerHTML = `
            <div class="ps-avatar">${ELEMENT_LETTERS[slot.element]}</div>
            <div class="ps-name">${slot.name}</div>
            <div class="ps-elem">${ELEMENT_NAMES[slot.element]}</div>
            <div class="ps-status">${statusLabel}</div>
            ${controlsHTML}
          `;
          // Only allow element cycling in local mode or as host
          if (!isClient) {
            el.addEventListener('click', () => {
              const idx = MULTIPLAYER_ELEMENTS.indexOf(slot.element);
              const next = MULTIPLAYER_ELEMENTS[(idx + 1) % MULTIPLAYER_ELEMENTS.length];
              multiplayer.setElement(i, next);
              if (global.audio) audio.menuClick();
              this.refreshLobby();
              // If hosting, notify clients
              if (isOnline && net.isHost) net.broadcastLobby(multiplayer);
            });
          }
        } else {
          el.innerHTML = 'Empty Slot';
          // Only host/local can add slots
          if (!isClient) {
            el.addEventListener('click', () => {
              multiplayer.setPlayerCount(i + 1);
              if (global.audio) audio.menuClick();
              this.refreshLobby();
              if (isOnline && net.isHost) net.broadcastLobby(multiplayer);
            });
          }
        }
        slotsEl.appendChild(el);
      }
      // Elements preview
      const ep = document.getElementById('elements-preview');
      ep.innerHTML = '';
      for (const el_name of MULTIPLAYER_ELEMENTS) {
        const chip = document.createElement('div');
        chip.className = 'ep-chip' + (MULTIPLAYER_ELEMENTS.indexOf(el_name) < multiplayer.playerCount ? ' active' : '');
        chip.style.setProperty('--chip-color', ELEMENT_COLORS_CSS[el_name]);
        chip.textContent = ELEMENT_NAMES[el_name];
        ep.appendChild(chip);
      }
      // Chat
      this.refreshChat();
    }

    refreshChat() {
      const cb = document.getElementById('chat-box');
      if (!cb) return;
      cb.innerHTML = '';
      for (const line of multiplayer.chatLog.slice(-10)) {
        const div = document.createElement('div');
        div.className = 'chat-line';
        if (line.emote) {
          div.innerHTML = `<span class="chat-author">${line.author}:</span> ${line.text}`;
        } else {
          div.innerHTML = `<span class="chat-author">${line.author}:</span> ${this._escapeHtml(line.text)}`;
        }
        cb.appendChild(div);
      }
      cb.scrollTop = cb.scrollHeight;
    }

    _escapeHtml(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    /** Send a chat message: locally + over network (if online). */
    _sendChatMessage(text) {
      text = (text || '').trim();
      if (!text) return;
      const author = multiplayer.localName || 'Player';
      // Add to local chat log
      multiplayer.chatLog.push({ author, text, t: Date.now() });
      if (multiplayer.chatLog.length > 30) multiplayer.chatLog.shift();
      this.refreshChat();
      // Send over network
      if (global.net && net.connected) {
        net.broadcastChat(author, text);
      }
      if (global.audio) audio.menuClick();
    }

    // ----------------------------------------------------------
    // Level select
    // ----------------------------------------------------------
    buildLevelGrid() {
      const grid = document.getElementById('ls-grid');
      grid.innerHTML = '';
      let completedCount = 0;
      for (let i = 0; i < LEVELS.length; i++) {
        const lv = LEVELS[i];
        const unlocked = engine.isLevelUnlocked(i);
        const compl = engine.progress.completed[lv.id];
        if (compl) completedCount++;
        const cell = document.createElement('div');
        cell.className = 'ls-cell' + (unlocked ? '' : ' locked') + (compl ? ' completed' : '');
        const stars = compl ? compl.stars : 0;
        const starsStr = '★'.repeat(stars) + '<span class="empty">' + '★'.repeat(3 - stars) + '</span>';
        const elemsHTML = (lv.requiredElements || []).map(e => `<span class="ls-elem-dot" style="--dot:${ELEMENT_COLORS_CSS[e]}"></span>`).join('');
        cell.innerHTML = `
          <div class="ls-stars">${unlocked ? starsStr : ''}</div>
          <div class="ls-num">${lv.id}</div>
          <div class="ls-name">${lv.name}</div>
          <div class="ls-elems">${elemsHTML}</div>
          ${lv.boss ? '<div style="color:#ff4d6d;font:700 9px/1 Segoe UI;letter-spacing:1px">BOSS</div>' : ''}
          ${lv.bonus ? '<div style="color:#ffd166;font:700 9px/1 Segoe UI;letter-spacing:1px">BONUS</div>' : ''}
        `;
        if (unlocked) {
          cell.addEventListener('click', () => {
            // Start this level
            this.startLevel(i);
          });
        }
        grid.appendChild(cell);
      }
      // Progress
      const pct = (completedCount / LEVELS.length) * 100;
      document.getElementById('ls-progress-fill').style.width = pct + '%';
      document.getElementById('ls-progress-text').textContent = `${completedCount} / ${LEVELS.length} completed`;
    }

    // ----------------------------------------------------------
    // Start game
    // ----------------------------------------------------------
    startGame() {
      // Use current lobby config
      const players = [];
      for (let i = 0; i < multiplayer.playerCount; i++) {
        const slot = multiplayer.slots[i];
        players.push({
          slot: i,
          element: slot.element,
          name: slot.name || (i === 0 ? multiplayer.localName : `Player ${i + 1}`),
          input: { left: false, right: false, up: false, action: false, sprint: false, jumpPressed: false, actionPressed: false },
          isLocal: slot.isLocal,
        });
      }
      // Pick first unlocked unplayed level (level 1 normally, or continue)
      let idx = 0;
      for (let i = 0; i < LEVELS.length; i++) {
        if (!engine.progress.completed[LEVELS[i].id]) { idx = i; break; }
      }
      this.startLevel(idx, players);
    }

    startLevel(index, players) {
      if (!players) {
        players = [];
        for (let i = 0; i < multiplayer.playerCount; i++) {
          const slot = multiplayer.slots[i];
          players.push({
            slot: i,
            element: slot.element,
            name: slot.name || (i === 0 ? multiplayer.localName : `Player ${i + 1}`),
            input: { left: false, right: false, up: false, action: false, sprint: false, jumpPressed: false, actionPressed: false },
            isLocal: slot.isLocal,
          });
        }
      }
      // Ensure multiplayer count matches level requirements (clamp)
      const lv = LEVELS[index];
      if (players.length < lv.minPlayers) {
        // Top up with AI or just allow (we allow)
      }
      engine.loadLevel(index, players);
      engine.setState('playing');
      this.show('game');
      this.hideAllOverlays();
      // Show hint briefly
      if (lv.hint) {
        this.showHint(lv.hint);
      }
      // Build player HUD
      this._buildPlayerHUD(players);
      // Update level title / gems counter
      this._refreshLevelHUD();
      // If hosting online, tell all clients to start this level too
      if (global.net && net.connected && net.isHost) {
        net.broadcastLevelStart(index, players);
      }
    }

    /** Refresh the HUD level title, name, and gem counters from the active scene. */
    _refreshLevelHUD() {
      if (!engine.scene) return;
      const lv = engine.scene.level;
      const levelEl = document.getElementById('hud-level');
      const nameEl = document.getElementById('hud-name');
      const gemsTotalEl = document.getElementById('hud-gems-total');
      const gemsEl = document.getElementById('hud-gems');
      if (levelEl) levelEl.textContent = `Level ${lv.id}`;
      if (nameEl) nameEl.textContent = lv.name;
      if (gemsTotalEl) gemsTotalEl.textContent = lv.gemCount || 0;
      if (gemsEl) gemsEl.textContent = engine.scene.gemsCollected || 0;
      // Rebuild player HUD in case player count changed
      if (engine.scene.players) this._buildPlayerHUD(engine.scene.players.map(p => ({ slot: p.slot, element: p.element })));
      // Show hint if available
      if (lv.hint) this.showHint(lv.hint);
    }

    _buildPlayerHUD(players) {
      const cont = document.getElementById('hud-players');
      cont.innerHTML = '';
      for (const p of players) {
        const el = document.createElement('div');
        el.className = 'hud-player';
        el.id = 'hud-player-' + p.slot;
        el.style.setProperty('--p-color', ELEMENT_COLORS_CSS[p.element]);
        const displayName = p.name || ELEMENT_NAMES[p.element];
        el.innerHTML = `
          <div class="hp-icon">${ELEMENT_LETTERS[p.element]}</div>
          <div class="hp-info">
            <div class="hp-name">${displayName}</div>
            <div class="hp-status">${ELEMENT_NAMES[p.element]}</div>
          </div>
        `;
        cont.appendChild(el);
      }
    }

    updateHUD(scene) {
      if (!scene) return;
      // Timer
      const t = (performance.now() - scene.startTime) / 1000;
      const mm = Math.floor(t / 60);
      const ss = Math.floor(t % 60);
      document.getElementById('hud-timer').textContent = `${mm}:${ss.toString().padStart(2, '0')}`;
      // Gems
      document.getElementById('hud-gems').textContent = scene.gemsCollected;
      // Player status
      for (const p of scene.players) {
        const el = document.getElementById('hud-player-' + p.slot);
        if (!el) continue;
        const b = p.body;
        el.classList.toggle('dead', b.dead || b.reachedExit);
        // Update name (in case it changed via network)
        const nameEl = el.querySelector('.hp-name');
        if (nameEl && p.name) nameEl.textContent = p.name;
        const status = el.querySelector('.hp-status');
        if (b.reachedExit) status.textContent = '✓ At Exit';
        else if (b.dead) status.textContent = '✗ Fallen';
        else status.textContent = ELEMENT_NAMES[p.element];
      }
    }

    // ----------------------------------------------------------
    // Overlays
    // ----------------------------------------------------------
    showOverlay(id) {
      const el = document.getElementById(id);
      if (el) el.classList.add('active');
    }
    hideOverlay(id) {
      const el = document.getElementById(id);
      if (el) el.classList.remove('active');
    }
    hideAllOverlays() {
      document.querySelectorAll('.overlay-panel').forEach(el => el.classList.remove('active'));
    }

    showWin(stats) {
      const statsEl = document.getElementById('win-stats');
      const t = stats.time;
      const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
      statsEl.innerHTML = `
        <div class="stat-block"><span class="stat-val">${mm}:${ss.toString().padStart(2, '0')}</span><span class="stat-lbl">Time</span></div>
        <div class="stat-block"><span class="stat-val">${stats.gems}/${stats.totalGems}</span><span class="stat-lbl">Gems</span></div>
        <div class="stat-block"><span class="stat-val">${engine.scene.players.length}</span><span class="stat-lbl">Heroes</span></div>
      `;
      const starsEl = document.getElementById('win-stars');
      starsEl.innerHTML = '★'.repeat(stats.stars) + '<span class="empty">' + '★'.repeat(3 - stats.stars) + '</span>';
      this.showOverlay('win-overlay');
    }

    showLose(deadName, deadElement) {
      const titleEl = document.getElementById('lose-title');
      const reasonEl = document.getElementById('lose-reason');
      const countdownEl = document.getElementById('restart-countdown');
      if (deadName) {
        if (titleEl) titleEl.textContent = `${deadName} died`;
        if (reasonEl) {
          const elemName = ELEMENT_NAMES[deadElement] || '';
          reasonEl.textContent = `The ${elemName} hero has fallen. Restarting…`;
        }
      } else {
        if (titleEl) titleEl.textContent = 'Heroes Fallen…';
        if (reasonEl) reasonEl.textContent = 'Try again, together.';
      }
      if (countdownEl) countdownEl.textContent = 'Restarting in 3…';
      this.showOverlay('lose-overlay');
    }

    updateLoseCountdown(n) {
      const el = document.getElementById('restart-countdown');
      if (el) el.textContent = `Restarting in ${n}…`;
    }

    toast(msg) {
      const el = document.getElementById('hud-toast');
      el.textContent = msg;
      el.classList.add('show');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
    }

    showHint(msg) {
      const el = document.getElementById('hud-hint');
      el.textContent = msg;
      el.classList.add('show');
      clearTimeout(this._hintTimer);
      this._hintTimer = setTimeout(() => el.classList.remove('show'), 5500);
    }
  }

  global.UIManager = UIManager;
  global.UI_ELEMENT_COLORS = ELEMENT_COLORS_CSS;
})(window);
