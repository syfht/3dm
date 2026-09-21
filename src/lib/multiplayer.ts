import { supabase } from "@/integrations/supabase/client";
import type { BlockType, WorldEdit } from "@/components/voxelWorld";
import type { ItemType } from "@/components/inventory";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { startBackgroundTicker } from "./backgroundTicker";

// Every browser tab gets its own player id for the session.
export const CLIENT_ID =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

export type WorldSession = {
  worldId: string | null;
  seed: number;
  edits: WorldEdit[];
  online: boolean;
};

export type RemotePose = {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  ry: number;
  moving: boolean;
  /** Current attack animation, when the player is mid-swing. */
  attack?: "punch" | "kick" | "combo" | null;
  /** Attack progress from 0 to 1. */
  ap?: number;
  /** Block or tool currently held in the hand. */
  item?: ItemType | null;
};

const OFFLINE: WorldSession = { worldId: null, seed: 0, edits: [], online: false };

// Joins the shared world (creating a fresh one when the last world has been
// empty for over 30 minutes) and loads every block change made so far.
export async function joinWorld(): Promise<WorldSession> {
  try {
    const { data, error } = await supabase.rpc("join_current_world");
    const world = Array.isArray(data) ? data[0] : data;
    if (error || !world) return OFFLINE;

    const edits: WorldEdit[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data: rows, error: blockError } = await supabase
        .from("world_blocks")
        .select("x,y,z,block")
        .eq("world_id", world.id)
        .range(from, from + pageSize - 1);
      if (blockError || !rows) break;
      for (const row of rows) {
        edits.push({ x: row.x, y: row.y, z: row.z, block: (row.block as BlockType | null) ?? null });
      }
      if (rows.length < pageSize) break;
    }

    return { worldId: world.id, seed: Number(world.seed), edits, online: true };
  } catch {
    return OFFLINE;
  }
}

// Saves one block change so players who join later still see it.
export async function saveEdit(worldId: string, edit: WorldEdit) {
  try {
    await supabase.from("world_blocks").upsert(
      {
        world_id: worldId,
        x: edit.x,
        y: edit.y,
        z: edit.z,
        block: edit.block,
        actor: CLIENT_ID,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "world_id,x,y,z" },
    );
  } catch {
    /* keep playing offline */
  }
}

export async function touchWorld(worldId: string) {
  try {
    await supabase.rpc("touch_world", { p_world: worldId });
  } catch {
    /* ignore */
  }
}

export type WorldChannel = {
  sendPose: (pose: Omit<RemotePose, "id">) => void;
  sendEdit: (edit: WorldEdit) => void;
  sendHit: (targetId: string, amount: number) => void;
  dispose: () => void;
};

