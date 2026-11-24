import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** The few colours used for fittings, lamps and screens. The ships and props bring their own. */
export const ink = {
  void: 0x02040a,
  bone: 0xaab0bb,
  graphite: 0x1a1e26,
  slate: 0x323947,
  steel: 0x646d7c,
  orange: 0xe06a26,
  yellow: 0xe2a13a,
  water: 0x3f6fae,
  red: 0xff3b30,
  green: 0x35e06a,
  cyan: 0x8fdcff,
} as const;

export interface StationInput {
  /** Pointer position in the station's own coordinates, on its working plane. */
  point: THREE.Vector3 | null;
  pressed: boolean;
  clicked: boolean;
  keys: ReadonlySet<string>;
}

export interface Station {
  group: THREE.Group;
  /** Height of the plane the pointer is projected onto. Deck level is y = 0. */
  planeY: number;
  /** The real ship this station belongs to, set by the stage. Its parts arrive when the model loads. */
  ship?: THREE.Group;
  update(dt: number, time: number, input: StationInput): void;
}

export const damp = THREE.MathUtils.damp;
export const clamp = THREE.MathUtils.clamp;

export function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Plating seams and slightly uneven panels, tiled across every metal fitting. */
function platingTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const pen = canvas.getContext("2d")!;
  const random = seeded(3);
  pen.fillStyle = "#fff";
  pen.fillRect(0, 0, 512, 512);
  // Panels of slightly different wear, then the seams between them.
  for (let y = 0; y < 512; y += 64) {
    for (let x = 0; x < 512;) {
      const wide = 64 * (1 + Math.floor(random() * 3));
      const wear = 205 + Math.floor(random() * 50);
      pen.fillStyle = `rgb(${wear}, ${wear}, ${wear})`;
      pen.fillRect(x, y, wide, 64);
      pen.fillStyle = "rgba(20, 24, 32, .85)";
      pen.fillRect(x, y, 2, 64);
      if (random() < 0.3) { pen.fillStyle = "rgba(20, 24, 32, .5)"; pen.fillRect(x + 10, y + 12, wide - 20, 2); }
      x += wide;
    }
    pen.fillStyle = "rgba(20, 24, 32, .85)";
    pen.fillRect(0, y, 512, 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 2);
  texture.anisotropy = 8;
  return texture;
}

let plating: THREE.Texture | undefined;
const metals = new Map<number, THREE.MeshStandardMaterial>();

/** Worn painted metal that picks up the sky, for the fittings built in code. */
export function matte(color: number) {
  let material = metals.get(color);
  if (!material) {
    plating ??= platingTexture();
    material = new THREE.MeshStandardMaterial({ color, map: plating, roughness: 0.5, metalness: 0.65, flatShading: true });
    metals.set(color, material);
  }
  return material;
}

/** A colour brighter than white, so the bloom pass makes it shine. */
export function glow(color: number, strength = 3) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength) });
}

function solid(geometry: THREE.BufferGeometry, color: number) {
  const mesh = new THREE.Mesh(geometry, matte(color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A metal box that sits on the plane y of its parent, centred at x, z. */
export function block(width: number, height: number, depth: number, color: number, x = 0, y = 0, z = 0) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.translate(0, height / 2, 0);
  const mesh = solid(geometry, color);
  mesh.position.set(x, y, z);
  return mesh;
}

/** An upright metal cylinder that sits on y of its parent. */
export function post(radius: number, height: number, color: number, x = 0, y = 0, z = 0, segments = 24) {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, segments);
  geometry.translate(0, height / 2, 0);
  const mesh = solid(geometry, color);
  mesh.position.set(x, y, z);
  return mesh;
}

/**
 * Many identical pieces drawn in one call. Lit pieces are metal; unlit ones give off their own
 * light, like the elements of a display. Colours may exceed white to shine.
 */
export function tiles(count: number, width: number, height: number, depth: number, lit = true, shape?: THREE.BufferGeometry) {
  const geometry = shape ?? new THREE.BoxGeometry(width, height, depth);
  if (!shape) geometry.translate(0, height / 2, 0);
  const material = lit
    ? new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.7 })
    : new THREE.MeshBasicMaterial({ color: 0xffffff });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.castShadow = lit;
  mesh.receiveShadow = lit;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const white = new THREE.Color(0xffffff);
  for (let i = 0; i < count; i++) mesh.setColorAt(i, white);
  return mesh;
}

