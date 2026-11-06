"use client";

import { useEffect, useState, useRef } from "react";
import type { BakeryState } from "@/domain/types";
import { clearBakeryState, createDemoState, loadBakeryState, saveBakeryState } from "./persistence";

export function useBakeryState() {
  const [state, setState] = useState<BakeryState>(createDemoState);
  const [ready, setReady] = useState(false);
  const initialSyncDone = useRef(false);

  useEffect(() => {
    // Clean old demo state if present
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem("bakeryops-ai-state-v1");
      } catch {}
    }

    const cached = loadBakeryState();
    setState(cached);
    setReady(true);

    fetch("/api/operational-data")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setState({
            orders: Array.isArray(data.orders) ? data.orders : [],
            plans: Array.isArray(data.plans) ? data.plans : [],
            tasks: Array.isArray(data.tasks) ? data.tasks : [],
          });
        }
        initialSyncDone.current = true;
      })
      .catch(() => {
        initialSyncDone.current = true;
      });
  }, []);

  useEffect(() => {
    if (!ready) return;
    saveBakeryState(state);

    if (initialSyncDone.current) {
      fetch("/api/operational-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync_full_state", state }),
      }).catch(() => {});
    }
  }, [ready, state]);

  function resetDemo() {
    clearBakeryState();
    setState(createDemoState());
    fetch("/api/operational-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync_full_state", state: createDemoState() }),
    }).catch(() => {});
  }

  return { state, setState, ready, resetDemo };
}
