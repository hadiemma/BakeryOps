export const ORDER_ANALYST_ID = "2bb7edb5-3078-44ec-8459-734f1488f1d1";

import { ingredients, productLabels, recipes } from "@/data/seed";
import type { BakeryOrder } from "@/domain/types";

export function buildOrderAnalystBody(orders: BakeryOrder[], analysisId: string): string {
  const activeOrders = orders.filter((order) => order.status !== "complete");
  const neededProducts = [...new Set(activeOrders.flatMap((order) => order.items.map((item) => item.productId)))];
  return JSON.stringify({
    purpose: "Advisory order and production analysis", analysisId,
    orders: activeOrders.map((order) => ({ id: order.id, customerName: order.customerName, dueAt: order.dueAt, note: order.note, status: order.status, items: order.items })),
    recipes: neededProducts.map((id) => ({ ...recipes[id], productName: productLabels[id], ingredients: recipes[id].ingredients.map((ingredient) => ({ ...ingredient, canonicalIngredientId: ingredient.ingredientId })) })),
    canonicalIngredients: ingredients.map(({ id, name, baseUnit, onHand }) => ({ id, name, unit: baseUnit, onHand })),
    guardrails: "Advisory only. Do not approve plans or change orders, recipes, stock, tasks, or other authoritative bakery data.",
  });
}

export interface AnalystMessage {
  messageId?: string;
  seq: number;
  roomId: string;
  sender: { clientId?: string; name?: string; kind: string; agentId?: string; userId?: string | null };
  source?: string;
  body: string;
  threadRootId?: string | null;
  clientTxn?: string | null;
}

export interface SseFrame { event: string; data: string; }

/** Incremental SSE framing; handles CRLF, comments, and arbitrary chunk boundaries. */
export async function* readSseFrames(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SseFrame> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const abort = () => { void reader.cancel(); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let separator: RegExpExecArray | null;
      while ((separator = /(?:\r\n|\r|\n){2}/.exec(buffer)) !== null) {
        const block = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        let event = "message";
        const data: string[] = [];
        for (const line of block.split(/\r\n|\r|\n/)) {
          if (!line || line.startsWith(":")) continue;
          const colon = line.indexOf(":");
          const field = colon < 0 ? line : line.slice(0, colon);
          const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
          if (field === "event") event = value;
          if (field === "data") data.push(value);
        }
        if (data.length) yield { event, data: data.join("\n") };
      }
      if (done) return;
    }
  } finally { signal?.removeEventListener("abort", abort); reader.releaseLock(); }
}

export function parseAnalystMessage(data: string): AnalystMessage | null {
  try {
    const parsed: unknown = JSON.parse(data);
    if (!parsed || typeof parsed !== "object") return null;
    const value = parsed as Partial<AnalystMessage>;
    if (typeof value.roomId !== "string" || typeof value.body !== "string" || !Number.isInteger(value.seq) || !value.sender || typeof value.sender.kind !== "string") return null;
    return value as AnalystMessage;
  } catch { return null; }
}

export function acceptedAnalystReply(message: AnalystMessage | null, roomId: string, analysisId: string): boolean {
  return !!message && message.roomId === roomId && message.sender.kind === "agent" &&
    message.sender.agentId === ORDER_ANALYST_ID &&
    message.body.split(/\r?\n/).some((line) => line.trim() === `Analysis ID: ${analysisId}`);
}

export function parseRoomCursor(value: string | null): { roomId: string; seq: number } | null {
  if (!value) return null;
  const split = value.lastIndexOf(":");
  if (split <= 0) return null;
  const seq = Number(value.slice(split + 1));
  if (!Number.isSafeInteger(seq) || seq < 0) return null;
  return { roomId: value.slice(0, split), seq };
}

export async function watchAnalystReply(options: {
  roomId: string;
  analysisId: string;
  signal: AbortSignal;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  initialSeq?: number;
  onCursor?: (seq: number) => void;
}): Promise<string> {
  const fetcher = options.fetcher ?? fetch;
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  let seq = options.initialSeq ?? 0;
  let retries = 0;
  while (!options.signal.aborted && Date.now() < deadline && retries <= 8) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal.addEventListener("abort", abort, { once: true });
    const remaining = Math.max(1, deadline - Date.now());
    const timeout = setTimeout(abort, Math.min(remaining, 20_000));
    try {
      const response = await fetcher(`/api/order-analyst/events?roomId=${encodeURIComponent(options.roomId)}&seq=${seq}`, {
        headers: { accept: "text/event-stream" }, signal: controller.signal, cache: "no-store",
      });
      if (response.status === 401) throw new Error("Switch authentication expired. Sign in again.");
      if (!response.ok || !response.body) throw new Error("Could not connect to the Switch analysis stream.");
      for await (const frame of readSseFrames(response.body, controller.signal)) {
        if (frame.event !== "message") continue;
        const message = parseAnalystMessage(frame.data);
        if (!message || message.roomId !== options.roomId) continue;
        seq = Math.max(seq, message.seq);
        options.onCursor?.(seq);
        if (acceptedAnalystReply(message, options.roomId, options.analysisId)) return message.body;
      }
      retries += 1;
    } catch (error) {
      if (options.signal.aborted) throw new Error("Analysis cancelled.");
      if (error instanceof Error && /authentication expired/.test(error.message)) throw error;
      retries += 1;
    } finally {
      clearTimeout(timeout);
      options.signal.removeEventListener("abort", abort);
    }
    if (Date.now() >= deadline || retries > 8) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(500 * retries, 2500)));
  }
  if (options.signal.aborted) throw new Error("Analysis cancelled.");
  throw new Error("The Order Analyst did not reply before the connection timed out. You can retry safely.");
}

