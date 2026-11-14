import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { bodyWidthScale, hairFilename, type AvatarConfig, type Sex } from "./avatarConfig";

type BodyMeta = { H: number; head: [number, number, number]; hair_joint?: string };

/** Sampled animation exported from avatar/animations.py: node -> { rotation | scale | translation, times }. */
type NodeTrack = { times: number[]; rotation?: number[]; scale?: number[]; translation?: number[] };
type Clip = Record<string, NodeTrack>;

export type Gesture = "six_seven" | "deep_breath" | "namaste" | "wave";

const BASE = `${import.meta.env.BASE_URL}avatar/`;
const loader = new GLTFLoader();
const glbCache = new Map<string, Promise<THREE.Group>>();
let metaPromise: Promise<Record<Sex, BodyMeta>> | undefined;
let clipsPromise: Promise<Record<string, Clip>> | undefined;

function loadGlb(name: string) {
  let promise = glbCache.get(name);
  if (!promise) {
    promise = loader.loadAsync(BASE + name).then((gltf) => gltf.scene);
    glbCache.set(name, promise);
  }
  return promise;
}

function loadMeta() {
  metaPromise ??= fetch(`${BASE}meta.json`).then((r) => r.json());
  return metaPromise;
}

function loadClips() {
  clipsPromise ??= fetch(`${BASE}animations.json`).then((r) => r.json());
  return clipsPromise;
}

type Rest = { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 };

const tmpA = new THREE.Quaternion();
const tmpB = new THREE.Quaternion();

/** Index of the last key time <= t and the interpolation factor to the next key. */
function locate(times: number[], t: number): [number, number] {
  const last = times.length - 1;
  if (t >= times[last]) return [last, 0];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  return [lo, (t - times[lo]) / (times[lo + 1] - times[lo])];
}

