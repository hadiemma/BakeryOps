"use client";

import { useRef, useState } from "react";
import type { BakeryOrder } from "@/domain/types";
import { buildOrderAnalystBody, watchAnalystReply } from "@/lib/order-analyst";

type AnalystState = { status: "idle" | "pending" | "completed" | "failed"; analysisId?: string; roomId?: string; body?: string; error?: string };
type AnalysisRequest = { analysisId: string; body: string; roomId?: string; lastSeq?: number };

export function OrderAnalyst({ orders }: { orders: BakeryOrder[] }) {
  const [state, setState] = useState<AnalystState>({ status: "idle" });
  const running = useRef(false);
  const retryRequest = useRef<AnalysisRequest | null>(null);

  async function requestAnalysis() {
    if (running.current) return;
    running.current = true;
    const snapshot = retryRequest.current ?? (() => {
      const analysisId = crypto.randomUUID();
      const body = buildOrderAnalystBody(orders, analysisId);
      retryRequest.current = { analysisId, body };
      return retryRequest.current;
    })();
    setState({ status: "pending", analysisId: snapshot.analysisId, roomId: snapshot.roomId });
    const abort = new AbortController();
    try {
      let roomId = snapshot.roomId;
      if (!roomId) {
        const response = await fetch("/api/order-analyst", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ analysisId: snapshot.analysisId, body: snapshot.body }),
          signal: abort.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Could not start order analysis.");
        if (typeof result.roomId !== "string" || !result.roomId) throw new Error("Switch returned an invalid chat reference.");
        roomId = result.roomId;
        snapshot.roomId = roomId;
      }
      if (!roomId) throw new Error("Switch returned an invalid chat reference.");
      const reply = await watchAnalystReply({ roomId, analysisId: snapshot.analysisId, signal: abort.signal, initialSeq: snapshot.lastSeq, onCursor: (seq) => { snapshot.lastSeq = seq; } });
      setState({ status: "completed", analysisId: snapshot.analysisId, roomId, body: reply });
      retryRequest.current = null;
    } catch (error) {
      if (!abort.signal.aborted) setState({ status: "failed", analysisId: snapshot.analysisId, roomId: snapshot.roomId, error: error instanceof Error ? error.message : "Order analysis failed." });
    } finally {
      running.current = false;
    }
  }

  return <section className="order-analyst" aria-labelledby="order-analyst-title">
    <div className="analyst-copy"><div><h3 id="order-analyst-title">Order Analyst</h3><p>Ask the connected Switch agent for an advisory review of current orders, recipes, and canonical ingredients.</p></div>
      <button className="secondary-button" onClick={() => { retryRequest.current = null; void requestAnalysis(); }} disabled={state.status === "pending" || orders.every((order) => order.status === "complete")}>{state.status === "completed" ? "Run another analysis" : state.status === "failed" ? "Retry analysis" : state.status === "pending" ? "Analysis pending…" : "Analyze orders"}</button>
    </div>
    {state.status === "pending" && <p className="analyst-status" role="status">Waiting for the verified Order Analyst reply…</p>}
    {state.status === "failed" && <div className="analyst-result analyst-error" role="alert"><strong>Analysis failed</strong><p>{state.error}</p><span>Retry uses the same request ID, so Switch can safely deduplicate it.</span></div>}
    {state.status === "completed" && <div className="analyst-result"><strong>Advisory analysis</strong><pre>{state.body}</pre><span>Review recommendations before making any changes. BakeryOps data was not changed.</span></div>}
    <small className="analyst-advisory">The assistant cannot approve plans or update orders, inventory, production plans, or staff tasks.</small>
  </section>;
}
