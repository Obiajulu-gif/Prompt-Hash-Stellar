/**
 * Legacy SQL database seam (restore verification tooling). See
 * `db/connection.ts` for why this is an explicit, typed failure rather than a
 * second database client.
 */
export { db } from "../db/connection";
export type { SqlDatabase, SqlQueryResult } from "../db/connection";
