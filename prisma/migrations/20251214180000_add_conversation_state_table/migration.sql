-- Create ConversationState table for persistent conversation state per (merchantId, sessionId)
-- Supports: shown products, ranked list cursor, pending actions, preferences memory

CREATE TABLE IF NOT EXISTS "ConversationState" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "shownProductIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "lastQueryFingerprint" TEXT,
    "lastRankedProductIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "lastRankCursor" INTEGER NOT NULL DEFAULT 0,
    "pendingActions" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "memory" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationState_pkey" PRIMARY KEY ("id")
);

-- Create unique constraint on (merchantId, sessionId)
CREATE UNIQUE INDEX IF NOT EXISTS "ConversationState_merchantId_sessionId_key" ON "ConversationState"("merchantId", "sessionId");

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS "ConversationState_merchantId_idx" ON "ConversationState"("merchantId");
CREATE INDEX IF NOT EXISTS "ConversationState_merchantId_sessionId_idx" ON "ConversationState"("merchantId", "sessionId");
CREATE INDEX IF NOT EXISTS "ConversationState_sessionId_idx" ON "ConversationState"("sessionId");
CREATE INDEX IF NOT EXISTS "ConversationState_updatedAt_idx" ON "ConversationState"("updatedAt");

-- Add foreign key constraint
ALTER TABLE "ConversationState" ADD CONSTRAINT "ConversationState_merchantId_fkey" 
    FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