/**
 * The housing of a physical display: a dark slab with a raised metal rim, and a mounting
 * pylon under each corner. Its glass face is at y = 0, centred on x, z.
 */
export function housing(width: number, depth: number, x = 0, z = 0) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.04, depth),
    new THREE.MeshStandardMaterial({ color: 0x05070b, roughness: 0.12, metalness: 0.85 }),
  );
  glass.position.y = -0.03;
  glass.receiveShadow = true;
  const rim = 0.16;
  group.add(
    glass,
    block(width + rim * 2, 0.26, depth + rim * 2, ink.graphite, 0, -0.31, 0),
    block(width + rim * 2, 0.1, rim, ink.steel, 0, -0.05, depth / 2 + rim / 2),
    block(width + rim * 2, 0.1, rim, ink.steel, 0, -0.05, -depth / 2 - rim / 2),
    block(rim, 0.1, depth, ink.steel, width / 2 + rim / 2, -0.05, 0),
    block(rim, 0.1, depth, ink.steel, -width / 2 - rim / 2, -0.05, 0),
  );
  return group;
}

/** The shape of a small guided probe, nose toward +x: a body, a nose cone and four fins. */
export function probeShape() {
  const body = new THREE.CylinderGeometry(0.035, 0.035, 0.34, 10);
  body.rotateZ(-Math.PI / 2);
  const nose = new THREE.ConeGeometry(0.035, 0.12, 10);
  nose.rotateZ(-Math.PI / 2);
  nose.translate(0.23, 0, 0);
  const fins = [0, 1].map((turn) => {
    const fin = new THREE.BoxGeometry(0.1, 0.16, 0.008);
    fin.rotateX(turn * Math.PI / 2);
    fin.translate(-0.13, 0, 0);
    return fin;
  });
  return mergeGeometries([body, nose, ...fins])!;
}

let halo: THREE.Texture | undefined;
function haloTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const pen = canvas.getContext("2d")!;
  const fade = pen.createRadialGradient(64, 64, 0, 64, 64, 64);
  fade.addColorStop(0, "rgba(255,255,255,1)");
  fade.addColorStop(0.25, "rgba(255,255,255,.55)");
  fade.addColorStop(1, "rgba(255,255,255,0)");
  pen.fillStyle = fade;
  pen.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

/** A point of light with a soft halo, for running lights and indicator lamps. */
export function lamp(color: number, size: number, strength = 2.4) {
  halo ??= haloTexture();
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: halo, color: new THREE.Color(color).multiplyScalar(strength), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  sprite.scale.setScalar(size);
  return sprite;
}

function streakTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 64;
  const pen = canvas.getContext("2d")!;
  const across = pen.createLinearGradient(0, 0, 512, 0);
  across.addColorStop(0, "rgba(255,255,255,0)");
  across.addColorStop(0.5, "rgba(255,255,255,1)");
  across.addColorStop(1, "rgba(255,255,255,0)");
  pen.fillStyle = across;
  pen.fillRect(0, 0, 512, 64);
  const down = pen.createLinearGradient(0, 0, 0, 64);
  down.addColorStop(0, "rgba(0,0,0,1)");
  down.addColorStop(0.5, "rgba(0,0,0,0)");
  down.addColorStop(1, "rgba(0,0,0,1)");
  pen.globalCompositeOperation = "destination-out";
  pen.fillStyle = down;
  pen.fillRect(0, 0, 512, 64);
  return new THREE.CanvasTexture(canvas);
}
let streak: THREE.SpriteMaterial | undefined;

