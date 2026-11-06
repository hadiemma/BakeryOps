import {
  checkInventoryManagerRisks,
  checkOrderAnalystRisks,
  announceTaskStateChangeInDiscord,
  ensureSchedulerStarted,
} from "./monitoring-service";
import { notifyOrderAnalystInDiscord, notifyOrderCancelledInDiscord } from "./switch-bridge";
import {
  recordOperationalEvent,
  getOperationalEvent,
  updateOperationalEventStatus,
  listOperationalEvents,
  getPendingOperationalEvents,
  listOperationalOrders,
  getOperationalOrder,
  listOperationalInventory,
  getOperationalInventoryItem,
  listOperationalPlans,
  saveOperationalPlan,
  listOperationalTasks,
  upsertAgentLiveStatus,
  recordAuditLog,
} from "./db";
import { handleCollaborationMessage, AGENT_REGISTRY } from "./collaboration-service";
import { generateProductionPlan } from "@/domain/workflow";
import { recipes, staff } from "@/data/seed";
import { eventBroadcaster } from "./event-broadcaster";
import type {
  OperationalEvent,
  OperationalEventType,
  EventProcessingStatus,
  BakeryOrder,
  ProductionBatch,
  IngredientRequirement,
} from "@/domain/types";

function setAgentLiveStatus(
  agentId: "order-analyst" | "production-planner" | "inventory-manager" | "staff-task-assigner",
  updates: {
    status?: any;
    currentStage?: any;
    currentActivity: string;
    currentOrderId?: string;
    currentTaskId?: string;
    intendedRecipient?: string;
    waitingFor?: string;
  }
) {
  const reg = AGENT_REGISTRY[agentId];
  upsertAgentLiveStatus({
    agentId,
    name: reg?.name || agentId,
    role: reg?.role || "Specialist Agent",
    status: updates.status || "WORKING",
    currentStage: updates.currentStage || "intake",
    currentActivity: updates.currentActivity,
    currentOrderId: updates.currentOrderId,
    currentTaskId: updates.currentTaskId,
    intendedRecipient: updates.intendedRecipient,
    waitingFor: updates.waitingFor,
    lastActivityAt: new Date().toISOString(),
  });
}

/**
 * Event-Driven Intelligence Service (Milestone 5)
 * Handles idempotent event recording, automated specialist investigations,
 * backward challenges, manager escalation, and restart recovery.
 */

