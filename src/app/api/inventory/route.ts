import { NextRequest, NextResponse } from "next/server";
import {
  listOperationalInventory,
  getOperationalInventoryItem,
  upsertOperationalInventoryItem,
  updateOperationalInventoryItem,
  adjustInventoryStock,
  archiveOperationalInventoryItem,
  listInventoryAdjustments,
  recordAuditLog,
  recordOperationalEvent,
} from "@/lib/db";
import { ingredients as seedIngredients } from "@/data/seed";
import { eventBroadcaster } from "@/lib/event-broadcaster";
import { processOperationalEvent } from "@/lib/event-service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const includeArchived = searchParams.get("includeArchived") === "true";
    const history = searchParams.get("history") === "true";
    const ingredientId = searchParams.get("ingredientId") || undefined;

    const inventory = listOperationalInventory(includeArchived);
    const adjustments = history ? listInventoryAdjustments(ingredientId) : [];

    return NextResponse.json({
      inventory,
      adjustments,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action;
    const actor = body.performedBy || "hadishanavas7454";

    if (action === "add") {
      const item = body.item;
      if (!item || !item.name || !item.baseUnit) {
        return NextResponse.json({ error: "Name and baseUnit are required" }, { status: 400 });
      }

      const saved = upsertOperationalInventoryItem({
        id: item.id,
        name: item.name.trim(),
        baseUnit: item.baseUnit.trim(),
        onHand: Number(item.onHand || 0),
        reorderAt: Number(item.reorderAt || 0),
        archived: false,
      });

      recordAuditLog({
        id: `audit-${crypto.randomUUID()}`,
        eventType: "INVENTORY_ITEM_CREATED",
        proposedBy: actor,
        changeDescription: `Added new inventory item "${saved.name}" with initial stock ${saved.onHand} ${saved.baseUnit} (Reorder threshold: ${saved.reorderAt} ${saved.baseUnit})`,
        evidence: `Initial quantity: ${saved.onHand} ${saved.baseUnit}`,
        reason: body.reason || "Manual addition by bakery manager",
        approvedBy: actor,
        decisionAt: new Date().toISOString(),
        executionStatus: "EXECUTED",
        previousValue: "None",
        newValue: `${saved.onHand} ${saved.baseUnit}`,
      });

      eventBroadcaster.broadcast("inventory_updated", { action: "add", item: saved });

      // M5 Event: INVENTORY_ITEM_CREATED
      const opEvent = recordOperationalEvent({
        id: body.eventId || `evt-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
        eventType: "INVENTORY_ITEM_CREATED",
        sourceEntity: "inventory",
        sourceId: saved.id,
        payload: { item: saved, performedBy: actor },
        responsibleAgentId: "inventory-manager",
      });
      await processOperationalEvent(opEvent.id).catch(() => {});

      return NextResponse.json({ success: true, item: saved, event: opEvent }, { status: 201 });
    }

    if (action === "edit") {
      const { id, updates } = body;
      if (!id || !updates) {
        return NextResponse.json({ error: "Item ID and updates are required" }, { status: 400 });
      }

      const prev = getOperationalInventoryItem(id);
      if (!prev) {
        return NextResponse.json({ error: `Item "${id}" not found` }, { status: 404 });
      }

      const updated = updateOperationalInventoryItem(id, updates);

      recordAuditLog({
        id: `audit-${crypto.randomUUID()}`,
        eventType: "INVENTORY_ITEM_UPDATED",
        proposedBy: actor,
        changeDescription: `Edited inventory item "${updated?.name || id}"`,
        evidence: `Prev: ${prev.name}, ${prev.onHand} ${prev.baseUnit}, Reorder: ${prev.reorderAt} -> New: ${updated?.name}, ${updated?.onHand} ${updated?.baseUnit}, Reorder: ${updated?.reorderAt}`,
        reason: body.reason || "Manual detail update by manager",
        approvedBy: actor,
        decisionAt: new Date().toISOString(),
        executionStatus: "EXECUTED",
        previousValue: `${prev.onHand} ${prev.baseUnit} (reorder: ${prev.reorderAt})`,
        newValue: `${updated?.onHand} ${updated?.baseUnit} (reorder: ${updated?.reorderAt})`,
      });

      eventBroadcaster.broadcast("inventory_updated", { action: "edit", item: updated });

      // M5 Event: INVENTORY_ITEM_DETAILS_CHANGED
      const opEvent = recordOperationalEvent({
        id: body.eventId || `evt-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
        eventType: "INVENTORY_ITEM_DETAILS_CHANGED",
        sourceEntity: "inventory",
        sourceId: id,
        payload: { item: updated, previous: prev, performedBy: actor },
        responsibleAgentId: "inventory-manager",
      });
      await processOperationalEvent(opEvent.id).catch(() => {});

      return NextResponse.json({ success: true, item: updated, event: opEvent }, { status: 200 });
    }

    if (action === "adjust") {
      const { ingredientId, adjustmentAmount, reason } = body;
      if (!ingredientId || typeof adjustmentAmount !== "number") {
        return NextResponse.json(
          { error: "ingredientId and numerical adjustmentAmount are required" },
          { status: 400 }
        );
      }

      const result = adjustInventoryStock({
        ingredientId,
        adjustmentAmount,
        reason: reason || (adjustmentAmount > 0 ? "Stock purchase / replenishment" : "Stock reduction / usage"),
        performedBy: actor,
      });

      eventBroadcaster.broadcast("inventory_updated", {
        action: "adjust",
        ingredientId,
        adjustment: result.adjustment,
        ingredient: result.ingredient,
      });

      // M5 Event: INVENTORY_STOCK_ADJUSTED (only recorded AFTER SQLite update succeeds)
      const opEvent = recordOperationalEvent({
        id: body.eventId || `evt-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
        eventType: "INVENTORY_STOCK_ADJUSTED",
        sourceEntity: "inventory",
        sourceId: ingredientId,
        payload: {
          previousQuantity: result.adjustment.previousQuantity,
          adjustmentAmount: result.adjustment.adjustmentAmount,
          newQuantity: result.adjustment.newQuantity,
          unit: result.adjustment.unit,
          reason: result.adjustment.reason,
          performedBy: actor,
        },
        responsibleAgentId: "inventory-manager",
      });
      await processOperationalEvent(opEvent.id).catch(() => {});

      return NextResponse.json({ success: true, ...result, event: opEvent }, { status: 200 });
    }

    if (action === "archive") {
      const { id, archived } = body;
      if (!id) {
        return NextResponse.json({ error: "Item ID is required" }, { status: 400 });
      }

      const isArchiving = archived !== false;
      const success = archiveOperationalInventoryItem(id, isArchiving, actor);
      if (!success) {
        return NextResponse.json({ error: `Item "${id}" not found` }, { status: 404 });
      }

      const updated = getOperationalInventoryItem(id);
      eventBroadcaster.broadcast("inventory_updated", { action: "archive", item: updated });

      // M5 Event: INVENTORY_ITEM_ARCHIVED or INVENTORY_ITEM_RESTORED
      const opEvent = recordOperationalEvent({
        id: body.eventId || `evt-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
        eventType: isArchiving ? "INVENTORY_ITEM_ARCHIVED" : "INVENTORY_ITEM_RESTORED",
        sourceEntity: "inventory",
        sourceId: id,
        payload: { item: updated, performedBy: actor },
        responsibleAgentId: "inventory-manager",
      });
      await processOperationalEvent(opEvent.id).catch(() => {});

      return NextResponse.json({ success: true, item: updated, event: opEvent }, { status: 200 });
    }

    if (action === "seed_standard") {
      for (const item of seedIngredients) {
        upsertOperationalInventoryItem({
          id: item.id,
          name: item.name,
          baseUnit: item.baseUnit,
          onHand: item.onHand,
          reorderAt: item.reorderAt,
          archived: false,
        });
      }

      recordAuditLog({
        id: `audit-${crypto.randomUUID()}`,
        eventType: "INVENTORY_STANDARD_SEEDED",
        proposedBy: actor,
        changeDescription: `Loaded ${seedIngredients.length} standard bakery ingredients into operational inventory`,
        evidence: seedIngredients.map((i) => `${i.name}: ${i.onHand}${i.baseUnit}`).join(", "),
        reason: "Manager initiated standard bakery inventory preload",
        approvedBy: actor,
        decisionAt: new Date().toISOString(),
        executionStatus: "EXECUTED",
      });

      const updatedList = listOperationalInventory(true);
      eventBroadcaster.broadcast("inventory_updated", { action: "seed_standard", inventory: updatedList });
      return NextResponse.json({ success: true, count: seedIngredients.length, inventory: updatedList }, { status: 200 });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
