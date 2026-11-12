const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// --- Settings you can tweak ---
const GRAVITY = 0.4;
const SPEED = 5;
const JUMP = -13;
const TILE_SIZE = 60; // size of one tile on screen, in pixels (32 x 16 tiles = 1920 x 960)
let SCALE = 3;        // set automatically for each map

// --- Wall slide and wall jump settings ---
const WALL_SLIDE_SPEED = 2;  // fastest fall speed while sliding on a wall (0 = stick completely)
const WALL_JUMP_X = 7;       // sideways push away from the wall
const WALL_JUMP_Y = -12;     // upward push
const WALL_JUMP_LOCK = 10;   // frames you can't steer after a wall jump, so you actually leave the wall

// --- Level select settings ---
const UNLOCK_ALL = false;               // true = every level can be picked, false = finish a level to unlock the next
const SAVE_KEY = "platformer-unlocked"; // name used to save progress in the browser

// --- Title screen settings ---
const TITLE_FILE = "levels/title.json"; // title screen made in Tiled (if missing, the built-in one is used)
const TITLE_SHOW_PROMPT = true;         // blinking "Press ENTER" text; set false if your Tiled title already says it

// --- Level select screen settings ---
const SELECT_FILE = "levels/select.json"; // level select screen made in Tiled (if missing, the built-in one is used)
const SELECT_SHOW_NUMBERS = true;         // draw the level number on each card; set false if your art already has numbers
const SELECT_SHOW_HINT = true;            // draw the controls hint at the bottom

// --- Files (edit this list to match the levels you have) ---
const ASSET_FOLDER = "assets/"; // all tileset pictures go in this folder
const LEVEL_FILES = [
  "levels/level1.json",
  "levels/level2.json",
  "levels/level3.json",
  "levels/level4.json",
  "levels/level5.json",
];

// --- Loaded data ---
const levelData = [];
let titleData = null;  // the title screen map, if there is one
let selectData = null; // the level select map, if there is one
const images = {};     // tileset pictures, found by file name
let tilesets = [];     // tilesets of the current map (highest firstgid first)

// --- Game state ---
let currentLevel = 0;
let T = TILE_SIZE; // tile size on screen
let tileLayers, platforms, coins, spikes, goal;
let startPos = { x: 0, y: 0 };
let playerGid = 0;
let facing = 1;
let score = 0;
let levelStartScore = 0; // score when the current level began (used by restart)
let gameWon = false;
let gameState = "loading"; // "loading", "start", "select", "playing", "error"
let errorMessage = "";

// --- Level select state ---
let menuIndex = 0;     // which level card is highlighted
let unlockedCount = 1; // how many levels are unlocked (only used when UNLOCK_ALL is false)
let selectCards = [];  // clickable cards from the Tiled level select map (index 0 = level 1)
let warnedCards = false;

// --- Wall state ---
let wallDir = 0;        // -1 = wall on the left, 1 = wall on the right, 0 = no wall touching
let wallSliding = false;
let wallJumpTimer = 0;
let wallJumpVx = 0;
let jumpWasDown = false; // used to tell a fresh jump press from a held key

// --- Player animation ---
// Each number is an offset from the character tile you placed in Tiled:
// 0 = that same tile, 1 = the next tile to the right, 2 = two tiles right, ...
const IDLE_FRAMES = [0];
const WALK_FRAMES = [0, 1];
const JUMP_FRAMES = [1];
const WALL_FRAMES = [1]; // picture used while sliding on a wall
const FRAME_TIME = 8; // game frames per picture (bigger = slower)
const SPRITE_FACES = -1; // -1 = the picture faces left, 1 = the picture faces right
let animTimer = 0;

const player = { x: 0, y: 0, w: 40, h: 40, vx: 0, vy: 0, onGround: false };

// --- Saved progress ---
function loadProgress() {
  try {
    unlockedCount = Number(localStorage.getItem(SAVE_KEY)) || 1;
  } catch (e) {
    unlockedCount = 1;
  }
}

function saveProgress() {
  try {
    localStorage.setItem(SAVE_KEY, String(unlockedCount));
  } catch (e) {
    // saving is optional, so ignore errors
  }
}

function isUnlocked(i) {
  return UNLOCK_ALL || i < unlockedCount;
}

// --- Loading ---
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load " + src + " (is it in the assets folder?)"));
    img.src = src;
  });
}

