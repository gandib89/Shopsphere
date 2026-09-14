-- Additive and nullable so existing users and older application versions remain compatible.
ALTER TABLE "users"
  ADD COLUMN "homeStreet" TEXT,
  ADD COLUMN "homeCity" TEXT,
  ADD COLUMN "homeState" TEXT,
  ADD COLUMN "homeZipCode" TEXT;
