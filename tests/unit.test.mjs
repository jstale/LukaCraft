import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldGen, BIOMES, SEA, CS, WH, idx } from '../src/worldgen.js';
import { World } from '../src/world.js';
import { B, I, BLOCKS, ITEMS, getItem, miningInfo, toolId, blockTextureNames } from '../src/blocks.js';
import { Inventory, RECIPES } from '../src/inventory.js';
import { buildChunkGeometry } from '../src/mesher.js';
import fs from 'node:fs';

const SEED = 12345;

test('world generation is deterministic per seed', () => {
  const a = new WorldGen(SEED).generateChunk(3, -2);
  const b = new WorldGen(SEED).generateChunk(3, -2);
  const c = new WorldGen(SEED + 1).generateChunk(3, -2);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('terrain has every biome, mountains and oceans', () => {
  const gen = new WorldGen(SEED);
  const counts = {};
  let minH = Infinity, maxH = -Infinity;
  for (let x = -3000; x < 3000; x += 24)
    for (let z = -3000; z < 3000; z += 24) {
      const { h, biome } = gen.column(x, z);
      counts[biome] = (counts[biome] || 0) + 1;
      minH = Math.min(minH, h);
      maxH = Math.max(maxH, h);
    }
  for (const b of Object.values(BIOMES)) assert.ok(counts[b] > 0, `biome ${b} missing: ${JSON.stringify(counts)}`);
  assert.ok(maxH >= 80, `mountains too low (${maxH})`);
  assert.ok(minH < SEA - 8, `no deep water (${minH})`);
  assert.ok(maxH < WH - 4);
  console.log('  biome distribution:', counts, 'height range', minH, maxH);
});

test('chunks contain all natural block types, caves and trees', () => {
  const gen = new WorldGen(SEED);
  const counts = new Map();
  let caveAir = 0;
  for (let cx = -6; cx <= 6; cx += 2)
    for (let cz = -6; cz <= 6; cz += 2) {
      const d = gen.generateChunk(cx * 7, cz * 7);
      for (const id of d) counts.set(id, (counts.get(id) || 0) + 1);
      for (let y = 5; y < 30; y++) if (d[idx(8, y, 8)] === B.AIR) caveAir++;
      assert.equal(d[idx(0, 0, 0)], B.BEDROCK);
    }
  const need = [B.GRASS, B.DIRT, B.STONE, B.SAND, B.WATER, B.OAK_LOG, B.OAK_LEAVES, B.BIRCH_LOG, B.COAL_ORE, B.COPPER_ORE, B.IRON_ORE, B.GOLD_ORE, B.BEDROCK, B.SNOW];
  for (const id of need) assert.ok(counts.get(id) > 0, `missing ${BLOCKS[id].name}`);
  assert.ok(caveAir > 0, 'no caves found');
  // ore rarity ordering: coal > copper > iron > gold
  assert.ok(counts.get(B.COAL_ORE) > counts.get(B.COPPER_ORE));
  assert.ok(counts.get(B.COPPER_ORE) > counts.get(B.IRON_ORE));
  assert.ok(counts.get(B.IRON_ORE) > counts.get(B.GOLD_ORE));
});

test('spawn point is on dry land', () => {
  const w = new World(SEED);
  const sp = w.gen.findSpawn();
  const cx = Math.floor(sp.x / CS), cz = Math.floor(sp.z / CS);
  w.ensureChunk(cx, cz);
  const below = w.getBlock(Math.floor(sp.x), Math.floor(sp.y) - 1, Math.floor(sp.z));
  assert.ok(sp.y > SEA);
  assert.notEqual(below, B.WATER);
  assert.notEqual(below, B.AIR);
});

test('world edits persist across chunk reloads', () => {
  const w = new World(SEED);
  w.ensureChunk(0, 0);
  w.setBlock(5, 70, 5, B.PLANKS);
  const saved = w.serializeEdits();
  const w2 = new World(SEED, JSON.parse(JSON.stringify(saved)));
  w2.ensureChunk(0, 0);
  assert.equal(w2.getBlock(5, 70, 5), B.PLANKS);
});

test('mining rules: tool tiers and speeds', () => {
  const wp = ITEMS[toolId('wood', 'pickaxe')];
  const sp = ITEMS[toolId('stone', 'pickaxe')];
  const cp = ITEMS[toolId('copper', 'pickaxe')];
  const ip = ITEMS[toolId('iron', 'pickaxe')];
  assert.equal(miningInfo(B.STONE, null).canHarvest, false);
  assert.equal(miningInfo(B.STONE, wp).canHarvest, true);
  assert.ok(miningInfo(B.STONE, wp).time < miningInfo(B.STONE, null).time);
  assert.equal(miningInfo(B.COPPER_ORE, wp).canHarvest, false);
  assert.equal(miningInfo(B.COPPER_ORE, sp).canHarvest, true);
  assert.equal(miningInfo(B.IRON_ORE, sp).canHarvest, false);
  assert.equal(miningInfo(B.IRON_ORE, cp).canHarvest, true);
  assert.equal(miningInfo(B.GOLD_ORE, cp).canHarvest, false);
  assert.equal(miningInfo(B.GOLD_ORE, ip).canHarvest, true);
  assert.equal(miningInfo(B.DIRT, null).canHarvest, true);
  assert.equal(miningInfo(B.BEDROCK, ip).time, Infinity);
  assert.ok(miningInfo(B.OAK_LOG, ITEMS[toolId('wood', 'axe')]).time < miningInfo(B.OAK_LOG, null).time);
});

test('crafting chain: log -> planks -> sticks -> table -> tools', () => {
  const inv = new Inventory();
  inv.add(B.OAK_LOG, 3);
  const find = (out) => RECIPES.find((r) => r.out[0] === out && r.in.every(([id]) => id !== B.BIRCH_LOG));
  assert.ok(inv.craft(find(B.PLANKS), false));
  assert.ok(inv.craft(find(B.PLANKS), false));
  assert.ok(inv.craft(find(B.PLANKS), false));
  assert.equal(inv.count(B.PLANKS), 12);
  assert.ok(inv.craft(find(I.STICK), false));
  assert.equal(inv.count(I.STICK), 4);
  assert.ok(inv.craft(find(B.CRAFTING_TABLE), false));
  const pick = find(toolId('wood', 'pickaxe'));
  assert.equal(inv.craft(pick, false), false, 'tools need a crafting table');
  assert.ok(inv.craft(pick, true));
  assert.equal(inv.count(toolId('wood', 'pickaxe')), 1);
  assert.equal(inv.count(B.PLANKS), 3);
  assert.equal(inv.count(I.STICK), 2);
  // ingredients missing
  inv.add(I.RAW_COPPER, 1);
  assert.equal(inv.craft(find(I.COPPER_INGOT), true), false);
  inv.add(I.COAL, 1);
  assert.ok(inv.craft(find(I.COPPER_INGOT), true));
});

test('inventory stacking, tools and durability', () => {
  const inv = new Inventory();
  assert.equal(inv.add(B.DIRT, 100), 0);
  assert.equal(inv.slots[0].count, 64);
  assert.equal(inv.slots[1].count, 36);
  inv.add(toolId('wood', 'pickaxe'), 2);
  assert.equal(inv.slots[2].count, 1);
  assert.equal(inv.slots[3].count, 1);
  inv.selected = 2;
  for (let i = 0; i < 59; i++) assert.equal(inv.damageHeld(), false);
  assert.equal(inv.damageHeld(), true);
  assert.equal(inv.slots[2], null);
  // click to move
  let cursor = inv.clickSlot(0, null);
  assert.equal(cursor.count, 64);
  cursor = inv.clickSlot(20, cursor);
  assert.equal(cursor, null);
  assert.equal(inv.slots[20].count, 64);
  assert.ok(inv.remove(B.DIRT, 70));
  assert.equal(inv.count(B.DIRT), 30);
});

test('every item and block texture exists on disk', () => {
  for (const name of blockTextureNames()) assert.ok(fs.existsSync(`textures/blocks/${name}.png`), name);
  for (const it of Object.values(ITEMS)) assert.ok(fs.existsSync(`textures/${it.icon}.png`), it.icon);
  for (let i = 0; i < 8; i++) assert.ok(fs.existsSync(`textures/misc/destroy_${i}.png`));
  for (const r of RECIPES) for (const [id] of [r.out, ...r.in]) assert.ok(getItem(id), `recipe references unknown ${id}`);
});

test('mesher produces valid geometry with culled faces', () => {
  const w = new World(SEED);
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) w.ensureChunk(x, z);
  const atlas = { uv: () => [0, 0, 1, 1] };
  const t0 = performance.now();
  const g = buildChunkGeometry(w, w.getChunk(0, 0), atlas);
  const ms = performance.now() - t0;
  const verts = g.solid.positions.length / 3;
  assert.ok(verts > 100);
  assert.equal(g.solid.uvs.length / 2, verts);
  assert.equal(g.solid.colors.length / 3, verts);
  for (const i of g.solid.indices) assert.ok(i < verts);
  // a fully-culled solid chunk would have ~2*16*16 faces at minimum; a naive mesher ~6*16*16*96
  assert.ok(verts / 4 < 16 * 16 * 96, 'faces were not culled');
  console.log(`  chunk mesh: ${verts / 4} faces, ${g.water.positions.length / 12} water faces, ${ms.toFixed(1)} ms`);
});

test('chunk generation speed', () => {
  const gen = new WorldGen(SEED);
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) gen.generateChunk(i, 40);
  const ms = (performance.now() - t0) / 20;
  console.log(`  generateChunk: ${ms.toFixed(1)} ms avg`);
  assert.ok(ms < 60);
});

