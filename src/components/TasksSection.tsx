"use client";

import { useState } from "react";
import { productLabels } from "@/data/seed";
import type { BakeryOrder, ProductionTask, ProductId, StaffMember, TaskStatus } from "@/domain/types";

const taskLabels: Record<ProductionTask["kind"], string> = { prep: "Prepare", bake: "Bake", pack: "Pack" };
const statusLabels: Record<TaskStatus, string> = { todo: "To do", inProgress: "In progress", blocked: "Blocked", done: "Done" };

interface TasksSectionProps {
  tasks: ProductionTask[];
  orders: BakeryOrder[];
  staff: StaffMember[];
  productByBatch: Record<string, ProductId>;
  error?: string;
  onAssigneeChange: (taskId: string, staffId: string) => void;
  onStatusChange: (taskId: string, status: TaskStatus, blockerNote?: string) => void;
}

export function TasksSection({ tasks, orders, staff, productByBatch, error, onAssigneeChange, onStatusChange }: TasksSectionProps) {
  const [blockerDrafts, setBlockerDrafts] = useState<Record<string, string>>({});
  const [pendingBlocked, setPendingBlocked] = useState<Record<string, boolean>>({});
  const [localError, setLocalError] = useState<Record<string, string>>({});
  const closedOrderIds = new Set(orders.filter((o) => o.status === "closed").map((o) => o.id));
  const activeTasks = tasks.filter((t) => !t.orderIds.some((id) => closedOrderIds.has(id)));
  const orderNames = new Map(orders.map((order) => [order.id, order.customerName]));
  const doneCount = activeTasks.filter((task) => task.status === "done").length;

  function changeStatus(task: ProductionTask, status: TaskStatus) {
    setLocalError((current) => ({ ...current, [task.id]: "" }));
    if (status === "blocked") {
      setPendingBlocked((current) => ({ ...current, [task.id]: true }));
      return;
    }
    onStatusChange(task.id, status);
    setPendingBlocked((current) => ({ ...current, [task.id]: false }));
  }

  function saveBlocker(taskId: string) {
    const note = blockerDrafts[taskId] ?? tasks.find((task) => task.id === taskId)?.blockerNote ?? "";
    if (!note.trim()) {
      setLocalError((current) => ({ ...current, [taskId]: "Enter a short blocker note." }));
      return;
    }
    onStatusChange(taskId, "blocked", note);
    setPendingBlocked((current) => ({ ...current, [taskId]: false }));
    setLocalError((current) => ({ ...current, [taskId]: "" }));
  }

  return (
    <section className="panel workflow-panel" id="staff-tasks">
      <div className="panel-heading"><div><h2>Staff tasks</h2><p>Assignments and production progress</p></div>{activeTasks.length > 0 && <span className="task-progress">{doneCount} / {activeTasks.length} complete</span>}</div>
      {activeTasks.length === 0 ? <div className="empty-state"><span className="empty-icon">☷</span><strong>Tasks are locked</strong><span>Approve a production plan to generate prep, bake, and pack tasks.</span></div> : <div className="task-list">
        {activeTasks.map((task) => {
          const productId = productByBatch[task.batchId];
          const needsBlocker = task.status === "blocked" || pendingBlocked[task.id];
          return <article className={`task-card ${task.status === "blocked" ? "task-blocked" : ""}`} key={task.id}>
            <span className={`task-kind task-kind-${task.kind}`}>{task.kind === "prep" ? "✳" : task.kind === "bake" ? "◷" : "▣"}</span>
              <div className="task-description"><strong>{taskLabels[task.kind]} {productId ? productLabels[productId] : "production batch"}</strong><span>Customer orders: {task.orderIds.map((orderId) => orderNames.get(orderId) ?? "Customer unavailable").join(", ")} · Due {task.dueAt}</span>
              {task.status === "blocked" && task.blockerNote && <div className="blocker-callout">Blocked: {task.blockerNote}</div>}
              {needsBlocker && <div className="blocker-editor"><input aria-label="Blocker note" value={blockerDrafts[task.id] ?? task.blockerNote ?? ""} onChange={(event) => setBlockerDrafts((current) => ({ ...current, [task.id]: event.target.value }))} placeholder="What is blocking this task?" /><button className="text-action" onClick={() => saveBlocker(task.id)}>{task.status === "blocked" ? "Update note" : "Mark blocked"}</button>{localError[task.id] && <span className="form-error">{localError[task.id]}</span>}</div>}
            </div>
            <label className="task-assignee"><span>Assigned to</span><select aria-label={`Assignee for ${taskLabels[task.kind]}`} value={task.assigneeId} onChange={(event) => onAssigneeChange(task.id, event.target.value)}>{staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
            <select aria-label={`Progress for ${taskLabels[task.kind]}`} className={`task-status task-status-${task.status}`} value={pendingBlocked[task.id] ? "blocked" : task.status} onChange={(event) => changeStatus(task, event.target.value as TaskStatus)}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </article>;
        })}
      </div>}
      {error && <p className="form-error global-error" role="alert">{error}</p>}
    </section>
  );
}
