import fs from "fs";
import path from "path";
import { enqueuePendingDiscordNotification, listPendingDiscordNotifications, updatePendingDiscordNotification } from "./db";

export const OPERATIONS_ROOM_ID = process.env.SWITCH_OPERATIONS_ROOM_ID || "f73083ed-aef6-4604-86ad-9959e56d8462";

export const AGENT_IDS = {
  "order-analyst": process.env.SWITCH_ORDER_ANALYST_ID || "2bb7edb5-3078-44ec-8459-734f1488f1d1",
  "production-planner": process.env.SWITCH_PRODUCTION_PLANNER_ID || "4c773347-5508-43b3-977a-5c1583b41d51",
  "inventory-manager": process.env.SWITCH_INVENTORY_MANAGER_ID || "7f3839e2-3c29-43a5-bbf0-69ad56340f36",
  "staff-task-assigner": process.env.SWITCH_STAFF_TASK_ASSIGNER_ID || "fbbacaba-b96f-48d9-8e4f-e787d910bdf4",
  "switch-buddy-admin": "233f93bf-31a0-41ab-8173-1a73dbacfc3d",
} as const;

export type SpecialistAgentKey = "order-analyst" | "production-planner" | "inventory-manager" | "staff-task-assigner";

export interface SwitchCredentials {
  endpoint: string;
  token: string;
  agentId: string;
  connectionId?: string;
  sessionId?: string;
}

export function getSwitchCredentials(agentIdOrKey: SpecialistAgentKey | string): SwitchCredentials | null {
  try {
    const agentId = (AGENT_IDS as any)[agentIdOrKey] || agentIdOrKey;
    const appData = process.env.APPDATA || (process.platform === "win32" ? "C:\\Users\\hadis\\AppData\\Roaming" : "");
    const baseDir = process.env.SWITCH_AGENT_CONTROLLER_DIR || (appData ? path.join(appData, "switchdash", "agent-controller", "servers") : "C:\\Users\\hadis\\AppData\\Roaming\\switchdash\\agent-controller\\servers");
    let endpoint = "";
    let token = "";

    if (fs.existsSync(baseDir)) {
      const serverDirs = fs.readdirSync(baseDir);
      for (const sDir of serverDirs) {
        const credPath = path.join(
          baseDir,
          sDir,
          "agents",
          agentId,
          "credentials.json"
        );
        if (fs.existsSync(credPath)) {
          const data = JSON.parse(fs.readFileSync(credPath, "utf-8"));
          if (data?.env?.SWITCH_API_ENDPOINT && data?.env?.SWITCH_API_TOKEN) {
            endpoint = data.env.SWITCH_API_ENDPOINT;
            token = data.env.SWITCH_API_TOKEN;
            break;
          }
        }
      }
    }

    if (!endpoint || !token) return null;

    let connectionId: string | undefined;
    let sessionId: string | undefined;

    // Resolve active session & connection id from sdk-sessions
    const sessionsDir = "C:\\Users\\hadis\\.local\\state\\switch\\sdk-sessions";
    if (fs.existsSync(sessionsDir)) {
      const entries = fs.readdirSync(sessionsDir);
      let best: { mtime: number; connId: string; sessId: string } | null = null;
      for (const e of entries) {
        const cfgPath = path.join(sessionsDir, e, "config.json");
        const evPath = path.join(sessionsDir, e, "events.jsonl");
        if (fs.existsSync(cfgPath) && fs.existsSync(evPath)) {
          try {
            const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
            if (cfg?.session?.agentId === agentId) {
              const lines = fs.readFileSync(evPath, "utf-8").trim().split("\n");
              let isReady = false;
              const mtime = fs.statSync(evPath).mtimeMs;
              for (let i = lines.length - 1; i >= 0; i--) {
                if (lines[i].includes("session.upsert")) {
                  const ev = JSON.parse(lines[i]);
                  if (ev.body?.session?.status === "ready") {
                    isReady = true;
                    break;
                  } else if (ev.body?.session?.status === "error") {
                    break;
                  }
                }
              }
              const cId = cfg?.roomConnection?.connectionId;
              const sId = cfg?.session?.sessionId;
              if (isReady && cId && sId) {
                if (!best || mtime > best.mtime) {
                  best = { mtime, connId: cId, sessId: sId };
                }
              }
            }
          } catch {}
        }
      }
      if (best) {
        connectionId = best.connId;
        sessionId = best.sessId;
      }
    }

    return {
      endpoint,
      token,
      agentId,
      connectionId,
      sessionId,
    };
  } catch (err) {
    console.error("Error loading Switch credentials for " + agentIdOrKey + ":", err);
  }
  return null;
}

