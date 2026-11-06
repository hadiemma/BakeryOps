import {
  listOperationalOrders,
  getOperationalOrder,
  upsertOperationalOrder,
  listOperationalInventory,
  getOperationalInventoryItem,
  listOperationalPlans,
  listOperationalTasks,
  listInventoryAdjustments,
  recordMonitoringCycle,
  updateMonitoringCycle,
  getIncompleteMonitoringCycles,
  upsertProactiveIssue,
  getProactiveIssue,
  getProactiveIssueByFingerprint,
  listProactiveIssues,
  resolveProactiveIssue,
  updateProactiveIssue,
  updateAgentMonitoringStatus,
  getAgentMonitoringStatus,
  listAgentMonitoringStatuses,
  upsertOrderWorkflowState,
  getOrderWorkflowState,
  recordAuditLog,
} from "./db";
import { recipes, staff } from "@/data/seed";
import { calculateIngredientRequirements, generateProductionPlan } from "@/domain/workflow";
import { MONITORING_CONFIG } from "./monitoring-config";
import {
  sendOrderAnalystDiscordAlert,
  sendProductionPlannerDiscordAlert,
  sendInventoryManagerDiscordAlert,
  sendStaffTaskAssignerDiscordUpdate,
  retryPendingDiscordNotifications,
} from "./switch-bridge";
import { handleCollaborationMessage } from "./collaboration-service";
import { eventBroadcaster } from "./event-broadcaster";
import type {
  BakeryOrder,
  Ingredient,
  ProductionTask,
  ProactiveIssue,
  MonitoringCycleType,
  SpecialistAgentKey,
} from "@/domain/types";

// Mutex / Concurrency lock per agent to prevent overlapping runs
const activeAgentCycles: Record<string, boolean> = {
  "order-analyst": false,
  "production-planner": false,
  "inventory-manager": false,
  "staff-task-assigner": false,
};

let schedulerStarted = false;
let routineTimer: NodeJS.Timeout | null = null;
let timeSensitiveTimer: NodeJS.Timeout | null = null;
let retryTimer: NodeJS.Timeout | null = null;

