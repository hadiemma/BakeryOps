import { recipes } from "@/data/seed";
import { calculateIngredientRequirements } from "@/domain/workflow";
import fs from "node:fs";
import Database from "better-sqlite3";
import path from "node:path";
import type {
  InventoryConsumption,
  ApprovalRequest,
  ManagerInteraction,
  CollaborationMessage,
  ChallengeRecord,
  OrderWorkflowState,
  ChallengeStatus,
  WorkflowStage,
  CollaborationStatus,
  AgentLiveStatus,
  AuditLogEntry,
  BakeryOrder,
  Ingredient,
  InventoryAdjustment,
  ProductionPlan,
  ProductionTask,
  OperationalEvent,
  OperationalEventType,
  EventProcessingStatus,
  ProactiveIssue,
  IssueStatus,
  IssueSeverity,
  IssueCategory,
  MonitoringCycle,
  MonitoringCycleType,
  AgentMonitoringStatusRecord,
  PendingDiscordNotification,
} from "@/domain/types";


const defaultDbDir = path.join(process.cwd(), "data");
const DB_PATH = fs.existsSync(defaultDbDir)
  ? path.join(defaultDbDir, "bakeryops.sqlite")
  : "C:/Users/hadis/.switch/agents/localhost-57168/bakeryops-codex/data/bakeryops.sqlite";

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    initDb(_db);
  }
  return _db;
}