/** The wide horizontal flare a bright light leaves in a camera lens. */
function lensStreak(width: number, color: number, strength: number) {
  streak ??= new THREE.SpriteMaterial({ map: streakTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const material = streak.clone();
  material.color = new THREE.Color(color).multiplyScalar(strength);
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(width, width * 0.035, 1);
  return sprite;
}

const driveClock = { value: 0 };
const plumeShape = new THREE.ConeGeometry(1, 1, 24, 12, true);
plumeShape.rotateZ(Math.PI / 2);
plumeShape.translate(-0.5, 0, 0);
let plumeLook: THREE.ShaderMaterial | undefined;

/**
 * Drive exhaust: a hot core inside a longer, fainter sheath, with a glow and a lens streak at
 * the nozzle. It points aft (-x) from the origin of the group it returns. Call `thrust` on the
 * result with 0 to about 2 to throttle it.
 */
export function plume(radius: number, color: number, tall = 1) {
  plumeLook ??= new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { time: driveClock, tint: { value: new THREE.Color() }, power: { value: 1 } },
    vertexShader: "varying vec2 at; void main() { at = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }",
    fragmentShader: `
      uniform float time; uniform vec3 tint; uniform float power; varying vec2 at;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      float noise(float x) { float i = floor(x), f = fract(x); f = f * f * (3. - 2. * f); return mix(hash(i), hash(i + 1.), f); }
      void main() {
        float along = clamp(at.y, 0., 1.);
        // Brightest at the nozzle, shock diamonds a little way out, then fading to nothing.
        float fade = pow(max(1. - along, 0.), 1.7);
        float diamonds = .75 + .25 * sin(along * 26. - time * 14.);
        float flutter = .8 + .2 * noise(along * 9. - time * 7. + at.x * 12.);
        vec3 color = mix(vec3(1.), tint, smoothstep(0., .3, along)) * (1.2 + 1.6 * fade);
        gl_FragColor = vec4(color, fade * diamonds * flutter * power);
      }`,
  });
  const layer = (power: number) => {
    const look = plumeLook!.clone();
    look.uniforms.time = driveClock;
    look.uniforms.tint.value.set(color);
    look.uniforms.power.value = power;
    return look;
  };
  const core = layer(0.8), sheath = layer(0.22);
  const inner = new THREE.Mesh(plumeShape, core);
  const outer = new THREE.Mesh(plumeShape, sheath);
  const glare = lamp(color, radius * 3, 0.9);
  const flare = lensStreak(radius * 12, color, 0.45);
  const group = new THREE.Group();
  group.add(outer, inner, glare, flare);

  const thrust = (level: number) => {
    const push = clamp(level, 0.05, 2.2);
    inner.scale.set(radius * 5 * push, radius * 0.55 * tall, radius * 0.55);
    outer.scale.set(radius * 11 * push, radius * 1.05 * tall, radius * 1.05);
    core.uniforms.power.value = 0.8 * Math.min(1.3, 0.35 + push * 0.65);
    sheath.uniforms.power.value = 0.22 * Math.min(1.5, 0.3 + push * 0.7);
    glare.scale.set(radius * 3 * (0.6 + push * 0.4), radius * 3 * tall * (0.6 + push * 0.4), 1);
    flare.scale.set(radius * 12 * (0.5 + push * 0.5), radius * 12 * 0.035, 1);
  };
  thrust(1);
  return { group, thrust };
}

const puffShape = new THREE.ConeGeometry(1, 1, 12, 1, true);
puffShape.rotateZ(Math.PI / 2);
puffShape.translate(0.5, 0, 0);
const outward = new THREE.Vector3(1, 0, 0);

/**
 * An attitude jet: a short burst of gas that widens from its nozzle and is gone in a third of
 * a second. `aim` is the direction the gas goes.
 */
export function puff(length: number, aim: THREE.Vector3) {
  const look = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xdcebff).multiplyScalar(1.6), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(puffShape, look);
  mesh.quaternion.setFromUnitVectors(outward, aim.clone().normalize());
  mesh.visible = false;
  let age = 1;
  return {
    mesh,
    fire() { age = 0; },
    tick(dt: number) {
      if (age >= 1) { mesh.visible = false; return; }
      age = Math.min(1, age + dt / 0.34);
      mesh.visible = true;
      mesh.scale.set(length * (0.35 + age * 0.65), length * (0.08 + age * 0.26), length * (0.08 + age * 0.26));
      look.opacity = (1 - age) * (1 - age) * 0.75;
    },
  };
}

/** Advance the clock every exhaust plume runs on. */
export function flicker(time: number) {
  driveClock.value = time;
}

/** A small flat tag with text, always facing the camera. */
export function tag(text: string, background: string, foreground: string) {
  const canvas = document.createElement("canvas");
  const pen = canvas.getContext("2d")!;
  const font = '600 44px "Barlow Condensed", sans-serif';
  pen.font = font;
  canvas.width = Math.ceil(pen.measureText(text).width) + 28;
  canvas.height = 58;
  pen.fillStyle = background;
  pen.fillRect(0, 0, canvas.width, canvas.height);
  pen.font = font;
  pen.fillStyle = foreground;
  pen.textBaseline = "middle";
  pen.fillText(text, 14, 31);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  const height = 0.36;
  sprite.scale.set(height * canvas.width / canvas.height, height, 1);
  sprite.center.set(0, 0);
  sprite.renderOrder = 5;
  return sprite;
}
