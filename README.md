# 2D Platformer Game

A 2D platformer that runs in the web browser. Run and jump across platforms, collect coins, avoid spikes, and reach the goal at the end of each level. The game is written with HTML, CSS and JavaScript, drawn on an HTML5 canvas, and all of its levels, its title screen and its level select screen are designed in the [Tiled Map Editor](https://www.mapeditor.org/).

This project was made as a Web Development finals project.

## Play the game

[Play Nezram Platformer here:](https://marzenel.github.io/Nezram_Platformer/)


(Replace the link above with the address of your GitHub Pages site.)

## Features

- Movement with gravity, jumping and collision detection against solid tiles
- Wall sliding and wall jumping
- An animated character that turns to face the direction it moves
- Collectible coins, deadly spikes and a goal that finishes each level
- Five levels made in Tiled
- A title screen and a level select screen that work with the keyboard and the mouse
- Locked levels and saved progress: finishing a level unlocks the next one

## Controls

| Key | Action |
|-----|--------|
| Left / Right arrow | Move |
| Up arrow or Space | Jump |
| Hold an arrow key toward a wall in the air | Slide down the wall slowly |
| Jump while touching a wall in the air | Wall jump |
| R | Restart the current level |
| Esc | Back to the level select screen |
| Enter | Start from the title screen / play the highlighted level |
| Arrow keys, number keys 1 to 9, or the mouse | Choose a level on the level select screen |

## How to play

1. Press **Enter** (or click) on the title screen to open the level select screen.
2. Choose a level. At first only level 1 is unlocked.
3. Collect the coins, avoid the spikes, and don't fall off the bottom of the screen. Touching a spike or falling sends you back to the start of the level.
4. Reach the goal to finish the level. This unlocks the next level and loads it automatically.
5. Finish the last level to see the **You win!** screen, then press **Enter** to return to the level select screen.

Your progress is saved in the browser, so it is still there the next time you open the game.

## Run it on your computer

The game loads its level files with `fetch`, so it has to run on a web server. Opening `index.html` by double-clicking it will not work.

1. Download or clone this repository.
2. Open the folder in [Visual Studio Code](https://code.visualstudio.com/).
3. Install the **Live Server** extension.
4. Right-click `index.html` and choose **Open with Live Server**.

## Publish it with GitHub Pages

1. Push the project to a GitHub repository.
2. In the repository, go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select the `main` branch and the `/ (root)` folder, and save.
4. After a minute or two, the game is available at `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`.

GitHub Pages is case-sensitive, so file and folder names must match the code exactly (for example `assets` and not `Assets`).

## Project structure

```
.
├── index.html     The page with the canvas the game is drawn on
├── style.css      Centers the canvas and scales it to fit the window
├── game.js        All of the game code
├── assets/        Tileset pictures (tiles, backgrounds, characters)
└── levels/        Tiled maps and the JSON files the game loads
    ├── level1.json ... level5.json
    ├── title.json     (optional) the title screen
    └── select.json    (optional) the level select screen
```

## Making and changing levels

Levels are made in Tiled and exported as JSON files, so no code needs to be changed to design a new level.

**Map settings in Tiled**

- Orientation: Orthogonal
- Map size: **Fixed** (not Infinite), 32 × 16 tiles
- Tile layer format: **CSV**
- Tilesets: tick **Embed in map**, and put the tileset pictures in the `assets` folder

**Layers and objects**

- Every tile on the tile layer named **`ground`** is solid. Other tile layers are only decoration.
- Objects (placed with the Insert Tile tool) are recognized by their **Name**:

| Object name | Meaning |
|-------------|---------|
| `player` | Where the player starts (its picture is also the character) |
| `coin` | A collectible coin |
| `spike` | A hazard that sends the player back to the start |
| `goal` | The exit of the level |

Each level needs one `player` and one `goal`.

**Adding a level**

1. Export the map with **File → Export As → JSON** into the `levels` folder.
2. Add the file to the `LEVEL_FILES` list at the top of `game.js`:

```js
const LEVEL_FILES = [
  "levels/level1.json",
  "levels/level2.json",
];
```

**Title screen and level select screen**

- Make maps named `levels/title.json` and `levels/select.json` the same way. If they are missing, the game uses built-in screens.
- In `select.json`, give the objects that make up each level card the names `level1`, `level2`, and so on. Several objects with the same name form one card.

## Settings

The values at the top of `game.js` can be changed to adjust how the game plays.

| Setting | What it does |
|---------|--------------|
| `GRAVITY`, `SPEED`, `JUMP` | How the player falls, runs and jumps |
| `WALL_SLIDE_SPEED`, `WALL_JUMP_X`, `WALL_JUMP_Y` | How wall sliding and wall jumping feel |
| `TILE_SIZE` | Size of one tile on screen (32 × 16 tiles at 60 px gives 1920 × 960) |
| `UNLOCK_ALL` | `true` lets you pick any level, `false` locks levels until the previous one is finished |
| `LEVEL_FILES` | The list of levels and their order |

To reset saved progress, open the browser console (F12) and run:

```js
localStorage.removeItem("platformer-unlocked")
```

## Built with

- HTML5, CSS3 and JavaScript (HTML5 Canvas 2D API)
- [Tiled Map Editor](https://www.mapeditor.org/) for the levels and screens
- Visual Studio Code and the Live Server extension
- Git, GitHub and GitHub Pages

## Credits

- Tile, background and character pictures from the [Kenney](https://kenney.nl/) "Pixel Platformer" asset pack (CC0, public domain)
- Built with step-by-step help from [Claude.ai](https://claude.ai/) by Anthropic, used as a guide for the code and the Tiled setup
