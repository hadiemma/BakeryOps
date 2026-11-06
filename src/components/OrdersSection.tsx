"use client";

import { useState, type FormEvent } from "react";
import { productLabels, recipes } from "@/data/seed";
import type { BakeryOrder, OrderLine, OrderStatus, ProductId } from "@/domain/types";

const statusLabels: Record<OrderStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  planned: "Planned",
  inProduction: "In production",
  waitingForProductionConfirmation: "Awaiting production confirmation",
  readyForDelivery: "Ready for delivery",
  waitingForDeliveryConfirmation: "Awaiting delivery confirmation",
  delivered: "Delivered",
  waitingForClosureApproval: "Awaiting closure approval",
  closed: "Closed",
  complete: "Complete",
  needsAttention: "Needs attention",
};

interface OrderDraft {
  id?: string;
  customerName: string;
  dueAt: string;
  note: string;
  items: OrderLine[];
}

interface OrdersSectionProps {
  orders: BakeryOrder[];
  onSave: (order: BakeryOrder) => void;
  onStatusChange: (orderId: string, status: OrderStatus) => void;
  onDelete?: (orderId: string) => Promise<void> | void;
  onConfirmProduction?: (orderId: string) => Promise<void> | void;
  onConfirmDelivery?: (orderId: string) => Promise<void> | void;
  onCloseOrder?: (orderId: string) => Promise<void> | void;
}

const blankDraft = (): OrderDraft => ({ customerName: "", dueAt: "10:00", note: "", items: [{ productId: "sourdough", quantity: 4 }] });

