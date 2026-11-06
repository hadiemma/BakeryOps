/**
 * BakeryOps AI - Clean Database Seeder
 * 
 * Sets up a fresh, pristine SQLite database with canonical bakery ingredients
 * and standby agent statuses. Safe for hackathon judges and new developers.
 *
 * Usage:
 *   npm run seed
 *   or
 *   node scripts/seed.js [--reset]
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'bakeryops.sqlite');
console.log('Connecting to database:', dbPath);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Execute full schema
db.exec(`
  CREATE TABLE IF NOT EXISTS operational_inventory (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_unit TEXT NOT NULL,
    on_hand REAL NOT NULL,
    reorder_at REAL NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS operational_orders (
    id TEXT PRIMARY KEY,
    customer_name TEXT NOT NULL,
    items_json TEXT NOT NULL,
    due_at TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL,
    workflow_state TEXT NOT NULL DEFAULT 'received',
    created_at TEXT NOT NULL,
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

  CREATE TABLE IF NOT EXISTS inventory_consumptions (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    plan_id TEXT,
    ingredient_id TEXT NOT NULL,
    quantity_deducted REAL NOT NULL,
    unit TEXT NOT NULL,
    consumed_at TEXT NOT NULL,
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    performed_by TEXT NOT NULL,
    details_json TEXT NOT NULL,
    timestamp TEXT NOT NULL
  );

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

  CREATE TABLE IF NOT EXISTS proactive_issues (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    evidence_json TEXT,
    related_entity_type TEXT,
    related_entity_id TEXT,
    status TEXT NOT NULL,
    resolution_action TEXT,
    resolved_by TEXT,
    resolved_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pending_discord_notifications (
    id TEXT PRIMARY KEY,
    agent_key TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    sent_at TEXT,
    error_message TEXT
  );
`);

const reset = process.argv.includes('--reset');
if (reset) {
  console.log('Clearing existing operational tables (--reset specified)...');
  db.exec(`
    DELETE FROM operational_orders;
    DELETE FROM operational_plans;
    DELETE FROM operational_tasks;
    DELETE FROM inventory_adjustments;
    DELETE FROM inventory_consumptions;
    DELETE FROM audit_log;
    DELETE FROM operational_events;
    DELETE FROM proactive_issues;
    DELETE FROM pending_discord_notifications;
  `);
}

const now = new Date().toISOString();

// Canonical ingredients
const baselineIngredients = [
  { id: 'bread-flour', name: 'Bread flour', base_unit: 'g', on_hand: 16000, reorder_at: 5000 },
  { id: 'water', name: 'Water', base_unit: 'g', on_hand: 10000, reorder_at: 3000 },
  { id: 'starter', name: 'Sourdough starter', base_unit: 'g', on_hand: 2500, reorder_at: 500 },
  { id: 'salt', name: 'Salt', base_unit: 'g', on_hand: 800, reorder_at: 200 },
  { id: 'milk', name: 'Milk', base_unit: 'ml', on_hand: 1000, reorder_at: 300 },
  { id: 'sugar', name: 'Sugar', base_unit: 'g', on_hand: 1000, reorder_at: 250 },
  { id: 'butter', name: 'Butter', base_unit: 'g', on_hand: 2500, reorder_at: 500 },
  { id: 'yeast', name: 'Yeast', base_unit: 'g', on_hand: 300, reorder_at: 75 }
];

const insertInv = db.prepare(`
  INSERT INTO operational_inventory (id, name, base_unit, on_hand, reorder_at, archived, updated_at)
  VALUES (?, ?, ?, ?, ?, 0, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    base_unit = excluded.base_unit,
    on_hand = excluded.on_hand,
    reorder_at = excluded.reorder_at,
    updated_at = excluded.updated_at
`);

for (const ing of baselineIngredients) {
  insertInv.run(ing.id, ing.name, ing.base_unit, ing.on_hand, ing.reorder_at, now);
}

// 4 Specialist Agent initial statuses
const specialistAgents = [
  { id: 'order-analyst', name: 'Order Analyst', role: 'order-analyst' },
  { id: 'production-planner', name: 'Production Planner', role: 'production-planner' },
  { id: 'inventory-manager', name: 'Inventory Manager', role: 'inventory-manager' },
  { id: 'staff-task-assigner', name: 'Staff Task Assigner', role: 'staff-task-assigner' }
];

const insertAgent = db.prepare(`
  INSERT INTO agent_live_statuses (
    agent_id, name, role, status, current_order_id, current_task_id,
    current_stage, current_activity, intended_recipient, waiting_for,
    last_activity_at, error_message
  ) VALUES (?, ?, ?, 'idle', null, null, 'STANDBY', 'Standby. Waiting for the first order.', null, null, ?, null)
  ON CONFLICT(agent_id) DO UPDATE SET
    status = 'idle',
    current_stage = 'STANDBY',
    current_activity = 'Standby. Waiting for the first order.',
    last_activity_at = excluded.last_activity_at
`);

for (const a of specialistAgents) {
  insertAgent.run(a.id, a.name, a.role, now);
}

console.log('✓ Successfully seeded ' + baselineIngredients.length + ' baseline ingredients.');
console.log('✓ Initialized ' + specialistAgents.length + ' specialist agents to standby state.');
console.log('✓ Clean database is ready at: ' + dbPath);
db.close();
