// Game bootstrap: menu, input, chunk streaming, mining/placing, saving and the main loop.
import { World } from './world.js';
import { CS, WH, SEA } from './worldgen.js';
import { B, BLOCKS, getItem, miningInfo } from './blocks.js';
import { Inventory, HOTBAR_SIZE } from './inventory.js';
import { Player, raycast } from './physics.js';
import { Renderer } from './renderer.js';
import { loadTextures } from './textures.js';
import { UI } from './ui.js';

const SAVE_KEY = 'lukacraft-save-v1';
const REACH = 5;
const $ = (sel) => document.querySelector(sel);

function readSave() {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY));
  } catch {
    return null;
  }
}

class Game {
  async init() {
    this.tex = await loadTextures();
    this.canvas = $('#game');
    this.renderer = new Renderer(this.canvas, this.tex);
    this.renderDistance = 6;
    this.renderer.setRenderDistance(this.renderDistance);
    this.keys = new Set();
    this.mouse = { left: false, right: false };
    this.mining = null; // { x, y, z, progress, time }
    this.placeCooldown = 0;
    this.showDebug = false;
    this.time = 0;
    this.fps = 0;
    // ?test: automated tests can't use pointer lock, so treat the game as always focused
    this.testMode = new URLSearchParams(location.search).has('test');
    this.bindInput();
    this.setupMenu();
    window.game = this; // handy for debugging and automated tests
  }

  // ------------------------------------------------------------------ menu / world lifecycle
  setupMenu() {
    const save = readSave();
    $('#seed').value = String(Math.floor(Math.random() * 1e6));
    $('#btn-continue').style.display = save ? '' : 'none';
    $('#btn-continue').onclick = () => this.startWorld(save);
    $('#btn-new').onclick = () => {
      const raw = $('#seed').value.trim();
      const seed = /^\d+$/.test(raw) ? Number(raw) : [...raw].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
      this.startWorld({ seed });
    };
    $('#btn-resume').onclick = () => this.lock();
    $('#btn-quit').onclick = () => {
      this.save();
      location.reload();
    };
    $('#loading').style.display = 'none';
    $('#menu-buttons').style.display = '';
  }

  startWorld(save) {
    $('#menu').classList.add('hidden');
    this.world = new World(save.seed, save.edits || {});
    this.inventory = new Inventory(save.inventory);
    const spawn = save.player || this.world.gen.findSpawn();
    this.player = new Player([spawn.x, spawn.y, spawn.z]);
    this.player.yaw = spawn.yaw || 0;
    this.player.pitch = spawn.pitch || 0;
    this.player.fly = !!spawn.fly;
    this.ui = new UI(this, this.tex.icons);
    this.inventory.onChange = () => this.ui.render();
    this.ui.render();

    // generate the area around the player synchronously so we don't fall through the world
    const pcx = Math.floor(this.player.pos[0] / CS), pcz = Math.floor(this.player.pos[2] / CS);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) this.world.ensureChunk(pcx + dx, pcz + dz);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.renderer.meshChunk(this.world, this.world.getChunk(pcx + dx, pcz + dz));
    // make sure the spawn position isn't inside terrain (e.g. a saved spot that was built over)
    while (this.player.collides(this.world) && this.player.pos[1] < WH) this.player.pos[1] += 1;

