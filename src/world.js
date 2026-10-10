// Chunked voxel world: storage, block access and player edits. No rendering here.
import { WorldGen, CS, WH, idx } from './worldgen.js';
import { B } from './blocks.js';

export const chunkKey = (cx, cz) => `${cx},${cz}`;

export class Chunk {
  constructor(cx, cz, data) {
    this.cx = cx;
    this.cz = cz;
    this.data = data;
    this.dirty = true; // needs (re)meshing
    this.mesh = null; // owned by the renderer
  }
}

export class World {
  constructor(seed, edits = {}) {
    this.seed = seed >>> 0;
    this.gen = new WorldGen(this.seed);
    this.chunks = new Map();
    // player modifications, kept so unloaded chunks can be regenerated: key -> Map(index -> id)
    this.edits = new Map(Object.entries(edits).map(([k, list]) => [k, new Map(list)]));
    this.onChunkDirty = null;
  }

  getChunk(cx, cz) {
    return this.chunks.get(chunkKey(cx, cz));
  }

  ensureChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    let c = this.chunks.get(key);
    if (!c) {
      const data = this.gen.generateChunk(cx, cz);
      const e = this.edits.get(key);
      if (e) for (const [i, id] of e) data[i] = id;
      c = new Chunk(cx, cz, data);
      this.chunks.set(key, c);
      // neighbours may have meshed faces against "unknown" space; remesh them
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = this.getChunk(cx + dx, cz + dz);
        if (n) n.dirty = true;
      }
    }
    return c;
  }

  unloadChunk(cx, cz) {
    this.chunks.delete(chunkKey(cx, cz));
  }

  getBlock(x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (y >= WH) return B.AIR;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c) return B.AIR;
    return c.data[idx(x - cx * CS, y, z - cz * CS)];
  }

  setBlock(x, y, z, id) {
    if (y < 0 || y >= WH) return false;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const key = chunkKey(cx, cz);
    const c = this.chunks.get(key);
    if (!c) return false;
    const lx = x - cx * CS, lz = z - cz * CS;
    const i = idx(lx, y, lz);
    c.data[i] = id;
    c.dirty = true;
    if (!this.edits.has(key)) this.edits.set(key, new Map());
    this.edits.get(key).set(i, id);
    // border blocks affect the neighbouring chunk's faces / AO
    const mark = (dx, dz) => {
      const n = this.getChunk(cx + dx, cz + dz);
      if (n) n.dirty = true;
    };
    if (lx === 0) mark(-1, 0);
    if (lx === CS - 1) mark(1, 0);
    if (lz === 0) mark(0, -1);
    if (lz === CS - 1) mark(0, 1);
    if (lx === 0 && lz === 0) mark(-1, -1);
    if (lx === CS - 1 && lz === 0) mark(1, -1);
    if (lx === 0 && lz === CS - 1) mark(-1, 1);
    if (lx === CS - 1 && lz === CS - 1) mark(1, 1);
    return true;
  }

  // Highest non-air, non-water block in a column (for spawning / tests).
  surfaceY(x, z) {
    for (let y = WH - 1; y >= 0; y--) {
      const id = this.getBlock(x, y, z);
      if (id !== B.AIR && id !== B.WATER) return y;
    }
    return 0;
  }

  serializeEdits() {
    const out = {};
    for (const [k, m] of this.edits) out[k] = [...m];
    return out;
  }
}