function getCurrentTimeStr(): string {
  const d = new Date();
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function timeDifferenceMinutes(timeA: string, timeB: string): number {
  const [hA, mA] = timeA.split(":").map(Number);
  const [hB, mB] = timeB.split(":").map(Number);
  return (hA * 60 + mA) - (hB * 60 + mB);
}

// ============================================================
// 1. ORDER ANALYST PROACTIVE MONITORING
// ============================================================

export async function checkOrderAnalystRisks(cycleType: MonitoringCycleType = "scheduled"): Promise<number> {
  if (activeAgentCycles["order-analyst"]) return 0;
  activeAgentCycles["order-analyst"] = true;

  const cycleId = `cycle-oa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  recordMonitoringCycle({
    id: cycleId,
    agentId: "order-analyst",
    cycleType,
    scope: "orders",
  });

  updateAgentMonitoringStatus("order-analyst", {
    currentStatus: "CHECKING",
    lastCycleType: cycleType,
  });

  let findingsCount = 0;
  const now = new Date();
  const currentTime = getCurrentTimeStr();

  try {
    const orders = listOperationalOrders().filter((o) => o.status !== "complete");

    for (const order of orders) {
      // 1. Check approaching deadlines
      const diffMinutes = timeDifferenceMinutes(order.dueAt, currentTime);
      const isApproaching = diffMinutes > 0 && diffMinutes <= MONITORING_CONFIG.ORDER_APPROACHING_DEADLINE_MINUTES;
      const isPastDue = diffMinutes <= 0 && order.status !== "complete";

      const deadlineFingerprint = `order-deadline:${order.id}`;
      const existingDeadlineIssue = getProactiveIssueByFingerprint(deadlineFingerprint, true);

      if (isApproaching || isPastDue) {
        findingsCount++;
        const severity = isPastDue ? "HIGH" : "MEDIUM";
        const title = isPastDue
          ? `Order ${order.id} (${order.customerName}) is PAST DUE (${order.dueAt})`
          : `Order ${order.id} (${order.customerName}) approaching deadline (${diffMinutes}m remaining)`;

        const evidence = `Order due at ${order.dueAt}, current time is ${currentTime}. Status: ${order.status}. Items: ${order.items.map((i) => `${i.quantity}x ${i.productId}`).join(", ")}.`;
        const impact = isPastDue
          ? "Customer delivery is delayed; immediate dispatch or customer notification required."
          : "Delivery window closing; production and packing must be expedited.";
        const recommendedAction = "Review order progress and prioritize packing / dispatch with morning staff.";

        if (!existingDeadlineIssue) {
          const issue = upsertProactiveIssue({
            id: `issue-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            category: "ORDER_DEADLINE_APPROACHING",
            responsibleAgentId: "order-analyst",
            status: "ACTION_REQUIRED",
            severity,
            orderId: order.id,
            title,
            evidence,
            impact,
            recommendedAction,
            assignedTo: "manager",
            fingerprint: deadlineFingerprint,
            currentValue: currentTime,
            thresholdValue: order.dueAt,
            lastCheckedAt: now.toISOString(),
            lastNotifiedAt: now.toISOString(),
            notificationCount: 1,
          });

          // Post Discord alert to human manager
          const discordMsg = `⚠️ [PROACTIVE ORDER RISK MONITORING]
Order ID: ${order.id} (${order.customerName})
Status: ${isPastDue ? "🚨 PAST DUE" : "⏳ APPROACHING DEADLINE"}
Due Time: ${order.dueAt} (Current time: ${currentTime}, ${diffMinutes > 0 ? `${diffMinutes}m left` : "OVERDUE"})
Items: ${order.items.map((i) => `${i.quantity}x ${recipes[i.productId]?.name || i.productId}`).join(", ")}
Evidence: ${evidence}
Recommended Action: ${recommendedAction}`;

          await sendOrderAnalystDiscordAlert(discordMsg, ["hadishanavas7454"], issue.id);
        } else {
          // Update existing issue without spamming Discord unless severity changed
          // Only re-alert if severity escalated (e.g. from approaching to past due). Avoid repeating unchanged alerts.
          const shouldRealert = (isPastDue && existingDeadlineIssue.severity !== "HIGH");

          updateProactiveIssue(existingDeadlineIssue.id, {
            severity,
            evidence,
            currentValue: currentTime,
            lastCheckedAt: now.toISOString(),
            lastNotifiedAt: shouldRealert ? now.toISOString() : undefined,
            notificationCount: shouldRealert ? existingDeadlineIssue.notificationCount + 1 : undefined,
          });

          if (shouldRealert) {
            await sendOrderAnalystDiscordAlert(`⚠️ [UPDATE: ORDER DEADLINE RISK] Order ${order.id} (${order.customerName}) is now ${isPastDue ? "PAST DUE" : `${diffMinutes}m from deadline`}. Due: ${order.dueAt}.`, ["hadishanavas7454"], existingDeadlineIssue.id);
          }
        }
      } else if (existingDeadlineIssue) {
        // Deadline condition resolved
        resolveProactiveIssue(existingDeadlineIssue.id, `Order deadline risk resolved at ${currentTime}.`);
      }

      // 2. Check orders waiting too long in submitted status
      const orderCreatedTime = order.createdAt ? new Date(order.createdAt).getTime() : now.getTime();
      const waitingMinutes = Math.floor((now.getTime() - orderCreatedTime) / 60000);
      const stalledFingerprint = `order-stalled:${order.id}`;
      const existingStalledIssue = getProactiveIssueByFingerprint(stalledFingerprint, true);

      if (order.status === "submitted" && waitingMinutes >= MONITORING_CONFIG.ORDER_STALLED_MINUTES) {
        findingsCount++;
        if (!existingStalledIssue) {
          const issue = upsertProactiveIssue({
            id: `issue-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            category: "ORDER_STALLED",
            responsibleAgentId: "order-analyst",
            status: "WAITING_FOR_MANAGER",
            severity: "MEDIUM",
            orderId: order.id,
            title: `Order ${order.id} (${order.customerName}) waiting ${waitingMinutes}m without manager approval`,
            evidence: `Submitted at ${order.createdAt || "earlier"}, waiting for ${waitingMinutes} minutes.`,
            impact: "Baking timeline cannot begin until production plan is approved.",
            recommendedAction: "Approve proposed plan on website dashboard or in Discord.",
            assignedTo: "manager",
            fingerprint: stalledFingerprint,
            lastCheckedAt: now.toISOString(),
            lastNotifiedAt: now.toISOString(),
            notificationCount: 1,
          });

          await sendOrderAnalystDiscordAlert(`📋 [PROACTIVE ORDER INTAKE NOTICE] Order ${order.id} (${order.customerName}) has been waiting ${waitingMinutes} minutes for plan approval. Please review and approve on the dashboard to allow baking tasks to generate.`, ["hadishanavas7454"], issue.id);
        }
      } else if (existingStalledIssue && order.status !== "submitted") {
        resolveProactiveIssue(existingStalledIssue.id, `Order ${order.id} progressed to status: ${order.status}.`);
      }
    }

    updateMonitoringCycle(cycleId, {
      status: "completed",
      findingsCount,
      completedAt: new Date().toISOString(),
    });

    updateAgentMonitoringStatus("order-analyst", {
      lastSuccessfulCheck: new Date().toISOString(),
      currentStatus: findingsCount > 0 ? "ACTION_REQUIRED" : "IDLE",
      failureReason: undefined,
    });
  } catch (err: any) {
    console.error("Order Analyst monitoring failed:", err);
    updateMonitoringCycle(cycleId, {
      status: "failed",
      errorMessage: err.message,
    });
    updateAgentMonitoringStatus("order-analyst", {
      currentStatus: "ERROR",
      failureReason: err.message,
    });
  } finally {
    activeAgentCycles["order-analyst"] = false;
  }

  return findingsCount;
}

// ============================================================
// 2. PRODUCTION PLANNER PROACTIVE MONITORING
// ============================================================

export async function checkProductionPlannerRisks(cycleType: MonitoringCycleType = "scheduled"): Promise<number> {
  if (activeAgentCycles["production-planner"]) return 0;
  activeAgentCycles["production-planner"] = true;

  const cycleId = `cycle-pp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  recordMonitoringCycle({
    id: cycleId,
    agentId: "production-planner",
    cycleType,
    scope: "production",
  });

  updateAgentMonitoringStatus("production-planner", {
    currentStatus: "CHECKING",
    lastCycleType: cycleType,
  });

  let findingsCount = 0;
  const now = new Date();

  try {
    const plans = listOperationalPlans().filter((p) => p.status === "proposed" || p.status === "approved" || p.status === "inProgress");

    for (const plan of plans) {
      const batches = plan.batches || [];
      if (batches.length === 0) continue;

      // 1. Inspect capacity and overlapping baking windows
      let simultaneousBakes = 0;
      for (let i = 0; i < batches.length; i++) {
        for (let j = i + 1; j < batches.length; j++) {
          const b1 = batches[i];
          const b2 = batches[j];
          // Check if time intervals overlap
          if (b1.startAt < b2.endAt && b2.startAt < b1.endAt) {
            simultaneousBakes++;
          }
        }
      }

      const bottleneckFingerprint = `prod-bottleneck:${plan.id}`;
      const existingBottleneck = getProactiveIssueByFingerprint(bottleneckFingerprint, true);

      if (simultaneousBakes > MONITORING_CONFIG.MAX_PARALLEL_OVEN_BATCHES) {
        findingsCount++;
        const title = `Oven capacity bottleneck in plan ${plan.id} (${simultaneousBakes} overlapping batches)`;
        const evidence = `Detected ${simultaneousBakes} simultaneous bake schedules exceeding maximum deck oven limit (${MONITORING_CONFIG.MAX_PARALLEL_OVEN_BATCHES}).`;
        const impact = "Risk of baking delays and uneven temperature recovery in shared deck ovens.";
        const recommendedAction = "Stagger batch start times to maintain single or dual deck capacity.";

        if (!existingBottleneck) {
          const issue = upsertProactiveIssue({
            id: `issue-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            category: "PRODUCTION_BOTTLENECK",
            responsibleAgentId: "production-planner",
            status: "ACTION_REQUIRED",
            severity: "HIGH",
            planId: plan.id,
            title,
            evidence,
            impact,
            recommendedAction,
            assignedTo: "manager",
            fingerprint: bottleneckFingerprint,
            lastCheckedAt: now.toISOString(),
            lastNotifiedAt: now.toISOString(),
            notificationCount: 1,
          });

          await sendProductionPlannerDiscordAlert(`⚠️ [PROACTIVE FEASIBILITY ALERT] Plan ${plan.id} has an oven capacity bottleneck. ${simultaneousBakes} overlapping bakes scheduled against oven capacity of ${MONITORING_CONFIG.MAX_PARALLEL_OVEN_BATCHES}. Staggering bake windows is recommended.`, ["hadishanavas7454"], issue.id);
        }
      } else if (existingBottleneck) {
        resolveProactiveIssue(existingBottleneck.id, "Baking timeline adjusted; oven bottleneck resolved.");
      }
    }

    updateMonitoringCycle(cycleId, {
      status: "completed",
      findingsCount,
      completedAt: new Date().toISOString(),
    });

    updateAgentMonitoringStatus("production-planner", {
      lastSuccessfulCheck: new Date().toISOString(),
      currentStatus: findingsCount > 0 ? "ACTION_REQUIRED" : "IDLE",
      failureReason: undefined,
    });
  } catch (err: any) {
    console.error("Production Planner monitoring failed:", err);
    updateMonitoringCycle(cycleId, {
      status: "failed",
      errorMessage: err.message,
    });
    updateAgentMonitoringStatus("production-planner", {
      currentStatus: "ERROR",
      failureReason: err.message,
    });
  } finally {
    activeAgentCycles["production-planner"] = false;
  }

  return findingsCount;
}

// ============================================================
// 3. INVENTORY MANAGER PROACTIVE MONITORING (Major M6 Capability)
// ============================================================

export async function checkInventoryManagerRisks(cycleType: MonitoringCycleType = "scheduled"): Promise<number> {
  if (activeAgentCycles["inventory-manager"]) return 0;
  activeAgentCycles["inventory-manager"] = true;

  const cycleId = `cycle-im-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  recordMonitoringCycle({
    id: cycleId,
    agentId: "inventory-manager",
    cycleType,
    scope: "inventory",
  });

  updateAgentMonitoringStatus("inventory-manager", {
    currentStatus: "CHECKING",
    lastCycleType: cycleType,
  });

  let findingsCount = 0;
  const now = new Date();

  try {
    const liveInventory = listOperationalInventory(false);
    const activeOrders = listOperationalOrders().filter((o) => o.status !== "complete");
    const adjustments = listInventoryAdjustments();

    // Calculate authoritative deterministic total requirements across all active orders
    let totalRequirements: any[] = [];
    try {
      if (activeOrders.length > 0) {
        totalRequirements = calculateIngredientRequirements(activeOrders, recipes, liveInventory);
      }
    } catch (calcErr) {
      console.warn("Could not calculate aggregated requirements:", calcErr);
    }

    const reqMap = new Map<string, number>();
    for (const r of totalRequirements) {
      reqMap.set(r.ingredientId, r.quantity);
    }

    // ------------------------------------------------------------
    // SITUATION A: Stock approaching danger zone (threshold / forecast)
    // ------------------------------------------------------------
    for (const ingredient of liveInventory) {
      const onHand = ingredient.onHand;
      const threshold = ingredient.reorderAt;
      const unit = ingredient.baseUnit;
      const confirmedUpcoming = reqMap.get(ingredient.id) || 0;
      const projectedRemaining = onHand - confirmedUpcoming;

      const isBelowThreshold = onHand <= threshold;
      const willBreachThreshold = confirmedUpcoming > 0 && projectedRemaining < threshold && onHand > threshold;

      // Time-series trend analysis (Safeguard: require >= 3 timestamped observations)
      const ingredientAdjustments = adjustments
        .filter((a) => a.ingredientId === ingredient.id)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      let isRapidlyDeclining = false;
      let trendEvidence = "";
      if (ingredientAdjustments.length >= MONITORING_CONFIG.MIN_TIME_SERIES_POINTS_FOR_TREND) {
        const recentAdj = ingredientAdjustments.slice(-MONITORING_CONFIG.MIN_TIME_SERIES_POINTS_FOR_TREND);
        const first = recentAdj[0];
        const last = recentAdj[recentAdj.length - 1];
        const timeDiffHours = (new Date(last.createdAt).getTime() - new Date(first.createdAt).getTime()) / (1000 * 3600);
        if (timeDiffHours > 0 && timeDiffHours <= 3) {
          const drop = first.previousQuantity - last.newQuantity;
          const dropRatePct = (drop / first.previousQuantity) * 100;
          if (dropRatePct >= MONITORING_CONFIG.TREND_RAPID_DROP_PERCENT_PER_HOUR) {
            isRapidlyDeclining = true;
            trendEvidence = `Historical consumption analysis indicates rapid decline: -${drop} ${unit} (-${dropRatePct.toFixed(1)}%) over ${timeDiffHours.toFixed(1)}h across ${recentAdj.length} verified stock adjustments.`;
          }
        }
      }

      const dangerFingerprint = `inv-danger:${ingredient.id}`;
      const existingDangerIssue = getProactiveIssueByFingerprint(dangerFingerprint, true);

      if (isBelowThreshold || willBreachThreshold || isRapidlyDeclining) {
        findingsCount++;
        let triggerType = "threshold-based";
        if (willBreachThreshold) triggerType = "requirement-based";
        if (isRapidlyDeclining) triggerType = "trend-based forecast";

        const severity = isBelowThreshold ? (onHand === 0 ? "CRITICAL" : "HIGH") : "MEDIUM";
        const title = isBelowThreshold
          ? `Stock Danger Zone: ${ingredient.name} on hand (${onHand} ${unit}) is AT OR BELOW reorder threshold (${threshold} ${unit})`
          : `Stock Danger Zone: Upcoming commitments will breach ${ingredient.name} threshold (${projectedRemaining} ${unit} remaining vs ${threshold} ${unit} threshold)`;

        const evidence = `Actual current stock: ${onHand} ${unit}. Configured reorder threshold: ${threshold} ${unit}. Confirmed active order requirements: ${confirmedUpcoming} ${unit}. Detection type: ${triggerType}.${trendEvidence ? " " + trendEvidence : ""}`;
        const impact = "Risk of operational interruption on subsequent bakery production batches if stock is not replenished.";
        const recommendedAction = "Review and replenish/update stock through the existing BakeryOps Inventory page.";

        if (!existingDangerIssue) {
          const issue = upsertProactiveIssue({
            id: `issue-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            category: "INVENTORY_DANGER_ZONE",
            responsibleAgentId: "inventory-manager",
            status: "ACTION_REQUIRED",
            severity,
            ingredientId: ingredient.id,
            title,
            evidence,
            impact,
            recommendedAction,
            assignedTo: "manager",
            fingerprint: dangerFingerprint,
            currentValue: `${onHand} ${unit}`,
            thresholdValue: `${threshold} ${unit}`,
            lastCheckedAt: now.toISOString(),
            lastNotifiedAt: now.toISOString(),
            notificationCount: 1,
          });

          // Proactively notify manager in Discord
          const discordMsg = `📦 [PROACTIVE INVENTORY MONITORING — DANGER ZONE]
Ingredient: ${ingredient.name}
Actual Current Stock: ${onHand} ${unit}
Configured Safety Threshold: ${threshold} ${unit}
Confirmed Upcoming Order Requirements: ${confirmedUpcoming} ${unit}
Warning Basis: ${triggerType.toUpperCase()}
Evidence: ${evidence}
Action Requested: Please review and replenish/update stock through the existing BakeryOps Inventory page.`;

          await sendInventoryManagerDiscordAlert(discordMsg, ["hadishanavas7454"], issue.id);
        } else {
          // Deduplication: update existing issue
          // Only re-alert if severity escalated (e.g. from MEDIUM to CRITICAL). Avoid repeating unchanged warnings.
          const shouldRealert = (severity === "CRITICAL" && existingDangerIssue.severity !== "CRITICAL");

          updateProactiveIssue(existingDangerIssue.id, {
            severity,
            evidence,
            currentValue: `${onHand} ${unit}`,
            lastCheckedAt: now.toISOString(),
            lastNotifiedAt: shouldRealert ? now.toISOString() : undefined,
            notificationCount: shouldRealert ? existingDangerIssue.notificationCount + 1 : undefined,
          });

          if (shouldRealert) {
            await sendInventoryManagerDiscordAlert(`📦 [UPDATE: INVENTORY DANGER ZONE] ${ingredient.name} is now at ${onHand} ${unit} (Threshold: ${threshold} ${unit}, Upcoming: ${confirmedUpcoming} ${unit}). Review via Inventory page.`, ["hadishanavas7454"], existingDangerIssue.id);
          }
        }
      } else if (existingDangerIssue && onHand > threshold && projectedRemaining >= threshold) {
        // Danger zone condition resolved
        resolveProactiveIssue(existingDangerIssue.id, `Stock replenishment confirmed: ${ingredient.name} is now ${onHand} ${unit}, well above threshold (${threshold} ${unit}).`);
        await sendInventoryManagerDiscordAlert(`✅ [RESOLVED: INVENTORY DANGER ZONE] ${ingredient.name} replenishment confirmed! Current stock is ${onHand} ${unit} (Threshold: ${threshold} ${unit}). Stock levels are back in safe zone.`, ["hadishanavas7454"]);
      }
    }

    // ------------------------------------------------------------
    // SITUATION B & C: Specific order actual shortage & missing ingredients
    // (ORDER-SPECIFIC BLOCKING: Blocks ONLY the affected order!)
    // ------------------------------------------------------------
    for (const order of activeOrders) {
      let orderRequirements: any[] = [];
      try {
        orderRequirements = calculateIngredientRequirements([order], recipes, liveInventory);
      } catch (err: any) {
        console.warn(`Could not calculate requirements for order ${order.id}:`, err);
      }

      let orderHasShortage = false;

      for (const req of orderRequirements) {
        const liveItem = liveInventory.find((i) => i.id === req.ingredientId);
        const actualOnHand = liveItem?.onHand ?? 0;
        const deficit = req.quantity - actualOnHand;

        const isMissingFromCatalog = !liveItem;
        const isZeroStock = actualOnHand === 0;
        const hasActualShortage = deficit > 0;

        const shortageFingerprint = `inv-shortage:${order.id}:${req.ingredientId}`;
        const missingFingerprint = `inv-missing:${order.id}:${req.ingredientId}`;

        const existingShortageIssue = getProactiveIssueByFingerprint(shortageFingerprint, true);
        const existingMissingIssue = getProactiveIssueByFingerprint(missingFingerprint, true);

        if (isMissingFromCatalog || isZeroStock) {
          findingsCount++;
          orderHasShortage = true;

          const title = isMissingFromCatalog
            ? `Missing ingredient in catalogue: "${req.ingredientId}" required for order ${order.id}`
            : `Zero stock: ${req.name} (0 ${req.unit}) required for order ${order.id} (${req.quantity} ${req.unit} needed)`;

          const evidence = isMissingFromCatalog
            ? `Ingredient ID "${req.ingredientId}" is not present in the operational inventory catalogue.`
            : `Persisted stock for ${req.name} is 0 ${req.unit}. Authoritative calculated demand: ${req.quantity} ${req.unit}.`;

          const impact = `Order ${order.id} (${order.customerName}) is BLOCKED. Dependent production cannot start.`;
          const recommendedAction = isMissingFromCatalog
            ? `Add ingredient "${req.ingredientId}" with required stock via the BakeryOps Inventory page.`
            : `Restock ${req.name} through the BakeryOps Inventory page.`;

          if (!existingMissingIssue) {
            const issue = upsertProactiveIssue({
              id: `issue-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              category: "INGREDIENT_MISSING",
              responsibleAgentId: "inventory-manager",
              status: "BLOCKED",
              severity: "CRITICAL",
              orderId: order.id,
              ingredientId: req.ingredientId,
              title,
              evidence,
              impact,
              recommendedAction,
              assignedTo: "manager",
              fingerprint: missingFingerprint,
              currentValue: isMissingFromCatalog ? "NOT_IN_CATALOGUE" : "0",
              thresholdValue: String(req.quantity),
              lastCheckedAt: now.toISOString(),
              lastNotifiedAt: now.toISOString(),
              notificationCount: 1,
            });

            // ORDER-SPECIFIC BLOCK: Set affected order to needsAttention and BLOCKED workflow
            if (order.status !== "needsAttention") {
              order.status = "needsAttention";
              upsertOperationalOrder(order);
              eventBroadcaster.broadcast("order_updated", order);
            }
            upsertOrderWorkflowState({
              orderId: order.id,
              currentStage: "blocked",
              activeAgentId: "inventory-manager",
              waitingFor: "manager",
              status: "BLOCKED",
              revisionCount: 1,
              updatedAt: new Date().toISOString(),
            });

            // Alert manager in Discord
            const discordMsg = `🛑 [CRITICAL INVENTORY BLOCK — ${isMissingFromCatalog ? "MISSING INGREDIENT" : "ZERO STOCK"}]
Order ID: ${order.id} (${order.customerName})
Ingredient: ${req.name} (${req.ingredientId})
Status: ${isMissingFromCatalog ? "ITEM NOT FOUND IN CATALOGUE" : "CURRENT STOCK IS 0"}
Required Quantity: ${req.quantity} ${req.unit}
Deficit: ${req.quantity} ${req.unit}
Scope of Block: ONLY Order ${order.id} is blocked. Unrelated orders proceed normally.
Action Required: Hadi, please ${isMissingFromCatalog ? "add the ingredient" : "increase stock"} using the BakeryOps Inventory page.`;

            await sendInventoryManagerDiscordAlert(discordMsg, ["hadishanavas7454"], issue.id);

            // Send backward challenge to Production Planner
            handleCollaborationMessage({
              orderId: order.id,
              workflowStage: "inventory_verification",
              senderId: "inventory-manager",
              recipientId: "production-planner",
              messageType: "CHALLENGE",
              content: `[SHORTAGE CHALLENGE] Cannot proceed with plan for ${order.id}. Ingredient ${req.name} is ${isMissingFromCatalog ? "missing from catalogue" : "at zero stock"}. Deficit: ${req.quantity} ${req.unit}.`,
              evidence,
              reason: "Zero/missing stock halts production for this specific order.",
            });
          }
        } else if (hasActualShortage) {
          findingsCount++;
          orderHasShortage = true;

          const title = `Ingredient Shortage: ${req.name} deficit of ${deficit} ${req.unit} on order ${order.id}`;
          const evidence = `Order ${order.id} requires ${req.quantity} ${req.unit} ${req.name}. Current on-hand stock: ${actualOnHand} ${req.unit}. Deficit: ${deficit} ${req.unit}.`;
          const impact = `Production for Order ${order.id} is BLOCKED until inventory replenishment is committed.`;
          const recommendedAction = "Replenish inventory via the existing BakeryOps Inventory page.";

          if (!existingShortageIssue) {
            const issue = upsertProactiveIssue({
              id: `issue-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              category: "INVENTORY_SHORTAGE",
              responsibleAgentId: "inventory-manager",
              status: "BLOCKED",
              severity: "CRITICAL",
              orderId: order.id,
              ingredientId: req.ingredientId,
              title,
              evidence,
              impact,
              recommendedAction,
              assignedTo: "manager",
              fingerprint: shortageFingerprint,
              currentValue: `${actualOnHand} ${req.unit}`,
              thresholdValue: `${req.quantity} ${req.unit}`,
              lastCheckedAt: now.toISOString(),
              lastNotifiedAt: now.toISOString(),
              notificationCount: 1,
            });

            // ORDER-SPECIFIC BLOCK: Set affected order to needsAttention and BLOCKED workflow
            if (order.status !== "needsAttention") {
              order.status = "needsAttention";
              upsertOperationalOrder(order);
              eventBroadcaster.broadcast("order_updated", order);
            }
            upsertOrderWorkflowState({
              orderId: order.id,
              currentStage: "blocked",
              activeAgentId: "inventory-manager",
              waitingFor: "manager",
              status: "BLOCKED",
              revisionCount: 1,
              updatedAt: new Date().toISOString(),
            });

            // Send backward challenge to Production Planner with evidence
            handleCollaborationMessage({
              orderId: order.id,
              workflowStage: "inventory_verification",
              senderId: "inventory-manager",
              recipientId: "production-planner",
              messageType: "CHALLENGE",
              content: `[SHORTAGE CHALLENGE] Cannot proceed with proposed batches for ${order.id} due to shortage on ${req.name}. Need ${req.quantity} ${req.unit}, on-hand ${actualOnHand} ${req.unit} (DEFICIT: ${deficit} ${req.unit}).`,
              evidence,
              reason: "Inventory constraint prevents plan execution.",
            });

            // Alert manager in Discord
            const discordMsg = `🛑 [ACTUAL INGREDIENT SHORTAGE — ORDER BLOCKED]
Order ID: ${order.id} (${order.customerName})
Ingredient: ${req.name}
Actual Available Stock: ${actualOnHand} ${req.unit}
Authoritative Calculated Requirement: ${req.quantity} ${req.unit}
DEFICIT: ${deficit} ${req.unit}
Scope of Block: ONLY Order ${order.id} is blocked. Unrelated orders proceed normally.
Action Required: Hadi, please review and update stock through the BakeryOps Inventory page to unblock this order.`;

            await sendInventoryManagerDiscordAlert(discordMsg, ["hadishanavas7454"], issue.id);
          } else {
            // Update existing shortage issue
            updateProactiveIssue(existingShortageIssue.id, {
              evidence,
              currentValue: `${actualOnHand} ${req.unit}`,
              lastCheckedAt: now.toISOString(),
            });
          }
        } else {
          // Requirement is met! Check if an existing shortage was resolved
          if (existingShortageIssue) {
            resolveProactiveIssue(existingShortageIssue.id, `Replenishment confirmed: On-hand ${actualOnHand} ${req.unit} now satisfies required ${req.quantity} ${req.unit}.`);
          }
          if (existingMissingIssue) {
            resolveProactiveIssue(existingMissingIssue.id, `Ingredient added/restocked: On-hand ${actualOnHand} ${req.unit} now satisfies required ${req.quantity} ${req.unit}.`);
          }
        }
      }

      // If all shortages for this order are now cleared, unblock the order!
      if (!orderHasShortage && order.status === "needsAttention") {
        const remainingIssues = listProactiveIssues({ orderId: order.id, activeOnly: true });
        const hasUnresolvedInventoryIssue = remainingIssues.some(
          (i) => i.category === "INVENTORY_SHORTAGE" || i.category === "INGREDIENT_MISSING"
        );

        if (!hasUnresolvedInventoryIssue) {
          order.status = "submitted";
          upsertOperationalOrder(order);
          eventBroadcaster.broadcast("order_updated", order);

          upsertOrderWorkflowState({
            orderId: order.id,
            currentStage: "inventory_verification",
            activeAgentId: "order-analyst",
            waitingFor: "manager",
            status: "IN_PROGRESS",
            revisionCount: 1,
            updatedAt: new Date().toISOString(),
          });

          // Announce resolution in Discord and handoff
          await sendInventoryManagerDiscordAlert(`✅ [INVENTORY ISSUE RESOLVED — WORKFLOW UNBLOCKED]
Order ID: ${order.id} (${order.customerName})
Status: All calculated ingredient requirements are now FULLY SATISFIED by persisted stock.
Order ${order.id} has been unblocked and resumed in the operational pipeline.`, ["hadishanavas7454"]);

          handleCollaborationMessage({
            orderId: order.id,
            workflowStage: "inventory_verification",
            senderId: "inventory-manager",
            recipientId: "production-planner",
            messageType: "RESOLVED",
            content: `Stock replenishment verified for order ${order.id}. All required ingredients available. Order unblocked.`,
            evidence: `On-hand stock verified against database commit.`,
            reason: "Shortage resolved; workflow resumed.",
          });
        }
      }
    }

    updateMonitoringCycle(cycleId, {
      status: "completed",
      findingsCount,
      completedAt: new Date().toISOString(),
    });

    updateAgentMonitoringStatus("inventory-manager", {
      lastSuccessfulCheck: new Date().toISOString(),
      currentStatus: findingsCount > 0 ? "ACTION_REQUIRED" : "IDLE",
      failureReason: undefined,
    });
  } catch (err: any) {
    console.error("Inventory Manager monitoring failed:", err);
    updateMonitoringCycle(cycleId, {
      status: "failed",
      errorMessage: err.message,
    });
    updateAgentMonitoringStatus("inventory-manager", {
      currentStatus: "ERROR",
      failureReason: err.message,
    });
  } finally {
    activeAgentCycles["inventory-manager"] = false;
  }

  return findingsCount;
}

// ============================================================
// 4. STAFF TASK ASSIGNER PROACTIVE MONITORING & LIVE TASK ANNOUNCER
// ============================================================

export async function checkStaffTaskAssignerRisks(cycleType: MonitoringCycleType = "scheduled"): Promise<number> {
  if (activeAgentCycles["staff-task-assigner"]) return 0;
  activeAgentCycles["staff-task-assigner"] = true;

  const cycleId = `cycle-sta-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  recordMonitoringCycle({
    id: cycleId,
    agentId: "staff-task-assigner",
    cycleType,
    scope: "tasks",
  });

  updateAgentMonitoringStatus("staff-task-assigner", {
    currentStatus: "CHECKING",
    lastCycleType: cycleType,
  });

  let findingsCount = 0;
  const now = new Date();
  const currentTime = getCurrentTimeStr();

  try {
    const tasks = listOperationalTasks();

    for (const task of tasks) {
      // 1. Check overdue tasks
      const isPastDue = task.dueAt && task.dueAt <= currentTime && task.status !== "done";
      const overdueFingerprint = `task-overdue:${task.id}`;
      const existingOverdueIssue = getProactiveIssueByFingerprint(overdueFingerprint, true);

      if (isPastDue) {
        findingsCount++;
        const title = `Task ${task.id} (${task.kind} assigned to ${task.assigneeId}) is OVERDUE`;
        const evidence = `Scheduled completion was ${task.dueAt}, current time is ${currentTime}. Status: ${task.status}.`;
        const impact = "May delay overall baking, cooling, or customer packing delivery.";
        const recommendedAction = "Check in with assigned staff member or reassign task.";

        if (!existingOverdueIssue) {
          const issue = upsertProactiveIssue({
            id: `issue-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            category: "TASK_OVERDUE",
            responsibleAgentId: "staff-task-assigner",
            status: "ACTION_REQUIRED",
            severity: "HIGH",
            taskId: task.id,
            orderId: task.orderIds?.[0],
            title,
            evidence,
            impact,
            recommendedAction,
            assignedTo: "manager",
            fingerprint: overdueFingerprint,
            currentValue: currentTime,
            thresholdValue: task.dueAt,
            lastCheckedAt: now.toISOString(),
            lastNotifiedAt: now.toISOString(),
            notificationCount: 1,
          });

          await sendStaffTaskAssignerDiscordUpdate(`⏰ [TASK MONITORING — OVERDUE ALERT]
Task ID: ${task.id} (${task.kind.toUpperCase()})
Assignee: ${task.assigneeId}
Due Time: ${task.dueAt} (Current time: ${currentTime})
Status: ${task.status}
Evidence: ${evidence}
Action Required: Please check progress with ${task.assigneeId} or reassign.`, ["hadishanavas7454"], issue.id);
        }
      } else if (existingOverdueIssue && task.status === "done") {
        resolveProactiveIssue(existingOverdueIssue.id, `Task ${task.id} marked done.`);
      }

      // 2. Check blocked tasks
      const isBlocked = task.status === "blocked";
      const blockedFingerprint = `task-blocked:${task.id}`;
      const existingBlockedIssue = getProactiveIssueByFingerprint(blockedFingerprint, true);

      if (isBlocked) {
        findingsCount++;
        const title = `Task ${task.id} (${task.kind} by ${task.assigneeId}) is BLOCKED: "${task.blockerNote || "Obstruction"}"`;
        const evidence = `Blocker recorded: "${task.blockerNote || "No details provided"}". Task due: ${task.dueAt}.`;
        const impact = "Production execution halted.";
        const recommendedAction = "Resolve recorded blocker or reassign task to available workstation.";

        if (!existingBlockedIssue) {
          const issue = upsertProactiveIssue({
            id: `issue-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            category: "TASK_BLOCKED",
            responsibleAgentId: "staff-task-assigner",
            status: "ACTION_REQUIRED",
            severity: "HIGH",
            taskId: task.id,
            orderId: task.orderIds?.[0],
            title,
            evidence,
            impact,
            recommendedAction,
            assignedTo: "manager",
            fingerprint: blockedFingerprint,
            lastCheckedAt: now.toISOString(),
            lastNotifiedAt: now.toISOString(),
            notificationCount: 1,
          });

          await sendStaffTaskAssignerDiscordUpdate(`🚫 [TASK MONITORING — TASK BLOCKED]
Task ID: ${task.id} (${task.kind.toUpperCase()})
Assignee: ${task.assigneeId}
Blocker Note: "${task.blockerNote || "General obstruction"}"
Due Time: ${task.dueAt}
Action Required: Manager intervention needed to unblock this task.`, ["hadishanavas7454"], issue.id);
        }
      } else if (existingBlockedIssue && !isBlocked) {
        resolveProactiveIssue(existingBlockedIssue.id, `Task ${task.id} unblocked. New status: ${task.status}.`);
      }
    }

    updateMonitoringCycle(cycleId, {
      status: "completed",
      findingsCount,
      completedAt: new Date().toISOString(),
    });

    updateAgentMonitoringStatus("staff-task-assigner", {
      lastSuccessfulCheck: new Date().toISOString(),
      currentStatus: findingsCount > 0 ? "ACTION_REQUIRED" : "IDLE",
      failureReason: undefined,
    });
  } catch (err: any) {
    console.error("Staff Task Assigner monitoring failed:", err);
    updateMonitoringCycle(cycleId, {
      status: "failed",
      errorMessage: err.message,
    });
    updateAgentMonitoringStatus("staff-task-assigner", {
      currentStatus: "ERROR",
      failureReason: err.message,
    });
  } finally {
    activeAgentCycles["staff-task-assigner"] = false;
  }

  return findingsCount;
}

// ============================================================
// MANDATORY LIVE DISCORD TASK COMMUNICATION (Section 4.4)
// ============================================================

const communicatedTaskEvents = new Set<string>();

export async function announceTaskStateChangeInDiscord(params: {
  taskId: string;
  changeType:
    | "created"
    | "acknowledged"
    | "started"
    | "progress_changed"
    | "completed"
    | "blocked"
    | "overdue"
    | "reassigned"
    | "deadline_changed"
    | "unblocked"
    | "cancelled";
  previousValue?: string;
  newValue?: string;
  reason?: string;
  eventId?: string;
}): Promise<boolean> {
  const dedupKey = `${params.taskId}:${params.changeType}:${params.newValue || ""}:${params.eventId || ""}`;
  if (communicatedTaskEvents.has(dedupKey)) {
    return true; // Deduplicated: already announced
  }

  const tasks = listOperationalTasks();
  const task = tasks.find((t) => t.id === params.taskId);
  const assignee = task?.assigneeId || "staff";
  const kind = task?.kind ? task.kind.toUpperCase() : "TASK";
  const orderRef = task?.orderIds?.length ? ` (Orders: ${task.orderIds.join(", ")})` : "";

  let body = "";
  switch (params.changeType) {
    case "created":
      body = `📋 [STAFF TASK ASSIGNMENT] Task ${params.taskId} (${kind}${orderRef}) assigned to ${assignee}. Due at ${task?.dueAt || "shift end"}.`;
      break;
    case "acknowledged":
      body = `👍 [TASK ACKNOWLEDGED] Employee ${assignee} acknowledged task ${params.taskId} (${kind}). Scheduled start pending.`;
      break;
    case "started":
      body = `▶️ [TASK STARTED] Employee ${assignee} started task ${params.taskId} (${kind}${orderRef}). In progress.`;
      break;
    case "progress_changed":
      body = `🔄 [TASK PROGRESS] Task ${params.taskId} (${kind}) updated by ${assignee}: ${params.previousValue} ➔ ${params.newValue}.`;
      break;
    case "completed":
      body = `✅ [TASK COMPLETED] Task ${params.taskId} (${kind}${orderRef}) completed by ${assignee}. Ready for next stage.`;
      break;
    case "blocked":
      body = `🚫 [TASK BLOCKED] Task ${params.taskId} (${kind}) by ${assignee} is BLOCKED. Blocker: "${params.reason || task?.blockerNote || "Obstruction"}".`;
      break;
    case "overdue":
      body = `⏰ [TASK OVERDUE] Task ${params.taskId} (${kind}) assigned to ${assignee} has passed due time (${task?.dueAt}).`;
      break;
    case "reassigned":
      body = `👥 [TASK REASSIGNED] Task ${params.taskId} (${kind}) reassigned: ${params.previousValue} ➔ ${params.newValue}.`;
      break;
    case "deadline_changed":
      body = `🕒 [TASK DEADLINE CHANGED] Task ${params.taskId} (${kind}) due time updated from ${params.previousValue} to ${params.newValue}.`;
      break;
    case "unblocked":
      body = `🟢 [TASK UNBLOCKED] Task ${params.taskId} (${kind}) has been unblocked. Resuming work with ${assignee}.`;
      break;
    case "cancelled":
      body = `❌ [TASK CANCELLED] Task ${params.taskId} (${kind}) has been cancelled.`;
      break;
  }

  const res = await sendStaffTaskAssignerDiscordUpdate(body, undefined, params.eventId);
  if (res.success) {
    communicatedTaskEvents.add(dedupKey);
  }
  return res.success;
}

// ============================================================
// 5. MASTER MONITORING CYCLE & DURABLE SCHEDULER
// ============================================================

export async function runFullScheduledMonitoringCycle(): Promise<{ findings: number; details: Record<string, number> }> {
  const oaFindings = await checkOrderAnalystRisks("scheduled");
  const ppFindings = await checkProductionPlannerRisks("scheduled");
  const imFindings = await checkInventoryManagerRisks("scheduled");
  const staFindings = await checkStaffTaskAssignerRisks("scheduled");

  // Also retry any pending Discord notifications
  await retryPendingDiscordNotifications().catch(() => {});

  const total = oaFindings + ppFindings + imFindings + staFindings;
  return {
    findings: total,
    details: {
      orderAnalyst: oaFindings,
      productionPlanner: ppFindings,
      inventoryManager: imFindings,
      staffTaskAssigner: staFindings,
    },
  };
}

export async function runTimeSensitiveMonitoringCycle(): Promise<{ findings: number; details: Record<string, number> }> {
  // Urgent checks focus on order deadlines, overdue tasks, and critical shortages
  const oaFindings = await checkOrderAnalystRisks("time_sensitive");
  const staFindings = await checkStaffTaskAssignerRisks("time_sensitive");
  const imFindings = await checkInventoryManagerRisks("time_sensitive");

  const total = oaFindings + staFindings + imFindings;
  return {
    findings: total,
    details: {
      orderAnalyst: oaFindings,
      staffTaskAssigner: staFindings,
      inventoryManager: imFindings,
    },
  };
}

/**
 * Recovers unfinished cycles, retries pending deliveries, and starts durable scheduler.
 */
export function ensureSchedulerStarted(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  console.log("[M6 Monitoring Service] Initializing durable scheduler & recovering state...");

  // Recover any unfinished cycles from previous crash/restart
  const incomplete = getIncompleteMonitoringCycles();
  if (incomplete.length > 0) {
    console.log(`[M6 Monitoring Service] Recovering ${incomplete.length} interrupted cycles from restart.`);
    for (const c of incomplete) {
      updateMonitoringCycle(c.id, {
        status: "completed",
        errorMessage: "Cycle interrupted by server restart; safely recovered.",
      });
    }
  }

  // Initial immediate run
  runFullScheduledMonitoringCycle().catch((err) => console.error("Initial monitoring cycle error:", err));

  // Durable Routine Interval
  routineTimer = setInterval(() => {
    runFullScheduledMonitoringCycle().catch((err) => console.error("Scheduled cycle error:", err));
  }, MONITORING_CONFIG.SCHEDULED_CYCLE_INTERVAL_MS);
  if (routineTimer.unref) routineTimer.unref();

  // Time-Sensitive Interval
  timeSensitiveTimer = setInterval(() => {
    runTimeSensitiveMonitoringCycle().catch((err) => console.error("Time-sensitive cycle error:", err));
  }, MONITORING_CONFIG.TIME_SENSITIVE_INTERVAL_MS);
  if (timeSensitiveTimer.unref) timeSensitiveTimer.unref();

  // Outage / Discord retry interval
  retryTimer = setInterval(() => {
    retryPendingDiscordNotifications().catch((err) => console.error("Discord retry error:", err));
  }, MONITORING_CONFIG.RETRY_INTERVAL_MS);
  if (retryTimer.unref) retryTimer.unref();
}

export function stopScheduler(): void {
  if (routineTimer) clearInterval(routineTimer);
  if (timeSensitiveTimer) clearInterval(timeSensitiveTimer);
  if (retryTimer) clearInterval(retryTimer);
  schedulerStarted = false;
  console.log("[M6 Monitoring Service] Scheduler stopped.");
}
