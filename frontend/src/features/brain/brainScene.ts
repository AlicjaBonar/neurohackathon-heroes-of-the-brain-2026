import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Probe } from "@/api/types";
import { divergingColor } from "./colormap";

/*
 * Live fNIRS brain map. Everything is in the probe's head frame (mm): x right, y nose, z up,
 * origin = midpoint T7–T8, so the optode positions from the SNIRF files can be used as they are.
 * The brain is procedural (two hemispheres with gyri, cerebellum, brainstem); channel values are
 * spread over the cortex with Gaussian kernels around each channel's cortical point.
 */

// ------------------------------------------------------------------ noise (Perlin 3D)

const PERM = (() => {
  const p = Array.from({ length: 256 }, (_, i) => i);
  let seed = 1337;
  for (let i = 255; i > 0; i--) {
    seed = (seed * 16807) % 2147483647;
    const j = seed % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  return Uint8Array.from([...p, ...p]);
})();
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function grad(h: number, x: number, y: number, z: number) {
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}
function perlin(x: number, y: number, z: number) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = PERM[X] + Y, AA = PERM[A] + Z, AB = PERM[A + 1] + Z;
  const B = PERM[X + 1] + Y, BA = PERM[B] + Z, BB = PERM[B + 1] + Z;
  return lerp(
    lerp(lerp(grad(PERM[AA] & 15, x, y, z), grad(PERM[BA] & 15, x - 1, y, z), u),
      lerp(grad(PERM[AB] & 15, x, y - 1, z), grad(PERM[BB] & 15, x - 1, y - 1, z), u), v),
    lerp(lerp(grad(PERM[AA + 1] & 15, x, y, z - 1), grad(PERM[BA + 1] & 15, x - 1, y, z - 1), u),
      lerp(grad(PERM[AB + 1] & 15, x, y - 1, z - 1), grad(PERM[BB + 1] & 15, x - 1, y - 1, z - 1), u), v),
    w,
  );
}
/** Ridged noise in 0..1: thin valleys (sulci) between broad ridges (gyri). */
function gyri(x: number, y: number, z: number) {
  const f = 0.05;
  const n1 = 1 - Math.abs(perlin(x * f, y * f, z * f));
  const n2 = 1 - Math.abs(perlin(x * f * 2.1 + 17, y * f * 2.1, z * f * 2.1));
  return Math.pow(n1, 2.2) * 0.75 + Math.pow(n2, 2) * 0.25;
}

// ------------------------------------------------------------------ geometry

const BRAIN_BASE = new THREE.Color("#ecc9c3");
const BRAIN_SULCUS = new THREE.Color("#b98f8c");
const CEREBELLUM = new THREE.Color("#ddb3ae");

// Hemisphere = ellipsoid centred off the midline, cut by the medial plane (x = ±GAP).
const HEMI = { cx: 24, cy: -10, cz: 20, rx: 46, ryFront: 90, ryBack: 94, rzTop: 70, rzBottom: 40, gap: 1.6 };

/** Smooth max(x, 0) with rounding width k (softplus). */
const softplus = (x: number, k: number) => k * Math.log1p(Math.exp(x / k));

/** One hemisphere: rounded ellipsoid with a flat medial wall, temporal lobe and gyri. side = ±1. */
function hemisphere(side: 1 | -1) {
  // Polyhedron geometry is non-indexed; merge so normals are smooth after displacement.
  const ico = new THREE.IcosahedronGeometry(1, 64);
  ico.deleteAttribute("normal");
  ico.deleteAttribute("uv");
  const geo = mergeVertices(ico);
  ico.dispose();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const ridge = new Float32Array(pos.count);
  const v = new THREE.Vector3();
  const dir = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const ry = v.y > 0 ? HEMI.ryFront : HEMI.ryBack;
    const rz = v.z > 0 ? HEMI.rzTop : HEMI.rzBottom;
    // Narrower towards the frontal pole, slightly at the occipital pole.
    const taper = 1 - 0.22 * Math.max(0, v.y) ** 2 - 0.12 * Math.max(0, -v.y) ** 3;
    let x = v.x * HEMI.rx * taper;
    const y = v.y * ry;
    let z = v.z * rz;
    // Temporal lobe: lateral bulge low and forward; Sylvian fissure just above it.
    const lateral = Math.max(0, v.x * side);
    const tl = Math.exp(-((v.z + 0.35) ** 2) / 0.05 - ((v.y - 0.1) ** 2) / 0.18) * lateral;
    x += side * 7 * tl;
    z -= 5 * tl;
    const sylvian = Math.exp(-((v.z + 0.02 - 0.3 * v.y) ** 2) / 0.004) * lateral * (v.y > -0.4 ? 1 : 0);
    // Flattened base (orbitofrontal / temporal floor).
    if (v.z < -0.5) z = lerp(z, -HEMI.rzBottom * 0.55, (-v.z - 0.5) * 0.9);

    // Medial cut: distance from the midline never below GAP, with a rounded edge.
    const m = side * (side * HEMI.cx + x);
    const mCut = HEMI.gap + softplus(m - HEMI.gap, 3);
    const wall = Math.min(1, Math.max(0, (HEMI.gap + 5 - m) / 8));
    let px = side * mCut;
    const py = y + HEMI.cy;
    const pz = z + HEMI.cz;

    // Push the surface in along its normal: radial on the convexity, -x on the medial wall.
    dir.set(x, y, z).normalize().lerp(new THREE.Vector3(side, 0, 0), wall).normalize();
    const g = gyri(px, py, pz);
    const depth = (1 - g) * (4.2 - 2.8 * wall) + sylvian * 6;
    px -= dir.x * depth;
    pos.setXYZ(i, px, py - dir.y * depth, pz - dir.z * depth);
    ridge[i] = Math.min(1, g * (1 - 0.8 * sylvian));
  }
  geo.computeVertexNormals();
  const colors = new Float32Array(pos.count * 3);
  const base = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.copy(BRAIN_SULCUS).lerp(BRAIN_BASE, Math.pow(ridge[i], 0.7));
    base.set([c.r, c.g, c.b], i * 3);
  }
  colors.set(base);
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return { geo, base };
}

