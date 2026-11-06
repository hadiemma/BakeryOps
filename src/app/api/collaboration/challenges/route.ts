import { NextRequest, NextResponse } from "next/server";
import { listChallenges, updateChallenge, createChallenge } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get("orderId") || undefined;
    const challenges = listChallenges(orderId);
    return NextResponse.json({ challenges });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (body.action === "update") {
      const { id, status, revisionSummary, resolutionNotes } = body;
      if (!id || !status) {
        return NextResponse.json({ error: "Missing required fields: id and status" }, { status: 400 });
      }
      const updated = updateChallenge(id, { status, revisionSummary, resolutionNotes });
      return NextResponse.json({ challenge: updated });
    }

    const { orderId, challengingAgentId, targetAgentId, issue, evidence, status } = body;
    if (!orderId || !challengingAgentId || !targetAgentId || !issue || !evidence) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const created = createChallenge({
      id: `chal-${crypto.randomUUID()}`,
      orderId,
      challengingAgentId,
      targetAgentId,
      issue,
      evidence,
      status: status || "OPEN",
    });

    return NextResponse.json({ challenge: created }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
