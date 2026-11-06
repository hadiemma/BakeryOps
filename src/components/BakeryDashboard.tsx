"use client";

import { useMemo, useState, useEffect } from "react";
import { ingredients, recipes, staff } from "@/data/seed";
import type { BakeryOrder, OrderStatus, ProductId, TaskStatus } from "@/domain/types";
import {
  approveProductionPlan,
  generateProductionPlan,
  generateTasksForPlan,
  invalidatePlanApproval,
  requestPlanChanges,
  updateTaskStatus,
} from "@/domain/workflow";
import { useBakeryState } from "@/lib/use-bakery-state";
import { OrdersSection } from "./OrdersSection";
import { ProductionPlanSection } from "./ProductionPlanSection";
import { TasksSection } from "./TasksSection";
import { InventorySummaryWidget } from "./InventorySummaryWidget";

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function orderStatusForTasks(statuses: TaskStatus[]): OrderStatus {
  if (statuses.includes("blocked")) return "needsAttention";
  if (statuses.length > 0 && statuses.every((status) => status === "done")) return "complete";
  if (statuses.some((status) => status === "inProgress" || status === "done")) return "inProduction";
  return "planned";
}

export function BakeryDashboard() {
  const { state, setState, ready } = useBakeryState();
  const [workflowError, setWorkflowError] = useState("");
  const plan = state.plans.at(-1);

  const [currentDate, setCurrentDate] = useState(() =>
    new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    })
  );

  useEffect(() => {
    const update = () =>
      setCurrentDate(
        new Date().toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      );
    const timer = setInterval(update, 60000);
    return () => clearInterval(timer);
  }, []);

  const productByBatch = useMemo(() => {
    const result: Record<string, ProductId> = {};
    for (const savedPlan of state.plans) for (const batch of savedPlan.batches) result[batch.id] = batch.productId;
    return result;
  }, [state.plans]);

  async function saveOrder(order: BakeryOrder) {
    setWorkflowError("");
    try {
      const res = await fetch("/api/operational-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_order", order }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to persist order to server");
      }
    } catch (err: any) {
      setWorkflowError(err?.message || "Failed to save order");
      return;
    }

    setState((previous) => {
      const exists = previous.orders.some((item) => item.id === order.id);
      const oldOrder = previous.orders.find((item) => item.id === order.id);
      const savedOrder = oldOrder && oldOrder.status !== "complete" ? { ...order, status: "submitted" as const } : order;
      return {
        ...previous,
        orders: exists ? previous.orders.map((item) => item.id === order.id ? savedOrder : item) : [...previous.orders, savedOrder],
        plans: previous.plans.map((savedPlan, index) => index === previous.plans.length - 1
          ? invalidatePlanApproval(savedPlan, "Order details changed in the bakery dashboard.")
          : savedPlan),
      };
    });
  }

  async function confirmProductionCompletion(orderId: string) {
    setWorkflowError("");
    try {
      const res = await fetch("/api/operational-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm_production_completion", orderId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to confirm production completion");
      }
      const data = await res.json();
      setState((prev) => ({
        ...prev,
        orders: prev.orders.map((o) => (o.id === orderId ? data.order : o)),
      }));
    } catch (err: any) {
      setWorkflowError(err?.message || "Failed to confirm production");
    }
  }

  async function confirmDelivery(orderId: string) {
    setWorkflowError("");
    try {
      const res = await fetch("/api/operational-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm_delivery", orderId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to confirm delivery");
      }
      const data = await res.json();
      setState((prev) => ({
        ...prev,
        orders: prev.orders.map((o) => (o.id === orderId ? data.order : o)),
      }));
    } catch (err: any) {
      setWorkflowError(err?.message || "Failed to confirm delivery");
    }
  }

  async function closeOrder(orderId: string) {
    setWorkflowError("");
    try {
      const res = await fetch("/api/operational-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close_order", orderId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to close order");
      }
      const data = await res.json();
      setState((prev) => ({
        ...prev,
        orders: prev.orders.map((o) => (o.id === orderId ? data.order : o)),
      }));
    } catch (err: any) {
      setWorkflowError(err?.message || "Failed to close order");
    }
  }

  function changeOrderStatus(orderId: string, status: OrderStatus) {
    setState((previous) => ({
      ...previous,
      orders: previous.orders.map((order) => order.id === orderId ? { ...order, status } : order),
      plans: previous.plans.map((savedPlan, index) => index === previous.plans.length - 1
        ? invalidatePlanApproval(savedPlan, "Order status changed in the bakery dashboard.")
        : savedPlan),
    }));
  }

  async function deleteOrder(orderId: string) {
    setWorkflowError("");
    const res = await fetch("/api/operational-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_order", orderId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to delete order from server");
    }

    setState((previous) => {
      const remainingOrders = previous.orders.filter((order) => order.id !== orderId);
      const updatedPlans = previous.plans
        .map((savedPlan, index) => {
          if (!savedPlan.orderIds.includes(orderId)) return savedPlan;
          const remainingPlanOrders = savedPlan.orderIds.filter((id) => id !== orderId);
          if (remainingPlanOrders.length === 0) return null;
          const updated = { ...savedPlan, orderIds: remainingPlanOrders };
          return index === previous.plans.length - 1
            ? invalidatePlanApproval(updated, "An order associated with this plan was deleted.")
            : updated;
        })
        .filter((p) => p !== null);

      const updatedTasks = previous.tasks
        .map((task) => {
          if (!task.orderIds.includes(orderId)) return task;
          const remainingTaskOrders = task.orderIds.filter((id) => id !== orderId);
          if (remainingTaskOrders.length === 0) return null;
          return { ...task, orderIds: remainingTaskOrders };
        })
        .filter((t) => t !== null);

      return {
        ...previous,
        orders: remainingOrders,
        plans: updatedPlans,
        tasks: updatedTasks,
      };
    });
  }

  function generatePlan() {
    setWorkflowError("");
    try {
      const nextRevision = (state.plans.at(-1)?.revision ?? 0) + 1;
      const nextPlan = generateProductionPlan(state.orders, recipes, ingredients, staff, {
        id: createId("plan"),
        revision: nextRevision,
        createdAt: new Date().toISOString(),
      });
      setState((previous) => ({
        ...previous,
        plans: [...previous.plans.filter((item) => item.id !== nextPlan.id), nextPlan],
      }));
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "Could not generate a production plan.");
    }
  }

  async function approvePlan() {
    if (!plan) return;
    setWorkflowError("");
    try {
      await fetch("/api/operational-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve_plan",
          planId: plan.id,
          approvedBy: "Hadi Shanavas",
        }),
      });
      const approved = approveProductionPlan(plan, "Hadi Shanavas", new Date().toISOString());
      const updatedPlans = state.plans.map((item) => item.id === approved.id ? approved : item);
      const generatedTasks = generateTasksForPlan(updatedPlans, staff);
      setState((previous) => ({
        ...previous,
        plans: updatedPlans,
        tasks: [...previous.tasks.filter((task) => task.planId !== approved.id), ...generatedTasks],
        orders: previous.orders.map((order) => approved.orderIds.includes(order.id) ? { ...order, status: "planned" } : order),
      }));
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "Could not approve the production plan.");
    }
  }

  function sendChangeRequest(note: string) {
    if (!plan) return;
    setWorkflowError("");
    try {
      const updated = requestPlanChanges(plan, note);
      setState((previous) => ({
        ...previous,
        plans: previous.plans.map((item) => item.id === updated.id ? updated : item),
        orders: previous.orders.map((order) => updated.orderIds.includes(order.id) && order.status !== "complete"
          ? { ...order, status: "needsAttention" }
          : order),
      }));
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "Could not request changes.");
    }
  }

  function updateTaskAssignee(taskId: string, assigneeId: string) {
    fetch("/api/operational-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_task_assignee", taskId, assigneeId }),
    }).catch(() => {});
    setState((previous) => ({ ...previous, tasks: previous.tasks.map((task) => task.id === taskId ? { ...task, assigneeId } : task) }));
  }

  function updateTask(taskId: string, status: TaskStatus, blockerNote?: string) {
    setWorkflowError("");
    try {
      fetch("/api/operational-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_task_status", taskId, status, blockerNote }),
      }).catch(() => {});
      setState((previous) => {
        const tasks = previous.tasks.map((task) => task.id === taskId ? updateTaskStatus(task, status, blockerNote) : task);
        const currentPlan = previous.plans.at(-1);
        const planTasks = currentPlan ? tasks.filter((task) => task.planId === currentPlan.id) : [];
        const plans = currentPlan && planTasks.length
          ? previous.plans.map((item) => item.id === currentPlan.id
            ? { ...item, status: planTasks.every((task) => task.status === "done") ? "complete" as const : planTasks.some((task) => task.status === "inProgress" || task.status === "done" || task.status === "blocked") ? "inProgress" as const : "approved" as const }
            : item)
          : previous.plans;
        const orders = previous.orders.map((order) => {
          const related = currentPlan ? tasks.filter((task) => task.planId === currentPlan.id && task.orderIds.includes(order.id)) : [];
          return related.length ? { ...order, status: orderStatusForTasks(related.map((task) => task.status)) } : order;
        });
        return { ...previous, tasks, plans, orders };
      });
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "Could not update the task.");
    }
  }

  const activeOrders = state.orders.filter((order) => order.status !== "complete").length;
  const ordersOnPlan = plan?.orderIds.length ?? 0;
  const planLabel = plan?.isStale ? "Needs refresh" : plan ? ({ proposed: "Needs approval", changesRequested: "Changes requested", approved: "Approved", inProgress: "In progress", complete: "Complete" } as const)[plan.status] : "Not planned";
  const taskProductMap = productByBatch;
  const planCanShowTasks = !!plan && !plan.isStale && ["approved", "inProgress", "complete"].includes(plan.status);
  const activeTasks = planCanShowTasks ? state.tasks.filter((task) => task.planId === plan?.id) : [];
  const activeCompletedTasks = activeTasks.filter((task) => task.status === "done").length;

  return (
    <main className="app-shell" aria-busy={!ready}>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="BakeryOps home">
          <span className="brand-mark">B</span>
          <span>Bakery<span className="brand-light">Ops</span><small>OPERATIONS</small></span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <div className="workspace-switcher">
          <span className="workspace-avatar">B</span>
          <span>BakeryOps<small>Daily Operations</small></span>
          <span className="chevron">⌄</span>
        </div>
        <nav className="primary-nav" aria-label="Main navigation">
          <a className="nav-link active" href="/"><span className="nav-icon">◫</span>Dashboard</a>
          <a className="nav-link" href="#orders"><span className="nav-icon">▤</span>Orders<span className="nav-count">{activeOrders}</span></a>
          <a className="nav-link" href="#production-plan"><span className="nav-icon">◷</span>Production</a>
          <a className="nav-link" href="/inventory"><span className="nav-icon">🌾</span>Inventory</a>
          <a className="nav-link" href="#staff-tasks"><span className="nav-icon">☷</span>Staff tasks</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="profile">
            <span className="profile-avatar">HS</span>
            <span><strong>Hadi Shanavas</strong><small>Shift manager</small></span>
          </div>
        </div>
      </aside>

      <section className="main-panel" id="overview">
        <header className="topbar">
          <div className="breadcrumbs">BakeryOps <span>/</span> <strong>Dashboard</strong></div>
          <div className="top-actions">
            <span className="today-label">{currentDate}</span>
            <span className="live-status-badge">● Live Shift Online</span>
          </div>
        </header>

        <div className="page-content">
          <div className="welcome-row">
            <div>
              <div className="eyebrow"><span className="live-dot" /> LIVE SHIFT OVERVIEW</div>
              <h1>Good morning, Hadi <span className="wave">✳</span></h1>
              <p className="subtitle">Orders, ingredients, production and staff progress in one place.</p>
            </div>
            <a className="primary-button" href="#orders">＋ <span>New order</span></a>
          </div>

          <section className="stats-grid" aria-label="Shift summary">
            <article className="stat-card">
              <div className="stat-top"><span>Active orders</span><span className="stat-icon blue">▤</span></div>
              <div className="stat-value">{activeOrders}<span className="stat-context"> orders</span></div>
              <div className="stat-foot">{state.orders.length} total shift orders</div>
            </article>
            <article className="stat-card">
              <div className="stat-top"><span>Production plan</span><span className="stat-icon amber">◷</span></div>
              <div className="stat-value stat-value-small">{planLabel}</div>
              <div className="stat-foot">{ordersOnPlan ? `${ordersOnPlan} orders in latest proposal` : "Generate a plan from submitted orders"}</div>
            </article>
            <article className="stat-card">
              <div className="stat-top"><span>Tasks completed</span><span className="stat-icon green">✓</span></div>
              <div className="stat-value">{activeCompletedTasks}<span className="stat-context"> / {activeTasks.length}</span></div>
              <div className="progress-track"><span style={{ width: `${activeTasks.length ? activeCompletedTasks / activeTasks.length * 100 : 0}%` }} /></div>
              <div className="stat-foot">Progress updates save automatically</div>
            </article>
            <article className="stat-card">
              <div className="stat-top"><span>Team on shift</span><span className="stat-icon violet">♙</span></div>
              <div className="stat-value">{staff.length}<span className="stat-context"> people</span></div>
              <div className="avatar-stack">
                <span className="mini-avatar a1">H</span>
                <span className="mini-avatar a2">R</span>
                <span className="mini-avatar a3">J</span>
                <span className="avatar-label">Bakers & packers</span>
              </div>
            </article>
          </section>

          <OrdersSection
            orders={state.orders}
            onSave={saveOrder}
            onStatusChange={changeOrderStatus}
            onDelete={deleteOrder}
            onConfirmProduction={confirmProductionCompletion}
            onConfirmDelivery={confirmDelivery}
            onCloseOrder={closeOrder}
          />
          <ProductionPlanSection
            plan={plan}
            orders={state.orders}
            error={workflowError}
            onGenerate={generatePlan}
            onApprove={approvePlan}
            onRequestChanges={sendChangeRequest}
          />
          <InventorySummaryWidget />
          <TasksSection
            tasks={activeTasks}
            orders={state.orders}
            staff={staff}
            productByBatch={taskProductMap}
            error={workflowError}
            onAssigneeChange={updateTaskAssignee}
            onStatusChange={updateTask}
          />

          <section className="panel team-panel">
            <div className="panel-heading">
              <div><h2>Your team</h2><p>People scheduled for the morning shift</p></div>
            </div>
            <div className="team-grid">
              {staff.map((person) => (
                <article className="team-member" key={person.id}>
                  <span className={`team-avatar ${person.role}`}>
                    {person.name.split(" ").map((part) => part[0]).join("")}
                  </span>
                  <div className="team-info">
                    <strong>{person.name}</strong>
                    <span>{person.role === "manager" ? "Shift lead" : person.role === "baker" ? "Baker" : "Packer"}</span>
                  </div>
                  <span className="availability"><i /> On shift</span>
                  <span className="shift-time">{person.availableFrom}–{person.availableUntil}</span>
                </article>
              ))}
            </div>
          </section>

          <footer className="footer-note">
            <span>✳</span> Plans are rule-based. Your people stay in control. <a href="#production-plan">Review the proposal <span>→</span></a>
          </footer>
        </div>
      </section>
    </main>
  );
}