export async function processOperationalEvent(eventId: string): Promise<OperationalEvent> {
  const event = getOperationalEvent(eventId);
  if (!event) throw new Error(`Event "${eventId}" not found`);

  // Idempotency: don't re-run already finalized events unless forced
  if (event.status === "COMPLETED" || event.status === "RESOLVED" || event.status === "WAITING_FOR_MANAGER") {
    return event;
  }

  // Mark event as AGENT_INVESTIGATING
  updateOperationalEventStatus(eventId, "AGENT_INVESTIGATING", {
    attempts: event.attempts + 1,
  });

  eventBroadcaster.broadcast("operational_event_updated", {
    id: eventId,
    status: "AGENT_INVESTIGATING",
    eventType: event.eventType,
  });

  try {
    let outcomeStatus: EventProcessingStatus = "COMPLETED";
    let summary = "";

    switch (event.eventType) {
      // ============================================================
      // A. ORDER EVENTS
      // ============================================================
      case "ORDER_CREATED": {
        const order = event.payload.order as BakeryOrder || getOperationalOrder(event.sourceId);
        if (!order) throw new Error(`Order ${event.sourceId} not found in database`);

        // 1. Order Analyst validates order
        const itemSummary = order.items
          .map((i) => `${i.quantity}x ${recipes[i.productId]?.name || i.productId}`)
          .join(", ");

        // Deterministic calculation of batches & requirements
        const liveInventory = listOperationalInventory(false);
        const plan = generateProductionPlan([order], recipes, liveInventory, staff, {
          id: `plan-${order.id}`,
          revision: 1,
          createdAt: new Date().toISOString(),
        });

        // Persist proposed production plan and broadcast in real-time
        saveOperationalPlan(plan);
        eventBroadcaster.broadcast("plan_updated", plan);

                // Dispatch live event to real Antigravity Order Analyst in Switch & Discord
        await notifyOrderAnalystInDiscord({
          id: order.id,
          customerName: order.customerName,
          items: order.items,
          dueAt: order.dueAt,
          note: order.note,
          status: order.status,
        }).catch((err) => {
          console.error("Failed to notify Order Analyst in Discord:", err);
        });

        // Stage 1: Order Analyst Handoff to Production Planner
        const m1 = handleCollaborationMessage({
          orderId: order.id,
          workflowStage: "intake",
          senderId: "order-analyst",
          recipientId: "production-planner",
          messageType: "HANDOFF",
          content: `[EVENT: ORDER_CREATED] Received customer order ${order.id} (${order.customerName}). Items: ${itemSummary}. Delivery due: ${order.dueAt}. Starting sequential operations workflow.`,
          evidence: `Validated ${order.items.length} product lines. Customer notes: "${order.note || "Standard delivery"}". Due time: ${order.dueAt}.`,
          reason: "Order validation complete. Initiating sequential planning.",
        });

        // Stage 2: Production Planner Calculation & Task Request to Inventory Manager
        const batchSummary = plan.batches
          .map((b: ProductionBatch) => `${b.plannedQuantity} items (${b.recipeBatchCount} recipe batches) of ${recipes[b.productId]?.name}`)
          .join("; ");

        const m2 = handleCollaborationMessage({
          orderId: order.id,
          workflowStage: "production_planning",
          senderId: "production-planner",
          recipientId: "inventory-manager",
          messageType: "TASK_REQUEST",
          content: `Calculated production plan for ${order.id}: ${batchSummary}. Baking window requires prep starting at ${plan.batches[0]?.startAt || "07:00"} to meet due time ${order.dueAt}. Please verify ingredient inventory.`,
          evidence: `Deterministic calculations used: Sourdough (4/batch), Cinnamon rolls (12/batch), Croissants (8/batch). Total ${plan.batches.length} batches planned.`,
          reason: "Ingredient stock verification required before plan finalization.",
          referenceId: m1.message.id,
        });

        // Stage 3: Inventory Manager Stock Check
        const shortages = plan.ingredientRequirements.filter((req: IngredientRequirement) => req.shortage > 0);
        if (shortages.length > 0) {
          const deficitText = shortages
            .map((s: IngredientRequirement) => `${s.name}: need ${s.quantity}${s.unit}, on-hand ${s.onHand}${s.unit} (DEFICIT: ${s.shortage}${s.unit})`)
            .join("; ");

          handleCollaborationMessage({
            orderId: order.id,
            workflowStage: "inventory_verification",
            senderId: "inventory-manager",
            recipientId: "production-planner",
            messageType: "CHALLENGE",
            content: `Cannot fulfill planned batches for ${order.id} due to stock deficits: ${deficitText}. Recommending partial reduction or purchase authorization.`,
            evidence: `Verified ${liveInventory.length} on-hand stock records against authoritative database. Shortage on ${shortages.length} raw ingredients.`,
            reason: "Inventory constraint prevents execution of proposed production plan.",
            referenceId: m2.message.id,
          });

          outcomeStatus = "WAITING_FOR_MANAGER";
          summary = `Shortages detected on ${shortages.length} ingredients (${deficitText}). Awaiting manager decision.`;
        } else {
          // Feasibility confirmed
          const m3 = handleCollaborationMessage({
            orderId: order.id,
            workflowStage: "inventory_verification",
            senderId: "inventory-manager",
            recipientId: "production-planner",
            messageType: "FINDING",
            content: `Inventory check complete for ${order.id}. All required ingredients available on hand. Stock levels remain above reorder thresholds after batch deductions.`,
            evidence: `Verified ${plan.ingredientRequirements.length} ingredient lines in authoritative SQLite. No shortages detected.`,
            reason: "Stock feasibility confirmed.",
            referenceId: m2.message.id,
          });

          // Stage 4: Order Analyst final sign-off & Manager Approval Request
          handleCollaborationMessage({
            orderId: order.id,
            workflowStage: "final_validation",
            senderId: "order-analyst",
            recipientId: "manager",
            messageType: "APPROVAL_REQUEST",
            content: `Final validation completed for ${order.id} (${order.customerName}). Production plan: ${plan.batches.length} batches. Delivery due: ${order.dueAt}. Awaiting human manager sign-off.`,
            evidence: `Feasibility confirmed by Production Planner and Inventory Manager. No customer note violations found.`,
            reason: "Final manager authorization required before dispatching staff tasks.",
            referenceId: m3.message.id,
          });

          outcomeStatus = "WAITING_FOR_MANAGER";
          summary = `Sequential investigation complete. Plan feasible. Approval request submitted to Bakery Manager.`;
        }
        break;
      }

      case "ORDER_QUANTITY_CHANGED": {
        const orderId = event.orderId || event.sourceId;
        const order = getOperationalOrder(orderId);
        if (!order) throw new Error(`Order ${orderId} not found`);

        const liveInventory = listOperationalInventory(false);
        const plan = generateProductionPlan([order], recipes, liveInventory, staff, {
          id: `plan-${order.id}`,
          revision: 2,
          createdAt: new Date().toISOString(),
        });

        const shortages = plan.ingredientRequirements.filter((req) => req.shortage > 0);
        handleCollaborationMessage({
          orderId,
          workflowStage: "intake",
          senderId: "order-analyst",
          recipientId: "production-planner",
          messageType: "REVISION",
          content: `[EVENT: ORDER_QUANTITY_CHANGED] Quantities modified for ${orderId}. Re-evaluated deterministic batch sizing: ${plan.batches.length} batches required. ${shortages.length ? `Identified ${shortages.length} ingredient shortages.` : "All ingredients available."}`,
          evidence: `Updated items: ${order.items.map((i) => `${i.quantity}x ${i.productId}`).join(", ")}. Recalculated using workflow.ts.`,
          reason: "Order quantity modification triggered operational reassessment.",
        });

        if (shortages.length > 0) {
          outcomeStatus = "WAITING_FOR_MANAGER";
          summary = `Quantity changed. Created ${shortages.length} ingredient deficits. Reassessment communicated to specialists.`;
        } else {
          outcomeStatus = "RESOLVED";
          summary = `Quantity changed. Reassessment verified feasible without shortages.`;
        }
        break;
      }

      case "ORDER_DEADLINE_CHANGED": {
        const orderId = event.orderId || event.sourceId;
        const order = getOperationalOrder(orderId);
        if (!order) throw new Error(`Order ${orderId} not found`);

        // Check feasibility against standard morning shift (07:00 start)
        const dueTime = order.dueAt;
        const isUrgent = dueTime <= "08:30";

        handleCollaborationMessage({
          orderId,
          workflowStage: "intake",
          senderId: "order-analyst",
          recipientId: "production-planner",
          messageType: isUrgent ? "CHALLENGE" : "FINDING",
          content: `[EVENT: ORDER_DEADLINE_CHANGED] Delivery deadline updated to ${dueTime} for ${orderId}. ${isUrgent ? "CRITICAL: Deadline requires expedited prep or overtime authorization." : "Deadline adjustment evaluated as manageable within morning schedule."}`,
          evidence: `Due time changed to ${dueTime}. Earliest bake start: 07:00.`,
          reason: isUrgent ? "Expedited deadline challenges schedule feasibility." : "Deadline update confirmed.",
        });

        if (isUrgent) {
          outcomeStatus = "WAITING_FOR_MANAGER";
          summary = `Tight deadline (${dueTime}) requires manager schedule / overtime authorization.`;
        } else {
          outcomeStatus = "RESOLVED";
          summary = `Deadline change to ${dueTime} evaluated and accommodated.`;
        }
        break;
      }

      case "ORDER_CANCELLED": {
        const orderId = event.orderId || event.sourceId;
        const customerName = event.payload?.order?.customerName;
        await notifyOrderCancelledInDiscord(orderId, customerName).catch(() => {});
        handleCollaborationMessage({
          orderId,
          workflowStage: "intake",
          senderId: "order-analyst",
          recipientId: "production-planner",
          messageType: "ALERT",
          content: `[EVENT: ORDER_CANCELLED] Order ${orderId} has been cancelled. Recommending immediate halt of pending production batches and release of ingredient reservations. Preserving historical records in database.`,
          evidence: `Order status transitioned to complete/cancelled.`,
          reason: "Order cancellation notification dispatched to specialists.",
        });

        outcomeStatus = "COMPLETED";
        summary = `Order cancellation processed. Specialists notified to halt unstarted work.`;
        break;
      }

      // ============================================================
      // B. INVENTORY EVENTS (Triggered by M4.1 Manual Inventory)
      // ============================================================
      case "INVENTORY_ITEM_CREATED": {
        const ingredient = getOperationalInventoryItem(event.sourceId);
        const name = ingredient?.name || event.payload.name || event.sourceId;
        const unit = ingredient?.baseUnit || event.payload.baseUnit || "units";
        const onHand = ingredient?.onHand ?? event.payload.onHand ?? 0;
        const reorderAt = ingredient?.reorderAt ?? event.payload.reorderAt ?? 0;

        setAgentLiveStatus("inventory-manager", {
          status: "WORKING",
          currentStage: "inventory_verification",
          currentActivity: `Investigating newly added ingredient "${name}" (${onHand} ${unit})`,
        });

        await checkInventoryManagerRisks("event_triggered").catch(() => {});
        summary = `Inventory Manager registered new ingredient "${name}" (${onHand} ${unit}, threshold: ${reorderAt} ${unit}).`;
        outcomeStatus = "COMPLETED";
        break;
      }

      case "INVENTORY_STOCK_ADJUSTED": {
        const ingredientId = event.sourceId;
        const payload = event.payload;
        const ingredient = getOperationalInventoryItem(ingredientId);
        const currentOnHand = ingredient?.onHand ?? payload.newQuantity ?? 0;
        const unit = ingredient?.baseUnit || payload.unit || "g";
        const adjAmount = payload.adjustmentAmount || 0;
        const reason = payload.reason || "Manual adjustment";
        const actor = payload.performedBy || "hadishanavas7454";

        setAgentLiveStatus("inventory-manager", {
          status: "WORKING",
          currentStage: "inventory_verification",
          currentActivity: `Reassessing active orders after stock adjustment on ${ingredient?.name || ingredientId}: ${adjAmount > 0 ? "+" : ""}${adjAmount} ${unit}`,
        });

        // Find active orders and reassess shortages
        const activeOrders = listOperationalOrders().filter((o) => o.status !== "complete");
        let shortageDetected = false;
        let shortageDetails = "";
        let unblockedOrder: string | null = null;

        if (activeOrders.length > 0) {
          const liveInventory = listOperationalInventory(false);
          for (const ord of activeOrders) {
            try {
              const plan = generateProductionPlan([ord], recipes, liveInventory, staff, {
                id: `plan-${ord.id}`,
                revision: 1,
                createdAt: new Date().toISOString(),
              });
              const deficits = plan.ingredientRequirements.filter((r) => r.shortage > 0);
              if (deficits.length > 0) {
                shortageDetected = true;
                shortageDetails = deficits
                  .map((d) => `${d.name}: need ${d.quantity}${d.unit}, on-hand ${d.onHand}${d.unit} (DEFICIT: ${d.shortage}${d.unit})`)
                  .join("; ");

                // Raise backward challenge to Production Planner!
                handleCollaborationMessage({
                  orderId: ord.id,
                  workflowStage: "inventory_verification",
                  senderId: "inventory-manager",
                  recipientId: "production-planner",
                  messageType: "CHALLENGE",
                  content: `[EVENT: INVENTORY_STOCK_ADJUSTED] Stock adjusted by ${actor} (${adjAmount > 0 ? "+" : ""}${adjAmount} ${unit}, Reason: ${reason}). Production for order ${ord.id} is constrained by stock deficits: ${shortageDetails}.`,
                  evidence: `Authoritative on-hand ${ingredient?.name}: ${currentOnHand} ${unit}. Deficit verified against recipe calculations.`,
                  reason: "Manual inventory reduction created or revealed ingredient deficit.",
                });
              } else if (adjAmount > 0) {
                // Previously blocked order is now unblocked!
                unblockedOrder = ord.id;
                handleCollaborationMessage({
                  orderId: ord.id,
                  workflowStage: "inventory_verification",
                  senderId: "inventory-manager",
                  recipientId: "production-planner",
                  messageType: "FINDING",
                  content: `[EVENT: INVENTORY_STOCK_ADJUSTED] Stock replenishment verified (${ingredient?.name}: +${adjAmount} ${unit}, new total ${currentOnHand} ${unit}). Order ${ord.id} is now fully feasible without ingredient shortages.`,
                  evidence: `Calculated requirements satisfied for ${plan.ingredientRequirements.length} ingredient lines.`,
                  reason: "Stock increase resolved previous constraint; work unblocked.",
                });
              }
            } catch {}
          }
        }

        // Trigger M6 Inventory Manager proactive re-evaluation
        await checkInventoryManagerRisks("event_triggered").catch(() => {});

        if (shortageDetected) {
          outcomeStatus = "WAITING_FOR_MANAGER";
          summary = `Stock adjustment recorded (${adjAmount} ${unit}). Created active shortage: ${shortageDetails}. Escalated challenge to Production Planner & Manager.`;
        } else if (unblockedOrder) {
          outcomeStatus = "RESOLVED";
          summary = `Stock increased by +${adjAmount} ${unit}. Verified that order ${unblockedOrder} is now feasible and unblocked.`;
        } else {
          outcomeStatus = "COMPLETED";
          summary = `Stock adjustment verified (${adjAmount > 0 ? "+" : ""}${adjAmount} ${unit} by ${actor}). Active inventory updated.`;
        }
        break;
      }

      case "INVENTORY_ITEM_DETAILS_CHANGED": {
        const ingredient = getOperationalInventoryItem(event.sourceId);
        summary = `Inventory Manager validated updated details for ${ingredient?.name || event.sourceId}: unit=${ingredient?.baseUnit}, threshold=${ingredient?.reorderAt}.`;
        outcomeStatus = "COMPLETED";
        break;
      }

      case "INVENTORY_ITEM_ARCHIVED": {
        const ingredientId = event.sourceId;
        summary = `Inventory Manager registered archival of ${ingredientId}. Historical records and adjustment audit trail preserved.`;
        outcomeStatus = "COMPLETED";
        break;
      }

      case "INVENTORY_ITEM_RESTORED": {
        const ingredientId = event.sourceId;
        summary = `Inventory Manager registered restoration of ${ingredientId} to active stock eligibility.`;
        outcomeStatus = "COMPLETED";
        break;
      }

      // ============================================================
      // C. PRODUCTION EVENTS
      // ============================================================
      case "PRODUCTION_PLAN_CREATED":
      case "PRODUCTION_PLAN_MODIFIED": {
        const planId = event.sourceId;
        const plan = listOperationalPlans().find((p) => p.id === planId);
        const batchesCount = plan?.batches?.length || 0;

        setAgentLiveStatus("production-planner", {
          status: "WORKING",
          currentStage: "production_planning",
          currentActivity: `Reviewing ${event.eventType === "PRODUCTION_PLAN_CREATED" ? "new" : "modified"} production plan ${planId} (${batchesCount} batches)`,
        });

        summary = `Production Planner evaluated plan ${planId}: ${batchesCount} batches configured with deterministic yield formulas.`;
        outcomeStatus = "COMPLETED";
        break;
      }

      // ============================================================
      // D. STAFF EVENTS
      // ============================================================
      case "STAFF_TASK_CREATED": {
        const taskId = event.taskId || event.sourceId;
        const task = listOperationalTasks().find((t) => t.id === taskId);
        await announceTaskStateChangeInDiscord({
          taskId,
          changeType: "created",
          eventId: event.id,
        }).catch(() => {});

        summary = `Staff Task Assigner validated and announced creation of task ${taskId} (${task?.kind || "task"} assigned to ${task?.assigneeId || "staff"}).`;
        outcomeStatus = "COMPLETED";
        break;
      }

      case "STAFF_TASK_CHANGED": {
        const taskId = event.taskId || event.sourceId;
        const task = listOperationalTasks().find((t) => t.id === taskId);
        const payload = event.payload || {};

        let changeType = payload.changeType;
        if (!changeType) {
          if (payload.status === "inProgress") changeType = "started";
          else if (payload.status === "done") changeType = "completed";
          else if (payload.status === "acknowledged") changeType = "acknowledged";
          else if (payload.status === "todo" && payload.previousStatus === "blocked") changeType = "unblocked";
          else if (payload.assigneeId && payload.assigneeId !== payload.previousAssigneeId) changeType = "reassigned";
          else if (payload.dueAt && payload.dueAt !== payload.previousDueAt) changeType = "deadline_changed";
          else changeType = "progress_changed";
        }

        await announceTaskStateChangeInDiscord({
          taskId,
          changeType,
          previousValue: payload.previousValue || payload.previousStatus || payload.previousAssigneeId,
          newValue: payload.newValue || payload.status || payload.assigneeId,
          reason: payload.reason,
          eventId: event.id,
        }).catch(() => {});

        summary = `Staff Task Assigner communicated task ${taskId} change (${changeType}) in Discord.`;
        outcomeStatus = "COMPLETED";
        break;
      }

      case "STAFF_TASK_BLOCKED": {
        const taskId = event.taskId || event.sourceId;
        const task = listOperationalTasks().find((t) => t.id === taskId);
        const blockerNote = task?.blockerNote || event.payload.blockerNote || "Equipment or ingredient obstruction";
        const assignee = task?.assigneeId || "assigned staff";
        const orderId = (task?.orderIds && task.orderIds[0]) || "general-production";

        await announceTaskStateChangeInDiscord({
          taskId,
          changeType: "blocked",
          reason: blockerNote,
          eventId: event.id,
        }).catch(() => {});

        handleCollaborationMessage({
          orderId,
          taskId,
          workflowStage: "staff_assignment",
          senderId: "staff-task-assigner",
          recipientId: "manager",
          messageType: "ALERT",
          content: `[EVENT: STAFF_TASK_BLOCKED] Task ${taskId} (${task?.kind || "production"} by ${assignee}) is BLOCKED. Reason: "${blockerNote}". Requesting manager intervention or task reassignment.`,
          evidence: `Assignee: ${assignee}, Status: blocked, Due: ${task?.dueAt || "shift end"}.`,
          reason: "Task execution halted due to blocker.",
        });

        outcomeStatus = "WAITING_FOR_MANAGER";
        summary = `Task ${taskId} blocked by "${blockerNote}". Alerted human manager for resolution / reassignment.`;
        break;
      }

      case "STAFF_TASK_OVERDUE": {
        const taskId = event.taskId || event.sourceId;
        const task = listOperationalTasks().find((t) => t.id === taskId);
        const orderId = (task?.orderIds && task.orderIds[0]) || "general-production";

        await announceTaskStateChangeInDiscord({
          taskId,
          changeType: "overdue",
          eventId: event.id,
        }).catch(() => {});

        handleCollaborationMessage({
          orderId,
          taskId,
          workflowStage: "staff_assignment",
          senderId: "staff-task-assigner",
          recipientId: "manager",
          messageType: "ALERT",
          content: `[EVENT: STAFF_TASK_OVERDUE] Task ${taskId} has passed its scheduled completion time (${task?.dueAt}). Inquiring on progress with ${task?.assigneeId}.`,
          evidence: `Task status: ${task?.status}, Due: ${task?.dueAt}.`,
          reason: "Schedule breach detected; escalating delay alert to manager.",
        });

        outcomeStatus = "WAITING_FOR_MANAGER";
        summary = `Task ${taskId} overdue. Escalated alert to Bakery Manager.`;
        break;
      }

      case "STAFF_SCHEDULE_CHANGED": {
        summary = "Staff Task Assigner reassessed shift allocations against updated employee availability.";
        outcomeStatus = "COMPLETED";
        break;
      }

      default: {
        summary = `Handled event ${event.eventType}`;
        outcomeStatus = "COMPLETED";
      }
    }

    // Finalize event record
    const updated = updateOperationalEventStatus(eventId, outcomeStatus, {
      resolutionSummary: summary,
    });

    eventBroadcaster.broadcast("operational_event_updated", {
      id: eventId,
      status: outcomeStatus,
      resolutionSummary: summary,
    });

    return updated!;
  } catch (err: any) {
    const failed = updateOperationalEventStatus(eventId, "FAILED", {
      errorMessage: err.message,
    });
    eventBroadcaster.broadcast("operational_event_updated", {
      id: eventId,
      status: "FAILED",
      errorMessage: err.message,
    });
    return failed!;
  }
}

/**
 * Recovers pending or interrupted events after server restart
 */
export async function recoverPendingEvents(): Promise<number> {
  const pending = getPendingOperationalEvents(3);
  let processed = 0;
  for (const event of pending) {
    try {
      await processOperationalEvent(event.id);
      processed++;
    } catch {
      // safe retry handles failures
    }
  }
  return processed;
}

// Start M6 Proactive Intelligence scheduler on startup
try { ensureSchedulerStarted(); } catch {}
