// Inventory slots and crafting recipes. Pure logic, shared by the game and tests.
import { B, I, getItem, toolId } from './blocks.js';

export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36; // slots 0-8 are the hotbar

const tool = (mat, type, material, count) => ({
  out: [toolId(mat, type), 1],
  in: [[material, count], [I.STICK, 2]],
  table: true,
});

export const RECIPES = [
  { out: [B.PLANKS, 4], in: [[B.OAK_LOG, 1]] },
  { out: [B.PLANKS, 4], in: [[B.BIRCH_LOG, 1]] },
  { out: [I.STICK, 4], in: [[B.PLANKS, 2]] },
  { out: [B.CRAFTING_TABLE, 1], in: [[B.PLANKS, 4]] },
  tool('wood', 'pickaxe', B.PLANKS, 3),
  tool('wood', 'axe', B.PLANKS, 3),
  tool('wood', 'shovel', B.PLANKS, 1),
  tool('stone', 'pickaxe', B.COBBLESTONE, 3),
  tool('stone', 'axe', B.COBBLESTONE, 3),
  tool('stone', 'shovel', B.COBBLESTONE, 1),
  { out: [I.COPPER_INGOT, 1], in: [[I.RAW_COPPER, 1], [I.COAL, 1]], table: true },
  { out: [I.IRON_INGOT, 1], in: [[I.RAW_IRON, 1], [I.COAL, 1]], table: true },
  { out: [I.GOLD_INGOT, 1], in: [[I.RAW_GOLD, 1], [I.COAL, 1]], table: true },
  tool('copper', 'pickaxe', I.COPPER_INGOT, 3),
  tool('copper', 'axe', I.COPPER_INGOT, 3),
  tool('copper', 'shovel', I.COPPER_INGOT, 1),
  tool('iron', 'pickaxe', I.IRON_INGOT, 3),
  tool('iron', 'axe', I.IRON_INGOT, 3),
  tool('iron', 'shovel', I.IRON_INGOT, 1),
  tool('gold', 'pickaxe', I.GOLD_INGOT, 3),
  tool('gold', 'axe', I.GOLD_INGOT, 3),
  tool('gold', 'shovel', I.GOLD_INGOT, 1),
  { out: [B.STONE_BRICKS, 4], in: [[B.COBBLESTONE, 4]], table: true },
  { out: [B.GLASS, 4], in: [[B.SAND, 4], [I.COAL, 1]], table: true },
];

export class Inventory {
  constructor(slots) {
    this.slots = slots ? slots.map((s) => (s ? { ...s } : null)) : new Array(INVENTORY_SIZE).fill(null);
    this.selected = 0;
    this.onChange = null;
  }

  changed() {
    this.onChange?.();
  }

  get held() {
    return this.slots[this.selected];
  }

  newStack(id, count) {
    const item = getItem(id);
    const s = { id, count };
    if (item.tool) s.dur = item.tool.durability;
    return s;
  }

  // Adds items, filling existing stacks first (hotbar first). Returns the count that didn't fit.
  add(id, count = 1) {
    const max = getItem(id).stack;
    for (let i = 0; i < this.slots.length && count > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < max) {
        const n = Math.min(count, max - s.count);
        s.count += n;
        count -= n;
      }
    }
    for (let i = 0; i < this.slots.length && count > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(count, max);
        this.slots[i] = this.newStack(id, n);
        count -= n;
      }
    }
    this.changed();
    return count;
  }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  remove(id, count) {
    if (this.count(id) < count) return false;
    // take from the main inventory before the hotbar
    const order = [...this.slots.keys()].reverse();
    for (const i of order) {
      const s = this.slots[i];
      if (!s || s.id !== id || count <= 0) continue;
      const n = Math.min(count, s.count);
      s.count -= n;
      count -= n;
      if (s.count === 0) this.slots[i] = null;
    }
    this.changed();
    return true;
  }

  // Consume one item from the selected hotbar slot (block placement).
  consumeHeld() {
    const s = this.held;
    if (!s) return;
    s.count--;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.changed();
  }

  // Damage the held tool by one use. Returns true if it broke.
  damageHeld() {
    const s = this.held;
    if (!s || s.dur === undefined) return false;
    s.dur--;
    const broke = s.dur <= 0;
    if (broke) this.slots[this.selected] = null;
    this.changed();
    return broke;
  }

  canCraft(recipe, nearTable) {
    if (recipe.table && !nearTable) return false;
    return recipe.in.every(([id, n]) => this.count(id) >= n);
  }

  craft(recipe, nearTable) {
    if (!this.canCraft(recipe, nearTable)) return false;
    // make sure the output fits: simulate on a copy
    const sim = new Inventory(this.slots);
    for (const [id, n] of recipe.in) sim.remove(id, n);
    if (sim.add(recipe.out[0], recipe.out[1]) > 0) return false;
    this.slots = sim.slots;
    this.changed();
    return true;
  }

  // Click-to-move: swap / merge the cursor stack with slot i. Returns the new cursor stack.
  clickSlot(i, cursor) {
    const s = this.slots[i];
    if (cursor && s && cursor.id === s.id && s.dur === undefined) {
      const max = getItem(s.id).stack;
      const n = Math.min(cursor.count, max - s.count);
      s.count += n;
      cursor = cursor.count - n > 0 ? { ...cursor, count: cursor.count - n } : null;
    } else {
      this.slots[i] = cursor;
      cursor = s;
    }
    this.changed();
    return cursor;
  }

  toJSON() {
    return this.slots;
  }
}
