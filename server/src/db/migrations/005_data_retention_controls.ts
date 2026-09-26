interface RetentionIndex {
  name?: string;
  key?: { createdAt?: number; [key: string]: number | undefined };
  expireAfterSeconds?: number;
}

interface RetentionMigrationDb {
  collection(name: string): {
    listIndexes(): {
      toArray(): Promise<RetentionIndex[]>;
    };
    dropIndex(name: string): Promise<unknown>;
    createIndex(
      keys: Record<string, number>,
      options?: { name?: string },
    ): Promise<string>;
  };
}

/**
 * Remove the webhook TTL index so the retention worker can honor holds and
 * scrub payloads while preserving stable idempotency records.
 */
export async function up(db: RetentionMigrationDb): Promise<void> {
  const events = db.collection("inboundwebhookevents");
  let indexes: RetentionIndex[];
  try {
    indexes = await events.listIndexes().toArray();
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      (("code" in error && error.code === 26) ||
        ("codeName" in error && error.codeName === "NamespaceNotFound"))
    ) {
      indexes = [];
    } else {
      throw error;
    }
  }
  const ttlIndex = indexes.find(
    (index) =>
      index.key?.createdAt === 1 &&
      typeof index.expireAfterSeconds === "number",
  );

  if (ttlIndex?.name) {
    await events.dropIndex(ttlIndex.name);
    console.log(`[005] Removed unmanaged webhook TTL index ${ttlIndex.name}`);
  }

  await events.createIndex({
    processingStatus: 1,
    createdAt: 1,
    archivedAt: 1,
    retentionHold: 1,
  });
  await db.collection("quarantinedevents").createIndex({
    status: 1,
    updatedAt: 1,
    archivedAt: 1,
    retentionHold: 1,
  });
  await db.collection("jobrecords").createIndex({
    type: 1,
    status: 1,
    completedAt: 1,
    archivedAt: 1,
    retentionHold: 1,
  });
  await db.collection("reports").createIndex({
    status: 1,
    resolvedAt: 1,
    updatedAt: 1,
    archivedAt: 1,
    retentionHold: 1,
  });
}

export async function down(_db: RetentionMigrationDb): Promise<void> {
  // Restoring a TTL index would bypass retention holds and hard-delete records.
  console.log(
    "[005] No-op rollback: the unsafe webhook TTL index remains removed",
  );
}
