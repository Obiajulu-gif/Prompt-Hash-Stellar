/**
 * SQL adapter seam for legacy simulation tooling.
 *
 * The marketplace data store is MongoDB (see `db/connectDb.ts`); a handful of
 * older offline tools were written against a PostgreSQL pool that was never
 * added to this workspace. Keeping the seam typed lets those tools compile,
 * while calling them fails loudly with an actionable configuration error
 * instead of a module-resolution crash.
 */
export interface SqlQueryResult<T = any> {
  rows: T[];
}

export interface SqlDatabase {
  query<T = any>(sql: string, params?: unknown[]): Promise<SqlQueryResult<T>>;
}

class UnconfiguredSqlDatabase implements SqlDatabase {
  async query<T = any>(): Promise<SqlQueryResult<T>> {
    throw new Error(
      "SQL history database is not configured. These legacy simulation tools " +
        "require a PostgreSQL connection; the server itself uses MongoDB.",
    );
  }
}

export const db: SqlDatabase = new UnconfiguredSqlDatabase();
