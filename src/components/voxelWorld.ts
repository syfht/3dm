import * as THREE from "three";

// --- Minecraft-style voxel terrain ------------------------------------------
// One InstancedMesh per block type holds every visible block. Columns get
// random heights from layered value noise; blocks fully surrounded by
// neighbours are culled. Attacks raycast the meshes and remove the hit block.

const WORLD_RADIUS = 40; // blocks from centre on X/Z
const MAX_HEIGHT = 10;
const SCAN_HEIGHT = MAX_HEIGHT + 26; // terrain + tallest tree

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

function columnHeight(x: number, z: number, seed = 0) {
  const ox = seed * 123.456;
  const oz = seed * 789.012;
  const base = smoothNoise((x + ox) * 0.055, (z + oz) * 0.055) * 1.0;
  const mid = smoothNoise((x + ox) * 0.13, (z + oz) * 0.13) * 0.45;
  const fine = smoothNoise((x + ox) * 0.31, (z + oz) * 0.31) * 0.2;
  const ridge = Math.hypot(x, z) > 44 ? (Math.hypot(x, z) - 44) * 0.16 : 0;
  const h = 3 + (base + mid + fine) * 4.2 + ridge;
  return THREE.MathUtils.clamp(Math.round(h), 1, MAX_HEIGHT + 6);
}

type TextureKind =
  | "grass_top"
  | "grass_side"
  | "dirt"
  | "stone"
  | "wood_top"
  | "wood_side"
  | "leaves"
  | "planks"
  | "table_top"
  | "table_side"
  | "chest_top"
  | "chest_side"
  | "chest_front"
  | "furnace_side"
  | "furnace_front";

