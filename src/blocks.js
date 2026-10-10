// Block and item registry. Pure data + helpers (no DOM / three.js), shared by game and tests.

export const B = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  COBBLESTONE: 4,
  SAND: 5,
  WATER: 6,
  OAK_LOG: 7,
  OAK_LEAVES: 8,
  BIRCH_LOG: 9,
  BIRCH_LEAVES: 10,
  PLANKS: 11,
  COAL_ORE: 12,
  COPPER_ORE: 13,
  IRON_ORE: 14,
  GOLD_ORE: 15,
  BEDROCK: 16,
  SNOW: 17,
  CACTUS: 18,
  CRAFTING_TABLE: 19,
  GLASS: 20,
  STONE_BRICKS: 21,
  GRAVEL: 22,
};

export const I = {
  STICK: 100,
  COAL: 101,
  RAW_COPPER: 102,
  RAW_IRON: 103,
  RAW_GOLD: 104,
  COPPER_INGOT: 105,
  IRON_INGOT: 106,
  GOLD_INGOT: 107,
  // tools: 120 + materialIndex * 3 + typeIndex
};

export const TOOL_MATERIALS = [
  { key: 'wood', name: 'Wooden', tier: 1, speed: 2, durability: 60 },
  { key: 'stone', name: 'Stone', tier: 2, speed: 4, durability: 132 },
  { key: 'copper', name: 'Copper', tier: 3, speed: 5, durability: 200 },
  { key: 'iron', name: 'Iron', tier: 4, speed: 6, durability: 250 },
  { key: 'gold', name: 'Golden', tier: 5, speed: 9, durability: 400 },
];
export const TOOL_TYPES = ['pickaxe', 'axe', 'shovel'];
export const toolId = (materialKey, type) =>
  120 + TOOL_MATERIALS.findIndex((m) => m.key === materialKey) * 3 + TOOL_TYPES.indexOf(type);

