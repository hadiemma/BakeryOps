import { NextRequest, NextResponse } from "next/server";
import { getOrderWorkflowState, listOrderWorkflowStates, upsertOrderWorkflowState } from "@/lib/db";
import { runCollaborationWorkflowForOrder } from "@/lib/collaboration-service";
import type { BakeryOrder } from "@/domain/types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get("orderId");
    if (orderId) {
      const state = getOrderWorkflowState(orderId);
      return NextResponse.json({ workflowState: state });
    }
    const states = listOrderWorkflowStates();
    return NextResponse.json({ workflowStates: states });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (body.action === "run_sequence" && body.order) {
      const result = runCollaborationWorkflowForOrder(body.order as BakeryOrder);
      return NextResponse.json(result, { status: 200 });
    }

    if (body.workflowState) {
      const saved = upsertOrderWorkflowState(body.workflowState);
      return NextResponse.json({ workflowState: saved }, { status: 200 });
    }

    return NextResponse.json({ error: "Invalid action or body" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
