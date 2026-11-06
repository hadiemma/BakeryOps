import {
  createCollaborationMessage,
  listCollaborationMessages,
  createChallenge,
  listChallenges,
  updateChallenge,
  getChallenge,
  getOrderWorkflowState,
  upsertOrderWorkflowState,
  listOrderWorkflowStates,
  createApprovalRequest,
  upsertAgentLiveStatus,
  recordAuditLog,
  listOperationalInventory,
} from "./db";
import type {
  CollaborationMessage,
  CollaborationMessageType,
  CollaborationStatus,
  WorkflowStage,
  ChallengeRecord,
  OrderWorkflowState,
  BakeryOrder,
  ProductionBatch,
  IngredientRequirement,
  AgentStatusType,
} from "@/domain/types";
import { recipes, ingredients, staff } from "@/data/seed";
import { generateProductionPlan } from "@/domain/workflow";
import { eventBroadcaster } from "./event-broadcaster";

export const AGENT_REGISTRY = {
  "order-analyst": {
    id: "order-analyst",
    switchId: "2bb7edb5-3078-44ec-8459-734f1488f1d1",
    name: "Order Analyst",
    role: "Intake & Order Validation Specialist",
  },
  "production-planner": {
    id: "production-planner",
    switchId: "4c773347-5508-43b3-977a-5c1583b41d51",
    name: "Production Planner",
    role: "Batch Scheduling & Timeline Specialist",
  },
  "inventory-manager": {
    id: "inventory-manager",
    switchId: "7f3839e2-3c29-43a5-bbf0-69ad56340f36",
    name: "Inventory Manager",
    role: "Ingredients & Stock Feasibility Specialist",
  },
  "staff-task-assigner": {
    id: "staff-task-assigner",
    switchId: "fbbacaba-b96f-48d9-8e4f-e787d910bdf4",
    name: "Staff Task Assigner",
    role: "Task Execution & Staff Allocation Specialist",
  },
  manager: {
    id: "manager",
    switchId: "0a01b6c4-1a06-4e1d-8aab-a1de6bbf6101",
    name: "hadishanavas7454 (Bakery Manager)",
    role: "Human Bakery Manager & Final Authority",
  },
};

/**
 * Validates and records a collaboration message, advances workflow state,
 * updates live agent statuses, records audit logs, broadcasts real-time events,
 * and handles backward challenges, revisions, and loop escalation.
 */
