-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" DATETIME,
    "image" TEXT
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SyncState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "lastSyncedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "progressFetched" INTEGER NOT NULL DEFAULT 0,
    "progressTotal" INTEGER NOT NULL DEFAULT 0,
    "progressPhase" TEXT,
    "lastError" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SyncState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Email" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "gmailId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "snippet" TEXT NOT NULL,
    "internalDate" DATETIME NOT NULL,
    "bodyText" TEXT,
    "isJobRelated" BOOLEAN,
    "emailType" TEXT,
    "classifiedAt" DATETIME,
    "extractedAt" DATETIME,
    "extractionJson" TEXT,
    "applicationId" TEXT,
    CONSTRAINT "Email_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Email_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "companyNormalized" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "roleNormalized" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPLIED',
    "statusIsManual" BOOLEAN NOT NULL DEFAULT false,
    "appliedDate" DATETIME,
    "lastEmailDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Application_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CompanyPrep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "snapshotJson" TEXT,
    "interviewPrepJson" TEXT,
    "snapshotGeneratedAt" DATETIME,
    "prepGeneratedAt" DATETIME,
    CONSTRAINT "CompanyPrep_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BehavioralQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "rationale" TEXT,
    "userAnswer" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BehavioralQuestion_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "SyncState_userId_key" ON "SyncState"("userId");

-- CreateIndex
CREATE INDEX "Email_userId_internalDate_idx" ON "Email"("userId", "internalDate");

-- CreateIndex
CREATE UNIQUE INDEX "Email_userId_gmailId_key" ON "Email"("userId", "gmailId");

-- CreateIndex
CREATE INDEX "Application_userId_companyNormalized_roleNormalized_idx" ON "Application"("userId", "companyNormalized", "roleNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyPrep_applicationId_key" ON "CompanyPrep"("applicationId");

-- CreateIndex
CREATE INDEX "BehavioralQuestion_applicationId_idx" ON "BehavioralQuestion"("applicationId");
