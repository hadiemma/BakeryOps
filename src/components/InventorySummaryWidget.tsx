"use client";

import { useEffect, useState, useMemo } from "react";
import type { Ingredient } from "@/domain/types";

export function InventorySummaryWidget() {
  const [inventory, setInventory] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const fetchInventory = async () => {
      try {
        const res = await fetch("/api/inventory?includeArchived=false");
        if (res.ok && isMounted) {
          const data = await res.json();
          setInventory(Array.isArray(data.inventory) ? data.inventory : []);
        }
      } catch {
        // ignore transient errors
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchInventory();
    const interval = setInterval(fetchInventory, 5000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const metrics = useMemo(() => {
    const active = inventory.filter((i) => !i.archived);
    const inStock = active.filter((i) => (i.status || "inStock") === "inStock").length;
    const lowStock = active.filter((i) => (i.status || "inStock") === "lowStock").length;
    const outOfStock = active.filter((i) => (i.status || "inStock") === "outOfStock").length;
    const lowStockItems = active.filter((i) => (i.status || "inStock") === "lowStock" || (i.status || "inStock") === "outOfStock");
    return { total: active.length, inStock, lowStock, outOfStock, lowStockItems };
  }, [inventory]);

  return (
    <section className="panel workflow-panel" id="inventory-summary">
      <div className="panel-heading">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "1.3rem" }}>🌾</span>
            <h2 style={{ margin: 0 }}>Inventory Overview</h2>
          </div>
          <p style={{ margin: "4px 0 0 0", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
            Stock health and reorder thresholds summary
          </p>
        </div>
        <a
          href="/inventory"
          className="small-primary"
          style={{ textDecoration: "none" }}
        >
          <span>🌾</span> Open Full Inventory →
        </a>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "12px",
          margin: "14px 0 16px",
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            borderRadius: "12px",
            background: "linear-gradient(180deg, var(--bg-panel-elevated) 0%, var(--bg-panel) 100%)",
            border: "1px solid var(--border-subtle)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", fontWeight: 600 }}>Total Items</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--text-primary)", fontFamily: "Manrope, sans-serif", margin: "4px 0 2px" }}>
            {loading ? "..." : metrics.total}
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Active ingredients</div>
        </div>

        <div
          style={{
            padding: "14px 16px",
            borderRadius: "12px",
            background: "linear-gradient(180deg, var(--bg-panel-elevated) 0%, var(--bg-panel) 100%)",
            border: "1px solid var(--border-subtle)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", fontWeight: 600 }}>🟢 In Stock</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#34d399", fontFamily: "Manrope, sans-serif", margin: "4px 0 2px" }}>
            {loading ? "..." : metrics.inStock}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#10b981" }}>Healthy stock</div>
        </div>

        <div
          style={{
            padding: "14px 16px",
            borderRadius: "12px",
            background: "linear-gradient(180deg, var(--bg-panel-elevated) 0%, var(--bg-panel) 100%)",
            border: "1px solid var(--border-subtle)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", fontWeight: 600 }}>🟡 Low Stock</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#fbbf24", fontFamily: "Manrope, sans-serif", margin: "4px 0 2px" }}>
            {loading ? "..." : metrics.lowStock}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#f59e0b" }}>Needs attention</div>
        </div>

        <div
          style={{
            padding: "14px 16px",
            borderRadius: "12px",
            background: "linear-gradient(180deg, var(--bg-panel-elevated) 0%, var(--bg-panel) 100%)",
            border: "1px solid var(--border-subtle)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", fontWeight: 600 }}>🔴 Out of Stock</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#f87171", fontFamily: "Manrope, sans-serif", margin: "4px 0 2px" }}>
            {loading ? "..." : metrics.outOfStock}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#ef4444" }}>Critical reorder</div>
        </div>
      </div>

      {metrics.lowStockItems.length > 0 && (
        <div
          style={{
            background: "rgba(245, 158, 11, 0.08)",
            border: "1px solid rgba(245, 158, 11, 0.25)",
            borderRadius: "10px",
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "10px",
            fontSize: "0.86rem",
          }}
        >
          <div style={{ color: "#fcd34d", display: "flex", alignItems: "center", gap: "8px" }}>
            <span>⚠️</span>
            <span>
              <strong>Reorder notice:</strong> {metrics.lowStockItems.map((i) => `${i.name} (${i.onHand} ${i.baseUnit} / min ${i.reorderAt} ${i.baseUnit})`).join(", ")}
            </span>
          </div>
          <a
            href="/inventory"
            style={{
              color: "var(--accent-amber)",
              textDecoration: "none",
              fontWeight: 700,
              fontSize: "0.84rem",
            }}
          >
            Review in Inventory →
          </a>
        </div>
      )}
    </section>
  );
}
