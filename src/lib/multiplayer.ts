// Browser side of the multiplayer link. Talks to the game server in /server
// over one WebSocket: the server owns the player roster, everyone's latest
// pose, health, and block edits, and streams snapshots back at a fixed rate.
//
// Background tabs are handled explicitly: pings, reconnects and a "hidden"
// flag run off a worker ticker (which browsers do not throttle), and when a
// tab wakes up it re-syncs edits and accepts any position the server moved it
// to while it slept.

import type { WorldEdit } from "@/components/voxelWorld";
import { startBackgroundTicker } from "./backgroundTicker";
import type {
  ClientMessage,
  PlayerState,
  Pose,
  ServerMessage,
  WorldInfo,
} from "./protocol";

export type { Pose };
export type RemotePose = PlayerState;

// Every browser tab gets its own player id for the session.
export const CLIENT_ID =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

export type WorldSession = {
  worldId: string | null;
  seed: number;
  edits: WorldEdit[];
  editsUpTo: number;
  online: boolean;
};

const OFFLINE: WorldSession = { worldId: null, seed: 0, edits: [], editsUpTo: 0, online: false };

const PING_MS = 5000;

/** Base URL of the game server; same origin unless VITE_GAME_SERVER_URL is set. */
function serverBase() {
  const configured = (import.meta.env["VITE_GAME_SERVER_URL"] as string | undefined)?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return typeof window === "undefined" ? "" : window.location.origin;
}

function wsUrl(worldId: string, name: string) {
  const base = serverBase().replace(/^http/, "ws");
  const params = new URLSearchParams({ world: worldId, id: CLIENT_ID, name });
  return `${base}/ws?${params.toString()}`;
}

// Joins the shared world (the server hands out a fresh one when the last one
// has been empty for a while) and loads every block change made so far.
export async function joinWorld(): Promise<WorldSession> {
  try {
    const response = await fetch(`${serverBase()}/api/game/world`, { cache: "no-store" });
    if (!response.ok) return OFFLINE;
    const world = (await response.json()) as WorldInfo;
    return {
      worldId: world.worldId,
      seed: Number(world.seed),
      edits: world.edits,
      editsUpTo: world.editsUpTo,
      online: true,
    };
  } catch {
    return OFFLINE;
  }
}

export type WorldChannel = {
  sendPose: (pose: Pose) => void;
  sendEdit: (edit: WorldEdit) => void;
  sendHit: (targetId: string, amount: number) => void;
  /** Report self-inflicted damage (falls) so the server keeps health authoritative. */
  sendDamage: (amount: number) => void;
  setName: (name: string) => void;
  dispose: () => void;
};

export type WorldHandlers = {
  onEdit: (edit: WorldEdit) => void;
  onPlayers: (players: RemotePose[]) => void;
  /** Authoritative health from the server. */
  onHealth?: (hp: number) => void;
  /** Someone landed a hit on us (for effects; health arrives via onHealth). */
  onHit?: (amount: number, from: string) => void;
  /** A player (possibly us) took damage: flash them red. */
  onHurt?: (id: string) => void;
  /** The server moved us: we died, or it simulated our fall while the tab slept. */
  onTeleport?: (position: { x: number; y: number; z: number }, reason: "respawn" | "correct") => void;
  onStatus?: (connected: boolean) => void;
};

