// DOM HUD: hotbar, inventory screen with crafting list, toasts, debug text.
import { getItem } from './blocks.js';
import { RECIPES, HOTBAR_SIZE, INVENTORY_SIZE } from './inventory.js';

const $ = (sel) => document.querySelector(sel);

export class UI {
  constructor(game, icons) {
    this.game = game;
    this.icons = icons;
    this.cursor = null; // stack held by the mouse in the inventory screen
    this.open = false;

    this.hotbar = $('#hotbar');
    for (let i = 0; i < HOTBAR_SIZE; i++) this.hotbar.appendChild(this.makeSlot());
    this.invGrid = $('#inv-grid');
    this.invHotbar = $('#inv-hotbar');
    this.invSlots = [];
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const el = this.makeSlot();
      el.dataset.index = i;
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.cursor = this.game.inventory.clickSlot(i, this.cursor);
        this.renderCursor(e);
      });
      el.addEventListener('mouseenter', () => this.showTooltip(this.game.inventory.slots[i]));
      el.addEventListener('mouseleave', () => this.showTooltip(null));
      (i < HOTBAR_SIZE ? this.invHotbar : this.invGrid).appendChild(el);
      this.invSlots[i] = el;
    }
    this.recipes = $('#recipes');
    document.addEventListener('mousemove', (e) => {
      if (!this.open) return;
      const c = $('#cursor-item');
      c.style.left = `${e.clientX}px`;
      c.style.top = `${e.clientY}px`;
      const t = $('#tooltip');
      t.style.left = `${e.clientX + 14}px`;
      t.style.top = `${e.clientY + 14}px`;
    });
  }

  makeSlot() {
    const el = document.createElement('div');
    el.className = 'slot';
    el.innerHTML = '<img draggable="false" alt=""><span class="count"></span><div class="dur"><div></div></div>';
    return el;
  }

  fillSlot(el, stack) {
    const img = el.querySelector('img');
    const count = el.querySelector('.count');
    const dur = el.querySelector('.dur');
    if (!stack) {
      img.style.visibility = 'hidden';
      count.textContent = '';
      dur.style.display = 'none';
      el.title = '';
      return;
    }
    const item = getItem(stack.id);
    const src = this.icons.get(stack.id);
    if (img.getAttribute('src') !== src) img.src = src;
    img.style.visibility = 'visible';
    count.textContent = stack.count > 1 ? stack.count : '';
    if (item.tool && stack.dur < item.tool.durability) {
      const f = stack.dur / item.tool.durability;
      dur.style.display = 'block';
      dur.firstChild.style.width = `${f * 100}%`;
      dur.firstChild.style.background = `hsl(${f * 120}, 90%, 45%)`;
    } else dur.style.display = 'none';
  }

  renderHotbar() {
    const inv = this.game.inventory;
    [...this.hotbar.children].forEach((el, i) => {
      this.fillSlot(el, inv.slots[i]);
      el.classList.toggle('selected', i === inv.selected);
    });
  }

  render() {
    this.renderHotbar();
    if (this.open) this.renderInventory();
  }

  showItemName() {
    const s = this.game.inventory.held;
    const el = $('#item-name');
    el.textContent = s ? getItem(s.id).name : '';
    el.classList.remove('fade');
    void el.offsetWidth; // restart the CSS animation
    el.classList.add('fade');
  }

  toggleInventory(force) {
    this.open = force ?? !this.open;
    $('#inventory').classList.toggle('hidden', !this.open);
    if (this.open) {
      this.nearTable = this.game.nearCraftingTable();
      this.renderInventory();
    } else {
      if (this.cursor) {
        this.game.inventory.add(this.cursor.id, this.cursor.count);
        this.cursor = null;
      }
      this.renderCursor();
      this.showTooltip(null);
    }
  }

  renderInventory() {
    const inv = this.game.inventory;
    this.invSlots.forEach((el, i) => this.fillSlot(el, inv.slots[i]));
    $('#table-status').textContent = this.nearTable ? '(crafting table nearby)' : '(no crafting table nearby)';
    $('#table-status').className = this.nearTable ? 'ok' : 'warn';
    this.recipes.innerHTML = '';
    RECIPES.forEach((r, ri) => {
      const can = inv.canCraft(r, this.nearTable);
      const row = document.createElement('div');
      row.className = 'recipe' + (can ? ' can' : '');
      row.dataset.recipe = ri;
      const out = getItem(r.out[0]);
      const ing = r.in
        .map(([id, n]) => {
          const have = inv.count(id);
          return `<span class="ing ${have >= n ? 'have' : 'miss'}" title="${getItem(id).name}"><img src="${this.icons.get(id)}" alt="">${n}</span>`;
        })
        .join('');
      row.innerHTML =
        `<img class="out" src="${this.icons.get(r.out[0])}" alt=""><div class="info"><div class="name">${out.name}${r.out[1] > 1 ? ` x${r.out[1]}` : ''}</div>` +
        `<div class="ings">${ing}${r.table ? `<span class="tag ${this.nearTable ? '' : 'miss'}">table</span>` : ''}</div></div>`;
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const times = e.shiftKey ? 16 : 1;
        let n = 0;
        while (n < times && inv.craft(r, this.nearTable)) n++;
        if (n) this.toast(`Crafted ${out.name}${n * r.out[1] > 1 ? ` x${n * r.out[1]}` : ''}`);
        else if (r.table && !this.nearTable) this.toast('You need to be near a Crafting Table');
        else this.toast('Missing ingredients');
      });
      this.recipes.appendChild(row);
    });
  }

  renderCursor() {
    const c = $('#cursor-item');
    if (this.cursor) {
      c.style.display = 'block';
      this.fillSlot(c, this.cursor);
    } else c.style.display = 'none';
  }

  showTooltip(stack) {
    const t = $('#tooltip');
    if (!stack || this.cursor) {
      t.style.display = 'none';
      return;
    }
    const item = getItem(stack.id);
    t.style.display = 'block';
    t.textContent = item.tool ? `${item.name} (${stack.dur}/${item.tool.durability})` : item.name;
  }

  toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  setDebug(text) {
    $('#debug').textContent = text;
  }
}
