import { useEffect, useRef, useState } from "react";
import { Eye, PersonStanding } from "lucide-react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import modelAsset from "@/assets/mai_shiranui_kof_xv.glb.asset.json";
import { createVoxelWorld, type BlockType } from "./voxelWorld";
import InventoryPanel from "./InventoryPanel";
import MobileControls from "./MobileControls";
import {
  BLOCK_LABEL,
  BREAK_TIMES,
  HOTBAR_SIZE,
  INVENTORY_SIZE,
  STACK_LIMIT,
  craftResult,
  type Slot,
} from "./inventory";

const MODEL_URL = modelAsset.url;

type KeyState = Record<string, boolean>;

type SpringBone = {
  bone: THREE.Object3D;
  rest: THREE.Quaternion;
  kind: "hair" | "chest" | "butt" | "cloth" | "accessory";
  valueX: number;
  valueZ: number;
  velocityX: number;
  velocityZ: number;
  weight: number;
};

const BONE_NAMES = {
  hips: "C_Hips_",
  spine: "C_Spine1_",
  chest: "C_Chest_",
  head: "C_Head_",
  leftUpperArm: "L_Arm1_",
  rightUpperArm: "R_Arm1_",
  leftLowerArm: "L_Arm2_",
  rightLowerArm: "R_Arm2_",
  leftUpperLeg: "L_Leg1_",
  rightUpperLeg: "R_Leg1_",
  leftLowerLeg: "L_Leg2_",
  rightLowerLeg: "R_Leg2_",
  leftFoot: "L_Foot_",
  rightFoot: "R_Foot_",
} as const;

function findBone(root: THREE.Object3D, partial: string) {
  let found: THREE.Object3D | undefined;
  root.traverse((child) => {
    if (!found && child.name.startsWith(partial)) found = child;
  });
  return found;
}