// tex: texture names from textures/blocks (all = same on every face)
const blockDefs = [
  { id: B.AIR, key: 'air', name: 'Air', solid: false, transparent: true, hardness: 0 },
  { id: B.GRASS, key: 'grass', name: 'Grass Block', tex: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' }, hardness: 0.6, tool: 'shovel', drops: [[B.DIRT, 1]] },
  { id: B.DIRT, key: 'dirt', name: 'Dirt', tex: { all: 'dirt' }, hardness: 0.5, tool: 'shovel' },
  { id: B.STONE, key: 'stone', name: 'Stone', tex: { all: 'stone' }, hardness: 1.5, tool: 'pickaxe', tier: 1, drops: [[B.COBBLESTONE, 1]] },
  { id: B.COBBLESTONE, key: 'cobblestone', name: 'Cobblestone', tex: { all: 'cobblestone' }, hardness: 2, tool: 'pickaxe', tier: 1 },
  { id: B.SAND, key: 'sand', name: 'Sand', tex: { all: 'sand' }, hardness: 0.5, tool: 'shovel' },
  { id: B.WATER, key: 'water', name: 'Water', tex: { all: 'water' }, hardness: -1, solid: false, transparent: true, liquid: true, placeable: false },
  { id: B.OAK_LOG, key: 'oak_log', name: 'Oak Log', tex: { top: 'oak_log_top', bottom: 'oak_log_top', side: 'oak_log' }, hardness: 2, tool: 'axe' },
  { id: B.OAK_LEAVES, key: 'oak_leaves', name: 'Oak Leaves', tex: { all: 'oak_leaves' }, hardness: 0.2, transparent: true, leaves: true, drops: [[I.STICK, 1, 0.12]] },
  { id: B.BIRCH_LOG, key: 'birch_log', name: 'Birch Log', tex: { top: 'birch_log_top', bottom: 'birch_log_top', side: 'birch_log' }, hardness: 2, tool: 'axe' },
  { id: B.BIRCH_LEAVES, key: 'birch_leaves', name: 'Birch Leaves', tex: { all: 'birch_leaves' }, hardness: 0.2, transparent: true, leaves: true, drops: [[I.STICK, 1, 0.12]] },
  { id: B.PLANKS, key: 'planks', name: 'Planks', tex: { all: 'planks' }, hardness: 2, tool: 'axe' },
  { id: B.COAL_ORE, key: 'coal_ore', name: 'Coal Ore', tex: { all: 'coal_ore' }, hardness: 3, tool: 'pickaxe', tier: 1, drops: [[I.COAL, 1]] },
  { id: B.COPPER_ORE, key: 'copper_ore', name: 'Copper Ore', tex: { all: 'copper_ore' }, hardness: 3, tool: 'pickaxe', tier: 2, drops: [[I.RAW_COPPER, 1]] },
  { id: B.IRON_ORE, key: 'iron_ore', name: 'Iron Ore', tex: { all: 'iron_ore' }, hardness: 3, tool: 'pickaxe', tier: 3, drops: [[I.RAW_IRON, 1]] },
  { id: B.GOLD_ORE, key: 'gold_ore', name: 'Gold Ore', tex: { all: 'gold_ore' }, hardness: 3, tool: 'pickaxe', tier: 4, drops: [[I.RAW_GOLD, 1]] },
  { id: B.BEDROCK, key: 'bedrock', name: 'Bedrock', tex: { all: 'bedrock' }, hardness: -1, placeable: false },
  { id: B.SNOW, key: 'snow', name: 'Snow', tex: { all: 'snow' }, hardness: 0.3, tool: 'shovel' },
  { id: B.CACTUS, key: 'cactus', name: 'Cactus', tex: { top: 'cactus_top', bottom: 'cactus_top', side: 'cactus_side' }, hardness: 0.4 },
  { id: B.CRAFTING_TABLE, key: 'crafting_table', name: 'Crafting Table', tex: { top: 'crafting_table_top', bottom: 'planks', side: 'crafting_table_side' }, hardness: 2.5, tool: 'axe' },
  { id: B.GLASS, key: 'glass', name: 'Glass', tex: { all: 'glass' }, hardness: 0.3, transparent: true, glass: true, drops: [] },
  { id: B.STONE_BRICKS, key: 'stone_bricks', name: 'Stone Bricks', tex: { all: 'stone_bricks' }, hardness: 1.5, tool: 'pickaxe', tier: 1 },
  { id: B.GRAVEL, key: 'gravel', name: 'Gravel', tex: { all: 'gravel' }, hardness: 0.6, tool: 'shovel' },
];

export const BLOCKS = [];
for (const d of blockDefs) {
  const def = {
    solid: true,
    transparent: false,
    liquid: false,
    leaves: false,
    glass: false,
    placeable: true,
    tool: null,
    tier: 0,
    isBlock: true,
    stack: 64,
    ...d,
  };
  if (!def.drops) def.drops = [[def.id, 1]];
  if (def.tex?.all) def.tex = { top: def.tex.all, bottom: def.tex.all, side: def.tex.all };
  BLOCKS[def.id] = def;
}

const itemDefs = [
  { id: I.STICK, key: 'stick', name: 'Stick' },
  { id: I.COAL, key: 'coal', name: 'Coal' },
  { id: I.RAW_COPPER, key: 'raw_copper', name: 'Raw Copper' },
  { id: I.RAW_IRON, key: 'raw_iron', name: 'Raw Iron' },
  { id: I.RAW_GOLD, key: 'raw_gold', name: 'Raw Gold' },
  { id: I.COPPER_INGOT, key: 'copper_ingot', name: 'Copper Ingot' },
  { id: I.IRON_INGOT, key: 'iron_ingot', name: 'Iron Ingot' },
  { id: I.GOLD_INGOT, key: 'gold_ingot', name: 'Gold Ingot' },
];
for (const m of TOOL_MATERIALS)
  for (const t of TOOL_TYPES)
    itemDefs.push({
      id: toolId(m.key, t),
      key: `${m.key}_${t}`,
      name: `${m.name} ${t[0].toUpperCase()}${t.slice(1)}`,
      stack: 1,
      tool: { type: t, tier: m.tier, speed: m.speed, durability: m.durability, material: m.key },
    });

export const ITEMS = {};
for (const d of itemDefs) ITEMS[d.id] = { stack: 64, isBlock: false, icon: `items/${d.key}`, ...d };

export function getItem(id) {
  return id < 100 ? BLOCKS[id] : ITEMS[id];
}

export function isSolid(id) {
  return BLOCKS[id].solid;
}

// How long it takes to mine `blockId` with `toolItem` (an ITEMS def or null for hand),
// and whether the block drops anything.
export function miningInfo(blockId, toolItem) {
  const block = BLOCKS[blockId];
  if (!block || block.hardness < 0 || blockId === B.AIR) return { time: Infinity, canHarvest: false };
  const tool = toolItem?.tool || null;
  const rightTool = !!tool && tool.type === block.tool;
  const canHarvest = !block.tier || (rightTool && tool.tier >= block.tier);
  let time = block.hardness * (canHarvest ? 1.5 : 5);
  if (rightTool) time /= tool.speed;
  return { time: Math.max(0.05, time), canHarvest };
}

// Every texture name referenced by blocks, in a stable order (for the texture atlas).
export function blockTextureNames() {
  const names = new Set();
  for (const b of BLOCKS) if (b?.tex) for (const k of ['top', 'bottom', 'side']) names.add(b.tex[k]);
  return [...names];
}
