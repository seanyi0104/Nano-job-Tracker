-- CreateTable
CREATE TABLE "CvProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "summaryJson" TEXT,
    "syncedAt" DATETIME,
    "syncError" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CvProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JdAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT,
    "company" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "jdText" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "matchScore" INTEGER NOT NULL,
    "verdict" TEXT NOT NULL,
    "analysisJson" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JdAnalysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JdAnalysis_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CvProfile_userId_key" ON "CvProfile"("userId");

-- CreateIndex
CREATE INDEX "JdAnalysis_userId_createdAt_idx" ON "JdAnalysis"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "JdAnalysis_applicationId_idx" ON "JdAnalysis"("applicationId");
