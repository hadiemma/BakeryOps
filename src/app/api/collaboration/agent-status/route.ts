import { NextRequest, NextResponse } from "next/server";
import { listAgentLiveStatuses, upsertAgentLiveStatus, getAgentLiveStatus } from "@/lib/db";
import { eventBroadcaster } from "@/lib/event-broadcaster";
import type { AgentLiveStatus } from "@/domain/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const statuses = listAgentLiveStatuses();
    return NextResponse.json({ agentStatuses: statuses });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const updated = upsertAgentLiveStatus(body as AgentLiveStatus);
    eventBroadcaster.broadcast("agent_status_updated", updated);
    return NextResponse.json({ agentStatus: updated }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
