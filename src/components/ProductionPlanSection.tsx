"use client";

import { useState, type FormEvent } from "react";
import { productLabels } from "@/data/seed";
import type { BakeryOrder, ProductionPlan } from "@/domain/types";

interface ProductionPlanSectionProps {
  plan?: ProductionPlan;
  orders: BakeryOrder[];
  error?: string;
  onGenerate: () => void;
  onApprove: () => void;
  onRequestChanges: (note: string) => void;
}

const statusNames: Record<ProductionPlan["status"], string> = {
  proposed: "Awaiting approval",
  changesRequested: "Changes requested",
  approved: "Approved",
  inProgress: "In production",
  complete: "Production complete",
};

export function ProductionPlanSection({
  plan,
  orders,
  error,
  onGenerate,
  onApprove,
  onRequestChanges,
}: ProductionPlanSectionProps) {
  const [requestingChanges, setRequestingChanges] = useState(false);
  const [changeNote, setChangeNote] = useState("");
  const [localError, setLocalError] = useState("");

  const orderNames = new Map(orders.map((order) => [order.id, order.customerName]));
  const canRequestChanges = !!plan && (plan.status === "proposed" || plan.status === "approved");

  function submitChangeRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!changeNote.trim()) {
      setLocalError("Enter what needs to change in the plan.");
      return;
    }
    onRequestChanges(changeNote.trim());
    setChangeNote("");
    setRequestingChanges(false);
    setLocalError("");
  }

  return (
    <section className="panel workflow-panel" id="production-plan">
      <div className="panel-heading">
        <div>
          <h2>Production plan</h2>
          <p>Deterministic ingredient requirements and batch schedules</p>
        </div>
        <div className="action-row">
          <button className="primary-button" onClick={onGenerate}>
            {plan ? "Recalculate proposal" : "Generate plan"}
          </button>
        </div>
      </div>

      {!plan ? (
        <div className="empty-state">
          <span className="empty-icon">◷</span>
          <strong>No production plan yet</strong>
          <span>Review submitted customer orders and generate the morning schedule.</span>
        </div>
      ) : (
        <>
          <div className="plan-summary">
            <span className={`status-pill status-${plan.status}`}>{statusNames[plan.status]}</span>
            <span>Revision {plan.revision}</span>
            <span>Generated {new Date(plan.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            {plan.isStale && <span className="warning-pill">Order details changed since plan was generated</span>}
          </div>

          <div className="plan-grid">
            <div className="plan-subpanel">
              <div className="subpanel-heading">
                <strong>Ingredient requirements</strong>
                <span>{plan.ingredientRequirements.length} items</span>
              </div>
              <div className="ingredient-list">
                {plan.ingredientRequirements.map((item) => (
                  <div className="ingredient-row" key={item.ingredientId}>
                    <span>{item.name}</span>
                    <span className={item.shortage > 0 ? "shortage" : "available"}>
                      {item.quantity} {item.unit} (on hand: {item.onHand} {item.unit})
                      {item.shortage > 0 && ` · Short by ${item.shortage} ${item.unit}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="plan-subpanel">
              <div className="subpanel-heading">
                <strong>Production batches</strong>
                <span>{plan.batches.length} product runs</span>
              </div>
              <div className="batch-list">
                {plan.batches.map((batch) => (
                  <article className="batch-card" key={batch.id}>
                    <div className="batch-heading">
                      <strong>{productLabels[batch.productId]}</strong>
                      <span>{batch.startAt}–{batch.endAt}</span>
                    </div>
                    <div className="batch-detail">
                      {batch.recipeBatchCount} recipe {batch.recipeBatchCount === 1 ? "batch" : "batches"} · {batch.plannedQuantity} planned / {batch.requestedQuantity} ordered · due {batch.dueAt}
                    </div>
                    <div className="batch-detail">Assigned baker: {batch.assignedStaffId}</div>
                    <div className="batch-detail">
                      Customer orders: {batch.orderIds.map((orderId) => orderNames.get(orderId) ?? "Customer unavailable").join(", ")}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>

          {plan.warnings.length > 0 && (
            <div className="warning-list">
              <strong>Planning notes</strong>
              {plan.warnings.map((warning) => (
                <div className={warning.severity === "warning" ? "warning-item" : "info-item"} key={warning.id}>
                  <span>{warning.severity === "warning" ? "!" : "i"}</span>
                  {warning.message}
                </div>
              ))}
            </div>
          )}

          {plan.status === "proposed" && (
            <div className="approval-actions">
              <div>
                <strong>Manager review required</strong>
                <span>Tasks will be created only after approval.</span>
              </div>
              <div className="action-row">
                <button className="secondary-button" onClick={() => setRequestingChanges(!requestingChanges)}>
                  Request changes
                </button>
                <button className="small-primary" disabled={plan.isStale} onClick={onApprove}>
                  Approve plan & create tasks
                </button>
              </div>
            </div>
          )}

          {plan.status === "approved" && (
            <>
              <div className="approved-banner">
                <span>✓</span> Approved by {plan.approvedBy} at {new Date(plan.approvedAt ?? plan.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Staff tasks are available below.
              </div>
              <div className="revoke-actions">
                <span>Sending this plan back will revoke its approval and hide its active tasks.</span>
                <button className="secondary-button" onClick={() => setRequestingChanges(!requestingChanges)}>
                  Send back for changes
                </button>
              </div>
            </>
          )}

          {plan.status === "changesRequested" && (
            <div className="requested-banner">
              Plan changes requested. Regenerate the proposal after updating orders or assumptions.
            </div>
          )}

          {requestingChanges && canRequestChanges && (
            <form className="change-form" onSubmit={submitChangeRequest}>
              <label className="field-label">
                What should change?
                <textarea
                  rows={2}
                  value={changeNote}
                  onChange={(event) => setChangeNote(event.target.value)}
                  placeholder="For example: schedule croissants first"
                />
              </label>
              {localError && <p className="form-error">{localError}</p>}
              <div className="action-row">
                <button type="button" className="secondary-button" onClick={() => setRequestingChanges(false)}>
                  Cancel
                </button>
                <button type="submit" className="small-primary">
                  Send request
                </button>
              </div>
            </form>
          )}
        </>
      )}

      {error && <p className="form-error global-error" role="alert">{error}</p>}
    </section>
  );
}
