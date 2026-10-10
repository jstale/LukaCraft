// Voxel raycasting and the player's movement/collision. Pure logic (no DOM / three.js).
import { B, BLOCKS } from './blocks.js';

// Amanatides & Woo voxel traversal. Returns the first targetable block hit or null.
// Result: { x, y, z, id, normal: [nx, ny, nz], dist }
export function raycast(world, origin, dir, maxDist = 5) {
  let x = Math.floor(origin[0]), y = Math.floor(origin[1]), z = Math.floor(origin[2]);
  const [dx, dy, dz] = dir;
  const stepX = Math.sign(dx), stepY = Math.sign(dy), stepZ = Math.sign(dz);
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  const frac = (v, s) => (s > 0 ? Math.floor(v) + 1 - v : v - Math.floor(v));
  let tMaxX = dx !== 0 ? frac(origin[0], stepX) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? frac(origin[1], stepY) * tDeltaY : Infinity;
  let tMaxZ = dz !== 0 ? frac(origin[2], stepZ) * tDeltaZ : Infinity;
  let normal = [0, 0, 0];
  let t = 0;
  while (t <= maxDist) {
    const id = world.getBlock(x, y, z);
    if (id !== B.AIR && !BLOCKS[id].liquid) return { x, y, z, id, normal, dist: t };
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      normal = [-stepX, 0, 0];
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      normal = [0, -stepY, 0];
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      normal = [0, 0, -stepZ];
    }
  }
  return null;
}

export const PLAYER = { halfWidth: 0.3, height: 1.8, eye: 1.62 };
const GRAVITY = 28;
const JUMP_V = 8.6;
const WALK = 4.4;
const SPRINT = 6.2;
const FLY = 11;
const EPS = 1e-4;

export class Player {
  constructor(pos) {
    this.pos = [...pos]; // feet position (centre of the bottom face)
    this.vel = [0, 0, 0];
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.inWater = false;
    this.headInWater = false;
    this.fly = false;
  }

  get eye() {
    return [this.pos[0], this.pos[1] + PLAYER.eye, this.pos[2]];
  }

  // Unit look direction (yaw 0 looks toward -Z, like three.js cameras).
  get look() {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }

  aabb(p = this.pos) {
    const w = PLAYER.halfWidth;
    return [p[0] - w, p[1], p[2] - w, p[0] + w, p[1] + PLAYER.height, p[2] + w];
  }

  // Does the player's box intersect block cell (x, y, z)?
  intersectsBlock(x, y, z) {
    const [a, b, c, d, e, f] = this.aabb();
    return a < x + 1 && d > x && b < y + 1 && e > y && c < z + 1 && f > z;
  }

  collides(world) {
    const [a, b, c, d, e, f] = this.aabb();
    for (let x = Math.floor(a); x <= Math.floor(d - EPS); x++)
      for (let y = Math.floor(b); y <= Math.floor(e - EPS); y++)
        for (let z = Math.floor(c); z <= Math.floor(f - EPS); z++) if (BLOCKS[world.getBlock(x, y, z)].solid) return true;
    return false;
  }

  // Move along one axis and resolve collisions exactly. Returns true if blocked.
  moveAxis(world, axis, d) {
    if (d === 0) return false;
    this.pos[axis] += d;
    if (!this.collides(world)) return false;
    const box = this.aabb();
    const lo = axis === 1 ? 0 : -PLAYER.halfWidth;
    const hi = axis === 1 ? PLAYER.height : PLAYER.halfWidth;
    const minA = box[axis], maxA = box[axis + 3];
    if (d > 0) this.pos[axis] = Math.floor(maxA - EPS) - hi - EPS;
    else this.pos[axis] = Math.floor(minA) + 1 - lo + EPS;
    return true;
  }

  // input: { forward, back, left, right, jump, sprint, down }
  update(dt, input, world) {
    const feet = world.getBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1] + 0.1), Math.floor(this.pos[2]));
    const body = world.getBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1] + 0.9), Math.floor(this.pos[2]));
    const head = world.getBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1] + PLAYER.eye), Math.floor(this.pos[2]));
    this.inWater = feet === B.WATER || body === B.WATER;
    this.headInWater = head === B.WATER;

    // horizontal wish direction
    let fx = 0, fz = 0;
    if (input.forward) fz -= 1;
    if (input.back) fz += 1;
    if (input.left) fx -= 1;
    if (input.right) fx += 1;
    const len = Math.hypot(fx, fz) || 1;
    fx /= len;
    fz /= len;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = fx * cos + fz * sin;
    const wz = -fx * sin + fz * cos;

    let speed = this.fly ? FLY : input.sprint ? SPRINT : WALK;
    if (this.inWater && !this.fly) speed *= 0.55;

    // accelerate toward the wish velocity (snappier on the ground)
    const accel = this.fly ? 10 : this.onGround ? 18 : this.inWater ? 6 : 5;
    const k = Math.min(1, accel * dt);
    this.vel[0] += (wx * speed - this.vel[0]) * k;
    this.vel[2] += (wz * speed - this.vel[2]) * k;

    if (this.fly) {
      const vy = (input.jump ? 1 : 0) - (input.down ? 1 : 0);
      this.vel[1] += (vy * FLY - this.vel[1]) * Math.min(1, 10 * dt);
    } else if (this.inWater) {
      this.vel[1] -= GRAVITY * 0.2 * dt;
      if (input.jump) this.vel[1] = Math.min(this.vel[1] + 30 * dt, 3.2);
      this.vel[1] = Math.max(this.vel[1], -3);
    } else {
      this.vel[1] -= GRAVITY * dt;
      this.vel[1] = Math.max(this.vel[1], -50);
      if (input.jump && this.onGround) this.vel[1] = JUMP_V;
    }

    // integrate in sub-steps so we never move more than ~0.4 blocks per axis at once
    const steps = Math.max(1, Math.ceil((Math.max(Math.abs(this.vel[0]), Math.abs(this.vel[1]), Math.abs(this.vel[2])) * dt) / 0.4));
    const h = dt / steps;
    this.onGround = false;
    let blockedH = false;
    for (let s = 0; s < steps; s++) {
      if (this.moveAxis(world, 1, this.vel[1] * h)) {
        if (this.vel[1] < 0) this.onGround = true;
        this.vel[1] = 0;
      }
      if (this.moveAxis(world, 0, this.vel[0] * h)) { this.vel[0] = 0; blockedH = true; }
      if (this.moveAxis(world, 2, this.vel[2] * h)) { this.vel[2] = 0; blockedH = true; }
    }
    // jumping out of water onto a ledge
    if (this.inWater && !this.fly && input.jump && blockedH)
      this.vel[1] = Math.max(this.vel[1], 5);
  }
}