// The picture's file name, taken from the path stored in the Tiled file
function imageName(ts) {
  return ts.image.split(/[\\/]/).pop();
}

// Check a Tiled map for common mistakes and load the tileset pictures it uses
async function loadMapImages(map, file) {
  if (map.infinite) {
    throw new Error(file + ": map size must be Fixed, not Infinite.");
  }
  for (const layer of map.layers) {
    if (layer.type === "tilelayer" && typeof layer.data === "string") {
      throw new Error(file + ": set Tile Layer Format to CSV in Tiled, then export again.");
    }
  }
  for (const ts of map.tilesets) {
    if (!ts.image) {
      throw new Error(file + ": a tileset is not embedded. Tick 'Embed in map' when adding tilesets.");
    }
    const name = imageName(ts);
    if (!images[name]) {
      images[name] = await loadImage(ASSET_FOLDER + name);
    }
  }
}

// Load a map that is allowed to be missing (the title screen and level select screen)
async function loadOptionalMap(file, label) {
  if (!file) return null;
  const res = await fetch(file);
  if (!res.ok) {
    console.warn("No " + label + " file found at " + file + ", using the built-in " + label + ".");
    return null;
  }
  const map = await res.json();
  await loadMapImages(map, file);
  return map;
}

async function loadAssets() {
  for (const file of LEVEL_FILES) {
    const res = await fetch(file);
    if (!res.ok) throw new Error("Could not load " + file);
    levelData.push(await res.json());
  }
  for (let i = 0; i < levelData.length; i++) {
    await loadMapImages(levelData[i], LEVEL_FILES[i]);
  }

  titleData = await loadOptionalMap(TITLE_FILE, "title screen");
  selectData = await loadOptionalMap(SELECT_FILE, "level select screen");
}

// --- Get ready to draw a map: set the scale, canvas size and tilesets ---
function setupMap(map) {
  SCALE = TILE_SIZE / map.tilewidth;
  T = TILE_SIZE;
  canvas.width = map.width * T;
  canvas.height = map.height * T;

  tilesets = map.tilesets.slice().sort((a, b) => b.firstgid - a.firstgid);
  tilesets.forEach((ts) => (ts.file = imageName(ts)));
}

// Tiled writes colors as #AARRGGBB, but the canvas wants #RRGGBB
function fixColor(c, fallback) {
  if (!c) return fallback;
  if (c.length === 9) return "#" + c.slice(3);
  return c;
}

// --- Find which tileset a tile number (gid) belongs to ---
function findTileset(gid) {
  for (const ts of tilesets) {
    if (gid >= ts.firstgid) return ts;
  }
  return null;
}

