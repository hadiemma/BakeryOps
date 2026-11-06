"use client";

import { useEffect, useState } from "react";
import { InventoryManagementSection } from "@/components/InventoryManagementSection";
import { useBakeryState } from "@/lib/use-bakery-state";

export default function InventoryPage() {
  const { state } = useBakeryState();
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

  const activeOrders = state.orders.filter((order) => order.status !== "complete").length;

  return (
    <main className="app-shell">
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
          <a className="nav-link" href="/"><span className="nav-icon">◫</span>Dashboard</a>
          <a className="nav-link" href="/#orders"><span className="nav-icon">▤</span>Orders<span className="nav-count">{activeOrders}</span></a>
          <a className="nav-link" href="/#production-plan"><span className="nav-icon">◷</span>Production</a>
          <a className="nav-link active" href="/inventory"><span className="nav-icon">🌾</span>Inventory</a>
          <a className="nav-link" href="/#staff-tasks"><span className="nav-icon">☷</span>Staff tasks</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="profile">
            <span className="profile-avatar">HS</span>
            <span><strong>Hadi Shanavas</strong><small>Shift manager</small></span>
          </div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs">BakeryOps <span>/</span> <strong>Inventory</strong></div>
          <div className="top-actions">
            <span className="today-label">{currentDate}</span>
            <span className="live-status-badge">● Live Shift Online</span>
          </div>
        </header>

        <div className="page-content">
          <div className="welcome-row">
            <div>
              <div className="eyebrow"><span className="live-dot" /> OPERATIONAL INVENTORY</div>
              <h1>Inventory & Stock Management</h1>
              <p className="subtitle">Authoritative ingredient stock levels, reorder thresholds, and adjustment audit history.</p>
            </div>
            <a className="secondary-button" href="/" style={{ textDecoration: "none" }}>← Return to Dashboard</a>
          </div>

          <InventoryManagementSection />
        </div>
      </section>
    </main>
  );
}