function cerebellum() {
  const geo = new THREE.SphereGeometry(1, 128, 64);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const folia = 1 - 0.035 * Math.abs(Math.sin(v.z * 22 + 2 * perlin(v.x * 3, v.y * 3, 0)));
    const notch = 1 - 0.18 * Math.exp(-(v.x * v.x) / 0.01) * Math.max(0, -v.y);
    pos.setXYZ(i, v.x * 44 * folia * notch, -72 + v.y * 24 * folia, -20 + v.z * 17 * folia);
  }
  geo.computeVertexNormals();
  return geo;
}

// ------------------------------------------------------------------ scene

export type HoverInfo = { index: number; x: number; y: number } | null;

type Kernel = { vertex: Uint32Array; channel: Uint16Array; weight: Float32Array };

const SIGMA_MM = 13;
const PAINT_EVERY_MS = 66;
/** Raycasting against ~170k triangles is slow: handle at most one pointer move per this many ms. */
const RAY_EVERY_MS = 80;

/** divergingColor sampled once, so paint() does not call it for every vertex of every frame. */
const LUT_N = 512;
const COLOR_LUT = (() => {
  const lut = new Float32Array(LUT_N * 3);
  const c = { r: 0, g: 0, b: 0 };
  for (let i = 0; i < LUT_N; i++) {
    divergingColor((i / (LUT_N - 1)) * 2 - 1, c);
    lut.set([c.r, c.g, c.b], i * 3);
  }
  return lut;
})();