test('raycast hits the first solid block with the right face normal', async () => {
  const { raycast } = await import('../src/physics.js');
  const w = new World(SEED);
  w.ensureChunk(0, 0);
  for (let y = 60; y < 64; y++) for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) w.setBlock(x, y, z, B.AIR);
  w.setBlock(5, 61, 5, B.STONE);
  const down = raycast(w, [5.5, 63.5, 5.5], [0, -1, 0], 5);
  assert.deepEqual([down.x, down.y, down.z, down.id], [5, 61, 5, B.STONE]);
  assert.deepEqual(down.normal, [0, 1, 0]);
  const side = raycast(w, [2.5, 61.5, 5.5], [1, 0, 0], 5);
  assert.deepEqual(side.normal, [-1, 0, 0]);
  assert.equal(raycast(w, [2.5, 61.5, 5.5], [-1, 0, 0], 2), null);
});

test('player falls onto the ground and is blocked by walls', async () => {
  const { Player } = await import('../src/physics.js');
  const w = new World(SEED);
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) w.ensureChunk(x, z);
  for (let y = 50; y < 70; y++) for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) w.setBlock(x, y, z, y === 50 ? B.STONE : B.AIR);
  w.setBlock(8, 51, 6, B.STONE);
  w.setBlock(8, 52, 6, B.STONE);
  const p = new Player([8.5, 60, 8.5]);
  const idle = {};
  for (let i = 0; i < 120; i++) p.update(1 / 60, idle, w);
  assert.ok(p.onGround);
  assert.ok(Math.abs(p.pos[1] - 51) < 0.01, `feet at ${p.pos[1]}`);
  // walk forward (-Z) into the 2-high wall at z=6
  for (let i = 0; i < 120; i++) p.update(1 / 60, { forward: true }, w);
  assert.ok(p.pos[2] >= 7.3 - 1e-3 && p.pos[2] < 7.31, `stopped at z=${p.pos[2]}`);
  // jumping works
  p.update(1 / 60, { jump: true }, w);
  for (let i = 0; i < 10; i++) p.update(1 / 60, idle, w);
  assert.ok(p.pos[1] > 51.5);
});