function initDb(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS approval_requests (
      id TEXT PRIMARY KEY,
      order_id TEXT,
      task_id TEXT,
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      decided_by TEXT,
      decided_at TEXT,
      decision_notes TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS manager_interactions (
      id TEXT PRIMARY KEY,
      request_id TEXT,
      order_id TEXT,
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      sender TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS collaboration_messages (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      task_id TEXT,
      workflow_stage TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      recipient_name TEXT NOT NULL,
      message_type TEXT NOT NULL,
      status TEXT NOT NULL,
      content TEXT NOT NULL,
      evidence TEXT,
      reason TEXT,
      reference_id TEXT,
      created_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS collaboration_challenges (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      challenging_agent_id TEXT NOT NULL,
      target_agent_id TEXT NOT NULL,
      issue TEXT NOT NULL,
      evidence TEXT NOT NULL,
      status TEXT NOT NULL,
      revision_summary TEXT,
      resolution_notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_workflow_states (
      order_id TEXT PRIMARY KEY,
      current_stage TEXT NOT NULL,
      active_agent_id TEXT NOT NULL,
      waiting_for TEXT NOT NULL,
      revision_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- M4: Authoritative Operational Tables
    CREATE TABLE IF NOT EXISTS operational_orders (
      id TEXT PRIMARY KEY,
      customer_name TEXT NOT NULL,
      items_json TEXT NOT NULL,
      due_at TEXT NOT NULL,
      note TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS operational_inventory (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_unit TEXT NOT NULL,
      on_hand REAL NOT NULL,
      reorder_at REAL NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS operational_plans (
      id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      status TEXT NOT NULL,
      order_ids_json TEXT NOT NULL,
      batches_json TEXT NOT NULL,
      requirements_json TEXT NOT NULL,
      warnings_json TEXT NOT NULL,
      approved_by TEXT,
      approved_at TEXT,
      change_request TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS operational_tasks (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      order_ids_json TEXT NOT NULL,
      kind TEXT NOT NULL,
      assignee_id TEXT NOT NULL,
      due_at TEXT NOT NULL,
      status TEXT NOT NULL,
      blocker_note TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_live_statuses (
      agent_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      current_order_id TEXT,
      current_task_id TEXT,
      current_stage TEXT NOT NULL,
      current_activity TEXT NOT NULL,
      intended_recipient TEXT,
      waiting_for TEXT,
      last_activity_at TEXT NOT NULL,
      error_message TEXT
    );

        CREATE TABLE IF NOT EXISTS inventory_adjustments (
      id TEXT PRIMARY KEY,
      ingredient_id TEXT NOT NULL,
      ingredient_name TEXT NOT NULL,
      previous_quantity REAL NOT NULL,
      adjustment_amount REAL NOT NULL,
      new_quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      reason TEXT NOT NULL,
      performed_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_adj_ingredient ON inventory_adjustments(ingredient_id);
    CREATE INDEX IF NOT EXISTS idx_adj_created ON inventory_adjustments(created_at);

        CREATE TABLE IF NOT EXISTS operational_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      source_entity TEXT NOT NULL,
      source_id TEXT NOT NULL,
      order_id TEXT,
      task_id TEXT,
      payload_json TEXT NOT NULL,
      responsible_agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      resolution_summary TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_type ON operational_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_events_status ON operational_events(status);
    CREATE INDEX IF NOT EXISTS idx_events_created ON operational_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_events_order ON operational_events(order_id);


    -- M6: Proactive Monitoring & Issue Tables
    CREATE TABLE IF NOT EXISTS monitoring_cycles (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      cycle_type TEXT NOT NULL,
      scope TEXT NOT NULL,
      status TEXT NOT NULL,
      findings_count INTEGER NOT NULL DEFAULT 0,
      details_json TEXT,
      error_message TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_cycles_agent ON monitoring_cycles(agent_id);
    CREATE INDEX IF NOT EXISTS idx_cycles_type ON monitoring_cycles(cycle_type);
    CREATE INDEX IF NOT EXISTS idx_cycles_started ON monitoring_cycles(started_at);

    CREATE TABLE IF NOT EXISTS proactive_issues (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      responsible_agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      severity TEXT NOT NULL,
      order_id TEXT,
      task_id TEXT,
      ingredient_id TEXT,
      plan_id TEXT,
      title TEXT NOT NULL,
      evidence TEXT NOT NULL,
      impact TEXT NOT NULL,
      recommended_action TEXT NOT NULL,
      assigned_to TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      current_value TEXT,
      threshold_value TEXT,
      discord_message_id TEXT,
      last_notified_at TEXT,
      notification_count INTEGER NOT NULL DEFAULT 0,
      last_checked_at TEXT NOT NULL,
      resolution_evidence TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_issues_fingerprint ON proactive_issues(fingerprint);
    CREATE INDEX IF NOT EXISTS idx_issues_status ON proactive_issues(status);
    CREATE INDEX IF NOT EXISTS idx_issues_agent ON proactive_issues(responsible_agent_id);
    CREATE INDEX IF NOT EXISTS idx_issues_order ON proactive_issues(order_id);
    CREATE INDEX IF NOT EXISTS idx_issues_ingredient ON proactive_issues(ingredient_id);

    CREATE TABLE IF NOT EXISTS agent_monitoring_status (
      agent_id TEXT PRIMARY KEY,
      last_successful_check TEXT,
      next_due_check TEXT,
      current_status TEXT NOT NULL DEFAULT 'IDLE',
      last_cycle_type TEXT,
      failure_reason TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_discord_notifications (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      target_names_json TEXT,
      body TEXT NOT NULL,
      event_id TEXT,
      issue_id TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      last_error TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL,
      sent_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_pending_notif_status ON pending_discord_notifications(status);

    CREATE TABLE IF NOT EXISTS inventory_consumptions (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      consumption_ref TEXT NOT NULL UNIQUE,
      ingredient_id TEXT NOT NULL,
      quantity_consumed REAL NOT NULL,
      unit TEXT NOT NULL,
      previous_stock REAL NOT NULL,
      resulting_stock REAL NOT NULL,
      reason TEXT NOT NULL,
      performed_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_consumptions_order ON inventory_consumptions(order_id);
    CREATE INDEX IF NOT EXISTS idx_consumptions_ref ON inventory_consumptions(consumption_ref);

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      proposed_by TEXT NOT NULL,
      change_description TEXT NOT NULL,
      evidence TEXT,
      reason TEXT,
      approved_by TEXT,
      decision_at TEXT,
      execution_status TEXT NOT NULL,
      previous_value TEXT,
      new_value TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_approval_status ON approval_requests(status);
    CREATE INDEX IF NOT EXISTS idx_interactions_order ON manager_interactions(order_id);
    CREATE INDEX IF NOT EXISTS idx_collab_order ON collaboration_messages(order_id);
    CREATE INDEX IF NOT EXISTS idx_collab_created ON collaboration_messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_challenges_order ON collaboration_challenges(order_id);
  `);

  // Ensure operational_inventory has archived column
  try {
    const invInfo = db.prepare("PRAGMA table_info(operational_inventory)").all() as any[];
    if (!invInfo.some((c) => c.name === "archived")) {
      db.exec("ALTER TABLE operational_inventory ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;");
    }
  } catch {}

  // Initialize default 4 agent live statuses if empty
  const agentCount = db.prepare("SELECT COUNT(*) as count FROM agent_live_statuses").get() as any;
  if (!agentCount || agentCount.count === 0) {
    const defaultAgents = [
      { id: "order-analyst", name: "Order Analyst", role: "Customer Order Intake & Validation Specialist" },
      { id: "production-planner", name: "Production Planner", role: "Batch Scheduling & Timeline Feasibility Specialist" },
      { id: "inventory-manager", name: "Inventory Manager", role: "Raw Ingredients & Stock Verification Specialist" },
      { id: "staff-task-assigner", name: "Staff Task Assigner", role: "Production Task Execution & Staff Allocation Specialist" },
    ];
    const insertAgent = db.prepare(`
      INSERT INTO agent_live_statuses (
        agent_id, name, role, status, current_order_id, current_task_id,
        current_stage, current_activity, intended_recipient, waiting_for, last_activity_at, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    for (const a of defaultAgents) {
      insertAgent.run(a.id, a.name, a.role, "IDLE", null, null, "intake", "Standby. Waiting for the first order.", null, null, now, null);
    }
  }

  // Initialize default agent monitoring statuses if empty
  try {
    const statusCount = db.prepare("SELECT COUNT(*) as count FROM agent_monitoring_status").get() as any;
    if (!statusCount || statusCount.count === 0) {
      const defaultAgents = ["order-analyst", "production-planner", "inventory-manager", "staff-task-assigner"];
      const insertStatus = db.prepare(`
        INSERT INTO agent_monitoring_status (agent_id, current_status, updated_at)
        VALUES (?, 'IDLE', ?)
      `);
      const now = new Date().toISOString();
      for (const aId of defaultAgents) {
        insertStatus.run(aId, now);
      }
    }
  } catch {}

}

// --- M2 Approval Requests ---
export function listApprovalRequests(): ApprovalRequest[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM approval_requests ORDER BY created_at DESC").all() as any[];
  return rows.map(mapApprovalRow);
}

export function getApprovalRequest(id: string): ApprovalRequest | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM approval_requests WHERE id = ?").get(id) as any;
  return row ? mapApprovalRow(row) : null;
}

export function createApprovalRequest(item: Omit<ApprovalRequest, "createdAt" | "updatedAt">): ApprovalRequest {
  const db = getDb();
  const now = new Date().toISOString();
  const created: ApprovalRequest = {
    ...item,
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(`
    INSERT INTO approval_requests (
      id, order_id, task_id, agent_id, agent_name, title, description,
      status, created_at, updated_at, decided_by, decided_at, decision_notes, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    created.id,
    created.orderId ?? null,
    created.taskId ?? null,
    created.agentId,
    created.agentName,
    created.title,
    created.description,
    created.status,
    created.createdAt,
    created.updatedAt,
    created.decidedBy ?? null,
    created.decidedAt ?? null,
    created.decisionNotes ?? null,
    created.metadata ? JSON.stringify(created.metadata) : null,
  );
  return created;
}

export function updateApprovalStatus(
  id: string,
  status: ApprovalRequest["status"],
  decidedBy: string,
  decisionNotes?: string,
): ApprovalRequest | null {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE approval_requests
    SET status = ?, decided_by = ?, decided_at = ?, decision_notes = ?, updated_at = ?
    WHERE id = ?
  `).run(status, decidedBy, now, decisionNotes ?? null, now, id);
  return getApprovalRequest(id);
}

// --- M2 Manager Interactions ---
export function listInteractions(orderId?: string): ManagerInteraction[] {
  const db = getDb();
  let rows: any[];
  if (orderId) {
    rows = db.prepare("SELECT * FROM manager_interactions WHERE order_id = ? ORDER BY created_at ASC").all(orderId);
  } else {
    rows = db.prepare("SELECT * FROM manager_interactions ORDER BY created_at DESC LIMIT 100").all();
  }
  return rows.map(mapInteractionRow);
}

export function recordInteraction(item: Omit<ManagerInteraction, "createdAt">): ManagerInteraction {
  const db = getDb();
  const now = new Date().toISOString();
  const record: ManagerInteraction = {
    ...item,
    createdAt: now,
  };
  db.prepare(`
    INSERT INTO manager_interactions (
      id, request_id, order_id, agent_id, agent_name, sender, type, content, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.requestId ?? null,
    record.orderId ?? null,
    record.agentId,
    record.agentName,
    record.sender,
    record.type,
    record.content,
    record.createdAt,
  );
  return record;
}

// --- M3 Agent-to-Agent Collaboration Messages ---
export function listCollaborationMessages(orderId?: string): CollaborationMessage[] {
  const db = getDb();
  let rows: any[];
  if (orderId) {
    rows = db.prepare("SELECT * FROM collaboration_messages WHERE order_id = ? ORDER BY created_at ASC").all(orderId);
  } else {
    rows = db.prepare("SELECT * FROM collaboration_messages ORDER BY created_at ASC LIMIT 200").all();
  }
  return rows.map(mapCollabMessageRow);
}

export function createCollaborationMessage(
  item: Omit<CollaborationMessage, "createdAt"> & { createdAt?: string },
): CollaborationMessage {
  const db = getDb();
  const now = item.createdAt || new Date().toISOString();
  const record: CollaborationMessage = {
    ...item,
    createdAt: now,
  };
  db.prepare(`
    INSERT INTO collaboration_messages (
      id, order_id, task_id, workflow_stage, sender_id, sender_name,
      recipient_id, recipient_name, message_type, status, content,
      evidence, reason, reference_id, created_at, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.orderId,
    record.taskId ?? null,
    record.workflowStage,
    record.senderId,
    record.senderName,
    record.recipientId,
    record.recipientName,
    record.messageType,
    record.status,
    record.content,
    record.evidence ?? null,
    record.reason ?? null,
    record.referenceId ?? null,
    record.createdAt,
    record.metadata ? JSON.stringify(record.metadata) : null,
  );
  return record;
}

// --- M3 Challenges ---
export function listChallenges(orderId?: string): ChallengeRecord[] {
  const db = getDb();
  let rows: any[];
  if (orderId) {
    rows = db.prepare("SELECT * FROM collaboration_challenges WHERE order_id = ? ORDER BY created_at ASC").all(orderId);
  } else {
    rows = db.prepare("SELECT * FROM collaboration_challenges ORDER BY created_at DESC LIMIT 100").all();
  }
  return rows.map(mapChallengeRow);
}

export function getChallenge(id: string): ChallengeRecord | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM collaboration_challenges WHERE id = ?").get(id) as any;
  return row ? mapChallengeRow(row) : null;
}

export function createChallenge(item: Omit<ChallengeRecord, "createdAt" | "updatedAt">): ChallengeRecord {
  const db = getDb();
  const now = new Date().toISOString();
  const record: ChallengeRecord = {
    ...item,
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(`
    INSERT INTO collaboration_challenges (
      id, order_id, challenging_agent_id, target_agent_id, issue,
      evidence, status, revision_summary, resolution_notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.orderId,
    record.challengingAgentId,
    record.targetAgentId,
    record.issue,
    record.evidence,
    record.status,
    record.revisionSummary ?? null,
    record.resolutionNotes ?? null,
    record.createdAt,
    record.updatedAt,
  );
  return record;
}

export function updateChallenge(
  id: string,
  updates: {
    status?: ChallengeStatus;
    revisionSummary?: string;
    resolutionNotes?: string;
  },
): ChallengeRecord | null {
  const db = getDb();
  const current = getChallenge(id);
  if (!current) return null;
  const now = new Date().toISOString();
  const updatedStatus = updates.status ?? current.status;
  const updatedRev = updates.revisionSummary !== undefined ? updates.revisionSummary : current.revisionSummary;
  const updatedRes = updates.resolutionNotes !== undefined ? updates.resolutionNotes : current.resolutionNotes;

  db.prepare(`
    UPDATE collaboration_challenges
    SET status = ?, revision_summary = ?, resolution_notes = ?, updated_at = ?
    WHERE id = ?
  `).run(updatedStatus, updatedRev ?? null, updatedRes ?? null, now, id);
  return getChallenge(id);
}

// --- M3 Order Workflow States ---
export function getOrderWorkflowState(orderId: string): OrderWorkflowState | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM order_workflow_states WHERE order_id = ?").get(orderId) as any;
  return row ? mapWorkflowRow(row) : null;
}

export function listOrderWorkflowStates(): OrderWorkflowState[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM order_workflow_states ORDER BY updated_at DESC").all() as any[];
  return rows.map(mapWorkflowRow);
}

export function upsertOrderWorkflowState(state: OrderWorkflowState): OrderWorkflowState {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO order_workflow_states (
      order_id, current_stage, active_agent_id, waiting_for, revision_count, status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(order_id) DO UPDATE SET
      current_stage = excluded.current_stage,
      active_agent_id = excluded.active_agent_id,
      waiting_for = excluded.waiting_for,
      revision_count = excluded.revision_count,
      status = excluded.status,
      updated_at = excluded.updated_at
  `).run(
    state.orderId,
    state.currentStage,
    state.activeAgentId,
    state.waitingFor,
    state.revisionCount,
    state.status,
    now,
  );
  return { ...state, updatedAt: now };
}

// --- M4: Authoritative Operational Orders ---
export function listOperationalOrders(): BakeryOrder[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM operational_orders ORDER BY created_at DESC").all() as any[];
  return rows.map((r) => ({
    id: r.id,
    customerName: r.customer_name,
    items: JSON.parse(r.items_json),
    dueAt: r.due_at,
    note: r.note || undefined,
    status: r.status,
  }));
}

export function getOperationalOrder(id: string): BakeryOrder | null {
  const db = getDb();
  const r = db.prepare("SELECT * FROM operational_orders WHERE id = ?").get(id) as any;
  if (!r) return null;
  return {
    id: r.id,
    customerName: r.customer_name,
    items: JSON.parse(r.items_json),
    dueAt: r.due_at,
    note: r.note || undefined,
    status: r.status,
  };
}

export function upsertOperationalOrder(order: BakeryOrder): BakeryOrder {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO operational_orders (id, customer_name, items_json, due_at, note, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      customer_name = excluded.customer_name,
      items_json = excluded.items_json,
      due_at = excluded.due_at,
      note = excluded.note,
      status = excluded.status,
      updated_at = excluded.updated_at
  `).run(order.id, order.customerName, JSON.stringify(order.items), order.dueAt, order.note || null, order.status, now, now);
  return order;
}

export function deleteOperationalOrder(id: string): boolean {
  const db = getDb();
  const res = db.prepare("DELETE FROM operational_orders WHERE id = ?").run(id);
  return res.changes > 0;
}

// --- M4 & M4.1: Authoritative Operational Inventory & Manual Adjustments ---
export function listOperationalInventory(includeArchived: boolean = false): Ingredient[] {
  const db = getDb();
  const query = includeArchived
    ? "SELECT * FROM operational_inventory ORDER BY name ASC"
    : "SELECT * FROM operational_inventory WHERE archived = 0 ORDER BY name ASC";
  const rows = db.prepare(query).all() as any[];
  return rows.map((r) => {
    const onHand = Number(r.on_hand);
    const reorderAt = Number(r.reorder_at);
    let status: "inStock" | "lowStock" | "outOfStock" = "inStock";
    if (onHand <= 0) status = "outOfStock";
    else if (onHand <= reorderAt) status = "lowStock";

    return {
      id: r.id,
      name: r.name,
      baseUnit: r.base_unit,
      onHand,
      reorderAt,
      archived: Boolean(r.archived),
      status,
      updatedAt: r.updated_at,
    };
  });
}

export function getOperationalInventoryItem(id: string): Ingredient | null {
  const db = getDb();
  const r = db.prepare("SELECT * FROM operational_inventory WHERE id = ?").get(id) as any;
  if (!r) return null;
  const onHand = Number(r.on_hand);
  const reorderAt = Number(r.reorder_at);
  let status: "inStock" | "lowStock" | "outOfStock" = "inStock";
  if (onHand <= 0) status = "outOfStock";
  else if (onHand <= reorderAt) status = "lowStock";

  return {
    id: r.id,
    name: r.name,
    baseUnit: r.base_unit,
    onHand,
    reorderAt,
    archived: Boolean(r.archived),
    status,
    updatedAt: r.updated_at,
  };
}

export function upsertOperationalInventoryItem(item: {
  id?: string;
  name: string;
  baseUnit: string;
  onHand: number;
  reorderAt: number;
  archived?: boolean;
}): Ingredient {
  const db = getDb();
  const now = new Date().toISOString();
  const id = item.id || item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `item-${crypto.randomUUID()}`;
  const archivedInt = item.archived ? 1 : 0;

  db.prepare(`
    INSERT INTO operational_inventory (id, name, base_unit, on_hand, reorder_at, archived, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      base_unit = excluded.base_unit,
      on_hand = excluded.on_hand,
      reorder_at = excluded.reorder_at,
      archived = excluded.archived,
      updated_at = excluded.updated_at
  `).run(id, item.name, item.baseUnit, item.onHand, item.reorderAt, archivedInt, now);

  return getOperationalInventoryItem(id)!;
}

export function updateOperationalInventoryItem(
  id: string,
  updates: { name?: string; baseUnit?: string; onHand?: number; reorderAt?: number; archived?: boolean }
): Ingredient | null {
  const current = getOperationalInventoryItem(id);
  if (!current) return null;

  const db = getDb();
  const now = new Date().toISOString();
  const name = updates.name ?? current.name;
  const baseUnit = updates.baseUnit ?? current.baseUnit;
  const onHand = updates.onHand !== undefined ? Number(updates.onHand) : current.onHand;
  const reorderAt = updates.reorderAt !== undefined ? Number(updates.reorderAt) : current.reorderAt;
  const archivedInt = (updates.archived !== undefined ? updates.archived : current.archived) ? 1 : 0;

  db.prepare(`
    UPDATE operational_inventory
    SET name = ?, base_unit = ?, on_hand = ?, reorder_at = ?, archived = ?, updated_at = ?
    WHERE id = ?
  `).run(name, baseUnit, onHand, reorderAt, archivedInt, now, id);

  return getOperationalInventoryItem(id);
}

export function updateInventoryStock(id: string, onHand: number): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("UPDATE operational_inventory SET on_hand = ?, updated_at = ? WHERE id = ?").run(onHand, now, id);
}

export function adjustInventoryStock(params: {
  ingredientId: string;
  adjustmentAmount: number;
  reason: string;
  performedBy: string;
}): { ingredient: Ingredient; adjustment: InventoryAdjustment } {
  const current = getOperationalInventoryItem(params.ingredientId);
  if (!current) {
    throw new Error(`Ingredient "${params.ingredientId}" not found`);
  }

  const db = getDb();
  const now = new Date().toISOString();
  const previousQuantity = current.onHand;
  const newQuantity = Math.max(0, previousQuantity + params.adjustmentAmount);

  const adjustment: InventoryAdjustment = {
    id: `adj-${crypto.randomUUID()}`,
    ingredientId: current.id,
    ingredientName: current.name,
    previousQuantity,
    adjustmentAmount: params.adjustmentAmount,
    newQuantity,
    unit: current.baseUnit,
    reason: params.reason || "Manual adjustment",
    performedBy: params.performedBy || "hadishanavas7454",
    createdAt: now,
  };

  db.prepare(`
    INSERT INTO inventory_adjustments (
      id, ingredient_id, ingredient_name, previous_quantity, adjustment_amount,
      new_quantity, unit, reason, performed_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    adjustment.id,
    adjustment.ingredientId,
    adjustment.ingredientName,
    adjustment.previousQuantity,
    adjustment.adjustmentAmount,
    adjustment.newQuantity,
    adjustment.unit,
    adjustment.reason,
    adjustment.performedBy,
    adjustment.createdAt
  );

  db.prepare(`
    UPDATE operational_inventory
    SET on_hand = ?, updated_at = ?
    WHERE id = ?
  `).run(newQuantity, now, current.id);

  recordAuditLog({
    id: `audit-${crypto.randomUUID()}`,
    eventType: "MANUAL_INVENTORY_ADJUSTMENT",
    proposedBy: adjustment.performedBy,
    changeDescription: `Manual stock adjustment for ${current.name}: ${params.adjustmentAmount > 0 ? "+" : ""}${params.adjustmentAmount} ${current.baseUnit} (${adjustment.reason})`,
    evidence: `Previous: ${previousQuantity} ${current.baseUnit} -> New: ${newQuantity} ${current.baseUnit}`,
    reason: adjustment.reason,
    approvedBy: adjustment.performedBy,
    decisionAt: now,
    executionStatus: "EXECUTED",
    previousValue: `${previousQuantity} ${current.baseUnit}`,
    newValue: `${newQuantity} ${current.baseUnit}`,
  });

  const updatedIngredient = getOperationalInventoryItem(current.id)!;
  return { ingredient: updatedIngredient, adjustment };
}

export function archiveOperationalInventoryItem(id: string, archived: boolean = true, performedBy: string = "hadishanavas7454"): boolean {
  const current = getOperationalInventoryItem(id);
  if (!current) return false;

  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("UPDATE operational_inventory SET archived = ?, updated_at = ? WHERE id = ?").run(archived ? 1 : 0, now, id);

  recordAuditLog({
    id: `audit-${crypto.randomUUID()}`,
    eventType: archived ? "INVENTORY_ITEM_ARCHIVED" : "INVENTORY_ITEM_UNARCHIVED",
    proposedBy: performedBy,
    changeDescription: `${archived ? "Archived" : "Restored"} inventory item ${current.name} (${current.id})`,
    evidence: `Stock: ${current.onHand} ${current.baseUnit}`,
    reason: archived ? "Item archived by manager" : "Item unarchived by manager",
    approvedBy: performedBy,
    decisionAt: now,
    executionStatus: "EXECUTED",
    previousValue: `Archived: ${Boolean(current.archived)}`,
    newValue: `Archived: ${archived}`,
  });

  return true;
}

export function listInventoryAdjustments(ingredientId?: string, limit: number = 100): InventoryAdjustment[] {
  const db = getDb();
  let rows: any[];
  if (ingredientId) {
    rows = db.prepare("SELECT * FROM inventory_adjustments WHERE ingredient_id = ? ORDER BY created_at DESC LIMIT ?").all(ingredientId, limit);
  } else {
    rows = db.prepare("SELECT * FROM inventory_adjustments ORDER BY created_at DESC LIMIT ?").all(limit);
  }
  return rows.map((r) => ({
    id: r.id,
    ingredientId: r.ingredient_id,
    ingredientName: r.ingredient_name,
    previousQuantity: Number(r.previous_quantity),
    adjustmentAmount: Number(r.adjustment_amount),
    newQuantity: Number(r.new_quantity),
    unit: r.unit,
    reason: r.reason,
    performedBy: r.performed_by,
    createdAt: r.created_at,
  }));
}

// --- M4: Authoritative Operational Plans ---
export function listOperationalPlans(): ProductionPlan[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM operational_plans ORDER BY revision ASC").all() as any[];
  return rows.map((r) => ({
    id: r.id,
    revision: r.revision,
    status: r.status,
    createdAt: r.created_at,
    orderIds: JSON.parse(r.order_ids_json),
    batches: JSON.parse(r.batches_json),
    ingredientRequirements: JSON.parse(r.requirements_json),
    warnings: JSON.parse(r.warnings_json),
    approvedBy: r.approved_by || undefined,
    approvedAt: r.approved_at || undefined,
    changeRequest: r.change_request || undefined,
  }));
}

export function saveOperationalPlan(plan: ProductionPlan): ProductionPlan {
  const db = getDb();
  db.prepare(`
    INSERT INTO operational_plans (
      id, revision, status, order_ids_json, batches_json, requirements_json, warnings_json,
      approved_by, approved_at, change_request, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      revision = excluded.revision,
      status = excluded.status,
      order_ids_json = excluded.order_ids_json,
      batches_json = excluded.batches_json,
      requirements_json = excluded.requirements_json,
      warnings_json = excluded.warnings_json,
      approved_by = excluded.approved_by,
      approved_at = excluded.approved_at,
      change_request = excluded.change_request
  `).run(
    plan.id,
    plan.revision,
    plan.status,
    JSON.stringify(plan.orderIds),
    JSON.stringify(plan.batches),
    JSON.stringify(plan.ingredientRequirements),
    JSON.stringify(plan.warnings),
    plan.approvedBy || null,
    plan.approvedAt || null,
    plan.changeRequest || null,
    plan.createdAt,
  );
  return plan;
}

export function deleteOperationalPlan(id: string): boolean {
  const db = getDb();
  const res = db.prepare("DELETE FROM operational_plans WHERE id = ?").run(id);
  return res.changes > 0;
}

// --- M4: Authoritative Operational Tasks ---
export function listOperationalTasks(): ProductionTask[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM operational_tasks").all() as any[];
  return rows.map((r) => ({
    id: r.id,
    planId: r.plan_id,
    batchId: r.batch_id,
    orderIds: JSON.parse(r.order_ids_json),
    kind: r.kind,
    assigneeId: r.assignee_id,
    dueAt: r.due_at,
    status: r.status,
    blockerNote: r.blocker_note || undefined,
  }));
}

export function saveOperationalTasks(tasks: ProductionTask[]): void {
  const db = getDb();
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO operational_tasks (id, plan_id, batch_id, order_ids_json, kind, assignee_id, due_at, status, blocker_note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      blocker_note = excluded.blocker_note,
      assignee_id = excluded.assignee_id,
      due_at = excluded.due_at,
      updated_at = excluded.updated_at
  `);
  for (const t of tasks) {
    insert.run(t.id, t.planId, t.batchId, JSON.stringify(t.orderIds), t.kind, t.assigneeId, t.dueAt, t.status, t.blockerNote || null, now);
  }
}

export function updateOperationalTask(id: string, status: ProductionTask["status"], blockerNote?: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE operational_tasks
    SET status = ?, blocker_note = ?, updated_at = ?
    WHERE id = ?
  `).run(status, blockerNote || null, now, id);
}


export function updateOperationalTaskDetails(
  id: string,
  updates: { status?: ProductionTask["status"]; blockerNote?: string; assigneeId?: string; dueAt?: string }
): ProductionTask | null {
  const db = getDb();
  const now = new Date().toISOString();
  const current = listOperationalTasks().find((t) => t.id === id);
  if (!current) return null;

  const status = updates.status || current.status;
  const blockerNote = updates.blockerNote !== undefined ? updates.blockerNote : current.blockerNote || null;
  const assigneeId = updates.assigneeId || current.assigneeId;
  const dueAt = updates.dueAt || current.dueAt;

  db.prepare(`
    UPDATE operational_tasks
    SET status = ?, blocker_note = ?, assignee_id = ?, due_at = ?, updated_at = ?
    WHERE id = ?
  `).run(status, blockerNote, assigneeId, dueAt, now, id);

  return listOperationalTasks().find((t) => t.id === id) || null;
}

export function deleteOperationalTask(id: string): boolean {
  const db = getDb();
  const res = db.prepare("DELETE FROM operational_tasks WHERE id = ?").run(id);
  return res.changes > 0;
}

// --- M4: Live Agent Statuses ---
export function listAgentLiveStatuses(): AgentLiveStatus[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM agent_live_statuses ORDER BY agent_id ASC").all() as any[];
  return rows.map((r) => ({
    agentId: r.agent_id,
    name: r.name,
    role: r.role,
    status: r.status,
    currentOrderId: r.current_order_id || undefined,
    currentTaskId: r.current_task_id || undefined,
    currentStage: r.current_stage,
    currentActivity: r.current_activity,
    intendedRecipient: r.intended_recipient || undefined,
    waitingFor: r.waiting_for || undefined,
    lastActivityAt: r.last_activity_at,
    errorMessage: r.error_message || undefined,
  }));
}

export function getAgentLiveStatus(agentId: string): AgentLiveStatus | null {
  const db = getDb();
  const r = db.prepare("SELECT * FROM agent_live_statuses WHERE agent_id = ?").get(agentId) as any;
  if (!r) return null;
  return {
    agentId: r.agent_id,
    name: r.name,
    role: r.role,
    status: r.status,
    currentOrderId: r.current_order_id || undefined,
    currentTaskId: r.current_task_id || undefined,
    currentStage: r.current_stage,
    currentActivity: r.current_activity,
    intendedRecipient: r.intended_recipient || undefined,
    waitingFor: r.waiting_for || undefined,
    lastActivityAt: r.last_activity_at,
    errorMessage: r.error_message || undefined,
  };
}

export function upsertAgentLiveStatus(status: AgentLiveStatus): AgentLiveStatus {
  const db = getDb();
  const now = status.lastActivityAt || new Date().toISOString();
  db.prepare(`
    INSERT INTO agent_live_statuses (
      agent_id, name, role, status, current_order_id, current_task_id,
      current_stage, current_activity, intended_recipient, waiting_for, last_activity_at, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET
      name = excluded.name,
      role = excluded.role,
      status = excluded.status,
      current_order_id = excluded.current_order_id,
      current_task_id = excluded.current_task_id,
      current_stage = excluded.current_stage,
      current_activity = excluded.current_activity,
      intended_recipient = excluded.intended_recipient,
      waiting_for = excluded.waiting_for,
      last_activity_at = excluded.last_activity_at,
      error_message = excluded.error_message
  `).run(
    status.agentId,
    status.name,
    status.role,
    status.status,
    status.currentOrderId || null,
    status.currentTaskId || null,
    status.currentStage,
    status.currentActivity,
    status.intendedRecipient || null,
    status.waitingFor || null,
    now,
    status.errorMessage || null,
  );
  return { ...status, lastActivityAt: now };
}

// --- M4: Audit Log ---
export function listAuditLogs(): AuditLogEntry[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100").all() as any[];
  return rows.map((r) => ({
    id: r.id,
    eventType: r.event_type,
    proposedBy: r.proposed_by,
    changeDescription: r.change_description,
    evidence: r.evidence || undefined,
    reason: r.reason || undefined,
    approvedBy: r.approved_by || undefined,
    decisionAt: r.decision_at || undefined,
    executionStatus: r.execution_status,
    previousValue: r.previous_value || undefined,
    newValue: r.new_value || undefined,
    createdAt: r.created_at,
  }));
}

export function recordAuditLog(entry: Omit<AuditLogEntry, "createdAt"> & { createdAt?: string }): AuditLogEntry {
  const db = getDb();
  const now = entry.createdAt || new Date().toISOString();
  db.prepare(`
    INSERT INTO audit_log (
      id, event_type, proposed_by, change_description, evidence, reason,
      approved_by, decision_at, execution_status, previous_value, new_value, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.id,
    entry.eventType,
    entry.proposedBy,
    entry.changeDescription,
    entry.evidence || null,
    entry.reason || null,
    entry.approvedBy || null,
    entry.decisionAt || null,
    entry.executionStatus,
    entry.previousValue || null,
    entry.newValue || null,
    now,
  );
  return { ...entry, createdAt: now };
}

// --- Row Mappers ---
function mapApprovalRow(row: any): ApprovalRequest {
  return {
    id: row.id,
    orderId: row.order_id ?? undefined,
    taskId: row.task_id ?? undefined,
    agentId: row.agent_id,
    agentName: row.agent_name,
    title: row.title,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedBy: row.decided_by ?? undefined,
    decidedAt: row.decided_at ?? undefined,
    decisionNotes: row.decision_notes ?? undefined,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
  };
}

function mapInteractionRow(row: any): ManagerInteraction {
  return {
    id: row.id,
    requestId: row.request_id ?? undefined,
    orderId: row.order_id ?? undefined,
    agentId: row.agent_id,
    agentName: row.agent_name,
    sender: row.sender,
    type: row.type,
    content: row.content,
    createdAt: row.created_at,
  };
}

function mapCollabMessageRow(row: any): CollaborationMessage {
  return {
    id: row.id,
    orderId: row.order_id,
    taskId: row.task_id ?? undefined,
    workflowStage: row.workflow_stage as WorkflowStage,
    senderId: row.sender_id,
    senderName: row.sender_name,
    recipientId: row.recipient_id,
    recipientName: row.recipient_name,
    messageType: row.message_type as any,
    status: row.status as CollaborationStatus,
    content: row.content,
    evidence: row.evidence ?? undefined,
    reason: row.reason ?? undefined,
    referenceId: row.reference_id ?? undefined,
    createdAt: row.created_at,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
  };
}

function mapChallengeRow(row: any): ChallengeRecord {
  return {
    id: row.id,
    orderId: row.order_id,
    challengingAgentId: row.challenging_agent_id,
    targetAgentId: row.target_agent_id,
    issue: row.issue,
    evidence: row.evidence,
    status: row.status as ChallengeStatus,
    revisionSummary: row.revision_summary ?? undefined,
    resolutionNotes: row.resolution_notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWorkflowRow(row: any): OrderWorkflowState {
  return {
    orderId: row.order_id,
    currentStage: row.current_stage as WorkflowStage,
    activeAgentId: row.active_agent_id,
    waitingFor: row.waiting_for,
    revisionCount: row.revision_count,
    status: row.status as CollaborationStatus,
    updatedAt: row.updated_at,
  };
}

// --- M5: Operational Events Storage & Retrieval ---

function mapEventRow(r: any): OperationalEvent {
  return {
    id: r.id,
    eventType: r.event_type as OperationalEventType,
    sourceEntity: r.source_entity,
    sourceId: r.source_id,
    orderId: r.order_id || undefined,
    taskId: r.task_id || undefined,
    payload: JSON.parse(r.payload_json || "{}"),
    responsibleAgentId: r.responsible_agent_id,
    status: r.status as EventProcessingStatus,
    attempts: Number(r.attempts || 0),
    errorMessage: r.error_message || undefined,
    resolutionSummary: r.resolution_summary || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function recordOperationalEvent(event: {
  id?: string;
  eventType: OperationalEventType;
  sourceEntity: string;
  sourceId: string;
  orderId?: string;
  taskId?: string;
  payload: Record<string, any>;
  responsibleAgentId: "order-analyst" | "production-planner" | "inventory-manager" | "staff-task-assigner";
  status?: EventProcessingStatus;
}): OperationalEvent {
  const db = getDb();
  const id = event.id || `evt-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

  // Idempotency check: if event with this ID exists, return existing
  const existing = getOperationalEvent(id);
  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const initialStatus = event.status || "EVENT_RECORDED";

  db.prepare(`
    INSERT INTO operational_events (
      id, event_type, source_entity, source_id, order_id, task_id,
      payload_json, responsible_agent_id, status, attempts, error_message,
      resolution_summary, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)
  `).run(
    id,
    event.eventType,
    event.sourceEntity,
    event.sourceId,
    event.orderId || null,
    event.taskId || null,
    JSON.stringify(event.payload || {}),
    event.responsibleAgentId,
    initialStatus,
    now,
    now
  );

  return getOperationalEvent(id)!;
}

export function getOperationalEvent(id: string): OperationalEvent | null {
  const db = getDb();
  const r = db.prepare("SELECT * FROM operational_events WHERE id = ?").get(id) as any;
  return r ? mapEventRow(r) : null;
}

export function updateOperationalEventStatus(
  id: string,
  status: EventProcessingStatus,
  updates?: { attempts?: number; errorMessage?: string; resolutionSummary?: string }
): OperationalEvent | null {
  const db = getDb();
  const current = getOperationalEvent(id);
  if (!current) return null;

  const now = new Date().toISOString();
  const attempts = updates?.attempts !== undefined ? updates.attempts : current.attempts;
  const errorMessage = updates?.errorMessage !== undefined ? updates.errorMessage : current.errorMessage || null;
  const resolutionSummary = updates?.resolutionSummary !== undefined ? updates.resolutionSummary : current.resolutionSummary || null;

  db.prepare(`
    UPDATE operational_events
    SET status = ?, attempts = ?, error_message = ?, resolution_summary = ?, updated_at = ?
    WHERE id = ?
  `).run(status, attempts, errorMessage, resolutionSummary, now, id);

  return getOperationalEvent(id);
}

export function listOperationalEvents(filters?: {
  status?: EventProcessingStatus;
  eventType?: OperationalEventType;
  orderId?: string;
  limit?: number;
}): OperationalEvent[] {
  const db = getDb();
  const limit = filters?.limit || 100;
  let query = "SELECT * FROM operational_events WHERE 1=1";
  const params: any[] = [];

  if (filters?.status) {
    query += " AND status = ?";
    params.push(filters.status);
  }
  if (filters?.eventType) {
    query += " AND event_type = ?";
    params.push(filters.eventType);
  }
  if (filters?.orderId) {
    query += " AND order_id = ?";
    params.push(filters.orderId);
  }

  query += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  const rows = db.prepare(query).all(...params) as any[];
  return rows.map(mapEventRow);
}

export function getPendingOperationalEvents(maxAttempts: number = 3): OperationalEvent[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM operational_events
    WHERE status IN ('EVENT_RECORDED', 'EVENT_DISPATCHED', 'AGENT_INVESTIGATING')
      AND attempts < ?
    ORDER BY created_at ASC
  `).all(maxAttempts) as any[];
  return rows.map(mapEventRow);
}

// ============================================================
// M6: Proactive Monitoring DB Functions
// ============================================================

function mapCycleRow(r: any): MonitoringCycle {
  return {
    id: r.id,
    agentId: r.agent_id,
    cycleType: r.cycle_type,
    scope: r.scope,
    status: r.status,
    findingsCount: r.findings_count,
    details: r.details_json ? JSON.parse(r.details_json) : undefined,
    errorMessage: r.error_message || undefined,
    startedAt: r.started_at,
    completedAt: r.completed_at || undefined,
  };
}

export function recordMonitoringCycle(cycle: {
  id: string;
  agentId: "order-analyst" | "production-planner" | "inventory-manager" | "staff-task-assigner" | "all";
  cycleType: MonitoringCycleType;
  scope: string;
  status?: "running" | "completed" | "failed";
  details?: Record<string, any>;
}): MonitoringCycle {
  const db = getDb();
  const now = new Date().toISOString();
  const status = cycle.status || "running";

  db.prepare(`
    INSERT INTO monitoring_cycles (
      id, agent_id, cycle_type, scope, status, findings_count, details_json, started_at
    ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    cycle.id,
    cycle.agentId,
    cycle.cycleType,
    cycle.scope,
    status,
    cycle.details ? JSON.stringify(cycle.details) : null,
    now
  );

  return getMonitoringCycle(cycle.id)!;
}

export function getMonitoringCycle(id: string): MonitoringCycle | null {
  const db = getDb();
  const r = db.prepare("SELECT * FROM monitoring_cycles WHERE id = ?").get(id) as any;
  return r ? mapCycleRow(r) : null;
}

export function updateMonitoringCycle(
  id: string,
  updates: {
    status?: "running" | "completed" | "failed";
    findingsCount?: number;
    details?: Record<string, any>;
    errorMessage?: string;
    completedAt?: string;
  }
): MonitoringCycle | null {
  const db = getDb();
  const current = getMonitoringCycle(id);
  if (!current) return null;

  const status = updates.status || current.status;
  const findingsCount = updates.findingsCount !== undefined ? updates.findingsCount : current.findingsCount;
  const details = updates.details ? JSON.stringify(updates.details) : current.details ? JSON.stringify(current.details) : null;
  const errorMessage = updates.errorMessage !== undefined ? updates.errorMessage : current.errorMessage || null;
  const completedAt = updates.completedAt || (updates.status && updates.status !== "running" ? new Date().toISOString() : current.completedAt || null);

  db.prepare(`
    UPDATE monitoring_cycles
    SET status = ?, findings_count = ?, details_json = ?, error_message = ?, completed_at = ?
    WHERE id = ?
  `).run(status, findingsCount, details, errorMessage, completedAt, id);

  return getMonitoringCycle(id);
}

export function listMonitoringCycles(limit: number = 50): MonitoringCycle[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM monitoring_cycles ORDER BY started_at DESC LIMIT ?").all(limit) as any[];
  return rows.map(mapCycleRow);
}

export function getIncompleteMonitoringCycles(): MonitoringCycle[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM monitoring_cycles WHERE status = 'running' ORDER BY started_at ASC").all() as any[];
  return rows.map(mapCycleRow);
}

function mapIssueRow(r: any): ProactiveIssue {
  return {
    id: r.id,
    category: r.category,
    responsibleAgentId: r.responsible_agent_id,
    status: r.status,
    severity: r.severity,
    orderId: r.order_id || undefined,
    taskId: r.task_id || undefined,
    ingredientId: r.ingredient_id || undefined,
    planId: r.plan_id || undefined,
    title: r.title,
    evidence: r.evidence,
    impact: r.impact,
    recommendedAction: r.recommended_action,
    assignedTo: r.assigned_to,
    fingerprint: r.fingerprint,
    currentValue: r.current_value || undefined,
    thresholdValue: r.threshold_value || undefined,
    discordMessageId: r.discord_message_id || undefined,
    lastNotifiedAt: r.last_notified_at || undefined,
    notificationCount: r.notification_count || 0,
    lastCheckedAt: r.last_checked_at,
    resolutionEvidence: r.resolution_evidence || undefined,
    resolvedAt: r.resolved_at || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function upsertProactiveIssue(issue: Omit<ProactiveIssue, "createdAt" | "updatedAt"> & { createdAt?: string }): ProactiveIssue {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = getProactiveIssueByFingerprint(issue.fingerprint, false);

  if (existing) {
    db.prepare(`
      UPDATE proactive_issues
      SET category = ?, responsible_agent_id = ?, status = ?, severity = ?,
          order_id = ?, task_id = ?, ingredient_id = ?, plan_id = ?,
          title = ?, evidence = ?, impact = ?, recommended_action = ?,
          assigned_to = ?, current_value = ?, threshold_value = ?,
          discord_message_id = COALESCE(?, discord_message_id),
          last_notified_at = COALESCE(?, last_notified_at),
          notification_count = notification_count + ?,
          last_checked_at = ?, resolution_evidence = ?, resolved_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      issue.category,
      issue.responsibleAgentId,
      issue.status,
      issue.severity,
      issue.orderId || null,
      issue.taskId || null,
      issue.ingredientId || null,
      issue.planId || null,
      issue.title,
      issue.evidence,
      issue.impact,
      issue.recommendedAction,
      issue.assignedTo,
      issue.currentValue || null,
      issue.thresholdValue || null,
      issue.discordMessageId || null,
      issue.lastNotifiedAt || null,
      issue.notificationCount > existing.notificationCount ? (issue.notificationCount - existing.notificationCount) : 0,
      issue.lastCheckedAt || now,
      issue.resolutionEvidence || null,
      issue.resolvedAt || null,
      now,
      existing.id
    );
    return getProactiveIssue(existing.id)!;
  }

  const createdAt = issue.createdAt || now;
  db.prepare(`
    INSERT INTO proactive_issues (
      id, category, responsible_agent_id, status, severity,
      order_id, task_id, ingredient_id, plan_id,
      title, evidence, impact, recommended_action,
      assigned_to, fingerprint, current_value, threshold_value,
      discord_message_id, last_notified_at, notification_count,
      last_checked_at, resolution_evidence, resolved_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    issue.id,
    issue.category,
    issue.responsibleAgentId,
    issue.status,
    issue.severity,
    issue.orderId || null,
    issue.taskId || null,
    issue.ingredientId || null,
    issue.planId || null,
    issue.title,
    issue.evidence,
    issue.impact,
    issue.recommendedAction,
    issue.assignedTo,
    issue.fingerprint,
    issue.currentValue || null,
    issue.thresholdValue || null,
    issue.discordMessageId || null,
    issue.lastNotifiedAt || null,
    issue.notificationCount || 0,
    issue.lastCheckedAt || now,
    issue.resolutionEvidence || null,
    issue.resolvedAt || null,
    createdAt,
    now
  );

  return getProactiveIssue(issue.id)!;
}

export function getProactiveIssue(id: string): ProactiveIssue | null {
  const db = getDb();
  const r = db.prepare("SELECT * FROM proactive_issues WHERE id = ?").get(id) as any;
  return r ? mapIssueRow(r) : null;
}

export function getProactiveIssueByFingerprint(fingerprint: string, activeOnly: boolean = true): ProactiveIssue | null {
  const db = getDb();
  let query = "SELECT * FROM proactive_issues WHERE fingerprint = ?";
  if (activeOnly) {
    query += " AND status NOT IN ('RESOLVED', 'FAILED')";
  }
  query += " ORDER BY created_at DESC LIMIT 1";
  const r = db.prepare(query).get(fingerprint) as any;
  return r ? mapIssueRow(r) : null;
}

export function listProactiveIssues(filters?: {
  status?: IssueStatus;
  responsibleAgentId?: string;
  orderId?: string;
  activeOnly?: boolean;
  limit?: number;
}): ProactiveIssue[] {
  const db = getDb();
  const limit = filters?.limit || 100;
  let query = "SELECT * FROM proactive_issues WHERE 1=1";
  const params: any[] = [];

  if (filters?.status) {
    query += " AND status = ?";
    params.push(filters.status);
  } else if (filters?.activeOnly) {
    query += " AND status NOT IN ('RESOLVED', 'FAILED')";
  }
  if (filters?.responsibleAgentId) {
    query += " AND responsible_agent_id = ?";
    params.push(filters.responsibleAgentId);
  }
  if (filters?.orderId) {
    query += " AND order_id = ?";
    params.push(filters.orderId);
  }

  query += " ORDER BY updated_at DESC LIMIT ?";
  params.push(limit);

  const rows = db.prepare(query).all(...params) as any[];
  return rows.map(mapIssueRow);
}

export function resolveProactiveIssue(idOrFingerprint: string, evidence: string): ProactiveIssue | null {
  const db = getDb();
  const now = new Date().toISOString();
  const target = getProactiveIssue(idOrFingerprint) || getProactiveIssueByFingerprint(idOrFingerprint, true);
  if (!target) return null;

  db.prepare(`
    UPDATE proactive_issues
    SET status = 'RESOLVED', resolution_evidence = ?, resolved_at = ?, updated_at = ?
    WHERE id = ?
  `).run(evidence, now, now, target.id);

  return getProactiveIssue(target.id);
}

export function updateProactiveIssue(id: string, updates: Partial<ProactiveIssue>): ProactiveIssue | null {
  const db = getDb();
  const current = getProactiveIssue(id);
  if (!current) return null;

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE proactive_issues
    SET status = COALESCE(?, status),
        severity = COALESCE(?, severity),
        evidence = COALESCE(?, evidence),
        impact = COALESCE(?, impact),
        recommended_action = COALESCE(?, recommended_action),
        current_value = COALESCE(?, current_value),
        discord_message_id = COALESCE(?, discord_message_id),
        last_notified_at = COALESCE(?, last_notified_at),
        notification_count = COALESCE(?, notification_count),
        last_checked_at = ?,
        resolution_evidence = COALESCE(?, resolution_evidence),
        resolved_at = COALESCE(?, resolved_at),
        updated_at = ?
    WHERE id = ?
  `).run(
    updates.status || null,
    updates.severity || null,
    updates.evidence || null,
    updates.impact || null,
    updates.recommendedAction || null,
    updates.currentValue || null,
    updates.discordMessageId || null,
    updates.lastNotifiedAt || null,
    updates.notificationCount !== undefined ? updates.notificationCount : null,
    updates.lastCheckedAt || now,
    updates.resolutionEvidence || null,
    updates.resolvedAt || null,
    now,
    id
  );

  return getProactiveIssue(id);
}

export function getAgentMonitoringStatus(agentId: string): AgentMonitoringStatusRecord | null {
  const db = getDb();
  const r = db.prepare("SELECT * FROM agent_monitoring_status WHERE agent_id = ?").get(agentId) as any;
  if (!r) return null;
  return {
    agentId: r.agent_id,
    lastSuccessfulCheck: r.last_successful_check || undefined,
    nextDueCheck: r.next_due_check || undefined,
    currentStatus: r.current_status || "IDLE",
    lastCycleType: r.last_cycle_type || undefined,
    failureReason: r.failure_reason || undefined,
    updatedAt: r.updated_at,
  };
}

export function listAgentMonitoringStatuses(): AgentMonitoringStatusRecord[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM agent_monitoring_status ORDER BY agent_id ASC").all() as any[];
  return rows.map((r) => ({
    agentId: r.agent_id,
    lastSuccessfulCheck: r.last_successful_check || undefined,
    nextDueCheck: r.next_due_check || undefined,
    currentStatus: r.current_status || "IDLE",
    lastCycleType: r.last_cycle_type || undefined,
    failureReason: r.failure_reason || undefined,
    updatedAt: r.updated_at,
  }));
}

export function updateAgentMonitoringStatus(
  agentId: string,
  updates: Partial<AgentMonitoringStatusRecord>
): AgentMonitoringStatusRecord {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = getAgentMonitoringStatus(agentId);

  if (existing) {
    db.prepare(`
      UPDATE agent_monitoring_status
      SET last_successful_check = COALESCE(?, last_successful_check),
          next_due_check = COALESCE(?, next_due_check),
          current_status = COALESCE(?, current_status),
          last_cycle_type = COALESCE(?, last_cycle_type),
          failure_reason = ?,
          updated_at = ?
      WHERE agent_id = ?
    `).run(
      updates.lastSuccessfulCheck || null,
      updates.nextDueCheck || null,
      updates.currentStatus || null,
      updates.lastCycleType || null,
      updates.failureReason !== undefined ? updates.failureReason : existing.failureReason || null,
      now,
      agentId
    );
  } else {
    db.prepare(`
      INSERT INTO agent_monitoring_status (
        agent_id, last_successful_check, next_due_check, current_status, last_cycle_type, failure_reason, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      agentId,
      updates.lastSuccessfulCheck || null,
      updates.nextDueCheck || null,
      updates.currentStatus || "IDLE",
      updates.lastCycleType || null,
      updates.failureReason || null,
      now
    );
  }

  return getAgentMonitoringStatus(agentId)!;
}

export function enqueuePendingDiscordNotification(item: {
  id: string;
  agentId: string;
  targetNames?: string[];
  body: string;
  eventId?: string;
  issueId?: string;
  maxAttempts?: number;
}): PendingDiscordNotification {
  const db = getDb();
  const now = new Date().toISOString();
  const maxAttempts = item.maxAttempts || 5;

  db.prepare(`
    INSERT INTO pending_discord_notifications (
      id, agent_id, target_names_json, body, event_id, issue_id, attempts, max_attempts, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'PENDING', ?)
  `).run(
    item.id,
    item.agentId,
    item.targetNames ? JSON.stringify(item.targetNames) : null,
    item.body,
    item.eventId || null,
    item.issueId || null,
    maxAttempts,
    now
  );

  return {
    id: item.id,
    agentId: item.agentId,
    targetNames: item.targetNames,
    body: item.body,
    eventId: item.eventId,
    issueId: item.issueId,
    attempts: 0,
    maxAttempts,
    status: "PENDING",
    createdAt: now,
  };
}

export function listPendingDiscordNotifications(maxAttempts: number = 5): PendingDiscordNotification[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM pending_discord_notifications
    WHERE status = 'PENDING' AND attempts < ?
    ORDER BY created_at ASC
  `).all(maxAttempts) as any[];

  return rows.map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    targetNames: r.target_names_json ? JSON.parse(r.target_names_json) : undefined,
    body: r.body,
    eventId: r.event_id || undefined,
    issueId: r.issue_id || undefined,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    lastError: r.last_error || undefined,
    status: r.status,
    createdAt: r.created_at,
    sentAt: r.sent_at || undefined,
  }));
}

export function updatePendingDiscordNotification(
  id: string,
  updates: { status?: "PENDING" | "SENT" | "FAILED"; attempts?: number; lastError?: string; sentAt?: string }
): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE pending_discord_notifications
    SET status = COALESCE(?, status),
        attempts = COALESCE(?, attempts),
        last_error = ?,
        sent_at = COALESCE(?, sent_at)
    WHERE id = ?
  `).run(
    updates.status || null,
    updates.attempts !== undefined ? updates.attempts : null,
    updates.lastError || null,
    updates.sentAt || null,
    id
  );
}

// ==========================================
// M7: Inventory Consumption & Order Closure Functions
// ==========================================

export function listInventoryConsumptions(orderId?: string): InventoryConsumption[] {
  const db = getDb();
  const rows = orderId
    ? (db.prepare(`SELECT * FROM inventory_consumptions WHERE order_id = ? ORDER BY created_at ASC`).all(orderId) as any[])
    : (db.prepare(`SELECT * FROM inventory_consumptions ORDER BY created_at DESC`).all() as any[]);

  return rows.map((r) => ({
    id: r.id,
    orderId: r.order_id,
    planId: r.plan_id,
    consumptionRef: r.consumption_ref,
    ingredientId: r.ingredient_id,
    quantityConsumed: r.quantity_consumed,
    unit: r.unit,
    previousStock: r.previous_stock,
    resultingStock: r.resulting_stock,
    reason: r.reason,
    performedBy: r.performed_by,
    createdAt: r.created_at,
  }));
}

export function consumeInventoryForOrder(params: {
  orderId: string;
  performedBy?: string;
  requirements?: Array<{ ingredientId: string; name?: string; quantity: number; unit: string }>;
}): {
  success: boolean;
  alreadyConsumed?: boolean;
  order: BakeryOrder;
  consumptions: InventoryConsumption[];
} {
  const order = getOperationalOrder(params.orderId);
  if (!order) {
    throw new Error(`Order ${params.orderId} not found`);
  }

  // Idempotency: check if already consumed
  const existing = listInventoryConsumptions(params.orderId);
  if (existing.length > 0) {
    return {
      success: true,
      alreadyConsumed: true,
      order,
      consumptions: existing,
    };
  }

  let reqs = params.requirements;
  if (!reqs || reqs.length === 0) {
    // Deterministic calculation from recipes
    const inventory = listOperationalInventory();
    reqs = calculateIngredientRequirements([order], recipes, inventory);
  }

  // Pre-validate stock sufficiency (no silent negatives, no guessing)
  for (const req of reqs) {
    const item = getOperationalInventoryItem(req.ingredientId);
    if (!item) {
      throw new Error(`Required ingredient "${req.name || req.ingredientId}" not found in inventory`);
    }
    if (item.onHand < req.quantity) {
      throw new Error(
        `Insufficient stock for ${item.name}: required ${req.quantity} ${req.unit}, available ${item.onHand} ${item.baseUnit}`
      );
    }
  }

  const db = getDb();
  const now = new Date().toISOString();
  const actor = params.performedBy || "hadishanavas7454";
  const consumptions: InventoryConsumption[] = [];

  const tx = db.transaction(() => {
    // Re-check idempotency inside lock
    const inLockCheck = db.prepare("SELECT id FROM inventory_consumptions WHERE order_id = ?").all(params.orderId);
    if (inLockCheck.length > 0) return;

    for (const req of reqs!) {
      const item = getOperationalInventoryItem(req.ingredientId)!;
      const prevStock = item.onHand;
      const newStock = Math.max(0, prevStock - req.quantity);
      const consId = `cons-${crypto.randomUUID()}`;
      const consRef = `consume:${params.orderId}:${req.ingredientId}`;

      db.prepare(`
        INSERT INTO inventory_consumptions (
          id, order_id, plan_id, consumption_ref, ingredient_id, quantity_consumed,
          unit, previous_stock, resulting_stock, reason, performed_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        consId,
        params.orderId,
        `plan-${params.orderId}`,
        consRef,
        req.ingredientId,
        req.quantity,
        req.unit,
        prevStock,
        newStock,
        "PRODUCTION_CONSUMPTION",
        actor,
        now
      );

      db.prepare(`
        INSERT INTO inventory_adjustments (
          id, ingredient_id, ingredient_name, previous_quantity, adjustment_amount,
          new_quantity, unit, reason, performed_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `adj-${crypto.randomUUID()}`,
        req.ingredientId,
        item.name,
        prevStock,
        -req.quantity,
        newStock,
        req.unit,
        "PRODUCTION_CONSUMPTION",
        actor,
        now
      );

      db.prepare("UPDATE operational_inventory SET on_hand = ?, updated_at = ? WHERE id = ?").run(
        newStock,
        now,
        req.ingredientId
      );

      consumptions.push({
        id: consId,
        orderId: params.orderId,
        planId: `plan-${params.orderId}`,
        consumptionRef: consRef,
        ingredientId: req.ingredientId,
        quantityConsumed: req.quantity,
        unit: req.unit,
        previousStock: prevStock,
        resultingStock: newStock,
        reason: "PRODUCTION_CONSUMPTION",
        performedBy: actor,
        createdAt: now,
      });
    }

    db.prepare("UPDATE operational_orders SET status = ?, updated_at = ? WHERE id = ?").run(
      "readyForDelivery",
      now,
      params.orderId
    );

    db.prepare(`
      INSERT INTO audit_log (
        id, event_type, proposed_by, change_description, evidence, reason,
        approved_by, decision_at, execution_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `audit-${crypto.randomUUID()}`,
      "INVENTORY_CONSUMPTION_EXECUTED",
      actor,
      `Deducted ${consumptions.length} ingredients for Order ${params.orderId} (${order.customerName})`,
      JSON.stringify(consumptions.map((c) => ({ item: c.ingredientId, qty: c.quantityConsumed, unit: c.unit }))),
      "Manager confirmed production complete",
      actor,
      now,
      "EXECUTED",
      now
    );
  });

  tx();

  const updatedOrder = getOperationalOrder(params.orderId)!;
  return {
    success: true,
    alreadyConsumed: false,
    order: updatedOrder,
    consumptions: listInventoryConsumptions(params.orderId),
  };
}

export function confirmOrderDelivery(orderId: string, performedBy?: string): {
  success: boolean;
  alreadyDelivered?: boolean;
  order: BakeryOrder;
} {
  const order = getOperationalOrder(orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);

  if (order.status === "delivered" || order.status === "closed") {
    return { success: true, alreadyDelivered: true, order };
  }

  const db = getDb();
  const now = new Date().toISOString();
  const actor = performedBy || "hadishanavas7454";

  db.prepare("UPDATE operational_orders SET status = ?, updated_at = ? WHERE id = ?").run(
    "delivered",
    now,
    orderId
  );

  db.prepare(`
    INSERT INTO audit_log (
      id, event_type, proposed_by, change_description, evidence, reason,
      approved_by, decision_at, execution_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `audit-${crypto.randomUUID()}`,
    "ORDER_DELIVERY_CONFIRMED",
    actor,
    `Delivery confirmed for Order ${orderId} (${order.customerName})`,
    `Delivery completed at ${now}`,
    "Manager delivery confirmation",
    actor,
    now,
    "EXECUTED",
    now
  );

  return { success: true, alreadyDelivered: false, order: getOperationalOrder(orderId)! };
}

export function closeOperationalOrder(orderId: string, performedBy?: string): {
  success: boolean;
  alreadyClosed?: boolean;
  order: BakeryOrder;
} {
  const order = getOperationalOrder(orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);

  if (order.status === "closed") {
    return { success: true, alreadyClosed: true, order };
  }

  const db = getDb();
  const now = new Date().toISOString();
  const actor = performedBy || "hadishanavas7454";

  db.prepare("UPDATE operational_orders SET status = ?, updated_at = ? WHERE id = ?").run(
    "closed",
    now,
    orderId
  );

  db.prepare(`
    INSERT INTO audit_log (
      id, event_type, proposed_by, change_description, evidence, reason,
      approved_by, decision_at, execution_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `audit-${crypto.randomUUID()}`,
    "ORDER_CLOSED",
    actor,
    `Order ${orderId} (${order.customerName}) closed and archived from active roster`,
    `Closed by manager authorization at ${now}`,
    "Manager closure authorization",
    actor,
    now,
    "EXECUTED",
    now
  );

  return { success: true, alreadyClosed: false, order: getOperationalOrder(orderId)! };
}
