import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ error: "Same-origin request required." }, { status: 403 });
  try { if (origin && new URL(origin).host !== request.headers.get("host")) return NextResponse.json({ error: "Same-origin request required." }, { status: 403 }); }
  catch { return NextResponse.json({ error: "Same-origin request required." }, { status: 403 }); }
  const cookie = request.cookies.get("switch_auth")?.value;
  if (!cookie) return NextResponse.json({ error: "Sign in to Switch to receive the analysis." }, { status: 401 });
  const roomId = request.nextUrl.searchParams.get("roomId");
  const seq = Number(request.nextUrl.searchParams.get("seq") ?? "0");
  if (!roomId || !Number.isSafeInteger(seq) || seq < 0) return NextResponse.json({ error: "Invalid stream cursor." }, { status: 400 });
  const base = process.env.SWITCH_CORE_URL;
  if (!base) return NextResponse.json({ error: "Switch Core is not configured." }, { status: 503 });
  const url = new URL("gateway/chats/events", base.endsWith("/") ? base : `${base}/`);
  url.searchParams.set("after", `${roomId}:${seq}`);
  try {
    const upstream = await fetch(url, {
      headers: { cookie: `switch_auth=${cookie}`, accept: "text/event-stream" },
      cache: "no-store", signal: request.signal,
    });
    if (!upstream.ok || !upstream.body) return NextResponse.json({ error: upstream.status === 401 ? "Switch authentication expired." : "Could not connect to Switch events." }, { status: upstream.status });
    return new Response(upstream.body, { status: 200, headers: {
      "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no",
    } });
  } catch {
    return NextResponse.json({ error: "Could not connect to Switch events." }, { status: 502 });
  }
}

