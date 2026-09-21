import { BLOCK_LABEL, HOTBAR_SIZE, craftResult, type Slot } from "./inventory";

type Props = {
  inventory: Slot[];
  craftGrid: Slot[];
  cursor: Slot;
  cursorPos: { x: number; y: number };
  onSlotClick: (area: "inv" | "craft", index: number, right: boolean) => void;
  onTakeResult: (right: boolean) => void;
  onClose: () => void;
  onCursorMove: (x: number, y: number) => void;
};

function SlotIcon({ slot }: { slot: Slot }) {
  if (!slot) return null;
  return (
    <>
      <span className={`block-icon is-${slot.type}`} aria-hidden="true" />
      {slot.count > 1 ? <span className="slot-count">{slot.count}</span> : null}
    </>
  );
}

export default function InventoryPanel({
  inventory,
  craftGrid,
  cursor,
  cursorPos,
  onSlotClick,
  onTakeResult,
  onClose,
  onCursorMove,
}: Props) {
  const result = craftResult(craftGrid);

  const slotButton = (slot: Slot, area: "inv" | "craft", index: number) => (
    <button
      key={`${area}-${index}`}
      type="button"
      className="inv-slot"
      aria-label={slot ? `${BLOCK_LABEL[slot.type]} x${slot.count}` : "Empty slot"}
      onClick={() => onSlotClick(area, index, false)}
      onContextMenu={(event) => {
        event.preventDefault();
        onSlotClick(area, index, true);
      }}
    >
      <SlotIcon slot={slot} />
    </button>
  );

  return (
    <div
      className="inventory-overlay"
      onMouseMove={(event) => onCursorMove(event.clientX, event.clientY)}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="inventory-panel" role="dialog" aria-label="Inventory">
        <header className="inventory-head">
          <h2>Inventory</h2>
          <button type="button" className="inventory-close" onClick={onClose}>
            Close (T)
          </button>
        </header>

        <section className="crafting-row" aria-label="Crafting">
          <div className="craft-grid">
            {craftGrid.map((slot, index) => slotButton(slot, "craft", index))}
          </div>
          <span className="craft-arrow" aria-hidden="true">
            →
          </span>
          <button
            type="button"
            className="inv-slot is-result"
            aria-label={result ? `Craft ${BLOCK_LABEL[result.type]} x${result.count}` : "No recipe"}
            onClick={() => onTakeResult(false)}
            onContextMenu={(event) => {
              event.preventDefault();
              onTakeResult(true);
            }}
          >
            <SlotIcon slot={result} />
          </button>
          <p className="craft-hint">
            1 Wood Log → 4 Planks
            <br />
            4 Planks → 1 Crafting Table
          </p>
        </section>

        <div className="inv-grid" aria-label="Storage">
          {inventory.slice(HOTBAR_SIZE).map((slot, offset) => slotButton(slot, "inv", offset + HOTBAR_SIZE))}
        </div>

        <div className="inv-grid is-hotbar" aria-label="Hotbar">
          {inventory.slice(0, HOTBAR_SIZE).map((slot, index) => slotButton(slot, "inv", index))}
        </div>
      </div>

      {cursor ? (
        <div className="cursor-stack" style={{ left: cursorPos.x, top: cursorPos.y }} aria-hidden="true">
          <span className={`block-icon is-${cursor.type}`} />
          {cursor.count > 1 ? <span className="slot-count">{cursor.count}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