// Live link for one world: block changes plus everyone's position.
export function connectWorld(
  worldId: string,
  handlers: WorldHandlers,
  options: { name?: string; editsUpTo?: number } = {},
): WorldChannel {
  let name = options.name ?? "Player";
  let editsUpTo = options.editsUpTo ?? 0;
  let socket: WebSocket | null = null;
  let open = false;
  let disposed = false;
  let attempts = 0;
  let reconnectAt = 0;
  let lastPingAt = 0;
  let lastPose: Pose | null = null;
  let everConnected = false;

  const send = (message: ClientMessage) => {
    if (!open || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(message));
  };

  const handle = (message: ServerMessage) => {
    switch (message.t) {
      case "welcome":
        handlers.onPlayers(message.players);
        handlers.onHealth?.(message.hp);
        return;
      case "state":
        handlers.onPlayers(message.players);
        handlers.onHealth?.(message.hp);
        return;
      case "edit":
        editsUpTo = Math.max(editsUpTo, message.at);
        handlers.onEdit({ x: message.x, y: message.y, z: message.z, block: message.block });
        return;
      case "edits":
        editsUpTo = Math.max(editsUpTo, message.upTo);
        for (const edit of message.edits) handlers.onEdit(edit);
        return;
      case "hit":
        handlers.onHit?.(message.amount, message.from);
        return;
      case "hurt":
        handlers.onHurt?.(message.id);
        return;
      case "respawn":
        handlers.onTeleport?.({ x: message.x, y: message.y, z: message.z }, "respawn");
        return;
      case "correct":
        handlers.onTeleport?.({ x: message.x, y: message.y, z: message.z }, "correct");
        return;
      case "error":
        console.warn("[multiplayer]", message.message);
        return;
      default:
        return;
    }
  };

  const connect = () => {
    if (disposed) return;
    try {
      socket = new WebSocket(wsUrl(worldId, name));
    } catch (error) {
      console.warn("[multiplayer] cannot open link", error);
      scheduleReconnect();
      return;
    }
    const current = socket;
    current.onopen = () => {
      if (current !== socket) return;
      open = true;
      attempts = 0;
      lastPingAt = Date.now();
      handlers.onStatus?.(true);
      if (typeof document !== "undefined" && document.hidden) send({ t: "hidden", hidden: true });
      // Anything that happened while we were away.
      if (everConnected) send({ t: "sync", since: editsUpTo });
      everConnected = true;
      if (lastPose) send({ t: "pose", ...lastPose });
    };
    current.onmessage = (event) => {
      if (current !== socket) return;
      try {
        handle(JSON.parse(String(event.data)) as ServerMessage);
      } catch {
        /* ignore malformed frames */
      }
    };
    current.onclose = () => {
      if (current !== socket) return;
      open = false;
      handlers.onStatus?.(false);
      scheduleReconnect();
    };
    current.onerror = () => {
      /* onclose follows */
    };
  };

  const scheduleReconnect = () => {
    if (disposed) return;
    attempts += 1;
    const delay = Math.min(15_000, 500 * 2 ** Math.min(attempts, 5));
    reconnectAt = Date.now() + delay;
  };

  // Keep-alive and reconnect run from a worker so they keep working while
  // the tab is in the background (plain timers get throttled to once a
  // minute there, which used to silently drop the link).
  const stopTicker = startBackgroundTicker(() => {
    if (disposed) return;
    const now = Date.now();
    if (!open) {
      if (reconnectAt && now >= reconnectAt && (!socket || socket.readyState === WebSocket.CLOSED)) {
        reconnectAt = 0;
        connect();
      }
      return;
    }
    if (now - lastPingAt >= PING_MS) {
      lastPingAt = now;
      send({ t: "ping" });
    }
  }, 1000);

  const onVisibility = () => {
    const hidden = document.hidden;
    send({ t: "hidden", hidden });
    if (!hidden) {
      // Coming back: pull any edits we missed and refresh our pose promptly.
      send({ t: "sync", since: editsUpTo });
      if (lastPose) send({ t: "pose", ...lastPose });
    }
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);

  connect();

  return {
    sendPose: (pose) => {
      lastPose = pose;
      send({ t: "pose", ...pose });
    },
    sendEdit: (edit) => send({ t: "edit", ...edit }),
    sendHit: (targetId, amount) => send({ t: "hit", target: targetId, amount }),
    sendDamage: (amount) => send({ t: "damage", amount }),
    setName: (next) => {
      name = next;
      send({ t: "name", name: next });
    },
    dispose: () => {
      disposed = true;
      stopTicker();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
      const current = socket;
      socket = null;
      open = false;
      current?.close();
    },
  };
}