/** Renders the avatar assembled from avatar/components (body + hair), with drag-to-rotate and gestures. */
export class AvatarScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  /** Rotated by the user; pivots around the middle of the body. */
  private spin = new THREE.Group();
  /** Carries the weight-driven horizontal scale. */
  private root = new THREE.Group();
  private hairMaterial = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0 });
  private nodes = new Map<string, THREE.Object3D>();
  private rest = new Map<string, Rest>();
  private clips: Record<string, Clip> = {};
  private gesture: { name: Gesture; start: number; onDone: () => void } | null = null;
  private yaw = 0;
  private pitch = 0;
  private modelHeight = 1.7;
  private widthScale = 1;
  private token = 0;
  private raf = 0;
  private disposed = false;
  private start = performance.now();
  private cleanup: (() => void)[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.spin.add(this.root);
    this.scene.add(this.spin);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xbfd8d8, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(1.5, 3, 4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xb8f3ee, 1);
    rim.position.set(-3, 2, -2);
    this.scene.add(rim);
    void loadClips().then((clips) => (this.clips = clips));
    this.resize();
    this.loop();
  }

  /** Lets the user spin the avatar in any direction by dragging; double-click resets the view. */
  enableRotation() {
    const canvas = this.canvas;
    let last: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!last) return;
      this.yaw += (e.clientX - last.x) * 0.012;
      this.pitch += (e.clientY - last.y) * 0.012;
      last = { x: e.clientX, y: e.clientY };
    };
    const up = () => (last = null);
    const reset = () => {
      this.yaw = 0;
      this.pitch = 0;
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("dblclick", reset);
    this.cleanup.push(() => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("dblclick", reset);
    });
  }

  /** Plays a one-shot gesture, then returns to idle breathing. */
  async playGesture(name: Gesture, onDone: () => void) {
    this.clips = await loadClips();
    if (this.disposed) return;
    if (this.gesture || !this.clips[name]) {
      onDone();
      return;
    }
    this.gesture = { name, start: performance.now(), onDone };
  }

  async setModel(config: Pick<AvatarConfig, "sex" | "texture" | "length">) {
    const token = ++this.token;
    const [meta, bodyScene, hairScene] = await Promise.all([
      loadMeta(),
      loadGlb(`body_${config.sex}.glb`),
      loadGlb(hairFilename(config)),
    ]);
    if (this.disposed || token !== this.token) return;

    const { H, head, hair_joint } = meta[config.sex];
    const body = cloneSkinned(bodyScene) as THREE.Group;
    body.updateMatrixWorld(true);

    const joint = (hair_joint && body.getObjectByName(hair_joint)) || body;
    const hair = cloneSkinned(hairScene) as THREE.Group;
    hair.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) (object as THREE.Mesh).material = this.hairMaterial;
    });
    const hairHolder = new THREE.Group();
    hairHolder.matrixAutoUpdate = false;
    hairHolder.matrix
      .copy(joint.matrixWorld)
      .invert()
      .multiply(new THREE.Matrix4().makeTranslation(...head))
      .multiply(new THREE.Matrix4().makeScale(H, H, H));
    hairHolder.add(hair);
    joint.add(hairHolder);

    this.nodes.clear();
    this.rest.clear();
    body.traverse((node) => {
      if (!node.name) return;
      this.nodes.set(node.name, node);
      this.rest.set(node.name, {
        position: node.position.clone(),
        quaternion: node.quaternion.clone(),
        scale: node.scale.clone(),
      });
    });

    this.root.clear();
    this.root.add(body);
    this.modelHeight = H;
    this.spin.position.y = H / 2;
    this.root.position.y = -H / 2;
    this.frame();
  }

  setAppearance({ color, weight }: Pick<AvatarConfig, "color" | "weight">) {
    this.hairMaterial.color.set(color);
    this.widthScale = bodyWidthScale(weight);
    this.root.scale.x = this.widthScale;
    this.frame();
  }

  resize() {
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.frame();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach((fn) => fn());
    this.hairMaterial.dispose();
    this.renderer.dispose();
  }

  /**
   * Keeps the avatar at a constant on-screen size (375px = 1.1 x body height),
   * so a larger canvas simply leaves more room around it for rotations and gestures.
   */
  private frame() {
    const H = this.modelHeight;
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const pixelsPerUnit = 375 / (H * 1.1);
    const visibleHeight = (this.canvas.clientHeight || 400) / pixelsPerUnit;
    this.camera.position.set(0, H * 0.5, visibleHeight / 2 / tan);
    this.camera.lookAt(0, H * 0.5, 0);
  }

  /** Writes the animated values of `clip` at time `t` (seconds) onto the skeleton. */
  private applyClip(clip: Clip, t: number, loop: boolean) {
    for (const [name, track] of Object.entries(clip)) {
      const node = this.nodes.get(name);
      if (!node) continue;
      const duration = track.times[track.times.length - 1];
      const [i, u] = locate(track.times, loop ? t % duration : t);
      const j = Math.min(i + 1, track.times.length - 1);
      if (track.rotation) {
        tmpA.fromArray(track.rotation, i * 4);
        tmpB.fromArray(track.rotation, j * 4);
        node.quaternion.copy(tmpA).slerp(tmpB, u);
      }
      if (track.scale) {
        const s = track.scale;
        node.scale.set(
          s[i * 3] + (s[j * 3] - s[i * 3]) * u,
          s[i * 3 + 1] + (s[j * 3 + 1] - s[i * 3 + 1]) * u,
          s[i * 3 + 2] + (s[j * 3 + 2] - s[i * 3 + 2]) * u,
        );
      }
    }
  }

  private resetPose() {
    for (const [name, rest] of this.rest) {
      const node = this.nodes.get(name);
      if (!node) continue;
      node.position.copy(rest.position);
      node.quaternion.copy(rest.quaternion);
      node.scale.copy(rest.scale);
    }
  }

  private loop = () => {
    if (this.disposed) return;
    const now = performance.now();

    if (this.nodes.size && this.clips.breathing) {
      this.resetPose();
      if (this.gesture) {
        const clip = this.clips[this.gesture.name];
        const t = (now - this.gesture.start) / 1000;
        const duration = Math.max(...Object.values(clip).map((c) => c.times[c.times.length - 1]));
        if (t >= duration) {
          this.gesture.onDone();
          this.gesture = null;
        } else {
          this.applyClip(clip, t, false);
        }
      }
      if (!this.gesture) this.applyClip(this.clips.breathing, (now - this.start) / 1000, true);
    }

    this.spin.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  };
}
