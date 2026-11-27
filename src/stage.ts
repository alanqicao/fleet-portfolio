import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { flicker, ink, seeded, type Station, type StationInput } from "./kit.js";
import { quality } from "./models.js";
import { loadShip, type ShipLive, type ShipSpec } from "./ship.js";

export interface Placement {
  station: Station;
  x: number;
  y: number;
  z: number;
  ship: ShipSpec;
  /** True when the station's fittings are mounted on the ship, so the two must move as one. */
  carries: boolean;
}

interface Pose {
  position: THREE.Vector3;
  look: THREE.Vector3;
  shiftX: number;
  shiftY: number;
}

/** Direction to the star that lights the scene: high, behind the fleet and to port, so hulls are rim-lit. */
const SUN = new THREE.Vector3(-0.42, 0.62, -0.66).normalize();

/** The sky: a faint nebula painted on the inside of a very large sphere. */
function createSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 dir;
      void main() {
        dir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 dir;
      float hash(vec3 p) { p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
      float noise(vec3 p) {
        vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float fbm(vec3 p) { float s = 0., a = .5; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.02 + 3.1; a *= .5; } return s; }
      void main() {
        vec3 d = normalize(dir);
        float cloud = fbm(d * 2.2 + fbm(d * 3.5) * 1.4);
        float band = smoothstep(.75, .0, abs(d.y + .15 + (cloud - .5) * .5));
        vec3 base = vec3(.004, .006, .014);
        vec3 indigo = vec3(.05, .07, .20), rose = vec3(.20, .09, .12), teal = vec3(.02, .13, .17);
        vec3 tint = mix(indigo, rose, smoothstep(.42, .68, fbm(d * 1.4 + 9.)));
        tint = mix(tint, teal, smoothstep(.5, .75, fbm(d * 1.1 - 4.)));
        vec3 color = base + tint * band * smoothstep(.4, .85, cloud) * .22;
        gl_FragColor = vec4(color, 1.);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 32), material);
  sky.frustumCulled = false;
  return sky;
}

function createStars() {
  const random = seeded(99);
  const count = 5200;
  const position = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const shade = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const u = random() * 2 - 1, angle = random() * Math.PI * 2, ring = Math.sqrt(1 - u * u);
    position.set([Math.cos(angle) * ring * 800, u * 800, Math.sin(angle) * ring * 800], i * 3);
    const power = Math.pow(random(), 7) * 5 + 0.25 + random() * 0.5;
    shade.setHSL(random() < 0.5 ? 0.08 + random() * 0.05 : 0.58 + random() * 0.06, 0.55, 0.72).multiplyScalar(power);
    color.set([shade.r, shade.g, shade.b], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(color, 3));
  const stars = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 1.7, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
  stars.frustumCulled = false;
  return stars;
}

