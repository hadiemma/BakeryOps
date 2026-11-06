import { NextRequest, NextResponse } from "next/server";
import { ORDER_ANALYST_ID } from "@/lib/order-analyst";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sameOrigin(request: NextRequest, requireOrigin = false) {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || (requireOrigin && !origin)) return false;
  try { return !origin || new URL(origin).host === request.headers.get("host"); }
  catch { return false; }
}

function switchCookie(request: NextRequest) {
  const cookie = request.cookies.get("switch_auth")?.value;
  return cookie ? `switch_auth=${cookie}` : null;
}

function coreUrl(path: string) {
  const base = process.env.SWITCH_CORE_URL;
  if (!base) throw new Error("Switch Core is not configured.");
  return new URL(path, base.endsWith("/") ? base : `${base}/`);
}

function safeError(status: number) {
  if (status === 401) return NextResponse.json({ error: "Sign in to Switch to request an order analysis." }, { status: 401 });
  return NextResponse.json({ error: "Switch could not start the order analysis." }, { status: status >= 400 && status < 600 ? status : 502 });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request, true)) return NextResponse.json({ error: "Same-origin request required." }, { status: 403 });
  const cookie = switchCookie(request);
  if (!cookie) return safeError(401);
  let input: { analysisId?: unknown; body?: unknown };
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (typeof input.analysisId !== "string" || !UUID.test(input.analysisId) || typeof input.body !== "string" || input.body.length > 30000) {
    return NextResponse.json({ error: "Invalid analysis request." }, { status: 400 });
  }
  const headers = { cookie, "content-type": "application/json", accept: "application/json" };
  try {
    const create = await fetch(coreUrl("gateway/chats"), {
      method: "POST", headers,
      body: JSON.stringify({ agentId: ORDER_ANALYST_ID, requestId: input.analysisId }),
      cache: "no-store",
    });
    if (!create.ok) return safeError(create.status);
    const envelope: unknown = await create.json();
    const chat = (envelope as { chat?: { roomId?: string; channelType?: string; agents?: Array<{ id?: string }> } })?.chat;
    const roomId = chat?.roomId;
    if (!roomId || chat.channelType !== "direct" || chat.agents?.length !== 1 || chat.agents[0]?.id !== ORDER_ANALYST_ID) return safeError(502);
    const send = await fetch(coreUrl(`gateway/chats/${encodeURIComponent(roomId)}/messages`), {
      method: "POST", headers,
      body: JSON.stringify({
        requestId: `${input.analysisId}-send`,
        body: `Analysis ID: ${input.analysisId}\n\n${input.body}\n\nPlease echo the Analysis ID exactly in your response. Your response is advisory only and must not change orders, recipes, stock, plans, approvals, or tasks.`,
        threadRootId: null,
        uploadIds: [],
      }),
      cache: "no-store",
    });
    if (!send.ok) return safeError(send.status);
    return NextResponse.json({ roomId, analysisId: input.analysisId });
  } catch {
    // Never include request headers, upstream body, or exception text: they can contain credentials.
    return safeError(502);
  }
}

