-- AlterTable: Add uiCopy and faq fields to Merchant (nullable, safe to add)
ALTER TABLE "Merchant" ADD COLUMN IF NOT EXISTS "uiCopy" JSONB;

ALTER TABLE "Merchant" ADD COLUMN IF NOT EXISTS "faq" JSONB;

-- AlterTable: Add route, actionType, hadActionClick, hadTypedYesNo to ConversationEvent (nullable with defaults, safe to add)
ALTER TABLE "ConversationEvent" ADD COLUMN IF NOT EXISTS "route" TEXT;

ALTER TABLE "ConversationEvent" ADD COLUMN IF NOT EXISTS "actionType" TEXT;

ALTER TABLE "ConversationEvent" ADD COLUMN IF NOT EXISTS "hadActionClick" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ConversationEvent" ADD COLUMN IF NOT EXISTS "hadTypedYesNo" BOOLEAN NOT NULL DEFAULT false;


