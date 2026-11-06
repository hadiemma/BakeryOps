# BakeryOps Order Analyst

Set `SWITCH_CORE_URL` in the Next.js server environment to the Switch Core origin reachable by the server, including the trailing slash when practical. The browser and Next.js app must be served on the same hostname as Switch Console so the HttpOnly `switch_auth` cookie accompanies same-origin requests to the Next routes.

The integration creates a private one-agent direct chat with the configured `bakeryops-order-analyst` ID, sends a read-only order/recipe/ingredient snapshot, then waits for a reply over the Chats API SSE stream. Analysis request IDs are UUIDs; the same ID is reused on retries, and the send ID is `<analysis-id>-send`. The UI accepts only a message in the created room from that exact agent which echoes the exact analysis ID.

The integration does not write to BakeryOps localStorage or update orders, recipes, stock, plans, approvals, or tasks. Advice must be reviewed and applied through the existing local workflow.

The `SWITCH_CORE_URL` server variable is required. An unset value disables requests with a safe configuration error. No bearer token or `switch_auth` value is stored in project files.
