import { NextResponse } from "next/server";
import { listAuditLogs } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const logs = listAuditLogs();
    return NextResponse.json({ auditLogs: logs });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
