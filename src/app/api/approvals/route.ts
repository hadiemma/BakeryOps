import { NextRequest, NextResponse } from "next/server";
import { createApprovalRequest, listApprovalRequests, updateApprovalStatus } from "@/lib/db";
import type { ApprovalStatus } from "@/domain/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const list = listApprovalRequests();
    return NextResponse.json({ approvals: list });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (body.action === "update_status") {
      const { id, status, decidedBy, decisionNotes } = body;
      if (!id || !status || !decidedBy) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }
      const updated = updateApprovalStatus(id, status as ApprovalStatus, decidedBy, decisionNotes);
      return NextResponse.json({ approval: updated });
    }

    const { id, orderId, taskId, agentId, agentName, title, description, status, metadata } = body;
    if (!agentId || !agentName || !title || !description) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    const created = createApprovalRequest({
      id: id || `appr-${crypto.randomUUID()}`,
      orderId,
      taskId,
      agentId,
      agentName,
      title,
      description,
      status: (status as ApprovalStatus) || "WAITING_FOR_MANAGER",
      metadata,
    });
    return NextResponse.json({ approval: created }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
