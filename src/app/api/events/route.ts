import { NextRequest, NextResponse } from "next/server";
import {
  listOperationalEvents,
  getOperationalEvent,
  recordOperationalEvent,
} from "@/lib/db";
import { processOperationalEvent, recoverPendingEvents } from "@/lib/event-service";
import type { OperationalEventType, EventProcessingStatus } from "@/domain/types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = (searchParams.get("status") as EventProcessingStatus) || undefined;
    const eventType = (searchParams.get("eventType") as OperationalEventType) || undefined;
    const orderId = searchParams.get("orderId") || undefined;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!) : 100;

    const events = listOperationalEvents({ status, eventType, orderId, limit });
    return NextResponse.json({ events });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "retry" && body.eventId) {
      const processed = await processOperationalEvent(body.eventId);
      return NextResponse.json({ success: true, event: processed });
    }

    if (action === "recover") {
      const count = await recoverPendingEvents();
      return NextResponse.json({ success: true, recoveredCount: count });
    }

    if (action === "trigger" && body.event) {
      const opEvent = recordOperationalEvent(body.event);
      const processed = await processOperationalEvent(opEvent.id);
      return NextResponse.json({ success: true, event: processed });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
