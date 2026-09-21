import { supabase } from "@/integrations/supabase/client";
import type { BlockType, WorldEdit } from "@/components/voxelWorld";
import type { RealtimeChannel } from "@supabase/supabase-js";

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
  dispose: () => void;
};

// Live link for one world: block changes plus everyone's position.
export function connectWorld(
  worldId: string,
  handlers: {
    onEdit: (edit: WorldEdit) => void;
    onPlayers: (players: RemotePose[]) => void;
  },
): WorldChannel {
  const channel: RealtimeChannel = supabase.channel(`world-${worldId}`, {
    config: { broadcast: { self: false } },
  });

  // Poses arrive as fast broadcasts; a player disappears when their updates
  // stop coming in (tab closed, lost connection).
  const poses = new Map<string, { pose: RemotePose; at: number }>();
  const publish = () => {
    handlers.onPlayers([...poses.values()].map((entry) => entry.pose));
  };
  const prune = setInterval(() => {
    const cutoff = Date.now() - 6000;
    let changed = false;
    for (const [id, entry] of poses) {
      if (entry.at < cutoff) {
        poses.delete(id);
        changed = true;
      }
    }
    if (changed) publish();
  }, 2000);

  channel
    .on("broadcast", { event: "pose" }, ({ payload }) => {
      const pose = payload as RemotePose;
      if (!pose?.id || pose.id === CLIENT_ID) return;
      const isNew = !poses.has(pose.id);
      poses.set(pose.id, { pose, at: Date.now() });
      if (isNew) publish();
      else {
        const known = poses.get(pose.id)!;
        known.pose = pose;
        publish();
      }
    })
    .on("broadcast", { event: "leave" }, ({ payload }) => {
      const id = (payload as { id?: string })?.id;
      if (id && poses.delete(id)) publish();
    })
    .on("broadcast", { event: "edit" }, ({ payload }) => {
      const edit = payload as WorldEdit & { actor?: string };
      if (edit.actor === CLIENT_ID) return;
      handlers.onEdit({ x: edit.x, y: edit.y, z: edit.z, block: edit.block });
    })
    ;

  let ready = false;
  channel.subscribe((status) => {
    ready = status === "SUBSCRIBED";
    if (status !== "SUBSCRIBED") console.warn("[multiplayer] live link:", status);
  });

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
    .subscribe();


  return {
    sendPose: (pose) => {
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
    dispose: () => {
      clearInterval(prune);
      if (ready) void channel.send({ type: "broadcast", event: "leave", payload: { id: CLIENT_ID } });
      void supabase.removeChannel(channel);
      void supabase.removeChannel(dbChannel);
    },
  };
}
