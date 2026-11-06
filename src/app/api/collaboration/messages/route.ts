import { NextRequest, NextResponse } from "next/server";
import { listCollaborationMessages } from "@/lib/db";
import { handleCollaborationMessage } from "@/lib/collaboration-service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get("orderId") || undefined;
    const messages = listCollaborationMessages(orderId);
    return NextResponse.json({ messages });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      orderId,
      taskId,
      workflowStage,
      senderId,
      senderName,
      recipientId,
      recipientName,
      messageType,
      status,
      content,
      evidence,
      reason,
      referenceId,
      metadata,
    } = body;

    if (!orderId || !senderId || !recipientId || !messageType || !content) {
      return NextResponse.json(
        { error: "Missing required fields: orderId, senderId, recipientId, messageType, and content are required." },
        { status: 400 },
      );
    }

    const result = handleCollaborationMessage({
      orderId,
      taskId,
      workflowStage,
      senderId,
      senderName,
      recipientId,
      recipientName,
      messageType,
      status,
      content,
      evidence,
      reason,
      referenceId,
      metadata,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
