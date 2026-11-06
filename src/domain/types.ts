export type ProductId = "sourdough" | "cinnamon-roll" | "croissant";
export type IngredientId =
  | "bread-flour"
  | "water"
  | "starter"
  | "salt"
  | "milk"
  | "sugar"
  | "butter"
  | "yeast"
  | (string & {});

export type OrderStatus =
  | "draft"
  | "submitted"
  | "planned"
  | "inProduction"
  | "waitingForProductionConfirmation"
  | "readyForDelivery"
  | "waitingForDeliveryConfirmation"
  | "delivered"
  | "waitingForClosureApproval"
  | "closed"
  | "complete"
  | "needsAttention";
export type PlanStatus = "proposed" | "changesRequested" | "approved" | "inProgress" | "complete";
export type TaskStatus = "todo" | "inProgress" | "blocked" | "done";
export type TaskKind = "prep" | "bake" | "pack";

export type StockStatus = "inStock" | "lowStock" | "outOfStock";

export interface Ingredient {
  id: IngredientId;
  name: string;
  baseUnit: "g" | "ml" | "kg" | "l" | "units" | (string & {});
  onHand: number;
  reorderAt: number;
  archived?: boolean;
  status?: StockStatus;
  updatedAt?: string;
}

export interface InventoryAdjustment {
  id: string;
  ingredientId: string;
  ingredientName: string;
  previousQuantity: number;
  adjustmentAmount: number;
  newQuantity: number;
  unit: string;
  reason: string;
  performedBy: string;
  createdAt: string;
}

export interface RecipeIngredient {
  ingredientId: IngredientId;
  quantity: number;
}

export interface Recipe {
  productId: ProductId;
  name: string;
  yieldQuantity: number;
  yieldUnit: "loaves" | "rolls" | "croissants";
  ingredients: RecipeIngredient[];
  prepMinutes: number;
  bakeMinutes: number;
}

export interface StaffMember {
  id: string;
  name: string;
  role: "manager" | "baker" | "packer";
  availableFrom: string;
  availableUntil: string;
  taskCapacity: number;
}

export interface OrderLine {
  productId: ProductId;
  quantity: number;
}

