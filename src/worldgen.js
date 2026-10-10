// Procedural terrain generation. Pure functions over (seed, x, z): no DOM / three.js.
import { Simplex, hash3, mulberry32 } from './noise.js';
import { B } from './blocks.js';

export const CS = 16; // chunk size (x/z)
export const WH = 96; // world height
export const SEA = 40; // sea level (top water block y)
export const idx = (x, y, z) => x + z * CS + y * CS * CS;

export const BIOMES = {
  OCEAN: 'Ocean',
  BEACH: 'Beach',
  PLAINS: 'Plains',
  FOREST: 'Forest',
  DESERT: 'Desert',
  MOUNTAINS: 'Mountains',
};

const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class WorldGen {
  constructor(seed) {
    this.seed = seed >>> 0;
    const s = this.seed;
    this.cont = new Simplex(s);
    this.mount = new Simplex(s + 1);
    this.ridge = new Simplex(s + 2);
    this.detail = new Simplex(s + 3);
    this.temp = new Simplex(s + 4);
    this.moist = new Simplex(s + 5);
    this.cave1 = new Simplex(s + 6);
    this.cave2 = new Simplex(s + 7);
    this.cavern = new Simplex(s + 8);
    this.misc = new Simplex(s + 9);
  }

  // Terrain height (y of the top solid block) and biome for a world column.
  column(x, z) {
    const c = this.cont.fbm2(x / 380, z / 380, 4);
    const base = SEA + 3 + c * 30;
    const mMask = smoothstep(0.02, 0.4, this.mount.fbm2(x / 280 + 50, z / 280 - 50, 3));
    const r = 1 - Math.abs(this.ridge.fbm2(x / 110, z / 110, 4));
    const landFactor = smoothstep(-0.12, 0.05, c);
    let h = base + this.detail.fbm2(x / 45, z / 45, 3) * 5 + mMask * landFactor * Math.pow(r, 1.6) * 52;
    h = Math.max(4, Math.min(WH - 8, Math.floor(h)));

    let biome;
    if (h < SEA - 2) biome = BIOMES.OCEAN;
    else if (h <= SEA + 1) biome = BIOMES.BEACH;
    else if (h >= 70) biome = BIOMES.MOUNTAINS;
    else {
      const t = this.temp.fbm2(x / 520, z / 520, 2);
      const m = this.moist.fbm2(x / 430, z / 430, 2);
      if (t > 0.2 && m < 0.05) biome = BIOMES.DESERT;
      else if (m > 0.05) biome = BIOMES.FOREST;
      else biome = BIOMES.PLAINS;
    }
    return { h, biome };
  }

  // Which tree (if any) grows at this column: null | {type: 'oak'|'birch'|'cactus', height}
  treeAt(x, z, col = this.column(x, z)) {
    const { h, biome } = col;
    if (h <= SEA + 1 || h > WH - 12) return null;
    const r = hash3(x, 7, z, this.seed);
    let chance = 0;
    if (biome === BIOMES.FOREST) chance = 0.045;
    else if (biome === BIOMES.PLAINS) chance = 0.004;
    else if (biome === BIOMES.MOUNTAINS && h < 74) chance = 0.008;
    else if (biome === BIOMES.DESERT) chance = 0.005;
    if (r >= chance) return null;
    const r2 = hash3(x, 13, z, this.seed);
    if (biome === BIOMES.DESERT) return { type: 'cactus', height: 2 + Math.floor(r2 * 3) };
    const birch = biome === BIOMES.FOREST && r2 < 0.35;
    return { type: birch ? 'birch' : 'oak', height: 4 + Math.floor(hash3(x, 21, z, this.seed) * 3) };
  }

  // Generate the block data of chunk (cx, cz). Returns Uint8Array(CS*CS*WH).
  generateChunk(cx, cz) {
    const data = new Uint8Array(CS * CS * WH);
    const x0 = cx * CS, z0 = cz * CS;
    const heights = new Int16Array(CS * CS);
    const biomes = new Array(CS * CS);
    const seed = this.seed;

    // 1. terrain columns
    for (let lz = 0; lz < CS; lz++)
      for (let lx = 0; lx < CS; lx++) {
        const wx = x0 + lx, wz = z0 + lz;
        const { h, biome } = this.column(wx, wz);
        heights[lx + lz * CS] = h;
        biomes[lx + lz * CS] = biome;
        let top, filler;
        const fillerDepth = 3 + Math.floor(hash3(wx, 1, wz, seed) * 2);
        switch (biome) {
          case BIOMES.OCEAN:
            top = filler = this.misc.noise2(wx / 30, wz / 30) > 0.25 ? B.GRAVEL : h < SEA - 7 && this.misc.noise2(wx / 25 + 9, wz / 25) > 0 ? B.DIRT : B.SAND;
            break;
          case BIOMES.BEACH:
          case BIOMES.DESERT:
            top = filler = B.SAND;
            break;
          case BIOMES.MOUNTAINS: {
            const n = this.misc.noise2(wx / 12, wz / 12) * 4;
            if (h + n >= 84) { top = B.SNOW; filler = B.STONE; }
            else if (h + n >= 74) { top = filler = B.STONE; }
            else { top = B.GRASS; filler = B.DIRT; }
            break;
          }
          default:
            top = B.GRASS;
            filler = B.DIRT;
        }
        for (let y = 0; y <= h; y++) {
          let id;
          if (y === 0 || (y <= 2 && hash3(wx, y, wz, seed) < 0.5 - y * 0.15)) id = B.BEDROCK;
          else if (y === h) id = top;
          else if (y > h - fillerDepth) id = filler;
          else id = B.STONE;
          data[idx(lx, y, lz)] = id;
        }
        for (let y = h + 1; y <= SEA; y++) data[idx(lx, y, lz)] = B.WATER;
      }

    // 2. ore veins (random walks inside the chunk, only replacing stone)
    const rand = mulberry32(Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ seed);
    const veins = [
      [B.COAL_ORE, 18, 8, 5, 85],
      [B.COPPER_ORE, 12, 7, 5, 64],
      [B.IRON_ORE, 9, 6, 4, 48],
      [B.GOLD_ORE, 4, 5, 3, 30],
    ];
    for (const [ore, count, size, minY, maxY] of veins)
      for (let v = 0; v < count; v++) {
        let x = Math.floor(rand() * CS), z = Math.floor(rand() * CS);
        let y = minY + Math.floor(rand() * (maxY - minY));
        for (let k = 0; k < size; k++) {
          const i = idx(x, y, z);
          if (data[i] === B.STONE) data[i] = ore;
          const d = Math.floor(rand() * 6);
          if (d === 0) x = Math.min(CS - 1, x + 1);
          else if (d === 1) x = Math.max(0, x - 1);
          else if (d === 2) z = Math.min(CS - 1, z + 1);
          else if (d === 3) z = Math.max(0, z - 1);
          else if (d === 4) y = Math.min(WH - 1, y + 1);
          else y = Math.max(1, y - 1);
        }
      }

    // 3. caves: noise sampled on a coarse 4x4x4 lattice and trilinearly interpolated
    this.carveCaves(data, heights, x0, z0);

    // 4. trees (look 2 columns beyond the chunk so canopies cross chunk borders)
    for (let lz = -2; lz < CS + 2; lz++)
      for (let lx = -2; lx < CS + 2; lx++) {
        const wx = x0 + lx, wz = z0 + lz;
        const inside = lx >= 0 && lz >= 0 && lx < CS && lz < CS;
        const col = inside ? null : this.column(wx, wz);
        const tree = this.treeAt(wx, wz, col || { h: heights[lx + lz * CS], biome: biomes[lx + lz * CS] });
        if (!tree) continue;
        const h = col ? col.h : heights[lx + lz * CS];
        if (inside) {
          const g = data[idx(lx, h, lz)];
          if (tree.type === 'cactus' ? g !== B.SAND : g !== B.GRASS) continue;
        }
        this.placeTree(data, lx, h + 1, lz, tree, wx, wz);
      }
    return data;
  }

  carveCaves(data, heights, x0, z0) {
    const S = 4;
    const nx = CS / S + 1, ny = WH / S + 1;
    const field = new Float32Array(nx * nx * ny);
    for (let gy = 0; gy < ny; gy++)
      for (let gz = 0; gz < nx; gz++)
        for (let gx = 0; gx < nx; gx++) {
          const wx = x0 + gx * S, wy = gy * S, wz = z0 + gz * S;
          // "spaghetti" tunnels where two noise fields are both near zero
          const a = this.cave1.noise3(wx / 48, wy / 32, wz / 48);
          const b = this.cave2.noise3(wx / 48, wy / 32, wz / 48);
          let v = a * a + b * b; // small = tunnel
          // larger caverns deep down
          if (wy < 36) {
            const c = this.cavern.noise3(wx / 70, wy / 24, wz / 70);
            v = Math.min(v, (0.72 - c) * 0.2);
          }
          field[gx + gz * nx + gy * nx * nx] = v;
        }
    const at = (gx, gy, gz) => field[gx + gz * nx + gy * nx * nx];
    for (let lz = 0; lz < CS; lz++)
      for (let lx = 0; lx < CS; lx++) {
        const h = heights[lx + lz * CS];
        const underwater = h < SEA;
        const maxY = underwater ? h - 6 : h;
        const gx = Math.floor(lx / S), gz = Math.floor(lz / S);
        const fx = (lx % S) / S, fz = (lz % S) / S;
        for (let y = 3; y <= maxY; y++) {
          const gy = Math.floor(y / S), fy = (y % S) / S;
          const c00 = at(gx, gy, gz) * (1 - fx) + at(gx + 1, gy, gz) * fx;
          const c10 = at(gx, gy + 1, gz) * (1 - fx) + at(gx + 1, gy + 1, gz) * fx;
          const c01 = at(gx, gy, gz + 1) * (1 - fx) + at(gx + 1, gy, gz + 1) * fx;
          const c11 = at(gx, gy + 1, gz + 1) * (1 - fx) + at(gx + 1, gy + 1, gz + 1) * fx;
          const v = (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz;
          // tunnels get thinner near the surface so they rarely open huge holes
          const thr = y > h - 5 ? 0.006 : 0.012;
          if (v < thr) {
            const i = idx(lx, y, lz);
            const id = data[i];
            if (id !== B.BEDROCK && id !== B.WATER) data[i] = B.AIR;
          }
        }
      }
  }

  placeTree(data, lx, y, lz, tree, wx, wz) {
    const set = (x, yy, z, id, force) => {
      if (x < 0 || z < 0 || x >= CS || z >= CS || yy < 0 || yy >= WH) return;
      const i = idx(x, yy, z);
      if (force || data[i] === B.AIR) data[i] = id;
    };
    if (tree.type === 'cactus') {
      for (let k = 0; k < tree.height; k++) set(lx, y + k, lz, B.CACTUS, true);
      return;
    }
    const log = tree.type === 'birch' ? B.BIRCH_LOG : B.OAK_LOG;
    const leaf = tree.type === 'birch' ? B.BIRCH_LEAVES : B.OAK_LEAVES;
    const top = y + tree.height - 1;
    for (let ly = top - 2; ly <= top + 1; ly++) {
      const rad = ly >= top ? 1 : 2;
      for (let dz = -rad; dz <= rad; dz++)
        for (let dx = -rad; dx <= rad; dx++) {
          const corner = Math.abs(dx) === rad && Math.abs(dz) === rad;
          if (corner && (ly === top + 1 || hash3(wx + dx, ly, wz + dz, this.seed) < 0.5)) continue;
          set(lx + dx, ly, lz + dz, leaf, false);
        }
    }
    for (let k = 0; k < tree.height; k++) set(lx, y + k, lz, log, true);
  }

  // Find a dry land spawn column near the origin.
  findSpawn() {
    for (let r = 0; r < 2000; r += 8)
      for (let a = 0; a < 16; a++) {
        const x = Math.round(Math.cos((a / 16) * Math.PI * 2) * r);
        const z = Math.round(Math.sin((a / 16) * Math.PI * 2) * r);
        const { h, biome } = this.column(x, z);
        if ((biome === BIOMES.PLAINS || biome === BIOMES.FOREST) && h > SEA + 2 && h < 68) return { x: x + 0.5, y: h + 1, z: z + 0.5 };
      }
    return { x: 0.5, y: WH - 4, z: 0.5 };
  }
}