function blockTexture(kind: TextureKind) {
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

  if (kind === "grass_top") {
    paintNoise(0, size, [104, 158, 74], 46);
  } else if (kind === "dirt") {
    paintNoise(0, size, [128, 94, 62], 42);
  } else if (kind === "stone") {
    paintNoise(0, size, [124, 124, 126], 34);
    // cobble-like clumps
    for (let i = 0; i < 46; i += 1) {
      const x = Math.floor(hash2(i * 1.9, 4.2) * size);
      const y = Math.floor(hash2(i * 2.7, 8.6) * size);
      const s = 2 + Math.floor(hash2(i, 1.1) * 3);
      ctx.fillStyle = hash2(i, 6.3) > 0.5 ? "rgba(92,92,96,0.55)" : "rgba(160,160,164,0.45)";
      ctx.fillRect(x, y, s, s);
    }
  } else if (kind === "chest_top") {
    paintNoise(0, size, [148, 106, 56], 18);
    ctx.fillStyle = "rgba(62,42,20,0.85)";
    ctx.fillRect(0, 0, size, 2);
    ctx.fillRect(0, size - 2, size, 2);
    ctx.fillRect(0, 0, 2, size);
    ctx.fillRect(size - 2, 0, 2, size);
  } else if (kind === "chest_side" || kind === "chest_front") {
    paintNoise(0, size, [146, 104, 54], 18);
    ctx.fillStyle = "rgba(62,42,20,0.85)";
    ctx.fillRect(0, 10, size, 2);
    ctx.fillRect(0, 0, size, 2);
    ctx.fillRect(0, size - 2, size, 2);
    ctx.fillRect(0, 0, 2, size);
    ctx.fillRect(size - 2, 0, 2, size);
    if (kind === "chest_front") {
      // latch
      ctx.fillStyle = "rgb(216,190,96)";
      ctx.fillRect(size / 2 - 3, 8, 6, 7);
      ctx.fillStyle = "rgba(60,48,12,0.8)";
      ctx.fillRect(size / 2 - 1, 10, 2, 3);
    }
  } else if (kind === "furnace_side" || kind === "furnace_front") {
    paintNoise(0, size, [112, 112, 116], 26);
    for (let i = 0; i < 40; i += 1) {
      const x = Math.floor(hash2(i * 3.1, 2.4) * size);
      const y = Math.floor(hash2(i * 1.3, 7.1) * size);
      ctx.fillStyle = hash2(i, 5.5) > 0.5 ? "rgba(84,84,88,0.5)" : "rgba(148,148,152,0.4)";
      ctx.fillRect(x, y, 3, 3);
    }
    if (kind === "furnace_front") {
      // dark opening with a brick lip
      ctx.fillStyle = "rgb(58,54,52)";
      ctx.fillRect(6, 12, size - 12, 14);
      ctx.fillStyle = "rgb(38,34,32)";
      ctx.fillRect(8, 16, size - 16, 10);
      ctx.fillStyle = "rgba(78,78,82,0.9)";
      ctx.fillRect(6, 8, size - 12, 3);
    }
  } else if (kind === "grass_side") {
    paintNoise(0, size, [128, 94, 62], 42);
    paintNoise(0, 8, [104, 158, 74], 46);
    // ragged grass fringe over the dirt
    for (let x = 0; x < size; x += 1) {
      const depth = 8 + Math.floor(hash2(x * 9.1, 3.3) * 5);
      ctx.fillStyle = `rgb(${96 + Math.floor(hash2(x, 7) * 24)},${150},${70})`;
      ctx.fillRect(x, 8, 1, depth - 8);
    }
  } else if (kind === "wood_side") {
    paintNoise(0, size, [104, 78, 48], 26);
    // vertical bark grooves
    for (let x = 0; x < size; x += 1) {
      if (hash2(x * 5.3, 1.7) > 0.68) {
        ctx.fillStyle = `rgba(56,40,24,${0.25 + hash2(x, 9) * 0.3})`;
        ctx.fillRect(x, 0, 1, size);
      }
    }
  } else if (kind === "wood_top") {
    paintNoise(0, size, [156, 120, 76], 22);
    // concentric rings
    ctx.strokeStyle = "rgba(96,68,40,0.55)";
    for (let r = 3; r < size / 2; r += 4) {
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (kind === "leaves") {
    paintNoise(0, size, [72, 124, 56], 54);
    // darker speckles + a few transparent-looking gaps
    for (let i = 0; i < 90; i += 1) {
      const x = Math.floor(hash2(i, 2.1) * size);
      const y = Math.floor(hash2(i, 5.4) * size);
      ctx.fillStyle = hash2(i, 7.7) > 0.5 ? "rgba(36,72,32,0.85)" : "rgba(122,168,86,0.7)";
      ctx.fillRect(x, y, 2, 2);
    }
  } else if (kind === "planks") {
    paintNoise(0, size, [162, 124, 76], 20);
    ctx.fillStyle = "rgba(92,64,36,0.75)";
    for (let y = 0; y < size; y += 8) ctx.fillRect(0, y, size, 1);
    for (let y = 0; y < size; y += 8) {
      const seam = Math.floor(hash2(y, 3.9) * size);
      ctx.fillRect(seam, y, 1, 8);
    }
  } else if (kind === "table_top") {
    paintNoise(0, size, [150, 112, 68], 18);
    ctx.fillStyle = "rgba(76,52,30,0.8)";
    ctx.fillRect(0, 0, size, 2);
    ctx.fillRect(0, size - 2, size, 2);
    ctx.fillRect(0, 0, 2, size);
    ctx.fillRect(size - 2, 0, 2, size);
    // 2x2 grid engraved on the surface
    ctx.fillStyle = "rgba(58,40,22,0.85)";
    ctx.fillRect(size / 2 - 1, 4, 2, size - 8);
    ctx.fillRect(4, size / 2 - 1, size - 8, 2);
  } else {
    // table_side: planks with a tool strip near the top
    paintNoise(0, size, [148, 110, 66], 20);
    ctx.fillStyle = "rgba(84,58,32,0.8)";
    ctx.fillRect(0, 10, size, 2);
    ctx.fillStyle = "rgba(60,42,24,0.7)";
    for (let x = 2; x < size; x += 6) ctx.fillRect(x, 2, 2, 7);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapNearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export type BlockCoord = [number, number, number];

export type BlockType =
  | "grass"
  | "stone"
  | "wood"
  | "leaves"
  | "planks"
  | "crafting_table"
  | "chest"
  | "furnace";

export const BLOCK_TYPES: BlockType[] = [
  "grass",
  "stone",
  "wood",
  "leaves",
  "planks",
  "crafting_table",
  "chest",
  "furnace",
];

// A single block change made by a player (block === null means it was mined).
export type WorldEdit = { x: number; y: number; z: number; block: BlockType | null };

export type WorldOptions = {
  seed?: number;
  edits?: WorldEdit[];
  onEdit?: (edit: WorldEdit) => void;
};

export type VoxelWorld = {
  applyRemoteEdit: (edit: WorldEdit) => void;
  groundHeight: (x: number, z: number, fromY?: number) => number;
  breakBlock: (origin: THREE.Vector3, direction: THREE.Vector3, reach: number) => boolean;
  pickBlock: (origin: THREE.Vector3, direction: THREE.Vector3, reach: number) => BlockCoord | null;
  blockTypeAt: (block: BlockCoord) => BlockType | null;
  placeBlock: (
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    reach: number,
    playerPosition: THREE.Vector3,
    type: BlockType,
  ) => boolean;
  removeBlock: (block: BlockCoord) => void;
  showBreakProgress: (block: BlockCoord | null, progress: number) => void;
  highlightBlock: (block: BlockCoord | null) => void;
  cameraClearance: (target: THREE.Vector3, toCamera: THREE.Vector3) => number;
  makeBlockMesh: (size: number, type?: BlockType) => THREE.Mesh;
  update: (
    delta: number,
    playerPosition?: THREE.Vector3,
    onCollect?: (type: BlockType) => void,
  ) => void;
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

export function createVoxelWorld(scene: THREE.Scene, options: WorldOptions = {}): VoxelWorld {
  const solid = new Map<string, BlockType>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  // Every player in the same online world generates from the same seed, so
  // the terrain is identical for everyone.
  const seed = options.seed ?? 0;
  const seedNoise = (x: number, z: number) => hash2(x + seed * 31.7, z - seed * 17.3);

  for (let x = -WORLD_RADIUS; x <= WORLD_RADIUS; x += 1) {
    for (let z = -WORLD_RADIUS; z <= WORLD_RADIUS; z += 1) {
      const top = columnHeight(x, z, seed);
      // Grass/dirt skin is 4-5 blocks deep; everything under it is stone.
      const soil = seedNoise(x * 4.4 + 2.1, z * 6.8 + 9.7) > 0.5 ? 5 : 4;
      for (let y = 0; y < top; y += 1) {
        solid.set(key(x, y, z), y >= top - soil ? "grass" : "stone");
      }
    }
  }

  // --- trees ---------------------------------------------------------------
  const trees: Array<[number, number]> = [];
  for (let x = -WORLD_RADIUS + 3; x <= WORLD_RADIUS - 3; x += 1) {
    for (let z = -WORLD_RADIUS + 3; z <= WORLD_RADIUS - 3; z += 1) {
      if (seedNoise(x * 1.7 + 11.3, z * 2.3 + 7.1) < 0.978) continue;
      if (Math.hypot(x, z) < 5) continue; // keep the spawn area clear
      if (trees.some(([tx, tz]) => Math.abs(tx - x) < 5 && Math.abs(tz - z) < 5)) continue;
      trees.push([x, z]);
      const base = columnHeight(x, z, seed);
      const trunk = 4 + Math.floor(seedNoise(x * 3.1, z * 5.7) * 3);
      for (let y = base; y < base + trunk; y += 1) solid.set(key(x, y, z), "wood");
      const crown = base + trunk;
      // leaf canopy: two wide layers, then a tapered cap
      for (let dy = -2; dy <= 1; dy += 1) {
        const radius = dy <= -1 ? 2 : dy === 0 ? 2 : 1;
        for (let dx = -radius; dx <= radius; dx += 1) {
          for (let dz = -radius; dz <= radius; dz += 1) {
            if (Math.abs(dx) === radius && Math.abs(dz) === radius && radius > 1) continue;
            const ly = crown + dy;
            const lx = x + dx;
            const lz = z + dz;
            if (solid.get(key(lx, ly, lz)) === "wood") continue;
            if (solid.has(key(lx, ly, lz))) continue;
            solid.set(key(lx, ly, lz), "leaves");
          }
        }
      }
      solid.set(key(x, crown + 2, z), "leaves");
    }
  }

  // Replay every block other players already mined or placed in this world.
  for (const edit of options.edits ?? []) {
    if (edit.block) solid.set(key(edit.x, edit.y, edit.z), edit.block);
    else solid.delete(key(edit.x, edit.y, edit.z));
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

  const texture = (kind: TextureKind) => blockTexture(kind);
  const mat = (kind: TextureKind) =>
    new THREE.MeshStandardMaterial({ map: texture(kind), roughness: 1 });

  const grassTop = mat("grass_top");
  const grassSide = mat("grass_side");
  const dirt = mat("dirt");
  const woodTop = mat("wood_top");
  const woodSide = mat("wood_side");
  const leaves = mat("leaves");
  const planks = mat("planks");
  const tableTop = mat("table_top");
  const tableSide = mat("table_side");
  const stone = mat("stone");
  const chestTop = mat("chest_top");
  const chestSide = mat("chest_side");
  const chestFront = mat("chest_front");
  const furnaceSide = mat("furnace_side");
  const furnaceFront = mat("furnace_front");

  const allMaterials = [
    grassTop, grassSide, dirt, woodTop, woodSide, leaves, planks, tableTop, tableSide,
    stone, chestTop, chestSide, chestFront, furnaceSide, furnaceFront,
  ];

  // material order: +x, -x, +y, -y, +z, -z
  const materialsByType: Record<BlockType, THREE.Material[]> = {
    grass: [grassSide, grassSide, grassTop, dirt, grassSide, grassSide],
    stone: [stone, stone, stone, stone, stone, stone],
    wood: [woodSide, woodSide, woodTop, woodTop, woodSide, woodSide],
    leaves: [leaves, leaves, leaves, leaves, leaves, leaves],
    planks: [planks, planks, planks, planks, planks, planks],
    crafting_table: [tableSide, tableSide, tableTop, planks, tableSide, tableSide],
    chest: [chestSide, chestSide, chestTop, chestTop, chestFront, chestSide],
    furnace: [furnaceSide, furnaceSide, stone, stone, furnaceFront, furnaceSide],
  };

  type Layer = { mesh: THREE.InstancedMesh; blocks: BlockCoord[]; capacity: number };
  const layers = {} as Record<BlockType, Layer>;
  const matrix = new THREE.Matrix4();

  const makeLayer = (type: BlockType, capacity: number): Layer => {
    const mesh = new THREE.InstancedMesh(geometry, materialsByType[type], capacity);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    scene.add(mesh);
    return { mesh, blocks: [], capacity };
  };

  for (const type of BLOCK_TYPES) layers[type] = makeLayer(type, 1024);

  const rebuild = () => {
    const buckets = Object.fromEntries(
      BLOCK_TYPES.map((type) => [type, [] as BlockCoord[]]),
    ) as Record<BlockType, BlockCoord[]>;
    for (const [id, type] of solid) {
      const [x, y, z] = id.split(",").map(Number) as BlockCoord;
      if (!exposed(x, y, z)) continue;
      buckets[type].push([x, y, z]);
    }
    for (const type of BLOCK_TYPES) {
      const list = buckets[type];
      let layer = layers[type];
      if (list.length > layer.capacity) {
        scene.remove(layer.mesh);
        layer.mesh.dispose();
        layer = makeLayer(type, Math.max(1024, list.length * 2));
        layers[type] = layer;
      }
      layer.blocks = list;
      for (let index = 0; index < list.length; index += 1) {
        const [x, y, z] = list[index]!;
        matrix.makeTranslation(x + 0.5, y + 0.5, z + 0.5);
        layer.mesh.setMatrixAt(index, matrix);
      }
      layer.mesh.count = list.length;
      layer.mesh.instanceMatrix.needsUpdate = true;
      layer.mesh.computeBoundingSphere();
    }
  };
  rebuild();

  const pickMeshes = () => BLOCK_TYPES.map((type) => layers[type].mesh);

  // A single textured block matching a world material (held item, previews).
  const makeBlockMesh = (size: number, type: BlockType = "grass") => {
    const block = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), materialsByType[type]);
    block.castShadow = true;
    return block;
  };

  // Highest solid top at or below fromY (defaults to a full top-down scan).
  // Passing the feet height keeps overhead blocks (tree canopies) from
  // counting as ground.
  const groundHeight = (x: number, z: number, fromY = SCAN_HEIGHT) => {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    for (let y = Math.min(SCAN_HEIGHT, Math.ceil(fromY)); y >= 0; y -= 1) {
      if (isSolid(bx, y, bz)) return y + 1;
    }
    return 0;
  };

  const blockTypeAt = (block: BlockCoord) => solid.get(key(block[0], block[1], block[2])) ?? null;

  // --- dropped block items (collectable pickups) -----------------------------
  const dropGeometry = new THREE.BoxGeometry(0.32, 0.32, 0.32);
  type Drop = { mesh: THREE.Mesh; velocity: THREE.Vector3; bob: number; type: BlockType };
  const drops: Drop[] = [];

  // Dropped items fall through foliage so they land on reachable ground
  // instead of resting on top of a canopy.
  const dropFloor = (x: number, z: number, fromY: number) => {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    for (let y = Math.min(SCAN_HEIGHT, Math.ceil(fromY)); y >= 0; y -= 1) {
      const type = solid.get(key(bx, y, bz));
      if (type && type !== "leaves") return y + 1;
    }
    return 0;
  };

  const spawnDrop = (block: BlockCoord, type: BlockType) => {
    const piece = new THREE.Mesh(dropGeometry, materialsByType[type]);
    piece.castShadow = true;
    piece.position.set(block[0] + 0.5, block[1] + 0.5, block[2] + 0.5);
    piece.rotation.y = Math.random() * Math.PI;
    scene.add(piece);
    drops.push({
      mesh: piece,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 0.9, 2.1, (Math.random() - 0.5) * 0.9),
      bob: Math.random() * Math.PI * 2,
      type,
    });
  };

  // --- break debris ---------------------------------------------------------
  const debrisGeometry = new THREE.BoxGeometry(0.16, 0.16, 0.16);
  const debris: Array<{ mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }> = [];

  const spawnDebris = (center: THREE.Vector3, type: BlockType) => {
    const faces = materialsByType[type];
    for (let index = 0; index < 8; index += 1) {
      const piece = new THREE.Mesh(debrisGeometry, faces[index % faces.length]!);
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
    const type = blockTypeAt(block);
    if (!type) return;
    solid.delete(key(block[0], block[1], block[2]));
    spawnDebris(new THREE.Vector3(block[0] + 0.5, block[1] + 0.5, block[2] + 0.5), type);
    spawnDrop(block, type);
    rebuild();
    crackMesh.visible = false;
    outline.visible = false;
    options.onEdit?.({ x: block[0], y: block[1], z: block[2], block: null });
  };

  // A change made by another player: no drops for us, just the world update.
  const applyRemoteEdit = (edit: WorldEdit) => {
    const id = key(edit.x, edit.y, edit.z);
    const current = solid.get(id) ?? null;
    if (current === edit.block) return;
    if (edit.block) {
      solid.set(id, edit.block);
    } else {
      if (current) spawnDebris(new THREE.Vector3(edit.x + 0.5, edit.y + 0.5, edit.z + 0.5), current);
      solid.delete(id);
    }
    rebuild();
  };


  const rayHit = (origin: THREE.Vector3, direction: THREE.Vector3, reach: number) => {
    raycaster.set(origin, direction.clone().normalize());
    raycaster.far = reach;
    const hits = raycaster.intersectObjects(pickMeshes(), false);
    const hit = hits[0];
    if (!hit || hit.instanceId === undefined) return null;
    const layer = BLOCK_TYPES.map((type) => layers[type]).find((entry) => entry.mesh === hit.object);
    const block = layer?.blocks[hit.instanceId];
    if (!block) return null;
    return { block, normal: hit.face?.normal ?? null };
  };

  const pickBlock = (origin: THREE.Vector3, direction: THREE.Vector3, reach: number) =>
    rayHit(origin, direction, reach)?.block ?? null;

  // Place a block against the face the ray hits (the empty cell in front of it).
  const placeBlock = (
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    reach: number,
    playerPosition: THREE.Vector3,
    type: BlockType,
  ) => {
    const hit = rayHit(origin, direction, reach);
    if (!hit || !hit.normal) return false;
    const { block, normal } = hit;
    const target: BlockCoord = [
      block[0] + Math.round(normal.x),
      block[1] + Math.round(normal.y),
      block[2] + Math.round(normal.z),
    ];
    if (target[1] < 0 || isSolid(target[0], target[1], target[2])) return false;
    // Never seal the player inside a block.
    const px = Math.floor(playerPosition.x);
    const pz = Math.floor(playerPosition.z);
    const feet = Math.floor(playerPosition.y + 0.05);
    if (target[0] === px && target[2] === pz && (target[1] === feet || target[1] === feet + 1)) {
      return false;
    }
    solid.set(key(target[0], target[1], target[2]), type);
    rebuild();
    options.onEdit?.({ x: target[0], y: target[1], z: target[2], block: type });
    return true;
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

  const update = (
    delta: number,
    playerPosition?: THREE.Vector3,
    onCollect?: (type: BlockType) => void,
  ) => {
    for (let index = drops.length - 1; index >= 0; index -= 1) {
      const drop = drops[index]!;
      const p = drop.mesh.position;
      if (playerPosition) {
        const dx = playerPosition.x - p.x;
        const dy = playerPosition.y + 0.8 - p.y;
        const dz = playerPosition.z - p.z;
        const distance = Math.hypot(dx, dy, dz);
        if (distance < 1.3) {
          scene.remove(drop.mesh);
          drops.splice(index, 1);
          onCollect?.(drop.type);
          continue;
        }
        if (distance < 4.2) {
          // Vacuum the drop toward the player, Minecraft style.
          p.x += (dx / distance) * delta * 6;
          p.y += (dy / distance) * delta * 6;
          p.z += (dz / distance) * delta * 6;
          drop.mesh.rotation.y += delta * 3.5;
          continue;
        }
      }
      drop.bob += delta * 2.4;
      drop.mesh.rotation.y += delta * 1.2;
      drop.velocity.y -= 14 * delta;
      p.addScaledVector(drop.velocity, delta);
      drop.velocity.x *= Math.exp(-3 * delta);
      drop.velocity.z *= Math.exp(-3 * delta);
      const rest = dropFloor(p.x, p.z, p.y) + 0.17 + Math.sin(drop.bob) * 0.05;
      if (p.y <= rest) {
        p.y = rest;
        drop.velocity.set(0, 0, 0);
      }
    }

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
    for (const drop of drops) scene.remove(drop.mesh);
    drops.length = 0;
    dropGeometry.dispose();
    for (const type of BLOCK_TYPES) {
      scene.remove(layers[type].mesh);
      layers[type].mesh.dispose();
    }
    scene.remove(crackMesh);
    scene.remove(outline);
    crackMesh.geometry.dispose();
    crackMaterial.dispose();
    crackTextures.forEach((entry) => entry.dispose());
    outline.geometry.dispose();
    (outline.material as THREE.Material).dispose();
    geometry.dispose();
    debrisGeometry.dispose();
    for (const material of allMaterials) {
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
    const hit = raycaster.intersectObjects(pickMeshes(), false)[0];
    if (!hit) return 1;
    return Math.max(0, (hit.distance - 0.25) / length);
  };

  return {
    applyRemoteEdit,
    groundHeight,
    breakBlock,
    pickBlock,
    blockTypeAt,
    placeBlock,
    removeBlock,
    showBreakProgress,
    highlightBlock,
    cameraClearance,
    makeBlockMesh,
    update,
    dispose,
  };
}