// --- Draw one tile from its tileset picture (handles Tiled's flips and rotations) ---
function drawTile(rawGid, dx, dy, dw, dh) {
  const gid = rawGid & 0x0fffffff;
  const flipH = (rawGid & 0x80000000) !== 0;
  const flipV = (rawGid & 0x40000000) !== 0;
  const flipD = (rawGid & 0x20000000) !== 0; // diagonal flip (used when rotating painted tiles)

  const ts = findTileset(gid);
  if (!ts) return;

  const id = gid - ts.firstgid;
  const col = id % ts.columns;
  const row = Math.floor(id / ts.columns);
  const margin = ts.margin || 0;
  const spacing = ts.spacing || 0;
  const sx = margin + col * (ts.tilewidth + spacing);
  const sy = margin + row * (ts.tileheight + spacing);
  const img = images[ts.file];

  if (!flipH && !flipV && !flipD) {
    ctx.drawImage(img, sx, sy, ts.tilewidth, ts.tileheight, dx, dy, dw, dh);
    return;
  }

  // Flipped or rotated: draw around the tile's center
  ctx.save();
  ctx.translate(dx + dw / 2, dy + dh / 2);
  if (flipV) ctx.scale(1, -1);
  if (flipH) ctx.scale(-1, 1);
  if (flipD) ctx.transform(0, 1, 1, 0, 0, 0);
  ctx.drawImage(img, sx, sy, ts.tilewidth, ts.tileheight, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

// --- Draw a tile in a map square (bigger tiles stick out up and to the right, like in Tiled) ---
function drawTileInCell(gid, col, row) {
  const ts = findTileset(gid & 0x0fffffff);
  if (!ts) return;
  const dw = ts.tilewidth * SCALE;
  const dh = ts.tileheight * SCALE;
  drawTile(gid, col * T, (row + 1) * T - dh, dw, dh);
}

// --- Draw a whole tile layer ---
function drawTileLayer(layer) {
  if (layer.visible === false) return;
  for (let i = 0; i < layer.data.length; i++) {
    if (layer.data[i] === 0) continue;
    drawTileInCell(layer.data[i], i % layer.width, Math.floor(i / layer.width));
  }
}

// --- Turn a Tiled object into something the game can use ---
// Tile objects are positioned and rotated around their bottom-left corner, like in Tiled.
function makeEntity(o, shrink, isSpike) {
  const dw = o.width * SCALE;
  const dh = o.height * SCALE;
  const ox = o.x * SCALE;
  const oy = o.y * SCALE;
  const rot = o.rotation || 0;
  const top = o.gid ? -dh : 0; // tile objects sit above their origin
  const flipV = o.gid ? (o.gid & 0x40000000) !== 0 : false;

  // Hitbox before rotating (measured from the object's origin)
  let lx = dw * shrink;
  let ly = top + dh * shrink;
  let lw = dw * (1 - 2 * shrink);
  let lh = dh * (1 - 2 * shrink);

  if (isSpike) {
    // Only the pointy half hurts: the lower 55% (or the upper part if flipped upside down)
    lx = dw * 0.2;
    lw = dw * 0.6;
    lh = dh * 0.55;
    ly = flipV ? top : top + dh * 0.45;
  }

  // Rotate the hitbox corners, then use the box that surrounds them
  const a = (rot * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const corners = [
    [lx, ly],
    [lx + lw, ly],
    [lx, ly + lh],
    [lx + lw, ly + lh],
  ];
  for (const [cx, cy] of corners) {
    const wx = ox + cx * cos - cy * sin;
    const wy = oy + cx * sin + cy * cos;
    minX = Math.min(minX, wx);
    minY = Math.min(minY, wy);
    maxX = Math.max(maxX, wx);
    maxY = Math.max(maxY, wy);
  }

  return {
    gid: o.gid,
    ox, oy, rot, dw, dh,            // where and how to draw it
    dx: ox, dy: oy + top,           // top-left corner when not rotated
    x: minX, y: minY,               // hitbox
    w: maxX - minX, h: maxY - minY,
    collected: false,
  };
}

// --- Build a level from its Tiled file ---
function loadLevel(n) {
  const map = levelData[n];
  setupMap(map);

  player.w = T * 0.8;
  player.h = T * 0.8;

  tileLayers = [];
  platforms = [];
  coins = [];
  spikes = [];
  goal = null;

  for (const layer of map.layers) {
    if (layer.type === "tilelayer") {
      tileLayers.push(layer);

      // Every tile on the layer named "ground" is solid
      if (layer.name === "ground") {
        for (let i = 0; i < layer.data.length; i++) {
          if (layer.data[i] !== 0) {
            platforms.push({
              x: (i % layer.width) * T,
              y: Math.floor(i / layer.width) * T,
              w: T,
              h: T,
            });
          }
        }
      }
    } else if (layer.type === "objectgroup") {
      for (const o of layer.objects) {
        const name = (o.name || "").toLowerCase();

        if (name === "player") {
          const e = makeEntity(o, 0);
          startPos = { x: e.dx + (e.dw - player.w) / 2, y: e.dy + e.dh - player.h };
          playerGid = o.gid || 0;
        } else if (name === "coin") {
          coins.push(makeEntity(o, 0.2));
        } else if (name === "spike") {
          spikes.push(makeEntity(o, 0, true));
        } else if (name === "goal") {
          goal = makeEntity(o, 0.1);
        }
      }
    }
  }
  resetPlayer();
}

function resetPlayer() {
  player.x = startPos.x;
  player.y = startPos.y;
  player.vx = 0;
  player.vy = 0;
  wallDir = 0;
  wallSliding = false;
  wallJumpTimer = 0;
}

// --- Starting, restarting and leaving levels ---
function startLevel(n) {
  currentLevel = n;
  score = 0;
  levelStartScore = 0;
  gameWon = false;
  gameState = "playing";
  canvas.style.cursor = "default";
  loadLevel(n);
}

function restartLevel() {
  score = levelStartScore;
  gameWon = false;
  loadLevel(currentLevel);
}

function showMenu() {
  gameState = "select";
  gameWon = false;
  menuIndex = Math.min(currentLevel, levelData.length - 1); // highlight the level you were on

  if (selectData) {
    setupMap(selectData);
    buildSelectCards();
  } else {
    // Built-in menu: use the first level's size
    canvas.width = levelData[0].width * TILE_SIZE;
    canvas.height = levelData[0].height * TILE_SIZE;
  }
}

// --- Level cards from the Tiled level select map: objects named level1, level2, ... ---
// Several objects can share one name. Together they form one card.
function isCardName(name) {
  return /^level\s*\d+$/i.test(name || "");
}

function buildSelectCards() {
  selectCards = [];
  for (const layer of selectData.layers) {
    if (layer.type !== "objectgroup") continue;
    for (const o of layer.objects) {
      const m = /^level\s*(\d+)$/i.exec(o.name || "");
      if (!m) continue;
      const i = Number(m[1]) - 1;
      if (i < 0 || i >= levelData.length) continue;

      const e = makeEntity(o, 0);
      const c = selectCards[i];

      if (!c) {
        // First object with this name: start the card
        selectCards[i] = { parts: [e], x: e.x, y: e.y, w: e.w, h: e.h };
      } else {
        // More objects with the same name: add them and grow the card's box to fit all of them
        c.parts.push(e);
        const x1 = Math.min(c.x, e.x);
        const y1 = Math.min(c.y, e.y);
        const x2 = Math.max(c.x + c.w, e.x + e.w);
        const y2 = Math.max(c.y + c.h, e.y + e.h);
        c.x = x1;
        c.y = y1;
        c.w = x2 - x1;
        c.h = y2 - y1;
      }
    }
  }

  if (!warnedCards) {
    warnedCards = true;
    for (let i = 0; i < levelData.length; i++) {
      if (!selectCards[i]) {
        console.warn("The level select map has no object named level" + (i + 1) + ", so that level can't be clicked.");
      }
    }
  }
}

// --- Level select layout: where each level card sits ---
function menuLayout() {
  if (selectData) return { buttons: selectCards };

  // Built-in menu: a centered grid of cards
  const n = levelData.length;
  const w = 260;
  const h = 170;
  const gap = 40;
  const cols = Math.min(n, 5);
  const rows = Math.ceil(n / cols);
  const totalW = cols * w + (cols - 1) * gap;
  const totalH = rows * h + (rows - 1) * gap;
  const startX = (canvas.width - totalW) / 2;
  const startY = (canvas.height - totalH) / 2 + 40;

  const buttons = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    buttons.push({ x: startX + col * (w + gap), y: startY + row * (h + gap), w, h });
  }
  return { buttons };
}

// --- Move the highlight to the nearest card in a direction ---
function moveSelection(dx, dy) {
  const { buttons } = menuLayout();
  const cur = buttons[menuIndex];

  // If the highlighted level has no card, jump to the first card that exists
  if (!cur) {
    const first = buttons.findIndex((b) => b);
    if (first >= 0) menuIndex = first;
    return;
  }

  const cx = cur.x + cur.w / 2;
  const cy = cur.y + cur.h / 2;
  let best = -1;
  let bestScore = Infinity;

  buttons.forEach((b, i) => {
    if (!b || i === menuIndex) return;
    const bx = b.x + b.w / 2 - cx;
    const by = b.y + b.h / 2 - cy;
    const along = bx * dx + by * dy;                  // distance in the direction we want to go
    if (along <= 0) return;                           // not in that direction
    const across = Math.abs(bx * dy) + Math.abs(by * dx); // how far off to the side
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });

  if (best >= 0) menuIndex = best;
}

// --- Keyboard ---
const keys = {};
document.addEventListener("keydown", (e) => {
  keys[e.key] = true;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) {
    e.preventDefault();
  }
  if (e.repeat) return; // ignore a key that is just being held down

  if (gameState === "start") {
    if (e.key === "Enter") showMenu();
  } else if (gameState === "select") {
    handleMenuKey(e.key);
  } else if (gameState === "playing") {
    if (gameWon) {
      if (e.key === "Enter" || e.key === "r" || e.key === "R") showMenu();
    } else if (e.key === "r" || e.key === "R") {
      restartLevel();
    } else if (e.key === "Escape") {
      showMenu();
    }
  }
});
document.addEventListener("keyup", (e) => (keys[e.key] = false));

function handleMenuKey(key) {
  const n = levelData.length;

  if (key === "ArrowRight") moveSelection(1, 0);
  else if (key === "ArrowLeft") moveSelection(-1, 0);
  else if (key === "ArrowDown") moveSelection(0, 1);
  else if (key === "ArrowUp") moveSelection(0, -1);
  else if (key >= "1" && key <= "9") {
    const i = Number(key) - 1;
    if (i < n) {
      menuIndex = i;
      if (isUnlocked(i)) startLevel(i);
    }
  } else if (key === "Enter" || key === " ") {
    if (isUnlocked(menuIndex)) startLevel(menuIndex);
  }
}

// --- Mouse ---
function mousePos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) * canvas.width) / rect.width,
    y: ((e.clientY - rect.top) * canvas.height) / rect.height,
  };
}

