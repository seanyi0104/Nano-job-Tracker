-- Per-call token accounting. The provider's console gives a monthly total and
-- no per-request breakdown, so without this there is no way to answer "what did
-- that Reset cost" except by guessing — and guessing from character counts
-- under-reported a real run threefold, because CJK text costs far more per
-- character than English.
--
-- Token columns are stored verbatim from the API response so the arithmetic
-- stays checkable against a bill; costUsd is priced at call time so a later
-- price change does not silently rewrite history.
CREATE TABLE "LlmUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operation" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "items" INTEGER NOT NULL DEFAULT 1,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" REAL NOT NULL,
    CONSTRAINT "LlmUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "LlmUsage_userId_at_idx" ON "LlmUsage"("userId", "at");
