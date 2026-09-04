import { hashPassword, verifyPassword } from './password.js';
import { assertLocalDemoEnv } from './demoEnvGuard.js';

// Mirrors repairSellerDemoAccount.js for the accounts that still carry legacy
// pre-".test" (and, for customers, misspelled "custumer") emails.
const ACCOUNTS = [
  { id: '66a100000000000000000002', email: 'seller2@shopsphere.test', legacyEmail: 'seller2@shopsphere', role: 'seller' },
  { id: '66a100000000000000000003', email: 'customer1@shopsphere.test', legacyEmail: 'custumer1@shopsphere', role: 'user' },
  { id: '66a100000000000000000004', email: 'customer2@shopsphere.test', legacyEmail: 'custumer2@shopsphere', role: 'user' },
];

// Explicit local-demo maintenance only. Never reset existing users during startup.
export async function repairRemainingDemoAccounts(client, env) {
  assertLocalDemoEnv(env);

  return client.$transaction(async tx => {
    const results = [];
    for (const account of ACCOUNTS) {
      const user = await tx.user.findUnique({ where: { id: account.id } });
      if (!user || user.role !== account.role || ![account.email, account.legacyEmail].includes(user.email)) {
        throw new Error(`Expected seeded account ${account.email} not found; no accounts changed`);
      }
      const conflict = user.email !== account.email ? await tx.user.findUnique({ where: { email: account.email } }) : null;
      if (conflict && conflict.id !== account.id) {
        throw new Error(`${account.email} belongs to a different account; no accounts changed`);
      }
      const emailChanged = user.email !== account.email;
      const passwordReset = !await verifyPassword(user.password, env.DEMO_PASSWORD);
      if (!emailChanged && !passwordReset) { results.push({ email: account.email, changed: false, passwordReset: false }); continue; }

      await tx.user.update({
        where: { id: account.id },
        data: {
          email: account.email,
          ...(passwordReset ? { password: await hashPassword(env.DEMO_PASSWORD) } : {}),
          resetTokenHash: null,
          resetTokenExpiresAt: null,
        },
      });
      await tx.refreshToken.updateMany({ where: { userId: account.id, revokedAt: null }, data: { revokedAt: new Date() } });
      results.push({ email: account.email, changed: true, emailChanged, passwordReset });
    }
    return results;
  }, { isolationLevel: 'Serializable' });
}
