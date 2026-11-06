/**
 * BAKERYOPS AI — M6 MONITORING CONFIGURATION
 * Centralized, configurable monitoring cadence, thresholds, and safeguards.
 */

export const MONITORING_CONFIG = {
  // Cadence intervals (in milliseconds)
  SCHEDULED_CYCLE_INTERVAL_MS: 60_000, // 60s routine proactive cycle
  TIME_SENSITIVE_INTERVAL_MS: 20_000,   // 20s time-sensitive check for approaching deadlines & overdue tasks
  RETRY_INTERVAL_MS: 15_000,            // 15s retry interval for failed Discord deliveries or interrupted checks

  // Operational Time Thresholds (in minutes)
  ORDER_APPROACHING_DEADLINE_MINUTES: 60, // Proactive warning if an active order is due within 60 minutes
  ORDER_STALLED_MINUTES: 15,              // Flag an order if it sits in submitted status without progress for > 15m
  TASK_APPROACHING_DEADLINE_MINUTES: 15,   // Flag a staff task if due within 15 minutes and not started
  TASK_UNACKNOWLEDGED_MINUTES: 15,         // Flag a task if created but not acknowledged / started within 15 minutes
  TASK_STALLED_MINUTES: 30,                // Flag a task inProgress with no update for > 30 minutes

  // Inventory Time-Series & Trend Analysis Safeguards
  MIN_TIME_SERIES_POINTS_FOR_TREND: 3,     // Require >= 3 timestamped stock observations to claim a trend
  TREND_RAPID_DROP_PERCENT_PER_HOUR: 25,   // > 25% drop per hour qualifies as "rapidly declining"

  // Deduplication & Anti-Spam Safeguards
  DISCORD_REMINDER_COOLDOWN_MS: 300_000,   // 5 minutes minimum cooldown before sending reminder on unchanged condition
  MAX_RETRIES: 5,                          // Maximum bounded retries for failed tasks or notification dispatches

  // Capacity / Constraints
  MAX_PARALLEL_OVEN_BATCHES: 2,            // Maximum simultaneous batches the deck ovens can accommodate
};