/**
 * Dispatches a message directly into Discord #bakeryops-operations as the specified specialist agent.
 * If Discord/Switch is unreachable, persists to pending_discord_notifications for safe retry.
 */
export async function sendAgentDiscordMessage(params: {
  agentKey: SpecialistAgentKey | string;
  body: string;
  targetNames?: string[];
  threadId?: string;
  issueId?: string;
  eventId?: string;
}): Promise<{ success: boolean; eventId?: string; error?: string; pendingId?: string }> {
  const agentId = (AGENT_IDS as any)[params.agentKey] || params.agentKey;
  const creds = getSwitchCredentials(agentId);

  if (!creds) {
    const err = "Switch credentials not found for agent: " + params.agentKey;
    console.warn(err);
    const pending = enqueuePendingDiscordNotification({
      id: "pending-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      agentId,
      targetNames: params.targetNames,
      body: params.body,
      eventId: params.eventId,
      issueId: params.issueId,
    });
    return { success: false, error: err, pendingId: pending.id };
  }

  const headers: Record<string, string> = {
    Authorization: "Bearer " + creds.token,
    "Content-Type": "application/json",
  };
  if (creds.connectionId) {
    headers["X-Switch-Connection-Id"] = creds.connectionId;
  }
  if (creds.sessionId) {
    headers["X-Switch-Session-Id"] = creds.sessionId;
  }

  try {
    let res: Response;
    if (params.targetNames && params.targetNames.length > 0) {
      res = await fetch(creds.endpoint + "/agents/" + creds.agentId + "/ops/send_targeted_message", {
        method: "POST",
        headers,
        body: JSON.stringify({
          target_names: params.targetNames,
          body: params.body,
          thread_id: params.threadId,
        }),
      });
    } else {
      res = await fetch(creds.endpoint + "/agents/" + creds.agentId + "/ops/post_message", {
        method: "POST",
        headers,
        body: JSON.stringify({
          body: params.body,
          thread_id: params.threadId,
        }),
      });
    }

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const eventId = data.event_id || data.id || "ok";
      console.log("[" + params.agentKey + "] Message posted successfully to Discord:", eventId);
      return { success: true, eventId };
    }

    const errText = await res.text().catch(() => "HTTP " + res.status);
    console.error("[" + params.agentKey + "] Discord post failed (" + res.status + "):", errText);
    const pending = enqueuePendingDiscordNotification({
      id: "pending-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      agentId,
      targetNames: params.targetNames,
      body: params.body,
      eventId: params.eventId,
      issueId: params.issueId,
    });
    return { success: false, error: errText, pendingId: pending.id };
  } catch (err: any) {
    console.error("[" + params.agentKey + "] Network error delivering Discord message:", err.message);
    const pending = enqueuePendingDiscordNotification({
      id: "pending-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      agentId,
      targetNames: params.targetNames,
      body: params.body,
      eventId: params.eventId,
      issueId: params.issueId,
    });
    return { success: false, error: err.message, pendingId: pending.id };
  }
}

/**
 * Retries all pending Discord notifications that could not be sent earlier due to temporary outage.
 */