export function OrdersSection({
  orders,
  onSave,
  onStatusChange,
  onDelete,
  onConfirmProduction,
  onConfirmDelivery,
  onCloseOrder,
}: OrdersSectionProps) {
  const [draft, setDraft] = useState<OrderDraft | null>(null);
  const [error, setError] = useState("");
  const [orderToDelete, setOrderToDelete] = useState<BakeryOrder | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [filterTab, setFilterTab] = useState<"active" | "closed" | "all">("active");

  const sortedOrders = [...orders].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const filteredOrders = sortedOrders.filter((o) => {
    if (filterTab === "active") return o.status !== "closed";
    if (filterTab === "closed") return o.status === "closed";
    return true;
  });

  function startEdit(order?: BakeryOrder) {
    setError("");
    setDraft(order
      ? { id: order.id, customerName: order.customerName, dueAt: order.dueAt, note: order.note ?? "", items: order.items.map((item) => ({ ...item })) }
      : blankDraft());
  }

  function updateItem(index: number, update: Partial<OrderLine>) {
    if (!draft) return;
    setDraft({ ...draft, items: draft.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...update } : item) });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft?.customerName.trim()) return setError("Enter a customer name.");
    if (!draft.items.length || draft.items.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1)) {
      return setError("Add at least one product and use a positive whole-number quantity.");
    }
    onSave({
      id: draft.id ?? `order-${crypto.randomUUID()}`,
      customerName: draft.customerName.trim(),
      dueAt: draft.dueAt,
      note: draft.note.trim() || undefined,
      items: draft.items,
      status: draft.id ? orders.find((order) => order.id === draft.id)?.status ?? "submitted" : "submitted",
    });
    setDraft(null);
  }

  async function handleConfirmDelete() {
    if (!orderToDelete || !onDelete) return;
    setDeleteSubmitting(true);
    setDeleteError("");
    try {
      await onDelete(orderToDelete.id);
      setOrderToDelete(null);
    } catch (err: any) {
      setDeleteError(err?.message || "Failed to delete order. Please try again.");
    } finally {
      setDeleteSubmitting(false);
    }
  }

  return (
    <section className="panel workflow-panel" id="orders">
      <div className="panel-heading">
        <div>
          <h2>Today’s orders</h2>
          <p>Create, edit, track and manage incoming customer bakery orders</p>
        </div>
        <button className="small-primary" onClick={() => startEdit()}>＋ New order</button>
      </div>

      <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
        <button
          type="button"
          className={filterTab === "active" ? "small-primary" : "text-action"}
          onClick={() => setFilterTab("active")}
        >
          Active Orders ({orders.filter((o) => o.status !== "closed").length})
        </button>
        <button
          type="button"
          className={filterTab === "closed" ? "small-primary" : "text-action"}
          onClick={() => setFilterTab("closed")}
        >
          Closed / Archival ({orders.filter((o) => o.status === "closed").length})
        </button>
        <button
          type="button"
          className={filterTab === "all" ? "small-primary" : "text-action"}
          onClick={() => setFilterTab("all")}
        >
          All ({orders.length})
        </button>
      </div>

      {filteredOrders.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">▤</span>
          <strong>No orders yet</strong>
          <span>Add an order to start the shift production workflow.</span>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="workflow-table">
            <thead>
              <tr>
                <th>Customer / Products</th>
                <th>Due Time</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <strong>{order.customerName}</strong>
                    <span className="table-subline">
                      {order.items
                        .map((item) => `${item.quantity} ${recipes[item.productId]?.yieldUnit || ""} ${productLabels[item.productId] || item.productId}`)
                        .join(" · ")}
                    </span>
                    {order.note && <span className="table-note">Note: {order.note}</span>}
                  </td>
                  <td>
                    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.9rem", color: "var(--text-primary)" }}>
                      {order.dueAt}
                    </span>
                  </td>
                  <td>
                    <select
                      aria-label={`Status for ${order.customerName}`}
                      className="compact-select"
                      value={order.status}
                      onChange={(event) => onStatusChange(order.id, event.target.value as OrderStatus)}
                    >
                      {Object.entries(statusLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                      {order.status === "waitingForProductionConfirmation" && onConfirmProduction && (
                        <button
                          className="small-primary"
                          style={{ fontSize: "0.75rem", padding: "4px 8px", backgroundColor: "#d97706" }}
                          onClick={() => onConfirmProduction(order.id)}
                          title="Confirm production complete and deduct ingredients"
                        >
                          Confirm Production
                        </button>
                      )}
                      {(order.status === "readyForDelivery" || order.status === "waitingForDeliveryConfirmation") && onConfirmDelivery && (
                        <button
                          className="small-primary"
                          style={{ fontSize: "0.75rem", padding: "4px 8px", backgroundColor: "#0284c7" }}
                          onClick={() => onConfirmDelivery(order.id)}
                          title="Confirm order delivered to customer"
                        >
                          Confirm Delivered
                        </button>
                      )}
                      {(order.status === "delivered" || order.status === "waitingForClosureApproval") && onCloseOrder && (
                        <button
                          className="small-primary"
                          style={{ fontSize: "0.75rem", padding: "4px 8px", backgroundColor: "#16a34a" }}
                          onClick={() => onCloseOrder(order.id)}
                          title="Close order and clear from active roster"
                        >
                          Close Order
                        </button>
                      )}
                      <button className="text-action" onClick={() => startEdit(order)}>
                        Edit
                      </button>
                      <button
                        className="text-action"
                        style={{ color: "var(--accent-rose)" }}
                        onClick={() => {
                          setDeleteError("");
                          setOrderToDelete(order);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit / Create Order Modal */}
      {draft && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDraft(null);
          }}
        >
          <form className="modal-card" role="dialog" aria-modal="true" aria-labelledby="order-form-title" onSubmit={submit}>
            <div className="modal-heading">
              <div>
                <h3 id="order-form-title">{draft.id ? "Edit Order" : "Create New Order"}</h3>
                <p>Specify the customer request and required quantities for this shift.</p>
              </div>
              <button type="button" className="close-button" aria-label="Close" onClick={() => setDraft(null)}>×</button>
            </div>

            <label className="field-label">
              Customer name
              <input
                autoFocus
                value={draft.customerName}
                onChange={(event) => setDraft({ ...draft, customerName: event.target.value })}
                placeholder="e.g. Greenleaf Café"
              />
            </label>

            <label className="field-label">
              Due time
              <input
                type="time"
                value={draft.dueAt}
                onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })}
                required
              />
            </label>

            <div className="field-label">
              Products
              {draft.items.map((item, index) => (
                <div className="order-line-editor" key={index}>
                  <select
                    aria-label="Product"
                    value={item.productId}
                    onChange={(event) => updateItem(index, { productId: event.target.value as ProductId })}
                  >
                    {Object.entries(productLabels).map(([id, label]) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </select>
                  <input
                    aria-label="Quantity"
                    type="number"
                    min="1"
                    step="1"
                    value={item.quantity}
                    onChange={(event) => updateItem(index, { quantity: Number(event.target.value) })}
                  />
                  <button
                    type="button"
                    className="remove-line"
                    aria-label="Remove product"
                    disabled={draft.items.length === 1}
                    onClick={() => setDraft({ ...draft, items: draft.items.filter((_, itemIndex) => itemIndex !== index) })}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="text-action add-line"
                onClick={() => setDraft({ ...draft, items: [...draft.items, { productId: "sourdough", quantity: 1 }] })}
              >
                ＋ Add product
              </button>
            </div>

            <label className="field-label">
              Special instructions / Note <span className="optional-label">optional</span>
              <textarea
                rows={2}
                value={draft.note}
                onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                placeholder="Packing or delivery instructions"
              />
            </label>

            {error && <p className="form-error" role="alert">{error}</p>}

            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setDraft(null)}>Cancel</button>
              <button className="small-primary" type="submit">{draft.id ? "Save Changes" : "Create Order"}</button>
            </div>
          </form>
        </div>
      )}

      {/* Confirmation Dialog for Delete Order */}
      {orderToDelete && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deleteSubmitting) setOrderToDelete(null);
          }}
        >
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="delete-order-dialog-title" style={{ maxWidth: "460px" }}>
            <div className="modal-heading">
              <div>
                <h3 id="delete-order-dialog-title" style={{ color: "var(--accent-rose)" }}>Delete Order</h3>
                <p>Are you sure you want to delete this order?</p>
              </div>
              <button
                type="button"
                className="close-button"
                aria-label="Close"
                disabled={deleteSubmitting}
                onClick={() => setOrderToDelete(null)}
              >
                ×
              </button>
            </div>

            <div style={{ padding: "14px 0", fontSize: "0.92rem", color: "var(--text-secondary)" }}>
              <p style={{ margin: "0 0 8px 0" }}>
                <strong style={{ color: "var(--text-primary)" }}>Customer:</strong> {orderToDelete.customerName}
              </p>
              <p style={{ margin: "0 0 8px 0" }}>
                <strong style={{ color: "var(--text-primary)" }}>Due time:</strong> {orderToDelete.dueAt}
              </p>
              <p style={{ margin: 0 }}>
                <strong style={{ color: "var(--text-primary)" }}>Items:</strong>{" "}
                {orderToDelete.items
                  .map((item) => `${item.quantity} ${recipes[item.productId]?.yieldUnit || ""} ${productLabels[item.productId] || item.productId}`)
                  .join(", ")}
              </p>
              {orderToDelete.note && (
                <p style={{ margin: "8px 0 0 0", fontStyle: "italic", color: "var(--accent-amber)" }}>
                  Note: {orderToDelete.note}
                </p>
              )}
            </div>

            {deleteError && (
              <p className="form-error" role="alert" style={{ marginBottom: "12px" }}>
                {deleteError}
              </p>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={deleteSubmitting}
                onClick={() => setOrderToDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="small-primary"
                style={{
                  background: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
                  boxShadow: "0 2px 10px rgba(239, 68, 68, 0.4)",
                  color: "#ffffff",
                }}
                disabled={deleteSubmitting}
                onClick={handleConfirmDelete}
              >
                {deleteSubmitting ? "Deleting..." : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
