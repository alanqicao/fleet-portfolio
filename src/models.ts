import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

/**
 * How much this device can be asked to draw.
 *
 * - "full": a discrete graphics card, or an Apple chip. Everything on.
 * - "modest": a laptop or desktop whose graphics share the processor: capable, but slow to
 *   fill a dense screen, so it draws fewer pixels and skips the costliest smoothing.
 * - "light": a phone or tablet, which also has little graphics memory.
 *
 * The page still adjusts as it runs; this only decides where it starts, so a slow machine is
 * not asked for a first few seconds it cannot give.
 */
export type Tier = "full" | "modest" | "light";

function graphicsChip() {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const names = gl?.getExtension("WEBGL_debug_renderer_info");
    return gl && names ? String(gl.getParameter(names.UNMASKED_RENDERER_WEBGL)) : "";
  } catch {
    return "";
  }
}

function chooseTier(): Tier {
  const asked = new URLSearchParams(location.search).get("tier");
  if (asked === "full" || asked === "modest" || asked === "light") return asked;
  if (window.matchMedia("(pointer: coarse)").matches || Math.min(window.screen.width, window.screen.height) < 700) return "light";
  const chip = graphicsChip();
  // Graphics built into the processor, and the software renderers used when there is no chip at all.
  const shared = /Intel|UHD|Iris|HD Graphics|Radeon\(TM\) Graphics|Radeon Graphics|Vega|SwiftShader|llvmpipe|Basic Render|Mali|Adreno|PowerVR/i.test(chip);
  const strong = /Apple|NVIDIA|GeForce|RTX|GTX|Quadro|Radeon (RX|Pro)|Arc\(TM\)|Arc A/i.test(chip);
  const memory = (navigator as { deviceMemory?: number }).deviceMemory;
  if (shared && !strong) return "modest";
  if (memory !== undefined && memory <= 4) return "modest";
  return "full";
}

export const tier = chooseTier();

/** What each tier draws with. */
export const quality = {
  full: { pixelRatio: 2, smoothing: 4, shadowMap: 2048, startDetail: 1 },
  modest: { pixelRatio: 1.25, smoothing: 0, shadowMap: 1024, startDetail: 0.85 },
  light: { pixelRatio: 1.5, smoothing: 0, shadowMap: 1024, startDetail: 1 },
}[tier];

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

interface Job {
  file: string;
  order: number;
  start: () => void;
}

const waiting: Job[] = [];
const cache = new Map<string, Promise<GLTF>>();
let running = 0;
let asked = 0;
let done = 0;

function report() {
  window.dispatchEvent(new CustomEvent("models-progress", { detail: { done, total: asked } }));
}

function next() {
  // Two at a time: enough to keep the connection busy without every model competing at once.
  while (running < 2 && waiting.length) {
    waiting.sort((a, b) => a.order - b.order);
    running++;
    waiting.shift()!.start();
  }
}

/**
 * Load a model, once however many things ask for it. `order` decides the queue: the ships are 0
 * so the fleet appears first, and the things around them follow. Only the full tier gets the
 * full-size textures; the others get the lighter set, which needs a quarter of the memory.
 */
export function loadModel(file: string, order: number) {
  let pending = cache.get(file);
  if (!pending) {
    const address = tier === "full" ? file : file.replace("/models/", "/models/lite/");
    asked++;
    pending = new Promise<GLTF>((resolve, reject) => {
      waiting.push({
        file, order,
        start: () => loader.loadAsync(address).then(resolve, reject).finally(() => { running--; done++; report(); next(); }),
      });
    });
    cache.set(file, pending);
    report();
    // Let everything that is going to ask this turn join the queue before the first one starts.
    queueMicrotask(next);
  }
  return pending;
}