// Live link for one world: block changes plus everyone's position.
export function connectWorld(
  worldId: string,
  handlers: {
    onEdit: (edit: WorldEdit) => void;
    onPlayers: (players: RemotePose[]) => void;
    onHit?: (amount: number, from: string) => void;
  },
): WorldChannel {
  const channel: RealtimeChannel = supabase.channel(`world-${worldId}`, {
    config: { broadcast: { self: false } },
  });

  // Who is in the world comes from presence (players stay visible while their
  // tab is connected, even if they stand perfectly still); poses arrive as
  // fast broadcasts on top of that roster.
  const poses = new Map<string, RemotePose>();
  const lastSeen = new Map<string, number>();
  let roster = new Set<string>();

  const publish = () => {
    const list: RemotePose[] = [];
    for (const id of roster) {
      const pose = poses.get(id);
      if (pose) list.push(pose);
    }
    handlers.onPlayers(list);
  };

  channel
    .on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<{ pose?: RemotePose }>();
      const next = new Set<string>();
      const now = Date.now();
      for (const [key, entries] of Object.entries(state)) {
        if (key === CLIENT_ID) continue;
        next.add(key);
        const seeded = entries?.[0]?.pose;
        // Presence is the slow fallback: only use it when live pose
        // broadcasts for that player have gone quiet.
        if (seeded && now - (lastSeen.get(key) ?? 0) > 2500) {
          poses.set(key, { ...seeded, id: key });
        }
      }
      for (const id of [...poses.keys()]) if (!next.has(id)) { poses.delete(id); lastSeen.delete(id); }
      roster = next;
      publish();
    })

    .on("broadcast", { event: "pose" }, ({ payload }) => {
      const pose = payload as RemotePose;
      if (!pose?.id || pose.id === CLIENT_ID) return;
      poses.set(pose.id, pose);
      lastSeen.set(pose.id, Date.now());
      if (!roster.has(pose.id)) roster.add(pose.id);
      publish();
    })
    .on("broadcast", { event: "leave" }, ({ payload }) => {
      const id = (payload as { id?: string })?.id;
      if (!id) return;
      poses.delete(id);
      roster.delete(id);
      publish();
    })
    .on("broadcast", { event: "hit" }, ({ payload }) => {
      const hit = payload as { target?: string; amount?: number; from?: string };
      if (hit?.target !== CLIENT_ID || !hit.amount) return;
      handlers.onHit?.(hit.amount, hit.from ?? "");
    })
    .on("broadcast", { event: "edit" }, ({ payload }) => {
      const edit = payload as WorldEdit & { actor?: string };
      if (edit.actor === CLIENT_ID) return;
      handlers.onEdit({ x: edit.x, y: edit.y, z: edit.z, block: edit.block });
    })
    ;

  let ready = false;
  let lastPose: Omit<RemotePose, "id"> | null = null;
  let claimingHits = false;
  const claimHits = async () => {
    if (claimingHits) return;
    claimingHits = true;
    try {
      const { data } = await supabase.rpc("claim_world_hits", {
        p_world: worldId,
        p_target: CLIENT_ID,
      });
      for (const hit of data ?? []) handlers.onHit?.(hit.amount, hit.attacker_id);
    } finally {
      claimingHits = false;
    }
  };
  let syncingEdits = false;
  const syncEdits = async () => {
    if (syncingEdits) return;
    syncingEdits = true;
    try {
      const { data } = await supabase
        .from("world_blocks")
        .select("x,y,z,block")
        .eq("world_id", worldId);
      for (const edit of data ?? []) {
        handlers.onEdit({ x: edit.x, y: edit.y, z: edit.z, block: (edit.block as BlockType | null) ?? null });
      }
    } finally {
      syncingEdits = false;
    }
  };
  channel.subscribe((status) => {
    ready = status === "SUBSCRIBED";
    if (status === "SUBSCRIBED") {
      void channel.track({ pose: lastPose ? { ...lastPose, id: CLIENT_ID } : null });
      void claimHits();
    } else {
      console.warn("[multiplayer] live link:", status);
    }
  });

  // Refresh our presence entry now and then so players who join later see us
  // at the right spot before our next pose broadcast reaches them, and so the
  // websocket keeps seeing traffic. Background tabs throttle normal timers,
  // which used to drop the connection (and the player) after a few seconds
  // away, so this runs off a worker ticker instead.
  let ticks = 0;
  const stopTicker = startBackgroundTicker(() => {
    ticks += 1;
    if (ticks % 5 === 0) {
      void claimHits();
      void syncEdits();
      if (ready && lastPose) void channel.track({ pose: { ...lastPose, id: CLIENT_ID } });
    }

  }, 1000);


  // Database changes live on their own channel: if that subscription is
  // rejected it must not take the live player/block broadcasts down with it.
  const dbChannel: RealtimeChannel = supabase.channel(`world-db-${worldId}`);
  dbChannel
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "world_blocks", filter: `world_id=eq.${worldId}` },
      (payload) => {
        const row = payload.new as {
          x: number;
          y: number;
          z: number;
          block: string | null;
          actor: string | null;
        } | null;
        if (!row || row.actor === CLIENT_ID) return;
        handlers.onEdit({ x: row.x, y: row.y, z: row.z, block: (row.block as BlockType | null) ?? null });
      },
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "world_hits", filter: `world_id=eq.${worldId}` },
      (payload) => {
        const hit = payload.new as { target_id?: string } | null;
        if (hit?.target_id === CLIENT_ID) void claimHits();
      },
    )
    .subscribe();


  return {
    sendPose: (pose) => {
      lastPose = pose;
      if (!ready) return;
      void channel.send({
        type: "broadcast",
        event: "pose",
        payload: { id: CLIENT_ID, ...pose },
      });
    },
    sendEdit: (edit) => {
      void channel.send({
        type: "broadcast",
        event: "edit",
        payload: { ...edit, actor: CLIENT_ID },
      });
      void saveEdit(worldId, edit);
    },
    sendHit: (targetId, amount) => {
      if (!ready) return;
      // Persist first: broadcasts are intentionally ephemeral and can be lost
      // while the receiving browser has suspended its websocket in a hidden tab.
      void supabase.from("world_hits").insert({
        world_id: worldId,
        target_id: targetId,
        attacker_id: CLIENT_ID,
        amount,
      });
    },
    dispose: () => {
      stopTicker();
      if (ready) void channel.send({ type: "broadcast", event: "leave", payload: { id: CLIENT_ID } });
      void supabase.removeChannel(channel);
      void supabase.removeChannel(dbChannel);
    },
  };
}
