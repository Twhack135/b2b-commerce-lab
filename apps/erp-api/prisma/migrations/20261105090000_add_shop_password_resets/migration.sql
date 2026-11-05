-- Password reset of activated shop users (Sprint 12C, after the manual
-- acceptance test, GAP-001): one-time links issued by the administration.
--
-- Its own table, so activation links (shop_activation_tokens) and reset
-- links can never be used for each other. Links are stored only as SHA-256
-- hashes (64 hex characters); the raw token exists only in the link.
--
-- Only new objects are created: one table with indexes, a foreign key and
-- CHECK constraints. Existing tables and data are not changed. Prisma does
-- not run a migration in a transaction, so this one does it explicitly: if
-- any statement fails, nothing is changed.

BEGIN;

-- CreateTable
CREATE TABLE "shop_password_resets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),

    CONSTRAINT "shop_password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shop_password_resets_token_hash_key" ON "shop_password_resets"("token_hash");

-- CreateIndex
CREATE INDEX "shop_password_resets_user_idx" ON "shop_password_resets"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "shop_password_resets_one_open_key" ON "shop_password_resets"("user_id") WHERE (used_at IS NULL);

-- AddForeignKey
ALTER TABLE "shop_password_resets" ADD CONSTRAINT "shop_password_resets_user_fkey" FOREIGN KEY ("user_id") REFERENCES "shop_users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- AddCheckConstraint (written by hand; Prisma cannot express CHECK constraints)
-- Tokens are stored as SHA-256 hex digests only
ALTER TABLE "shop_password_resets" ADD CONSTRAINT "shop_password_resets_token_hash_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$');

-- Plausible times, and never valid for more than 4 hours (approved lifetime)
ALTER TABLE "shop_password_resets" ADD CONSTRAINT "shop_password_resets_times_check" CHECK ("expires_at" > "created_at" AND "expires_at" <= "created_at" + INTERVAL '4 hours' AND ("used_at" IS NULL OR "used_at" >= "created_at"));

COMMIT;
