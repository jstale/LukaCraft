// Loads the generated PNG textures, packs block textures into an atlas and renders
// isometric block icons for the UI.
import * as THREE from 'three';
import { BLOCKS, ITEMS, blockTextureNames } from './blocks.js';

const TILE = 16;
const COLS = 16;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load texture ${src}`));
    img.src = src;
  });
}

export async function loadTextures() {
  const blockNames = blockTextureNames();
  const blockImgs = new Map();
  await Promise.all(blockNames.map(async (n) => blockImgs.set(n, await loadImage(`textures/blocks/${n}.png`))));

  // --- atlas
  const rows = Math.ceil(blockNames.length / COLS);
  const atlasH = Math.pow(2, Math.ceil(Math.log2(rows * TILE)));
  const canvas = document.createElement('canvas');
  canvas.width = COLS * TILE;
  canvas.height = atlasH;
  const ctx = canvas.getContext('2d');
  const tiles = new Map();
  blockNames.forEach((n, i) => {
    const col = i % COLS, row = Math.floor(i / COLS);
    ctx.drawImage(blockImgs.get(n), col * TILE, row * TILE);
    // inset by a fraction of a texel to avoid bleeding between tiles
    const e = 0.01;
    tiles.set(n, [
      (col * TILE + e) / canvas.width,
      1 - ((row + 1) * TILE - e) / canvas.height,
      ((col + 1) * TILE - e) / canvas.width,
      1 - (row * TILE + e) / canvas.height,
    ]);
  });
  const atlasTexture = new THREE.CanvasTexture(canvas);
  atlasTexture.magFilter = THREE.NearestFilter;
  atlasTexture.minFilter = THREE.NearestFilter;
  atlasTexture.generateMipmaps = false;
  atlasTexture.colorSpace = THREE.SRGBColorSpace;
  const atlas = {
    texture: atlasTexture,
    uv: (name) => tiles.get(name),
  };

  // --- misc textures (crack stages, clouds)
  const loader = new THREE.TextureLoader();
  const loadTex = (src) =>
    new Promise((resolve, reject) =>
      loader.load(
        src,
        (t) => {
          t.magFilter = THREE.NearestFilter;
          t.minFilter = THREE.NearestFilter;
          t.generateMipmaps = false;
          t.colorSpace = THREE.SRGBColorSpace;
          resolve(t);
        },
        undefined,
        reject,
      ),
    );
  const destroy = await Promise.all(Array.from({ length: 8 }, (_, i) => loadTex(`textures/misc/destroy_${i}.png`)));
  const clouds = await loadTex('textures/misc/clouds.png');

  // --- UI icons (data URLs)
  const icons = new Map();
  for (const b of BLOCKS) if (b && b.tex) icons.set(b.id, blockIcon(blockImgs.get(b.tex.top), blockImgs.get(b.tex.side)));
  for (const it of Object.values(ITEMS)) icons.set(it.id, `textures/${it.icon}.png`);

  return { atlas, destroy, clouds, icons };
}

// Draws an isometric cube from the top and side textures.
function blockIcon(top, side) {
  const S = 48;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const k = 1 / 16;
  const faces = [
    { img: top, m: [21 * k, -11 * k, 21 * k, 11 * k, 3, 13], dark: 0 },
    { img: side, m: [21 * k, 11 * k, 0, 22 * k, 3, 13], dark: 0.22 },
    { img: side, m: [21 * k, -11 * k, 0, 22 * k, 24, 24], dark: 0.4 },
  ];
  for (const f of faces) {
    g.setTransform(...f.m);
    g.globalCompositeOperation = 'source-over';
    g.drawImage(f.img, 0, 0);
    if (f.dark) {
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = `rgba(0,0,0,${f.dark})`;
      g.fillRect(0, 0, 16, 16);
    }
  }
  return c.toDataURL();
}