export default function TerrainGame() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [moving, setMoving] = useState(false);
  const [attackLabel, setAttackLabel] = useState<string | null>(null);
  const [inventory, setInventory] = useState<Slot[]>(() =>
    Array.from({ length: INVENTORY_SIZE }, () => null),
  );
  const [selectedSlot, setSelectedSlot] = useState(0);
  const [invOpen, setInvOpen] = useState(false);
  const [craftOpen, setCraftOpen] = useState(false);
  const [craftGrid, setCraftGrid] = useState<Slot[]>(() => [null, null, null, null]);
  const [tableGrid, setTableGrid] = useState<Slot[]>(() => Array.from({ length: 9 }, () => null));
  const [cursor, setCursor] = useState<Slot>(null);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const invRef = useRef<Slot[]>(inventory);
  const craftRef = useRef<Slot[]>(craftGrid);
  const tableRef = useRef<Slot[]>(tableGrid);
  const cursorRef = useRef<Slot>(null);
  const selectedRef = useRef(0);
  const invOpenRef = useRef(false);
  const craftOpenRef = useRef(false);

  const syncInventory = () => setInventory([...invRef.current]);
  const syncCraft = () => setCraftGrid([...craftRef.current]);
  const syncTable = () => setTableGrid([...tableRef.current]);
  const anyMenuOpen = () => invOpenRef.current || craftOpenRef.current;

  // Merge a stack into the inventory, filling partial stacks first.
  const addStack = (type: BlockType, count: number) => {
    const list = invRef.current;
    let left = count;
    for (let index = 0; index < list.length && left > 0; index += 1) {
      const slot = list[index];
      if (slot && slot.type === type && slot.count < STACK_LIMIT) {
        const move = Math.min(left, STACK_LIMIT - slot.count);
        list[index] = { type, count: slot.count + move };
        left -= move;
      }
    }
    for (let index = 0; index < list.length && left > 0; index += 1) {
      if (list[index] === null) {
        const move = Math.min(left, STACK_LIMIT);
        list[index] = { type, count: move };
        left -= move;
      }
    }
    syncInventory();
  };

  const handleSlotClick = (area: "inv" | "craft" | "craft3", index: number, right: boolean) => {
    const list = area === "inv" ? invRef.current : area === "craft" ? craftRef.current : tableRef.current;
    const slot = list[index] ?? null;
    let held = cursorRef.current;
    if (!held) {
      if (!slot) return;
      if (right) {
        const take = Math.ceil(slot.count / 2);
        held = { type: slot.type, count: take };
        const rest = slot.count - take;
        list[index] = rest > 0 ? { type: slot.type, count: rest } : null;
      } else {
        held = slot;
        list[index] = null;
      }
    } else if (!slot) {
      if (right) {
        list[index] = { type: held.type, count: 1 };
        held = held.count > 1 ? { type: held.type, count: held.count - 1 } : null;
      } else {
        list[index] = held;
        held = null;
      }
    } else if (slot.type === held.type) {
      if (right) {
        if (slot.count < STACK_LIMIT) {
          list[index] = { type: slot.type, count: slot.count + 1 };
          held = held.count > 1 ? { type: held.type, count: held.count - 1 } : null;
        }
      } else {
        const move = Math.min(held.count, STACK_LIMIT - slot.count);
        list[index] = { type: slot.type, count: slot.count + move };
        held = held.count - move > 0 ? { type: held.type, count: held.count - move } : null;
      }
    } else if (!right) {
      list[index] = held;
      held = slot;
    }
    cursorRef.current = held;
    setCursor(held);
    if (area === "inv") syncInventory();
    else if (area === "craft") syncCraft();
    else syncTable();
  };

  const handleTakeResult = (right: boolean, table = false) => {
    const gridRef = table ? tableRef : craftRef;
    const syncGrid = table ? syncTable : syncCraft;
    const result = craftResult(gridRef.current);
    if (!result) return;
    const held = cursorRef.current;
    if (held && (held.type !== result.type || held.count + result.count > STACK_LIMIT)) return;
    // Consume one item from every filled crafting cell.
    gridRef.current = gridRef.current.map((slot) =>
      slot ? (slot.count > 1 ? { type: slot.type, count: slot.count - 1 } : null) : null,
    );
    syncGrid();
    if (right) {
      addStack(result.type, result.count);
      return;
    }
    const next: Slot = held
      ? { type: held.type, count: held.count + result.count }
      : { type: result.type, count: result.count };
    cursorRef.current = next;
    setCursor(next);
  };

  // Closing returns the cursor stack and crafting grid to the inventory.
  const closeGridPanel = (
    gridRef: typeof craftRef,
    syncGrid: () => void,
    setOpen: (open: boolean) => void,
    openRef: typeof invOpenRef,
  ) => {
    const held = cursorRef.current;
    if (held) addStack(held.type, held.count);
    cursorRef.current = null;
    setCursor(null);
    gridRef.current.forEach((slot, index) => {
      if (slot) addStack(slot.type, slot.count);
      gridRef.current[index] = null;
    });
    syncGrid();
    openRef.current = false;
    setOpen(false);
  };

  const closeInventory = () => closeGridPanel(craftRef, syncCraft, setInvOpen, invOpenRef);
  const closeCrafting = () => closeGridPanel(tableRef, syncTable, setCraftOpen, craftOpenRef);

  const openCrafting = () => {
    if (anyMenuOpen()) return;
    craftOpenRef.current = true;
    setCraftOpen(true);
    if (document.pointerLockElement) document.exitPointerLock();
  };

  // Touch control bridge: the render loop reads these each frame.
  const touchMoveRef = useRef({ x: 0, y: 0 });
  const touchJumpRef = useRef(false);
  const touchPlaceRef = useRef(false);
  const [isTouch, setIsTouch] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [firstPerson, setFirstPerson] = useState(false);
  const toggleViewRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)");
    const tall = window.matchMedia("(orientation: portrait)");
    const sync = () => {
      const touch = coarse.matches || navigator.maxTouchPoints > 0 || "ontouchstart" in window;
      setIsTouch(touch);
      setPortrait(touch && tall.matches);
    };
    sync();
    coarse.addEventListener("change", sync);
    tall.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    return () => {
      coarse.removeEventListener("change", sync);
      tall.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);





  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xa8c5ce);
    scene.fog = new THREE.FogExp2(0xa8c5ce, 0.012);

    const camera = new THREE.PerspectiveCamera(52, host.clientWidth / host.clientHeight, 0.06, 300);
    camera.position.set(0, 2.4, 5.4);

    // ?lowfx renders without shadows for low-power/software renderers.
    const lowFx = window.location.search.includes("lowfx");
    const renderer = new THREE.WebGLRenderer({ antialias: !lowFx, powerPreference: "high-performance" });
    renderer.setPixelRatio(lowFx ? 1 : Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.shadowMap.enabled = !lowFx;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    host.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xd8eff2, 0x526344, 2.2));
    const sun = new THREE.DirectionalLight(0xfff2d2, 4.2);
    sun.position.set(-18, 26, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    scene.add(sun);
    const world = createVoxelWorld(scene);

    // --- inventory -----------------------------------------------------------
    const addToInventory = (type: BlockType) => addStack(type, 1);
    const takeFromInventory = (index: number) => {
      const slot = invRef.current[index];
      if (!slot) return false;
      const next = slot.count - 1;
      invRef.current[index] = next > 0 ? { type: slot.type, count: next } : null;
      setInventory([...invRef.current]);
      return true;
    };
    const lastAimOrigin = new THREE.Vector3();
    const lastAimDirection = new THREE.Vector3(0, 0, 1);

    const keys: KeyState = {};
    const character = new THREE.Group();
    character.position.set(0.5, world.groundHeight(0.5, 0.5), 0.5);
    scene.add(character);

    let model: THREE.Object3D | undefined;
    let modelBaseY = 0;
    let walkTime = 0;
    let verticalVelocity = 0;
    let grounded = true;
    let visualStepOffset = 0;
    let landingImpact = 0;
    let airborneBlend = 0;
    let cameraYaw = 0;
    let cameraPitch = 0.12;
    let cameraDistance = 4.2;
    let firstPersonView = false;
    toggleViewRef.current = () => {
      firstPersonView = !firstPersonView;
      cameraPitch = THREE.MathUtils.clamp(cameraPitch, -1.2, 1.2);
      setFirstPerson(firstPersonView);
    };
    // A full voxel can be stepped onto; the model eases up visually below.
    const STEP_TOLERANCE = 0.02; // only float noise: no automatic step-up onto higher blocks
    const STEP_CLIMB_SPEED = 4.2; // blocks per second when the ground rises under a standing player
    type AttackMode = "punch" | "combo" | "kick";
    type PoseMap = Map<THREE.Object3D, THREE.Quaternion>;
    const ATTACK_DURATIONS: Record<AttackMode, number> = { punch: 0.72, combo: 1.3, kick: 0.9 };
    let attackTime = 0;
    let attackMode: AttackMode | null = null;
    let pendingHits = 0;
    // Progressive (Minecraft-style) block breaking.
    let miningHeld = false;
    let miningProgress = 0;
    let miningBlock: [number, number, number] | null = null;
    let attackBonus = 0;

    let windupPose: PoseMap | undefined;
    let strikePose: PoseMap | undefined;
    let jabWindupPose: PoseMap | undefined;
    let jabStrikePose: PoseMap | undefined;
    let kickWindupPose: PoseMap | undefined;
    let kickStrikePose: PoseMap | undefined;
    let airbornePose: PoseMap | undefined;
    // Held item: one block mesh per type, parented to the right hand.
    let handAttach: THREE.Object3D | null = null;
    let handScale = 1;
    const heldMeshes = new Map<BlockType, THREE.Mesh>();
    let heldType: BlockType | null = null;

    let previousSpeed = 0;
    let previousVerticalVelocity = 0;
    let locomotionBlend = 0;
    let turnImpulse = 0;
    const previousWorldVelocity = new THREE.Vector3();
    const worldVelocity = new THREE.Vector3();
    const worldAcceleration = new THREE.Vector3();
    const localAcceleration = new THREE.Vector3();
    let lastMovingState = false;
    const restRotations = new Map<THREE.Object3D, THREE.Quaternion>();
    const bones: Partial<Record<keyof typeof BONE_NAMES, THREE.Object3D>> = {};
    const springBones: SpringBone[] = [];
    const clock = new THREE.Clock();

    const loader = new GLTFLoader();
    loader.load(MODEL_URL, (gltf) => {
      const loadedModel = gltf.scene;
      model = loadedModel;
       // The scene root contains the source coordinate-system conversion.
      loadedModel.rotation.set(0, 0, 0);
      loadedModel.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(loadedModel);
      const size = box.getSize(new THREE.Vector3());
      const scale = 1.72 / Math.max(size.y, 0.001);
      loadedModel.scale.setScalar(scale);
      loadedModel.updateMatrixWorld(true);
      const adjustedBox = new THREE.Box3().setFromObject(loadedModel);
      loadedModel.position.y = -adjustedBox.min.y;
      modelBaseY = loadedModel.position.y;
      loadedModel.traverse((node) => {
        if ((node as THREE.Mesh).isMesh) {
          const mesh = node as THREE.Mesh;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
        if ((node as THREE.Bone).isBone) restRotations.set(node, node.quaternion.clone());
      });

      for (const [key, value] of Object.entries(BONE_NAMES)) {
        const bone = findBone(loadedModel, value);
        if (bone) bones[key as keyof typeof BONE_NAMES] = bone;
      }

      // Held block: shows the selected hotbar block in the right hand.
      const handBone = findBone(loadedModel, "R_Hand_Attach") ?? findBone(loadedModel, "R_Hand_");
      if (handBone) {
        handBone.updateWorldMatrix(true, false);
        handAttach = handBone;
        handScale = handBone.getWorldScale(new THREE.Vector3()).x || 1;
      }

      // The GLB ships in a T-pose with no animation clips, so bake a relaxed
      // standing pose into the rest rotations by aiming each limb bone at a
      // desired world-space direction (model forward is +Z).
      const aimBone = (
        bone: THREE.Object3D | undefined,
        makeTarget: (currentDirection: THREE.Vector3, side: number) => THREE.Vector3,
        store: Map<THREE.Object3D, THREE.Quaternion> = restRotations,
      ) => {
        if (!bone || !bone.parent) return;
        const childBone = bone.children.find((child) => (child as THREE.Bone).isBone);
        if (!childBone) return;
        loadedModel.updateMatrixWorld(true);
        const origin = bone.getWorldPosition(new THREE.Vector3());
        const direction = childBone.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
        const side = direction.x >= 0 ? 1 : -1;
        const target = makeTarget(direction, side).normalize();
        const worldDelta = new THREE.Quaternion().setFromUnitVectors(direction, target);
        const parentWorld = bone.parent.getWorldQuaternion(new THREE.Quaternion());
        const currentLocal = bone.quaternion.clone();
        bone.quaternion
          .copy(parentWorld)
          .invert()
          .multiply(worldDelta)
          .multiply(parentWorld)
          .multiply(currentLocal);

        bone.updateMatrixWorld(true);
        store.set(bone, bone.quaternion.clone());
      };

      // Capture a keyframe pose (without disturbing the standing rest pose).
      const capturePose = (
        aims: Array<[THREE.Object3D | undefined, (dir: THREE.Vector3, side: number) => THREE.Vector3]>,
      ) => {
        const pose = new Map<THREE.Object3D, THREE.Quaternion>();
        const saved = new Map<THREE.Object3D, THREE.Quaternion>();
        aims.forEach(([bone]) => { if (bone) saved.set(bone, bone.quaternion.clone()); });
        aims.forEach(([bone, target]) => aimBone(bone, target, pose));
        saved.forEach((quaternion, bone) => bone.quaternion.copy(quaternion));
        loadedModel.updateMatrixWorld(true);
        return pose;
      };

      // Arms hang down from the shoulders instead of stretching sideways.
      aimBone(bones.leftUpperArm, (_dir, side) => new THREE.Vector3(side * 0.3, -0.95, 0.04));
      aimBone(bones.rightUpperArm, (_dir, side) => new THREE.Vector3(side * 0.5, -0.82, -0.2));
      // Left forearm relaxed, right forearm folded in so the hand rests on the hip.
      aimBone(bones.leftLowerArm, (_dir, side) => new THREE.Vector3(side * 0.12, -0.98, 0.1));
      aimBone(bones.rightLowerArm, (_dir, side) => new THREE.Vector3(-side * 0.42, -0.84, 0.32));

      // Legs brought together, knees and feet straightened under the hips.
      aimBone(bones.leftUpperLeg, (_dir, side) => new THREE.Vector3(-side * 0.055, -1, 0));
      aimBone(bones.rightUpperLeg, (_dir, side) => new THREE.Vector3(-side * 0.055, -1, 0));
      aimBone(bones.leftLowerLeg, (_dir, side) => new THREE.Vector3(side * 0.03, -1, 0.02));
      aimBone(bones.rightLowerLeg, (_dir, side) => new THREE.Vector3(side * 0.03, -1, 0.02));
      loadedModel.updateMatrixWorld(true);

      // Attack keyframes: wind up with the right fist drawn back, then a
      // straight punch fully extended forward (model forward is +Z).
      windupPose = capturePose([
        [bones.rightUpperArm, (_d, side) => new THREE.Vector3(side * 0.55, -0.4, -0.6)],
        [bones.rightLowerArm, (_d, side) => new THREE.Vector3(-side * 0.7, 0.15, 0.2)],
        [bones.leftUpperArm, (_d, side) => new THREE.Vector3(side * 0.7, -0.35, 0.4)],
        [bones.leftLowerArm, (_d, side) => new THREE.Vector3(-side * 0.15, 0.05, 0.95)],
      ]);
      strikePose = capturePose([
        [bones.rightUpperArm, (_d, side) => new THREE.Vector3(side * 0.26, -0.14, 0.95)],
        [bones.rightLowerArm, (_d, side) => new THREE.Vector3(side * 0.06, -0.06, 1)],
        [bones.leftUpperArm, (_d, side) => new THREE.Vector3(side * 0.62, -0.45, -0.4)],
        [bones.leftLowerArm, (_d, side) => new THREE.Vector3(-side * 0.4, -0.1, -0.3)],
      ]);

      // Combo first hit: a left jab (right hand stays guarding the face).
      jabWindupPose = capturePose([
        [bones.leftUpperArm, (_d, side) => new THREE.Vector3(side * 0.42, -0.5, -0.62)],
        [bones.leftLowerArm, (_d, side) => new THREE.Vector3(-side * 0.6, 0.12, 0.32)],
        [bones.rightUpperArm, (_d, side) => new THREE.Vector3(side * 0.45, -0.62, 0.3)],
        [bones.rightLowerArm, (_d, side) => new THREE.Vector3(-side * 0.5, 0.2, 0.55)],
      ]);
      jabStrikePose = capturePose([
        [bones.leftUpperArm, (_d, side) => new THREE.Vector3(side * 0.14, -0.1, 0.98)],
        [bones.leftLowerArm, (_d, side) => new THREE.Vector3(side * 0.04, -0.04, 1)],
        [bones.rightUpperArm, (_d, side) => new THREE.Vector3(side * 0.45, -0.62, 0.3)],
        [bones.rightLowerArm, (_d, side) => new THREE.Vector3(-side * 0.5, 0.2, 0.55)],
      ]);

      // Kick: chamber the right knee, then snap the leg straight forward.
      kickWindupPose = capturePose([
        [bones.rightUpperLeg, () => new THREE.Vector3(0, -0.2, 0.98)],
        [bones.rightLowerLeg, () => new THREE.Vector3(0, -0.85, -0.5)],
      ]);
      kickStrikePose = capturePose([
        [bones.rightUpperLeg, () => new THREE.Vector3(0, 0.12, 0.99)],
        [bones.rightLowerLeg, () => new THREE.Vector3(0, 0.05, 1)],
      ]);

      // Airborne balance pose for the arms only; the legs are driven
      // procedurally each frame so the whole limb swings, not just the feet.
      airbornePose = capturePose([
        [bones.leftUpperArm, (_d, side) => new THREE.Vector3(side * 0.62, 0.62, -0.2)],
        [bones.rightUpperArm, (_d, side) => new THREE.Vector3(side * 0.7, 0.3, 0.2)],
        [bones.leftLowerArm, (_d, side) => new THREE.Vector3(side * 0.3, 0.92, 0.1)],
        [bones.rightLowerArm, (_d, side) => new THREE.Vector3(side * 0.35, 0.6, 0.4)],
      ]);


      loadedModel.traverse((node) => {
        const isHair = /Hair\d.*Sec/.test(node.name);
        const isChest = /Bust0[12]_Sec/.test(node.name);
        const isButt = /Hip2Helper1_/.test(node.name);
        const isAccessory = /(?:Tail|BackRope|Weapon_OPN).*Sec/.test(node.name);
        const isCloth = /Front\d.*Sec/.test(node.name);
        if (isHair || isChest || isButt || isCloth || isAccessory) {
          const kind: SpringBone["kind"] = isHair
            ? "hair"
            : isChest
              ? "chest"
              : isButt
                ? "butt"
                : isAccessory
                  ? "accessory"
                  : "cloth";
          const isRoot = node.name.includes("Sec_Root");
          const settledRest = node.quaternion.clone();

          // Set flexible ornament roots toward world-down while preserving
          // their authored spread, keeping front cloth close to the body.
          if ((isAccessory || isCloth) && isRoot && node.parent) {
            const childBone = node.children.find((child) => (child as THREE.Bone).isBone);
            if (childBone) {
              loadedModel.updateMatrixWorld(true);
              const origin = node.getWorldPosition(new THREE.Vector3());
              const direction = childBone.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
              const downwardBias = isCloth ? 0.82 : 0.58;
              const target = direction.clone().lerp(new THREE.Vector3(0, -1, 0), downwardBias).normalize();
              const worldDelta = new THREE.Quaternion().setFromUnitVectors(direction, target);
              const parentWorld = node.parent.getWorldQuaternion(new THREE.Quaternion());
              settledRest.copy(parentWorld).invert().multiply(worldDelta).multiply(parentWorld).multiply(node.quaternion);
              node.quaternion.copy(settledRest);
            }
          }

          springBones.push({
            bone: node,
            rest: settledRest,
            kind,
            valueX: 0,
            valueZ: 0,
            velocityX: 0,
            velocityZ: 0,
            weight: kind === "hair"
              ? (isRoot ? 0.5 : 0.16)
              : kind === "chest"
                ? (isRoot ? 0.6 : 0.18)
                : kind === "butt"
                  ? 0.48
                  : kind === "accessory"
                    ? (isRoot ? 0.28 : 0.09)
                    : (isRoot ? 0.38 : 0.12),
          });
        }
      });

      character.add(loadedModel);
      setLoaded(true);
    });

    const onKeyDown = (event: KeyboardEvent) => {
      // T toggles the inventory (2x2), E the crafting table (3x3); while any
      // menu is open the world ignores input.
      const isT = event.code === "KeyT";
      const isE = event.code === "KeyE";
      const isEscape = event.code === "Escape";
      if (isT || isE || (isEscape && anyMenuOpen())) {
        event.preventDefault();
        const openMenu = () => {
          for (const code of Object.keys(keys)) keys[code] = false;
          miningHeld = false;
          if (document.pointerLockElement) document.exitPointerLock();
        };
        if (invOpenRef.current) {
          closeInventory();
          if (isE) {
            openMenu();
            craftOpenRef.current = true;
            setCraftOpen(true);
          }
        } else if (craftOpenRef.current) {
          closeCrafting();
          if (isT) {
            openMenu();
            invOpenRef.current = true;
            setInvOpen(true);
          }
        } else if (!isEscape) {
          openMenu();
          if (isT) {
            invOpenRef.current = true;
            setInvOpen(true);
          } else {
            craftOpenRef.current = true;
            setCraftOpen(true);
          }
        }
        return;
      }
      if (anyMenuOpen()) return;
      keys[event.code] = true;
      if (event.code === "Quote") {
        firstPersonView = !firstPersonView;
        cameraPitch = THREE.MathUtils.clamp(cameraPitch, -1.2, 1.2);
      }
      if (event.code === "Space" && grounded) {
        verticalVelocity = 5.4;
        grounded = false;
      }
      // Number keys pick a hotbar slot.
      const digit = /^Digit([1-9])$/.exec(event.code);
      if (digit) {
        const index = Number(digit[1]) - 1;
        selectedRef.current = index;
        setSelectedSlot(index);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keys[event.code] = false;
    };
    // Touch look: dragging the screen turns the camera, a still hold mines.
    const touchLook = { id: -1, x: 0, y: 0, moved: 0 };
    const placeSelected = () => {
      const stack = invRef.current[selectedRef.current];
      if (!stack) return false;
      const placed = world.placeBlock(
        lastAimOrigin,
        lastAimDirection,
        firstPersonView ? 5.5 : 3.6,
        character.position,
        stack.type,
      );
      if (placed) takeFromInventory(selectedRef.current);
      return placed;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (anyMenuOpen()) return;
      const touch = event.pointerType !== "mouse";
      if (touch) {
        touchLook.id = event.pointerId;
        touchLook.x = event.clientX;
        touchLook.y = event.clientY;
        touchLook.moved = 0;
      } else if (document.pointerLockElement !== renderer.domElement) {
        renderer.domElement.requestPointerLock();
      }
      if (event.button === 0) miningHeld = true;
      // Right click places the selected block when the hotbar slot holds one.
      if (event.button === 2 && placeSelected()) return;
      if (attackTime > 0) return;
      if (event.button === 0) {
        attackMode = event.detail >= 2 ? "combo" : "punch";
      } else if (event.button === 2) {
        attackMode = "kick";
      } else {
        return;
      }
      attackTime = ATTACK_DURATIONS[attackMode];
      pendingHits = attackMode === "combo" ? 2 : 1;
      setAttackLabel(attackMode === "punch" ? "PUNCH" : attackMode === "combo" ? "COMBO" : "KICK");
    };

    const onContextMenu = (event: Event) => event.preventDefault();
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const dy = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1);
      cameraDistance = THREE.MathUtils.clamp(cameraDistance * Math.exp(dy * 0.0012), 0.75, 11);
    };

    const onPointerMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== renderer.domElement) return;
      // Mouse right = look right, mouse left = look left (both views).
      cameraYaw -= event.movementX * 0.0023;
      const minPitch = firstPersonView ? -1.2 : -0.08;
      const maxPitch = firstPersonView ? 1.2 : 0.72;
      // Vertical: same direction in both views (mouse up = look up).
      cameraPitch = THREE.MathUtils.clamp(cameraPitch + event.movementY * 0.0018, minPitch, maxPitch);
    };
    const onTouchMove = (event: PointerEvent) => {
      if (event.pointerId !== touchLook.id) return;
      event.preventDefault();
      const dx = event.clientX - touchLook.x;
      const dy = event.clientY - touchLook.y;
      touchLook.x = event.clientX;
      touchLook.y = event.clientY;
      touchLook.moved += Math.hypot(dx, dy);
      // A deliberate drag is a look, not a mine.
      if (touchLook.moved > 14) miningHeld = false;
      cameraYaw -= dx * 0.005;
      const minPitch = firstPersonView ? -1.2 : -0.08;
      const maxPitch = firstPersonView ? 1.2 : 0.72;
      cameraPitch = THREE.MathUtils.clamp(cameraPitch + dy * 0.004, minPitch, maxPitch);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId === touchLook.id) touchLook.id = -1;
      if (event.button === 0) miningHeld = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    document.addEventListener("mousemove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onTouchMove, { passive: false });
    renderer.domElement.addEventListener("contextmenu", onContextMenu);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    const setBoneRotation = (bone: THREE.Object3D | undefined, x: number, y: number, z: number) => {
      if (!bone) return;
      const rest = restRotations.get(bone);
      if (!rest) return;
      bone.quaternion.copy(rest).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)));
    };

    let animationFrame = 0;
    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.035);
      // Touch buttons queue a jump / place for the next frame.
      if (touchJumpRef.current) {
        touchJumpRef.current = false;
        if (grounded && !anyMenuOpen()) {
          verticalVelocity = 5.4;
          grounded = false;
        }
      }
      if (touchPlaceRef.current) {
        touchPlaceRef.current = false;
        if (!anyMenuOpen()) placeSelected();
      }
      const stick = touchMoveRef.current;
      const forward =
        Number(Boolean(keys["KeyW"] || keys["ArrowUp"])) -
        Number(Boolean(keys["KeyS"] || keys["ArrowDown"])) -
        stick.y;
      const strafe =
        Number(Boolean(keys["KeyD"] || keys["ArrowRight"])) -
        Number(Boolean(keys["KeyA"] || keys["ArrowLeft"])) +
        stick.x;
      const inputLength = Math.hypot(forward, strafe);
      const sprinting = Boolean(keys["ShiftLeft"] || keys["ShiftRight"]);
      const speed = inputLength > 0.12 ? (sprinting ? 5.2 : 2.7) * Math.min(1, inputLength) : 0;
      const direction = new THREE.Vector3(strafe, 0, -forward);
      if (speed > 0) {
        direction.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraYaw);
        // No auto-jump: any column above the feet blocks movement until the player jumps.
        const step = speed * delta;
        const feetY = character.position.y;
        const canStand = (x: number, z: number) =>
          world.groundHeight(x, z, feetY + STEP_TOLERANCE) <= feetY + STEP_TOLERANCE;
        const nextX = character.position.x + direction.x * step;
        const nextZ = character.position.z + direction.z * step;
        if (canStand(nextX, character.position.z)) character.position.x = nextX;
        if (canStand(character.position.x, nextZ)) character.position.z = nextZ;
        const targetAngle = Math.atan2(direction.x, direction.z);
        let turn = targetAngle - character.rotation.y;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        const appliedTurn = turn * Math.min(1, delta * 9);
        character.rotation.y += appliedTurn;
        turnImpulse = THREE.MathUtils.lerp(turnImpulse, appliedTurn / Math.max(delta, 0.001), Math.min(1, delta * 12));
        worldVelocity.copy(direction).multiplyScalar(speed);
      } else {
        worldVelocity.set(0, 0, 0);
        turnImpulse = THREE.MathUtils.lerp(turnImpulse, 0, Math.min(1, delta * 7));
      }
      // The model's forward axis is +Z, so it must face opposite the camera yaw.
      if (firstPersonView) character.rotation.y = cameraYaw + Math.PI;

      verticalVelocity -= 12.5 * delta;
      character.position.y += verticalVelocity * delta;
      const groundY = world.groundHeight(
        character.position.x,
        character.position.z,
        character.position.y + 0.5,
      );
      if (character.position.y <= groundY) {
        const heightCorrection = groundY - character.position.y;
        if (grounded && heightCorrection > 0.02) {
          // Climb onto the higher block over a few frames instead of teleporting.
          const climb = Math.min(heightCorrection, STEP_CLIMB_SPEED * delta);
          character.position.y += climb;
        } else {
          if (!grounded && verticalVelocity < -2.2) {
            landingImpact = THREE.MathUtils.clamp(-verticalVelocity - 2.2, 0, 8);
          }
          character.position.y = groundY;
        }
        verticalVelocity = 0;
        grounded = true;
      } else {
        grounded = false;
      }
      world.update(delta, character.position, addToInventory);


      locomotionBlend = THREE.MathUtils.lerp(locomotionBlend, speed > 0 ? 1 : 0, 1 - Math.exp(-delta * (speed > 0 ? 9 : 7)));
      if (speed > 0) walkTime += delta * (sprinting ? 10.5 : 7.2);
      const locomotion = THREE.MathUtils.clamp(speed / 3.2, 0, 1.35) * locomotionBlend;
      const gait = Math.sin(walkTime);
      const stride = gait * 0.5 * locomotion;
      const counter = -stride;
      const kneeL = Math.max(0, -gait) * 0.68 * locomotion;
      const kneeR = Math.max(0, gait) * 0.68 * locomotion;
      const settle = speed === 0 ? Math.sin(clock.elapsedTime * 1.7) * 0.018 : 0;
      const idleSway = (1 - locomotionBlend) * Math.sin(clock.elapsedTime * 0.82);

      setBoneRotation(bones.leftUpperLeg, stride, 0, 0);
      setBoneRotation(bones.rightUpperLeg, counter, 0, 0);
      setBoneRotation(bones.leftLowerLeg, kneeL, 0, 0);
      setBoneRotation(bones.rightLowerLeg, kneeR, 0, 0);
      setBoneRotation(bones.leftFoot, -kneeL * 0.62 - stride * 0.22, 0, 0);
      setBoneRotation(bones.rightFoot, -kneeR * 0.62 - counter * 0.22, 0, 0);
      // Attack animation: pick two keyframe poses per segment, slerp between
      // them, and blend the whole layer in/out. Punch = right cross, combo =
      // left jab into right cross, kick = chambered right-leg snap.
      let attackBlend = 0;
      let twist = 0;
      let leanBack = 0;
      let poseA: PoseMap | undefined;
      let poseB: PoseMap | undefined;
      let segmentT = 0;
      if (attackTime > 0 && attackMode) {
        attackTime = Math.max(0, attackTime - delta);
        const p = 1 - attackTime / ATTACK_DURATIONS[attackMode];
        if (attackMode === "punch") {
          if (p < 0.26) { segmentT = p / 0.26; attackBlend = segmentT; }
          else if (p < 0.5) { segmentT = 1 + (p - 0.26) / 0.24; attackBlend = 1; }
          else if (p < 0.68) { segmentT = 2; attackBlend = 1; }
          else { segmentT = 2; attackBlend = (1 - p) / 0.32; }
          poseA = windupPose; poseB = strikePose;
          twist = (Math.min(segmentT, 2) - 1) * 0.3 * attackBlend;
        } else if (attackMode === "combo") {
          // Two-stage: jab (p 0..0.45) then cross (p 0.45..1).
          if (p < 0.12) { segmentT = p / 0.12; attackBlend = segmentT; poseA = jabWindupPose; poseB = jabStrikePose; twist = -segmentT * 0.28 * attackBlend; }
          else if (p < 0.3) { segmentT = 1 + (p - 0.12) / 0.18; attackBlend = 1; poseA = jabWindupPose; poseB = jabStrikePose; twist = (Math.min(segmentT, 2) - 1) * -0.28; }
          else if (p < 0.45) { segmentT = 2; attackBlend = 1; poseA = jabWindupPose; poseB = jabStrikePose; twist = -0.28 * (1 - (p - 0.3) / 0.15); }
          else if (p < 0.58) { segmentT = (p - 0.45) / 0.13; attackBlend = 1; poseA = windupPose; poseB = strikePose; twist = (segmentT - 1) * 0.38; }
          else if (p < 0.74) { segmentT = 1 + (p - 0.58) / 0.16; attackBlend = 1; poseA = windupPose; poseB = strikePose; twist = (Math.min(segmentT, 2) - 1) * 0.38; }
          else { segmentT = 2; attackBlend = (1 - p) / 0.26; poseA = windupPose; poseB = strikePose; twist = 0.38 * attackBlend; }
        } else {
          // Kick.
          if (p < 0.3) { segmentT = p / 0.3; attackBlend = Math.min(1, segmentT * 1.4); poseA = kickWindupPose; poseB = kickStrikePose; }
          else if (p < 0.48) { segmentT = 1 + (p - 0.3) / 0.18; attackBlend = 1; poseA = kickWindupPose; poseB = kickStrikePose; }
          else if (p < 0.62) { segmentT = 2; attackBlend = 1; poseA = kickWindupPose; poseB = kickStrikePose; }
          else { segmentT = 2; attackBlend = (1 - p) / 0.38; poseA = kickWindupPose; poseB = kickStrikePose; }
          const k = Math.min(segmentT, 2);
          leanBack = (k <= 1 ? -0.12 * k : -0.12 - 0.16 * (k - 1)) * attackBlend;
          twist = -0.18 * (k <= 1 ? k : 2 - k) * attackBlend;
        }
        // Landing frames chip away at the targeted block instead of breaking it.
        const hitPoint = attackMode === "combo" ? (pendingHits === 2 ? 0.3 : 0.74) : attackMode === "kick" ? 0.48 : 0.5;
        if (pendingHits > 0 && p >= hitPoint) {
          pendingHits -= 1;
          attackBonus += 0.3;
        }

        if (attackTime === 0) {
          attackMode = null;
          setAttackLabel(null);
        }
      }

      // The standing pose is baked into the rest rotations, so only layer the
      // walk swing (left arm) and a light idle sway on top of it.
      const swingScale = 1 - attackBlend;
      setBoneRotation(bones.leftUpperArm, 0, (counter * 0.42 - idleSway * 0.018) * swingScale, 0);
      setBoneRotation(bones.rightUpperArm, 0, idleSway * 0.012 * swingScale, 0);
      setBoneRotation(bones.leftLowerArm, 0, -Math.max(0, -counter) * 0.14 * swingScale, 0);
      setBoneRotation(bones.rightLowerArm, 0, 0, 0);
      // Kicks drive the legs too, so fade the walk cycle out of the way.
      if (attackMode === "kick" && attackBlend > 0) {
        const restLegs = [bones.leftUpperLeg, bones.rightUpperLeg, bones.leftLowerLeg, bones.rightLowerLeg, bones.leftFoot, bones.rightFoot];
        restLegs.forEach((bone) => {
          const rest = bone && restRotations.get(bone);
          if (bone && rest) bone.quaternion.slerp(rest, attackBlend);
        });
      }
      if (attackBlend > 0 && poseA && poseB) {
        const target = new THREE.Quaternion();
        poseA.forEach((windup, bone) => {
          const strike = poseB!.get(bone);
          const rest = restRotations.get(bone);
          if (!strike || !rest) return;
          if (segmentT <= 1) target.copy(rest).slerp(windup, segmentT);
          else target.copy(windup).slerp(strike, segmentT - 1);
          bone.quaternion.slerp(target, attackBlend);
        });
      }

      airborneBlend = THREE.MathUtils.lerp(
        airborneBlend,
        grounded ? 0 : 1,
        1 - Math.exp(-delta * (grounded ? 14 : 16)),
      );
      // Jump pose: hips, thighs, knees and feet all move. Knees tuck up on the
      // way up, then the legs reach down for the landing on the way down.
      let jumpLean = 0;
      if (airborneBlend > 0.001) {
        const rise = THREE.MathUtils.clamp(verticalVelocity / 5.4, 0, 1);
        const fall = THREE.MathUtils.clamp(-verticalVelocity / 5.4, 0, 1);
        const blend = airborneBlend;
        jumpLean = (0.16 * rise - 0.1 * fall) * blend;
        const blendBone = (bone: THREE.Object3D | undefined, x: number, y = 0, z = 0) => {
          if (!bone) return;
          const rest = restRotations.get(bone);
          if (!rest) return;
          const target = rest
            .clone()
            .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)));
          bone.quaternion.slerp(target, blend);
        };
        // Lead leg tucks high, trail leg trails behind and straightens sooner.
        blendBone(bones.leftUpperLeg, 0.85 * rise + 0.1 * fall, 0, -0.14);
        blendBone(bones.rightUpperLeg, 0.42 * rise - 0.3 * fall, 0, 0.14);
        blendBone(bones.leftLowerLeg, 1.15 * rise + 0.3 * fall, 0, 0);
        blendBone(bones.rightLowerLeg, 0.7 * rise + 0.55 * fall, 0, 0);
        blendBone(bones.leftFoot, -0.4 * rise + 0.25 * fall, 0, 0);
        blendBone(bones.rightFoot, -0.5 * rise + 0.15 * fall, 0, 0);
        if (airbornePose) {
          airbornePose.forEach((quaternion, bone) => {
            bone.quaternion.slerp(quaternion, blend);
          });
        }
      }

      setBoneRotation(bones.hips, settle + leanBack * 0.4 + jumpLean * 0.5, gait * 0.045 * locomotion + twist * 0.5, Math.cos(walkTime) * 0.032 * locomotion + idleSway * 0.018);
      setBoneRotation(bones.spine, -settle * 0.5 + leanBack - jumpLean, -gait * 0.032 * locomotion + twist * 0.7, -Math.cos(walkTime) * 0.018 * locomotion - idleSway * 0.012);
      setBoneRotation(bones.chest, settle * 0.65 - jumpLean * 0.6, Math.sin(walkTime) * 0.025 * locomotion + twist * 0.5, idleSway * 0.007);
      setBoneRotation(bones.head, -settle * 0.35 + jumpLean * 0.4, twist * 0.3, -idleSway * 0.006);


      visualStepOffset = THREE.MathUtils.lerp(visualStepOffset, 0, 1 - Math.exp(-delta * 11));
      if (model) {
        model.position.y = modelBaseY
          + visualStepOffset
          + (speed > 0 ? Math.abs(Math.sin(walkTime * 2)) * 0.024 * locomotion : settle * 0.16);
      }

      const acceleration = (speed - previousSpeed) / Math.max(delta, 0.001);
      previousSpeed = THREE.MathUtils.lerp(previousSpeed, speed, Math.min(1, delta * 8));
      const verticalAcceleration = (verticalVelocity - previousVerticalVelocity) / Math.max(delta, 0.001);
      previousVerticalVelocity = verticalVelocity;
      worldAcceleration.copy(worldVelocity).sub(previousWorldVelocity).divideScalar(Math.max(delta, 0.001));
      previousWorldVelocity.lerp(worldVelocity, Math.min(1, delta * 9));
      localAcceleration.copy(worldAcceleration).applyAxisAngle(new THREE.Vector3(0, 1, 0), -character.rotation.y);
      springBones.forEach((spring, index) => {
        const isChest = spring.kind === "chest";
        const isHair = spring.kind === "hair";
        const isButt = spring.kind === "butt";
        const isAccessory = spring.kind === "accessory";
        const flutter = isHair
          ? Math.sin(clock.elapsedTime * (2.1 + (index % 4) * 0.17) + index) * 0.008
          : 0;
        const gaitBounce = Math.sin(walkTime * 2) * speed * locomotionBlend;
        const breathing = Math.sin(clock.elapsedTime * 2.15) * (isChest ? 0.02 : 0.018);
        const targetX = (
          -acceleration * (isChest ? 0.012 : isButt ? 0.006 : 0.011)
          -localAcceleration.z * (isChest ? 0.005 : isButt ? 0.003 : 0.009)
          -verticalAcceleration * (isChest ? 0.01 : isButt ? 0.005 : 0.004)
          + gaitBounce * (isButt ? 0.026 : 0.018)
        ) * spring.weight + flutter + (isChest ? breathing * spring.weight : 0);
        const directionalSway = -localAcceleration.x * (isHair ? 0.014 : 0.004) - turnImpulse * (isHair ? 0.032 : 0.006);
        const targetZ = (
          directionalSway
          + Math.sin(walkTime + index * 0.24) * speed * (isChest ? 0.012 : isButt ? 0.009 : 0.013)
        ) * spring.weight;
        const stiffness = isChest ? 23 : isHair ? 20 : isButt ? 40 : isAccessory ? 28 : 34;
        const damping = isChest ? 2.5 : isHair ? 3.1 : isButt ? 5.2 : isAccessory ? 6.4 : 7.2;
        if (isChest && landingImpact > 0) {
          spring.velocityX += landingImpact * 0.16 * spring.weight;
        }
        spring.velocityX += (targetX - spring.valueX) * stiffness * delta;
        spring.velocityZ += (targetZ - spring.valueZ) * stiffness * delta;
        spring.velocityX *= Math.exp(-damping * delta);
        spring.velocityZ *= Math.exp(-damping * delta);
        spring.valueX += spring.velocityX * delta;
        spring.valueZ += spring.velocityZ * delta;
        const maxAngle = isChest ? 0.2 : isHair ? 0.3 : isButt ? 0.12 : isAccessory ? 0.16 : 0.13;
        spring.valueX = THREE.MathUtils.clamp(spring.valueX, -maxAngle, maxAngle);
        spring.valueZ = THREE.MathUtils.clamp(spring.valueZ, -maxAngle, maxAngle);
        // The walk-cycle bounce is applied directly at step frequency so the
        // chest keeps oscillating while moving instead of only on stop/start.
        const gaitOffset = isChest ? Math.sin(walkTime * 2 + index * 0.35) * 0.05 * locomotionBlend : 0;
        spring.bone.quaternion.copy(spring.rest).multiply(
          new THREE.Quaternion().setFromEuler(new THREE.Euler(spring.valueX + gaitOffset, 0, spring.valueZ)),
        );
      });
      landingImpact = 0;

      const target = character.position.clone().add(new THREE.Vector3(0, 1.05, 0));
      if (firstPersonView) {
        // Place the view just ahead of the face so looking down reveals the body.
        const eye = character.position.clone().add(new THREE.Vector3(0, 1.5, 0));
        eye.add(new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw)).multiplyScalar(0.13));
        camera.position.copy(eye);
        const look = eye.clone().add(new THREE.Vector3(
          -Math.sin(cameraYaw) * Math.cos(cameraPitch),
          -Math.sin(cameraPitch),
          -Math.cos(cameraYaw) * Math.cos(cameraPitch),
        ));
        camera.lookAt(look);
      } else {
        const offset = new THREE.Vector3(
          Math.sin(cameraYaw) * Math.cos(cameraPitch) * cameraDistance,
          0.9 + Math.sin(cameraPitch) * cameraDistance,
          Math.cos(cameraYaw) * Math.cos(cameraPitch) * cameraDistance,
        );
        // Keep the camera outside the blocks it would otherwise sit inside.
        const desired = target.clone().add(offset);
        const toCamera = desired.clone().sub(target);
        const clearance = world.cameraClearance(target, toCamera);
        if (clearance < 1) desired.copy(target).addScaledVector(toCamera, Math.max(clearance, 0.12));
        camera.position.lerp(desired, 1 - Math.exp(-7 * delta));
        camera.lookAt(target);
      }
      // --- aiming + progressive block breaking -------------------------------
      const aimOrigin = camera.position.clone();
      const aimDirection = new THREE.Vector3();
      if (firstPersonView) {
        camera.getWorldDirection(aimDirection);
      } else {
        aimOrigin.copy(character.position).add(new THREE.Vector3(0, 1.2, 0));
        aimDirection
          .set(Math.sin(character.rotation.y), -0.3, Math.cos(character.rotation.y))
          .normalize();
      }
      lastAimOrigin.copy(aimOrigin);
      lastAimDirection.copy(aimDirection);
      const aimed = world.pickBlock(aimOrigin, aimDirection, firstPersonView ? 5.5 : 3.2);
      world.highlightBlock(aimed);
      const sameBlock =
        aimed && miningBlock
          ? aimed[0] === miningBlock[0] && aimed[1] === miningBlock[1] && aimed[2] === miningBlock[2]
          : false;
      if (!sameBlock) {
        miningBlock = aimed;
        miningProgress = 0;
      }
      // Keep swinging while the mouse stays held on a block. Chain the next
      // punch as soon as the strike lands (skip the recovery pause) so the
      // animation loops without dropping back to idle between swings.
      const punchRecovery = ATTACK_DURATIONS.punch * 0.32;
      if (miningHeld && miningBlock && (attackTime === 0 || (attackMode === "punch" && attackTime <= punchRecovery))) {
        attackMode = "punch";
        attackTime = ATTACK_DURATIONS.punch;
        pendingHits = 1;
        setAttackLabel("PUNCH");
      }
      if (miningBlock && (miningHeld || attackBonus > 0)) {
        const miningType = world.blockTypeAt(miningBlock);
        if (miningHeld) miningProgress += delta / (miningType ? BREAK_TIMES[miningType] : 0.95);
        miningProgress += attackBonus;
        attackBonus = 0;
        if (miningProgress >= 1) {
          world.removeBlock(miningBlock);
          miningBlock = null;
          miningProgress = 0;
        }
      } else if (!miningHeld) {
        // Cracks heal back when the player stops mining.
        miningProgress = Math.max(0, miningProgress - delta * 0.8);
        attackBonus = 0;
      }
      world.showBreakProgress(miningBlock, miningProgress);
      // Show the selected stack's block in the character's hand.
      const nextHeldType = invRef.current[selectedRef.current]?.type ?? null;
      if (nextHeldType !== heldType) {
        const previous = heldType ? heldMeshes.get(heldType) : null;
        if (previous) previous.visible = false;
        heldType = nextHeldType;
        if (nextHeldType && handAttach) {
          let mesh = heldMeshes.get(nextHeldType);
          if (!mesh) {
            mesh = world.makeBlockMesh(0.19, nextHeldType);
            mesh.scale.setScalar(1 / handScale);
            heldMeshes.set(nextHeldType, mesh);
            handAttach.add(mesh);
          }
          mesh.visible = true;
        }
      }

      sun.position.x = character.position.x - 18;
      sun.position.z = character.position.z + 12;

      const nowMoving = speed > 0;
      if (nowMoving !== lastMovingState) {
        lastMovingState = nowMoving;
        setMoving(nowMoving);
      }
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!host) return;
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onTouchMove);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      renderer.domElement.removeEventListener("wheel", onWheel);
      world.dispose();
      renderer.dispose();

      host.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-background text-foreground">
      <div ref={hostRef} className="absolute inset-0" aria-label="Open 3D terrain game" />

      <div className="crosshair" aria-hidden="true">
        <span />
        <span />
      </div>


      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-end p-5 sm:p-7">
        <div className="game-status" aria-live="polite">
          <span className={loaded ? "status-light is-ready" : "status-light"} />
          {loaded ? (attackLabel ?? (moving ? "MOVING" : "READY")) : "LOADING MODEL"}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-end p-5 sm:p-7">
        <div className="physics-badge"><span />SECONDARY MOTION</div>
      </div>

      {invOpen ? (
        <InventoryPanel
          title="Inventory"
          inventory={inventory}
          craftGrid={craftGrid}
          cursor={cursor}
          cursorPos={cursorPos}
          onSlotClick={handleSlotClick}
          onTakeResult={(right) => handleTakeResult(right, false)}
          onClose={closeInventory}
          onCursorMove={(x, y) => setCursorPos({ x, y })}
        />
      ) : null}

      {craftOpen ? (
        <InventoryPanel
          title="Crafting Table"
          largeGrid
          inventory={inventory}
          craftGrid={tableGrid}
          cursor={cursor}
          cursorPos={cursorPos}
          onSlotClick={(area, index, right) =>
            handleSlotClick(area === "craft" ? "craft3" : area, index, right)
          }
          onTakeResult={(right) => handleTakeResult(right, true)}
          onClose={closeCrafting}
          onCursorMove={(x, y) => setCursorPos({ x, y })}
        />
      ) : null}

      <div className="hotbar-wrap">
        <div className="hotbar" role="list" aria-label="Inventory hotbar">
          {inventory.slice(0, HOTBAR_SIZE).map((slot, index) => (
            <button
              key={index}
              type="button"
              role="listitem"
              className={index === selectedSlot ? "hotbar-slot is-active" : "hotbar-slot"}
              onClick={() => {
                selectedRef.current = index;
                setSelectedSlot(index);
              }}
              aria-label={slot ? `${BLOCK_LABEL[slot.type]} x${slot.count}` : `Empty slot ${index + 1}`}
            >
              {slot ? (
                <>
                  <span className={`block-icon is-${slot.type}`} aria-hidden="true" />
                  <span className="slot-count">{slot.count}</span>
                </>
              ) : null}
              <span className="slot-index">{index + 1}</span>
            </button>
          ))}
        </div>
        <p className="hotbar-hint">
          {isTouch
            ? inventory[selectedSlot]
              ? `${BLOCK_LABEL[inventory[selectedSlot]!.type]} — tap PLACE · hold screen to break`
              : "Hold the screen to break blocks · drag to look"
            : inventory[selectedSlot]
              ? `${BLOCK_LABEL[inventory[selectedSlot]!.type]} — right-click to place · T inventory · E crafting`
              : "Mine blocks to collect them · T inventory · E crafting"}
        </p>
      </div>

      {isTouch ? (
        <button
          type="button"
          className={firstPerson ? "fp-toggle is-active" : "fp-toggle"}
          onClick={() => toggleViewRef.current?.()}
          aria-label={firstPerson ? "Switch to third person view" : "Switch to first person view"}
        >
          {firstPerson ? <PersonStanding size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
        </button>
      ) : null}

      {isTouch && !invOpen && !craftOpen ? (
        <MobileControls
          onMove={(x, y) => {
            touchMoveRef.current = { x, y };
          }}
          onJump={() => {
            touchJumpRef.current = true;
          }}
          onPlace={() => {
            touchPlaceRef.current = true;
          }}
          onOpenCrafting={openCrafting}
        />
      ) : null}

      {portrait ? (
        <div className="rotate-notice" role="alert">
          <span className="rotate-glyph" aria-hidden="true" />
          Rotate your device to landscape to play
        </div>
      ) : null}
    </main>
  );
}