function cardAt(pos) {
  const { buttons } = menuLayout();
  for (let i = 0; i < buttons.length; i++) {
    const b = buttons[i];
    if (!b) continue;
    if (pos.x >= b.x && pos.x <= b.x + b.w && pos.y >= b.y && pos.y <= b.y + b.h) return i;
  }
  return -1;
}

canvas.addEventListener("mousemove", (e) => {
  if (gameState !== "select") return;
  const i = cardAt(mousePos(e));
  if (i >= 0) menuIndex = i;
  canvas.style.cursor = i >= 0 && isUnlocked(i) ? "pointer" : "default";
});

canvas.addEventListener("click", (e) => {
  if (gameState === "start") {
    showMenu(); // clicking the title screen also continues
    return;
  }
  if (gameState !== "select") return;
  const i = cardAt(mousePos(e));
  if (i >= 0 && isUnlocked(i)) startLevel(i);
});

// --- Do two rectangles overlap? ---
function isColliding(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

// --- Is there a wall touching the player's left or right side? ---
function checkWall() {
  const leftProbe = { x: player.x - 2, y: player.y + 6, w: 2, h: player.h - 12 };
  const rightProbe = { x: player.x + player.w, y: player.y + 6, w: 2, h: player.h - 12 };

  for (const p of platforms) {
    if (isColliding(leftProbe, p)) return -1;
    if (isColliding(rightProbe, p)) return 1;
  }
  return 0;
}

function update() {
  if (gameState !== "playing" || gameWon) return;

  // Which wall (if any) are we touching? Checked before moving.
  wallDir = checkWall();

  // Left and right (steering is locked for a moment after a wall jump)
  player.vx = 0;
  if (wallJumpTimer > 0) {
    wallJumpTimer--;
    player.vx = wallJumpVx;
  } else {
    if (keys["ArrowLeft"]) {
      player.vx = -SPEED;
      facing = -1;
    }
    if (keys["ArrowRight"]) {
      player.vx = SPEED;
      facing = 1;
    }
  }

  // Animation timer: runs while moving, resets when standing still
  if (player.vx !== 0) animTimer++;
  else animTimer = 0;

  // Jump: normal jump on the ground, wall jump in the air next to a wall
  const jumpDown = keys["ArrowUp"] || keys[" "];
  const jumpPressed = jumpDown && !jumpWasDown; // true only on the frame the key goes down
  jumpWasDown = jumpDown;

  if (jumpDown && player.onGround) {
    player.vy = JUMP;
    player.onGround = false;
  } else if (jumpPressed && !player.onGround && wallDir !== 0) {
    player.vy = WALL_JUMP_Y;
    wallJumpVx = -wallDir * WALL_JUMP_X; // push away from the wall
    wallJumpTimer = WALL_JUMP_LOCK;
    facing = -wallDir;
  }

  player.vy += GRAVITY;

  // Wall slide: in the air, touching a wall, pushing toward it, and falling
  const pushingIntoWall =
    (wallDir === -1 && keys["ArrowLeft"]) || (wallDir === 1 && keys["ArrowRight"]);
  wallSliding = !player.onGround && wallDir !== 0 && pushingIntoWall && player.vy > 0;
  if (wallSliding) {
    player.vy = Math.min(player.vy, WALL_SLIDE_SPEED);
  }

  // Horizontal movement + collisions
  player.x += player.vx;
  for (const p of platforms) {
    if (isColliding(player, p)) {
      if (player.vx > 0) player.x = p.x - player.w;
      else if (player.vx < 0) player.x = p.x + p.w;
    }
  }

  // Vertical movement + collisions
  player.y += player.vy;
  player.onGround = false;
  for (const p of platforms) {
    if (isColliding(player, p)) {
      if (player.vy > 0) {
        player.y = p.y - player.h;
        player.onGround = true;
      } else if (player.vy < 0) {
        player.y = p.y + p.h;
      }
      player.vy = 0;
    }
  }

  // Keep inside the screen sideways
  if (player.x < 0) player.x = 0;
  if (player.x + player.w > canvas.width) player.x = canvas.width - player.w;

  // Fell off the bottom?
  if (player.y > canvas.height) resetPlayer();

  // Touched a spike?
  for (const s of spikes) {
    if (isColliding(player, s)) resetPlayer();
  }

  // Collect coins
  for (const c of coins) {
    if (!c.collected && isColliding(player, c)) {
      c.collected = true;
      score += 1;
    }
  }

  // Reached the goal?
  if (goal && isColliding(player, goal)) {
    // Unlock the next level
    if (currentLevel + 2 > unlockedCount) {
      unlockedCount = Math.min(currentLevel + 2, levelData.length);
      saveProgress();
    }

    currentLevel++;
    if (currentLevel >= levelData.length) {
      gameWon = true;
    } else {
      levelStartScore = score;
      loadLevel(currentLevel);
    }
  }
}

// Draw a coin / spike / goal: its tile picture if it has one, otherwise a colored box.
// Rotation happens around the object's origin, just like in Tiled.
function drawEntity(e, fallbackColor) {
  ctx.save();
  ctx.translate(e.ox, e.oy);
  ctx.rotate((e.rot * Math.PI) / 180);

  if (e.gid) {
    drawTile(e.gid, 0, -e.dh, e.dw, e.dh); // tile objects sit above their bottom-left origin
  } else {
    ctx.fillStyle = fallbackColor;
    ctx.fillRect(0, 0, e.dw, e.dh);
  }

  ctx.restore();
}

// Draw a text object made in Tiled
function drawTextObject(o) {
  const t = o.text;
  const size = (t.pixelsize || 16) * SCALE;
  const bw = o.width * SCALE;
  const bh = o.height * SCALE;
  const family = (t.fontfamily ? '"' + t.fontfamily + '", ' : "") + "Arial, sans-serif";

  ctx.save();
  ctx.translate(o.x * SCALE, o.y * SCALE);
  ctx.rotate(((o.rotation || 0) * Math.PI) / 180);

  ctx.font = (t.bold ? "bold " : "") + (t.italic ? "italic " : "") + size + "px " + family;
  ctx.fillStyle = fixColor(t.color, "#000000");
  ctx.textBaseline = "top";

  // Split into lines (with word wrapping if it is turned on in Tiled)
  const lines = [];
  for (const para of String(t.text).split("\n")) {
    if (!t.wrap) {
      lines.push(para);
      continue;
    }
    let line = "";
    for (const word of para.split(" ")) {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > bw && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    lines.push(line);
  }

  // Alignment inside the text box
  const lineHeight = size * 1.2;
  const totalH = lines.length * lineHeight;
  const halign = t.halign || "left";
  const valign = t.valign || "top";

  let x = 0;
  if (halign === "center") x = bw / 2;
  else if (halign === "right") x = bw;
  ctx.textAlign = halign;

  let y = 0;
  if (valign === "center") y = (bh - totalH) / 2;
  else if (valign === "bottom") y = bh - totalH;

  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));

  ctx.restore();
}

