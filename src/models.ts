/**
 * Phones have far less graphics memory than laptops, and a browser tab that asks for too much
 * is simply closed. So there are two sets of every model: the full one, and a lighter one with
 * smaller textures that needs about a quarter of the memory.
 */
export const light = window.matchMedia("(pointer: coarse)").matches || Math.min(window.screen.width, window.screen.height) < 700;

/** The address to load a model from on this device. `file` is its address in the full set. */
export function modelUrl(file: string) {
  return light ? file.replace("/models/", "/models/lite/") : file;
}
