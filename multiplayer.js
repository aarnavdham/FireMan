/* ============================================================
   ELEMENTAL QUEST — multiplayer.js
   Local-first 1-5 player system. Architecture supports future
   WebSocket upgrade — input messages flow through a sync layer
   that today is local but could be replaced with networked transport.
   ============================================================ */
(function (global) {
  'use strict';

  const ELEMENTS = ['fire', 'water', 'earth', 'ice', 'wind'];
  const ELEMENT_NAMES = { fire: 'Fire', water: 'Water', earth: 'Earth', ice: 'Ice', wind: 'Wind' };
  const ELEMENT_LETTERS = { fire: 'F', water: 'W', earth: 'E', ice: 'I', wind: 'A' };

  // Keyboard control schemes per slot — each has a dedicated sprint key
  const KEY_SCHEMES = [
    { left: ['KeyA'], right: ['KeyD'], up: ['KeyW', 'Space'], action: ['KeyS'], sprint: ['ShiftLeft'], label: 'A/D · W/Space · S · Shift=sprint' },
    { left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], action: ['ArrowDown'], sprint: ['ShiftRight', 'Slash'], label: '←/→ · ↑ · ↓ · RShift=sprint' },
    { left: ['KeyJ'], right: ['KeyL'], up: ['KeyI'], action: ['KeyK'], sprint: ['KeyU'], label: 'J/L · I · K · U=sprint' },
    { left: ['Numpad4'], right: ['Numpad6'], up: ['Numpad8'], action: ['Numpad5'], sprint: ['Numpad0', 'Numpad9'], label: 'Num 4/6 · 8 · 5 · Num0=sprint' },
    { left: ['KeyT'], right: ['KeyY'], up: ['KeyG'], action: ['KeyH'], sprint: ['KeyR'], label: 'T/Y · G · H · R=sprint' },
  ];

  // Generate a 6-char room code
  function generateRoomCode() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[(Math.random() * chars.length) | 0];
    return code;
  }

  class PlayerSlot {
    constructor(index) {
      this.index = index;
      this.element = ELEMENTS[index];
      this.name = `Player ${index + 1}`;
      this.ready = false;
      this.connected = true;
      this.gamepadIndex = null;
      this.scheme = KEY_SCHEMES[index];
      this.input = { left: false, right: false, up: false, action: false, sprint: false, jumpPressed: false, actionPressed: false };
      this.lastInput = {};
      this.color = null; // set by element
      this.isLocal = true;  // true if this slot is controlled from this machine
      this.peerId = null;   // remote peer ID (for online slots)
    }
  }

  class MultiplayerManager {
    constructor() {
      this.roomCode = generateRoomCode();
      this.slots = [];
      this.playerCount = 2;
      this.hostId = 'host-' + Math.random().toString(36).slice(2, 8);
      this.peerId = this.hostId;
      this.peers = [{ id: this.peerId, name: 'You (Host)', isHost: true }];
      this.chatLog = [];
      this.spectator = false;
      this.networkMode = 'local'; // 'local' | 'online' (future)
      this.role = 'host';          // 'host' | 'join'
      this.connected = false;      // true once a room is joined/hosted
      this.localSlot = 0;          // which slot index is "me" on this machine
      this.localName = 'Player';   // this player's display name
      this.gamepadPollTimer = 0;
      this._initSlots();
    }

    _initSlots() {
      this.slots = [];
      for (let i = 0; i < 5; i++) this.slots.push(new PlayerSlot(i));
      this._updateActiveSlots();
    }

    _updateActiveSlots() {
      for (let i = 0; i < 5; i++) {
        this.slots[i].connected = i < this.playerCount;
      }
    }

    setPlayerCount(n) {
      this.playerCount = Math.max(1, Math.min(5, n));
      this._updateActiveSlots();
    }

    getActiveSlots() {
      return this.slots.slice(0, this.playerCount);
    }

    getActiveElements() {
      return ELEMENTS.slice(0, this.playerCount);
    }

    regenerateCode() {
      this.roomCode = generateRoomCode();
      return this.roomCode;
    }

    setElement(slotIndex, element) {
      // Allow swapping elements between active slots
      if (slotIndex < 0 || slotIndex >= this.playerCount) return;
      const other = this.slots.findIndex(s => s.element === element);
      if (other >= 0 && other !== slotIndex) {
        // Swap
        const tmp = this.slots[slotIndex].element;
        this.slots[slotIndex].element = element;
        this.slots[other].element = tmp;
      } else {
        this.slots[slotIndex].element = element;
      }
    }

    toggleReady(slotIndex) {
      if (slotIndex < 0 || slotIndex >= this.playerCount) return;
      this.slots[slotIndex].ready = !this.slots[slotIndex].ready;
    }

    sendChat(author, text) {
      this.chatLog.push({ author, text, t: Date.now() });
      if (this.chatLog.length > 30) this.chatLog.shift();
    }

    sendEmote(emote) {
      const author = 'You';
      this.chatLog.push({ author, text: emote, t: Date.now(), emote: true });
      if (this.chatLog.length > 30) this.chatLog.shift();
    }

    // ----------------------------------------------------------
    // Input sampling — called each frame by engine
    // ----------------------------------------------------------
    sampleInput(keys, gamepads) {
      for (let i = 0; i < this.playerCount; i++) {
        this._sampleSlot(i, keys, gamepads);
      }
    }

    /** Sample only the local player's slot (used for online mode). */
    sampleLocalInput(keys, gamepads) {
      if (this.localSlot < 0 || this.localSlot >= this.playerCount) return;
      this._sampleSlot(this.localSlot, keys, gamepads);
    }

    _sampleSlot(i, keys, gamepads) {
      const slot = this.slots[i];
      if (!slot) return;
      const inp = slot.input;
      const prev = slot.lastInput;
      // Keyboard
      inp.left  = slot.scheme.left.some(k => keys[k]);
      inp.right = slot.scheme.right.some(k => keys[k]);
      inp.up    = slot.scheme.up.some(k => keys[k]);
      inp.action = slot.scheme.action.some(k => keys[k]);
      inp.sprint = slot.scheme.sprint ? slot.scheme.sprint.some(k => keys[k]) : false;
      // Gamepad override if assigned
      if (slot.gamepadIndex !== null && gamepads[slot.gamepadIndex]) {
        const gp = gamepads[slot.gamepadIndex];
        const ax = gp.axes[0] || 0;
        const ay = gp.axes[1] || 0;
        const dz = 0.4;
        if (Math.abs(ax) > dz) { inp.left = ax < 0; inp.right = ax > 0; }
        if (gp.buttons[12] && gp.buttons[12].pressed) inp.left = true;
        if (gp.buttons[14] && gp.buttons[14].pressed) inp.right = true;
        if (gp.buttons[0] && gp.buttons[0].pressed) inp.up = true;
        if (gp.buttons[1] && gp.buttons[1].pressed) inp.action = true;
        // Sprint on gamepad: left bumper (button 6) or left stick click (10)
        if (gp.buttons[10] && gp.buttons[10].pressed) inp.sprint = true;
        if (gp.buttons[6] && gp.buttons[6].pressed) inp.sprint = true;
      }
      // Edge detection
      inp.jumpPressed = inp.up && !prev.up;
      inp.actionPressed = inp.action && !prev.action;
      Object.assign(prev, { left: inp.left, right: inp.right, up: inp.up, action: inp.action, sprint: inp.sprint });
    }

    // Assign any unassigned gamepads to slots
    pollGamepads(gamepads) {
      if (!gamepads) return;
      for (let i = 0; i < gamepads.length; i++) {
        const gp = gamepads[i];
        if (!gp) continue;
        // Check if any button is pressed
        const anyPressed = gp.buttons && gp.buttons.some(b => b && b.pressed);
        if (anyPressed) {
          const already = this.slots.findIndex(s => s.gamepadIndex === i);
          if (already < 0) {
            // Find next slot without gamepad
            const freeSlot = this.slots.findIndex(s => s.gamepadIndex === null && s.index < this.playerCount);
            if (freeSlot >= 0) {
              this.slots[freeSlot].gamepadIndex = i;
            }
          }
        }
        // Disconnect handling: if gamepad is gone, clear
        if (this.slots.some(s => s.gamepadIndex === i && !gp.connected)) {
          const idx = this.slots.findIndex(s => s.gamepadIndex === i);
          if (idx >= 0) this.slots[idx].gamepadIndex = null;
        }
      }
    }

    // ----------------------------------------------------------
    // Network hooks
    // Currently local-only. The connectToRoom/joinRoom methods
    // simulate a network round-trip so the UI feels real. To add
    // true online play later, replace the body of these methods
    // with WebSocket calls — the rest of the engine consumes
    // input via sampleInput() which already supports remote slots.
    // ----------------------------------------------------------
    connectToRoom(code) {
      // Simulated: accept any 6-char code.
      this.roomCode = code || this.roomCode;
      this.role = 'join';
      this.connected = true;
      return Promise.resolve({ ok: true, simulated: true, code: this.roomCode });
    }

    joinRoom(code) {
      // Public alias used by UI; resolves after a short fake delay.
      return new Promise((resolve) => {
        setTimeout(() => {
          this.roomCode = code;
          this.role = 'join';
          this.connected = true;
          resolve({ ok: true, simulated: true, code });
        }, 600);
      });
    }

    hostRoom() {
      this.role = 'host';
      this.connected = true;
      if (!this.roomCode || this.roomCode === '------') this.regenerateCode();
      return Promise.resolve({ ok: true, code: this.roomCode });
    }

    disconnect() {
      this.connected = false;
      this.role = 'host';
    }
    sendInputSnapshot(snapshot) { /* future: WebSocket send */ }
    onRemoteInput(cb) { /* future: WebSocket subscribe */ }

    // Reconnection stub
    handleReconnect() {
      // Restore slot states from saved snapshot
      return Promise.resolve(true);
    }

    // Spectator mode toggle
    setSpectator(on) { this.spectator = on; }
  }

  global.MultiplayerManager = MultiplayerManager;
  global.MULTIPLAYER_ELEMENTS = ELEMENTS;
  global.ELEMENT_NAMES = ELEMENT_NAMES;
  global.ELEMENT_LETTERS = ELEMENT_LETTERS;
  global.MULTIPLAYER_KEY_SCHEMES = KEY_SCHEMES;
})(window);
