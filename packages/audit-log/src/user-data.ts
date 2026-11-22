import type { AuthContext } from "@better-auth/core";
import type { ExportUserData } from "@repo/plugin-utils/user-data";
import { databaseStorage } from "./store";
import type { AuditEvent, AuditEventQuery, AuditLogStorage } from "./types";

const PAGE_SIZE = 1000;

/**
 * A user's events for `@checodo/better-auth-data-export`: the events about
 * them and the ones they did. They have no foreign key to the user on
 * purpose (they outlive a deleted user), so the export can't find them on
 * its own. Nothing with a storage that can't be read (write-only).
 */
export function createExportUserData(storage: AuditLogStorage | undefined) {
  return (async (
    user: { id: string; email: string | null },
    { adapter, maxRows }: { adapter: AuthContext["adapter"]; maxRows: number },
  ): Promise<Record<string, Record<string, unknown>[]> | null> => {
    const source = storage ?? databaseStorage(adapter);
    const read = source.read;
    if (!read) return { auditEvent: [] };
    const readAll = async (
      query: Pick<AuditEventQuery, "userId" | "actorUserId">,
    ): Promise<AuditEvent[] | null> => {
      const events: AuditEvent[] = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const page = await read({ ...query, limit: PAGE_SIZE, offset });
        if (page.total > maxRows) return null;
        events.push(...page.events);
        if (page.events.length < PAGE_SIZE) return events;
      }
    };
    const about = await readAll({ userId: user.id });
    if (!about) return null;
    const by = await readAll({ actorUserId: user.id });
    if (!by) return null;
    return { auditEvent: [...about, ...by] as unknown as Record<string, unknown>[] };
  }) satisfies ExportUserData;
}
