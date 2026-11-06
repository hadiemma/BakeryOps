import { orders as demoOrders } from "@/data/seed";
import type { BakeryState } from "@/domain/types";

const STORAGE_KEY = "bakeryops-ai-state-clean-v2";

export function createDemoState(): BakeryState {
  return {
    orders: [],
    plans: [],
    tasks: [],
  };
}

export function loadBakeryState(): BakeryState {
  const fallback = createDemoState();
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored) as Partial<BakeryState>;
    if (!Array.isArray(parsed.orders) || !Array.isArray(parsed.plans) || !Array.isArray(parsed.tasks)) return fallback;
    return { orders: parsed.orders, plans: parsed.plans, tasks: parsed.tasks } as BakeryState;
  } catch {
    return fallback;
  }
}

export function saveBakeryState(state: BakeryState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Keep in-memory workflow usable
  }
}

export function clearBakeryState(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem("bakeryops-ai-state-v1");
  } catch {
    // Ignore
  }
}
