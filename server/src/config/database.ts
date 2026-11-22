/**
 * PostgreSQL access used by the analytics verification services.
 *
 * The API server persists through MongoDB; these services expect an optional
 * relational warehouse. Without `DATABASE_URL` they must not silently pretend
 * data exists, except in tests where empty result sets are the fixture default.
 */
export const db = {
  async query(
    _sql: string,
    _params?: unknown[],
  ): Promise<{ rows: any[] }> {
    if (process.env.NODE_ENV === "test") {
      return { rows: [] };
    }
    throw new Error(
      "PostgreSQL is not configured: set DATABASE_URL to enable relational analytics services.",
    );
  },
};
