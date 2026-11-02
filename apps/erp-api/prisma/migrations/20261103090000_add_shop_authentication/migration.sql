-- Shop sign-in (Sprint 12B, docs/adr/0003): passwords, one-time activation
-- tokens and server-side sessions of shop users.
--
-- Passwords are stored only as Argon2id hashes; activation and session
-- tokens only as SHA-256 hashes (64 hex characters). The raw tokens exist
-- only in the activation link and in the session cookie.
--
-- Only new objects are created: three tables, indexes, foreign keys, CHECK
-- constraints, and two triggers that end sessions for good when a user is
-- disabled or a customer account deactivated. Existing data is not changed.
-- Prisma does not run a migration in a transaction, so this one does it
-- explicitly: if any statement fails, nothing is changed.

BEGIN;

-- CreateTable
CREATE TABLE "shop_user_credentials" (
    "user_id" UUID NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shop_user_credentials_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "shop_activation_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),

    CONSTRAINT "shop_activation_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "shop_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shop_activation_tokens_token_hash_key" ON "shop_activation_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "shop_activation_tokens_user_idx" ON "shop_activation_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "shop_activation_tokens_one_open_key" ON "shop_activation_tokens"("user_id") WHERE (used_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "shop_sessions_token_hash_key" ON "shop_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "shop_sessions_user_idx" ON "shop_sessions"("user_id");

-- AddForeignKey
ALTER TABLE "shop_user_credentials" ADD CONSTRAINT "shop_user_credentials_user_fkey" FOREIGN KEY ("user_id") REFERENCES "shop_users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shop_activation_tokens" ADD CONSTRAINT "shop_activation_tokens_user_fkey" FOREIGN KEY ("user_id") REFERENCES "shop_users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shop_sessions" ADD CONSTRAINT "shop_sessions_user_fkey" FOREIGN KEY ("user_id") REFERENCES "shop_users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- AddCheckConstraint (written by hand; Prisma cannot express CHECK constraints)
-- Only Argon2id hashes in PHC format, never a plain password
ALTER TABLE "shop_user_credentials" ADD CONSTRAINT "shop_user_credentials_argon2id_check" CHECK ("password_hash" LIKE '$argon2id$v=19$%');

-- Tokens are stored as SHA-256 hex digests only
ALTER TABLE "shop_activation_tokens" ADD CONSTRAINT "shop_activation_tokens_token_hash_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "shop_sessions" ADD CONSTRAINT "shop_sessions_token_hash_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$');

-- Plausible lifetimes
ALTER TABLE "shop_activation_tokens" ADD CONSTRAINT "shop_activation_tokens_times_check" CHECK ("expires_at" > "created_at" AND ("used_at" IS NULL OR "used_at" >= "created_at"));
ALTER TABLE "shop_sessions" ADD CONSTRAINT "shop_sessions_times_check" CHECK ("expires_at" > "created_at" AND "last_seen_at" >= "created_at" AND ("revoked_at" IS NULL OR "revoked_at" >= "created_at"));

-- Sessions end for good when access is withdrawn (written by hand).
-- Triggers cover every path: the API, direct changes and future imports.
-- Reactivating a user or an account later restores no old session. The
-- revocation time is never before the session began (CHECK above), even
-- when the session was created with a test clock.

-- A customer account is inactive when its owner customer is; only owner
-- customers have shop users (shop_users.account_customer_number)
CREATE FUNCTION "shop_sessions_revoke_for_inactive_account"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "shop_sessions" s
     SET "revoked_at" = GREATEST(now(), s."created_at")
    FROM "shop_users" u
   WHERE s."user_id" = u."id"
     AND u."account_customer_number" = NEW."customer_number"
     AND s."revoked_at" IS NULL;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "customers_revoke_shop_sessions"
AFTER UPDATE OF "is_active" ON "customers"
FOR EACH ROW WHEN (OLD."is_active" AND NOT NEW."is_active")
EXECUTE FUNCTION "shop_sessions_revoke_for_inactive_account"();

CREATE FUNCTION "shop_sessions_revoke_for_disabled_user"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "shop_sessions"
     SET "revoked_at" = GREATEST(now(), "created_at")
   WHERE "user_id" = NEW."id"
     AND "revoked_at" IS NULL;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "shop_users_revoke_sessions"
AFTER UPDATE OF "status" ON "shop_users"
FOR EACH ROW WHEN (NEW."status" = 'DISABLED' AND OLD."status" <> 'DISABLED')
EXECUTE FUNCTION "shop_sessions_revoke_for_disabled_user"();

COMMIT;
