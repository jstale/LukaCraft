// End-to-end test: launches the game in headless Chrome and plays it:
// world loads, player walks, punches a tree, crafts planks/sticks/table, places the table,
// crafts a wooden pickaxe, digs down to stone and mines it. Saves screenshots.
// Usage: node tests/e2e.mjs [--headed]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from '../server.mjs';

const PORT = 8123;
const SHOTS = path.resolve('tests/screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
].find((p) => fs.existsSync(p));

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await startServer(PORT);
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: !process.argv.includes('--headed'),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));

async function waitFor(fn, arg, timeout = 60000, label = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(fn, arg)) return true;
    await sleep(200);
  }
  console.log(`  (timed out waiting for ${label})`);
  return false;
}

try {
  await page.goto(`http://localhost:${PORT}/?test`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('#btn-new', { state: 'visible', timeout: 30000 });
  await page.screenshot({ path: path.join(SHOTS, '0-menu.png') });
  console.log('Menu');
  check(await page.isVisible('#btn-new'), 'menu shows "Create new world"');

  await page.fill('#seed', '12345');
  await page.click('#btn-new');
  console.log('World');
  check(await waitFor(() => window.game?.world && window.game.pendingChunks === 0 && window.game.world.chunks.size > 100, null, 90000, 'chunks'), 'world chunks generated and meshed');
  const info = await page.evaluate(() => {
    const g = window.game;
    const counts = {};
    for (const c of g.world.chunks.values()) for (const id of c.data) counts[id] = (counts[id] || 0) + 1;
    return { chunks: g.world.chunks.size, counts, pos: g.player.pos, meshes: g.renderer.scene.children.length };
  });
  console.log(`  ${info.chunks} chunks, ${info.meshes} scene objects, player at ${info.pos.map((v) => v.toFixed(1))}`);
  const { B } = await import('../src/blocks.js');
  for (const [name, id] of Object.entries({ grass: B.GRASS, stone: B.STONE, water: B.WATER, log: B.OAK_LOG, leaves: B.OAK_LEAVES, coal: B.COAL_ORE, copper: B.COPPER_ORE, iron: B.IRON_ORE, gold: B.GOLD_ORE }))
    check(info.counts[id] > 0, `loaded world contains ${name} (${info.counts[id] || 0})`);
  await sleep(500);
  await page.screenshot({ path: path.join(SHOTS, '1-spawn.png') });

  // ---- gravity / ground
  await sleep(1000);
  const ground = await page.evaluate(() => {
    const g = window.game;
    const p = g.player.pos;
    return { onGround: g.player.onGround, below: g.world.getBlock(Math.floor(p[0]), Math.floor(p[1] - 0.01), Math.floor(p[2])) };
  });
  check(ground.onGround && ground.below !== 0, 'player stands on solid ground');

  // ---- walking
  console.log('Movement');
  // face a direction with open, walkable ground so terrain doesn't block the test
  await page.evaluate(() => {
    const g = window.game, p = g.player.pos;
    const s = (x, y, z) => { const id = g.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)); return id !== 0 && id !== 6; };
    for (let a = 0; a < 16; a++) {
      const yaw = (a / 16) * Math.PI * 2, dx = -Math.sin(yaw), dz = -Math.cos(yaw);
      let ok = true;
      for (let d = 0.5; d <= 5 && ok; d += 0.5) {
        const x = p[0] + dx * d, z = p[2] + dz * d;
        if (s(x, p[1], z) || s(x, p[1] + 1, z) || !s(x, p[1] - 1, z)) ok = false;
      }
      if (ok) { g.player.yaw = yaw; return; }
    }
  });
  const before = await page.evaluate(() => [...window.game.player.pos]);
  // hold jump too, so 1-block steps don't stop us (no auto-jump, like Minecraft)
  await page.keyboard.down('KeyW');
  await page.keyboard.down('Space');
  await sleep(1500);
  await page.keyboard.up('Space');
  await page.keyboard.up('KeyW');
  const after = await page.evaluate(() => [...window.game.player.pos]);
  const moved = Math.hypot(after[0] - before[0], after[2] - before[2]);
  check(moved > 1, `W key moves the player (${moved.toFixed(2)} blocks)`);

  // helpers inside the page
  await page.evaluate(() => {
    const g = window.game;
    window.aimAt = (x, y, z) => {
      const e = g.player.eye;
      const dx = x - e[0], dy = y - e[1], dz = z - e[2];
      g.player.yaw = Math.atan2(-dx, -dz);
      g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    };
    window.solid = (x, y, z) => {
      const id = g.world.getBlock(x, y, z);
      return id !== 0 && id !== 6;
    };
    // find a spot to stand next to the bottom log of a tree
    window.findTree = () => {
      const p = g.player.pos.map(Math.floor);
      let best = null;
      for (let r = 0; r < 60 && !best; r++)
        for (let x = p[0] - r; x <= p[0] + r; x++)
          for (let z = p[2] - r; z <= p[2] + r; z++) {
            if (Math.max(Math.abs(x - p[0]), Math.abs(z - p[2])) !== r) continue;
            for (let y = 30; y < 90; y++) {
              const id = g.world.getBlock(x, y, z);
              if (id !== 7 && id !== 9) continue;
              const under = g.world.getBlock(x, y - 1, z);
              if (under !== 1 && under !== 2) continue;
              for (const [ox, oz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
                const sx = x + ox, sz = z + oz;
                if (!solid(sx, y - 1, sz) || solid(sx, y, sz) || solid(sx, y + 1, sz) || solid(x + ox / 2, y + 1, z + oz / 2) || solid(x + ox / 2, y, z + oz / 2)) continue;
                best = { log: [x, y, z], stand: [sx + 0.5, y, sz + 0.5] };
                return best;
              }
            }
          }
      return best;
    };
  });

  // ---- punch a tree
  console.log('Mining wood');
  const tree = await page.evaluate(() => window.findTree());
  check(!!tree, `found a tree at ${tree?.log}`);
  await page.evaluate((t) => {
    const g = window.game;
    g.player.pos = [...t.stand];
    g.player.vel = [0, 0, 0];
  }, tree);
  await sleep(400);
  let logsGot = 0;
  let shot = false;
  for (let attempt = 0; attempt < 10 && logsGot < 3; attempt++) {
    const dy = Math.min(3, logsGot);
    await page.evaluate(([t, dy]) => window.aimAt(t.log[0] + 0.5, t.log[1] + dy + 0.5, t.log[2] + 0.5), [tree, dy]);
    await sleep(150);
    const tgt = await page.evaluate(() => window.game.target && [window.game.target.x, window.game.target.y, window.game.target.z, window.game.target.id]);
    if (!tgt || ![7, 8, 9, 10].includes(tgt[3])) break; // logs, or leaves in the way (mined too)
    await page.mouse.move(640, 360);
    await page.mouse.down();
    if (!shot && (tgt[3] === 7 || tgt[3] === 9)) {
      shot = true;
      await sleep(900);
      await page.screenshot({ path: path.join(SHOTS, '2-mining-crack.png') });
    }
    await waitFor(([x, y, z]) => window.game.world.getBlock(x, y, z) === 0, tgt, 20000, 'block break');
    await page.mouse.up();
    logsGot = await page.evaluate(() => window.game.inventory.count(7) + window.game.inventory.count(9));
  }  check(logsGot >= 3, `collected logs by punching (${logsGot})`);
  await page.screenshot({ path: path.join(SHOTS, '3-after-tree.png') });

  // ---- crafting via the inventory UI
  console.log('Crafting');
  await page.keyboard.press('KeyE');
  check(await page.isVisible('#inventory'), 'E opens the inventory');
  const clickRecipe = async (name) => {
    const rows = await page.$$('.recipe');
    for (const r of rows) {
      const text = await r.$eval('.name', (e) => e.textContent);
      if (text.startsWith(name) && (await r.evaluate((e) => e.classList.contains('can')))) {
        await r.click();
        return true;
      }
    }
    return false;
  };
  for (let i = 0; i < logsGot; i++) await clickRecipe('Planks');
  const planks = await page.evaluate(() => window.game.inventory.count(11));
  check(planks === logsGot * 4, `crafted planks (${planks})`);
  await clickRecipe('Stick');
  check((await page.evaluate(() => window.game.inventory.count(100))) === 4, 'crafted 4 sticks');
  await clickRecipe('Crafting Table');
  check((await page.evaluate(() => window.game.inventory.count(19))) === 1, 'crafted a crafting table');
  check(!(await clickRecipe('Wooden Pickaxe')), 'pickaxe recipe is locked without a nearby table');
  await page.screenshot({ path: path.join(SHOTS, '4-inventory.png') });
  await page.keyboard.press('KeyE');
  check(!(await page.isVisible('#inventory')), 'E closes the inventory');

  // ---- place the crafting table
  console.log('Placing blocks');
  const slot = await page.evaluate(() => window.game.inventory.slots.findIndex((s) => s && s.id === 19));
  check(slot >= 0 && slot < 9, `crafting table is in the hotbar (slot ${slot + 1})`);
  await page.keyboard.press(`Digit${slot + 1}`);
  const placeSpot = await page.evaluate(() => {
    const p = window.game.player.pos.map(Math.floor);
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
      const x = p[0] + ox, z = p[2] + oz, y = p[1];
      if (window.solid(x, y - 1, z) && !window.solid(x, y, z) && !window.solid(x, y + 1, z)) return [x, y - 1, z];
    }
    return null;
  });
  check(!!placeSpot, 'found ground next to the player');
  await page.evaluate((s) => window.aimAt(s[0] + 0.5, s[1] + 0.999, s[2] + 0.5), placeSpot);
  await sleep(150);
  await page.mouse.down({ button: 'right' });
  await sleep(100);
  await page.mouse.up({ button: 'right' });
  await sleep(150);
  const placed = await page.evaluate((s) => window.game.world.getBlock(s[0], s[1] + 1, s[2]), placeSpot);
  check(placed === 19, 'right click places the crafting table');
  await page.screenshot({ path: path.join(SHOTS, '5-crafting-table.png') });

  // right-click on the table opens the crafting screen; now tools are craftable
  await page.evaluate((s) => window.aimAt(s[0] + 0.5, s[1] + 1.5, s[2] + 0.5), placeSpot);
  await sleep(150);
  await page.mouse.down({ button: 'right' });
  await sleep(100);
  await page.mouse.up({ button: 'right' });
  await sleep(150);
  check(await page.isVisible('#inventory'), 'right click on table opens crafting');
  check(await page.isVisible('#table-status.ok'), 'crafting screen detects nearby table');
  const crafted = await clickRecipe('Wooden Pickaxe');
  if (!crafted) console.log('    diag', await page.evaluate(() => JSON.stringify({ open: window.game.ui.open, near: window.game.ui.nearTable, slots: window.game.inventory.slots.filter(Boolean), rows: [...document.querySelectorAll('.recipe')].slice(0, 6).map((r) => r.textContent + (r.classList.contains('can') ? '+' : '-')) })));
  check(crafted, 'crafted a wooden pickaxe');
  const pickSlot = await page.evaluate(() => window.game.inventory.slots.findIndex((s) => s && s.id === 120));
  check(pickSlot >= 0, 'pickaxe is in the inventory');
  await page.screenshot({ path: path.join(SHOTS, '6-crafted-pickaxe.png') });
  await page.keyboard.press('Escape');

  // move the pickaxe into the hotbar if needed and select it
  if (pickSlot >= 9) {
    await page.evaluate((i) => {
      const inv = window.game.inventory;
      [inv.slots[8], inv.slots[i]] = [inv.slots[i], inv.slots[8]];
      inv.changed();
    }, pickSlot);
  }
  const pickHot = Math.min(pickSlot, 8);
  await page.keyboard.press(`Digit${pickHot + 1}`);
  check((await page.evaluate(() => window.game.inventory.held?.id)) === 120, 'pickaxe selected in hotbar');

  // ---- dig straight down until stone, then mine stone with the pickaxe
  console.log('Digging to stone');
  await page.evaluate(() => {
    const g = window.game;
    g.player.pos = [Math.floor(g.player.pos[0]) + 0.5, g.player.pos[1], Math.floor(g.player.pos[2]) + 0.5];
  });
  let cobble = 0;
  for (let i = 0; i < 14; i++) {
    const below = await page.evaluate(() => {
      const g = window.game;
      const p = g.player.pos;
      g.player.pitch = -Math.PI / 2 + 0.001;
      const b = [Math.floor(p[0]), Math.floor(p[1] - 0.01), Math.floor(p[2])];
      return [...b, g.world.getBlock(...b)];
    });
    if (below[3] === 6 || below[3] === 16) break;
    await sleep(100); // let a frame update the targeted block
    await page.mouse.down();
    const ok = await waitFor((b) => window.game.world.getBlock(b[0], b[1], b[2]) !== b[3], below, 20000, 'dig');
    if (!ok) console.log('    state', await page.evaluate(() => JSON.stringify({ mouse: window.game.mouse, mining: window.game.mining, locked: window.game.locked, uiOpen: window.game.ui.open, ple: !!document.pointerLockElement, target: window.game.target })));
    await page.mouse.up();
    await sleep(600); // fall into the hole
    if (below[3] === 3) {
      cobble = await page.evaluate(() => window.game.inventory.count(4));
      break;
    }
  }
  check(cobble >= 1, `mined stone with the pickaxe and got cobblestone (${cobble})`);
  const dur = await page.evaluate(() => window.game.inventory.slots.find((s) => s && s.id === 120)?.dur);
  check(dur < 60, `pickaxe durability went down (${dur}/60)`);

  // ---- scenic views
  console.log('Views');
  await page.evaluate(() => {
    const g = window.game;
    g.renderDistance = 8;
    g.renderer.setRenderDistance(8);
    g.player.fly = true;
    g.player.pos = [g.player.pos[0], 78, g.player.pos[2]];
    g.player.pitch = -0.35;
    g.player.vel = [0, 0, 0];
  });
  await waitFor(() => window.game.pendingChunks === 0, null, 90000, 'chunks after fly');
  await sleep(500);
  await page.screenshot({ path: path.join(SHOTS, '7-aerial.png') });
  await page.evaluate(() => (window.game.player.yaw += Math.PI));
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, '8-aerial-back.png') });
  // fly to a mountain and a forest and look at them
  for (const [biome, file] of [['Mountains', '9-mountains.png'], ['Forest', '10-forest.png'], ['Desert', '11-desert.png']]) {
    const spot = await page.evaluate((biome) => {
      const g = window.game;
      const [px, , pz] = g.player.pos;
      for (let r = 0; r < 1500; r += 16)
        for (let a = 0; a < 24; a++) {
          const x = Math.round(px + Math.cos((a / 24) * Math.PI * 2) * r), z = Math.round(pz + Math.sin((a / 24) * Math.PI * 2) * r);
          const col = g.world.gen.column(x, z);
          if (col.biome === biome && (biome !== 'Mountains' || col.h > 80)) return { x, z, h: col.h };
        }
      return null;
    }, biome);
    if (!spot) {
      console.log(`  (no ${biome} found nearby)`);
      continue;
    }
    await page.evaluate((s) => {
      const g = window.game;
      const dist = s.h > 75 ? 45 : 22;
      g.player.pos = [s.x + dist, s.h + (s.h > 75 ? 2 : 10), s.z + dist];
      g.player.vel = [0, 0, 0];
      window.aimAt(s.x, s.h - (s.h > 75 ? 8 : 2), s.z);
    }, spot);
    await waitFor(() => window.game.pendingChunks === 0, null, 90000, 'chunks');
    await sleep(500);
    await page.screenshot({ path: path.join(SHOTS, file) });
  }
  // ---- save & reload keeps world edits and inventory
  console.log('Persistence');
  await page.evaluate(() => window.game.save());
  await page.goto(`http://localhost:${PORT}/?test`);
  await page.waitForSelector('#btn-continue', { state: 'visible', timeout: 30000 });
  await page.click('#btn-continue');
  await waitFor(() => window.game?.world && window.game.world.chunks.size > 20, null, 60000, 'reload');
  const persisted = await page.evaluate((s) => (window.game.world.ensureChunk(Math.floor(s[0] / 16), Math.floor(s[2] / 16)), { table: window.game.world.getBlock(s[0], s[1] + 1, s[2]), pick: window.game.inventory.count(120) }), placeSpot);
  check(persisted.table === 19, 'placed crafting table persists after reload');
  check(persisted.pick === 1, 'inventory persists after reload');

  const fps = await page.evaluate(() => window.game.fps);
  console.log(`  fps in headless software rendering: ${fps.toFixed(0)}`);
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''}`);
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll e2e checks passed');
process.exit(failures ? 1 : 0);
