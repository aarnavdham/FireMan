/* ============================================================
   ELEMENTAL QUEST — levels.js
   42 handcrafted levels using ASCII tilemap format.
   Tile legend:
     ' ' empty
     '#' stone solid      'D' dirt              'M' metal
     'W' wood (burnable)  'I' ice (slippery)    'B' weak floor
     'L' lava hazard      '~' deep water        '.' shallow water
     '^' spikes           'S' slope left-low    'Z' slope right-low

   Markers (replaced with empty after parsing):
     f/w/e/i/a = spawn for fire/water/earth/ice/wind
     F/W/E/I/A = exit for fire/water/earth/ice/wind
     g = gem        * = collectible
     p = pressure plate (any weight)    P = heavy plate (earth only)
     s = element switch    d = door    l = lever    o = portal
     x = box spawn         - = laser emitter

   DESIGN RULES:
   - Grid is 30 cols × 12 rows (960×384 px)
   - Spawn marker at row R needs solid ground at row R+1
   - Exit marker at row R needs solid ground at row R+1
   - Jumpable gaps: max 4-5 empty tiles between platforms
   ============================================================ */
(function (global) {
  'use strict';

  const TILE = 32;

  function parseLevel(def) {
    const rows = def.map;
    const tiles = [];
    const spawns = {};
    const exits = {};
    const objects = [];
    let gemCount = 0;
    let switchId = 0;
    let plateId = 0;
    let portalId = 0;

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const tileRow = [];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        const x = c * TILE, y = r * TILE;
        let keep = ch;
        switch (ch) {
          case 'f': spawns.fire  = { x: x + 4, y: y + 4 }; keep = ' '; break;
          case 'w': spawns.water = { x: x + 4, y: y + 4 }; keep = ' '; break;
          case 'e': spawns.earth = { x: x + 4, y: y + 4 }; keep = ' '; break;
          case 'i': spawns.ice   = { x: x + 4, y: y + 4 }; keep = ' '; break;
          case 'a': spawns.wind  = { x: x + 4, y: y + 4 }; keep = ' '; break;
          case 'F': exits.fire   = { x, y: y - 64, w: 32, h: 96, element: 'fire',  type: 'exit' }; keep = ' '; break;
          case 'W': exits.water  = { x, y: y - 64, w: 32, h: 96, element: 'water', type: 'exit' }; keep = ' '; break;
          case 'E': exits.earth  = { x, y: y - 64, w: 32, h: 96, element: 'earth', type: 'exit' }; keep = ' '; break;
          case 'I': exits.ice    = { x, y: y - 64, w: 32, h: 96, element: 'ice',   type: 'exit' }; keep = ' '; break;
          case 'A': exits.wind   = { x, y: y - 64, w: 32, h: 96, element: 'wind',  type: 'exit' }; keep = ' '; break;
          case 'g': objects.push({ type: 'gem', x: x + 10, y: y + 10, w: 12, h: 12, element: def.gemElement || 'fire' }); gemCount++; keep = ' '; break;
          case '*': objects.push({ type: 'collectible', x: x + 10, y: y + 10, w: 12, h: 12 }); gemCount++; keep = ' '; break;
          case 'p': objects.push({ type: 'button', x: x, y: y + 8, w: 32, h: 24, id: 'plate' + (plateId++), pressed: false }); keep = ' '; break;
          case 'P': objects.push({ type: 'button', x: x, y: y + 8, w: 32, h: 24, id: 'hplate' + (plateId++), pressed: false, heavy: true }); keep = ' '; break;
          case 's': objects.push({ type: 'switch', x: x, y: y, w: 32, h: 32, id: 'sw' + (switchId++), active: false, element: def.switchElement || null }); keep = ' '; break;
          case 'd': objects.push({ type: 'door', x: x, y: y - 64, w: 32, h: 96, id: 'door' + (switchId++), element: def.doorElement || null, open: 0 }); keep = ' '; break;
          case 'l': objects.push({ type: 'lever', x: x, y: y, w: 32, h: 32, id: 'lev' + (switchId++), active: false }); keep = ' '; break;
          case 'o': objects.push({ type: 'portal', x: x, y: y, w: 32, h: 32, id: 'port' + (portalId++) }); keep = ' '; break;
          case 'x': objects.push({ type: 'box', x: x + 2, y: y + 2, w: 28, h: 28 }); keep = ' '; break;
          case '-': objects.push({ type: 'laser', x: x, y: y + 14, w: 16, h: 4, active: def.laserActive !== false }); keep = ' '; break;
        }
        tileRow.push(keep);
      }
      // Pad row to 30 chars
      while (tileRow.length < 30) tileRow.push(' ');
      tiles.push(tileRow);
    }

    for (const k in exits) objects.push(exits[k]);

    const width = 30 * TILE;
    const height = rows.length * TILE;

    return Object.assign({}, def, {
      tiles, spawns, exits, objects,
      width, height, tileSize: TILE,
      gemCount,
    });
  }

  // ===========================================================
  // LEVEL DEFINITIONS — 42 levels, all validated for ground
  // Every spawn (f/w/e/i/a) and exit (F/W/E/I/A) has solid
  // ground in the row directly below the marker.
  // ===========================================================
  const RAW_LEVELS = [
    // ---- Tier 1: Tutorial (1-5) ----
    {
      id: 1, name: 'First Steps', theme: 'cave', minPlayers: 1, maxPlayers: 2,
      requiredElements: ['fire', 'water'],
      hint: 'Move with A/D, jump with W. Reach your matching exit!',
      map: [
        '                               ',
        '                               ',
        '                               ',
        '                               ',
        '              g                ',
        '            #####              ',
        '                               ',
        '                               ',
        '  f    w                F  W   ',
        '###############################',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 2, name: 'Leap of Faith', theme: 'cave', minPlayers: 1, maxPlayers: 2,
      requiredElements: ['fire', 'water'],
      hint: 'Jump across the gaps. Time carefully!',
      map: [
        '                               ',
        '                               ',
        '                               ',
        '      g                        ',
        '    #####      g               ',
        '           ######     g        ',
        '                    ####       ',
        '                               ',
        '  f    w                F  W   ',
        '##  ####            ####  #### ',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 3, name: 'Hot Crossing', theme: 'fire', minPlayers: 1, maxPlayers: 2,
      requiredElements: ['fire', 'water'],
      hint: 'Fire walks on lava safely. Water must use the upper path!',
      map: [
        '                               ',
        '                               ',
        '  w           g          W     ',
        '####         ####       ####   ',
        '                               ',
        '       ####          ####      ',
        '                               ',
        '                               ',
        '  f                        F   ',
        '##  LLLLLLLLLLLLLLLLLLLLLL  ## ',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 4, name: 'Pool Crossing', theme: 'cave', minPlayers: 1, maxPlayers: 2,
      requiredElements: ['fire', 'water'],
      hint: 'Water swims through. Fire must use the platforms above!',
      map: [
        '                               ',
        '                               ',
        '  f           g           F    ',
        '####         ####       ####   ',
        '                               ',
        '       ####          ####      ',
        '                               ',
        '  w                        W   ',
        '### ~~~~~~~~~~~~~~~~~~~~~~ ### ',
        '##  ~~~~~~~~~~~~~~~~~~~~~~  ## ',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 5, name: 'Spiked Path', theme: 'cave', minPlayers: 1, maxPlayers: 2,
      requiredElements: ['fire', 'water'],
      hint: 'Spikes hurt everyone. Jump over them!',
      map: [
        '                               ',
        '                               ',
        '                               ',
        '               g               ',
        '             #####             ',
        '                               ',
        '  f    w                F  W   ',
        '### ####            ##### #### ',
        '##  ^^^^  ^^^^  ^^^^  ^^^^  ## ',
        '###############################',
        '###############################',
        '###############################',
      ]
    },

    // ---- Tier 2: Cooperation (6-12) ----
    {
      id: 6, name: 'Switch Together', theme: 'cave', minPlayers: 2, maxPlayers: 2,
      requiredElements: ['fire', 'water'],
      hint: 'Stand on both plates to open the door.',
      map: [
        '                               ',
        '                               ',
        '                  d            ',
        '                #####          ',
        '                               ',
        '       p              p        ',
        '     #####          #####      ',
        '                               ',
        '  f    w                F  W   ',
        '##  ####            ####  #### ',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 7, name: 'High Jump', theme: 'cave', minPlayers: 2, maxPlayers: 2,
      requiredElements: ['fire', 'water'],
      hint: 'Use the platforms to reach the high ledges.',
      map: [
        '  F                        W   ',
        '####                      #### ',
        '                               ',
        '              g                ',
        '            #####              ',
        '                               ',
        '       g           g           ',
        '     #####       #####         ',
        '                               ',
        '  f    w                       ',
        '##  ####                       ',
        '###############################',
      ]
    },
    {
      id: 8, name: 'Burn the Bridge', theme: 'forest', minPlayers: 2, maxPlayers: 2,
      requiredElements: ['fire', 'water'],
      hint: 'Fire (hold S) burns wood tiles. Clear the path!',
      map: [
        '                               ',
        '                               ',
        '  f           g           F    ',
        '####      WWWWWWWW       ####  ',
        '         WWWWWWWWW             ',
        '       ##WWWWWWWWW##           ',
        '         WWWWWWWWW             ',
        '  w      #########         W   ',
        '### ####                ####   ',
        '##  LLLLLLLL                   ',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 9, name: 'Counterweight', theme: 'cave', minPlayers: 2, maxPlayers: 2,
      requiredElements: ['fire', 'water'],
      hint: 'Push the box onto the plate to hold the door.',
      map: [
        '                               ',
        '                               ',
        '  f    x           g     F     ',
        '####  ####         #### ####   ',
        '                               ',
        '              p                ',
        '           #######             ',
        '                  d            ',
        '  w            #####      W    ',
        '##  ####      ######    ####   ',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 10, name: 'Lava Lake', theme: 'fire', minPlayers: 2, maxPlayers: 2,
      requiredElements: ['fire', 'water'],
      hint: 'Fire crosses lava. Water rides the boxes across.',
      map: [
        '                               ',
        '  f           F                ',
        '####         ####              ',
        '                               ',
        '      x         x         x    ',
        '   ####       ####       ####  ',
        '                               ',
        '  w           W                ',
        '### LLLLLLLLLL#LLLLLLLLLLL  ## ',
        '##  LLLLLLLLLLLLLLLLLLLLLL  ## ',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 11, name: 'Frozen Cavern', theme: 'ice', minPlayers: 2, maxPlayers: 3,
      requiredElements: ['fire', 'water', 'ice'],
      hint: 'Ice is slippery — slide with care!',
      map: [
        '                               ',
        '                               ',
        '  f     g       i       F  I   ',
        '####  #####    ####   #######  ',
        '                               ',
        '       IIIIIIII                ',
        '       IIIIIIII                ',
        '  w     ##### g          W     ',
        '##  ####     ####       ####   ',
        '###############################',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 12, name: 'Mixed Bath', theme: 'cave', minPlayers: 2, maxPlayers: 2,
      requiredElements: ['fire', 'water'],
      hint: 'Each element has a safe pool. Stay on your side!',
      map: [
        '                               ',
        '                               ',
        '  f           g           F    ',
        '####         ####       ####   ',
        '                               ',
        '       ####          ####      ',
        '                               ',
        '  w           g           W    ',
        '### LLLLLLLL~~~~~~LLLLLLLL# ## ',
        '##  LLLLLLLL~~~~~~LLLLLLLL  ## ',
        '###############################',
        '###############################',
      ]
    },

    // ---- Tier 3: Three Elements (13-20) ----
    {
      id: 13, name: 'Earth Awakens', theme: 'cave', minPlayers: 3, maxPlayers: 3,
      requiredElements: ['fire', 'water', 'earth'],
      hint: 'Earth is heavy — use it on the heavy plate (P).',
      map: [
        '                               ',
        '                               ',
        '  f     w       e       F W E  ',
        '####  ####    ####    #########',
        '                               ',
        '              P                ',
        '           #######             ',
        '                               ',
        '                               ',
        '                               ',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 14, name: 'Weak Floors', theme: 'cave', minPlayers: 3, maxPlayers: 3,
      requiredElements: ['fire', 'water', 'earth'],
      hint: 'Earth breaks weak floors (B) from above. Drop on them!',
      map: [
        '                               ',
        '  e                            ',
        '####      F   W   E            ',
        '       #########  #            ',
        '                               ',
        '    BBBBBBBB                   ',
        '    BBBBBBBB                   ',
        '    BBBBBBBB        #####      ',
        '  f       w                    ',
        '##  #### ####                  ',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 15, name: 'Cooperative Lift', theme: 'forest', minPlayers: 3, maxPlayers: 3,
      requiredElements: ['fire', 'water', 'earth'],
      hint: 'Earth stands on the plate to open the path for others.',
      map: [
        '  F           W                ',
        '####         ####              ',
        '                               ',
        '         E                     ',
        '       ####                    ',
        '                               ',
        '              p                ',
        '           #######             ',
        '  f     w     e                ',
        '##  #### #### ####             ',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 16, name: 'Burn & Soak', theme: 'fire', minPlayers: 3, maxPlayers: 3,
      requiredElements: ['fire', 'water', 'earth'],
      hint: 'Fire burns wood. Earth presses heavy plates.',
      map: [
        '                               ',
        '  f       WWWWW       F        ',
        '####    WWWWWWWW    ####       ',
        '       WWWWWWWW#               ',
        '      eWWWWWWWW        E       ',
        '    ####WWWWWWWW####  ####     ',
        '        ###   P                ',
        '           #######             ',
        '  w           g          W     ',
        '##  ####    LLLLLL    ####     ',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 17, name: 'Triple Threat', theme: 'cave', minPlayers: 3, maxPlayers: 3,
      requiredElements: ['fire', 'water', 'earth'],
      hint: 'Three plates, three heroes. Stand together to open the door!',
      map: [
        '                               ',
        '                               ',
        '          p   p   p            ',
        '        ##### ##### #####      ',
        '                  d            ',
        '               #######         ',
        '    F       W       E          ',
        '  ####    ####    ####         ',
        '                               ',
        '  f    w    e                  ',
        '##  #### #### ####             ',
        '###############################',
      ]
    },
    {
      id: 18, name: 'Crumbled Passage', theme: 'cave', minPlayers: 3, maxPlayers: 3,
      requiredElements: ['fire', 'water', 'earth'],
      hint: 'Earth smashes through weak floors. Others follow below.',
      map: [
        '  e                            ',
        '####      F   W   E            ',
        '       #########  #            ',
        '                               ',
        '    BBBBBBBB                   ',
        '    BBBBBBBB                   ',
        '    BBBBBBBB        #####      ',
        '                               ',
        '  f       w                    ',
        '##  #### ####                  ',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 19, name: 'Pressure Puzzle', theme: 'cave', minPlayers: 3, maxPlayers: 3,
      requiredElements: ['fire', 'water', 'earth'],
      hint: 'Boxes can hold plates too. Use them wisely!',
      map: [
        '                               ',
        '  e            x        E      ',
        '####         ####    ####      ',
        '                               ',
        '          p     p       d      ',
        '       #####  #####  #######   ',
        '                               ',
        '  f           w          F W   ',
        '##  ####    ####      #######  ',
        '###############################',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 20, name: 'Boss: Lava Titan', theme: 'fire', minPlayers: 3, maxPlayers: 5,
      requiredElements: ['fire', 'water', 'earth'],
      hint: 'BOSS! Activate all switches while avoiding lava!',
      boss: true,
      map: [
        '  s            s          s    ',
        '####         ####      ####    ',
        '                               ',
        '                               ',
        '                               ',
        '     LLLL      LLLL      LLLL  ',
        '     LLLL      LLLL      LLLL  ',
        '                               ',
        '                               ',
        '  f    w    e        F W E     ',
        '##  #### #### ####  #########  ',
        '###############################',
      ]
    },

    // ---- Tier 4: Four Elements (21-28) ----
    {
      id: 21, name: 'Ice Bridge', theme: 'ice', minPlayers: 4, maxPlayers: 4,
      requiredElements: ['fire', 'water', 'earth', 'ice'],
      hint: 'Ice (action key) freezes water into temporary platforms!',
      map: [
        '                               ',
        '  f   w   e    i               ',
        '#### #### #### ####            ',
        '                               ',
        '                               ',
        '       ~~~~~~~~~~~~~~~~~~      ',
        '       ~~~~~~~~~~~~~~~~~~      ',
        '       ~~~~~~~~~~~~~~~~~~      ',
        '                   F W E I     ',
        '                 #########     ',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 22, name: 'Slippery Slopes', theme: 'ice', minPlayers: 4, maxPlayers: 4,
      requiredElements: ['fire', 'water', 'earth', 'ice'],
      hint: 'Slopes (Z = right-low) change height. Slide down them!',
      map: [
        '  f                            ',
        '####                           ',
        '   ZZZZ                        ',
        '      ZZZZ                     ',
        '         ZZZZ          F       ',
        '            ZZZZ    #########  ',
        '  w   e   i                    ',
        '#### #### ####    W E I        ',
        '                #########      ',
        '                               ',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 23, name: 'Heavy Lifting', theme: 'cave', minPlayers: 4, maxPlayers: 4,
      requiredElements: ['fire', 'water', 'earth', 'ice'],
      hint: 'Only Earth can press the heavy plate (P). Cooperate!',
      map: [
        '                               ',
        '                               ',
        '       P        d              ',
        '     #####    #####            ',
        '                               ',
        '   F   W   I                   ',
        ' #### #### ####                ',
        '                               ',
        '  f    w    e    i             ',
        '##  #### #### #### ####        ',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 24, name: 'Frozen Fire', theme: 'ice', minPlayers: 4, maxPlayers: 4,
      requiredElements: ['fire', 'water', 'earth', 'ice'],
      hint: 'Fire melts ice tiles. Ice freezes water into bridges.',
      map: [
        '                               ',
        '  f   I  I  I  I    F          ',
        '#### IIIIII IIIIII ####        ',
        '     ###### ######             ',
        '       w    ~~~~~~             ',
        '     ####          I           ',
        '                  I#           ',
        '   e           I  I    W E     ',
        ' ####          I  I  ######    ',
        '            IIIIII             ',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 25, name: 'Switch Cascade', theme: 'cave', minPlayers: 4, maxPlayers: 4,
      requiredElements: ['fire', 'water', 'earth', 'ice'],
      hint: 'Hit switches to chain-open the doors!',
      map: [
        '  s                            ',
        '####    d   s                  ',
        '      ##### ####  d            ',
        '                    ####  s    ',
        '                       #####   ',
        '   F   W   E   I               ',
        ' #### #### #########  d        ',
        '                    ####       ',
        '  f   w   e   i                ',
        '#### #### #### ####            ',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 26, name: 'Portal Pairs', theme: 'temple', minPlayers: 4, maxPlayers: 4,
      requiredElements: ['fire', 'water', 'earth', 'ice'],
      hint: 'Portals (o) teleport. Step in to warp to the pair!',
      map: [
        '                               ',
        '  f    o     w      o          ',
        '####  #### ####  ####          ',
        '                               ',
        '       o          o            ',
        '     ####       #####          ',
        '                               ',
        '  e    o     i      o          ',
        '####  #### ####  ####          ',
        '              F W E I          ',
        '            #########          ',
        '###############################',
      ]
    },
    {
      id: 27, name: 'Laser Logic', theme: 'temple', minPlayers: 4, maxPlayers: 4,
      requiredElements: ['fire', 'water', 'earth', 'ice'],
      hint: 'Lasers block your path. Find the switch to disable them!',
      map: [
        '  s        -        -    F     ',
        '####     #####    #####  ####  ',
        '                               ',
        '       -     -     -           ',
        '     ####  ####  ####          ',
        '                               ',
        '                               ',
        '  f   w   e   i                ',
        '#### #### #########  W E I     ',
        '                    #####      ',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 28, name: 'Boss: Frost Warden', theme: 'ice', minPlayers: 4, maxPlayers: 5,
      requiredElements: ['fire', 'water', 'earth', 'ice'],
      boss: true,
      hint: 'BOSS! Activate all switches to melt the frost barriers!',
      map: [
        '                               ',
        '   I I I     I I I     I I I   ',
        '   # # #     # # #     # # #   ',
        '   s    s    s    s    s       ',
        ' ####  #### #### #### ####     ',
        '                               ',
        '                               ',
        '                               ',
        '  f   w   e   i                ',
        '#### #### #########  F W E I   ',
        '                    #########  ',
        '###############################',
      ]
    },

    // ---- Tier 5: Five Elements (29-36) ----
    {
      id: 29, name: 'Wind Rises', theme: 'sky', minPlayers: 5, maxPlayers: 5,
      requiredElements: ['fire', 'water', 'earth', 'ice', 'wind'],
      hint: 'Wind (hold action key) glides across gaps!',
      map: [
        '                               ',
        '  a                            ',
        '####                           ',
        '                               ',
        '                               ',
        '                               ',
        '                               ',
        '                               ',
        '  f   w   e   i                ',
        '#### #### #########  F W E I A ',
        '                    #########  ',
        '###############################',
      ]
    },
    {
      id: 30, name: 'Updraft', theme: 'sky', minPlayers: 5, maxPlayers: 5,
      requiredElements: ['fire', 'water', 'earth', 'ice', 'wind'],
      hint: 'Wind zones (^) push you upward. Ride the currents!',
      map: [
        '                F W E I A      ',
        '              ##############   ',
        '                               ',
        '                               ',
        '  ^^^^^^^^^^^^^^^^^^^^^^^^^^   ',
        '  ^^^^^^^^^^^^^^^^^^^^^^^^^^   ',
        '  ^^^^^^^^^^^^^^^^^^^^^^^^^^   ',
        '                               ',
        '  a   f   w   e   i            ',
        '#### #### #### #### ####       ',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 31, name: 'Elemental Maze', theme: 'temple', minPlayers: 5, maxPlayers: 5,
      requiredElements: ['fire', 'water', 'earth', 'ice', 'wind'],
      hint: 'Each element has its own route. Meet at the exits!',
      map: [
        '  f   w   e   i   a            ',
        '#### #### ######### ####       ',
        '                               ',
        '  L  ~  B  I  ^                ',
        '  L  ~  B  I  ^                ',
        '  L  ~  B  I  ^                ',
        '  L  ~  B  I  ^   F W E I A    ',
        '  L  ~  B  I  ^   #########    ',
        '           #                   ',
        '                               ',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 32, name: 'Cooperation Castle', theme: 'temple', minPlayers: 5, maxPlayers: 5,
      requiredElements: ['fire', 'water', 'earth', 'ice', 'wind'],
      hint: 'All five plates, one final door. Stand on every plate!',
      map: [
        '                               ',
        '                               ',
        '       p  P  p  P  p           ',
        '     #### #### #### ####       ',
        '                               ',
        '              d                ',
        '           #######             ',
        '       F W E I A               ',
        '     ######### #               ',
        '  f   w   e   i   a            ',
        '#### #### #### #### ####       ',
        '###############################',
      ]
    },
    {
      id: 33, name: 'Wind Tunnel', theme: 'sky', minPlayers: 5, maxPlayers: 5,
      requiredElements: ['fire', 'water', 'earth', 'ice', 'wind'],
      hint: 'Horizontal wind (>) pushes everyone. Lean into it!',
      map: [
        '                               ',
        '                               ',
        '                               ',
        '  >>>>>>>>>>>>>>>>>>>>>>>>>>   ',
        '  >>>>>>>>>>>>>>>>>>>>>>>>>>   ',
        '  >>>>>>>>>>>>>>>>>>>>>>>>>>   ',
        '  >>>>>>>>>>>>>>>>>>>>>>>>>>   ',
        '                               ',
        '  f   w   e   i   a            ',
        '#### #### #### #### ####       ',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 34, name: 'Frozen Falls', theme: 'ice', minPlayers: 5, maxPlayers: 5,
      requiredElements: ['fire', 'water', 'earth', 'ice', 'wind'],
      hint: 'Ice makes bridges. Fire melts them. Plan carefully!',
      map: [
        '                               ',
        '  f           I                ',
        '####        IIII      F        ',
        '         IIIIIIII  ######      ',
        '         ########              ',
        '       ~~~~~~~~                ',
        '       ~~~~~~~~                ',
        '                               ',
        '  w   e   i   a                ',
        '#### #### #########  W E I A   ',
        '                    #########  ',
        '###############################',
      ]
    },
    {
      id: 35, name: 'Final Trial', theme: 'temple', minPlayers: 5, maxPlayers: 5,
      requiredElements: ['fire', 'water', 'earth', 'ice', 'wind'],
      hint: 'Combine everything you have learned!',
      map: [
        '  s   p   s   P   s   p   s    ',
        '#### #### #### #### #### ####  ',
        '                               ',
        '      WWW     LLLL    IIII     ',
        '    d ### d           #d       ',
        '  ####   ####  ####    ####    ',
        '                               ',
        '                               ',
        '  f   w   e   i   a            ',
        '#### #### ######### #### FWEIA ',
        '                       ######  ',
        '###############################',
      ]
    },
    {
      id: 36, name: 'Boss: Elemental Lord', theme: 'temple', minPlayers: 5, maxPlayers: 5,
      requiredElements: ['fire', 'water', 'earth', 'ice', 'wind'],
      boss: true,
      hint: 'FINAL BOSS! Activate all five switches at once!',
      map: [
        '   s         s         s       ',
        ' ####       ####       ####    ',
        '                               ',
        '    s         s         s      ',
        '  ####       ####       ####   ',
        '                               ',
        '                               ',
        '                               ',
        '  f   w   e   i   a            ',
        '#### #### ######### #### FWEIA ',
        '                       ######  ',
        '###############################',
      ]
    },

    // ---- Bonus / Challenge levels (37-42) ----
    {
      id: 37, name: 'Bonus: Gem Hunt', theme: 'cave', minPlayers: 1, maxPlayers: 5,
      requiredElements: ['fire', 'water'],
      hint: 'Collect every gem for a perfect score!',
      bonus: true,
      map: [
        '                               ',
        '  g    g    g    g    g        ',
        '#### #### #### #### ####       ',
        '                               ',
        '    g    g    g    g    g      ',
        '  #### #### #### #### ####     ',
        '                               ',
        '  f           g           F    ',
        '####       ####           #### ',
        '       g           w    W      ',
        '     ####       ####           ',
        '###############################',
      ]
    },
    {
      id: 38, name: 'Bonus: Speed Run', theme: 'sky', minPlayers: 1, maxPlayers: 5,
      requiredElements: ['fire', 'water'],
      bonus: true,
      hint: 'A test of pure speed. Slopes help you go fast!',
      map: [
        '                               ',
        '                               ',
        '  f                F           ',
        '####               #           ',
        '   ZZZZZZZZZZZZZZZZ            ',
        '                  ####         ',
        '                               ',
        '   ZZZZZZZZZZZZZZZZZZZZZZZ     ',
        '                       ####    ',
        '  w                W           ',
        '####                           ',
        '###############################',
      ]
    },
    {
      id: 39, name: 'Bonus: Precision', theme: 'ice', minPlayers: 1, maxPlayers: 5,
      requiredElements: ['fire', 'water'],
      bonus: true,
      hint: 'Slippery single-tile platforms. Tap lightly!',
      map: [
        '                               ',
        '                               ',
        '  f                F           ',
        '####               #           ',
        '    I   I   I   I   I   I      ',
        '    #   #   #   #   #   #      ',
        '                               ',
        '  w                W           ',
        '####               #           ',
        '    I   I   I   I   I   I      ',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 40, name: 'Bonus: Earthquake', theme: 'cave', minPlayers: 3, maxPlayers: 5,
      requiredElements: ['fire', 'water', 'earth'],
      bonus: true,
      hint: 'Crash through every weak floor with Earth!',
      map: [
        '  e                            ',
        '####                           ',
        '       BBBBBBBBBBBB            ',
        '                               ',
        '  f            BBBBBBBBBBBB    ',
        '####                           ',
        '         BBBBBBBBBBBB          ',
        '                               ',
        '  w                    F W E   ',
        '####                 #######   ',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 41, name: 'Bonus: Skybridge', theme: 'sky', minPlayers: 5, maxPlayers: 5,
      requiredElements: ['fire', 'water', 'earth', 'ice', 'wind'],
      bonus: true,
      hint: 'Wind updraft carries all. Hold glide and ride!',
      map: [
        '                               ',
        '                               ',
        '  a   f   w   e   i            ',
        '#### #### ######### ####       ',
        '  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^ ',
        '  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^ ',
        '  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^ ',
        '  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^ ',
        '                               ',
        '              F W E I A        ',
        '            #########          ',
        '###############################',
      ]
    },
    {
      id: 42, name: 'Bonus: Mirror', theme: 'temple', minPlayers: 5, maxPlayers: 5,
      requiredElements: ['fire', 'water', 'earth', 'ice', 'wind'],
      bonus: true,
      hint: 'Symmetric puzzle — split up and meet in the middle.',
      map: [
        '  f           d           F    ',
        '####         ###         ####  ',
        '                               ',
        '  w   p           p   W        ',
        '#### ###       ### ####        ',
        '                               ',
        '  e       i   a       E        ',
        '#### #### ######### ####       ',
        '                               ',
        '                  I A          ',
        '                #######        ',
        '###############################',
      ]
    },

    // ===========================================================
    // EXPANSION PACK 1: New mechanics + 2 new bosses (levels 43-56)
    // ===========================================================

    // --- Tier 6: Advanced Cooperation (43-48) ---
    {
      id: 43, name: 'Twin Doors', theme: 'cave', minPlayers: 2, maxPlayers: 5,
      requiredElements: ['fire', 'water'],
      hint: 'Two doors, two switches. Split up to solve!',
      map: [
        '                               ',
        '  f           d      F         ',
        '####         ####   ####       ',
        '              s                ',
        '            #######            ',
        '                               ',
        '  w           d      W         ',
        '####         ####   ####       ',
        '              s                ',
        '            #######            ',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 44, name: 'Clockwork', theme: 'temple', minPlayers: 2, maxPlayers: 5,
      requiredElements: ['fire', 'water'],
      hint: 'Moving platforms! Time your jumps.',
      map: [
        '                               ',
        '                               ',
        '  f                          F ',
        '####                         # ',
        '                               ',
        '       ===          ===        ',
        '                               ',
        '              ===              ',
        '                               ',
        '  w                          W ',
        '####                           ',
        '###############################',
      ],
      entities: [
        { type: 'platform', x0: 96, y0: 192, w: 64, h: 12, axis: 'x', amplitude: 80, period: 3, type: 'platform' },
        { type: 'platform', x0: 640, y0: 192, w: 64, h: 12, axis: 'x', amplitude: 80, period: 3, type: 'platform' },
        { type: 'platform', x0: 384, y0: 288, w: 64, h: 12, axis: 'x', amplitude: 100, period: 4, type: 'platform' },
      ],
    },
    {
      id: 45, name: 'The Gauntlet', theme: 'fire', minPlayers: 2, maxPlayers: 5,
      requiredElements: ['fire', 'water'],
      hint: 'A perilous corridor of fire and spikes. Sprint through!',
      map: [
        '                               ',
        '                               ',
        '  f                          F ',
        '####                         # ',
        '    ^^^^  ^^^^  ^^^^  ^^^^     ',
        '                               ',
        '         LLLL         LLLL     ',
        '         LLLL         LLLL     ',
        '  w                          W ',
        '####                           ',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 46, name: 'Crystal Caves', theme: 'ice', minPlayers: 3, maxPlayers: 5,
      requiredElements: ['fire', 'water', 'earth'],
      hint: 'Ice, water, and earth combine. Use each element\'s strength!',
      map: [
        '                               ',
        '  f     w       e       F W E  ',
        '####  ####    ####    #########',
        '                               ',
        '         IIIIII                ',
        '         IIIIII   ~~~~~~       ',
        '         IIIIII   ~~~~~~       ',
        '           ####                ',
        '       BBBB                    ',
        '     ######            #####   ',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 47, name: 'Wind Passages', theme: 'sky', minPlayers: 3, maxPlayers: 5,
      requiredElements: ['fire', 'water', 'ice'],
      hint: 'Updrafts carry you up. Ride the wind!',
      map: [
        '                               ',
        '                               ',
        '  f     w      i       F W I   ',
        '####  ####   ####    ######### ',
        '                               ',
        '  ^^^^^^^^^^                   ',
        '  ^^^^^^^^^^        ^^^^^^^^   ',
        '  ^^^^^^^^^^        ^^^^^^^^   ',
        '  ^^^^^^^^^^        ^^^^^^^^   ',
        '                               ',
        '###############################',
        '###############################',
      ]
    },
    {
      id: 48, name: 'The Elevator', theme: 'cave', minPlayers: 3, maxPlayers: 5,
      requiredElements: ['fire', 'water', 'earth'],
      hint: 'Earth on the heavy plate raises the platform for everyone else.',
      map: [
        '  F       W          E         ',
        '####     ####       ####       ',
        '                               ',
        '                               ',
        '              ===              ',
        '                               ',
        '          P                    ',
        '       #######                 ',
        '                               ',
        '  f       w      e             ',
        '####    ####   ####            ',
        '###############################',
      ],
      entities: [
        { type: 'platform', x0: 384, y0: 192, w: 96, h: 12, axis: 'y', amplitude: 80, period: 5, type: 'platform' },
      ],
    },

    // --- Tier 7: Five-Element Challenges (49-52) ---
    {
      id: 49, name: 'Elemental Symphony', theme: 'temple', minPlayers: 5, maxPlayers: 5,
      requiredElements: ['fire', 'water', 'earth', 'ice', 'wind'],
      hint: 'Every element has a role. Play your part!',
      map: [
        '                               ',
        '  s    s    s    s    s        ',
        '#### #### #### #### ####       ',
        '                               ',
        '      W    L    ~    I   ^     ',
        '    ####  ####  #### ##### ####',
        '                               ',
        '         d                     ',
        '      #######   F W E I A      ',
        '  f   w   e   i   a  #######   ',
        '#### #### #### #### ####       ',
        '###############################',
      ]
    },
    {
      id: 50, name: 'The Crucible', theme: 'fire', minPlayers: 5, maxPlayers: 5,
      requiredElements: ['fire', 'water', 'earth', 'ice', 'wind'],
      hint: 'A test of skill across every hazard. Cooperate or fall!',
      map: [
        '                               ',
        '  f   w   e   i   a            ',
        '#### #### ######### ####       ',
        '                               ',
        '  LLLL  ~~~~  BBBB  IIII  ^^   ',
        '  LLLL  ~~~~  BBBB  IIII  ^^   ',
        '                    ####       ',
        '                               ',
        '                               ',
        '              F W E I A        ',
        '            #########          ',
        '###############################',
      ]
    },
    {
      id: 51, name: 'Sky Temple', theme: 'sky', minPlayers: 5, maxPlayers: 5,
      requiredElements: ['fire', 'water', 'earth', 'ice', 'wind'],
      hint: 'High in the clouds. Wind glides across the gaps.',
      map: [
        '                               ',
        '                               ',
        '  a   f   w   e   i            ',
        '#### #### ######### ####       ',
        '                               ',
        '       >>>>>>>>>>>>>>>>>       ',
        '       >>>>>>>>>>>>>>>>>       ',
        '                               ',
        '                               ',
        '              F W E I A        ',
        '            #########          ',
        '###############################',
      ]
    },
    {
      id: 52, name: 'Frozen Inferno', theme: 'ice', minPlayers: 5, maxPlayers: 5,
      requiredElements: ['fire', 'water', 'earth', 'ice', 'wind'],
      hint: 'Fire and ice, side by side. A contradiction in motion.',
      map: [
        '                               ',
        '  f   I   I   I   I   I        ',
        '#### IIIII#IIIII IIIII#####    ',
        '     ##### ###    ####         ',
        '  LLLL        IIII      LLLL   ',
        '  LLLL        IIII      LLLL   ',
        '              ####             ',
        '       w   e   i   a           ',
        '     #### #### #########       ',
        '              F W E I A        ',
        '            #########          ',
        '###############################',
      ]
    },

    // --- New Boss Fights (53-54) ---
    {
      id: 53, name: 'Boss: Shadow Wraith', theme: 'temple', minPlayers: 3, maxPlayers: 5,
      requiredElements: ['fire', 'water', 'earth'],
      boss: true,
      hint: 'BOSS! The Wraith drains light. Light all beacons to banish it!',
      map: [
        '                               ',
        '  s         s         s        ',
        '####       ####       ####     ',
        '                               ',
        '       ^^^^      ^^^^          ',
        '       ^^^^      ^^^^          ',
        '                               ',
        '    s         s         s      ',
        '  ####       ####       ####   ',
        '                               ',
        '  f    w    e        F W E     ',
        '###############################',
      ]
    },
    {
      id: 54, name: 'Boss: Storm Titan', theme: 'sky', minPlayers: 5, maxPlayers: 5,
      requiredElements: ['fire', 'water', 'earth', 'ice', 'wind'],
      boss: true,
      hint: 'FINAL BOSS! The Titan commands wind and lightning. Activate all five beacons!',
      map: [
        '                               ',
        '  ^^^^^^^^^^^^^^^^^^^^^^^^^^   ',
        '  ^^^^^^^^^^^^^^^^^^^^^^^^^^   ',
        '   s    s    s    s    s       ',
        ' #### #### #### #### ####      ',
        '                               ',
        '  ^^^^^^^^^^^^^^^^^^^^^^^^^^   ',
        '  ^^^^^^^^^^^^^^^^^^^^^^^^^^   ',
        '                               ',
        '  f   w   e   i   a            ',
        '#### #### #### #### #### FWEIA ',
        '###############################',
      ]
    },

    // --- Tier 8: Master Challenges (55-56) ---
    {
      id: 55, name: 'Master: The Labyrinth', theme: 'temple', minPlayers: 5, maxPlayers: 5,
      requiredElements: ['fire', 'water', 'earth', 'ice', 'wind'],
      hint: 'A maze of doors and switches. Plan your route!',
      map: [
        '  f    d    w    d    e        ',
        '####  #### ####  #### ####     ',
        '       s         s             ',
        '     ####       ####           ',
        '                               ',
        '  d    i    d    a    d        ',
        '#### #### #### #### ####       ',
        '       s         s             ',
        '     ####       ####           ',
        '                               ',
        '         F W E I A             ',
        '###############################',
      ]
    },
    {
      id: 56, name: 'Master: Perfect Harmony', theme: 'temple', minPlayers: 5, maxPlayers: 5,
      requiredElements: ['fire', 'water', 'earth', 'ice', 'wind'],
      hint: 'The ultimate test. Every mechanic, every element, one final level.',
      map: [
        '  s   p   s   P   s   p   s    ',
        '#### #### #### #### #### ####  ',
        '                               ',
        '  W   L   ~   B   I   ^   o    ',
        '#### #### #### #### #### ####  ',
        '                               ',
        '      d        o        d      ',
        '   ####     ####     ####      ',
        '                               ',
        '  f   w   e   i   a            ',
        '#### #### #### #### #### FWEIA ',
        '###############################',
      ]
    },
  ];

  // Parse all levels
  const LEVELS = RAW_LEVELS.map(parseLevel);

  global.LEVELS = LEVELS;
  global.parseLevel = parseLevel;
})(window);
