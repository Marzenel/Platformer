const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// --- Settings you can tweak ---
const GRAVITY = 0.4;
const SPEED = 5;
const JUMP = -13;
const TILE_SIZE = 60; // size of one tile on screen, in pixels (32 x 16 tiles = 1920 x 960)
let SCALE = 3;        // set automatically for each level

// --- Files (edit this list to match the levels you have) ---
const ASSET_FOLDER = "assets/"; // all tileset pictures go in this folder
const LEVEL_FILES = [
  "levels/level1.json",
];

// --- Loaded data ---
const levelData = [];
const images = {};   // tileset pictures, found by file name
let tilesets = [];   // tilesets of the current level (highest firstgid first)

// --- Game state ---
let currentLevel = 0;
let T = TILE_SIZE; // tile size on screen
let tileLayers, platforms, coins, spikes, goal;
let startPos = { x: 0, y: 0 };
let playerGid = 0;
let facing = 1;
let score = 0;
let gameWon = false;
let gameState = "loading"; // "loading", "start", "playing", "error"
let errorMessage = "";

const player = { x: 0, y: 0, w: 40, h: 40, vx: 0, vy: 0, onGround: false };

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

async function loadAssets() {
  for (const file of LEVEL_FILES) {
    const res = await fetch(file);
    if (!res.ok) throw new Error("Could not load " + file);
    levelData.push(await res.json());
  }

  for (let i = 0; i < levelData.length; i++) {
    const map = levelData[i];

    // Common mistakes in the Tiled file
    if (map.infinite) {
      throw new Error(LEVEL_FILES[i] + ": map size must be Fixed, not Infinite.");
    }
    for (const layer of map.layers) {
      if (layer.type === "tilelayer" && typeof layer.data === "string") {
        throw new Error(LEVEL_FILES[i] + ": set Tile Layer Format to CSV in Tiled, then export again.");
      }
    }

    // Load every tileset picture the level uses
    for (const ts of map.tilesets) {
      if (!ts.image) {
        throw new Error(LEVEL_FILES[i] + ": a tileset is not embedded. Tick 'Embed in map' when adding tilesets.");
      }
      const name = imageName(ts);
      if (!images[name]) {
        images[name] = await loadImage(ASSET_FOLDER + name);
      }
    }
  }
}

// --- Find which tileset a tile number (gid) belongs to ---
function findTileset(gid) {
  for (const ts of tilesets) {
    if (gid >= ts.firstgid) return ts;
  }
  return null;
}

// --- Draw one tile from its tileset picture ---
function drawTile(rawGid, dx, dy, dw, dh) {
  const gid = rawGid & 0x0fffffff; // ignores flip flags
  const ts = findTileset(gid);
  if (!ts) return;

  const id = gid - ts.firstgid;
  const col = id % ts.columns;
  const row = Math.floor(id / ts.columns);
  const margin = ts.margin || 0;
  const spacing = ts.spacing || 0;
  const sx = margin + col * (ts.tilewidth + spacing);
  const sy = margin + row * (ts.tileheight + spacing);

  ctx.drawImage(images[ts.file], sx, sy, ts.tilewidth, ts.tileheight, dx, dy, dw, dh);
}

// --- Draw a tile in a map square (bigger tiles stick out up and to the right, like in Tiled) ---
function drawTileInCell(gid, col, row) {
  const ts = findTileset(gid & 0x0fffffff);
  if (!ts) return;
  const dw = ts.tilewidth * SCALE;
  const dh = ts.tileheight * SCALE;
  drawTile(gid, col * T, (row + 1) * T - dh, dw, dh);
}

// --- Turn a Tiled object into something the game can use ---
function makeEntity(o, shrink) {
  const dw = o.width * SCALE;
  const dh = o.height * SCALE;
  const dx = o.x * SCALE;
  const dy = (o.gid ? o.y - o.height : o.y) * SCALE; // tile objects are positioned from their bottom-left
  return {
    gid: o.gid,
    dx, dy, dw, dh,                 // where to draw it
    x: dx + dw * shrink,            // hitbox (slightly smaller than the picture)
    y: dy + dh * shrink,
    w: dw * (1 - 2 * shrink),
    h: dh * (1 - 2 * shrink),
    collected: false,
  };
}

// --- Build a level from its Tiled file ---
function loadLevel(n) {
  const map = levelData[n];
  SCALE = TILE_SIZE / map.tilewidth;
  T = TILE_SIZE;
  canvas.width = map.width * T;
  canvas.height = map.height * T;

  tilesets = map.tilesets.slice().sort((a, b) => b.firstgid - a.firstgid);
  tilesets.forEach((ts) => (ts.file = imageName(ts)));

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
          const s = makeEntity(o, 0.2);
          s.y = s.dy + s.dh * 0.45; // hitbox sits in the lower part of the spike
          s.h = s.dh * 0.55;
          spikes.push(s);
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
}

