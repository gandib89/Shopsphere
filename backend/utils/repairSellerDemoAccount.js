import { hashPassword, verifyPassword } from './password.js';
import { assertLocalDemoEnv } from './demoEnvGuard.js';

const SELLER_ID = '66a100000000000000000001';
const EMAIL = 'seller1@shopsphere.test';
const LEGACY_EMAIL = 'seller1@shopsphere';

// Explicit local-demo maintenance only. Never reset existing users during startup.
export async function repairSellerDemoAccount(client, env) {
  assertLocalDemoEnv(env);

  return client.$transaction(async tx => {
    const seller = await tx.user.findUnique({ where: { id: SELLER_ID } });
    if (!seller || seller.role !== 'seller' || ![EMAIL, LEGACY_EMAIL].includes(seller.email)) {
      throw new Error('Expected seeded seller account not found; no accounts changed');
    }
    const conflict = await tx.user.findUnique({ where: { email: EMAIL } });
    if (conflict && conflict.id !== SELLER_ID) {
      throw new Error('Demo email belongs to a different account; no accounts changed');
    }
    const emailChanged = seller.email !== EMAIL;
    const passwordReset = !await verifyPassword(seller.password, env.DEMO_PASSWORD);
    if (!emailChanged && !passwordReset) return { email: EMAIL, changed: false, passwordReset: false };

    await tx.user.update({
      where: { id: SELLER_ID },
      data: {
        email: EMAIL,
        ...(passwordReset ? { password: await hashPassword(env.DEMO_PASSWORD) } : {}),
        resetTokenHash: null,
        resetTokenExpiresAt: null,
      },
    });
    await tx.refreshToken.updateMany({
      where: { userId: SELLER_ID, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { email: EMAIL, changed: true, emailChanged, passwordReset };
  }, { isolationLevel: 'Serializable' });
}
