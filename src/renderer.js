// three.js scene: chunk meshes, sky/fog, clouds, block highlight and crack overlay.
import * as THREE from 'three';
import { buildChunkGeometry } from './mesher.js';
import { CS } from './worldgen.js';

const SKY = new THREE.Color(0x9cc8ff);
const WATER_FOG = new THREE.Color(0x1f4f9a);

export class Renderer {
  constructor(canvas, tex) {
    this.tex = tex;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.background = SKY.clone();
    this.scene.fog = new THREE.Fog(SKY.clone(), 50, 100);
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 1000);
    this.camera.rotation.order = 'YXZ';

    this.solidMat = new THREE.MeshBasicMaterial({ map: tex.atlas.texture, vertexColors: true, alphaTest: 0.5 });
    this.waterMat = new THREE.MeshBasicMaterial({
      map: tex.atlas.texture,
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // block highlight
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    this.highlight = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 }));
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    // crack overlay
    this.crackMat = new THREE.MeshBasicMaterial({
      map: tex.destroy[0],
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.002, 1.002, 1.002), this.crackMat);
    this.crack.visible = false;
    this.scene.add(this.crack);

    // clouds: a big textured plane that follows the player and drifts
    tex.clouds.wrapS = tex.clouds.wrapT = THREE.RepeatWrapping;
    tex.clouds.repeat.set(8, 8);
    this.clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(4096, 4096),
      new THREE.MeshBasicMaterial({ map: tex.clouds, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    );
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.position.y = 118;
    this.scene.add(this.clouds);

    this.meshes = new Map(); // chunk key -> { solid, water }
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.gl.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setRenderDistance(chunks) {
    this.viewDist = chunks * CS;
  }

  meshChunk(world, chunk) {
    const geo = buildChunkGeometry(world, chunk, this.tex.atlas);
    this.removeChunk(chunk);
    const make = (g, mat) => {
      if (g.indices.length === 0) return null;
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
      bg.setAttribute('uv', new THREE.BufferAttribute(g.uvs, 2));
      bg.setAttribute('color', new THREE.BufferAttribute(g.colors, 3));
      bg.setIndex(new THREE.BufferAttribute(g.indices, 1));
      bg.computeBoundingSphere();
      const m = new THREE.Mesh(bg, mat);
      m.position.set(chunk.cx * CS, 0, chunk.cz * CS);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      this.scene.add(m);
      return m;
    };
    const entry = { solid: make(geo.solid, this.solidMat), water: make(geo.water, this.waterMat) };
    if (entry.water) entry.water.renderOrder = 1;
    chunk.mesh = entry;
    chunk.dirty = false;
  }

  removeChunk(chunk) {
    if (!chunk.mesh) return;
    for (const m of [chunk.mesh.solid, chunk.mesh.water])
      if (m) {
        this.scene.remove(m);
        m.geometry.dispose();
      }
    chunk.mesh = null;
  }

  setTarget(hit, crackStage) {
    if (!hit) {
      this.highlight.visible = false;
      this.crack.visible = false;
      return;
    }
    this.highlight.visible = true;
    this.highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    if (crackStage >= 0) {
      this.crack.visible = true;
      this.crack.position.copy(this.highlight.position);
      this.crackMat.map = this.tex.destroy[Math.min(7, crackStage)];
    } else this.crack.visible = false;
  }

  render(player, underwater, time) {
    const eye = player.eye;
    this.camera.position.set(eye[0], eye[1], eye[2]);
    this.camera.rotation.set(player.pitch, player.yaw, 0);
    const far = this.viewDist || 96;
    if (underwater) {
      this.scene.fog.color.copy(WATER_FOG);
      this.scene.background.copy(WATER_FOG);
      this.scene.fog.near = 2;
      this.scene.fog.far = 28;
    } else {
      this.scene.fog.color.copy(SKY);
      this.scene.background.copy(SKY);
      this.scene.fog.near = far * 0.55;
      this.scene.fog.far = far - 4;
    }
    this.clouds.position.x = eye[0];
    this.clouds.position.z = eye[2];
    // keep the texture fixed in world space while the plane follows the player, plus a slow drift
    this.tex.clouds.offset.set((eye[0] + time * 1.5) / 512, -eye[2] / 512);
    this.camera.far = far + 400;
    this.camera.updateProjectionMatrix();
    this.gl.render(this.scene, this.camera);
  }
}
