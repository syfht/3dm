import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import modelAsset from "@/assets/mai_shiranui_kof_xv.glb.asset.json";

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

function createTerrain(scene: THREE.Scene) {
  const geometry = new THREE.PlaneGeometry(220, 220, 90, 90);
  const position = geometry.getAttribute("position");
  if (!(position instanceof THREE.BufferAttribute)) return;
  const colors: number[] = [];
  const color = new THREE.Color();

  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const distance = Math.hypot(x, y);
    const edgeRise = Math.max(0, distance - 34) * 0.018;
    const rolling = Math.sin(x * 0.09) * Math.cos(y * 0.075) * 0.42;
    const detail = Math.sin((x + y) * 0.31) * 0.08;
    position.setZ(index, rolling + detail + edgeRise);
    const shade = THREE.MathUtils.clamp(0.48 + position.getZ(index) * 0.055, 0.38, 0.62);
    color.setHSL(0.27, 0.34, shade);
    colors.push(color.r, color.g, color.b);
  }

  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0,
  });
  const terrain = new THREE.Mesh(geometry, material);
  terrain.rotation.x = -Math.PI / 2;
  terrain.receiveShadow = true;
  scene.add(terrain);

  const ringMaterial = new THREE.MeshStandardMaterial({ color: 0x78906a, roughness: 1 });
  for (let index = 0; index < 32; index += 1) {
    const angle = (index / 32) * Math.PI * 2;
    const radius = 52 + (index % 5) * 5;
    const height = 5 + (index % 7) * 1.5;
    const mountain = new THREE.Mesh(new THREE.ConeGeometry(4.5 + (index % 3), height, 7), ringMaterial);
    mountain.position.set(Math.cos(angle) * radius, height / 2 - 0.4, Math.sin(angle) * radius);
    mountain.castShadow = true;
    mountain.receiveShadow = true;
    scene.add(mountain);
  }
}

