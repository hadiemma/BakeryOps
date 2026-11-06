import { NextRequest, NextResponse } from "next/server";
import { listInteractions, recordInteraction } from "@/lib/db";
import { handleCollaborationMessage } from "@/lib/collaboration-service";
import type { InteractionType } from "@/domain/types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get("orderId") || undefined;
    const list = listInteractions(orderId);
    return NextResponse.json({ interactions: list });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, requestId, orderId, agentId, agentName, sender, type, content } = body;
    if (!agentId || !agentName || !sender || !type || !content) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const created = recordInteraction({
      id: id || `int-${crypto.randomUUID()}`,
      requestId,
      orderId,
      agentId,
      agentName,
      sender,
      type: type as InteractionType,
      content,
    });

    // M5 Scenario 6: When manager gives input/instruction, responsible agent acknowledges & reassesses
    if (sender === "manager" || sender.includes("hadishanavas") || sender.includes("Alex Morgan")) {
      handleCollaborationMessage({
        orderId: orderId || "general-dispatch",
        workflowStage: "manager_approval",
        senderId: agentId,
        recipientId: "manager",
        messageType: "RESPONSE",
        content: `[MANAGER INTERVENTION] Acknowledged instruction: "${content}". Incorporating manager operational constraint into workflow.`,
        evidence: `Manager intervention logged by ${sender} at ${new Date().toLocaleTimeString()}.`,
        reason: "Manager direction incorporated; parameters updated.",
      });
    }

    return NextResponse.json({ interaction: created }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
