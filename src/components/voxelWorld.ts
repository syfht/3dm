import * as THREE from "three";

// --- Minecraft-style voxel terrain ------------------------------------------
// A single InstancedMesh holds every visible grass block. Columns get random
// heights from layered value noise; blocks fully surrounded by neighbours are
// culled. Attacks raycast the mesh and remove the hit block.

const WORLD_RADIUS = 40; // blocks from centre on X/Z
const MAX_HEIGHT = 10;

function hash2(x: number, z: number) {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x: number, z: number) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const ux = xf * xf * (3 - 2 * xf);
  const uz = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, ux), THREE.MathUtils.lerp(c, d, ux), uz);
}

function columnHeight(x: number, z: number) {
  const base = smoothNoise(x * 0.055, z * 0.055) * 1.0;
  const mid = smoothNoise(x * 0.13, z * 0.13) * 0.45;
  const fine = smoothNoise(x * 0.31, z * 0.31) * 0.2;
  const ridge = Math.hypot(x, z) > 44 ? (Math.hypot(x, z) - 44) * 0.16 : 0;
  const h = 3 + (base + mid + fine) * 4.2 + ridge;
  return THREE.MathUtils.clamp(Math.round(h), 1, MAX_HEIGHT + 6);
}

function grassTexture(kind: "top" | "side" | "dirt") {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.Texture();

  const paintNoise = (y0: number, y1: number, base: [number, number, number], jitter: number) => {
    for (let y = y0; y < y1; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const n = (hash2(x * 3.7 + y * 1.3, y * 5.1 + x * 0.7) - 0.5) * jitter;
        ctx.fillStyle = `rgb(${Math.round(base[0] + n)},${Math.round(base[1] + n)},${Math.round(base[2] + n)})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  };

  if (kind === "top") {
    paintNoise(0, size, [104, 158, 74], 46);
  } else if (kind === "dirt") {
    paintNoise(0, size, [128, 94, 62], 42);
  } else {
    paintNoise(0, size, [128, 94, 62], 42);
    paintNoise(0, 8, [104, 158, 74], 46);
    // ragged grass fringe over the dirt
    for (let x = 0; x < size; x += 1) {
      const depth = 8 + Math.floor(hash2(x * 9.1, 3.3) * 5);
      ctx.fillStyle = `rgb(${96 + Math.floor(hash2(x, 7) * 24)},${150},${70})`;
      ctx.fillRect(x, 8, 1, depth - 8);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapNearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export type BlockCoord = [number, number, number];

export type VoxelWorld = {
  mesh: THREE.InstancedMesh;
  groundHeight: (x: number, z: number) => number;
  breakBlock: (origin: THREE.Vector3, direction: THREE.Vector3, reach: number) => boolean;
  pickBlock: (origin: THREE.Vector3, direction: THREE.Vector3, reach: number) => BlockCoord | null;
  removeBlock: (block: BlockCoord) => void;
  showBreakProgress: (block: BlockCoord | null, progress: number) => void;
  highlightBlock: (block: BlockCoord | null) => void;
  cameraClearance: (target: THREE.Vector3, toCamera: THREE.Vector3) => number;

  update: (delta: number) => void;
  dispose: () => void;
};

// Ten Minecraft-style crack stages drawn on transparent canvases.
function crackTexture(stage: number) {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.Texture();
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "rgba(0,0,0,0.85)";
  const density = (stage + 1) / 10;
  // Deterministic pseudo-cracks growing outward from the centre.
  for (let branch = 0; branch < 6; branch += 1) {
    const angle = (branch / 6) * Math.PI * 2 + hash2(branch, 1) * 0.9;
    const length = (size * 0.48) * density * (0.5 + hash2(branch, 2) * 0.7);
    let x = size / 2 + (hash2(branch, 3) - 0.5) * 4;
    let y = size / 2 + (hash2(branch, 4) - 0.5) * 4;
    const steps = Math.max(1, Math.floor(length));
    for (let step = 0; step < steps; step += 1) {
      x += Math.cos(angle) + (hash2(branch * 7 + step, 5) - 0.5) * 1.4;
      y += Math.sin(angle) + (hash2(branch * 7 + step, 6) - 0.5) * 1.4;
      if (x < 0 || y < 0 || x >= size || y >= size) break;
      ctx.fillRect(Math.floor(x), Math.floor(y), 1, 1);
      if (density > 0.55 && step % 2 === 0) ctx.fillRect(Math.floor(x) + 1, Math.floor(y), 1, 1);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  return texture;
}

export function createVoxelWorld(scene: THREE.Scene): VoxelWorld {
  const solid = new Set<string>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

  for (let x = -WORLD_RADIUS; x <= WORLD_RADIUS; x += 1) {
    for (let z = -WORLD_RADIUS; z <= WORLD_RADIUS; z += 1) {
      const top = columnHeight(x, z);
      for (let y = 0; y < top; y += 1) solid.add(key(x, y, z));
    }
  }

  const isSolid = (x: number, y: number, z: number) => solid.has(key(x, y, z));
  const exposed = (x: number, y: number, z: number) =>
    !isSolid(x + 1, y, z) ||
    !isSolid(x - 1, y, z) ||
    !isSolid(x, y + 1, z) ||
    !isSolid(x, y - 1, z) ||
    !isSolid(x, y, z + 1) ||
    !isSolid(x, y, z - 1);

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const top = new THREE.MeshStandardMaterial({ map: grassTexture("top"), roughness: 1 });
  const side = new THREE.MeshStandardMaterial({ map: grassTexture("side"), roughness: 1 });
  const dirt = new THREE.MeshStandardMaterial({ map: grassTexture("dirt"), roughness: 1 });
  const materials = [side, side, top, dirt, side, side];

  const maxInstances = solid.size;
  const mesh = new THREE.InstancedMesh(geometry, materials, maxInstances);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);

  const instanceBlocks: Array<[number, number, number]> = [];
  const matrix = new THREE.Matrix4();

  const rebuild = () => {
    instanceBlocks.length = 0;
    for (const id of solid) {
      const [x, y, z] = id.split(",").map(Number) as [number, number, number];
      if (!exposed(x, y, z)) continue;
      instanceBlocks.push([x, y, z]);
    }
    for (let index = 0; index < instanceBlocks.length; index += 1) {
      const [x, y, z] = instanceBlocks[index]!;
      matrix.makeTranslation(x + 0.5, y + 0.5, z + 0.5);
      mesh.setMatrixAt(index, matrix);
    }
    mesh.count = instanceBlocks.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  };
  rebuild();

  const groundHeight = (x: number, z: number) => {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    for (let y = MAX_HEIGHT + 8; y >= 0; y -= 1) {
      if (isSolid(bx, y, bz)) return y + 1;
    }
    return 0;
  };

  // --- break debris ---------------------------------------------------------
  const debrisGeometry = new THREE.BoxGeometry(0.16, 0.16, 0.16);
  const debris: Array<{ mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }> = [];

  const spawnDebris = (center: THREE.Vector3) => {
    for (let index = 0; index < 8; index += 1) {
      const piece = new THREE.Mesh(debrisGeometry, index % 2 === 0 ? top : dirt);
      piece.position.copy(center);
      piece.castShadow = false;
      scene.add(piece);
      debris.push({
        mesh: piece,
        velocity: new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.4, Math.random() - 0.5).multiplyScalar(3.2),
        life: 0.7,
      });
    }
  };

  const raycaster = new THREE.Raycaster();

  // --- targeting + progressive breaking -------------------------------------
  const crackTextures = Array.from({ length: 10 }, (_, stage) => crackTexture(stage));
  const crackMaterial = new THREE.MeshBasicMaterial({
    map: crackTextures[0] ?? null,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const crackMesh = new THREE.Mesh(new THREE.BoxGeometry(1.004, 1.004, 1.004), crackMaterial);
  crackMesh.visible = false;
  crackMesh.renderOrder = 2;
  scene.add(crackMesh);

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.008, 1.008, 1.008)),
    new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.55 }),
  );
  outline.visible = false;
  outline.renderOrder = 3;
  scene.add(outline);

  const removeBlock = (block: BlockCoord) => {
    if (!isSolid(block[0], block[1], block[2])) return;
    solid.delete(key(block[0], block[1], block[2]));
    spawnDebris(new THREE.Vector3(block[0] + 0.5, block[1] + 0.5, block[2] + 0.5));
    rebuild();
    crackMesh.visible = false;
    outline.visible = false;
  };

  const pickBlock = (origin: THREE.Vector3, direction: THREE.Vector3, reach: number): BlockCoord | null => {
    raycaster.set(origin, direction.clone().normalize());
    raycaster.far = reach;
    const hit = raycaster.intersectObject(mesh, false)[0];
    if (!hit || hit.instanceId === undefined) return null;
    return instanceBlocks[hit.instanceId] ?? null;
  };

  const highlightBlock = (block: BlockCoord | null) => {
    if (!block) {
      outline.visible = false;
      return;
    }
    outline.position.set(block[0] + 0.5, block[1] + 0.5, block[2] + 0.5);
    outline.visible = true;
  };

  const showBreakProgress = (block: BlockCoord | null, progress: number) => {
    if (!block || progress <= 0) {
      crackMesh.visible = false;
      return;
    }
    const stage = THREE.MathUtils.clamp(Math.floor(progress * 10), 0, 9);
    crackMaterial.map = crackTextures[stage]!;
    crackMaterial.needsUpdate = true;
    crackMesh.position.set(block[0] + 0.5, block[1] + 0.5, block[2] + 0.5);
    crackMesh.visible = true;
  };

  const breakBlock = (origin: THREE.Vector3, direction: THREE.Vector3, reach: number) => {
    const block = pickBlock(origin, direction, reach);
    if (!block) return false;
    removeBlock(block);
    return true;
  };

  const update = (delta: number) => {
    for (let index = debris.length - 1; index >= 0; index -= 1) {
      const piece = debris[index]!;
      piece.velocity.y -= 12 * delta;
      piece.mesh.position.addScaledVector(piece.velocity, delta);
      piece.mesh.rotation.x += delta * 6;
      piece.mesh.rotation.y += delta * 4;
      piece.life -= delta;
      if (piece.life <= 0) {
        scene.remove(piece.mesh);
        debris.splice(index, 1);
      }
    }
  };

  const dispose = () => {
    for (const piece of debris) scene.remove(piece.mesh);
    debris.length = 0;
    scene.remove(mesh);
    scene.remove(crackMesh);
    scene.remove(outline);
    crackMesh.geometry.dispose();
    crackMaterial.dispose();
    crackTextures.forEach((texture) => texture.dispose());
    outline.geometry.dispose();
    (outline.material as THREE.Material).dispose();
    geometry.dispose();
    debrisGeometry.dispose();
    for (const material of [top, side, dirt]) {
      material.map?.dispose();
      material.dispose();
    }
  };

  // Fraction (0..1) of the target->camera vector that stays out of blocks.
  const cameraClearance = (target: THREE.Vector3, toCamera: THREE.Vector3) => {
    const length = toCamera.length();
    if (length < 0.001) return 1;
    raycaster.set(target, toCamera.clone().normalize());
    raycaster.far = length;
    const hit = raycaster.intersectObject(mesh, false)[0];
    if (!hit) return 1;
    return Math.max(0, (hit.distance - 0.25) / length);
  };

  return {
    mesh,
    groundHeight,
    breakBlock,
    pickBlock,
    removeBlock,
    showBreakProgress,
    highlightBlock,
    cameraClearance,
    update,
    dispose,
  };

}
