// Builds chunk geometry buffers (positions/uvs/colors/indices) with face culling,
// per-vertex ambient occlusion and a simple heightmap "sky light". Pure JS, no three.js.
import { BLOCKS, B } from './blocks.js';
import { CS, WH } from './worldgen.js';

const P = CS + 2; // padded size
const pidx = (x, y, z) => x + 1 + (z + 1) * P + y * P * P;

const OPAQUE = new Uint8Array(256);
const LIQUID = new Uint8Array(256);
const LEAVES = new Uint8Array(256);
const GLASS = new Uint8Array(256);
for (const b of BLOCKS) {
  if (!b) continue;
  OPAQUE[b.id] = b.solid && !b.transparent ? 1 : 0;
  LIQUID[b.id] = b.liquid ? 1 : 0;
  LEAVES[b.id] = b.leaves ? 1 : 0;
  GLASS[b.id] = b.glass ? 1 : 0;
}

// Face corner layout: triangles (0,1,2) and (2,1,3), counter-clockwise from outside.
const FACES = [
  { dir: [-1, 0, 0], shade: 0.8, corners: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
  { dir: [1, 0, 0], shade: 0.8, corners: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
  { dir: [0, -1, 0], shade: 0.5, corners: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { dir: [0, 1, 0], shade: 1.0, corners: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
  { dir: [0, 0, -1], shade: 0.65, corners: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
  { dir: [0, 0, 1], shade: 0.65, corners: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
];
const AO_LEVELS = [0.45, 0.62, 0.8, 1.0];
const SHADOW = 0.5;

class Buf {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.col = [];
    this.ind = [];
    this.n = 0;
  }
  finish() {
    return {
      positions: new Float32Array(this.pos),
      uvs: new Float32Array(this.uv),
      colors: new Float32Array(this.col),
      indices: this.n > 65535 ? new Uint32Array(this.ind) : new Uint16Array(this.ind),
    };
  }
}

// atlas: { uv(name) -> [u0, v0, u1, v1] }
export function buildChunkGeometry(world, chunk, atlas) {
  // 1. copy this chunk + a 1-block border from neighbours into a padded array
  const pad = new Uint8Array(P * P * WH);
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const c = dx === 0 && dz === 0 ? chunk : world.getChunk(chunk.cx + dx, chunk.cz + dz);
      if (!c) continue;
      const xs = dx === -1 ? CS - 1 : 0, xe = dx === 1 ? 0 : CS - 1;
      const zs = dz === -1 ? CS - 1 : 0, ze = dz === 1 ? 0 : CS - 1;
      const d = c.data;
      for (let y = 0; y < WH; y++)
        for (let z = zs; z <= ze; z++) {
          const pz = z + dz * CS;
          for (let x = xs; x <= xe; x++) pad[pidx(x + dx * CS, y, pz)] = d[x + z * CS + y * CS * CS];
        }
    }
  const get = (x, y, z) => (y < 0 ? B.BEDROCK : y >= WH ? B.AIR : pad[pidx(x, y, z)]);

  // 2. heightmap of the highest opaque block per padded column (for sky shadows)
  const top = new Int16Array(P * P).fill(-1);
  for (let z = -1; z <= CS; z++)
    for (let x = -1; x <= CS; x++)
      for (let y = WH - 1; y >= 0; y--)
        if (OPAQUE[pad[pidx(x, y, z)]]) {
          top[x + 1 + (z + 1) * P] = y;
          break;
        }

  const solid = new Buf();
  const water = new Buf();
  const ao = [0, 0, 0, 0];

  for (let y = 0; y < WH; y++)
    for (let z = 0; z < CS; z++)
      for (let x = 0; x < CS; x++) {
        const id = pad[pidx(x, y, z)];
        if (id === B.AIR) continue;
        const def = BLOCKS[id];
        const liquid = LIQUID[id];
        const waterTop = liquid && get(x, y + 1, z) !== B.WATER ? 0.875 : 1;
        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const [nx, ny, nz] = face.dir;
          const n = get(x + nx, y + ny, z + nz);
          if (y + ny < 0) continue;
          if (liquid) {
            if (n === B.WATER || OPAQUE[n]) continue;
          } else if (OPAQUE[n] || (GLASS[id] && n === id)) continue;

          const buf = liquid ? water : solid;
          const texName = ny === 1 ? def.tex.top : ny === -1 ? def.tex.bottom : def.tex.side;
          const [u0, v0, u1, v1] = atlas.uv(texName);
          const fx = x + nx, fy = y + ny, fz = z + nz;
          const lit = fy > top[fx + 1 + (fz + 1) * P] ? 1 : SHADOW;
          const light = face.shade * lit;

          for (let k = 0; k < 4; k++) {
            const c = face.corners[k];
            if (liquid) ao[k] = 3;
            else {
              // the two side neighbours and the diagonal neighbour in the face's front layer
              const ox = nx === 0 ? (c[0] ? 1 : -1) : 0;
              const oy = ny === 0 ? (c[1] ? 1 : -1) : 0;
              const oz = nz === 0 ? (c[2] ? 1 : -1) : 0;
              let s1, s2, cc;
              if (nx !== 0) {
                s1 = OPAQUE[get(fx, fy + oy, fz)];
                s2 = OPAQUE[get(fx, fy, fz + oz)];
                cc = OPAQUE[get(fx, fy + oy, fz + oz)];
              } else if (ny !== 0) {
                s1 = OPAQUE[get(fx + ox, fy, fz)];
                s2 = OPAQUE[get(fx, fy, fz + oz)];
                cc = OPAQUE[get(fx + ox, fy, fz + oz)];
              } else {
                s1 = OPAQUE[get(fx + ox, fy, fz)];
                s2 = OPAQUE[get(fx, fy + oy, fz)];
                cc = OPAQUE[get(fx + ox, fy + oy, fz)];
              }
              ao[k] = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
            }
            const vy = c[1] === 1 ? waterTop : 0;
            buf.pos.push(x + c[0], y + vy, z + c[2]);
            buf.uv.push(u0 + (u1 - u0) * c[3], v0 + (v1 - v0) * c[4]);
            const b = light * AO_LEVELS[ao[k]];
            buf.col.push(b, b, b);
          }
          const i = buf.n;
          if (ao[0] + ao[3] > ao[1] + ao[2]) buf.ind.push(i, i + 1, i + 3, i, i + 3, i + 2);
          else buf.ind.push(i, i + 1, i + 2, i + 2, i + 1, i + 3);
          buf.n += 4;
        }
      }
  return { solid: solid.finish(), water: water.finish() };
}
