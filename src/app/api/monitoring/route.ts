import { NextRequest, NextResponse } from "next/server";
import {
  listAgentMonitoringStatuses,
  getAgentMonitoringStatus,
  listProactiveIssues,
  getProactiveIssue,
  resolveProactiveIssue,
  listMonitoringCycles,
  listPendingDiscordNotifications,
} from "@/lib/db";
import {
  runFullScheduledMonitoringCycle,
  runTimeSensitiveMonitoringCycle,
  checkOrderAnalystRisks,
  checkProductionPlannerRisks,
  checkInventoryManagerRisks,
  checkStaffTaskAssignerRisks,
  ensureSchedulerStarted,
} from "@/lib/monitoring-service";
import { retryPendingDiscordNotifications } from "@/lib/switch-bridge";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    ensureSchedulerStarted();
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get("agentId");
    const activeOnly = searchParams.get("activeOnly") !== "false";
    const limit = Number(searchParams.get("limit") || 50);

    const statuses = listAgentMonitoringStatuses();
    const issues = listProactiveIssues({
      responsibleAgentId: agentId || undefined,
      activeOnly,
      limit,
    });
    const cycles = listMonitoringCycles(20);
    const pendingNotifications = listPendingDiscordNotifications();

    return NextResponse.json({
      success: true,
      agents: statuses,
      activeIssuesCount: issues.length,
      issues,
      recentCycles: cycles,
      pendingNotificationsCount: pendingNotifications.length,
      pendingNotifications,
    }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    ensureSchedulerStarted();
    const body = await request.json().catch(() => ({}));
    const { action } = body;

    if (action === "run_cycle") {
      const cycleType = body.cycleType || "scheduled";
      const agentId = body.agentId;

      let result: any;
      if (agentId === "order-analyst") {
        const count = await checkOrderAnalystRisks(cycleType);
        result = { agentId, findings: count };
      } else if (agentId === "production-planner") {
        const count = await checkProductionPlannerRisks(cycleType);
        result = { agentId, findings: count };
      } else if (agentId === "inventory-manager") {
        const count = await checkInventoryManagerRisks(cycleType);
        result = { agentId, findings: count };
      } else if (agentId === "staff-task-assigner") {
        const count = await checkStaffTaskAssignerRisks(cycleType);
        result = { agentId, findings: count };
      } else if (cycleType === "time_sensitive") {
        result = await runTimeSensitiveMonitoringCycle();
      } else {
        result = await runFullScheduledMonitoringCycle();
      }

      const issues = listProactiveIssues({ activeOnly: true });
      return NextResponse.json({ success: true, result, activeIssues: issues }, { status: 200 });
    }

    if (action === "resolve_issue" && body.issueId) {
      const resolved = resolveProactiveIssue(body.issueId, body.evidence || "Manually resolved by manager");
      if (!resolved) {
        return NextResponse.json({ error: "Issue not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true, issue: resolved }, { status: 200 });
    }

    if (action === "retry_notifications") {
      const res = await retryPendingDiscordNotifications();
      return NextResponse.json({ success: true, ...res }, { status: 200 });
    }

    if (action === "status") {
      const statuses = listAgentMonitoringStatuses();
      const issues = listProactiveIssues({ activeOnly: true });
      return NextResponse.json({ success: true, agents: statuses, issues }, { status: 200 });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
