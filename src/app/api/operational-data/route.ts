import { sendStaffTaskAssignerDiscordUpdate } from "@/lib/switch-bridge";
import { NextRequest, NextResponse } from "next/server";
import {
  listOperationalOrders,
  getOperationalOrder,
  consumeInventoryForOrder,
  confirmOrderDelivery,
  closeOperationalOrder,
  upsertOperationalOrder,
  listOperationalInventory,
  updateInventoryStock,
  listOperationalPlans,
  saveOperationalPlan,
  listOperationalTasks,
  saveOperationalTasks,
  updateOperationalTask,
  updateOperationalTaskDetails,
  deleteOperationalOrder,
  deleteOperationalPlan,
  deleteOperationalTask,
  recordAuditLog,
  recordOperationalEvent,
} from "@/lib/db";
import { staff, recipes } from "@/data/seed";
import { approveProductionPlan, generateTasksForPlan } from "@/domain/workflow";
import { eventBroadcaster } from "@/lib/event-broadcaster";
import { processOperationalEvent } from "@/lib/event-service";
import type { OperationalEventType } from "@/domain/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const orders = listOperationalOrders();
    const inventory = listOperationalInventory(false);
    const plans = listOperationalPlans();
    const tasks = listOperationalTasks();

    return NextResponse.json({
      orders,
      inventory,
      plans,
      tasks,
      staff,
      recipes,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "save_order" && body.order) {
      const existing = getOperationalOrder(body.order.id);
      const saved = upsertOperationalOrder(body.order);
      eventBroadcaster.broadcast("order_updated", saved);

      let eventType: OperationalEventType = "ORDER_CREATED";
      if (existing) {
        if (saved.status === "complete" || (body.order.status === "complete" && existing.status !== "complete")) {
          eventType = "ORDER_CANCELLED";
        } else if (existing.dueAt !== saved.dueAt) {
          eventType = "ORDER_DEADLINE_CHANGED";
        } else {
          eventType = "ORDER_QUANTITY_CHANGED";
        }
      }

      const opEvent = recordOperationalEvent({
        id: body.eventId || `evt-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
        eventType,
        sourceEntity: "order",
        sourceId: saved.id,
        orderId: saved.id,
        payload: { order: saved, previous: existing },
        responsibleAgentId: "order-analyst",
      });

      // Run event investigation
      await processOperationalEvent(opEvent.id).catch(() => {});

      return NextResponse.json({ order: saved, event: opEvent }, { status: 200 });
    }

    if (action === "update_stock" && body.ingredientId && typeof body.onHand === "number") {
      updateInventoryStock(body.ingredientId, body.onHand);
      recordAuditLog({
        id: `audit-${crypto.randomUUID()}`,
        eventType: "INVENTORY_ADJUSTED",
        proposedBy: body.proposedBy || "hadishanavas7454",
        changeDescription: `Updated stock for ingredient ${body.ingredientId} to ${body.onHand}g`,
        executionStatus: "EXECUTED",
        newValue: `${body.onHand}`,
      });
      eventBroadcaster.broadcast("inventory_updated", { ingredientId: body.ingredientId, onHand: body.onHand });

      const opEvent = recordOperationalEvent({
        id: body.eventId || `evt-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
        eventType: "INVENTORY_STOCK_ADJUSTED",
        sourceEntity: "inventory",
        sourceId: body.ingredientId,
        payload: { ingredientId: body.ingredientId, newQuantity: body.onHand, performedBy: body.proposedBy },
        responsibleAgentId: "inventory-manager",
      });
      await processOperationalEvent(opEvent.id).catch(() => {});

      return NextResponse.json({ success: true, event: opEvent }, { status: 200 });
    }

    if (action === "save_plan" && body.plan) {
      const existing = listOperationalPlans().find((p) => p.id === body.plan.id);
      const saved = saveOperationalPlan(body.plan);
      eventBroadcaster.broadcast("plan_updated", saved);

      const opEvent = recordOperationalEvent({
        id: body.eventId || `evt-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
        eventType: existing ? "PRODUCTION_PLAN_MODIFIED" : "PRODUCTION_PLAN_CREATED",
        sourceEntity: "plan",
        sourceId: saved.id,
        orderId: saved.orderIds?.[0],
        payload: { plan: saved, previous: existing },
        responsibleAgentId: "production-planner",
      });
      await processOperationalEvent(opEvent.id).catch(() => {});

      return NextResponse.json({ plan: saved, event: opEvent }, { status: 200 });
    }

    if (action === "save_tasks" && Array.isArray(body.tasks)) {
      saveOperationalTasks(body.tasks);
      eventBroadcaster.broadcast("tasks_updated", body.tasks);
      return NextResponse.json({ success: true }, { status: 200 });
    }


    if (action === "update_task_assignee" && body.taskId && body.assigneeId) {
      const existing = listOperationalTasks().find((t) => t.id === body.taskId);
      if (!existing) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }

      const prevAssignee = existing.assigneeId;
      const updated = updateOperationalTaskDetails(body.taskId, { assigneeId: body.assigneeId });
      eventBroadcaster.broadcast("tasks_updated", [updated]);

      const opEvent = recordOperationalEvent({
        id: body.eventId || `evt-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
        eventType: "STAFF_TASK_CHANGED",
        sourceEntity: "task",
        sourceId: body.taskId,
        taskId: body.taskId,
        orderId: existing.orderIds?.[0],
        payload: {
          taskId: body.taskId,
          changeType: "reassigned",
          previousAssigneeId: prevAssignee,
          previousValue: prevAssignee,
          assigneeId: body.assigneeId,
          newValue: body.assigneeId,
        },
        responsibleAgentId: "staff-task-assigner",
      });
      await processOperationalEvent(opEvent.id).catch(() => {});

      return NextResponse.json({ success: true, task: updated, event: opEvent }, { status: 200 });
    }

    if (action === "update_task_deadline" && body.taskId && body.dueAt) {
      const existing = listOperationalTasks().find((t) => t.id === body.taskId);
      if (!existing) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }

      const prevDue = existing.dueAt;
      const updated = updateOperationalTaskDetails(body.taskId, { dueAt: body.dueAt });
      eventBroadcaster.broadcast("tasks_updated", [updated]);

      const opEvent = recordOperationalEvent({
        id: body.eventId || `evt-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
        eventType: "STAFF_TASK_CHANGED",
        sourceEntity: "task",
        sourceId: body.taskId,
        taskId: body.taskId,
        orderId: existing.orderIds?.[0],
        payload: {
          taskId: body.taskId,
          changeType: "deadline_changed",
          previousDueAt: prevDue,
          previousValue: prevDue,
          dueAt: body.dueAt,
          newValue: body.dueAt,
        },
        responsibleAgentId: "staff-task-assigner",
      });
      await processOperationalEvent(opEvent.id).catch(() => {});

      return NextResponse.json({ success: true, task: updated, event: opEvent }, { status: 200 });
    }

    if (action === "create_task" && body.task) {
      const existing = listOperationalTasks().find((t) => t.id === body.task.id);
      saveOperationalTasks([body.task]);
      eventBroadcaster.broadcast("tasks_updated", [body.task]);

      const opEvent = recordOperationalEvent({
        id: body.eventId || `evt-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
        eventType: "STAFF_TASK_CREATED",
        sourceEntity: "task",
        sourceId: body.task.id,
        taskId: body.task.id,
        orderId: body.task.orderIds?.[0],
        payload: { task: body.task, previous: existing },
        responsibleAgentId: "staff-task-assigner",
      });
      await processOperationalEvent(opEvent.id).catch(() => {});

      return NextResponse.json({ success: true, task: body.task, event: opEvent }, { status: 201 });
    }

    if (action === "update_task_status" && body.taskId && body.status) {
      const existing = listOperationalTasks().find((t) => t.id === body.taskId);
      const prevStatus = existing?.status;
      updateOperationalTask(body.taskId, body.status, body.blockerNote);
      eventBroadcaster.broadcast("task_status_changed", { taskId: body.taskId, status: body.status, blockerNote: body.blockerNote });

      const eventType: OperationalEventType = body.status === "blocked" ? "STAFF_TASK_BLOCKED" : "STAFF_TASK_CHANGED";
      const task = listOperationalTasks().find((t) => t.id === body.taskId);

      let changeType = body.changeType;
      if (!changeType) {
        if (body.status === "inProgress") changeType = "started";
        else if (body.status === "done") changeType = "completed";
        else if (body.status === "acknowledged") changeType = "acknowledged";
        else if (body.status === "todo" && prevStatus === "blocked") changeType = "unblocked";
        else changeType = "progress_changed";
      }

      const opEvent = recordOperationalEvent({
        id: body.eventId || `evt-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
        eventType,
        sourceEntity: "task",
        sourceId: body.taskId,
        taskId: body.taskId,
        orderId: task?.orderIds?.[0],
        payload: {
          taskId: body.taskId,
          status: body.status,
          previousStatus: prevStatus,
          previousValue: prevStatus,
          newValue: body.status,
          blockerNote: body.blockerNote,
          reason: body.blockerNote || body.reason,
          changeType,
        },
        responsibleAgentId: "staff-task-assigner",
      });
      await processOperationalEvent(opEvent.id).catch(() => {});

      // M7 Step 1 & 2: Check if all tasks for the order are complete
      const targetOrderId = task?.orderIds?.[0];
      if (targetOrderId && body.status === "done") {
        const order = getOperationalOrder(targetOrderId);
        if (order && (order.status === "planned" || order.status === "inProduction" || order.status === "submitted")) {
          const allOrderTasks = listOperationalTasks().filter((t) => t.orderIds?.includes(targetOrderId));
          if (allOrderTasks.length > 0 && allOrderTasks.every((t) => t.status === "done")) {
            order.status = "waitingForProductionConfirmation";
            upsertOperationalOrder(order);
            eventBroadcaster.broadcast("order_updated", order);

            const completionEvent = recordOperationalEvent({
              id: `evt-prodcomp-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
              eventType: "STAFF_TASK_CHANGED",
              sourceEntity: "order",
              sourceId: targetOrderId,
              orderId: targetOrderId,
              payload: {
                orderId: targetOrderId,
                completedTaskCount: allOrderTasks.length,
                status: "waitingForProductionConfirmation",
              },
              responsibleAgentId: "staff-task-assigner",
            });

            recordAuditLog({
              id: `audit-${crypto.randomUUID()}`,
              eventType: "PRODUCTION_WORK_COMPLETED",
              proposedBy: "staff-task-assigner",
              changeDescription: `All ${allOrderTasks.length} assigned staff tasks completed for Order ${order.id} (${order.customerName}). Ready for delivery pending manager confirmation.`,
              executionStatus: "PENDING_APPROVAL",
              previousValue: "inProduction",
              newValue: "waitingForProductionConfirmation",
            });

            // Send notification to manager in Discord
            sendStaffTaskAssignerDiscordUpdate(
              `@hadishanavas7454 [PRODUCTION COMPLETE] Order ${order.id} (${order.customerName}): All ${allOrderTasks.length} assigned staff tasks have been completed. Production work is finished. The order is ready for delivery. Please confirm production completion.`,
              ["hadishanavas7454"],
              completionEvent.id
            ).catch(() => {});
          }
        }
      }

      return NextResponse.json({ success: true, event: opEvent }, { status: 200 });
    }

    if (action === "sync_full_state" && body.state) {
      if (Array.isArray(body.state.orders)) {
        for (const o of body.state.orders) upsertOperationalOrder(o);
      }
      if (Array.isArray(body.state.plans)) {
        for (const p of body.state.plans) saveOperationalPlan(p);
      }
      if (Array.isArray(body.state.tasks)) {
        saveOperationalTasks(body.state.tasks);
      }
      return NextResponse.json({ success: true }, { status: 200 });
    }

    if (action === "approve_plan") {
      const planId = body.planId;
      const allPlans = listOperationalPlans();
      const plan = planId ? allPlans.find((p) => p.id === planId) : allPlans.at(-1);
      if (!plan) {
        return NextResponse.json({ error: "No plan found to approve" }, { status: 404 });
      }

      const approvedBy = body.approvedBy || "Hadi Shanavas";
      const approvedAt = new Date().toISOString();
      const approved = approveProductionPlan(plan, approvedBy, approvedAt);
      const saved = saveOperationalPlan(approved);
      eventBroadcaster.broadcast("plan_updated", saved);

      // Generate and save staff tasks
      let generatedTasks: any[] = [];
      try {
        generatedTasks = generateTasksForPlan([approved], staff);
        if (generatedTasks.length > 0) {
          saveOperationalTasks(generatedTasks);
          eventBroadcaster.broadcast("tasks_updated", generatedTasks);

          // Record and dispatch STAFF_TASK_CREATED for each task
          for (const task of generatedTasks) {
            const opEvent = recordOperationalEvent({
              id: `evt-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
              eventType: "STAFF_TASK_CREATED",
              sourceEntity: "task",
              sourceId: task.id,
              taskId: task.id,
              orderId: task.orderIds?.[0],
              payload: { task },
              responsibleAgentId: "staff-task-assigner",
            });
            processOperationalEvent(opEvent.id).catch(() => {});
          }
        }
      } catch (tErr) {
        console.warn("Task generation error during approval:", tErr);
      }

      // Update associated orders to 'planned'
      if (Array.isArray(approved.orderIds)) {
        for (const oId of approved.orderIds) {
          const ord = getOperationalOrder(oId);
          if (ord && ord.status !== "complete") {
            ord.status = "planned";
            upsertOperationalOrder(ord);
            eventBroadcaster.broadcast("order_updated", ord);
          }
        }
      }

      recordAuditLog({
        id: `audit-${crypto.randomUUID()}`,
        eventType: "PRODUCTION_PLAN_APPROVED",
        proposedBy: approvedBy,
        changeDescription: `Production plan ${saved.id} (rev ${saved.revision}) approved with ${generatedTasks.length} staff tasks generated.`,
        executionStatus: "EXECUTED",
        newValue: saved.status,
      });

      return NextResponse.json({ success: true, plan: saved, tasks: generatedTasks }, { status: 200 });
    }

    if (action === "delete_order" && body.orderId) {
      const orderId = body.orderId;
      const existing = getOperationalOrder(orderId);
      if (!existing) {
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
      }

      // Safe relational cleanup: Clean up associated plans referencing this order
      const allPlans = listOperationalPlans();
      for (const plan of allPlans) {
        if (plan.orderIds && plan.orderIds.includes(orderId)) {
          const remainingOrders = plan.orderIds.filter((id) => id !== orderId);
          if (remainingOrders.length === 0) {
            deleteOperationalPlan(plan.id);
            eventBroadcaster.broadcast("plan_deleted", { planId: plan.id });
          } else {
            plan.orderIds = remainingOrders;
            saveOperationalPlan(plan);
            eventBroadcaster.broadcast("plan_updated", plan);
          }
        }
      }

      // Safe relational cleanup: Clean up associated tasks referencing this order
      const allTasks = listOperationalTasks();
      for (const task of allTasks) {
        if (task.orderIds && task.orderIds.includes(orderId)) {
          const remainingOrders = task.orderIds.filter((id) => id !== orderId);
          if (remainingOrders.length === 0) {
            deleteOperationalTask(task.id);
            eventBroadcaster.broadcast("task_deleted", { taskId: task.id });
          } else {
            task.orderIds = remainingOrders;
            saveOperationalTasks([task]);
            eventBroadcaster.broadcast("tasks_updated", [task]);
          }
        }
      }

      // Authoritative database deletion
      deleteOperationalOrder(orderId);

      // Record audit log entry
      recordAuditLog({
        id: `audit-${crypto.randomUUID()}`,
        eventType: "ORDER_DELETED",
        proposedBy: body.proposedBy || "hadishanavas7454",
        changeDescription: `Deleted order ${orderId} (${existing.customerName})`,
        executionStatus: "EXECUTED",
        previousValue: JSON.stringify(existing),
      });

      // Broadcast order deletion
      eventBroadcaster.broadcast("order_deleted", { orderId });

      // Trigger M5 operational event for AI collaboration and awareness
      const opEvent = recordOperationalEvent({
        id: body.eventId || `evt-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
        eventType: "ORDER_CANCELLED",
        sourceEntity: "order",
        sourceId: orderId,
        orderId: orderId,
        payload: { orderId, order: existing, deleted: true },
        responsibleAgentId: "order-analyst",
      });
      await processOperationalEvent(opEvent.id).catch(() => {});

      return NextResponse.json({ success: true, orderId, event: opEvent }, { status: 200 });
    }

        if (action === "confirm_production_completion" && body.orderId) {
      const orderId = body.orderId;
      const actor = body.performedBy || "hadishanavas7454";
      const result = consumeInventoryForOrder({ orderId, performedBy: actor });

      eventBroadcaster.broadcast("order_updated", result.order);
      eventBroadcaster.broadcast("inventory_updated", listOperationalInventory());

      if (!result.alreadyConsumed) {
        const itemSummary = result.consumptions.map((c) => `${c.quantityConsumed} ${c.unit} ${c.ingredientId}`).join(", ");
        await sendStaffTaskAssignerDiscordUpdate(
          `✅ [INVENTORY CONSUMPTION CONFIRMED] Production completion confirmed and ingredients deducted for Order ${result.order.id} (${result.order.customerName}). Deductions: ${itemSummary}. All stock levels updated in real time. Order is now READY FOR DELIVERY. @hadishanavas7454 please confirm when the order has been delivered.`,
          ["hadishanavas7454"]
        ).catch(() => {});
      }

      return NextResponse.json(result, { status: 200 });
    }

    if (action === "confirm_delivery" && body.orderId) {
      const orderId = body.orderId;
      const actor = body.performedBy || "hadishanavas7454";
      const result = confirmOrderDelivery(orderId, actor);

      eventBroadcaster.broadcast("order_updated", result.order);

      if (!result.alreadyDelivered) {
        await sendStaffTaskAssignerDiscordUpdate(
          `@hadishanavas7454 Order #${result.order.id} (${result.order.customerName}) has been confirmed delivered. May I close this order and clear it from the active Orders list?`,
          ["hadishanavas7454"]
        ).catch(() => {});
      }

      return NextResponse.json(result, { status: 200 });
    }

    if (action === "close_order" && body.orderId) {
      const orderId = body.orderId;
      const actor = body.performedBy || "hadishanavas7454";
      const result = closeOperationalOrder(orderId, actor);

      eventBroadcaster.broadcast("order_updated", result.order);

      if (!result.alreadyClosed) {
        await sendStaffTaskAssignerDiscordUpdate(
          `✅ Order #${result.order.id} (${result.order.customerName}) has been closed and cleared from the active Orders roster. Full production, task, and inventory consumption history is permanently preserved in audit archives.`,
          ["hadishanavas7454"]
        ).catch(() => {});
      }

      return NextResponse.json(result, { status: 200 });
    }

    if (action === "update_order_status" && body.orderId && body.status) {
      const order = getOperationalOrder(body.orderId);
      if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
      const prev = order.status;
      order.status = body.status;
      const saved = upsertOperationalOrder(order);
      eventBroadcaster.broadcast("order_updated", saved);

      recordAuditLog({
        id: `audit-${crypto.randomUUID()}`,
        eventType: "ORDER_STATUS_UPDATED",
        proposedBy: body.performedBy || "hadishanavas7454",
        changeDescription: `Updated status for Order ${saved.id} from "${prev}" to "${saved.status}"`,
        previousValue: prev,
        newValue: saved.status,
        executionStatus: "EXECUTED",
      });

      return NextResponse.json({ success: true, order: saved }, { status: 200 });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
