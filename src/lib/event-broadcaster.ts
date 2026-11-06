import { EventEmitter } from "node:events";

class EventBroadcaster extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }

  broadcast(eventType: string, payload: unknown) {
    this.emit("event", { type: eventType, data: payload, timestamp: new Date().toISOString() });
  }
}

// Global singleton to persist across Next.js dev reload
const globalForBroadcaster = global as unknown as { eventBroadcaster?: EventBroadcaster };

export const eventBroadcaster = globalForBroadcaster.eventBroadcaster || new EventBroadcaster();

if (process.env.NODE_ENV !== "production") {
  globalForBroadcaster.eventBroadcaster = eventBroadcaster;
}