// Draw a screen designed in Tiled (title screen or level select screen).
// Objects named level1, level2, ... are the level cards, which are drawn separately.
function drawDesignedMap(map) {
  if (map.backgroundcolor) {
    ctx.fillStyle = fixColor(map.backgroundcolor, "#000000");
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  for (const layer of map.layers) {
    if (layer.visible === false) continue;

    if (layer.type === "tilelayer") {
      drawTileLayer(layer);
    } else if (layer.type === "objectgroup") {
      for (const o of layer.objects) {
        if (o.visible === false) continue;
        if (isCardName(o.name)) continue;
        if (o.text) drawTextObject(o);
        else if (o.gid) drawEntity(makeEntity(o, 0), "#ffffff");
      }
    }
  }
}

function drawPlayer() {
  const ts = playerGid ? findTileset(playerGid & 0x0fffffff) : null;

  if (!ts) {
    ctx.fillStyle = "red";
    ctx.fillRect(player.x, player.y, player.w, player.h);
    return;
  }

  // Pick the pictures that match what the player is doing
  let frames = IDLE_FRAMES;
  if (wallSliding) frames = WALL_FRAMES;
  else if (!player.onGround) frames = JUMP_FRAMES;
  else if (player.vx !== 0) frames = WALK_FRAMES;

  const frame = frames[Math.floor(animTimer / FRAME_TIME) % frames.length];
  const gid = (playerGid & 0x0fffffff) + frame;

  // The picture keeps its natural size, centered on the hitbox with feet at the bottom
  const sw = ts.tilewidth * SCALE;
  const sh = ts.tileheight * SCALE;
  const cx = player.x + player.w / 2;
  const sx = cx - sw / 2;
  const sy = player.y + player.h - sh;

  ctx.save();
  if (facing !== SPRITE_FACES) {
    ctx.translate(cx, 0);
    ctx.scale(-1, 1);
    ctx.translate(-cx, 0);
  }
  drawTile(gid, sx, sy, sw, sh);
  ctx.restore();
}

function drawMessage(title, detail) {
  ctx.fillStyle = "#1b1b2f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "white";
  ctx.textAlign = "center";
  ctx.font = "60px Arial";
  ctx.fillText(title, canvas.width / 2, canvas.height / 2 - 20);
  ctx.font = "28px Arial";
  ctx.fillText(detail, canvas.width / 2, canvas.height / 2 + 40, canvas.width - 80);
  ctx.textAlign = "left";
}

// The built-in level select screen (used when there is no Tiled select file)
function drawDefaultMenu() {
  ctx.fillStyle = "#1b1b2f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "white";
  ctx.textAlign = "center";
  ctx.font = "80px Arial";
  ctx.fillText("SELECT LEVEL", canvas.width / 2, 170);

  const { buttons } = menuLayout();
  buttons.forEach((b, i) => {
    const selected = i === menuIndex;
    const open = isUnlocked(i);

    // Card
    ctx.fillStyle = open ? (selected ? "#3a3a6e" : "#2a2a4a") : "#22222e";
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.lineWidth = selected ? 8 : 3;
    ctx.strokeStyle = selected ? "gold" : "#555";
    ctx.strokeRect(b.x, b.y, b.w, b.h);

    // Number and label
    ctx.fillStyle = open ? "white" : "#777";
    ctx.font = "70px Arial";
    ctx.fillText(String(i + 1), b.x + b.w / 2, b.y + b.h / 2 + 10);
    ctx.font = "26px Arial";
    ctx.fillText(open ? "Level " + (i + 1) : "Locked", b.x + b.w / 2, b.y + b.h - 25);
  });

  ctx.fillStyle = "#aaa";
  ctx.font = "28px Arial";
  ctx.fillText(
    "Arrow keys or mouse to choose    ENTER or click to play    ESC during a level: back here",
    canvas.width / 2,
    canvas.height - 70
  );
  ctx.textAlign = "left";
}

// Draw the level cards from the Tiled level select map
function drawSelectCards() {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";

  for (let i = 0; i < selectCards.length; i++) {
    const c = selectCards[i];
    if (!c) continue;
    const open = isUnlocked(i);
    const selected = i === menuIndex;

    // The card's pictures (tile objects only; rectangles are invisible click areas)
    for (const part of c.parts) {
      if (part.gid) drawEntity(part, "#ffffff");
    }

    // Locked levels are darkened
    if (!open) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
      ctx.fillRect(c.x, c.y, c.w, c.h);
    }

    // Level number
    if (SELECT_SHOW_NUMBERS) {
      ctx.font = "bold " + Math.round(c.h * 0.4) + "px Arial";
      ctx.lineWidth = 8;
      ctx.strokeStyle = "black";
      ctx.fillStyle = open ? "white" : "#999999";
      ctx.strokeText(String(i + 1), c.x + c.w / 2, c.y + c.h / 2);
      ctx.fillText(String(i + 1), c.x + c.w / 2, c.y + c.h / 2);
    }

    // "Locked" label
    if (!open) {
      ctx.font = "bold " + Math.round(c.h * 0.16) + "px Arial";
      ctx.lineWidth = 6;
      ctx.strokeStyle = "black";
      ctx.fillStyle = "white";
      ctx.strokeText("Locked", c.x + c.w / 2, c.y + c.h * 0.85);
      ctx.fillText("Locked", c.x + c.w / 2, c.y + c.h * 0.85);
    }

    // Highlight around the selected card
    if (selected) {
      ctx.lineWidth = 8;
      ctx.strokeStyle = open ? "gold" : "#888888";
      ctx.strokeRect(c.x - 4, c.y - 4, c.w + 8, c.h + 8);
    }
  }

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
}

