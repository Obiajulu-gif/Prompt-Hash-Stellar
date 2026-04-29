import { createClient, type RedisClientType } from "redis";

let client: RedisClientType | null = null;

export async function getRedisClient(): Promise<RedisClientType | null> {
  if (!process.env.REDIS_URL) return null;

  if (client) return client;

  client = createClient({ url: process.env.REDIS_URL }) as RedisClientType;

  client.on("error", (err) => {
    console.error("Redis client error:", err);
    client = null;
  });

  await client.connect();
  return client;
}

export async function closeRedisClient() {
  if (client) {
    await client.quit();
    client = null;
  }
}
