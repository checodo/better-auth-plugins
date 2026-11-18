import type { AuditEvent, AuditEventQuery, AuditLogStorage } from "./types";

/**
 * Keeps events in memory, newest last. For tests and demos: events are
 * lost on restart and not shared between server instances.
 *
 * @example
 * ```ts
 * const storage = memoryStorage();
 * betterAuth({ plugins: [auditLog({ storage })] });
 * storage.events; // every stored event
 * ```
 */
export function memoryStorage(): Required<AuditLogStorage> & { readonly events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  const matches = (event: AuditEvent, query: AuditEventQuery) =>
    (!query.userId || event.userId === query.userId) &&
    (!query.actorUserId || event.actorUserId === query.actorUserId) &&
    (!query.type || event.type === query.type) &&
    (!query.status || event.status === query.status) &&
    (!query.from || event.createdAt >= query.from) &&
    (!query.to || event.createdAt < query.to);

  return {
    events,
    async write(input) {
      const event = { ...input, id: crypto.randomUUID() };
      events.push(event);
      return event;
    },
    async read(query) {
      const found = events.filter((event) => matches(event, query)).reverse();
      return { events: found.slice(query.offset, query.offset + query.limit), total: found.length };
    },
    async deleteOlderThan(date) {
      const kept = events.filter((event) => event.createdAt >= date);
      const deleted = events.length - kept.length;
      events.splice(0, events.length, ...kept);
      return deleted;
    },
  };
}