function restartGame() {
  if (gameState === "loading" || gameState === "error") return;
  score = 0;
  currentLevel = 0;
  gameWon = false;
  gameState = "playing";
  loadLevel(0);
}

// --- Keyboard ---
const keys = {};
document.addEventListener("keydown", (e) => {
  keys[e.key] = true;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) {
    e.preventDefault();
  }
  if (e.key === "Enter" && gameState === "start") {
    gameState = "playing";
  }
  if (e.key === "r" || e.key === "R") restartGame();
});
document.addEventListener("keyup", (e) => (keys[e.key] = false));

// --- Do two rectangles overlap? ---
function isColliding(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function update() {
  if (gameState !== "playing" || gameWon) return;

  // Left and right
  player.vx = 0;
  if (keys["ArrowLeft"]) {
    player.vx = -SPEED;
    facing = -1;
  }
  if (keys["ArrowRight"]) {
    player.vx = SPEED;
    facing = 1;
  }

  // Jump
  if ((keys["ArrowUp"] || keys[" "]) && player.onGround) {
    player.vy = JUMP;
    player.onGround = false;
  }

  player.vy += GRAVITY;

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
    currentLevel++;
    if (currentLevel >= levelData.length) {
      gameWon = true;
    } else {
      loadLevel(currentLevel);
    }
  }
}

// Draw a coin / spike / goal: its tile picture if it has one, otherwise a colored box
function drawEntity(e, fallbackColor) {
  if (e.gid) {
    drawTile(e.gid, e.dx, e.dy, e.dw, e.dh);
  } else {
    ctx.fillStyle = fallbackColor;
    ctx.fillRect(e.dx, e.dy, e.dw, e.dh);
  }
}

function drawPlayer() {
  const ts = playerGid ? findTileset(playerGid & 0x0fffffff) : null;

  if (!ts) {
    ctx.fillStyle = "red";
    ctx.fillRect(player.x, player.y, player.w, player.h);
    return;
  }

  // The picture keeps its natural size, centered on the hitbox with feet at the bottom
  const sw = ts.tilewidth * SCALE;
  const sh = ts.tileheight * SCALE;
  const cx = player.x + player.w / 2;
  const sx = cx - sw / 2;
  const sy = player.y + player.h - sh;

  ctx.save();
  if (facing === -1) {
    ctx.translate(cx, 0);
    ctx.scale(-1, 1);
    ctx.translate(-cx, 0);
  }
  drawTile(playerGid, sx, sy, sw, sh);
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

  // Start screen
  if (gameState === "start") {
    ctx.fillStyle = "#1b1b2f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "white";
    ctx.textAlign = "center";

    ctx.font = "90px Arial";
    ctx.fillText("MY PLATFORMER", canvas.width / 2, canvas.height / 2 - 100);

    ctx.font = "32px Arial";
    ctx.fillText("Collect coins, avoid spikes, reach the goal!", canvas.width / 2, canvas.height / 2 - 30);
    ctx.fillText("Arrow keys: move    Up / Space: jump    R: restart", canvas.width / 2, canvas.height / 2 + 20);

    ctx.fillStyle = "gold";
    ctx.font = "44px Arial";
    ctx.fillText("Press ENTER to start", canvas.width / 2, canvas.height / 2 + 110);

    ctx.textAlign = "left";
    return;
  }

  // Tile layers, in the same order as in Tiled (background first)
  for (const layer of tileLayers) {
    if (layer.visible === false) continue;
    for (let i = 0; i < layer.data.length; i++) {
      if (layer.data[i] === 0) continue;
      drawTileInCell(layer.data[i], i % layer.width, Math.floor(i / layer.width));
    }
  }

  // Coins, spikes, goal
  for (const c of coins) {
    if (!c.collected) drawEntity(c, "gold");
  }
  for (const s of spikes) drawEntity(s, "#555");
  if (goal) drawEntity(goal, "limegreen");

  drawPlayer();

  // Score and level
  ctx.fillStyle = "black";
  ctx.font = "32px Arial";
  ctx.fillText("Coins: " + score + "   Level: " + (currentLevel + 1), 20, 45);

  // Win screen
  if (gameWon) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "white";
    ctx.font = "80px Arial";
    ctx.textAlign = "center";
    ctx.fillText("You win!", canvas.width / 2, canvas.height / 2 - 10);
    ctx.font = "32px Arial";
    ctx.fillText("Coins collected: " + score + "  |  Press R to play again", canvas.width / 2, canvas.height / 2 + 50);
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
    loadLevel(0);
    gameState = "start";
  } catch (err) {
    console.error(err);
    errorMessage = err.message;
    gameState = "error";
  }
}

init();
gameLoop();