export interface BakeryOrder {
  id: string;
  customerName: string;
  items: OrderLine[];
  dueAt: string;
  note?: string;
  status: OrderStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface IngredientRequirement {
  ingredientId: IngredientId;
  name: string;
  quantity: number;
  unit: "g" | "ml" | "kg" | "l" | "units" | (string & {});
  onHand: number;
  shortage: number;
}

export interface ProductionBatch {
  id: string;
  productId: ProductId;
  orderIds: string[];
  requestedQuantity: number;
  plannedQuantity: number;
  recipeBatchCount: number;
  dueAt: string;
  startAt: string;
  endAt: string;
  assignedStaffId: string;
}

export interface PlanWarning {
  id: string;
  severity: "warning" | "info";
  message: string;
}

export interface ProductionPlan {
  id: string;
  revision: number;
  createdAt: string;
  status: PlanStatus;
  orderIds: string[];
  ingredientRequirements: IngredientRequirement[];
  batches: ProductionBatch[];
  warnings: PlanWarning[];
  approvedBy?: string;
  approvedAt?: string;
  changeRequest?: string;
  isStale?: boolean;
}

export interface ProductionTask {
  id: string;
  planId: string;
  batchId: string;
  orderIds: string[];
  kind: TaskKind;
  assigneeId: string;
  dueAt: string;
  status: TaskStatus;
  blockerNote?: string;
}

export interface BakeryState {
  orders: BakeryOrder[];
  plans: ProductionPlan[];
  tasks: ProductionTask[];
}

export type ApprovalStatus =
  | "WAITING_FOR_MANAGER"
  | "APPROVED"
  | "REJECTED"
  | "REVISION_REQUIRED"
  | "COMPLETED";

export interface ApprovalRequest {
  id: string;
  orderId?: string;
  taskId?: string;
  agentId: string;
  agentName: string;
  title: string;
  description: string;
  status: ApprovalStatus;
  createdAt: string;
  updatedAt: string;
  decidedBy?: string;
  decidedAt?: string;
  decisionNotes?: string;
  metadata?: Record<string, unknown>;
}

export type InteractionType =
  | "question"
  | "answer"
  | "instruction"
  | "approval_request"
  | "decision"
  | "challenge"
  | "explanation";

export interface ManagerInteraction {
  id: string;
  requestId?: string;
  orderId?: string;
  agentId: string;
  agentName: string;
  sender: "manager" | "agent";
  type: InteractionType;
  content: string;
  createdAt: string;
}

export type CollaborationMessageType =
  | "TASK_REQUEST"
  | "QUESTION"
  | "FINDING"
  | "CHALLENGE"
  | "RESPONSE"
  | "REVISION"
  | "HANDOFF"
  | "APPROVAL_REQUEST"
  | "RESOLVED"
  | "ALERT";

export type CollaborationStatus =
  | "IN_PROGRESS"
  | "WAITING_FOR_AGENT"
  | "WAITING_FOR_MANAGER"
  | "CHALLENGED"
  | "REVISION_REQUIRED"
  | "APPROVED"
  | "COMPLETED"
  | "BLOCKED";

export type WorkflowStage =
  | "intake"
  | "production_planning"
  | "inventory_verification"
  | "final_validation"
  | "manager_approval"
  | "staff_assignment"
  | "completed"
  | "blocked";

export interface CollaborationMessage {
  id: string;
  orderId: string;
  taskId?: string;
  workflowStage: WorkflowStage;
  senderId: string;
  senderName: string;
  recipientId: string;
  recipientName: string;
  messageType: CollaborationMessageType;
  status: CollaborationStatus;
  content: string;
  evidence?: string;
  reason?: string;
  referenceId?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export type ChallengeStatus =
  | "OPEN"
  | "INVESTIGATING"
  | "REVISION_PROVIDED"
  | "RESOLVED"
  | "ESCALATED_TO_MANAGER";

export interface ChallengeRecord {
  id: string;
  orderId: string;
  challengingAgentId: string;
  targetAgentId: string;
  issue: string;
  evidence: string;
  status: ChallengeStatus;
  revisionSummary?: string;
  resolutionNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderWorkflowState {
  orderId: string;
  currentStage: WorkflowStage;
  activeAgentId: string;
  waitingFor: string;
  revisionCount: number;
  status: CollaborationStatus;
  updatedAt: string;
}

export type AgentStatusType =
  | "IDLE"
  | "WORKING"
  | "COMMUNICATING"
  | "WAITING_FOR_AGENT"
  | "WAITING_FOR_MANAGER"
  | "CHALLENGED"
  | "REVISION_REQUIRED"
  | "BLOCKED"
  | "COMPLETED"
  | "ERROR";

export interface AgentLiveStatus {
  agentId: string;
  name: string;
  role: string;
  status: AgentStatusType;
  currentOrderId?: string;
  currentTaskId?: string;
  currentStage: WorkflowStage;
  currentActivity: string;
  intendedRecipient?: string;
  waitingFor?: string;
  lastActivityAt: string;
  errorMessage?: string;
}

export type AuditExecutionStatus =
  | "PROPOSED"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "EXECUTED"
  | "REJECTED";

export interface AuditLogEntry {
  id: string;
  eventType: string;
  proposedBy: string;
  changeDescription: string;
  evidence?: string;
  reason?: string;
  approvedBy?: string;
  decisionAt?: string;
  executionStatus: AuditExecutionStatus;
  previousValue?: string;
  newValue?: string;
  createdAt: string;
}

// --- M5: Event-Driven Intelligence Types ---
export type OperationalEventType =
  | "ORDER_CREATED"
  | "ORDER_QUANTITY_CHANGED"
  | "ORDER_DEADLINE_CHANGED"
  | "ORDER_CANCELLED"
  | "INVENTORY_ITEM_CREATED"
  | "INVENTORY_STOCK_ADJUSTED"
  | "INVENTORY_ITEM_DETAILS_CHANGED"
  | "INVENTORY_ITEM_ARCHIVED"
  | "INVENTORY_ITEM_RESTORED"
  | "PRODUCTION_PLAN_CREATED"
  | "PRODUCTION_PLAN_MODIFIED"
  | "STAFF_TASK_CREATED"
  | "STAFF_TASK_CHANGED"
  | "STAFF_TASK_BLOCKED"
  | "STAFF_TASK_OVERDUE"
  | "STAFF_SCHEDULE_CHANGED";

export type EventProcessingStatus =
  | "EVENT_RECORDED"
  | "EVENT_DISPATCHED"
  | "AGENT_INVESTIGATING"
  | "COLLABORATION_IN_PROGRESS"
  | "WAITING_FOR_MANAGER"
  | "RESOLVED"
  | "ACTION_AUTHORIZED"
  | "COMPLETED"
  | "BLOCKED"
  | "FAILED";

export interface OperationalEvent {
  id: string;
  eventType: OperationalEventType;
  sourceEntity: "order" | "inventory" | "plan" | "task" | "staff" | string;
  sourceId: string;
  orderId?: string;
  taskId?: string;
  payload: Record<string, any>;
  responsibleAgentId: "order-analyst" | "production-planner" | "inventory-manager" | "staff-task-assigner";
  status: EventProcessingStatus;
  attempts: number;
  errorMessage?: string;
  resolutionSummary?: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// M6: Proactive Monitoring & Predictive Intelligence Types
// ============================================================

export type IssueStatus =
  | "DETECTED"
  | "INVESTIGATING"
  | "WAITING_FOR_AGENT"
  | "WAITING_FOR_MANAGER"
  | "ACTION_REQUIRED"
  | "MONITORING"
  | "RESOLVED"
  | "BLOCKED"
  | "FAILED";

export type IssueSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type IssueCategory =
  | "INVENTORY_DANGER_ZONE"
  | "INVENTORY_SHORTAGE"
  | "INGREDIENT_MISSING"
  | "ORDER_DEADLINE_APPROACHING"
  | "ORDER_STALLED"
  | "TASK_OVERDUE"
  | "TASK_BLOCKED"
  | "TASK_STALLED"
  | "PRODUCTION_BOTTLENECK"
  | "PRODUCTION_FEASIBILITY";

export interface ProactiveIssue {
  id: string;
  category: IssueCategory;
  responsibleAgentId: "order-analyst" | "production-planner" | "inventory-manager" | "staff-task-assigner";
  status: IssueStatus;
  severity: IssueSeverity;
  orderId?: string;
  taskId?: string;
  ingredientId?: string;
  planId?: string;
  title: string;
  evidence: string;
  impact: string;
  recommendedAction: string;
  assignedTo: string;
  fingerprint: string;
  currentValue?: string;
  thresholdValue?: string;
  discordMessageId?: string;
  lastNotifiedAt?: string;
  notificationCount: number;
  lastCheckedAt: string;
  resolutionEvidence?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type MonitoringCycleType = "scheduled" | "time_sensitive" | "event_triggered";

export interface MonitoringCycle {
  id: string;
  agentId: "order-analyst" | "production-planner" | "inventory-manager" | "staff-task-assigner" | "all";
  cycleType: MonitoringCycleType;
  scope: string;
  status: "running" | "completed" | "failed";
  findingsCount: number;
  details?: Record<string, any>;
  errorMessage?: string;
  startedAt: string;
  completedAt?: string;
}

export interface AgentMonitoringStatusRecord {
  agentId: "order-analyst" | "production-planner" | "inventory-manager" | "staff-task-assigner";
  lastSuccessfulCheck?: string;
  nextDueCheck?: string;
  currentStatus: "IDLE" | "CHECKING" | "ACTION_REQUIRED" | "ERROR";
  lastCycleType?: MonitoringCycleType;
  failureReason?: string;
  updatedAt: string;
}

export interface PendingDiscordNotification {
  id: string;
  agentId: string;
  targetNames?: string[];
  body: string;
  eventId?: string;
  issueId?: string;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  status: "PENDING" | "SENT" | "FAILED";
  createdAt: string;
  sentAt?: string;
}

export interface InventoryConsumption {
  id: string;
  orderId: string;
  planId: string;
  consumptionRef: string;
  ingredientId: string;
  quantityConsumed: number;
  unit: string;
  previousStock: number;
  resultingStock: number;
  reason: string;
  performedBy: string;
  createdAt: string;
}

export type SpecialistAgentKey = "order-analyst" | "production-planner" | "inventory-manager" | "staff-task-assigner";
