import type { AuthContext } from "@better-auth/core";
import { getCurrentAdapter } from "@better-auth/core/context";
import type { Where } from "@better-auth/core/db/adapter";
import type { AuditEvent, AuditEventInput, AuditEventQuery, AuditLogStorage } from "./types";

type Row = Omit<AuditEvent, "metadata"> & { metadata: string | null };

function toEvent(row: Row): AuditEvent {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      metadata = null;
    }
  }
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    severity: row.severity,
    userId: row.userId ?? null,
    actorUserId: row.actorUserId ?? null,
    sessionId: row.sessionId ?? null,
    organizationId: row.organizationId ?? null,
    ipAddress: row.ipAddress ?? null,
    userAgent: row.userAgent ?? null,
    errorCode: row.errorCode ?? null,
    metadata,
    createdAt: new Date(row.createdAt),
  };
}

function filters(query: Omit<AuditEventQuery, "limit" | "offset">): Where[] {
  const where: Where[] = [];
  if (query.userId) where.push({ field: "userId", value: query.userId });
  if (query.actorUserId) where.push({ field: "actorUserId", value: query.actorUserId });
  if (query.type) where.push({ field: "type", value: query.type });
  if (query.status) where.push({ field: "status", value: query.status });
  if (query.from) where.push({ field: "createdAt", value: query.from, operator: "gte" });
  if (query.to) where.push({ field: "createdAt", value: query.to, operator: "lt" });
  return where;
}

/**
 * The default storage: the plugin's `auditEvent` table, through
 * better-auth's adapter. Inside a transaction (database hooks), writes go
 * through the transaction's adapter, so SQLite doesn't wait on itself.
 */
export function databaseStorage(
  baseAdapter: AuthContext["adapter"],
): AuditLogStorage & { readByIds: (ids: string[]) => Promise<Map<string, AuditEvent>> } {
  const adapter = () => getCurrentAdapter(baseAdapter);
  return {
    async write(event: AuditEventInput) {
      const row = await (await adapter()).create<Omit<Row, "id">, Row>({
        model: "auditEvent",
        data: { ...event, metadata: event.metadata ? JSON.stringify(event.metadata) : null },
      });
      return toEvent(row);
    },
    async read(query) {
      const db = await adapter();
      const where = filters(query);
      const [rows, total] = await Promise.all([
        db.findMany<Row>({
          model: "auditEvent",
          where,
          limit: query.limit,
          offset: query.offset,
          sortBy: { field: "createdAt", direction: "desc" },
        }),
        db.count({ model: "auditEvent", where }),
      ]);
      return { events: rows.map(toEvent), total };
    },
    async readByIds(ids) {
      if (ids.length === 0) return new Map();
      const rows = await (await adapter()).findMany<Row>({
        model: "auditEvent",
        where: [{ field: "id", value: ids, operator: "in" }],
      });
      return new Map(rows.map((row) => [row.id, toEvent(row)]));
    },
    async deleteOlderThan(date) {
      return (await adapter()).deleteMany({
        model: "auditEvent",
        where: [{ field: "createdAt", value: date, operator: "lt" }],
      });
    },
  };
}