export class BrainScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 1, 2000);
  private controls: OrbitControls;
  private root = new THREE.Group();
  private hemis: { mesh: THREE.Mesh; base: Float32Array; kernel: Kernel | null }[] = [];
  private headGroup = new THREE.Group();
  private markers: THREE.InstancedMesh | null = null;
  private markerChannels: number[] = [];
  private anchors: THREE.Vector3[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private frame = 0;
  private disposed = false;
  private lastInteract = -1e9;
  private resize: ResizeObserver;

  // Channel values as Float32Array (NaN = no value) so the per-frame blend/paint allocates nothing.
  private prev = new Float32Array(0);
  private next = new Float32Array(0);
  private vals = new Float32Array(0);
  private nChannels = 0;
  private nextAt = 0;
  private scale = 1;
  private colorsDirty = true;
  private lastPaint = -1e9;
  private lastRay = -1e9;

  constructor(
    private canvas: HTMLCanvasElement,
    private onHover: (h: HoverInfo) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera.up.set(0, 0, 1);
    this.camera.position.set(190, 400, 150);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0, 10);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 220;
    this.controls.maxDistance = 650;
    this.controls.addEventListener("start", () => (this.lastInteract = Infinity));
    this.controls.addEventListener("end", () => (this.lastInteract = performance.now()));
    this.controls.update();

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8aa7b0, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(200, 300, 400);
    const rim = new THREE.DirectionalLight(0xbfe9ff, 0.9);
    rim.position.set(-300, -200, 150);
    this.scene.add(key, rim);

    const brainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 });
    for (const side of [1, -1] as const) {
      const { geo, base } = hemisphere(side);
      const mesh = new THREE.Mesh(geo, brainMat);
      this.root.add(mesh);
      this.hemis.push({ mesh, base, kernel: null });
    }
    const cb = new THREE.Mesh(cerebellum(), new THREE.MeshStandardMaterial({ color: CEREBELLUM, roughness: 0.7 }));
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(10, 8, 55, 32),
      new THREE.MeshStandardMaterial({ color: "#d6aaa5", roughness: 0.7 }),
    );
    stem.rotation.x = Math.PI / 2 - 0.35;
    stem.position.set(0, -34, -40);
    this.root.add(cb, stem, this.headGroup);
    this.scene.add(this.root);

    canvas.addEventListener("pointermove", this.handlePointer);
    canvas.addEventListener("pointerleave", this.handleLeave);
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(canvas.parentElement ?? canvas);
    this.fit();
    this.loop();
  }

  /** Builds the channel kernels, markers and the head/optode overlay for a probe. */
  setProbe(probe: Probe) {
    const pairs = probe.pairs;
    this.nChannels = pairs.length;
    const long = pairs.filter((p) => !p.short);
    // Anchor each channel on the brain surface: nearest vertex to its cortical point.
    const anchors: THREE.Vector3[] = [];
    const normals: THREE.Vector3[] = [];
    for (const p of long) {
      const target = new THREE.Vector3(...p.cortex3d);
      let best = Infinity;
      const a = new THREE.Vector3();
      const n = new THREE.Vector3();
      const v = new THREE.Vector3();
      for (const h of this.hemis) {
        const pos = h.mesh.geometry.attributes.position as THREE.BufferAttribute;
        const nor = h.mesh.geometry.attributes.normal as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          const d = v.distanceToSquared(target);
          if (d < best) {
            best = d;
            a.copy(v);
            n.fromBufferAttribute(nor, i);
          }
        }
      }
      anchors.push(a);
      normals.push(n);
    }
    // Sparse Gaussian kernels: vertex -> nearby channels.
    const cut = (3 * SIGMA_MM) ** 2;
    for (const h of this.hemis) {
      const pos = h.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const vs: number[] = [], cs: number[] = [], ws: number[] = [];
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        anchors.forEach((a, k) => {
          const d = v.distanceToSquared(a);
          if (d < cut) {
            vs.push(i);
            cs.push(long[k].index);
            ws.push(Math.exp(-d / (2 * SIGMA_MM * SIGMA_MM)));
          }
        });
      }
      h.kernel = { vertex: Uint32Array.from(vs), channel: Uint16Array.from(cs), weight: Float32Array.from(ws) };
    }

    // Channel markers (hover targets) slightly above the cortex.
    if (this.markers) this.root.remove(this.markers);
    const m = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1.1, 12, 8),
      new THREE.MeshBasicMaterial({ color: "#0f4c5c", transparent: true, opacity: 0.55 }),
      anchors.length,
    );
    const mat = new THREE.Matrix4();
    anchors.forEach((a, k) => {
      mat.makeTranslation(a.x + normals[k].x * 2, a.y + normals[k].y * 2, a.z + normals[k].z * 2);
      m.setMatrixAt(k, mat);
    });
    this.markers = m;
    this.markerChannels = long.map((p) => p.index);
    this.anchors = anchors;
    this.root.add(m);

    // Head shell + optodes + source–detector lines.
    this.headGroup.clear();
    const [rx, ry, rz] = probe.head3d.ellipsoid_radii_mm;
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 48, 0, Math.PI * 2, 0, Math.PI * 0.62),
      new THREE.MeshPhysicalMaterial({
        color: "#9fd8e0", transparent: true, opacity: 0.13, roughness: 0.3, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    shell.rotation.x = Math.PI / 2;
    shell.scale.set(rx, rz, ry);
    this.headGroup.add(shell);
    const optode = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.35 });
    const srcMat = optode("#ef4444");
    const detMat = optode("#2563eb");
    const dot = new THREE.SphereGeometry(2.6, 16, 12);
    const at = new Map<string, THREE.Vector3>();
    for (const s of probe.sources) {
      const o = new THREE.Mesh(dot, srcMat);
      o.position.set(...s.pos3d);
      at.set(`S${s.id}`, o.position);
      this.headGroup.add(o);
    }
    for (const d of probe.detectors) {
      const o = new THREE.Mesh(dot, detMat);
      o.position.set(...d.pos3d);
      at.set(`D${d.id}`, o.position);
      this.headGroup.add(o);
    }
    const pts: THREE.Vector3[] = [];
    for (const p of long) {
      const a = at.get(`S${p.source}`), b = at.get(`D${p.detector}`);
      if (a && b) pts.push(a, b);
    }
    this.headGroup.add(
      new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: "#0f766e", transparent: true, opacity: 0.45 }),
      ),
    );
    this.colorsDirty = true;
  }

  setHeadVisible(visible: boolean) {
    this.headGroup.visible = visible;
  }

  /** New channel values (already in display units); blends from the current state over ~0.5 s. */
  setValues(values: (number | null)[], scale: number) {
    const n = Math.max(values.length, this.nChannels);
    this.blend();                                   // freeze the current blend as the new start
    const prev = new Float32Array(n).fill(NaN);
    prev.set(this.vals.subarray(0, Math.min(n, this.vals.length)));
    const next = new Float32Array(n).fill(NaN);
    values.forEach((v, i) => {
      if (v !== null && v !== undefined) next[i] = v;
    });
    this.prev = prev;
    this.next = next;
    this.vals = new Float32Array(n).fill(NaN);
    this.nextAt = performance.now();
    this.scale = scale || 1;
    this.colorsDirty = true;
  }

  /** Channel values blended between the last two messages, written into `this.vals`. */
  private blend() {
    const { prev, next, vals } = this;
    const t = Math.min(1, (performance.now() - this.nextAt) / 500);
    for (let i = 0; i < next.length; i++) {
      const n = next[i], p = prev[i];
      vals[i] = n !== n ? NaN : p !== p ? n : p + (n - p) * t;
    }
  }

  private paint() {
    if (!this.vals.length) return;                  // no channel data yet
    this.blend();
    const vals = this.vals;
    const inv = 1 / this.scale;
    for (const h of this.hemis) {
      const k = h.kernel;
      const attr = h.mesh.geometry.attributes.color as THREE.BufferAttribute;
      const out = attr.array as Float32Array;
      out.set(h.base);
      if (!k) {
        attr.needsUpdate = true;
        continue;
      }
      const { vertex, channel, weight } = k;
      const n = vertex.length;
      // Accumulate per vertex (entries are grouped by vertex).
      let i = 0;
      while (i < n) {
        const vtx = vertex[i];
        let sw = 0, swx = 0;
        do {
          const x = vals[channel[i]];
          if (x === x) {                            // not NaN
            sw += weight[i];
            swx += weight[i] * x;
          }
          i++;
        } while (i < n && vertex[i] === vtx);
        if (sw < 1e-4) continue;
        const value = swx / sw * inv;
        const coverage = 1 - Math.exp(-sw * 3);
        const li = (Math.max(-1, Math.min(1, value)) + 1) * (LUT_N - 1) * 0.5 + 0.5 | 0;
        const a = coverage * Math.min(1, Math.abs(value) * 1.6 + 0.2);
        const o = vtx * 3;
        out[o] += (COLOR_LUT[li * 3] - out[o]) * a;
        out[o + 1] += (COLOR_LUT[li * 3 + 1] - out[o + 1]) * a;
        out[o + 2] += (COLOR_LUT[li * 3 + 2] - out[o + 2]) * a;
      }
      attr.needsUpdate = true;
    }
  }

  private fit() {
    const parent = this.canvas.parentElement ?? this.canvas;
    const w = parent.clientWidth || 400;
    const h = parent.clientHeight || 360;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private handlePointer = (e: PointerEvent) => {
    if (!this.markers) return;
    const now = performance.now();
    if (now - this.lastRay < RAY_EVERY_MS) return;
    this.lastRay = now;
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    // Hover = the channel nearest to the point under the cursor on the cortex (within 10 mm).
    const hit = this.raycaster.intersectObjects([...this.hemis.map((h) => h.mesh), this.markers], false)[0];
    let best = -1;
    if (hit) {
      const local = this.root.worldToLocal(hit.point.clone());
      let bestD = 100;
      this.anchors.forEach((a, k) => {
        const d = a.distanceToSquared(local);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      });
    }
    if (best >= 0) {
      this.onHover({ index: this.markerChannels[best], x: e.clientX - r.left, y: e.clientY - r.top });
      this.canvas.style.cursor = "pointer";
    } else {
      this.onHover(null);
      this.canvas.style.cursor = "grab";
    }
  };

  private handleLeave = () => this.onHover(null);

  private loop = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);
    const now = performance.now();
    // Idle: sway gently around the frontal view, where the optodes are.
    if (now - this.lastInteract > 2500) this.root.rotation.z = 0.45 * Math.sin(now / 5200);
    // Repainting ~84k vertices is the expensive part: ~15 Hz is plenty for a 0.5 s blend.
    if (this.colorsDirty && now - this.lastPaint >= PAINT_EVERY_MS) {
      this.paint();
      this.lastPaint = now;
      if (now - this.nextAt >= 500) this.colorsDirty = false;   // that paint was the fully blended one
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.canvas.removeEventListener("pointermove", this.handlePointer);
    this.canvas.removeEventListener("pointerleave", this.handleLeave);
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.renderer.dispose();
  }
}