function drawMenu() {
  if (!selectData) {
    drawDefaultMenu();
    return;
  }

  drawDesignedMap(selectData);
  drawSelectCards();

  if (SELECT_SHOW_HINT) {
    ctx.textAlign = "center";
    ctx.font = "28px Arial";
    ctx.lineJoin = "round";
    ctx.lineWidth = 6;
    ctx.strokeStyle = "black";
    ctx.fillStyle = "white";
    const hint = "Arrow keys or mouse to choose    ENTER or click to play    ESC during a level: back here";
    ctx.strokeText(hint, canvas.width / 2, canvas.height - 40);
    ctx.fillText(hint, canvas.width / 2, canvas.height - 40);
    ctx.textAlign = "left";
  }
}

// The built-in title screen (used when there is no Tiled title file)
function drawDefaultTitle() {
  ctx.fillStyle = "#1b1b2f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "white";
  ctx.textAlign = "center";

  ctx.font = "90px Arial";
  ctx.fillText("MY PLATFORMER", canvas.width / 2, canvas.height / 2 - 100);

  ctx.font = "32px Arial";
  ctx.fillText("Collect coins, avoid spikes, reach the goal!", canvas.width / 2, canvas.height / 2 - 30);
  ctx.fillText("Arrow keys: move    Up / Space: jump    Hold toward a wall to slide, jump to wall jump", canvas.width / 2, canvas.height / 2 + 20);
  ctx.fillText("R: restart level    ESC: level select", canvas.width / 2, canvas.height / 2 + 60);

  ctx.fillStyle = "gold";
  ctx.font = "44px Arial";
  ctx.fillText("Press ENTER to start", canvas.width / 2, canvas.height / 2 + 140);

  ctx.textAlign = "left";
}

