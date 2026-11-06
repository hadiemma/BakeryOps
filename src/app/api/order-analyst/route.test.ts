import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { GET } from "./events/route";

const analysisId = "7dd3e28a-6930-4cda-bd84-b86f9395e841";
function request(body: unknown, cookie = "switch_auth=secret") {
  return new NextRequest("http://localhost/api/order-analyst", { method: "POST", headers: { host: "localhost", origin: "http://localhost", cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
}
const chatResponse = () => new Response(JSON.stringify({ chat: { roomId: "room-test", channelType: "direct", agents: [{ id: "2bb7edb5-3078-44ec-8459-734f1488f1d1", name: "bakeryops-order-analyst" }] } }), { status: 200 });
const sendResponse = () => new Response(JSON.stringify({ messages: [] }), { status: 200 });

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("same-origin Switch proxy", () => {
  it("returns 401 without switch_auth and makes no upstream call", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const response = await POST(request({ analysisId, body: "order data" }, ""));
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires Switch authentication on the event stream too", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const request = new NextRequest("http://localhost/api/order-analyst/events?roomId=room-test&seq=0", { headers: { host: "localhost" } });
    const response = await GET(request);
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("targets only the configured Order Analyst and forwards only switch_auth server-side", async () => {
    vi.stubEnv("SWITCH_CORE_URL", "http://switch.internal/");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(chatResponse()).mockResolvedValueOnce(sendResponse());
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(request({ analysisId, body: "safe bakery snapshot" }));
    expect(response.status).toBe(200);
    const responseBody = await response.json();
    expect(responseBody).toEqual({ roomId: "room-test", analysisId });
    const create = fetcher.mock.calls[0];
    expect(String(create[0])).toBe("http://switch.internal/gateway/chats");
    expect(JSON.parse(String(create[1]?.body))).toEqual({ agentId: "2bb7edb5-3078-44ec-8459-734f1488f1d1", requestId: analysisId });
    expect(new Headers(create[1]?.headers).get("cookie")).toBe("switch_auth=secret");
    expect(JSON.stringify(responseBody)).not.toContain("secret");
    expect(String(fetcher.mock.calls[1][0])).toContain("/gateway/chats/room-test/messages");
    const message = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(message.requestId).toBe(`${analysisId}-send`);
    expect(message.body).toContain(`Analysis ID: ${analysisId}`);
  });

  it("keeps create and send request IDs stable across duplicate calls", async () => {
    vi.stubEnv("SWITCH_CORE_URL", "http://switch.internal/");
    const fetcher = vi.fn<typeof fetch>();
    for (let i = 0; i < 2; i++) fetcher.mockResolvedValueOnce(chatResponse()).mockResolvedValueOnce(sendResponse());
    vi.stubGlobal("fetch", fetcher);
    await POST(request({ analysisId, body: "same snapshot" }));
    await POST(request({ analysisId, body: "same snapshot" }));
    const createIds = [0, 2].map((i) => JSON.parse(String(fetcher.mock.calls[i][1]?.body)).requestId);
    const sendIds = [1, 3].map((i) => JSON.parse(String(fetcher.mock.calls[i][1]?.body)).requestId);
    expect(createIds).toEqual([analysisId, analysisId]);
    expect(sendIds).toEqual([`${analysisId}-send`, `${analysisId}-send`]);
  });

  it("rejects malformed or non-target chat summaries without sending a message", async () => {
    vi.stubEnv("SWITCH_CORE_URL", "http://switch.internal/");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ chat: { roomId: "room-test", channelType: "direct", agents: [{ id: "wrong-agent" }] } }), { status: 200 })));
    const response = await POST(request({ analysisId, body: "snapshot" }));
    expect(response.status).toBe(502);
  });
});
