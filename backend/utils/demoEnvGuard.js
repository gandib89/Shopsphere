// Shared guard for local-demo account repair scripts. Never reset accounts during
// normal startup or against anything but a local database.
export function assertLocalDemoEnv(env) {
  if (env.NODE_ENV === 'production') throw new Error('Demo repair is disabled in production');
  const database = new URL(env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)) {
    throw new Error('Demo repair requires a local database');
  }
  if (!env.DEMO_PASSWORD || env.DEMO_PASSWORD.length < 12) {
    throw new Error('DEMO_PASSWORD must contain at least 12 characters');
  }
}
