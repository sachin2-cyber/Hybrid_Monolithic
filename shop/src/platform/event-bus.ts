/**
 * An in-process event bus.
 *
 * Requirements:
 *   - a handler that throws must not stop the other handlers
 *   - publish returns the number of handlers it reached
 *   - subscribing the same function twice registers it twice (do not dedupe)
 *   - publishing a name nobody listens to is fine and returns 0
 */

/** The events this system publishes. Add to it as you need to. */
export interface DomainEvents {
  "order.placed": { orderId: string; email: string; amountPaise: number };
}

export type EventName = keyof DomainEvents;
export type Handler<K extends EventName> = (payload: DomainEvents[K]) => void;
export type Unsubscribe = () => void;

export interface EventBus {
  publish<K extends EventName>(name: K, payload: DomainEvents[K]): number;
  subscribe<K extends EventName>(name: K, fn: Handler<K>): Unsubscribe;
}

type AnyHandler = (payload: DomainEvents[EventName]) => void;

export function createEventBus(): EventBus {
  const handlers = new Map<EventName, AnyHandler[]>();

  return {
    subscribe(name, fn) {
      const list = handlers.get(name) ?? [];
      const registered = fn as AnyHandler;
      list.push(registered); // pushed even if already present: no dedupe
      handlers.set(name, list);

      let active = true;
      return () => {
        if (!active) return; // a second call must not remove a second registration
        active = false;
        const current = handlers.get(name);
        const i = current?.indexOf(registered) ?? -1;
        if (current && i !== -1) current.splice(i, 1);
      };
    },

    publish(name, payload) {
      // Copy first, so a handler that unsubscribes mid-publish cannot skip one.
      const list = [...(handlers.get(name) ?? [])];
      for (const fn of list) {
        try {
          fn(payload);
        } catch (err) {
          // One bad handler must not stop the rest. Report it and carry on.
          console.error(`handler for "${name}" threw:`, err);
        }
      }
      return list.length;
    },
  };
}

/** The one bus the shop runs on. Modules publish to it and subscribe to it. */
export const bus = createEventBus();