function draw() {
  ctx.imageSmoothingEnabled = false; // keeps pixel art sharp
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (gameState === "loading") {
    drawMessage("Loading...", "");
    return;
  }

  if (gameState === "error") {
    drawMessage("Something went wrong", errorMessage);
    return;
  }

  // Title screen
  if (gameState === "start") {
    if (titleData) {
      drawDesignedMap(titleData);

      // Blinking prompt
      if (TITLE_SHOW_PROMPT && Math.floor(Date.now() / 600) % 2 === 0) {
        ctx.textAlign = "center";
        ctx.font = "44px Arial";
        ctx.lineJoin = "round";
        ctx.lineWidth = 8;
        ctx.strokeStyle = "black";
        ctx.strokeText("Press ENTER to start", canvas.width / 2, canvas.height - 70);
        ctx.fillStyle = "white";
        ctx.fillText("Press ENTER to start", canvas.width / 2, canvas.height - 70);
        ctx.textAlign = "left";
      }
    } else {
      drawDefaultTitle();
    }
    return;
  }

  // Level select screen
  if (gameState === "select") {
    drawMenu();
    return;
  }

  // Tile layers, in the same order as in Tiled (background first)
  for (const layer of tileLayers) drawTileLayer(layer);

  // Coins, spikes, goal
  for (const c of coins) {
    if (!c.collected) drawEntity(c, "gold");
  }
  for (const s of spikes) drawEntity(s, "#555");
  if (goal) drawEntity(goal, "limegreen");

  drawPlayer();

  // Score and level
  const shownLevel = Math.min(currentLevel + 1, levelData.length);
  ctx.fillStyle = "black";
  ctx.font = "32px Arial";
  ctx.fillText("Coins: " + score + "   Level: " + shownLevel, 20, 45);

  // Win screen
  if (gameWon) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "white";
    ctx.font = "80px Arial";
    ctx.textAlign = "center";
    ctx.fillText("You win!", canvas.width / 2, canvas.height / 2 - 10);
    ctx.font = "32px Arial";
    ctx.fillText("Coins collected: " + score + "  |  Press ENTER for level select", canvas.width / 2, canvas.height / 2 + 50);
    ctx.textAlign = "left";
  }
}

function gameLoop() {
  update();
  draw();
  requestAnimationFrame(gameLoop);
}

// --- Start everything ---
async function init() {
  try {
    await loadAssets();
    loadProgress();
    loadLevel(0);
    if (titleData) setupMap(titleData); // get ready to show the Tiled title screen
    gameState = "start";
  } catch (err) {
    console.error(err);
    errorMessage = err.message;
    gameState = "error";
  }
}

init();
gameLoop();