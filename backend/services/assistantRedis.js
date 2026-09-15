import { createClient } from "redis";

let client;
let connecting;

export const getAssistantRedis = async () => {
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL is required for private assistant operations");
  client ??= createClient({ url: process.env.REDIS_URL });
  client.on("error", () => {});
  if (!client.isReady) connecting ??= client.connect().finally(() => { connecting = null; });
  await connecting;
  return client;
};