    $('#hud').classList.remove('hidden');
    this.running = true;
    this.lastFrame = performance.now();
    this.saveTimer = setInterval(() => this.save(), 10000);
    window.addEventListener('beforeunload', () => this.save());
    this.ui.toast('Punch trees to collect wood! Press E for inventory & crafting.');
    this.lock();
    requestAnimationFrame((t) => this.frame(t));
  }

  save() {
    if (!this.world) return;
    const p = this.player;
    const data = {
      seed: this.world.seed,
      edits: this.world.serializeEdits(),
      inventory: this.inventory.toJSON(),
      player: { x: p.pos[0], y: p.pos[1], z: p.pos[2], yaw: p.yaw, pitch: p.pitch, fly: p.fly },
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Save failed', e);
    }
  }

  // ------------------------------------------------------------------ input
  lock() {
    $('#pause').classList.add('hidden');
    this.canvas.requestPointerLock?.()?.catch?.(() => {});
  }

  get locked() {
    return document.pointerLockElement === this.canvas || (this.testMode && !this.ui?.open);
  }

  bindInput() {
    document.addEventListener('pointerlockchange', () => {
      if (!this.running) return;
      if (document.pointerLockElement === this.canvas) return;
      if (!this.ui.open && !this.testMode) $('#pause').classList.remove('hidden');
      this.mouse.left = this.mouse.right = false;
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.running || this.ui.open) return;
      if (!this.locked) {
        this.lock();
        return;
      }
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) {
        this.mouse.right = true;
        this.placeCooldown = 0;
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.player) return;
      const s = 0.0022;
      this.player.yaw -= e.movementX * s;
      this.player.pitch = Math.max(-1.55, Math.min(1.55, this.player.pitch - e.movementY * s));
    });
    document.addEventListener('wheel', (e) => {
      if (!this.locked || !this.inventory) return;
      const d = Math.sign(e.deltaY);
      this.selectSlot((this.inventory.selected + d + HOTBAR_SIZE) % HOTBAR_SIZE);
    });
    document.addEventListener('keydown', (e) => {
      if (!this.running) return;
      if (e.code === 'KeyE') {
        e.preventDefault();
        this.toggleInventory();
        return;
      }
      if (e.code === 'Escape' && this.ui.open) {
        this.toggleInventory(false);
        return;
      }
      if (this.ui.open) return;
      this.keys.add(e.code);
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= 9) this.selectSlot(n - 1);
      }
      if (e.code === 'KeyF') {
        this.player.fly = !this.player.fly;
        this.ui.toast(this.player.fly ? 'Flying ON (Space up, Shift down)' : 'Flying OFF');
      }
      if (e.code === 'F3') {
        e.preventDefault();
        this.showDebug = !this.showDebug;
      }
      if (e.code === 'Equal' || e.code === 'NumpadAdd') this.setRenderDistance(this.renderDistance + 1);
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') this.setRenderDistance(this.renderDistance - 1);
      if (e.code === 'Space') e.preventDefault();
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  setRenderDistance(n) {
    this.renderDistance = Math.max(2, Math.min(12, n));
    this.renderer.setRenderDistance(this.renderDistance);
    this.ui.toast(`Render distance: ${this.renderDistance} chunks`);
  }

  toggleInventory(force) {
    const open = force ?? !this.ui.open;
    this.ui.toggleInventory(open);
    this.keys.clear();
    this.mouse.left = this.mouse.right = false;
    if (open) document.exitPointerLock?.();
    else this.lock();
  }

  selectSlot(i) {
    this.inventory.selected = i;
    this.mining = null;
    this.ui.renderHotbar();
    this.ui.showItemName();
  }

  nearCraftingTable() {
    const [px, py, pz] = this.player.pos.map(Math.floor);
    for (let y = py - 3; y <= py + 4; y++)
      for (let z = pz - 4; z <= pz + 4; z++)
        for (let x = px - 4; x <= px + 4; x++) if (this.world.getBlock(x, y, z) === B.CRAFTING_TABLE) return true;
    return false;
  }

  // ------------------------------------------------------------------ chunk streaming
  updateChunks(budgetMs) {
    const t0 = performance.now();
    const R = this.renderDistance;
    const pcx = Math.floor(this.player.pos[0] / CS), pcz = Math.floor(this.player.pos[2] / CS);
    if (pcx !== this.lastPcx || pcz !== this.lastPcz || R !== this.lastR) {
      this.lastPcx = pcx;
      this.lastPcz = pcz;
      this.lastR = R;
      // chunk coordinates within R+1, nearest first
      this.wanted = [];
      for (let dz = -R - 1; dz <= R + 1; dz++)
        for (let dx = -R - 1; dx <= R + 1; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dz));
          this.wanted.push([pcx + dx, pcz + dz, dx * dx + dz * dz, d]);
        }
      this.wanted.sort((a, b) => a[2] - b[2]);
      // unload far chunks
      for (const c of [...this.world.chunks.values()])
        if (Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz)) > R + 2) {
          this.renderer.removeChunk(c);
          this.world.unloadChunk(c.cx, c.cz);
        }
    }
    let pending = 0;
    for (const [cx, cz, , d] of this.wanted) {
      if (performance.now() - t0 > budgetMs) {
        pending++;
        continue;
      }
      if (!this.world.getChunk(cx, cz)) this.world.ensureChunk(cx, cz);
      if (d > R) continue;
      const c = this.world.getChunk(cx, cz);
      if (!c.dirty) continue;
      // mesh only once all four neighbours exist so border faces are correct
      let ready = true;
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!this.world.getChunk(cx + ox, cz + oz)) ready = false;
      if (ready) this.renderer.meshChunk(this.world, c);
      else pending++;
    }
    this.pendingChunks = pending;
  }

  // ------------------------------------------------------------------ interaction
  currentTarget() {
    return raycast(this.world, this.player.eye, this.player.look, REACH);
  }

  breakBlock(x, y, z) {
    const id = this.world.getBlock(x, y, z);
    const held = this.inventory.held;
    const heldItem = held ? getItem(held.id) : null;
    const { canHarvest } = miningInfo(id, heldItem);
    // water flows into the hole if it touches water from the side or above
    const touchesWater = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]].some(
      ([dx, dy, dz]) => this.world.getBlock(x + dx, y + dy, z + dz) === B.WATER,
    );
    this.world.setBlock(x, y, z, touchesWater && y <= SEA ? B.WATER : B.AIR);
    if (canHarvest) {
      for (const [dropId, n, chance = 1] of BLOCKS[id].drops)
        if (Math.random() < chance) {
          const left = this.inventory.add(dropId, n);
          if (left > 0) this.ui.toast('Inventory full!');
        }
    } else if (BLOCKS[id].tier) {
      this.ui.toast(`${BLOCKS[id].name} needs a better pickaxe`);
    }
    if (heldItem?.tool && this.inventory.damageHeld()) this.ui.toast(`Your ${heldItem.name} broke!`);
    // break unsupported cactus above
    if (this.world.getBlock(x, y + 1, z) === B.CACTUS) this.breakBlock(x, y + 1, z);
  }

  placeBlock(hit) {
    const held = this.inventory.held;
    if (!held) return false;
    const item = getItem(held.id);
    if (!item.isBlock || !item.placeable) return false;
    const [nx, ny, nz] = hit.normal;
    const x = hit.x + nx, y = hit.y + ny, z = hit.z + nz;
    if (y < 0 || y >= WH) return false;
    const cur = this.world.getBlock(x, y, z);
    if (cur !== B.AIR && cur !== B.WATER) return false;
    if (item.solid && this.player.intersectsBlock(x, y, z)) return false;
    if (held.id === B.CACTUS && this.world.getBlock(x, y - 1, z) !== B.SAND && this.world.getBlock(x, y - 1, z) !== B.CACTUS) {
      this.ui.toast('Cactus must be placed on sand');
      return false;
    }
    this.world.setBlock(x, y, z, held.id);
    this.inventory.consumeHeld();
    return true;
  }

  updateInteraction(dt) {
    const hit = this.locked ? this.currentTarget() : null;
    this.target = hit;
    let crack = -1;
    if (hit && this.mouse.left) {
      const m = this.mining;
      if (!m || m.x !== hit.x || m.y !== hit.y || m.z !== hit.z || m.id !== hit.id) {
        const held = this.inventory.held;
        const { time } = miningInfo(hit.id, held ? getItem(held.id) : null);
        this.mining = { x: hit.x, y: hit.y, z: hit.z, id: hit.id, progress: 0, time };
      }
      this.mining.progress += dt;
      if (this.mining.time === Infinity) this.mining.progress = 0;
      crack = Math.floor((this.mining.progress / this.mining.time) * 8);
      if (this.mining.progress >= this.mining.time) {
        this.breakBlock(hit.x, hit.y, hit.z);
        this.mining = null;
        crack = -1;
      }
    } else this.mining = null;

    this.placeCooldown -= dt;
    if (hit && this.mouse.right && this.placeCooldown <= 0) {
      this.placeCooldown = 0.25;
      if (hit.id === B.CRAFTING_TABLE && !this.keys.has('ShiftLeft')) this.toggleInventory(true);
      else this.placeBlock(hit);
    }
    this.renderer.setTarget(hit, crack);
  }

  // ------------------------------------------------------------------ main loop
  frame(now) {
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.time += dt;
    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;

    this.updateChunks(this.pendingChunks ? 10 : 4);
    const p = this.player;
    // don't simulate physics until the chunk under the player exists
    if (this.world.getChunk(Math.floor(p.pos[0] / CS), Math.floor(p.pos[2] / CS))) {
      const k = this.keys;
      const active = this.locked;
      p.update(
        dt,
        {
          forward: active && k.has('KeyW'),
          back: active && k.has('KeyS'),
          left: active && k.has('KeyA'),
          right: active && k.has('KeyD'),
          jump: active && k.has('Space'),
          sprint: active && (k.has('ShiftLeft') || k.has('ControlLeft')),
          down: active && k.has('ShiftLeft'),
        },
        this.world,
      );
      if (p.pos[1] < -20) p.pos = [p.pos[0], this.world.surfaceY(Math.floor(p.pos[0]), Math.floor(p.pos[2])) + 2, p.pos[2]];
    }
    this.updateInteraction(dt);
    $('#water-overlay').style.display = p.headInWater ? 'block' : 'none';
    this.renderer.render(p, p.headInWater, this.time);

    if (this.showDebug) {
      const col = this.world.gen.column(Math.floor(p.pos[0]), Math.floor(p.pos[2]));
      const t = this.target;
      this.ui.setDebug(
        `LukaCraft  ${this.fps.toFixed(0)} fps\n` +
          `XYZ ${p.pos.map((v) => v.toFixed(1)).join(' / ')}\n` +
          `Biome ${col.biome}   Seed ${this.world.seed}\n` +
          `Chunks ${this.world.chunks.size} loaded, ${this.pendingChunks} pending, R=${this.renderDistance}\n` +
          `Target ${t ? `${BLOCKS[t.id].name} @ ${t.x} ${t.y} ${t.z}` : '-'}${p.fly ? '\nFlying' : ''}`,
      );
    } else this.ui.setDebug('');
    requestAnimationFrame((t) => this.frame(t));
  }
}

const game = new Game();
game.init().catch((e) => {
  console.error(e);
  $('#loading').textContent = `Failed to start: ${e.message}`;
});
