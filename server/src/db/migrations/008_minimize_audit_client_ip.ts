interface MigrationDb {
  collection(name: string): {
    updateMany(
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
    ): Promise<{ modifiedCount: number }>;
  };
}

/**
 * Remove historically retained client IP addresses from audit records.
 * They are not part of the integrity hash or audit export contract, and
 * requestId plus the recorded actor/outcome support incident correlation.
 * This irreversible privacy scrub intentionally has a no-op rollback.
 */
export async function up(db: MigrationDb): Promise<void> {
  const result = await db.collection("auditlogs").updateMany(
    { clientIp: { $exists: true } },
    { $unset: { clientIp: "" } },
  );
  console.log(`[008] Removed clientIp from ${result.modifiedCount} audit record(s).`);
}

export async function down(_db: MigrationDb): Promise<void> {
  // Irreversible by design: restored IP addresses are not required by audits.
  console.log("[008] No-op rollback: scrubbed audit clientIp values stay removed.");
}