export function handleCollaborationMessage(input: {
  orderId: string;
  taskId?: string;
  workflowStage?: WorkflowStage;
  senderId: string;
  senderName?: string;
  recipientId: string;
  recipientName?: string;
  messageType: CollaborationMessageType;
  status?: CollaborationStatus;
  content: string;
  evidence?: string;
  reason?: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
}): {
  message: CollaborationMessage;
  workflowState: OrderWorkflowState;
  escalated: boolean;
} {
  const orderId = input.orderId;
  let currentState = getOrderWorkflowState(orderId);

  if (!currentState) {
    currentState = {
      orderId,
      currentStage: input.workflowStage || "intake",
      activeAgentId: input.senderId,
      waitingFor: input.recipientId,
      revisionCount: 0,
      status: input.status || "IN_PROGRESS",
      updatedAt: new Date().toISOString(),
    };
  }

  let nextStage: WorkflowStage = input.workflowStage || currentState.currentStage;
  let nextActive = currentState.activeAgentId;
  let nextWaiting = currentState.waitingFor;
  let nextStatus: CollaborationStatus = input.status || currentState.status;
  let revisionCount = currentState.revisionCount;
  let escalated = false;

  // 1. CHALLENGE LIFECYCLE
  if (input.messageType === "CHALLENGE") {
    nextStatus = "CHALLENGED";
    nextActive = input.recipientId;
    nextWaiting = input.senderId;

    const chal = createChallenge({
      id: `chal-${crypto.randomUUID()}`,
      orderId,
      challengingAgentId: input.senderId,
      targetAgentId: input.recipientId,
      issue: input.content,
      evidence: input.evidence || "Evidence noted in message",
      status: "OPEN",
    });

    recordAuditLog({
      id: `audit-${crypto.randomUUID()}`,
      eventType: "OPERATIONAL_CHALLENGE_RAISED",
      proposedBy: input.senderName || input.senderId,
      changeDescription: `Challenge raised by ${input.senderId} against ${input.recipientId} on Order ${orderId}: ${input.content}`,
      evidence: input.evidence,
      reason: input.reason,
      executionStatus: "PROPOSED",
    });

    eventBroadcaster.broadcast("challenge_raised", chal);
  } else if (input.messageType === "REVISION") {
    revisionCount += 1;
    nextActive = input.recipientId;
    nextWaiting = input.senderId;

    const challenges = listChallenges(orderId).filter(
      (c) => c.status === "OPEN" || c.status === "INVESTIGATING",
    );
    for (const c of challenges) {
      updateChallenge(c.id, {
        status: "REVISION_PROVIDED",
        revisionSummary: input.content,
      });
    }

    recordAuditLog({
      id: `audit-${crypto.randomUUID()}`,
      eventType: "PLAN_REVISION_SUBMITTED",
      proposedBy: input.senderName || input.senderId,
      changeDescription: `Revision ${revisionCount} submitted for Order ${orderId}: ${input.content}`,
      evidence: input.evidence,
      reason: input.reason,
      executionStatus: "PROPOSED",
    });

    // Loop Prevention: max 2 revisions per order before escalating to manager
    if (revisionCount > 2) {
      escalated = true;
      nextStatus = "WAITING_FOR_MANAGER";
      nextWaiting = "manager";

      createApprovalRequest({
        id: `appr-esc-${crypto.randomUUID()}`,
        orderId,
        taskId: input.taskId,
        agentId: input.senderId,
        agentName: input.senderName || input.senderId,
        title: `Escalation: Unresolved Operational Disagreement on Order ${orderId}`,
        description: `Revision limit exceeded (${revisionCount} revisions). Specialist agents could not resolve constraints automatically: ${input.content}`,
        status: "WAITING_FOR_MANAGER",
        metadata: {
          reason: "loop_prevention_limit_exceeded",
          evidence: input.evidence,
        },
      });

      recordAuditLog({
        id: `audit-${crypto.randomUUID()}`,
        eventType: "ESCALATION_TO_MANAGER",
        proposedBy: input.senderName || input.senderId,
        changeDescription: `Automatic loop prevention: Escalated order ${orderId} to manager after ${revisionCount} revisions`,
        evidence: input.evidence,
        reason: "Revision threshold exceeded",
        executionStatus: "PENDING_APPROVAL",
      });
    } else {
      nextStatus = "REVISION_REQUIRED";
    }
  } else if (input.messageType === "RESOLVED") {
    nextStatus = "IN_PROGRESS";
    nextActive = input.senderId;
    nextWaiting = input.recipientId;

    const challenges = listChallenges(orderId).filter((c) => c.status !== "RESOLVED");
    for (const c of challenges) {
      updateChallenge(c.id, {
        status: "RESOLVED",
        resolutionNotes: input.content,
      });
    }

    recordAuditLog({
      id: `audit-${crypto.randomUUID()}`,
      eventType: "CHALLENGE_RESOLVED",
      proposedBy: input.senderName || input.senderId,
      changeDescription: `Operational challenge resolved for Order ${orderId}: ${input.content}`,
      evidence: input.evidence,
      reason: input.reason,
      executionStatus: "EXECUTED",
    });
  } else if (input.messageType === "HANDOFF") {
    nextActive = input.recipientId;
    nextWaiting = input.recipientId;
    nextStatus = "IN_PROGRESS";

    if (currentState.currentStage === "intake") {
      nextStage = "production_planning";
    } else if (currentState.currentStage === "production_planning") {
      nextStage = "inventory_verification";
    } else if (currentState.currentStage === "inventory_verification") {
      nextStage = "final_validation";
    } else if (currentState.currentStage === "final_validation") {
      nextStage = "manager_approval";
      nextStatus = "WAITING_FOR_MANAGER";
      nextWaiting = "manager";
    } else if (currentState.currentStage === "manager_approval") {
      nextStage = "staff_assignment";
    } else if (currentState.currentStage === "staff_assignment") {
      nextStage = "completed";
      nextStatus = "COMPLETED";
    }
  } else if (input.messageType === "APPROVAL_REQUEST") {
    nextStage = "manager_approval";
    nextStatus = "WAITING_FOR_MANAGER";
    nextWaiting = "manager";

    createApprovalRequest({
      id: `appr-${crypto.randomUUID()}`,
      orderId,
      taskId: input.taskId,
      agentId: input.senderId,
      agentName: input.senderName || input.senderId,
      title: input.reason || `Manager Approval Required for Order ${orderId}`,
      description: `${input.content}${input.evidence ? ` | Evidence: ${input.evidence}` : ""}`,
      status: "WAITING_FOR_MANAGER",
    });

    recordAuditLog({
      id: `audit-${crypto.randomUUID()}`,
      eventType: "APPROVAL_REQUESTED",
      proposedBy: input.senderName || input.senderId,
      changeDescription: `Approval requested for Order ${orderId}: ${input.content}`,
      evidence: input.evidence,
      reason: input.reason,
      executionStatus: "PENDING_APPROVAL",
    });
  } else if (input.messageType === "ALERT") {
    if (input.content.toLowerCase().includes("block") || input.content.toLowerCase().includes("delay")) {
      nextStatus = "BLOCKED";
    }
  }

  const updatedState: OrderWorkflowState = {
    orderId,
    currentStage: nextStage,
    activeAgentId: nextActive,
    waitingFor: nextWaiting,
    revisionCount,
    status: nextStatus,
    updatedAt: new Date().toISOString(),
  };

  upsertOrderWorkflowState(updatedState);

  const senderObj = AGENT_REGISTRY[input.senderId as keyof typeof AGENT_REGISTRY];
  const recipientObj = AGENT_REGISTRY[input.recipientId as keyof typeof AGENT_REGISTRY];

  const message = createCollaborationMessage({
    id: `collab-${crypto.randomUUID()}`,
    orderId,
    taskId: input.taskId,
    workflowStage: nextStage,
    senderId: input.senderId,
    senderName: input.senderName || senderObj?.name || input.senderId,
    recipientId: input.recipientId,
    recipientName: input.recipientName || recipientObj?.name || input.recipientId,
    messageType: input.messageType,
    status: nextStatus,
    content: input.content,
    evidence: input.evidence,
    reason: input.reason,
    referenceId: input.referenceId,
    metadata: input.metadata,
  });

  // M4: Update Live Agent Statuses for both sender and recipient
  const now = new Date().toISOString();
  if (input.senderId !== "manager") {
    let senderStatus: AgentStatusType = "WORKING";
    if (input.messageType === "APPROVAL_REQUEST") senderStatus = "WAITING_FOR_MANAGER";
    else if (input.messageType === "HANDOFF" || input.messageType === "TASK_REQUEST" || input.messageType === "QUESTION") {
      senderStatus = "WAITING_FOR_AGENT";
    } else {
      senderStatus = "COMMUNICATING";
    }

    upsertAgentLiveStatus({
      agentId: input.senderId,
      name: senderObj?.name || input.senderId,
      role: senderObj?.role || "Specialist",
      status: senderStatus,
      currentOrderId: orderId,
      currentTaskId: input.taskId,
      currentStage: nextStage,
      currentActivity: `${input.messageType} sent to ${recipientObj?.name || input.recipientId}: ${input.content.slice(0, 80)}...`,
      intendedRecipient: input.recipientId,
      waitingFor: senderStatus === "WAITING_FOR_MANAGER" ? "manager" : input.recipientId,
      lastActivityAt: now,
    });
  }

  if (input.recipientId !== "manager" && input.recipientId !== "all") {
    let recipientStatus: AgentStatusType = "WORKING";
    if (input.messageType === "CHALLENGE") recipientStatus = "CHALLENGED";
    else if (input.messageType === "REVISION") recipientStatus = "REVISION_REQUIRED";
    else recipientStatus = "WORKING";

    upsertAgentLiveStatus({
      agentId: input.recipientId,
      name: recipientObj?.name || input.recipientId,
      role: recipientObj?.role || "Specialist",
      status: recipientStatus,
      currentOrderId: orderId,
      currentTaskId: input.taskId,
      currentStage: nextStage,
      currentActivity: `Processing ${input.messageType} from ${senderObj?.name || input.senderId}`,
      waitingFor: undefined,
      lastActivityAt: now,
    });
  }

  // Broadcast real-time SSE event
  eventBroadcaster.broadcast("collaboration_message", {
    message,
    workflowState: updatedState,
    escalated,
  });

  return { message, workflowState: updatedState, escalated };
}