/** A banded gas giant with rings, far off the fleet's port side. */
function createPlanet() {
  const random = seeded(4);
  const canvas = document.createElement("canvas");
  canvas.width = 16; canvas.height = 512;
  const pen = canvas.getContext("2d")!;
  const bands = ["#b9a892", "#8e6f58", "#c9bca6", "#6f5446", "#a8937a", "#544038", "#bdae96", "#86695a"];
  let y = 0;
  while (y < canvas.height) {
    const thick = 10 + random() * 46;
    pen.fillStyle = bands[Math.floor(random() * bands.length)];
    pen.fillRect(0, y, 16, thick + 1);
    y += thick;
  }
  const blurred = document.createElement("canvas");
  blurred.width = 16; blurred.height = 512;
  const soft = blurred.getContext("2d")!;
  soft.filter = "blur(9px)";
  soft.drawImage(canvas, 0, 0);
  const skin = new THREE.CanvasTexture(blurred);
  skin.colorSpace = THREE.SRGBColorSpace;

  const group = new THREE.Group();
  const globe = new THREE.Mesh(new THREE.SphereGeometry(120, 64, 40), new THREE.MeshStandardMaterial({ map: skin, roughness: 1, emissive: 0xffffff, emissiveMap: skin, emissiveIntensity: 0.07 }));
  group.add(globe);
  // A thin shell of air that catches the light along the limb.
  const air = new THREE.Mesh(new THREE.SphereGeometry(124, 64, 40), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    uniforms: { sunDir: { value: SUN.clone() } },
    vertexShader: "varying vec3 n; varying vec3 v; void main() { n = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); v = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }",
    fragmentShader: "uniform vec3 sunDir; varying vec3 n; varying vec3 v; void main() { float rim = pow(1. - abs(dot(normalize(n), normalize(v))), 3.); float lit = smoothstep(-.25, .5, dot(normalize(-n), sunDir)); gl_FragColor = vec4(vec3(.45, .68, 1.) * rim * lit * 1.6, 1.); }",
  }));
  group.add(air);

  const stripes = document.createElement("canvas");
  stripes.width = 512; stripes.height = 4;
  const ringPen = stripes.getContext("2d")!;
  for (let x = 0; x < 512; x++) {
    const gap = x > 250 && x < 285 ? 0.05 : 1;
    ringPen.fillStyle = `rgba(200, 184, 160, ${(0.12 + random() * 0.4) * gap * Math.sin(x / 512 * Math.PI)})`;
    ringPen.fillRect(x, 0, 1, 4);
  }
  const ringSkin = new THREE.CanvasTexture(stripes);
  ringSkin.colorSpace = THREE.SRGBColorSpace;
  const ringShape = new THREE.RingGeometry(155, 270, 128, 1);
  const uv = ringShape.attributes.uv, spot = ringShape.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (Math.hypot(spot.getX(i), spot.getY(i)) - 155) / 115, 0.5);
  const ring = new THREE.Mesh(ringShape, new THREE.MeshBasicMaterial({ map: ringSkin, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = Math.PI / 2;
  group.add(ring);
  group.rotation.set(0.32, 0, -0.22);
  group.position.set(300, -120, -640);
  return group;
}

/** Dust drifting aft past the fleet, so the ships read as under way. */
function createDust() {
  const random = seeded(31);
  const count = 320;
  const position = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) position.set([(random() - 0.5) * 160, (random() - 0.5) * 50, (random() - 0.5) * 110], i * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  const dust = new THREE.Points(geometry, new THREE.PointsMaterial({
    color: new THREE.Color(0x9fb4d8).multiplyScalar(0.9), size: 0.06, transparent: true, opacity: 0.5, depthWrite: false,
  }));
  dust.frustumCulled = false;
  return {
    dust,
    drift(dt: number) {
      const spot = geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < count; i++) {
        let x = spot.getX(i) - dt * 7;
        if (x < -80) x += 160;
        spot.setX(i, x);
      }
      spot.needsUpdate = true;
    },
  };
}

export function createStage(canvas: HTMLCanvasElement, placements: Placement[]) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(ink.void);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 2000);

  const sky = createSky(), planet = createPlanet();
  scene.add(sky, createStars(), planet);

  // Hull metal reflects a blurred copy of the sky, the star and the planet.
  const surroundings = new THREE.Scene();
  surroundings.add(createSky());
  const star = new THREE.Mesh(new THREE.SphereGeometry(60, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe6c4).multiplyScalar(40) }));
  star.position.copy(SUN).multiplyScalar(700);
  const glowOfPlanet = new THREE.Mesh(new THREE.SphereGeometry(160, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x8a6f5c).multiplyScalar(0.9) }));
  glowOfPlanet.position.copy(planet.position);
  surroundings.add(star, glowOfPlanet);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(surroundings, 0.02, 1, 1500).texture;
  scene.environmentIntensity = 1.4;
  pmrem.dispose();
  const { dust, drift } = createDust();
  scene.add(dust);

  // A warm star as the key light, cool light from the nebula as fill.
  scene.add(new THREE.HemisphereLight(0x7f9ad6, 0x1a2036, 1.1));
  const sun = new THREE.DirectionalLight(0xffe9cf, 5.2);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(quality.shadowMap);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 4;
  scene.add(sun, sun.target);
  // Planet-shine: a weak warm bounce from the planet's side, and a cool fill toward the camera.
  const bounce = new THREE.DirectionalLight(0xc89a78, 0.5);
  bounce.position.set(30, -12, -64);
  const fill = new THREE.DirectionalLight(0xa9c4f2, 1.7);
  fill.position.set(-6, 10, 30);
  scene.add(bounce, fill);

  for (const { station, x, y, z, ship } of placements) {
    station.ship = loadShip(ship);
    station.group.add(station.ship);
    station.group.position.set(x, y, z);
    scene.add(station.group);
  }

  // Multisampling is the costliest smoothing; only the full tier pays for it.
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: quality.smoothing });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.7, 1.0));
  composer.addPass(new OutputPass());
  // The lens: colour fringing toward the corners, a vignette, and fine grain.
  const lens = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, time: { value: 0 } },
    vertexShader: "varying vec2 at; void main() { at = uv; gl_Position = vec4(position.xy, 0., 1.); }",
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float time; varying vec2 at;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec2 off = at - .5;
        float edge = dot(off, off);
        vec2 fringe = off * edge * .012;
        vec3 color = vec3(texture2D(tDiffuse, at + fringe).r, texture2D(tDiffuse, at).g, texture2D(tDiffuse, at - fringe).b);
        color *= 1. - edge * .9;
        color += (hash(at * 900. + fract(time) * 60.) - .5) * .035;
        gl_FragColor = vec4(color, 1.);
      }`,
  });
  composer.addPass(lens);

  // One camera pose per stop: the opening view, each ship, and the closing view of the whole fleet.
  let poses: Pose[] = [];
  function layout() {
    const width = window.innerWidth, height = window.innerHeight;
    const aspect = width / height;
    const tall = aspect < 0.9;
    const far = tall ? 2.55 : Math.max(1, 1.45 / aspect);
    // Each tier caps how many pixels it draws; `detail` then trims that further if frames run slow.
    const ratio = Math.min(window.devicePixelRatio, quality.pixelRatio) * detail;
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(ratio);
    composer.setSize(width, height);
    camera.aspect = aspect;

    poses = [{
      position: new THREE.Vector3(-46 * far, 20 * far, 62 * far),
      look: new THREE.Vector3(2, 0, 0),
      shiftX: tall ? 0 : 0.2, shiftY: tall ? 0.22 : 0.1,
    }];
    for (const { x, y, z } of placements) {
      poses.push({
        position: new THREE.Vector3(x + (tall ? 0 : -6) * far, y + 10.5 * far, z + 27 * far),
        look: new THREE.Vector3(x, y + 0.6, z - 1),
        shiftX: tall ? 0 : 0.2, shiftY: tall ? 0.3 : 0,
      });
    }
    poses.push({
      position: new THREE.Vector3(10, 70 * far, 62 * far),
      look: new THREE.Vector3(0, 0, 1),
      shiftX: tall ? 0 : 0.17, shiftY: tall ? 0.24 : 0,
    });
  }

  // Drawing detail, from 1 (full) down. It drops when frames run slow and recovers when they run fast.
  let detail = quality.startDetail;
  const gaps: number[] = [];
  let progress = 0;
  let paused = false;
  let instant = false;
  let snap = true;
  const want: Pose = { position: new THREE.Vector3(), look: new THREE.Vector3(), shiftX: 0, shiftY: 0 };
  const now: Pose = { position: new THREE.Vector3(), look: new THREE.Vector3(), shiftX: 0, shiftY: 0 };

  function poseAt(at: number, out: Pose) {
    const index = Math.min(Math.floor(at), poses.length - 2);
    const a = poses[index], b = poses[index + 1];
    // Linger at each stop and travel between them in an arc.
    const raw = THREE.MathUtils.clamp((at - index - 0.18) / 0.64, 0, 1);
    const t = raw * raw * (3 - 2 * raw);
    out.position.lerpVectors(a.position, b.position, t);
    out.position.y += Math.sin(t * Math.PI) * 3.5;
    out.look.lerpVectors(a.look, b.look, t);
    out.shiftX = a.shiftX + (b.shiftX - a.shiftX) * t;
    out.shiftY = a.shiftY + (b.shiftY - a.shiftY) * t;
  }

  // Pointer and keys. Anything over the page's own panels and controls is left to the page.
  const pointer = { x: 0, y: 0, active: false, pressed: false, clicked: false, leaving: false, downX: 0, downY: 0 };
  const keys = new Set<string>();
  const overPage = (event: Event) => event.target instanceof Element && event.target.closest("[data-ui]") !== null;
  window.addEventListener("pointermove", (event) => {
    pointer.x = event.clientX; pointer.y = event.clientY;
    pointer.active = !overPage(event);
    if (!pointer.active) pointer.pressed = false;
  });
  window.addEventListener("pointerdown", (event) => {
    pointer.x = event.clientX; pointer.y = event.clientY;
    pointer.downX = event.clientX; pointer.downY = event.clientY;
    pointer.active = !overPage(event);
    pointer.pressed = pointer.active && event.button === 0;
  });
  window.addEventListener("pointerup", (event) => {
    if (pointer.pressed && Math.hypot(event.clientX - pointer.downX, event.clientY - pointer.downY) < 10) pointer.clicked = true;
    pointer.pressed = false;
    if (event.pointerType === "touch") pointer.leaving = true;
  });
  window.addEventListener("pointercancel", () => { pointer.pressed = false; pointer.active = false; });
  document.addEventListener("pointerleave", () => { pointer.active = false; pointer.pressed = false; });
  window.addEventListener("keydown", (event) => {
    if (!event.metaKey && !event.ctrlKey && !event.altKey && !overPage(event)) keys.add(event.key.toLowerCase());
  });

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  const helms = placements.map(() => ({ burn: 0, near: false, throttle: 0.7, surge: 0, speed: 0, rolling: false, turning: false }));
  const idle: StationInput = { point: null, pressed: false, clicked: false, keys: new Set() };

  let last = 0;
  let time = 0;
  const wobble = new THREE.Vector3();
  function frame(stamp: number) {
    requestAnimationFrame(frame);
    const gap = last ? stamp - last : 0;
    const dt = Math.min(gap / 1000, 0.05);
    last = stamp;
    if (document.hidden) return;
    // Long gaps are a background tab or a stall, not a slow frame, so they do not count.
    if (gap > 4 && gap < 100) gaps.push(gap);
    if (gaps.length >= 30) {
      const typical = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
      gaps.length = 0;
      const before = detail;
      if (typical > 24 && detail > 0.5) detail = Math.max(0.5, detail * 0.85);
      else if (typical < 12 && detail < 1) detail = Math.min(1, detail * 1.1);
      if (detail !== before) layout();
    }
    draw(dt);
  }

  /** Advance everything by dt seconds and draw one frame. */
  function draw(dt: number) {

    poseAt(progress, want);
    const ease = snap || instant ? 1 : 1 - Math.exp(-dt * 4.5);
    snap = false;
    now.position.lerp(want.position, ease);
    now.look.lerp(want.look, ease);
    now.shiftX += (want.shiftX - now.shiftX) * ease;
    now.shiftY += (want.shiftY - now.shiftY) * ease;
    // A slow drift, as if filmed from a chase craft.
    camera.position.copy(now.position);
    if (!paused && !instant) camera.position.add(wobble.set(Math.sin(time * 0.23) * 0.35, Math.sin(time * 0.31 + 1) * 0.22, Math.sin(time * 0.19 + 2) * 0.3));
    camera.lookAt(now.look);
    const width = window.innerWidth, height = window.innerHeight;
    camera.setViewOffset(width, height, -now.shiftX * width, now.shiftY * height, width, height);
    camera.updateMatrixWorld();

    // The key light and its shadow frame travel with whatever the camera is looking at.
    const reach = THREE.MathUtils.clamp(camera.position.distanceTo(now.look) * 0.75, 13, 60);
    sun.position.copy(SUN).multiplyScalar(45).add(now.look);
    sun.target.position.copy(now.look);
    const shadow = sun.shadow.camera;
    shadow.left = -reach; shadow.right = reach; shadow.top = reach; shadow.bottom = -reach;
    shadow.near = 1; shadow.far = 90;
    shadow.updateProjectionMatrix();

    if (!paused) {
      time += dt;
      drift(dt);
      flicker(time);
      const focus = progress - 1;
      placements.forEach(({ station, x, y, z, ship, carries }, index) => {
        const away = Math.abs(focus - index);
        const helm = helms[index];
        const live = station.ship?.userData.live as ShipLive | undefined;

        // As the camera arrives, the ship makes a short burn: it throttles up, eases forward
        // against a spring, banks a little, and settles back.
        const near = away < 0.5;
        if (near && !helm.near) { helm.burn = 2.4; live?.jet(index % 2 ? "yawLeft" : "yawRight"); }
        helm.near = near;
        const wasBurning = helm.burn > 0.9;
        helm.burn = Math.max(0, helm.burn - dt);
        const burning = helm.burn > 0.9;
        if (wasBurning && !burning) { live?.jet("port"); live?.jet("starboard"); }
        const cruise = 0.62 + Math.sin(time * 0.23 + index * 2.1) * 0.14 + Math.sin(time * 0.71 + index) * 0.06;
        helm.throttle = THREE.MathUtils.damp(helm.throttle, burning ? 1.9 : cruise, burning ? 5 : 1.6, dt);
        live?.thrust(helm.throttle);
        helm.speed += (((burning ? 1.1 : 0) - helm.surge) * 6 - helm.speed * 3.2) * dt;
        helm.surge += helm.speed * dt;

        // Between burns the ship holds station with small corrections. Each time its roll or
        // its heading reverses, the jets on that side fire.
        const rolling = Math.cos(time * 0.37 + index) > 0, turning = Math.cos(time * 0.21 + index * 1.3) > 0;
        if (rolling !== helm.rolling) live?.jet(rolling ? "port" : "starboard");
        if (turning !== helm.turning) live?.jet(turning ? "yawLeft" : "yawRight");
        helm.rolling = rolling;
        helm.turning = turning;
        live?.tick(time, dt);

        const bank = helm.burn > 0 ? Math.sin((2.4 - helm.burn) * 2.2) * 0.07 * (helm.burn / 2.4) : 0;
        const roll = Math.sin(time * 0.37 + index) * 0.022 + bank;
        const heading = Math.sin(time * 0.21 + index * 1.3) * 0.018 + helm.speed * 0.03;
        const swell = y + Math.sin(time * 0.5 + index * 1.9) * 0.22;
        // A ship that carries its station's fittings takes the whole station with it.
        const mover = carries ? station.group : station.ship!;
        station.group.position.set(x + (carries ? helm.surge : 0), swell, z);
        if (!carries) mover.position.set(ship.at[0] + helm.surge, ship.at[1], ship.at[2]);
        mover.rotation.set(roll, heading, -helm.speed * 0.02);

        if (away > 1.3 && progress > 0.6 && progress < poses.length - 1.6) return;
        let input = idle;
        if (away < 0.42 && pointer.active) {
          ndc.set(pointer.x / width * 2 - 1, -(pointer.y / height) * 2 + 1);
          raycaster.setFromCamera(ndc, camera);
          plane.constant = -(swell + station.planeY);
          if (raycaster.ray.intersectPlane(plane, hit)) {
            station.group.updateMatrixWorld();
            station.group.worldToLocal(hit);
            hit.y = station.planeY;
            if (Math.abs(hit.x) < 8 && Math.abs(hit.z) < 6) {
              input = { point: hit, pressed: pointer.pressed, clicked: pointer.clicked, keys };
            }
          }
        } else if (away < 0.42) {
          input = { point: null, pressed: false, clicked: false, keys };
        }
        station.update(dt, time, input);
      });
    }
    pointer.clicked = false;
    if (pointer.leaving) { pointer.active = false; pointer.leaving = false; }
    keys.clear();
    lens.uniforms.time.value = time;
    composer.render();
  }

  // ?bench adds a way to time frames directly, for when the page is in a background tab and
  // the browser is holding back animation frames.
  if (new URLSearchParams(location.search).has("bench")) {
    (window as unknown as Record<string, unknown>).benchFrames = (stop: number, frames = 60) => {
      const gl = renderer.getContext();
      progress = stop;
      snap = true;
      for (let i = 0; i < 5; i++) draw(1 / 60);
      gl.finish();
      const started = performance.now();
      for (let i = 0; i < frames; i++) { draw(1 / 60); gl.finish(); }
      const each = (performance.now() - started) / frames;
      renderer.info.autoReset = false;
      renderer.info.reset();
      draw(1 / 60);
      const { calls, triangles } = renderer.info.render;
      renderer.info.autoReset = true;
      return { stop, msPerFrame: Number(each.toFixed(2)), calls, triangles, pixels: `${canvas.width}x${canvas.height}` };
    };
    // Where a point in a ship's own coordinates lands on screen, in CSS pixels.
    (window as unknown as Record<string, unknown>).benchPoint = (stop: number, x: number, y: number, z: number) => {
      const place = placements[stop - 1];
      place.station.group.updateMatrixWorld();
      const spot = place.station.group.localToWorld(new THREE.Vector3(x, y, z)).project(camera);
      return { x: Math.round((spot.x + 1) / 2 * window.innerWidth), y: Math.round((1 - spot.y) / 2 * window.innerHeight) };
    };
  }

  // If the device takes the graphics context away, say so instead of leaving a blank scene.
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    paused = true;
    document.getElementById("scene-note")?.removeAttribute("hidden");
  });

  layout();
  window.addEventListener("resize", () => { layout(); snap = true; });
  frame(performance.now());

  return {
    setProgress(value: number) { progress = THREE.MathUtils.clamp(value, 0, poses.length - 1); },
    setPaused(value: boolean) { paused = value; },
    /** Jump the camera instead of gliding, for people who asked for less motion. */
    setInstant(value: boolean) { instant = value; },
  };
}
