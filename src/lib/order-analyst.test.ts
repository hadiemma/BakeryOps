import { afterEach, describe, expect, it, vi } from "vitest";
import { ingredients, orders, recipes } from "@/data/seed";
import {
  acceptedAnalystReply, buildOrderAnalystBody, ORDER_ANALYST_ID, parseAnalystMessage, readSseFrames, watchAnalystReply,
} from "./order-analyst";

const analysisId = "7dd3e28a-6930-4cda-bd84-b86f9395e841";
const roomId = "room-test";
function eventStream(body: string) {
  return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(body)); controller.close(); } }), { headers: { "content-type": "text/event-stream" } });
}
function message(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ messageId: "m1", seq: 3, roomId, sender: { clientId: "c1", name: "bakeryops-order-analyst", kind: "agent", agentId: ORDER_ANALYST_ID, userId: null }, source: "switch", body: `Analysis ID: ${analysisId}\nAdvice`, threadRootId: null, clientTxn: null, ...overrides });
}
function frame(overrides: Record<string, unknown> = {}) { return `event: message\ndata: ${message(overrides)}\n\n`; }

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Order Analyst response safety", () => {
  it("pins the exact target agent ID", () => expect(ORDER_ANALYST_ID).toBe("2bb7edb5-3078-44ec-8459-734f1488f1d1"));

  it("rejects malformed, wrong-room, wrong-agent, and wrong-analysis replies", () => {
    expect(parseAnalystMessage("{bad json")).toBeNull();
    expect(parseAnalystMessage(JSON.stringify({ roomId, body: "x", seq: "bad", sender: {} }))).toBeNull();
    expect(acceptedAnalystReply(parseAnalystMessage(message({ roomId: "other" })), roomId, analysisId)).toBe(false);
    expect(acceptedAnalystReply(parseAnalystMessage(message({ sender: { kind: "agent", agentId: "another-agent" } })), roomId, analysisId)).toBe(false);
    expect(acceptedAnalystReply(parseAnalystMessage(message({ body: "Analysis ID: another-id" })), roomId, analysisId)).toBe(false);
    expect(acceptedAnalystReply(parseAnalystMessage(message()), roomId, analysisId)).toBe(true);
  });

  it("parses SSE data across arbitrary byte chunks", async () => {
    const bytes = new TextEncoder().encode(frame());
    const stream = new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } });
    const frames = [];
    for await (const item of readSseFrames(stream)) frames.push(item);
    expect(frames).toHaveLength(1);
    expect(acceptedAnalystReply(parseAnalystMessage(frames[0].data), roomId, analysisId)).toBe(true);
  });

  it("keeps a CRLF frame intact when the CR and LF arrive in separate chunks", async () => {
    const value = frame().replace(/\n/g, "\r\n");
    const split = value.indexOf("\r\n") + 1;
    const encoded = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(encoded.encode(value.slice(0, split)));
      controller.enqueue(encoded.encode(value.slice(split)));
      controller.close();
    } });
    const frames = [];
    for await (const item of readSseFrames(stream)) frames.push(item);
    expect(frames).toHaveLength(1);
    expect(acceptedAnalystReply(parseAnalystMessage(frames[0].data), roomId, analysisId)).toBe(true);
  });

  it("reconnects from the last seen room sequence and accepts the later valid reply", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(eventStream(frame({ seq: 4, sender: { kind: "human", agentId: null } })))
      .mockResolvedValueOnce(eventStream(frame({ seq: 5 })));
    const controller = new AbortController();
    const result = watchAnalystReply({ roomId, analysisId, signal: controller.signal, fetcher, timeoutMs: 10_000 });
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toContain("Advice");
    expect(fetcher.mock.calls[0][0]).toContain("seq=0");
    expect(fetcher.mock.calls[1][0]).toContain("seq=4");
  });

  it("ends in timeout state when no verified reply arrives", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(eventStream("event: ready\ndata: {}\n\n"));
    await expect(watchAnalystReply({ roomId, analysisId, signal: new AbortController().signal, fetcher, timeoutMs: 0 })).rejects.toThrow(/timed out/);
  });

  it("builds a read-only snapshot with recipe ingredients using canonical IDs", () => {
    const before = structuredClone(orders);
    const payload = JSON.parse(buildOrderAnalystBody(orders, analysisId));
    expect(payload.analysisId).toBe(analysisId);
    expect(payload.recipes.length).toBeGreaterThan(0);
    expect(payload.recipes[0].ingredients[0].canonicalIngredientId).toBe(payload.recipes[0].ingredients[0].ingredientId);
    expect(payload.canonicalIngredients.map((item: { id: string }) => item.id)).toEqual(ingredients.map((item) => item.id));
    expect(payload.guardrails).toMatch(/Advisory only/);
    expect(orders).toEqual(before);
    expect(recipes.sourdough.ingredients[0].ingredientId).toBe("bread-flour");
  });
});
