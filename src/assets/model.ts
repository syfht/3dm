import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// The character model is served as a static file so the game works anywhere
// it is hosted. It is the original, uncompressed GLB.
export const MODEL_URL = "/models/mai_shiranui_kof_xv.glb";

export function createModelLoader() {
  return new GLTFLoader();
}
