import type {
  BakeryOrder,
  Ingredient,
  IngredientId,
  IngredientRequirement,
  PlanWarning,
  ProductionPlan,
  ProductionTask,
  ProductId,
  Recipe,
  StaffMember,
  TaskKind,
  TaskStatus,
} from "./types";

const ACTIVE_FOR_PLANNING = new Set([
  "submitted",
  "planned",
  "inProduction",
  "waitingForProductionConfirmation",
  "readyForDelivery",
  "needsAttention",
]);
const SHIFT_START = "07:00";

function minutesFromTime(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Invalid time: ${value}`);
  }
  return hours * 60 + minutes;
}

function timeFromMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function aggregateDemand(orders: BakeryOrder[]) {
  const demand = new Map<ProductId, { quantity: number; orderIds: Set<string>; dueAt: string }>();

  for (const order of orders) {
    if (!ACTIVE_FOR_PLANNING.has(order.status)) continue;
    if (!order.items.length) throw new Error(`Order ${order.id} needs at least one product.`);
    for (const item of order.items) {
      if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        throw new Error(`Order quantities must be positive whole numbers (${order.customerName}).`);
      }
      const current = demand.get(item.productId);
      if (current) {
        current.quantity += item.quantity;
        current.orderIds.add(order.id);
        if (order.dueAt < current.dueAt) current.dueAt = order.dueAt;
      } else {
        demand.set(item.productId, { quantity: item.quantity, orderIds: new Set([order.id]), dueAt: order.dueAt });
      }
    }
  }
  return demand;
}

/** Scale whole recipe batches and combine demand by ingredient ID. */
export function calculateIngredientRequirements(
  orders: BakeryOrder[],
  recipes: Record<ProductId, Recipe>,
  ingredients: Ingredient[],
): IngredientRequirement[] {
  const demand = aggregateDemand(orders);
  const ingredientById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
  const totals = new Map<IngredientId, number>();

  for (const [productId, productDemand] of demand) {
    const recipe = recipes[productId];
    if (!recipe || recipe.yieldQuantity < 1) throw new Error(`A valid recipe is required for ${productId}.`);
    const recipeBatchCount = Math.ceil(productDemand.quantity / recipe.yieldQuantity);
    for (const recipeIngredient of recipe.ingredients) {
      totals.set(recipeIngredient.ingredientId, (totals.get(recipeIngredient.ingredientId) ?? 0) + recipeIngredient.quantity * recipeBatchCount);
    }
  }

  return [...totals.entries()]
    .map(([ingredientId, quantity]) => {
      const ingredient = ingredientById.get(ingredientId);
      if (!ingredient) throw new Error(`Missing ingredient record: ${ingredientId}.`);
      return {
        ingredientId: ingredient.id,
        name: ingredient.name,
        quantity,
        unit: ingredient.baseUnit,
        onHand: ingredient.onHand,
        shortage: Math.max(0, quantity - ingredient.onHand),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface PlanOptions {
  id: string;
  revision: number;
  createdAt: string;
  shiftStart?: string;
}

/**
 * Produce a repeatable single-line schedule. Each product group is one
 * simplified production run; the MVP does not model oven parallelism,
 * fermentation, or lamination. These assumptions are exposed as warnings.
 */
export function generateProductionPlan(
  orders: BakeryOrder[],
  recipes: Record<ProductId, Recipe>,
  ingredients: Ingredient[],
  staff: StaffMember[],
  options: PlanOptions,
): ProductionPlan {
  const demand = aggregateDemand(orders);
  if (!demand.size) throw new Error("Add or submit an order before generating a production plan.");

  const bakers = staff.filter((person) => person.role === "baker").sort((a, b) => a.id.localeCompare(b.id));
  if (!bakers.length) throw new Error("At least one baker must be available to assign production batches.");

  const ingredientsNeeded = calculateIngredientRequirements(orders, recipes, ingredients);
  const schedule = [...demand.entries()].sort(([productA, a], [productB, b]) => {
    return a.dueAt.localeCompare(b.dueAt) || productA.localeCompare(productB);
  });
  let cursor = minutesFromTime(options.shiftStart ?? SHIFT_START);
  const warnings: PlanWarning[] = [];
  const batches = schedule.map(([productId, productDemand], index) => {
    const recipe = recipes[productId];
    if (!recipe || recipe.yieldQuantity < 1) throw new Error(`A valid recipe is required for ${productId}.`);
    const recipeBatchCount = Math.ceil(productDemand.quantity / recipe.yieldQuantity);
    const durationMinutes = Math.max(1, recipe.prepMinutes + recipe.bakeMinutes);
    const startAt = timeFromMinutes(cursor);
    cursor += durationMinutes;
    const endAt = timeFromMinutes(cursor);
    const plannedQuantity = recipeBatchCount * recipe.yieldQuantity;
    const batch = {
      id: `${options.id}-batch-${productId}`,
      productId,
      orderIds: [...productDemand.orderIds].sort(),
      requestedQuantity: productDemand.quantity,
      plannedQuantity,
      recipeBatchCount,
      dueAt: productDemand.dueAt,
      startAt,
      endAt,
      assignedStaffId: bakers[index % bakers.length].id,
    };

    if (plannedQuantity > productDemand.quantity) {
      warnings.push({
        id: `overage-${productId}`,
        severity: "info",
        message: `${recipe.name}: whole recipe batches produce ${plannedQuantity - productDemand.quantity} extra ${recipe.yieldUnit}.`,
      });
    }
    if (cursor > minutesFromTime(productDemand.dueAt)) {
      warnings.push({
        id: `late-${productId}`,
        severity: "warning",
        message: `${recipe.name} is scheduled to finish at ${endAt}, after its ${productDemand.dueAt} due time.`,
      });
    }
    return batch;
  });

  for (const requirement of ingredientsNeeded) {
    if (requirement.shortage > 0) {
      warnings.push({
        id: `shortage-${requirement.ingredientId}`,
        severity: "warning",
        message: `Short ${requirement.shortage} ${requirement.unit} of ${requirement.name} based on demo stock.`,
      });
    }
  }
  warnings.push({
    id: "schedule-assumptions",
    severity: "info",
    message: "Schedule is a simple sequential estimate; fermentation, lamination, and parallel oven capacity are not modeled.",
  });

  return {
    id: options.id,
    revision: options.revision,
    createdAt: options.createdAt,
    status: "proposed",
    orderIds: [...new Set([...demand.values()].flatMap((item) => [...item.orderIds]))].sort(),
    ingredientRequirements: ingredientsNeeded,
    batches,
    warnings,
  };
}

export function approveProductionPlan(plan: ProductionPlan, managerId: string, approvedAt: string): ProductionPlan {
  if (plan.status !== "proposed") throw new Error("Only a proposed plan can be approved.");
  if (plan.isStale) throw new Error("This plan is out of date. Generate a fresh proposal before approving it.");
  if (!managerId.trim()) throw new Error("A manager must be recorded as the approver.");
  return { ...plan, status: "approved", approvedBy: managerId, approvedAt, changeRequest: undefined };
}

export function requestPlanChanges(plan: ProductionPlan, changeRequest: string): ProductionPlan {
  if (plan.status !== "proposed" && plan.status !== "approved") {
    throw new Error("Changes can only be requested on a proposed or approved plan.");
  }
  if (!changeRequest.trim()) throw new Error("Describe what should change in the plan.");
  return {
    ...plan,
    status: "changesRequested",
    changeRequest: changeRequest.trim(),
    approvedBy: undefined,
    approvedAt: undefined,
  };
}

export function invalidatePlanApproval(plan: ProductionPlan, reason: string): ProductionPlan {
  return {
    ...plan,
    status: "changesRequested",
    isStale: true,
    changeRequest: reason,
    approvedBy: undefined,
    approvedAt: undefined,
  };
}

export function generateTasksForPlan(plans: ProductionPlan[], staff: StaffMember[]): ProductionTask[] {
  const plan = plans.at(-1);
  if (!plan || plan.status !== "approved" || plan.isStale || !plan.approvedBy || !plan.approvedAt) {
    throw new Error("Tasks can only be generated from the latest, current, human-approved plan revision.");
  }
  const packer = staff.filter((person) => person.role === "packer").sort((a, b) => a.id.localeCompare(b.id))[0];
  if (!packer) throw new Error("At least one packer is needed to generate packing tasks.");
  const staffById = new Map(staff.map((person) => [person.id, person]));
  const taskKinds: TaskKind[] = ["prep", "bake", "pack"];

  return plan.batches.flatMap((batch) => taskKinds.map((kind) => {
    const assigneeId = kind === "pack" ? packer.id : batch.assignedStaffId;
    if (!staffById.has(assigneeId)) throw new Error(`Missing staff record for ${assigneeId}.`);
    return {
      id: `${plan.id}-${batch.id}-${kind}`,
      planId: plan.id,
      batchId: batch.id,
      orderIds: batch.orderIds,
      kind,
      assigneeId,
      dueAt: batch.endAt,
      status: "todo" as TaskStatus,
    };
  }));
}

export function updateTaskStatus(task: ProductionTask, status: TaskStatus, blockerNote = ""): ProductionTask {
  if (status === "blocked" && !blockerNote.trim()) throw new Error("Add a short blocker note before marking this task blocked.");
  return {
    ...task,
    status,
    blockerNote: status === "blocked" ? blockerNote.trim() : undefined,
  };
}
