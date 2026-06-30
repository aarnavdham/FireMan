/* ============================================================
   ELEMENTAL QUEST — net.js
   Peer-to-peer online multiplayer using PeerJS.
   - Host creates a Peer with ID "eq-<roomcode>"
   - Clients connect to that ID
   - Host is authoritative: runs physics, broadcasts state at 20Hz
   - Clients send input at 30Hz, render received state
   - Client-side prediction for local player's body
   No backend needed — PeerJS uses a free public signaling broker
   for the initial handshake, then direct P2P WebRTC data channels.
   ============================================================ */
(function (global) {
  'use strict';

  const PEER_PREFIX = 'eq-';
  const STATE_HZ = 20;        // host broadcasts state 20x/sec
  const INPUT_HZ = 30;        // clients send input 30x/sec
  const STATE_INTERVAL = 1 / STATE_HZ;
  const INPUT_INTERVAL = 1 / INPUT_HZ;

  class NetManager {
    constructor() {
      this.peer = null;
      this.conns = [];          // host: array of client conns; client: [hostConn]
      this.isHost = false;
      this.connected = false;
      this.roomCode = null;
      // Callbacks (set by engine/ui)
      this.onState = null;       // (state) => {}        [client]
      this.onInput = null;       // (slotIndex, input) => {}  [host]
      this.onPeerJoin = null;    // (peerId, conn) => {}      [host]
      this.onPeerLeave = null;   // (peerId) => {}            [host]
      this.onLobbyUpdate = null; // (lobbyState) => {}        [client]
      this.onLevelStart = null;  // (levelIndex) => {}        [client]
      this.onChat = null;        // (author, text) => {}      [both]
      this.onConnect = null;     // () => {}                  [both]
      this.onDisconnect = null;  // () => {}                  [both]
      this.onError = null;       // (err) => {}               [both]
      // Timing
      this._stateTimer = 0;
      this._inputTimer = 0;
      this._lastState = null;
    }

    static isAvailable() {
      return typeof global.Peer !== 'undefined';
    }

    // ----------------------------------------------------------
    // HOST: create a room. Retries up to 3 times on transient errors.
    // ----------------------------------------------------------
    hostRoom(code) {
      return new Promise((resolve, reject) => {
        if (!NetManager.isAvailable()) {
          reject(new Error('PeerJS not loaded. Check your internet connection.'));
          return;
        }
        const peerId = PEER_PREFIX + code;
        let attempts = 0;
        const maxAttempts = 3;
        const tryCreate = () => {
          attempts++;
          // Destroy any previous peer
          if (this.peer) { try { this.peer.destroy(); } catch (e) {} this.peer = null; }
          // Use explicit config: public PeerJS broker + STUN servers for NAT traversal
          this.peer = new global.Peer(peerId, {
            debug: 1,
            config: {
              iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
              ],
            },
          });
          this.isHost = true;
          this.roomCode = code;
          let settled = false;

          this.peer.on('open', () => {
            if (settled) return;
            settled = true;
            this.connected = true;
            if (this.onConnect) this.onConnect();
            resolve(code);
          });
          this.peer.on('error', (err) => {
            if (settled) return;
            if (err.type === 'unavailable-id') {
              settled = true;
              reject(new Error('Room code already in use. Click ↻ for a new code.'));
              return;
            }
            // Retry on transient errors (network, server error, etc.)
            if (attempts < maxAttempts && ['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
              setTimeout(tryCreate, 800);
              return;
            }
            settled = true;
            reject(new Error('Could not create room: ' + err.type + '. Check your internet and try again.'));
          });
          this.peer.on('connection', (conn) => this._setupConn(conn));
          // Timeout: if no 'open' after 12s, retry or fail
          setTimeout(() => {
            if (!settled) {
              if (attempts < maxAttempts) {
                if (this.peer) { try { this.peer.destroy(); } catch (e) {} this.peer = null; }
                setTimeout(tryCreate, 500);
              } else {
                settled = true;
                reject(new Error('Timed out creating room. Check your internet connection.'));
              }
            }
          }, 12000);
        };
        tryCreate();
      });
    }

    // ----------------------------------------------------------
    // CLIENT: join a room. Retries up to 3 times on transient errors.
    // ----------------------------------------------------------
    joinRoom(code) {
      return new Promise((resolve, reject) => {
        if (!NetManager.isAvailable()) {
          reject(new Error('PeerJS not loaded. Check your internet connection.'));
          return;
        }
        let attempts = 0;
        const maxAttempts = 3;
        const tryJoin = () => {
          attempts++;
          if (this.peer) { try { this.peer.destroy(); } catch (e) {} this.peer = null; }
          this.peer = new global.Peer({
            debug: 1,
            config: {
              iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
              ],
            },
          });
          this.isHost = false;
          this.roomCode = code;
          let settled = false;

          this.peer.on('open', () => {
            if (settled) return;
            const conn = this.peer.connect(PEER_PREFIX + code, {
              reliable: false,
              metadata: { name: 'Player' },
              // Give the connection time to establish
              connectionTimeout: 10000,
            });
            this._setupConn(conn);
            conn.on('open', () => {
              if (settled) return;
              settled = true;
              this.connected = true;
              if (this.onConnect) this.onConnect();
              resolve(code);
            });
            // If connection fails to open, retry or time out
            conn.on('error', (err) => {
              if (settled) return;
              if (attempts < maxAttempts) {
                setTimeout(tryJoin, 1000);
                return;
              }
              settled = true;
              reject(new Error('Could not connect. Host may be offline.'));
            });
            setTimeout(() => {
              if (!settled) {
                if (attempts < maxAttempts) {
                  if (this.peer) { try { this.peer.destroy(); } catch (e) {} this.peer = null; }
                  setTimeout(tryJoin, 800);
                } else {
                  settled = true;
                  reject(new Error('Timed out. Make sure the host has created the room and you typed the code correctly.'));
                }
              }
            }, 10000);
          });
          this.peer.on('error', (err) => {
            if (settled) return;
            if (err.type === 'peer-unavailable') {
              // Host peer not found — retry a few times (host may still be starting up)
              if (attempts < maxAttempts) {
                setTimeout(tryJoin, 1200);
                return;
              }
              settled = true;
              reject(new Error('Room not found. Check the code, or ask the host to click "Create Room".'));
              return;
            }
            // Retry on transient errors
            if (attempts < maxAttempts && ['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
              setTimeout(tryJoin, 1000);
              return;
            }
            settled = true;
            reject(new Error('Could not join: ' + err.type + '. Check your internet and try again.'));
          });
        };
        tryJoin();
      });
    }

    // ----------------------------------------------------------
    // Connection setup (shared by host & client)
    // ----------------------------------------------------------
    _setupConn(conn) {
      const self = this;
      conn.on('open', () => {
        self.conns.push(conn);
        // NOTE: Do NOT call onPeerJoin here. We wait for the 'hello' message
        // which carries the player's name. Calling onPeerJoin here would
        // double-add the player (once on open, once on hello).
      });
      conn.on('data', (data) => {
        self._handleMessage(data, conn);
      });
      conn.on('close', () => {
        self.conns = self.conns.filter(c => c !== conn);
        if (self.isHost && self.onPeerLeave) self.onPeerLeave(conn.peer);
        if (!self.isHost) {
          self.connected = false;
          if (self.onDisconnect) self.onDisconnect();
        }
      });
      conn.on('error', () => {
        self.conns = self.conns.filter(c => c !== conn);
      });
    }

    // ----------------------------------------------------------
    // Message handling
    // ----------------------------------------------------------
    _handleMessage(msg, conn) {
      if (!msg || typeof msg.t !== 'string') return;
      switch (msg.t) {
        // --- Client → Host ---
        case 'hello':
          // Client announces themselves; host will assign a slot
          if (this.isHost && this.onPeerJoin) this.onPeerJoin(conn.peer, conn, msg.name);
          break;
        case 'input':
          // Client input update
          if (this.isHost && this.onInput) this.onInput(msg.s, msg.i);
          break;
        case 'chat':
          if (this.isHost) {
            // Relay to all other clients
            this.broadcast({ t: 'chat', a: msg.a, m: msg.m });
            if (this.onChat) this.onChat(msg.a, msg.m);
          }
          break;
        case 'element':
          // Client wants to change element
          if (this.isHost && this.onInput) this.onInput(msg.s, { _element: msg.e });
          break;

        // --- Host → Client ---
        case 'state':
          if (!this.isHost) {
            this._lastState = msg;
            if (this.onState) this.onState(msg);
          }
          break;
        case 'lobby':
          if (!this.isHost && this.onLobbyUpdate) this.onLobbyUpdate(msg);
          break;
        case 'start':
          if (!this.isHost && this.onLevelStart) this.onLevelStart(msg.idx, msg.players);
          break;
        case 'chat':
          if (!this.isHost && this.onChat) this.onChat(msg.a, msg.m);
          break;
        case 'next':
          if (!this.isHost && this.onLevelStart) this.onLevelStart(msg.idx, msg.players);
          break;
        case 'restart':
          if (!this.isHost && this.onLevelStart) this.onLevelStart(msg.idx, msg.players, true);
          break;
      }
    }

    // ----------------------------------------------------------
    // Broadcasting (host → all clients)
    // ----------------------------------------------------------
    broadcast(msg) {
      for (const conn of this.conns) {
        if (conn.open) {
          try { conn.send(msg); } catch (e) { /* skip */ }
        }
      }
    }

    sendTo(conn, msg) {
      if (conn.open) {
        try { conn.send(msg); } catch (e) { /* skip */ }
      }
    }

    // ----------------------------------------------------------
    // State serialization (host side)
    // ----------------------------------------------------------
    serializeState(scene) {
      // Compact: bodies as arrays, objects as sparse arrays
      const bodies = scene.players.map(p => {
        const b = p.body;
        return [
          b.x, b.y, b.vx, b.vy,
          b.facing, b.dead ? 1 : 0, b.reachedExit ? 1 : 0,
          b.onGround ? 1 : 0, b.sprinting ? 1 : 0,
        ];
      });
      // Names (sent only on first state or when changed — for simplicity, always send)
      const names = scene.players.map(p => p.name || p.element);
      // Dynamic objects: only include mutable state
      const objs = scene.objects.map(o => {
        if (o.type === 'door')    return [o.id, o.open];
        if (o.type === 'button')  return [o.id, o.pressed ? 1 : 0];
        if (o.type === 'switch')  return [o.id, o.active ? 1 : 0];
        if (o.type === 'lever')   return [o.id, o.active ? 1 : 0];
        if (o.type === 'gem' || o.type === 'collectible') return [o.id, o.collected ? 1 : 0];
        if (o.type === 'laser')   return [o.id, o.active ? 1 : 0];
        return null;
      }).filter(x => x !== null);
      // Boxes
      const boxes = scene.physics.boxes.map(bx => [bx.x, bx.y, bx.vx, bx.vy]);
      // Weak floors
      const weakFloors = scene.physics.weakFloors.map(wf => [wf.x, wf.y, wf.broken ? 1 : 0, wf.hp]);
      // Burned solids (wood tiles that fire burned)
      const burned = scene.physics.solids.filter(s => s.burned).map(s => [s.x, s.y]);
      return {
        t: 'state',
        b: bodies,
        n: names,
        o: objs,
        bx: boxes,
        wf: weakFloors,
        bu: burned,
        time: scene.time,
        gems: scene.gemsCollected,
        won: scene.won ? 1 : 0,
        lost: scene.lost ? 1 : 0,
        exits: scene.exitsReached,
      };
    }

    /** Host: throttle state broadcasts to STATE_HZ */
    maybeBroadcastState(scene, dt) {
      this._stateTimer += dt;
      if (this._stateTimer >= STATE_INTERVAL) {
        this._stateTimer = 0;
        this.broadcast(this.serializeState(scene));
      }
    }

    // ----------------------------------------------------------
    // State deserialization (client side)
    // ----------------------------------------------------------
    applyState(scene, state) {
      if (!scene || !state) return;
      // Bodies
      for (let i = 0; i < scene.players.length && i < state.b.length; i++) {
        const p = scene.players[i];
        const b = p.body;
        const s = state.b[i];
        // For local player, use prediction-reconciliation: lerp toward host state
        if (p.isLocal) {
          const lerp = 0.3;
          b.x += (s[0] - b.x) * lerp;
          b.y += (s[1] - b.y) * lerp;
          b.vx += (s[2] - b.vx) * 0.2;
          b.vy = s[3]; // velocity is authoritative
        } else {
          b.x = s[0];
          b.y = s[1];
          b.vx = s[2];
          b.vy = s[3];
        }
        b.facing = s[4];
        b.dead = !!s[5];
        b.reachedExit = !!s[6];
        b.onGround = !!s[7];
        b.sprinting = !!s[8];
      }
      // Names
      if (state.n) {
        for (let i = 0; i < scene.players.length && i < state.n.length; i++) {
          scene.players[i].name = state.n[i];
        }
      }
      // Objects
      const objMap = {};
      for (const o of scene.objects) objMap[o.id] = o;
      for (const [id, val] of state.o) {
        const o = objMap[id];
        if (!o) continue;
        if (o.type === 'door') o.open = val;
        else if (o.type === 'button') o.pressed = !!val;
        else if (o.type === 'switch') o.active = !!val;
        else if (o.type === 'lever') o.active = !!val;
        else if (o.type === 'gem' || o.type === 'collectible') o.collected = !!val;
        else if (o.type === 'laser') o.active = !!val;
      }
      // Boxes
      if (state.bx) {
        for (let i = 0; i < scene.physics.boxes.length && i < state.bx.length; i++) {
          const bx = scene.physics.boxes[i];
          const s = state.bx[i];
          bx.x = s[0]; bx.y = s[1]; bx.vx = s[2]; bx.vy = s[3];
        }
      }
      // Weak floors
      if (state.wf) {
        for (const wfState of state.wf) {
          const wf = scene.physics.weakFloors.find(w => w.x === wfState[0] && w.y === wfState[1]);
          if (wf) { wf.broken = !!wfState[2]; wf.hp = wfState[3]; }
        }
      }
      // Burned solids
      if (state.bu) {
        for (const [x, y] of state.bu) {
          const solid = scene.physics.solids.find(s => s.x === x && s.y === y && s.burnable);
          if (solid) solid.burned = true;
        }
      }
      // Scene state
      scene.time = state.time;
      scene.gemsCollected = state.gems;
      scene.exitsReached = state.exits;
      if (state.won && !scene.won) {
        scene.won = true;
        if (global.audio) global.audio.victory();
      }
      if (state.lost && !scene.lost) {
        scene.lost = true;
        if (global.audio) global.audio.fail();
      }
    }

    // ----------------------------------------------------------
    // Client: send input (throttled)
    // ----------------------------------------------------------
    maybeSendInput(slotIndex, input, dt) {
      this._inputTimer += dt;
      if (this._inputTimer >= INPUT_INTERVAL) {
        this._inputTimer = 0;
        this.broadcast({
          t: 'input',
          s: slotIndex,
          i: {
            l: input.left ? 1 : 0,
            r: input.right ? 1 : 0,
            u: input.up ? 1 : 0,
            a: input.action ? 1 : 0,
            sp: input.sprint ? 1 : 0,
            jp: input.jumpPressed ? 1 : 0,
            ap: input.actionPressed ? 1 : 0,
          }
        });
      }
    }

    // ----------------------------------------------------------
    // Disconnect
    // ----------------------------------------------------------
    disconnect() {
      for (const conn of this.conns) {
        try { conn.close(); } catch (e) {}
      }
      this.conns = [];
      if (this.peer) {
        try { this.peer.destroy(); } catch (e) {}
        this.peer = null;
      }
      this.connected = false;
      this.isHost = false;
      this.roomCode = null;
      this._lastState = null;
    }

    // ----------------------------------------------------------
    // Lobby sync helpers (host → clients)
    // ----------------------------------------------------------
    broadcastLobby(multiplayer) {
      const lobbyState = {
        t: 'lobby',
        count: multiplayer.playerCount,
        localSlot: -1, // host doesn't tell clients their slot here; it's in the conn metadata
        slots: multiplayer.slots.slice(0, multiplayer.playerCount).map(s => ({
          element: s.element,
          name: s.name,
          ready: s.ready,
          isLocal: s.isLocal,
        })),
      };
      // Send to each client with their assigned slot
      this.conns.forEach((conn, i) => {
        lobbyState.localSlot = i + 1; // slot 0 = host, slot 1+ = clients
        this.sendTo(conn, lobbyState);
      });
    }

    broadcastLevelStart(levelIndex, players) {
      this.broadcast({ t: 'start', idx: levelIndex, players: players.map(p => ({ slot: p.slot, element: p.element })) });
    }

    broadcastNextLevel(levelIndex, players) {
      this.broadcast({ t: 'next', idx: levelIndex, players: players.map(p => ({ slot: p.slot, element: p.element })) });
    }

    broadcastRestart(levelIndex, players) {
      this.broadcast({ t: 'restart', idx: levelIndex, players: players.map(p => ({ slot: p.slot, element: p.element })) });
    }

    broadcastChat(author, text) {
      this.broadcast({ t: 'chat', a: author, m: text });
    }
  }

  global.NetManager = NetManager;
  global.net = new NetManager();
})(window);
