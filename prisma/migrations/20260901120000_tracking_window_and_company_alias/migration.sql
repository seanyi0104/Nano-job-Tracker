-- Tracking window: SyncState only knew where a sync ENDED, so the product
-- could say "last synced at X" but never "I am tracking March onwards".
-- Both columns are nullable; existing rows keep working with an unset window
-- until the first Reset defines one.
ALTER TABLE "SyncState" ADD COLUMN "windowStart" DATETIME;
ALTER TABLE "SyncState" ADD COLUMN "lastAction" TEXT;

-- User-confirmed company aliases. Not inferred: normalisation already handles
-- brackets and region suffixes, but "Works4You" vs "W4U Sydney Pty Ltd" is an
-- abbreviation, and a rule general enough to catch it would also merge Google
-- with Google Cloud. Stored per user so no one person's employers ship as
-- everyone's defaults.
CREATE TABLE "CompanyAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "aliasNormalized" TEXT NOT NULL,
    "canonicalNormalized" TEXT NOT NULL,
    "canonicalLabel" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompanyAlias_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CompanyAlias_userId_aliasNormalized_key" ON "CompanyAlias"("userId", "aliasNormalized");
CREATE INDEX "CompanyAlias_userId_canonicalNormalized_idx" ON "CompanyAlias"("userId", "canonicalNormalized");
