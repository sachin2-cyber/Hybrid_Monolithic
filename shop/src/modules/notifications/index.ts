import { bus } from "../../platform/event-bus.ts";
import { send, sent } from "./service.ts";

// Notifications listens for orders. Orders never calls us directly.
bus.subscribe("order.placed", (e) => {
  send(e.email, `Order ${e.orderId} confirmed`);
});

export { send, sent };
export type { Message } from "./repo.ts";