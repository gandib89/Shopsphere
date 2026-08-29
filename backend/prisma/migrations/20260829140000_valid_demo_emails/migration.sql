-- Demo logins pass the same email validation as normal user accounts.
UPDATE "users"
SET "email" = 'seller1@shopsphere.test'
WHERE "email" = 'seller1@shopsphere'
  AND NOT EXISTS (SELECT 1 FROM "users" WHERE "email" = 'seller1@shopsphere.test');

UPDATE "users"
SET "email" = 'seller2@shopsphere.test'
WHERE "email" = 'seller2@shopsphere'
  AND NOT EXISTS (SELECT 1 FROM "users" WHERE "email" = 'seller2@shopsphere.test');

UPDATE "users"
SET "email" = 'customer1@shopsphere.test'
WHERE "email" = 'custumer1@shopsphere'
  AND NOT EXISTS (SELECT 1 FROM "users" WHERE "email" = 'customer1@shopsphere.test');

UPDATE "users"
SET "email" = 'customer2@shopsphere.test'
WHERE "email" = 'custumer2@shopsphere'
  AND NOT EXISTS (SELECT 1 FROM "users" WHERE "email" = 'customer2@shopsphere.test');