export async function retryPendingDiscordNotifications(): Promise<{ retried: number; succeeded: number; failed: number }> {
  const pending = listPendingDiscordNotifications(5);
  let succeeded = 0;
  let failed = 0;

  for (const item of pending) {
    const creds = getSwitchCredentials(item.agentId);
    if (!creds) {
      updatePendingDiscordNotification(item.id, {
        attempts: item.attempts + 1,
        lastError: "Switch credentials unavailable",
      });
      failed++;
      continue;
    }

    const headers: Record<string, string> = {
      Authorization: "Bearer " + creds.token,
      "Content-Type": "application/json",
    };
    if (creds.connectionId) headers["X-Switch-Connection-Id"] = creds.connectionId;
    if (creds.sessionId) headers["X-Switch-Session-Id"] = creds.sessionId;

    try {
      const res = await fetch(creds.endpoint + "/agents/" + creds.agentId + "/ops/post_message", {
        method: "POST",
        headers,
        body: JSON.stringify({ body: item.body }),
      });

      if (res.ok) {
        updatePendingDiscordNotification(item.id, {
          status: "SENT",
          attempts: item.attempts + 1,
          sentAt: new Date().toISOString(),
        });
        succeeded++;
      } else {
        const errText = await res.text().catch(() => "HTTP " + res.status);
        updatePendingDiscordNotification(item.id, {
          attempts: item.attempts + 1,
          lastError: errText,
          status: item.attempts + 1 >= item.maxAttempts ? "FAILED" : "PENDING",
        });
        failed++;
      }
    } catch (netErr: any) {
      updatePendingDiscordNotification(item.id, {
        attempts: item.attempts + 1,
        lastError: netErr.message,
        status: item.attempts + 1 >= item.maxAttempts ? "FAILED" : "PENDING",
      });
      failed++;
    }
  }

  return { retried: pending.length, succeeded, failed };
}

// ============================================================
// Specialized Agent Alert Wrappers
// ============================================================

export async function sendOrderAnalystDiscordAlert(body: string, targetNames?: string[], issueId?: string) {
  return sendAgentDiscordMessage({
    agentKey: "order-analyst",
    body,
    targetNames: targetNames || ["hadishanavas7454"],
    issueId,
  });
}

export async function sendProductionPlannerDiscordAlert(body: string, targetNames?: string[], issueId?: string) {
  return sendAgentDiscordMessage({
    agentKey: "production-planner",
    body,
    targetNames: targetNames || ["hadishanavas7454"],
    issueId,
  });
}

export async function sendInventoryManagerDiscordAlert(body: string, targetNames?: string[], issueId?: string) {
  return sendAgentDiscordMessage({
    agentKey: "inventory-manager",
    body,
    targetNames: targetNames || ["hadishanavas7454"],
    issueId,
  });
}

export async function sendStaffTaskAssignerDiscordUpdate(body: string, targetNames?: string[], eventId?: string) {
  return sendAgentDiscordMessage({
    agentKey: "staff-task-assigner",
    body,
    targetNames,
    eventId,
  });
}

// Backward-compatible M5 functions
export async function notifyOrderAnalystInDiscord(order: {
  id: string;
  customerName: string;
  items: Array<{ productId: string; quantity: number }>;
  dueAt: string;
  note?: string;
  status: string;
}): Promise<boolean> {
  const itemSummary = order.items
    .map((i) => `${i.quantity}x ${i.productId}`)
    .join(", ");

  const body = `[EVENT: ORDER_CREATED] A new customer order has been created in BakeryOps:
- Order ID: ${order.id}
- Customer: ${order.customerName}
- Items: ${itemSummary}
- Delivery Due: ${order.dueAt}
- Customer Note: "${order.note || "Standard delivery"}"
- Status: ${order.status}

Please review this order intake, calculate batch requirements, prep/bake schedule, and ingredient needs.`;

  const res = await sendAgentDiscordMessage({
    agentKey: "order-analyst",
    body,
    targetNames: ["production-planner"],
  });
  return res.success;
}

export async function notifyOrderCancelledInDiscord(orderId: string, customerName?: string): Promise<boolean> {
  const body = `[EVENT: ORDER_CANCELLED] Order ${orderId}${customerName ? ` (${customerName})` : ""} has been cancelled / deleted by manager.
Please halt unstarted batches, cancel pending tasks, and release ingredient reservations.`;

  const res = await sendAgentDiscordMessage({
    agentKey: "order-analyst",
    body,
    targetNames: ["production-planner", "inventory-manager"],
  });
  return res.success;
}