export default function TerrainGame() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xa8c5ce);
    scene.fog = new THREE.FogExp2(0xa8c5ce, 0.012);

    const camera = new THREE.PerspectiveCamera(52, host.clientWidth / host.clientHeight, 0.1, 300);
    camera.position.set(0, 2.4, 5.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.shadowMap.enabled = true;
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
    createTerrain(scene);

    const keys: KeyState = {};
    const character = new THREE.Group();
    scene.add(character);
    let model: THREE.Object3D | undefined;
    let modelBaseY = 0;
    let walkTime = 0;
    let verticalVelocity = 0;
    let grounded = true;
    let cameraYaw = 0;
    let cameraPitch = 0.12;
    let cameraDistance = 4.2;
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
    loader.load(modelAsset.url, (gltf) => {
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

          // Pull flexible back ornaments toward world-down while preserving
          // their authored spread. This prevents unanimated chains from
          // hovering horizontally behind the character.
          if (isAccessory && isRoot && node.parent) {
            const childBone = node.children.find((child) => (child as THREE.Bone).isBone);
            if (childBone) {
              loadedModel.updateMatrixWorld(true);
              const origin = node.getWorldPosition(new THREE.Vector3());
              const direction = childBone.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
              const target = direction.clone().lerp(new THREE.Vector3(0, -1, 0), 0.58).normalize();
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
      keys[event.code] = true;
      if (event.code === "Space" && grounded) {
        verticalVelocity = 5.4;
        grounded = false;
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keys[event.code] = false;
    };
    const onPointerDown = () => renderer.domElement.requestPointerLock();
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cameraDistance = THREE.MathUtils.clamp(cameraDistance + event.deltaY * 0.0022, 2.1, 11);
    };
    const onPointerMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== renderer.domElement) return;
      cameraYaw -= event.movementX * 0.0023;
      cameraPitch = THREE.MathUtils.clamp(cameraPitch - event.movementY * 0.0018, -0.08, 0.72);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    document.addEventListener("mousemove", onPointerMove);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
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
      const forward = Number(Boolean(keys["KeyW"] || keys["ArrowUp"])) - Number(Boolean(keys["KeyS"] || keys["ArrowDown"]));
      const strafe = Number(Boolean(keys["KeyD"] || keys["ArrowRight"])) - Number(Boolean(keys["KeyA"] || keys["ArrowLeft"]));
      const inputLength = Math.hypot(forward, strafe);
      const sprinting = Boolean(keys["ShiftLeft"] || keys["ShiftRight"]);
      const speed = inputLength > 0 ? (sprinting ? 5.2 : 2.7) : 0;
      const direction = new THREE.Vector3(strafe, 0, -forward);
      if (inputLength > 0) {
        direction.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraYaw);
        character.position.addScaledVector(direction, speed * delta);
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

      verticalVelocity -= 12.5 * delta;
      character.position.y += verticalVelocity * delta;
      if (character.position.y <= 0) {
        character.position.y = 0;
        verticalVelocity = 0;
        grounded = true;
      }

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

      setBoneRotation(bones.leftUpperLeg, stride, 0, 0.018);
      setBoneRotation(bones.rightUpperLeg, counter, 0, -0.018);
      setBoneRotation(bones.leftLowerLeg, kneeL, 0, 0);
      setBoneRotation(bones.rightLowerLeg, kneeR, 0, 0);
      setBoneRotation(bones.leftFoot, -kneeL * 0.62 - stride * 0.22, 0, 0);
      setBoneRotation(bones.rightFoot, -kneeR * 0.62 - counter * 0.22, 0, 0);
      // This rig's authored arm pose already slopes down from the shoulders.
      // Keep that relaxed silhouette and swing only around the forward axis.
      setBoneRotation(bones.leftUpperArm, 0, counter * 0.42 - idleSway * 0.018, 0.04);
      setBoneRotation(bones.rightUpperArm, 0, stride * 0.42 + idleSway * 0.018, -0.04);
      setBoneRotation(bones.leftLowerArm, 0, -Math.max(0, -counter) * 0.14, 0.11);
      setBoneRotation(bones.rightLowerArm, 0, -Math.max(0, -stride) * 0.14, -0.11);
      setBoneRotation(bones.hips, settle, gait * 0.045 * locomotion, Math.cos(walkTime) * 0.032 * locomotion + idleSway * 0.018);
      setBoneRotation(bones.spine, -settle * 0.5, -gait * 0.032 * locomotion, -Math.cos(walkTime) * 0.018 * locomotion - idleSway * 0.012);
      setBoneRotation(bones.chest, settle * 0.65, Math.sin(walkTime) * 0.025 * locomotion, idleSway * 0.007);
      setBoneRotation(bones.head, -settle * 0.35, 0, -idleSway * 0.006);
      if (model) model.position.y = modelBaseY + (speed > 0 ? Math.abs(Math.sin(walkTime * 2)) * 0.024 * locomotion : settle * 0.16);

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

      const target = character.position.clone().add(new THREE.Vector3(0, 1.05, 0));
      const offset = new THREE.Vector3(
        Math.sin(cameraYaw) * Math.cos(cameraPitch) * cameraDistance,
        0.9 + Math.sin(cameraPitch) * cameraDistance,
        Math.cos(cameraYaw) * Math.cos(cameraPitch) * cameraDistance,
      );
      camera.position.lerp(target.clone().add(offset), 1 - Math.exp(-7 * delta));
      camera.lookAt(target);
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
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-background text-foreground">
      <div ref={hostRef} className="absolute inset-0" aria-label="Open 3D terrain game" />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-5 sm:p-7">
        <div>
          <p className="game-kicker">OPEN TERRAIN / PROTOTYPE 01</p>
          <h1 className="game-title">GALAXIA</h1>
        </div>
        <div className="game-status" aria-live="polite">
          <span className={loaded ? "status-light is-ready" : "status-light"} />
          {loaded ? (moving ? "MOVING" : "READY") : "LOADING MODEL"}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-5 sm:p-7">
        <div className="control-panel">
          <div><kbd>WASD</kbd><span>Move</span></div>
          <div><kbd>SHIFT</kbd><span>Sprint</span></div>
          <div><kbd>SPACE</kbd><span>Jump</span></div>
          <div><span className="mouse-icon" aria-hidden="true" /><span>Look</span></div>
        </div>
        <div className="physics-badge"><span />SECONDARY MOTION</div>
      </div>
    </main>
  );
}