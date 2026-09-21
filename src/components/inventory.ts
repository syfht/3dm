import type { BlockType } from "./voxelWorld";

export type Slot = { type: BlockType; count: number } | null;

export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36; // 4 rows x 9 columns (row 0 is the hotbar)
export const STACK_LIMIT = 64;

export const BLOCK_LABEL: Record<BlockType, string> = {
  grass: "Grass Block",
  wood: "Wood Log",
  leaves: "Leaves",
  planks: "Planks",
  crafting_table: "Crafting Table",
};

// Seconds of continuous mining needed to break each block.
export const BREAK_TIMES: Record<BlockType, number> = {
  grass: 0.95,
  wood: 1.6,
  leaves: 0.3,
  planks: 1.2,
  crafting_table: 1.4,
};

// 2x2 shapeless crafting: 1 wood -> 4 planks, 4 planks -> 1 crafting table.
export function craftResult(grid: Slot[]): Slot {
  const filled = grid.filter((slot): slot is NonNullable<Slot> => Boolean(slot));
  if (filled.length === 1 && filled[0]!.type === "wood") return { type: "planks", count: 4 };
  if (filled.length === 4 && filled.every((slot) => slot.type === "planks")) {
    return { type: "crafting_table", count: 1 };
  }
  return null;
}
