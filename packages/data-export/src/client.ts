import type { BetterAuthClientPlugin } from "better-auth/client";
import { DATA_EXPORT_ERROR_CODES } from "./error-codes";
import type { DataExportPlugin } from "./index";

/**
 * Client companion to `dataExport()`: `authClient.dataExport.download()`
 * for the signed-in user's data, `authClient.dataExport.admin({ userId })`
 * for admins, and the plugin's error codes.
 *
 * @example
 * ```ts
 * import { createAuthClient } from "better-auth/client";
 * import { dataExportClient } from "@checodo/better-auth-data-export/client";
 *
 * export const authClient = createAuthClient({
 *   plugins: [dataExportClient()],
 * });
 *
 * const { data } = await authClient.dataExport.download();
 * ```
 */
export const dataExportClient = () => {
  return {
    id: "data-export",
    $InferServerPlugin: {} as DataExportPlugin,
    $ERROR_CODES: DATA_EXPORT_ERROR_CODES,
  } satisfies BetterAuthClientPlugin;
};

export { DATA_EXPORT_ERROR_CODES } from "./error-codes";
export type { DataExport } from "./types";
