"use client";

import { useEffect, useState, useRef, useMemo, type FormEvent } from "react";
import type { Ingredient, InventoryAdjustment, StockStatus } from "@/domain/types";

const COMMON_UNITS = ["g", "ml", "kg", "l", "units", "pcs", "boxes"];

const ADJUSTMENT_REASONS = [
  "Supplier delivery / Purchase",
  "Production batch usage",
  "Physical inventory count correction",
  "Spillage / Waste / Expired",
  "Customer sample / Tasting",
  "Other / Custom adjustment",
];

export function InventoryManagementSection() {
  const [inventory, setInventory] = useState<Ingredient[]>([]);
  const [adjustments, setAdjustments] = useState<InventoryAdjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | "inStock" | "lowStock" | "outOfStock" | "archived">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showHistoryInMain, setShowHistoryInMain] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Dedicated Edit Inventory Modal
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<"items" | "add" | "history">("items");

  // Adjust Stock sub-state inside modal
  const [adjustingItem, setAdjustingItem] = useState<Ingredient | null>(null);
  const [adjustMode, setAdjustMode] = useState<"increase" | "decrease">("increase");
  const [adjustAmount, setAdjustAmount] = useState<string>("");
  const [adjustReason, setAdjustReason] = useState<string>(ADJUSTMENT_REASONS[0]);
  const [customReason, setCustomReason] = useState<string>("");
  const [adjustActor, setAdjustActor] = useState<string>("Hadi Shanavas (Human Manager)");
  const [adjustSubmitting, setAdjustSubmitting] = useState(false);

  // Add Item sub-state inside modal
  const [addName, setAddName] = useState("");
  const [addUnit, setAddUnit] = useState("g");
  const [addCustomUnit, setAddCustomUnit] = useState("");
  const [addOnHand, setAddOnHand] = useState<string>("0");
  const [addReorderAt, setAddReorderAt] = useState<string>("500");
  const [addSubmitting, setAddSubmitting] = useState(false);

  // Edit Item Details sub-state inside modal
  const [editingItem, setEditingItem] = useState<Ingredient | null>(null);
  const [editName, setEditName] = useState("");
  const [editUnit, setEditUnit] = useState("g");
  const [editCustomUnit, setEditCustomUnit] = useState("");
  const [editOnHand, setEditOnHand] = useState<string>("0");
  const [editReorderAt, setEditReorderAt] = useState<string>("500");
  const [editSubmitting, setEditSubmitting] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);

  const fetchInventoryData = async () => {
    try {
      const res = await fetch("/api/inventory?includeArchived=true&history=true");
      if (res.ok) {
        const data = await res.json();
        setInventory(Array.isArray(data.inventory) ? data.inventory : []);
        setAdjustments(Array.isArray(data.adjustments) ? data.adjustments : []);
      }
    } catch {
      // ignore transient fetch errors
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInventoryData();

    if (typeof window !== "undefined" && window.EventSource) {
      try {
        const es = new EventSource("/api/collaboration/events");
        eventSourceRef.current = es;
        es.addEventListener("inventory_updated", () => {
          fetchInventoryData();
        });
      } catch {}
    }

    const interval = setInterval(fetchInventoryData, 4000);
    return () => {
      clearInterval(interval);
      if (eventSourceRef.current) eventSourceRef.current.close();
    };
  }, []);

  const showNotification = (text: string, type: "success" | "error" = "success") => {
    setFeedback({ text, type });
    setTimeout(() => {
      setFeedback(null);
    }, 4500);
  };

  // Metrics
  const metrics = useMemo(() => {
    const active = inventory.filter((i) => !i.archived);
    const inStock = active.filter((i) => (i.status || "inStock") === "inStock").length;
    const lowStock = active.filter((i) => (i.status || "inStock") === "lowStock").length;
    const outOfStock = active.filter((i) => (i.status || "inStock") === "outOfStock").length;
    const archived = inventory.filter((i) => i.archived).length;
    return { total: active.length, inStock, lowStock, outOfStock, archived };
  }, [inventory]);

  // Filtered Items for main view
  const filteredInventory = useMemo(() => {
    return inventory.filter((item) => {
      if (statusFilter === "archived") {
        if (!item.archived) return false;
      } else {
        if (item.archived) return false;
        if (statusFilter !== "all" && item.status !== statusFilter) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q);
      }
      return true;
    });
  }, [inventory, statusFilter, searchQuery]);

  // Handlers for dedicated Edit Modal
  const startAdjustStock = (item: Ingredient, mode: "increase" | "decrease") => {
    setAdjustingItem(item);
    setAdjustMode(mode);
    setAdjustAmount("");
    setAdjustReason(mode === "increase" ? ADJUSTMENT_REASONS[0] : ADJUSTMENT_REASONS[1]);
    setCustomReason("");
    setEditingItem(null);
  };

  const cancelAdjustStock = () => {
    setAdjustingItem(null);
    setAdjustAmount("");
  };

  const handleApplyAdjustment = async (e: FormEvent) => {
    e.preventDefault();
    if (!adjustingItem) return;

    const parsedAmount = parseFloat(adjustAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      showNotification("Please specify a positive numerical adjustment amount.", "error");
      return;
    }

    const signedAmount = adjustMode === "increase" ? parsedAmount : -parsedAmount;
    const effectiveReason =
      adjustReason === "Other / Custom adjustment" && customReason.trim()
        ? customReason.trim()
        : adjustReason;

    setAdjustSubmitting(true);
    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "adjust",
          ingredientId: adjustingItem.id,
          adjustmentAmount: signedAmount,
          reason: effectiveReason,
          performedBy: adjustActor || "Hadi Shanavas (Human Manager)",
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to adjust stock");
      }

      const data = await res.json();
      showNotification(
        `Direct adjustment saved: ${adjustingItem.name} ${signedAmount > 0 ? "+" : ""}${signedAmount} ${adjustingItem.baseUnit} (New total: ${data.ingredient.onHand} ${data.ingredient.baseUnit})`,
        "success"
      );
      setAdjustingItem(null);
      await fetchInventoryData();
    } catch (err: any) {
      showNotification(err.message, "error");
    } finally {
      setAdjustSubmitting(false);
    }
  };

  const startEditDetails = (item: Ingredient) => {
    setEditingItem(item);
    setEditName(item.name);
    if (COMMON_UNITS.includes(item.baseUnit)) {
      setEditUnit(item.baseUnit);
      setEditCustomUnit("");
    } else {
      setEditUnit("custom");
      setEditCustomUnit(item.baseUnit);
    }
    setEditOnHand(item.onHand.toString());
    setEditReorderAt(item.reorderAt.toString());
    setAdjustingItem(null);
  };

  const cancelEditDetails = () => {
    setEditingItem(null);
  };

  const handleSaveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;

    const unit = editUnit === "custom" ? editCustomUnit.trim() : editUnit;
    if (!editName.trim() || !unit) {
      showNotification("Name and measurement unit are required.", "error");
      return;
    }

    const onHand = parseFloat(editOnHand);
    const reorderAt = parseFloat(editReorderAt);

    setEditSubmitting(true);
    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "edit",
          id: editingItem.id,
          updates: {
            name: editName.trim(),
            baseUnit: unit,
            onHand: isNaN(onHand) ? editingItem.onHand : onHand,
            reorderAt: isNaN(reorderAt) ? editingItem.reorderAt : reorderAt,
          },
          performedBy: adjustActor,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update item");
      }

      showNotification(`Updated ${editName.trim()} details successfully.`, "success");
      setEditingItem(null);
      await fetchInventoryData();
    } catch (err: any) {
      showNotification(err.message, "error");
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleAddNewItem = async (e: FormEvent) => {
    e.preventDefault();
    const unit = addUnit === "custom" ? addCustomUnit.trim() : addUnit;
    if (!addName.trim() || !unit) {
      showNotification("Ingredient name and measurement unit are required.", "error");
      return;
    }

    const onHand = parseFloat(addOnHand) || 0;
    const reorderAt = parseFloat(addReorderAt) || 0;

    setAddSubmitting(true);
    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          item: {
            name: addName.trim(),
            baseUnit: unit,
            onHand,
            reorderAt,
          },
          performedBy: adjustActor,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to add ingredient");
      }

      showNotification(`Added "${addName.trim()}" to inventory.`, "success");
      setAddName("");
      setAddOnHand("0");
      setAddReorderAt("500");
      setModalTab("items");
      await fetchInventoryData();
    } catch (err: any) {
      showNotification(err.message, "error");
    } finally {
      setAddSubmitting(false);
    }
  };

  const handleToggleArchive = async (item: Ingredient) => {
    const isArchiving = !item.archived;
    const confirmText = isArchiving
      ? `Are you sure you want to archive "${item.name}"? Historical adjustment records will be preserved.`
      : `Restore "${item.name}" to active inventory?`;

    if (!window.confirm(confirmText)) return;

    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "archive",
          id: item.id,
          archived: isArchiving,
          performedBy: adjustActor,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update archive status");
      }

      showNotification(
        isArchiving ? `Archived "${item.name}".` : `Restored "${item.name}" to active inventory.`,
        "success"
      );
      await fetchInventoryData();
    } catch (err: any) {
      showNotification(err.message, "error");
    }
  };

  const handleSeedStandard = async () => {
    if (
      inventory.length > 0 &&
      !window.confirm("Standard bakery ingredients will be loaded into operational inventory. Continue?")
    ) {
      return;
    }

    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "seed_standard", performedBy: adjustActor }),
      });

      if (!res.ok) throw new Error("Failed to load standard ingredients");
      showNotification("Loaded standard bakery ingredients successfully.", "success");
      await fetchInventoryData();
    } catch (err: any) {
      showNotification(err.message, "error");
    }
  };

  const closeEditModal = () => {
    setIsEditModalOpen(false);
    setAdjustingItem(null);
    setEditingItem(null);
    fetchInventoryData();
  };

  return (
    <section className="panel workflow-panel" id="inventory" style={{ marginTop: "24px" }}>
      {/* 1. Normal Inventory Section Header */}
      <div className="panel-heading" style={{ flexWrap: "wrap", gap: "12px", alignItems: "center" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "1.4rem" }}>🌾</span>
            <h2 style={{ margin: 0 }}>Inventory</h2>
          </div>
          <p style={{ margin: "4px 0 0 0", color: "#64748b", fontSize: "0.85rem" }}>
            Live ingredient stock levels and threshold monitoring
          </p>
        </div>

        {/* Clearly Visible Edit Inventory Button */}
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button
            type="button"
            onClick={() => {
              setIsEditModalOpen(true);
              setModalTab("items");
            }}
            className="primary-button"
            style={{
              fontSize: "0.88rem",
              padding: "8px 18px",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: "6px",
              cursor: "pointer",
              background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)", color: "#070a12", borderRadius: "10px", border: "none", boxShadow: "0 4px 14px rgba(245, 158, 11, 0.35)",
            }}
          >
            <span>✏️</span> Edit Inventory
          </button>
        </div>
      </div>

      {/* Global Feedback Notifications */}
      {feedback && (
        <div
          style={{
            margin: "12px 0",
            padding: "10px 14px",
            borderRadius: "6px",
            fontSize: "0.88rem",
            fontWeight: 500,
            background: feedback.type === "success" ? "#ecfdf5" : "#fef2f2",
            border: `1px solid ${feedback.type === "success" ? "rgba(16, 185, 129, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
            color: feedback.type === "success" ? "#065f46" : "#991b1b",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>{feedback.text}</span>
          <button
            onClick={() => setFeedback(null)}
            style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "1rem", color: "inherit" }}
          >
            ×
          </button>
        </div>
      )}

      {/* 2. Normal View: Metrics Chips */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "14px",
          margin: "18px 0 22px",
        }}
      >
        <div
          onClick={() => setStatusFilter("all")}
          style={{
            padding: "16px",
            borderRadius: "12px",
            background: "linear-gradient(180deg, var(--bg-panel-elevated) 0%, var(--bg-panel) 100%)",
            border: statusFilter === "all" ? "2px solid #38bdf8" : "1px solid var(--border-subtle)",
            boxShadow: statusFilter === "all" ? "0 0 16px rgba(56, 189, 248, 0.25)" : "var(--shadow-card)",
            cursor: "pointer",
            textAlign: "left",
            transition: "all 0.2s ease",
          }}
        >
          <div style={{ fontSize: "0.82rem", color: "var(--text-secondary)", fontWeight: 600, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>All Active</span>
            <span style={{ fontSize: "0.85rem", color: "#38bdf8" }}>▤</span>
          </div>
          <div style={{ fontSize: "1.7rem", fontWeight: 800, color: "var(--text-primary)", fontFamily: "Manrope, sans-serif", margin: "8px 0 2px" }}>
            {metrics.total}
          </div>
          <div style={{ fontSize: "0.76rem", color: "var(--text-muted)" }}>Total tracked items</div>
        </div>

        <div
          onClick={() => setStatusFilter("inStock")}
          style={{
            padding: "16px",
            borderRadius: "12px",
            background: "linear-gradient(180deg, var(--bg-panel-elevated) 0%, var(--bg-panel) 100%)",
            border: statusFilter === "inStock" ? "2px solid #38bdf8" : "1px solid var(--border-subtle)",
            boxShadow: statusFilter === "inStock" ? "0 0 16px rgba(56, 189, 248, 0.25)" : "var(--shadow-card)",
            cursor: "pointer",
            textAlign: "left",
            transition: "all 0.2s ease",
          }}
        >
          <div style={{ fontSize: "0.82rem", color: "var(--text-secondary)", fontWeight: 600, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>In Stock</span>
            <span style={{ fontSize: "0.85rem", color: "#10b981" }}>🟢</span>
          </div>
          <div style={{ fontSize: "1.7rem", fontWeight: 800, color: "var(--text-primary)", fontFamily: "Manrope, sans-serif", margin: "8px 0 2px" }}>
            {metrics.inStock}
          </div>
          <div style={{ fontSize: "0.76rem", color: "#10b981" }}>Healthy stock supply</div>
        </div>

        <div
          onClick={() => setStatusFilter("lowStock")}
          style={{
            padding: "16px",
            borderRadius: "12px",
            background: "linear-gradient(180deg, var(--bg-panel-elevated) 0%, var(--bg-panel) 100%)",
            border: statusFilter === "lowStock" ? "2px solid #38bdf8" : "1px solid var(--border-subtle)",
            boxShadow: statusFilter === "lowStock" ? "0 0 16px rgba(56, 189, 248, 0.25)" : "var(--shadow-card)",
            cursor: "pointer",
            textAlign: "left",
            transition: "all 0.2s ease",
          }}
        >
          <div style={{ fontSize: "0.82rem", color: "var(--text-secondary)", fontWeight: 600, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Low Stock</span>
            <span style={{ fontSize: "0.85rem", color: "#f59e0b" }}>🟡</span>
          </div>
          <div style={{ fontSize: "1.7rem", fontWeight: 800, color: "var(--text-primary)", fontFamily: "Manrope, sans-serif", margin: "8px 0 2px" }}>
            {metrics.lowStock}
          </div>
          <div style={{ fontSize: "0.76rem", color: "#f59e0b" }}>Below reorder threshold</div>
        </div>

        <div
          onClick={() => setStatusFilter("outOfStock")}
          style={{
            padding: "16px",
            borderRadius: "12px",
            background: "linear-gradient(180deg, var(--bg-panel-elevated) 0%, var(--bg-panel) 100%)",
            border: statusFilter === "outOfStock" ? "2px solid #38bdf8" : "1px solid var(--border-subtle)",
            boxShadow: statusFilter === "outOfStock" ? "0 0 16px rgba(56, 189, 248, 0.25)" : "var(--shadow-card)",
            cursor: "pointer",
            textAlign: "left",
            transition: "all 0.2s ease",
          }}
        >
          <div style={{ fontSize: "0.82rem", color: "var(--text-secondary)", fontWeight: 600, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Out of Stock</span>
            <span style={{ fontSize: "0.85rem", color: "#ef4444" }}>🔴</span>
          </div>
          <div style={{ fontSize: "1.7rem", fontWeight: 800, color: "var(--text-primary)", fontFamily: "Manrope, sans-serif", margin: "8px 0 2px" }}>
            {metrics.outOfStock}
          </div>
          <div style={{ fontSize: "0.76rem", color: "#ef4444" }}>Requires reorder</div>
        </div>

        {metrics.archived > 0 && (
          <div
            onClick={() => setStatusFilter("archived")}
            style={{
              padding: "16px",
              borderRadius: "12px",
              background: "linear-gradient(180deg, var(--bg-panel-elevated) 0%, var(--bg-panel) 100%)",
              border: statusFilter === "archived" ? "2px solid #38bdf8" : "1px solid var(--border-subtle)",
              boxShadow: statusFilter === "archived" ? "0 0 16px rgba(56, 189, 248, 0.25)" : "var(--shadow-card)",
              cursor: "pointer",
              textAlign: "left",
              transition: "all 0.2s ease",
            }}
          >
            <div style={{ fontSize: "0.82rem", color: "var(--text-secondary)", fontWeight: 600, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Archived</span>
              <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>📦</span>
            </div>
            <div style={{ fontSize: "1.7rem", fontWeight: 800, color: "var(--text-primary)", fontFamily: "Manrope, sans-serif", margin: "8px 0 2px" }}>
              {metrics.archived}
            </div>
            <div style={{ fontSize: "0.76rem", color: "var(--text-muted)" }}>Historical items</div>
          </div>
        )}
      </div>

      {/* Filter and Search Bar in normal view */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
          marginBottom: "14px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            type="text"
            placeholder="Search ingredients..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: "8px 14px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.12)", background: "#080d19", color: "#f8fafc", fontSize: "0.85rem", width: "240px", outline: "none",
            }}
          />
          {statusFilter !== "all" && (
            <button
              onClick={() => setStatusFilter("all")}
              style={{
                background: "#080d19", border: "1px solid rgba(255, 255, 255, 0.12)", color: "#f8fafc",
                borderRadius: "4px",
                padding: "4px 8px",
                fontSize: "0.75rem",
                cursor: "pointer",
              }}
            >
              Reset filter
            </button>
          )}
        </div>

        <div style={{ fontSize: "0.82rem", color: "#64748b" }}>
          Showing <strong>{filteredInventory.length}</strong> items
        </div>
      </div>

      {/* 3. Normal View: Clean Inventory Table */}
      {filteredInventory.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "40px 20px",
            background: "#090e1a",
            borderRadius: "8px",
            border: "1px dashed rgba(255, 255, 255, 0.15)",
          }}
        >
          <div style={{ fontSize: "2rem", marginBottom: "8px" }}>🌾</div>
          <h3 style={{ margin: "0 0 6px 0", color: "#cbd5e1" }}>
            {inventory.length === 0
              ? "No inventory items configured."
              : "No items match your active filter."}
          </h3>
          <p style={{ color: "#64748b", fontSize: "0.85rem", margin: "0 0 16px 0" }}>
            {inventory.length === 0
              ? "Open the inventory editor to add raw ingredients or load bakery presets."
              : "Try clearing your search query or resetting filters."}
          </p>
          <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
            <button
              onClick={() => {
                setIsEditModalOpen(true);
                setModalTab("items");
              }}
              className="primary-button"
              style={{ fontSize: "0.85rem" }}
            >
              ✏️ Edit Inventory
            </button>
          </div>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.88rem" }}>
            <thead>
              <tr style={{ background: "#090e1a", borderBottom: "2px solid rgba(255, 255, 255, 0.08)" }}>
                <th style={{ padding: "10px 12px", color: "#94a3b8", fontWeight: 700 }}>Ingredient Name</th>
                <th style={{ padding: "10px 12px", color: "#94a3b8", fontWeight: 700 }}>Current Stock</th>
                <th style={{ padding: "10px 12px", color: "#94a3b8", fontWeight: 700 }}>Unit</th>
                <th style={{ padding: "10px 12px", color: "#94a3b8", fontWeight: 700 }}>Reorder Threshold</th>
                <th style={{ padding: "10px 12px", color: "#94a3b8", fontWeight: 700 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredInventory.map((item) => {
                const isOutOfStock = item.onHand <= 0;
                const isLowStock = !isOutOfStock && item.onHand <= item.reorderAt;

                return (
                  <tr
                    key={item.id}
                    style={{
                      borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
                      background: item.archived ? "rgba(0, 0, 0, 0.3)" : "transparent",
                    }}
                  >
                    <td style={{ padding: "12px", fontWeight: 600, color: "#f8fafc" }}>
                      <div>{item.name}</div>
                      <div style={{ fontSize: "0.72rem", color: "#94a3b8" }}>ID: {item.id}</div>
                    </td>
                    <td style={{ padding: "12px" }}>
                      <span
                        style={{
                          fontSize: "1.15rem",
                          fontWeight: 800,
                          color: isOutOfStock ? "#dc2626" : isLowStock ? "#d97706" : "#059669",
                        }}
                      >
                        {item.onHand.toLocaleString()}
                      </span>
                    </td>
                    <td style={{ padding: "12px" }}>
                      <span
                        style={{
                          padding: "2px 6px",
                          borderRadius: "4px",
                          background: "rgba(255, 255, 255, 0.05)",
                          color: "#94a3b8",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                        }}
                      >
                        {item.baseUnit}
                      </span>
                    </td>
                    <td style={{ padding: "12px", color: "#94a3b8" }}>
                      {item.reorderAt.toLocaleString()} {item.baseUnit}
                    </td>
                    <td style={{ padding: "12px" }}>
                      {item.archived ? (
                        <span
                          style={{
                            padding: "3px 8px",
                            borderRadius: "12px",
                            background: "rgba(255, 255, 255, 0.05)",
                            color: "#64748b",
                            fontSize: "0.75rem",
                            fontWeight: 700,
                          }}
                        >
                          📦 Archived
                        </span>
                      ) : isOutOfStock ? (
                        <span
                          style={{
                            padding: "3px 8px",
                            borderRadius: "12px",
                            background: "rgba(239, 68, 68, 0.18)",
                            color: "#f87171",
                            fontSize: "0.75rem",
                            fontWeight: 700,
                          }}
                        >
                          🔴 Out of Stock
                        </span>
                      ) : isLowStock ? (
                        <span
                          style={{
                            padding: "3px 8px",
                            borderRadius: "12px",
                            background: "rgba(245, 158, 11, 0.16)",
                            color: "#fbbf24",
                            fontSize: "0.75rem",
                            fontWeight: 700,
                          }}
                        >
                          🟡 Low Stock
                        </span>
                      ) : (
                        <span
                          style={{
                            padding: "3px 8px",
                            borderRadius: "12px",
                            background: "rgba(16, 185, 129, 0.16)",
                            color: "#34d399",
                            fontSize: "0.75rem",
                            fontWeight: 700,
                          }}
                        >
                          🟢 In Stock
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Optional History Log Toggle in normal view */}
      {adjustments.length > 0 && (
        <div style={{ marginTop: "16px", borderTop: "1px solid #f1f5f9", paddingTop: "12px" }}>
          <button
            type="button"
            onClick={() => setShowHistoryInMain(!showHistoryInMain)}
            style={{
              background: "transparent",
              border: "none",
              color: "#2563eb",
              fontWeight: 600,
              fontSize: "0.82rem",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <span>{showHistoryInMain ? "▼ Hide" : "▶ View"}</span> Recent Stock Adjustment Log ({adjustments.length})
          </button>

          {showHistoryInMain && (
            <div style={{ marginTop: "10px", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ background: "#090e1a", borderBottom: "1px solid rgba(255, 255, 255, 0.08)" }}>
                    <th style={{ padding: "8px 10px", color: "#94a3b8" }}>Date/Time</th>
                    <th style={{ padding: "8px 10px", color: "#94a3b8" }}>Ingredient</th>
                    <th style={{ padding: "8px 10px", color: "#94a3b8" }}>Previous</th>
                    <th style={{ padding: "8px 10px", color: "#94a3b8" }}>Adjustment</th>
                    <th style={{ padding: "8px 10px", color: "#94a3b8" }}>New Stock</th>
                    <th style={{ padding: "8px 10px", color: "#94a3b8" }}>Reason</th>
                    <th style={{ padding: "8px 10px", color: "#94a3b8" }}>Logged By</th>
                  </tr>
                </thead>
                <tbody>
                  {adjustments.slice(0, 10).map((adj) => (
                    <tr key={adj.id} style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}>
                      <td style={{ padding: "8px 10px", color: "#64748b", whiteSpace: "nowrap" }}>
                        {new Date(adj.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td style={{ padding: "8px 10px", fontWeight: 600, color: "#f8fafc" }}>
                        {adj.ingredientName}
                      </td>
                      <td style={{ padding: "8px 10px", color: "#64748b" }}>
                        {adj.previousQuantity} {adj.unit}
                      </td>
                      <td style={{ padding: "8px 10px", fontWeight: 700, color: adj.adjustmentAmount > 0 ? "#059669" : "#dc2626" }}>
                        {adj.adjustmentAmount > 0 ? `+${adj.adjustmentAmount}` : adj.adjustmentAmount} {adj.unit}
                      </td>
                      <td style={{ padding: "8px 10px", fontWeight: 700, color: "#f8fafc" }}>
                        {adj.newQuantity} {adj.unit}
                      </td>
                      <td style={{ padding: "8px 10px", color: "#94a3b8" }}>
                        {adj.reason}
                      </td>
                      <td style={{ padding: "8px 10px", color: "#64748b" }}>
                        {adj.performedBy}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* 4. DEDICATED INVENTORY EDITING MODAL / WINDOW */}
      {/* ============================================================ */}
      {isEditModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="inventory-modal-title"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(4, 7, 16, 0.82)", backdropFilter: "blur(12px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "16px",
          }}
        >
          <div
            style={{
              background: "#0f172a",
              borderRadius: "12px",
              width: "100%",
              maxWidth: "960px",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 25px 60px -15px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.1)",
              overflow: "hidden",
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "#090e1a",
              }}
            >
              <div>
                <h3 id="inventory-modal-title" style={{ margin: "0 0 2px 0", fontSize: "1.2rem", color: "#f8fafc" }}>
                  🌾 Edit Inventory & Stock Management
                </h3>
                <p style={{ margin: 0, fontSize: "0.82rem", color: "#64748b" }}>
                  Direct manager control — update quantities, add items, modify thresholds, or archive ingredients.
                </p>
              </div>
              <button
                type="button"
                onClick={closeEditModal}
                style={{
                  background: "rgba(255, 255, 255, 0.08)",
                  border: "none",
                  borderRadius: "6px",
                  padding: "6px 14px",
                  fontSize: "0.85rem",
                  fontWeight: 700,
                  color: "#cbd5e1",
                  cursor: "pointer",
                }}
              >
                ✕ Close
              </button>
            </div>

            {/* Modal Navigation Tabs */}
            <div
              style={{
                display: "flex",
                padding: "8px 20px",
                background: "rgba(255, 255, 255, 0.05)",
                borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                gap: "8px",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setModalTab("items");
                  setAdjustingItem(null);
                  setEditingItem(null);
                }}
                style={{
                  padding: "6px 14px",
                  borderRadius: "6px",
                  border: "none",
                  fontWeight: 700,
                  fontSize: "0.85rem",
                  cursor: "pointer",
                  background: modalTab === "items" ? "#0f172a" : "transparent",
                  color: modalTab === "items" ? "#070a12" : "#94a3b8",
                }}
              >
                📋 Manage Items & Stock ({inventory.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setModalTab("add");
                  setAdjustingItem(null);
                  setEditingItem(null);
                }}
                style={{
                  padding: "6px 14px",
                  borderRadius: "6px",
                  border: "none",
                  fontWeight: 700,
                  fontSize: "0.85rem",
                  cursor: "pointer",
                  background: modalTab === "add" ? "#0f172a" : "transparent",
                  color: modalTab === "add" ? "#070a12" : "#94a3b8",
                }}
              >
                ＋ Add New Ingredient
              </button>
              <button
                type="button"
                onClick={() => {
                  setModalTab("history");
                  setAdjustingItem(null);
                  setEditingItem(null);
                }}
                style={{
                  padding: "6px 14px",
                  borderRadius: "6px",
                  border: "none",
                  fontWeight: 700,
                  fontSize: "0.85rem",
                  cursor: "pointer",
                  background: modalTab === "history" ? "#0f172a" : "transparent",
                  color: modalTab === "history" ? "#070a12" : "#94a3b8",
                }}
              >
                📜 Adjustment History ({adjustments.length})
              </button>
            </div>

            {/* Modal Body Container */}
            <div style={{ padding: "20px", overflowY: "auto", flex: 1 }}>

              {/* SUB-VIEW 1: MANAGE ITEMS & STOCK */}
              {modalTab === "items" && (
                <div>
                  {/* Inline Stock Adjustment Drawer */}
                  {adjustingItem && (
                    <div
                      style={{
                        padding: "16px",
                        borderRadius: "8px",
                        background: adjustMode === "increase" ? "#ecfdf5" : "#fffbeb",
                        border: `1px solid ${adjustMode === "increase" ? "#a7f3d0" : "#fde68a"}`,
                        marginBottom: "16px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                        <strong style={{ fontSize: "0.95rem", color: "#f8fafc" }}>
                          {adjustMode === "increase" ? "＋ Increase Stock" : "− Reduce Stock"}: {adjustingItem.name}
                        </strong>
                        <span style={{ fontSize: "0.82rem", color: "#64748b" }}>
                          Current on-hand: <strong>{adjustingItem.onHand} {adjustingItem.baseUnit}</strong>
                        </span>
                      </div>

                      <form onSubmit={handleApplyAdjustment}>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "12px" }}>
                          <div>
                            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#94a3b8", marginBottom: "4px" }}>
                              Amount ({adjustingItem.baseUnit}) *
                            </label>
                            <input
                              type="number"
                              step="any"
                              min="0.01"
                              required
                              value={adjustAmount}
                              onChange={(e) => setAdjustAmount(e.target.value)}
                              placeholder="e.g. 5000"
                              style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid rgba(255, 255, 255, 0.12)" }}
                            />
                          </div>

                          <div>
                            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#94a3b8", marginBottom: "4px" }}>
                              Reason for Adjustment *
                            </label>
                            <select
                              value={adjustReason}
                              onChange={(e) => setAdjustReason(e.target.value)}
                              style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid rgba(255, 255, 255, 0.12)" }}
                            >
                              {ADJUSTMENT_REASONS.map((r) => (
                                <option key={r} value={r}>{r}</option>
                              ))}
                            </select>
                          </div>

                          {adjustReason === "Other / Custom adjustment" && (
                            <div>
                              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#94a3b8", marginBottom: "4px" }}>
                                Custom Reason Note *
                              </label>
                              <input
                                type="text"
                                required
                                value={customReason}
                                onChange={(e) => setCustomReason(e.target.value)}
                                placeholder="Specify operational reason"
                                style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid rgba(255, 255, 255, 0.12)" }}
                              />
                            </div>
                          )}

                          <div>
                            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#94a3b8", marginBottom: "4px" }}>
                              Recorded By
                            </label>
                            <input
                              type="text"
                              value={adjustActor}
                              onChange={(e) => setAdjustActor(e.target.value)}
                              style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid rgba(255, 255, 255, 0.12)" }}
                            />
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            onClick={cancelAdjustStock}
                            style={{ padding: "6px 14px", borderRadius: "6px", border: "1px solid rgba(255, 255, 255, 0.12)", background: "#0f172a", cursor: "pointer" }}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={adjustSubmitting}
                            style={{
                              padding: "6px 16px",
                              borderRadius: "6px",
                              border: "none",
                              background: adjustMode === "increase" ? "#059669" : "#d97706",
                              color: "#ffffff",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            {adjustSubmitting ? "Saving..." : adjustMode === "increase" ? "Apply Stock Increase" : "Apply Stock Deduction"}
                          </button>
                        </div>
                      </form>
                    </div>
                  )}

                  {/* Inline Item Details Editor */}
                  {editingItem && (
                    <div
                      style={{
                        padding: "16px",
                        borderRadius: "8px",
                        background: "#090e1a",
                        border: "1px solid rgba(255, 255, 255, 0.12)",
                        marginBottom: "16px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                        <strong style={{ fontSize: "0.95rem", color: "#f8fafc" }}>
                          ✏️ Edit Item Details: {editingItem.name}
                        </strong>
                        <span style={{ fontSize: "0.78rem", color: "#94a3b8" }}>ID: {editingItem.id}</span>
                      </div>

                      <form onSubmit={handleSaveEdit}>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "12px" }}>
                          <div>
                            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#94a3b8", marginBottom: "4px" }}>
                              Ingredient Name *
                            </label>
                            <input
                              type="text"
                              required
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid rgba(255, 255, 255, 0.12)" }}
                            />
                          </div>

                          <div>
                            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#94a3b8", marginBottom: "4px" }}>
                              Measurement Unit *
                            </label>
                            <select
                              value={editUnit}
                              onChange={(e) => setEditUnit(e.target.value)}
                              style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid rgba(255, 255, 255, 0.12)" }}
                            >
                              {COMMON_UNITS.map((u) => (
                                <option key={u} value={u}>{u}</option>
                              ))}
                              <option value="custom">Custom...</option>
                            </select>
                          </div>

                          {editUnit === "custom" && (
                            <div>
                              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#94a3b8", marginBottom: "4px" }}>
                                Custom Unit *
                              </label>
                              <input
                                type="text"
                                required
                                value={editCustomUnit}
                                onChange={(e) => setEditCustomUnit(e.target.value)}
                                style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid rgba(255, 255, 255, 0.12)" }}
                              />
                            </div>
                          )}

                          <div>
                            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#94a3b8", marginBottom: "4px" }}>
                              On-Hand Quantity
                            </label>
                            <input
                              type="number"
                              step="any"
                              value={editOnHand}
                              onChange={(e) => setEditOnHand(e.target.value)}
                              style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid rgba(255, 255, 255, 0.12)" }}
                            />
                          </div>

                          <div>
                            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#94a3b8", marginBottom: "4px" }}>
                              Reorder Alert Threshold
                            </label>
                            <input
                              type="number"
                              step="any"
                              value={editReorderAt}
                              onChange={(e) => setEditReorderAt(e.target.value)}
                              style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid rgba(255, 255, 255, 0.12)" }}
                            />
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            onClick={cancelEditDetails}
                            style={{ padding: "6px 14px", borderRadius: "6px", border: "1px solid rgba(255, 255, 255, 0.12)", background: "#0f172a", cursor: "pointer" }}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={editSubmitting}
                            style={{
                              padding: "6px 16px",
                              borderRadius: "6px",
                              border: "none",
                              background: "#2563eb",
                              color: "#ffffff",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            {editSubmitting ? "Saving..." : "Save Changes"}
                          </button>
                        </div>
                      </form>
                    </div>
                  )}

                  {/* Items List inside Modal with Quick Actions */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <div style={{ fontSize: "0.85rem", color: "#64748b" }}>
                      Select an item below to adjust quantities, edit specifications, or archive.
                    </div>
                    {inventory.length === 0 && (
                      <button
                        type="button"
                        onClick={handleSeedStandard}
                        style={{ padding: "5px 12px", borderRadius: "6px", border: "1px solid rgba(255, 255, 255, 0.12)", background: "#090e1a", fontSize: "0.8rem", cursor: "pointer" }}
                      >
                        📥 Load Standard Presets
                      </button>
                    )}
                  </div>

                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                    <thead>
                      <tr style={{ background: "#090e1a", borderBottom: "2px solid rgba(255, 255, 255, 0.08)", textAlign: "left" }}>
                        <th style={{ padding: "8px 10px", color: "#94a3b8" }}>Ingredient</th>
                        <th style={{ padding: "8px 10px", color: "#94a3b8" }}>On Hand</th>
                        <th style={{ padding: "8px 10px", color: "#94a3b8" }}>Threshold</th>
                        <th style={{ padding: "8px 10px", color: "#94a3b8" }}>Status</th>
                        <th style={{ padding: "8px 10px", color: "#94a3b8", textAlign: "right" }}>Controls</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inventory.map((item) => (
                        <tr key={item.id} style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.06)", background: item.archived ? "rgba(0, 0, 0, 0.3)" : "transparent" }}>
                          <td style={{ padding: "10px", fontWeight: 600, color: "#f8fafc" }}>
                            {item.name}
                            <div style={{ fontSize: "0.72rem", color: "#94a3b8" }}>{item.id}</div>
                          </td>
                          <td style={{ padding: "10px", fontWeight: 700, color: item.onHand <= item.reorderAt ? "#d97706" : "#059669" }}>
                            {item.onHand.toLocaleString()} {item.baseUnit}
                          </td>
                          <td style={{ padding: "10px", color: "#64748b" }}>
                            {item.reorderAt.toLocaleString()} {item.baseUnit}
                          </td>
                          <td style={{ padding: "10px" }}>
                            {item.archived ? (
                              <span style={{ fontSize: "0.75rem", color: "#64748b" }}>Archived</span>
                            ) : item.onHand <= 0 ? (
                              <span style={{ fontSize: "0.75rem", color: "#f87171", fontWeight: 700 }}>Out of Stock</span>
                            ) : item.onHand <= item.reorderAt ? (
                              <span style={{ fontSize: "0.75rem", color: "#f59e0b", fontWeight: 700 }}>Low Stock</span>
                            ) : (
                              <span style={{ fontSize: "0.75rem", color: "#10b981", fontWeight: 700 }}>In Stock</span>
                            )}
                          </td>
                          <td style={{ padding: "10px", textAlign: "right" }}>
                            <div style={{ display: "inline-flex", gap: "6px" }}>
                              {!item.archived && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => startAdjustStock(item, "increase")}
                                    style={{
                                      padding: "4px 8px",
                                      borderRadius: "4px",
                                      border: "1px solid #10b981",
                                      background: "rgba(16, 185, 129, 0.12)",
                                      color: "#34d399",
                                      fontSize: "0.78rem",
                                      fontWeight: 700,
                                      cursor: "pointer",
                                    }}
                                  >
                                    ＋ Add Stock
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => startAdjustStock(item, "decrease")}
                                    style={{
                                      padding: "4px 8px",
                                      borderRadius: "4px",
                                      border: "1px solid #f59e0b",
                                      background: "rgba(245, 158, 11, 0.12)",
                                      color: "#fbbf24",
                                      fontSize: "0.78rem",
                                      fontWeight: 700,
                                      cursor: "pointer",
                                    }}
                                  >
                                    − Reduce
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => startEditDetails(item)}
                                    style={{
                                      padding: "4px 8px",
                                      borderRadius: "4px",
                                      border: "1px solid rgba(255, 255, 255, 0.12)",
                                      background: "#0f172a",
                                      color: "#cbd5e1",
                                      fontSize: "0.78rem",
                                      cursor: "pointer",
                                    }}
                                  >
                                    ✏ Edit
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                onClick={() => handleToggleArchive(item)}
                                style={{
                                  padding: "4px 8px",
                                  borderRadius: "4px",
                                  border: "1px solid rgba(255, 255, 255, 0.12)",
                                  background: "#090e1a",
                                  color: "#64748b",
                                  fontSize: "0.78rem",
                                  cursor: "pointer",
                                }}
                              >
                                {item.archived ? "↺ Restore" : "📦 Archive"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* SUB-VIEW 2: ADD NEW INGREDIENT */}
              {modalTab === "add" && (
                <div style={{ maxWidth: "500px", margin: "0 auto" }}>
                  <h4 style={{ margin: "0 0 12px 0", fontSize: "1rem", color: "#f8fafc" }}>
                    Add New Ingredient to Inventory
                  </h4>
                  <form onSubmit={handleAddNewItem}>
                    <div style={{ display: "grid", gap: "12px", marginBottom: "16px" }}>
                      <div>
                        <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "#94a3b8", marginBottom: "4px" }}>
                          Ingredient Name *
                        </label>
                        <input
                          type="text"
                          required
                          value={addName}
                          onChange={(e) => setAddName(e.target.value)}
                          placeholder="e.g. Organic Almond Flour"
                          style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid rgba(255, 255, 255, 0.12)" }}
                        />
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                        <div>
                          <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "#94a3b8", marginBottom: "4px" }}>
                            Measurement Unit *
                          </label>
                          <select
                            value={addUnit}
                            onChange={(e) => setAddUnit(e.target.value)}
                            style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid rgba(255, 255, 255, 0.12)" }}
                          >
                            {COMMON_UNITS.map((u) => (
                              <option key={u} value={u}>{u}</option>
                            ))}
                            <option value="custom">Custom...</option>
                          </select>
                        </div>

                        {addUnit === "custom" && (
                          <div>
                            <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "#94a3b8", marginBottom: "4px" }}>
                              Custom Unit *
                            </label>
                            <input
                              type="text"
                              required
                              value={addCustomUnit}
                              onChange={(e) => setAddCustomUnit(e.target.value)}
                              placeholder="e.g. bags"
                              style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid rgba(255, 255, 255, 0.12)" }}
                            />
                          </div>
                        )}
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                        <div>
                          <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "#94a3b8", marginBottom: "4px" }}>
                            Initial Stock On-Hand
                          </label>
                          <input
                            type="number"
                            step="any"
                            value={addOnHand}
                            onChange={(e) => setAddOnHand(e.target.value)}
                            style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid rgba(255, 255, 255, 0.12)" }}
                          />
                        </div>

                        <div>
                          <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "#94a3b8", marginBottom: "4px" }}>
                            Reorder Alert Threshold
                          </label>
                          <input
                            type="number"
                            step="any"
                            value={addReorderAt}
                            onChange={(e) => setAddReorderAt(e.target.value)}
                            style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid rgba(255, 255, 255, 0.12)" }}
                          />
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        onClick={() => setModalTab("items")}
                        style={{ padding: "8px 16px", borderRadius: "6px", border: "1px solid rgba(255, 255, 255, 0.12)", background: "#0f172a", cursor: "pointer" }}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={addSubmitting}
                        style={{
                          padding: "8px 18px",
                          borderRadius: "6px",
                          border: "none",
                          background: "#2563eb",
                          color: "#ffffff",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        {addSubmitting ? "Adding..." : "Add to Inventory"}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* SUB-VIEW 3: ADJUSTMENT HISTORY */}
              {modalTab === "history" && (
                <div>
                  <h4 style={{ margin: "0 0 12px 0", fontSize: "1rem", color: "#f8fafc" }}>
                    Stock Adjustment Audit History
                  </h4>
                  {adjustments.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "30px 20px", color: "#64748b" }}>
                      No stock adjustments recorded yet.
                    </div>
                  ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                      <thead>
                        <tr style={{ background: "#090e1a", borderBottom: "1px solid rgba(255, 255, 255, 0.08)", textAlign: "left" }}>
                          <th style={{ padding: "8px 10px", color: "#94a3b8" }}>Date/Time</th>
                          <th style={{ padding: "8px 10px", color: "#94a3b8" }}>Ingredient</th>
                          <th style={{ padding: "8px 10px", color: "#94a3b8" }}>Previous</th>
                          <th style={{ padding: "8px 10px", color: "#94a3b8" }}>Change</th>
                          <th style={{ padding: "8px 10px", color: "#94a3b8" }}>New Total</th>
                          <th style={{ padding: "8px 10px", color: "#94a3b8" }}>Reason</th>
                          <th style={{ padding: "8px 10px", color: "#94a3b8" }}>Logged By</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adjustments.map((adj) => (
                          <tr key={adj.id} style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}>
                            <td style={{ padding: "8px 10px", color: "#64748b", whiteSpace: "nowrap" }}>
                              {new Date(adj.createdAt).toLocaleString()}
                            </td>
                            <td style={{ padding: "8px 10px", fontWeight: 600, color: "#f8fafc" }}>
                              {adj.ingredientName}
                            </td>
                            <td style={{ padding: "8px 10px", color: "#64748b" }}>
                              {adj.previousQuantity} {adj.unit}
                            </td>
                            <td style={{ padding: "8px 10px", fontWeight: 700, color: adj.adjustmentAmount > 0 ? "#059669" : "#dc2626" }}>
                              {adj.adjustmentAmount > 0 ? `+${adj.adjustmentAmount}` : adj.adjustmentAmount} {adj.unit}
                            </td>
                            <td style={{ padding: "8px 10px", fontWeight: 700, color: "#f8fafc" }}>
                              {adj.newQuantity} {adj.unit}
                            </td>
                            <td style={{ padding: "8px 10px", color: "#94a3b8" }}>
                              {adj.reason}
                            </td>
                            <td style={{ padding: "8px 10px", color: "#64748b" }}>
                              {adj.performedBy}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: "12px 20px",
                borderTop: "1px solid rgba(255, 255, 255, 0.08)",
                display: "flex",
                justifyContent: "flex-end",
                background: "#090e1a",
              }}
            >
              <button
                type="button"
                onClick={closeEditModal}
                style={{
                  padding: "8px 20px",
                  borderRadius: "6px",
                  border: "none",
                  background: "#0f172a",
                  color: "#ffffff",
                  fontWeight: 700,
                  fontSize: "0.88rem",
                  cursor: "pointer",
                }}
              >
                Done / Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
