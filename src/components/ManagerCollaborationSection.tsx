"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import type {
  ApprovalRequest,
  ApprovalStatus,
  ManagerInteraction,
  CollaborationMessage,
  ChallengeRecord,
  OrderWorkflowState,
  AgentLiveStatus,
  AuditLogEntry,
  OperationalEvent,
} from "@/domain/types";

const STAGE_LABELS: Record<string, string> = {
  intake: "1. Intake & Validation",
  production_planning: "2. Production Planning",
  inventory_verification: "3. Inventory Verification",
  final_validation: "4. Final Validation",
  manager_approval: "5. Manager Approval",
  staff_assignment: "6. Staff Task Assignment",
  completed: "7. Completed",
  blocked: "Blocked",
};

const AGENT_COLORS: Record<string, { primary: string; bg: string; border: string }> = {
  "order-analyst": { primary: "#2563eb", bg: "#eff6ff", border: "#bfdbfe" },
  "production-planner": { primary: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe" },
  "inventory-manager": { primary: "#059669", bg: "#ecfdf5", border: "#a7f3d0" },
  "staff-task-assigner": { primary: "#d97706", bg: "#fffbeb", border: "#fde68a" },
  manager: { primary: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
};

const MESSAGE_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  TASK_REQUEST: { bg: "#f3e8ff", text: "#6b21a8", border: "#d8b4fe" },
  QUESTION: { bg: "#e0f2fe", text: "#0369a1", border: "#7dd3fc" },
  FINDING: { bg: "#ccfbf1", text: "#0f766e", border: "#5eead4" },
  CHALLENGE: { bg: "#fee2e2", text: "#b91c1c", border: "#fca5a5" },
  RESPONSE: { bg: "#e0e7ff", text: "#3730a3", border: "#a5b4fc" },
  REVISION: { bg: "#fef3c7", text: "#b45309", border: "#fcd34d" },
  HANDOFF: { bg: "#dcfce7", text: "#15803d", border: "#86efac" },
  APPROVAL_REQUEST: { bg: "#ffe4e6", text: "#be123c", border: "#fda4af" },
  RESOLVED: { bg: "#d1fae5", text: "#065f46", border: "#6ee7b7" },
  ALERT: { bg: "#fecaca", text: "#991b1b", border: "#f87171" },
};

export function ManagerCollaborationSection() {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [interactions, setInteractions] = useState<ManagerInteraction[]>([]);
  const [collabMessages, setCollabMessages] = useState<CollaborationMessage[]>([]);
  const [challenges, setChallenges] = useState<ChallengeRecord[]>([]);
  const [workflowStates, setWorkflowStates] = useState<OrderWorkflowState[]>([]);
  const [agentStatuses, setAgentStatuses] = useState<AgentLiveStatus[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [events, setEvents] = useState<OperationalEvent[]>([]);
  const [sseConnected, setSseConnected] = useState(false);

  const [activeTab, setActiveTab] = useState<"visual_flow" | "events" | "approvals" | "challenges" | "audit_log" | "interactions">("visual_flow");

  // Filters
  const [filterAgent, setFilterAgent] = useState("all");
  const [filterOrder, setFilterOrder] = useState("all");
  const [filterType, setFilterType] = useState("all");

  // Response / Instruction draft
  const [selectedAgent, setSelectedAgent] = useState("order-analyst");
  const [instructionType, setInstructionType] = useState<"instruction" | "question">("instruction");
  const [orderIdDraft, setOrderIdDraft] = useState("");
  const [contentDraft, setContentDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Decision draft
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});

  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    fetchAllData();

    // Setup SSE connection for real-time website updates
    if (typeof window !== "undefined" && window.EventSource) {
      try {
        const es = new EventSource("/api/collaboration/events");
        eventSourceRef.current = es;

        es.onopen = () => setSseConnected(true);
        es.onerror = () => {
          setSseConnected(false);
          // Fall back to periodic polling if SSE disconnects
        };

        es.addEventListener("collaboration_message", () => {
          fetchAllData();
        });
        es.addEventListener("challenge_raised", () => {
          fetchAllData();
        });
        es.addEventListener("agent_status_updated", () => {
          fetchAllData();
        });
        es.addEventListener("order_updated", () => {
          fetchAllData();
        });
        es.addEventListener("inventory_updated", () => {
          fetchAllData();
        });
        es.addEventListener("operational_event_recorded", () => {
          fetchAllData();
        });
        es.addEventListener("operational_event_updated", () => {
          fetchAllData();
        });
      } catch {
        setSseConnected(false);
      }
    }

    // Periodic polling fallback (every 4 seconds) to ensure fresh data and recover from network drops
    const interval = setInterval(fetchAllData, 4000);

    return () => {
      clearInterval(interval);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  async function fetchAllData() {
    try {
      const [apprRes, intRes, msgRes, chalRes, wfRes, agentRes, auditRes] = await Promise.all([
        fetch("/api/approvals"),
        fetch("/api/interactions"),
        fetch("/api/collaboration/messages"),
        fetch("/api/collaboration/challenges"),
        fetch("/api/collaboration/workflow"),
        fetch("/api/collaboration/agent-status"),
        fetch("/api/collaboration/audit-log"),
      ]);

      if (apprRes.ok) {
        const data = await apprRes.json();
        setApprovals(data.approvals || []);
      }
      if (intRes.ok) {
        const data = await intRes.json();
        setInteractions(data.interactions || []);
      }
      if (msgRes.ok) {
        const data = await msgRes.json();
        setCollabMessages(data.messages || []);
      }
      if (chalRes.ok) {
        const data = await chalRes.json();
        setChallenges(data.challenges || []);
      }
      if (wfRes.ok) {
        const data = await wfRes.json();
        setWorkflowStates(data.workflowStates || []);
      }
      if (agentRes.ok) {
        const data = await agentRes.json();
        setAgentStatuses(data.agentStatuses || []);
      }
      if (auditRes.ok) {
        const data = await auditRes.json();
        setAuditLogs(data.auditLogs || []);
      }
    } catch {
      // Ignore transient fetch errors
    }
  }

  async function handleDecision(id: string, status: ApprovalStatus) {
    try {
      const notes = decisionNotes[id] || "";
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_status",
          id,
          status,
          decidedBy: "hadishanavas7454 (Manager)",
          decisionNotes: notes,
        }),
      });

      if (res.ok) {
        const appr = approvals.find((a) => a.id === id);
        if (appr) {
          await fetch("/api/interactions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              requestId: id,
              orderId: appr.orderId,
              agentId: appr.agentId,
              agentName: appr.agentName,
              sender: "manager",
              type: "decision",
              content: `Manager marked '${appr.title}' as ${status}.${notes ? ` Note: ${notes}` : ""}`,
            }),
          });

          if (appr.orderId) {
            await fetch("/api/collaboration/messages", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                orderId: appr.orderId,
                workflowStage: "manager_approval",
                senderId: "manager",
                senderName: "hadishanavas7454 (Manager)",
                recipientId: appr.agentId,
                messageType: status === "APPROVED" ? "RESOLVED" : "RESPONSE",
                status: status === "APPROVED" ? "APPROVED" : "REJECTED",
                content: `Manager decision on '${appr.title}': ${status}.${notes ? ` Decision Note: ${notes}` : ""}`,
                reason: "Official human manager authorization record",
                referenceId: id,
              }),
            });
          }
        }
        await fetchAllData();
      }
    } catch (err) {
      console.error("Failed to update approval", err);
    }
  }

  async function handleSendInteraction(e: React.FormEvent) {
    e.preventDefault();
    if (!contentDraft.trim()) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: orderIdDraft.trim() || undefined,
          agentId: selectedAgent,
          agentName: "hadishanavas7454 (Manager)",
          sender: "manager",
          type: instructionType,
          content: contentDraft.trim(),
        }),
      });

      if (res.ok && orderIdDraft.trim()) {
        await fetch("/api/collaboration/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: orderIdDraft.trim(),
            workflowStage: "intake",
            senderId: "manager",
            senderName: "hadishanavas7454 (Manager)",
            recipientId: selectedAgent,
            messageType: instructionType === "question" ? "QUESTION" : "RESPONSE",
            status: "IN_PROGRESS",
            content: contentDraft.trim(),
            reason: "Manager direct direction",
          }),
        });
      }

      if (res.ok) {
        setContentDraft("");
        await fetchAllData();
      }
    } catch (err) {
      console.error("Failed to post interaction", err);
    } finally {
      setSubmitting(false);
    }
  }

  // Filtered collaboration messages
  const filteredMessages = useMemo(() => {
    return collabMessages.filter((m) => {
      if (filterAgent !== "all" && m.senderId !== filterAgent && m.recipientId !== filterAgent) return false;
      if (filterOrder !== "all" && m.orderId !== filterOrder) return false;
      if (filterType !== "all" && m.messageType !== filterType) return false;
      return true;
    });
  }, [collabMessages, filterAgent, filterOrder, filterType]);

  const uniqueOrders = useMemo(() => {
    const set = new Set<string>();
    for (const m of collabMessages) if (m.orderId) set.add(m.orderId);
    return Array.from(set);
  }, [collabMessages]);

  const pendingApprovals = approvals.filter((a) => a.status === "WAITING_FOR_MANAGER");
  const pastApprovals = approvals.filter((a) => a.status !== "WAITING_FOR_MANAGER");
  const openChallenges = challenges.filter((c) => c.status !== "RESOLVED");

  // Recent 5 communication links for visual flow
  const recentFlows = useMemo(() => {
    return collabMessages.slice(-5).reverse();
  }, [collabMessages]);

  return (
    <section
      id="manager-collaboration"
      style={{
        marginTop: "2.5rem",
        marginBottom: "2.5rem",
        background: "#ffffff",
        border: "1px solid #e5e7eb",
        borderRadius: "14px",
        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)",
        overflow: "hidden",
      }}
    >
      {/* Header Bar */}
      <div
        style={{
          padding: "1.25rem 1.5rem",
          background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
          color: "#fff",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <span style={{ fontSize: "1.4rem" }}>⚡</span>
            <h3 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 700, color: "#fff" }}>
              BakeryOps AI Live Operational Control Centre
            </h3>
            <span
              style={{
                fontSize: "0.7rem",
                padding: "0.2rem 0.5rem",
                borderRadius: "9999px",
                background: sseConnected ? "#10b981" : "#f59e0b",
                color: "#fff",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.3rem",
              }}
            >
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#fff" }}></span>
              {sseConnected ? "Live SSE Stream" : "Polling Active (4s)"}
            </span>
          </div>
          <p style={{ margin: "0.3rem 0 0 0", fontSize: "0.85rem", color: "#94a3b8" }}>
            BakeryOps is ready. Waiting for the first order. Real-time multi-agent visibility, visual communication flow, and Discord synchronization.
          </p>
        </div>

        {/* Navigation Tabs */}
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setActiveTab("visual_flow")}
            style={{
              padding: "0.45rem 0.9rem",
              borderRadius: "7px",
              border: "1px solid rgba(255,255,255,0.15)",
              background: activeTab === "visual_flow" ? "#3b82f6" : "rgba(255,255,255,0.08)",
              color: "#fff",
              fontWeight: 600,
              fontSize: "0.85rem",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            Live Visual Flow
          </button>
                    <button
            type="button"
            onClick={() => setActiveTab("events")}
            style={{
              padding: "0.45rem 0.9rem",
              borderRadius: "7px",
              border: "1px solid rgba(255,255,255,0.15)",
              background: activeTab === "events" ? "#3b82f6" : "rgba(255,255,255,0.08)",
              color: "#fff",
              fontWeight: 600,
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            ⚡ Events Intelligence ({events.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("approvals")}
            style={{
              padding: "0.45rem 0.9rem",
              borderRadius: "7px",
              border: "1px solid rgba(255,255,255,0.15)",
              background: activeTab === "approvals" ? "#3b82f6" : "rgba(255,255,255,0.08)",
              color: "#fff",
              fontWeight: 600,
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            Authorizations ({pendingApprovals.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("challenges")}
            style={{
              padding: "0.45rem 0.9rem",
              borderRadius: "7px",
              border: "1px solid rgba(255,255,255,0.15)",
              background: activeTab === "challenges" ? "#3b82f6" : "rgba(255,255,255,0.08)",
              color: "#fff",
              fontWeight: 600,
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            Challenges ({openChallenges.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("audit_log")}
            style={{
              padding: "0.45rem 0.9rem",
              borderRadius: "7px",
              border: "1px solid rgba(255,255,255,0.15)",
              background: activeTab === "audit_log" ? "#3b82f6" : "rgba(255,255,255,0.08)",
              color: "#fff",
              fontWeight: 600,
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            Audit Log ({auditLogs.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("interactions")}
            style={{
              padding: "0.45rem 0.9rem",
              borderRadius: "7px",
              border: "1px solid rgba(255,255,255,0.15)",
              background: activeTab === "interactions" ? "#3b82f6" : "rgba(255,255,255,0.08)",
              color: "#fff",
              fontWeight: 600,
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            Manager Dispatch ({interactions.length})
          </button>
        </div>
      </div>

      <div style={{ padding: "1.5rem" }}>
        {/* --- TAB 1: LIVE VISUAL FLOW & AGENT STATUSES --- */}
        {activeTab === "visual_flow" && (
          <div>
            {/* 1. Live Specialist Status Cards */}
            <div style={{ marginBottom: "1.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                <h4 style={{ margin: 0, fontSize: "1rem", color: "#1e293b", fontWeight: 700 }}>
                  Specialist AI Team Status (Antigravity Provider on Hadis_Buddy)
                </h4>
                <span style={{ fontSize: "0.8rem", color: "#64748b" }}>
                  Synchronized with Discord #bakeryops-operations
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem" }}>
                {agentStatuses.map((agent) => {
                  const conf = AGENT_COLORS[agent.agentId] || { primary: "#4b5563", bg: "#f3f4f6", border: "#e5e7eb" };
                  const isWorking = agent.status === "WORKING" || agent.status === "COMMUNICATING";
                  const isWaiting = agent.status === "WAITING_FOR_AGENT" || agent.status === "WAITING_FOR_MANAGER";
                  const isChallenged = agent.status === "CHALLENGED" || agent.status === "REVISION_REQUIRED";

                  return (
                    <div
                      key={agent.agentId}
                      style={{
                        background: conf.bg,
                        border: `1.5px solid ${conf.border}`,
                        borderRadius: "10px",
                        padding: "1rem",
                        position: "relative",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                        <div>
                          <strong style={{ fontSize: "1rem", color: conf.primary }}>{agent.name}</strong>
                          <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.1rem" }}>{agent.role}</div>
                        </div>
                        <span
                          style={{
                            fontSize: "0.7rem",
                            fontWeight: 700,
                            padding: "0.2rem 0.5rem",
                            borderRadius: "9999px",
                            background: isWorking ? "#10b981" : isChallenged ? "#ef4444" : isWaiting ? "#f59e0b" : "#94a3b8",
                            color: "#fff",
                            textTransform: "uppercase",
                          }}
                        >
                          {agent.status}
                        </span>
                      </div>

                      <div style={{ fontSize: "0.82rem", color: "#334155", marginTop: "0.5rem", minHeight: "2.4rem", lineHeight: 1.35 }}>
                        <strong>Activity:</strong> {agent.currentActivity}
                      </div>

                      <div style={{ marginTop: "0.6rem", paddingTop: "0.6rem", borderTop: `1px solid ${conf.border}`, fontSize: "0.75rem", color: "#64748b", display: "grid", gap: "0.2rem" }}>
                        <div>Stage: <strong style={{ color: "#1e293b" }}>{STAGE_LABELS[agent.currentStage] || agent.currentStage}</strong></div>
                        {agent.currentOrderId && <div>Order: <strong style={{ color: "#1e293b" }}>{agent.currentOrderId}</strong></div>}
                        {agent.waitingFor && <div>Waiting for: <strong style={{ color: "#b91c1c" }}>{agent.waitingFor}</strong></div>}
                        <div style={{ fontSize: "0.7rem", color: "#94a3b8", marginTop: "0.2rem" }}>
                          Last active: {new Date(agent.lastActivityAt).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 2. Visual Agent-to-Agent Communication Flow */}
            <div
              style={{
                marginBottom: "1.75rem",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "10px",
                padding: "1.25rem",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: "1rem", color: "#1e293b", fontWeight: 700, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span>🔄</span> Live Visual Agent-to-Agent Communication Flow
                  </h4>
                  <p style={{ margin: "0.2rem 0 0 0", fontSize: "0.8rem", color: "#64748b" }}>
                    Real-time visual handoffs, requests, and challenges between the 4 independent agents and the Manager.
                  </p>
                </div>
              </div>

              {/* Graphical Network View */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto 1fr",
                  gridTemplateRows: "auto auto auto",
                  gap: "1.25rem 2rem",
                  alignItems: "center",
                  justifyItems: "center",
                  padding: "1rem",
                  background: "#ffffff",
                  borderRadius: "8px",
                  border: "1px solid #e2e8f0",
                }}
              >
                {/* Order Analyst (Top-Left) */}
                <div style={{ textAlign: "center", width: "100%", maxWidth: "220px", padding: "0.75rem", borderRadius: "8px", background: "#eff6ff", border: "2px solid #3b82f6" }}>
                  <div style={{ fontSize: "1.2rem" }}>📋</div>
                  <strong style={{ fontSize: "0.9rem", color: "#1d4ed8" }}>Order Analyst</strong>
                  <div style={{ fontSize: "0.72rem", color: "#64748b" }}>Intake & Customer Validation</div>
                </div>

                {/* Arrow 1: Analyst -> Planner */}
                <div style={{ textAlign: "center", color: "#3b82f6", fontWeight: 700, fontSize: "0.8rem" }}>
                  ➔ HANDOFF ➔
                </div>

                {/* Production Planner (Top-Right) */}
                <div style={{ textAlign: "center", width: "100%", maxWidth: "220px", padding: "0.75rem", borderRadius: "8px", background: "#f5f3ff", border: "2px solid #8b5cf6" }}>
                  <div style={{ fontSize: "1.2rem" }}>⏱️</div>
                  <strong style={{ fontSize: "0.9rem", color: "#6d28d9" }}>Production Planner</strong>
                  <div style={{ fontSize: "0.72rem", color: "#64748b" }}>Batch Sizing & Schedule Feasibility</div>
                </div>

                {/* Arrow Up/Down */}
                <div style={{ textAlign: "center", color: "#ef4444", fontWeight: 700, fontSize: "0.75rem" }}>
                  ▲ APPROVAL_REQUEST<br />(Final Check)
                </div>

                {/* Manager Hub (Center) */}
                <div style={{ textAlign: "center", width: "100%", maxWidth: "200px", padding: "0.75rem", borderRadius: "8px", background: "#fef2f2", border: "2px dashed #ef4444" }}>
                  <div style={{ fontSize: "1.2rem" }}>👑</div>
                  <strong style={{ fontSize: "0.9rem", color: "#b91c1c" }}>Human Manager</strong>
                  <div style={{ fontSize: "0.72rem", color: "#64748b" }}>Final Authorization Hub</div>
                </div>

                {/* Arrow 2: Planner -> Inventory */}
                <div style={{ textAlign: "center", color: "#059669", fontWeight: 700, fontSize: "0.75rem" }}>
                  ▼ TASK_REQUEST<br />▲ CHALLENGE / REVISION
                </div>

                {/* Staff Task Assigner (Bottom-Left) */}
                <div style={{ textAlign: "center", width: "100%", maxWidth: "220px", padding: "0.75rem", borderRadius: "8px", background: "#fffbeb", border: "2px solid #f59e0b" }}>
                  <div style={{ fontSize: "1.2rem" }}>👥</div>
                  <strong style={{ fontSize: "0.9rem", color: "#b45309" }}>Staff Task Assigner</strong>
                  <div style={{ fontSize: "0.72rem", color: "#64748b" }}>Task Execution & Roster Allocation</div>
                </div>

                {/* Arrow 3: Manager -> Staff */}
                <div style={{ textAlign: "center", color: "#d97706", fontWeight: 700, fontSize: "0.8rem" }}>
                  ➔ APPROVED WORK ➔
                </div>

                {/* Inventory Manager (Bottom-Right) */}
                <div style={{ textAlign: "center", width: "100%", maxWidth: "220px", padding: "0.75rem", borderRadius: "8px", background: "#ecfdf5", border: "2px solid #10b981" }}>
                  <div style={{ fontSize: "1.2rem" }}>🌾</div>
                  <strong style={{ fontSize: "0.9rem", color: "#047857" }}>Inventory Manager</strong>
                  <div style={{ fontSize: "0.72rem", color: "#64748b" }}>Ingredients & Stock Verification</div>
                </div>
              </div>

              {/* Recent Active Flow Wire */}
              <div style={{ marginTop: "1rem" }}>
                <h5 style={{ margin: "0 0 0.5rem 0", fontSize: "0.85rem", color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Latest Real-Time Agent Exchanges:
                </h5>
                <div style={{ display: "grid", gap: "0.4rem" }}>
                  {recentFlows.length === 0 ? (
                    <div style={{ padding: "0.75rem", background: "#f8fafc", borderRadius: "6px", textAlign: "center", color: "#64748b", fontSize: "0.85rem" }}>BakeryOps is ready. Waiting for the first order.</div>
                  ) : (
                    recentFlows.map((flow) => {
                      const badge = MESSAGE_TYPE_COLORS[flow.messageType] || { bg: "#f1f5f9", text: "#334155", border: "#cbd5e1" };
                      return (
                        <div
                          key={flow.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "0.45rem 0.75rem",
                            background: "#fff",
                            border: `1px solid ${badge.border}`,
                            borderRadius: "6px",
                            fontSize: "0.82rem",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                            <span style={{ background: badge.bg, color: badge.text, padding: "0.15rem 0.45rem", borderRadius: "4px", fontSize: "0.7rem", fontWeight: 700 }}>
                              {flow.messageType}
                            </span>
                            <span>
                              <strong>{flow.senderName}</strong> ➔ <strong>{flow.recipientName}</strong>
                            </span>
                            <span style={{ color: "#64748b" }}>({flow.orderId})</span>
                            <span style={{ color: "#334155" }}>— {flow.content.slice(0, 90)}...</span>
                          </div>
                          <span style={{ fontSize: "0.72rem", color: "#94a3b8" }}>{new Date(flow.createdAt).toLocaleTimeString()}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* 3. Chronological Collaborative Feed with Interactive Filters */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
                <h4 style={{ margin: 0, fontSize: "1rem", color: "#1e293b", fontWeight: 700 }}>
                  Chronological Collaborative History & Messages ({filteredMessages.length})
                </h4>

                {/* Filter Controls */}
                <div style={{ display: "flex", gap: "0.5rem", fontSize: "0.8rem" }}>
                  <select
                    value={filterAgent}
                    onChange={(e) => setFilterAgent(e.target.value)}
                    style={{ padding: "0.25rem 0.5rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                  >
                    <option value="all">All Agents</option>
                    <option value="order-analyst">Order Analyst</option>
                    <option value="production-planner">Production Planner</option>
                    <option value="inventory-manager">Inventory Manager</option>
                    <option value="staff-task-assigner">Staff Task Assigner</option>
                    <option value="manager">Manager</option>
                  </select>

                  <select
                    value={filterOrder}
                    onChange={(e) => setFilterOrder(e.target.value)}
                    style={{ padding: "0.25rem 0.5rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                  >
                    <option value="all">All Orders</option>
                    {uniqueOrders.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>

                  <select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                    style={{ padding: "0.25rem 0.5rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                  >
                    <option value="all">All Types</option>
                    <option value="TASK_REQUEST">TASK_REQUEST</option>
                    <option value="CHALLENGE">CHALLENGE</option>
                    <option value="REVISION">REVISION</option>
                    <option value="HANDOFF">HANDOFF</option>
                    <option value="FINDING">FINDING</option>
                    <option value="APPROVAL_REQUEST">APPROVAL_REQUEST</option>
                    <option value="RESOLVED">RESOLVED</option>
                  </select>
                </div>
              </div>

              <div style={{ display: "grid", gap: "0.75rem" }}>
                {filteredMessages.length === 0 ? (
                  <div style={{ padding: "1.5rem", background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: "8px", textAlign: "center", color: "#64748b", fontSize: "0.9rem" }}><strong>BakeryOps is ready.</strong> Waiting for the first order.</div>
                ) : (
                  filteredMessages.map((msg) => {
                    const badge = MESSAGE_TYPE_COLORS[msg.messageType] || { bg: "#f1f5f9", text: "#334155", border: "#cbd5e1" };
                    return (
                      <div
                        key={msg.id}
                        style={{
                          padding: "0.9rem 1.1rem",
                          borderRadius: "8px",
                          border: `1px solid ${badge.border}`,
                          background: msg.messageType === "CHALLENGE" ? "#fff5f5" : msg.messageType === "HANDOFF" ? "#f0fdf4" : "#ffffff",
                          boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
                          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                            <span style={{ background: badge.bg, color: badge.text, padding: "0.15rem 0.5rem", borderRadius: "4px", fontSize: "0.72rem", fontWeight: 700 }}>
                              {msg.messageType}
                            </span>
                            <span style={{ fontSize: "0.85rem", color: "#1e293b" }}>
                              <strong>{msg.senderName}</strong> ➔ <strong>{msg.recipientName}</strong>
                            </span>
                            <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                              ({STAGE_LABELS[msg.workflowStage] || msg.workflowStage})
                            </span>
                            <span style={{ fontSize: "0.75rem", background: "#f1f5f9", padding: "0.1rem 0.4rem", borderRadius: "4px", color: "#475569" }}>
                              Order: {msg.orderId}
                            </span>
                          </div>
                          <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>{new Date(msg.createdAt).toLocaleTimeString()}</span>
                        </div>

                        <div style={{ fontSize: "0.9rem", color: "#1e293b", lineHeight: 1.45 }}>{msg.content}</div>

                        {msg.evidence && (
                          <div style={{ marginTop: "0.4rem", padding: "0.45rem 0.65rem", background: "#f8fafc", borderLeft: "3px solid #3b82f6", borderRadius: "0 4px 4px 0", fontSize: "0.82rem", color: "#334155" }}>
                            <strong>Evidence:</strong> {msg.evidence}
                          </div>
                        )}

                        {msg.reason && (
                          <div style={{ marginTop: "0.25rem", fontSize: "0.78rem", color: "#64748b" }}>
                            <em>Reason: {msg.reason}</em>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* --- TAB 2: AUTHORIZATIONS & APPROVALS (M2) --- */}
            {/* TAB: EVENT INTELLIGENCE (M5) */}
    {activeTab === "events" && (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "10px" }}>
          <div>
            <h4 style={{ margin: "0 0 0.25rem 0", fontSize: "1.1rem", color: "#1e293b" }}>
              ⚡ Operational Events & Autonomous Investigations
            </h4>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#64748b" }}>
              Real-time audit stream of backend mutations triggering specialist agent investigations, challenges, and human-supervised handoffs.
            </p>
          </div>
          <button
            onClick={() => fetchAllData()}
            className="secondary-button"
            style={{ fontSize: "0.8rem", padding: "4px 10px" }}
          >
            ↻ Refresh Events
          </button>
        </div>

        {/* Metrics Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px", marginBottom: "1.25rem" }}>
          <div style={{ background: "#f8fafc", padding: "10px", borderRadius: "8px", border: "1px solid #e2e8f0", textAlign: "center" }}>
            <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 600 }}>Total Events</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "#1e293b" }}>{events.length}</div>
          </div>
          <div style={{ background: "#eff6ff", padding: "10px", borderRadius: "8px", border: "1px solid #bfdbfe", textAlign: "center" }}>
            <div style={{ fontSize: "0.75rem", color: "#2563eb", fontWeight: 600 }}>Investigating</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "#1d4ed8" }}>
              {events.filter((e) => ["AGENT_INVESTIGATING", "COLLABORATION_IN_PROGRESS"].includes(e.status)).length}
            </div>
          </div>
          <div style={{ background: "#fffbeb", padding: "10px", borderRadius: "8px", border: "1px solid #fde68a", textAlign: "center" }}>
            <div style={{ fontSize: "0.75rem", color: "#d97706", fontWeight: 600 }}>Waiting for Manager</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "#b45309" }}>
              {events.filter((e) => e.status === "WAITING_FOR_MANAGER").length}
            </div>
          </div>
          <div style={{ background: "#ecfdf5", padding: "10px", borderRadius: "8px", border: "1px solid #a7f3d0", textAlign: "center" }}>
            <div style={{ fontSize: "0.75rem", color: "#059669", fontWeight: 600 }}>Resolved / Completed</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "#065f46" }}>
              {events.filter((e) => ["COMPLETED", "RESOLVED", "ACTION_AUTHORIZED"].includes(e.status)).length}
            </div>
          </div>
        </div>

        {/* Events List */}
        {events.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 20px", background: "#f8fafc", borderRadius: "8px", border: "1px dashed #cbd5e1", color: "#64748b" }}>
            <div style={{ fontSize: "1.8rem", marginBottom: "8px" }}>⚡</div>
            <strong>No operational events recorded yet.</strong>
            <p style={{ margin: "4px 0 0 0", fontSize: "0.85rem" }}>Events are automatically detected from orders, inventory adjustments, plans, and staff tasks.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {events.map((evt) => {
              const isWaiting = evt.status === "WAITING_FOR_MANAGER";
              const isInvestigating = ["AGENT_INVESTIGATING", "COLLABORATION_IN_PROGRESS"].includes(evt.status);
              const isDone = ["COMPLETED", "RESOLVED", "ACTION_AUTHORIZED"].includes(evt.status);

              return (
                <div
                  key={evt.id}
                  style={{
                    background: "#ffffff",
                    border: isWaiting ? "2px solid #f59e0b" : "1px solid #e2e8f0",
                    borderRadius: "8px",
                    padding: "12px 16px",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 800,
                          padding: "2px 8px",
                          borderRadius: "4px",
                          background: "#0f172a",
                          color: "#ffffff",
                          fontFamily: "monospace",
                        }}
                      >
                        {evt.eventType}
                      </span>
                      <span style={{ fontSize: "0.75rem", color: "#64748b" }}>ID: {evt.id}</span>
                      <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>•</span>
                      <span style={{ fontSize: "0.78rem", color: "#334155" }}>
                        Source: <strong>{evt.sourceEntity}:{evt.sourceId}</strong>
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      {isWaiting && (
                        <span style={{ fontSize: "0.75rem", padding: "2px 8px", borderRadius: "12px", background: "#fef3c7", color: "#b45309", fontWeight: 700 }}>
                          ⏳ WAITING FOR MANAGER
                        </span>
                      )}
                      {isInvestigating && (
                        <span style={{ fontSize: "0.75rem", padding: "2px 8px", borderRadius: "12px", background: "#eff6ff", color: "#2563eb", fontWeight: 700 }}>
                          🔍 INVESTIGATING
                        </span>
                      )}
                      {isDone && (
                        <span style={{ fontSize: "0.75rem", padding: "2px 8px", borderRadius: "12px", background: "#ecfdf5", color: "#059669", fontWeight: 700 }}>
                          ✅ {evt.status}
                        </span>
                      )}
                      <span style={{ fontSize: "0.72rem", color: "#94a3b8" }}>
                        {new Date(evt.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>

                  {evt.resolutionSummary && (
                    <div style={{ margin: "8px 0 4px 0", fontSize: "0.85rem", color: "#1e293b", background: "#f8fafc", padding: "8px 12px", borderRadius: "6px" }}>
                      <strong>Investigation Outcome:</strong> {evt.resolutionSummary}
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px", fontSize: "0.78rem", color: "#64748b" }}>
                    <div>
                      Responsible Specialist: <strong>{evt.responsibleAgentId}</strong>
                      {evt.orderId && <span> | Order: <strong>{evt.orderId}</strong></span>}
                      {evt.taskId && <span> | Task: <strong>{evt.taskId}</strong></span>}
                    </div>
                    {evt.status === "FAILED" && (
                      <button
                        onClick={async () => {
                          await fetch("/api/events", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "retry", eventId: evt.id }),
                          });
                          fetchAllData();
                        }}
                        style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", borderRadius: "4px", padding: "2px 8px", cursor: "pointer", fontSize: "0.75rem" }}
                      >
                        ↺ Retry Event
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    )}

    {activeTab === "approvals" && (
          <div>
            <h4 style={{ margin: "0 0 0.75rem 0", fontSize: "1rem", color: "#1e293b" }}>
              Pending Manager Authorizations (Protected Operational Changes)
            </h4>
            {pendingApprovals.length === 0 ? (
              <div style={{ padding: "1.25rem", background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: "8px", textAlign: "center", color: "#64748b" }}>
                No authorizations currently pending. All consequential actions are authorized or complete.
              </div>
            ) : (
              pendingApprovals.map((req) => (
                <div
                  key={req.id}
                  style={{
                    background: "#ffffff",
                    border: "1px solid #f87171",
                    borderRadius: "8px",
                    padding: "1rem",
                    marginBottom: "0.75rem",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <span style={{ background: "#fee2e2", color: "#991b1b", padding: "0.2rem 0.5rem", borderRadius: "4px", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase" }}>
                        {req.status}
                      </span>
                      <strong style={{ marginLeft: "0.5rem", fontSize: "1rem", color: "#111827" }}>{req.title}</strong>
                      <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: "0.25rem" }}>
                        Requested by <strong>{req.agentName}</strong> {req.orderId ? `• Order: ${req.orderId}` : ""} {req.taskId ? `• Task: ${req.taskId}` : ""}
                      </div>
                    </div>
                    <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>{new Date(req.createdAt).toLocaleTimeString()}</span>
                  </div>
                  <p style={{ margin: "0.75rem 0", fontSize: "0.9rem", color: "#374151", lineHeight: 1.4 }}>
                    {req.description}
                  </p>
                  <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <input
                      type="text"
                      placeholder="Decision notes or feedback..."
                      value={decisionNotes[req.id] || ""}
                      onChange={(e) => setDecisionNotes({ ...decisionNotes, [req.id]: e.target.value })}
                      style={{ flex: 1, padding: "0.5rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.9rem" }}
                    />
                    <button
                      type="button"
                      style={{ background: "#10b981", color: "#fff", padding: "0.5rem 1rem", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: 600 }}
                      onClick={() => handleDecision(req.id, "APPROVED")}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      style={{ background: "#ef4444", color: "#fff", padding: "0.5rem 1rem", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: 600 }}
                      onClick={() => handleDecision(req.id, "REJECTED")}
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      style={{ background: "#f59e0b", color: "#fff", padding: "0.5rem 1rem", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: 600 }}
                      onClick={() => handleDecision(req.id, "REVISION_REQUIRED")}
                    >
                      Request Revision
                    </button>
                  </div>
                </div>
              ))
            )}

            {pastApprovals.length > 0 && (
              <div style={{ marginTop: "1.5rem" }}>
                <h4 style={{ fontSize: "0.9rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>Decided Requests History</h4>
                <div style={{ display: "grid", gap: "0.5rem" }}>
                  {pastApprovals.map((req) => (
                    <div key={req.id} style={{ display: "flex", justifyContent: "space-between", padding: "0.75rem", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "6px", fontSize: "0.85rem" }}>
                      <div>
                        <strong>{req.title}</strong> — {req.agentName} ({req.orderId || "General"})
                        {req.decisionNotes ? <span style={{ color: "#64748b" }}> — "{req.decisionNotes}"</span> : null}
                      </div>
                      <div>
                        <span style={{
                          fontWeight: 600,
                          color: req.status === "APPROVED" ? "#059669" : req.status === "REJECTED" ? "#dc2626" : "#d97706"
                        }}>
                          {req.status}
                        </span> by {req.decidedBy}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* --- TAB 3: CHALLENGES & REVISIONS (M3) --- */}
        {activeTab === "challenges" && (
          <div>
            <h4 style={{ margin: "0 0 0.75rem 0", fontSize: "1rem", color: "#1e293b" }}>
              Operational Challenges & Specialist Resolutions
            </h4>
            <div style={{ display: "grid", gap: "0.75rem" }}>
              {challenges.length === 0 ? (
                <div style={{ padding: "1.25rem", background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: "8px", textAlign: "center", color: "#64748b" }}>
                  No operational challenges logged.
                </div>
              ) : (
                challenges.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      background: "#ffffff",
                      border: "1px solid #e2e8f0",
                      borderRadius: "8px",
                      padding: "1rem",
                      borderLeft: `4px solid ${
                        c.status === "RESOLVED"
                          ? "#10b981"
                          : c.status === "OPEN"
                          ? "#ef4444"
                          : c.status === "ESCALATED_TO_MANAGER"
                          ? "#b91c1c"
                          : "#f59e0b"
                      }`,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <span
                          style={{
                            fontSize: "0.72rem",
                            fontWeight: 700,
                            padding: "0.2rem 0.5rem",
                            borderRadius: "4px",
                            background: c.status === "RESOLVED" ? "#d1fae5" : "#fee2e2",
                            color: c.status === "RESOLVED" ? "#065f46" : "#991b1b",
                          }}
                        >
                          {c.status}
                        </span>
                        <strong style={{ marginLeft: "0.5rem", fontSize: "0.95rem", color: "#111827" }}>
                          {c.challengingAgentId} challenged {c.targetAgentId} (Order: {c.orderId})
                        </strong>
                      </div>
                      <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>{new Date(c.createdAt).toLocaleTimeString()}</span>
                    </div>

                    <div style={{ marginTop: "0.5rem", fontSize: "0.9rem", color: "#374151" }}>
                      <strong>Issue:</strong> {c.issue}
                    </div>
                    <div style={{ marginTop: "0.25rem", fontSize: "0.85rem", color: "#4b5563" }}>
                      <strong>Evidence:</strong> {c.evidence}
                    </div>

                    {c.revisionSummary && (
                      <div style={{ marginTop: "0.5rem", padding: "0.4rem 0.6rem", background: "#fef3c7", borderRadius: "4px", fontSize: "0.85rem", color: "#92400e" }}>
                        <strong>Revision Provided:</strong> {c.revisionSummary}
                      </div>
                    )}

                    {c.resolutionNotes && (
                      <div style={{ marginTop: "0.5rem", padding: "0.4rem 0.6rem", background: "#d1fae5", borderRadius: "4px", fontSize: "0.85rem", color: "#065f46" }}>
                        <strong>Resolution Notes:</strong> {c.resolutionNotes}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* --- TAB 4: AUDIT LOG (M4) --- */}
        {activeTab === "audit_log" && (
          <div>
            <h4 style={{ margin: "0 0 0.75rem 0", fontSize: "1rem", color: "#1e293b" }}>
              Authoritative Operational Change Audit Trail
            </h4>
            <p style={{ fontSize: "0.85rem", color: "#64748b", margin: "0 0 1rem 0" }}>
              Permanent record of proposed, authorized, and executed operational changes, inventory adjustments, and escalation triggers.
            </p>

            <div style={{ display: "grid", gap: "0.5rem" }}>
              {auditLogs.length === 0 ? (
                <div style={{ padding: "1.25rem", background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: "8px", textAlign: "center", color: "#64748b" }}>
                  No audit log entries recorded yet.
                </div>
              ) : (
                auditLogs.map((log) => (
                  <div
                    key={log.id}
                    style={{
                      background: "#ffffff",
                      border: "1px solid #e2e8f0",
                      borderRadius: "6px",
                      padding: "0.75rem 1rem",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span style={{ fontSize: "0.75rem", fontWeight: 700, padding: "0.15rem 0.4rem", borderRadius: "4px", background: "#e2e8f0", color: "#334155" }}>
                          {log.eventType}
                        </span>
                        <strong style={{ fontSize: "0.88rem", color: "#1e293b" }}>{log.changeDescription}</strong>
                      </div>
                      <div style={{ fontSize: "0.78rem", color: "#64748b", marginTop: "0.25rem" }}>
                        Proposed by: <strong>{log.proposedBy}</strong>
                        {log.approvedBy ? ` • Authorized by: ${log.approvedBy}` : ""}
                        {log.reason ? ` • Reason: ${log.reason}` : ""}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span
                        style={{
                          fontSize: "0.72rem",
                          fontWeight: 700,
                          padding: "0.2rem 0.5rem",
                          borderRadius: "4px",
                          background: log.executionStatus === "EXECUTED" ? "#d1fae5" : log.executionStatus === "PENDING_APPROVAL" ? "#fef3c7" : "#e0e7ff",
                          color: log.executionStatus === "EXECUTED" ? "#065f46" : log.executionStatus === "PENDING_APPROVAL" ? "#92400e" : "#3730a3",
                        }}
                      >
                        {log.executionStatus}
                      </span>
                      <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: "0.2rem" }}>
                        {new Date(log.createdAt).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* --- TAB 5: MANAGER DISPATCH --- */}
        {activeTab === "interactions" && (
          <div>
            <form onSubmit={handleSendInteraction} style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "1rem", marginBottom: "1.5rem" }}>
              <h4 style={{ margin: "0 0 0.75rem 0", fontSize: "1rem", color: "#1e293b" }}>Dispatch Manager Instruction or Question</h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>Target Agent</label>
                  <select
                    value={selectedAgent}
                    onChange={(e) => setSelectedAgent(e.target.value)}
                    style={{ width: "100%", padding: "0.4rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                  >
                    <option value="order-analyst">Order Analyst</option>
                    <option value="production-planner">Production Planner</option>
                    <option value="inventory-manager">Inventory Manager</option>
                    <option value="staff-task-assigner">Staff Task Assigner</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>Interaction Type</label>
                  <select
                    value={instructionType}
                    onChange={(e) => setInstructionType(e.target.value as any)}
                    style={{ width: "100%", padding: "0.4rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                  >
                    <option value="instruction">Instruction / Direction</option>
                    <option value="question">Question / Request Explanation</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>Order ID (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. order-mina-cafe"
                    value={orderIdDraft}
                    onChange={(e) => setOrderIdDraft(e.target.value)}
                    style={{ width: "100%", padding: "0.4rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                  />
                </div>
              </div>
              <textarea
                placeholder="Type your message, instruction, or question to the agent..."
                rows={2}
                value={contentDraft}
                onChange={(e) => setContentDraft(e.target.value)}
                style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid #cbd5e1", fontSize: "0.9rem", resize: "vertical", boxSizing: "border-box" }}
              />
              <div style={{ marginTop: "0.5rem", display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="submit"
                  disabled={submitting || !contentDraft.trim()}
                  style={{ background: "#2563eb", color: "#fff", padding: "0.4rem 1rem", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: 600 }}
                >
                  {submitting ? "Sending..." : "Send to Agent"}
                </button>
              </div>
            </form>

            <div style={{ display: "grid", gap: "0.75rem" }}>
              {interactions.length === 0 ? (
                <p style={{ color: "#64748b" }}>No interactions logged yet.</p>
              ) : (
                interactions.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      padding: "0.75rem 1rem",
                      borderRadius: "6px",
                      border: "1px solid #e2e8f0",
                      background: item.sender === "manager" ? "#eff6ff" : "#ffffff",
                      marginLeft: item.sender === "manager" ? "0" : "1.5rem",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem", fontSize: "0.8rem", color: "#64748b" }}>
                      <span>
                        <strong style={{ color: item.sender === "manager" ? "#1d4ed8" : "#047857" }}>
                          {item.sender === "manager" ? "Human Manager (hadishanavas7454)" : item.agentName}
                        </strong>{" "}
                        • <span style={{ textTransform: "capitalize" }}>{item.type}</span> {item.orderId ? `• Order: ${item.orderId}` : ""}
                      </span>
                      <span>{new Date(item.createdAt).toLocaleTimeString()}</span>
                    </div>
                    <div style={{ fontSize: "0.92rem", color: "#1e293b" }}>{item.content}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