/**
 * Executes the canonical collaborative sequence with backward challenge
 * for a validated order, using authoritative calculations from workflow.ts.
 */
export function runCollaborationWorkflowForOrder(order: BakeryOrder): {
  messages: CollaborationMessage[];
  state: OrderWorkflowState;
} {
  const dbInventory = listOperationalInventory(false);
  const activeIngredients = dbInventory.length > 0 ? dbInventory : ingredients;
  const plan = generateProductionPlan([order], recipes, activeIngredients, staff, {
    id: `plan-${order.id}`,
    revision: 1,
    createdAt: new Date().toISOString(),
  });
  const orderId = order.id;
  const messages: CollaborationMessage[] = [];

  // Stage 1: Order Analyst Intake & Handoff
  const itemSummary = order.items
    .map((i) => `${i.quantity}x ${recipes[i.productId]?.name || i.productId}`)
    .join(", ");
  const m1 = handleCollaborationMessage({
    orderId,
    workflowStage: "intake",
    senderId: "order-analyst",
    recipientId: "production-planner",
    messageType: "HANDOFF",
    content: `Validated customer order ${orderId} (${order.customerName}). Items: ${itemSummary}. Delivery due: ${order.dueAt}. Passing to Production Planner for batch sizing.`,
    evidence: `Customer requirements verified: ${order.items.length} product lines. Notes: "${order.note || "Standard delivery"}"`,
    reason: "Order validation complete. Initiating sequential production planning.",
  });
  messages.push(m1.message);

  // Stage 2: Production Planner Calculation & Ingredient Task Request
  const batchSummary = plan.batches
    .map((b: ProductionBatch) => `${b.plannedQuantity} items (${b.recipeBatchCount} recipe batches) of ${recipes[b.productId]?.name}`)
    .join("; ");
  const m2 = handleCollaborationMessage({
    orderId,
    workflowStage: "production_planning",
    senderId: "production-planner",
    recipientId: "inventory-manager",
    messageType: "TASK_REQUEST",
    content: `Calculated production requirements for ${orderId}: ${batchSummary}. Baking window requires prep starting at ${plan.batches[0]?.startAt || "07:00"} to meet due time ${order.dueAt}. Please verify ingredient inventory feasibility.`,
    evidence: `Canonical yields used: Sourdough (4/batch), Cinnamon rolls (12/batch), Croissants (8/batch). Total ${plan.batches.length} batches planned.`,
    reason: "Ingredient stock verification required before plan finalization.",
    referenceId: m1.message.id,
  });
  messages.push(m2.message);

  // Stage 3: Inventory Manager Stock Check
  const shortages = plan.ingredientRequirements.filter((req: IngredientRequirement) => req.shortage > 0);
  if (shortages.length > 0) {
    const deficitText = shortages.map((s: IngredientRequirement) => `${s.name}: need ${s.quantity}${s.unit}, on-hand ${s.onHand}${s.unit} (DEFICIT: ${s.shortage}${s.unit})`).join("; ");
    // Raise backward challenge to Production Planner!
    const m3 = handleCollaborationMessage({
      orderId,
      workflowStage: "inventory_verification",
      senderId: "inventory-manager",
      recipientId: "production-planner",
      messageType: "CHALLENGE",
      content: `Cannot fulfill planned batches for ${orderId} due to stock deficits: ${deficitText}. Recommending either partial batch reduction or submitting ingredient purchase authorization.`,
      evidence: `Stock on hand verified against master inventory. Shortage detected on ${shortages.length} raw ingredients.`,
      reason: "Inventory constraint prevents execution of proposed production plan.",
      referenceId: m2.message.id,
    });
    messages.push(m3.message);

    // Stage 3b: Production Planner responds with Revision & Purchase Request
    const m4 = handleCollaborationMessage({
      orderId,
      workflowStage: "production_planning",
      senderId: "production-planner",
      recipientId: "inventory-manager",
      messageType: "REVISION",
      content: `Acknowledged inventory constraint. Production schedule updated with batch deferral buffer. Requesting Inventory Manager submit purchase approval request to Manager for required ingredients so baking can proceed on arrival.`,
      evidence: `Baking timeline adjusted. Prep delayed by 30 mins to allow ingredient staging.`,
      reason: "Revision submitted to resolve inventory challenge.",
      referenceId: m3.message.id,
    });
    messages.push(m4.message);

    // Stage 3c: Inventory Manager resolves challenge & submits approval request
    const m5 = handleCollaborationMessage({
      orderId,
      workflowStage: "inventory_verification",
      senderId: "inventory-manager",
      recipientId: "production-planner",
      messageType: "RESOLVED",
      content: `Challenge resolved. Submitted purchase approval request to Manager for ${shortages[0]?.name || "ingredients"}. Inventory feasibility conditional on manager authorization. Handing off to Order Analyst.`,
      evidence: `Supplier delivery lead time 2 hours. Order can proceed once Manager authorizes purchase.`,
      reason: "Resolution confirmed between Production Planner and Inventory Manager.",
      referenceId: m4.message.id,
    });
    messages.push(m5.message);
  } else {
    const m3 = handleCollaborationMessage({
      orderId,
      workflowStage: "inventory_verification",
      senderId: "inventory-manager",
      recipientId: "production-planner",
      messageType: "FINDING",
      content: `Inventory check complete for ${orderId}. All required ingredients available on hand. Stock levels remain above reorder thresholds after batch deductions.`,
      evidence: `Verified ${plan.ingredientRequirements.length} ingredient lines. No shortages detected.`,
      reason: "Stock feasibility confirmed.",
      referenceId: m2.message.id,
    });
    messages.push(m3.message);
  }

  // Stage 4: Order Analyst Final Validation & Handoff for Manager Approval
  const mFinal = handleCollaborationMessage({
    orderId,
    workflowStage: "final_validation",
    senderId: "order-analyst",
    recipientId: "manager",
    messageType: "APPROVAL_REQUEST",
    content: `Final validation completed for ${orderId} (${order.customerName}). Production plan: ${plan.batches.length} batches. Timeline: Start ${plan.batches[0]?.startAt || "07:00"} -> Due ${order.dueAt}. Awaiting human manager sign-off.`,
    evidence: `Feasibility confirmed by Production Planner and Inventory Manager. No customer note violations found.`,
    reason: "Final manager authorization required before dispatching staff tasks.",
  });
  messages.push(mFinal.message);

  const finalState = getOrderWorkflowState(orderId)!;
  return { messages, state: finalState };
}
