import { describe, expect, it } from "vitest";
import { ingredients, orders, recipes, staff } from "@/data/seed";
import type { BakeryOrder, ProductionPlan } from "./types";
import {
  approveProductionPlan,
  calculateIngredientRequirements,
  generateProductionPlan,
  generateTasksForPlan,
  invalidatePlanApproval,
  requestPlanChanges,
  updateTaskStatus,
} from "./workflow";

function makePlan(): ProductionPlan {
  return generateProductionPlan(orders, recipes, ingredients, staff, {
    id: "test-plan",
    revision: 1,
    createdAt: "2026-05-20T07:00:00.000Z",
  });
}

describe("ingredient and batch calculations", () => {
  it("scales whole recipe batches and combines shared ingredients", () => {
    const totals = calculateIngredientRequirements(orders, recipes, ingredients);
    expect(totals.find((item) => item.ingredientId === "bread-flour")?.quantity).toBe(11_900);
    expect(totals.find((item) => item.ingredientId === "water")?.quantity).toBe(6_900);
    expect(totals.find((item) => item.ingredientId === "salt")?.quantity).toBe(230);
  });

  it("groups same-product demand from multiple orders into one deterministic batch", () => {
    const plan = makePlan();
    expect(plan.status).toBe("proposed");
    expect(plan.batches).toHaveLength(3);
    const sourdoughBatch = plan.batches.find((batch) => batch.productId === "sourdough");
    expect(sourdoughBatch).toMatchObject({ requestedQuantity: 20, plannedQuantity: 20, recipeBatchCount: 5 });
    expect(sourdoughBatch?.orderIds).toEqual(["order-harbor-hotel", "order-mina-cafe"]);
    expect(makePlan().batches).toEqual(plan.batches);
  });

  it("returns shortage warnings when stock cannot cover the plan", () => {
    const lowStock = ingredients.map((item) => item.id === "bread-flour" ? { ...item, onHand: 100 } : item);
    const plan = generateProductionPlan(orders, recipes, lowStock, staff, {
      id: "low-stock-plan",
      revision: 1,
      createdAt: "2026-05-20T07:00:00.000Z",
    });
    expect(plan.ingredientRequirements.find((item) => item.ingredientId === "bread-flour")?.shortage).toBe(11_800);
    expect(plan.warnings.some((warning) => warning.id === "shortage-bread-flour")).toBe(true);
  });

  it("rejects invalid quantities and an empty plan", () => {
    const invalid: BakeryOrder[] = [{ ...orders[0], items: [{ ...orders[0].items[0], quantity: 0 }] }];
    expect(() => calculateIngredientRequirements(invalid, recipes, ingredients)).toThrow(/positive whole numbers/);
    expect(() => generateProductionPlan([], recipes, ingredients, staff, {
      id: "empty",
      revision: 1,
      createdAt: "2026-05-20T07:00:00.000Z",
    })).toThrow(/before generating/);
  });
});

describe("human approval gate and task generation", () => {
  it("does not generate tasks while a proposal is awaiting approval", () => {
    expect(() => generateTasksForPlan([makePlan()], staff)).toThrow(/latest, current, human-approved/);
  });

  it("requires a reviewable change request and a manager for approval", () => {
    const proposed = makePlan();
    expect(() => requestPlanChanges(proposed, "  ")).toThrow(/Describe/);
    expect(requestPlanChanges(proposed, "Move croissants earlier")).toMatchObject({
      status: "changesRequested",
      changeRequest: "Move croissants earlier",
    });
    expect(() => approveProductionPlan(proposed, " ", "2026-05-20T07:05:00.000Z")).toThrow(/manager/);
  });

  it("revokes approval when an approved plan is sent back or its source orders change", () => {
    const approved = approveProductionPlan(makePlan(), "alex", "2026-05-20T07:05:00.000Z");
    const returned = requestPlanChanges(approved, "Reschedule the croissants");
    expect(returned).toMatchObject({ status: "changesRequested", changeRequest: "Reschedule the croissants" });
    expect(returned.approvedBy).toBeUndefined();
    expect(returned.approvedAt).toBeUndefined();
    expect(() => generateTasksForPlan([returned], staff)).toThrow(/latest, current, human-approved/);

    const invalidated = invalidatePlanApproval(approved, "The order changed after approval");
    expect(invalidated).toMatchObject({ status: "changesRequested", isStale: true });
    expect(invalidated.approvedBy).toBeUndefined();
    expect(() => generateTasksForPlan([invalidated], staff)).toThrow(/latest, current, human-approved/);
  });

  it("only generates tasks from the latest approved revision", () => {
    const olderApproved = approveProductionPlan(makePlan(), "alex", "2026-05-20T07:05:00.000Z");
    const nextProposal = { ...makePlan(), id: "revision-two", revision: 2 };
    expect(() => generateTasksForPlan([olderApproved, nextProposal], staff)).toThrow(/latest, current, human-approved/);
    const latestApproved = approveProductionPlan(nextProposal, "alex", "2026-05-20T07:10:00.000Z");
    const tasks = generateTasksForPlan([olderApproved, latestApproved], staff);
    expect(tasks).toHaveLength(9);
    expect(tasks.every((task) => task.planId === "revision-two")).toBe(true);
  });

  it("creates prep, bake and pack tasks after approval and tracks blockers", () => {
    const approved = approveProductionPlan(makePlan(), "alex", "2026-05-20T07:05:00.000Z");
    const tasks = generateTasksForPlan([approved], staff);
    expect(approved.status).toBe("approved");
    expect(tasks).toHaveLength(9);
    expect(tasks.filter((task) => task.kind === "prep")).toHaveLength(3);
    expect(tasks.filter((task) => task.kind === "pack").every((task) => task.assigneeId === "sam")).toBe(true);
    expect(() => updateTaskStatus(tasks[0], "blocked")).toThrow(/blocker note/);
    expect(updateTaskStatus(tasks[0], "blocked", "Oven is occupied")).toMatchObject({
      status: "blocked",
      blockerNote: "Oven is occupied",
    });
  });
});
