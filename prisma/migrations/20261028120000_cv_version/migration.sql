-- CV versions, so a JD analysis can prove which CV it was built on.
--
-- The CV lives in nanobot's memory, where this app cannot look. For weeks one
-- long-lived nanobot session answered every analysis from a CV it had read on
-- 08-09, through every CV save since, and each reply still parsed as a
-- success. Now the CV is stamped with a version when it is written, the agent
-- has to quote that version back, and both ends of the check are stored here.

-- AlterTable
ALTER TABLE "CvProfile" ADD COLUMN "syncedVersion" TEXT;

-- AlterTable
ALTER TABLE "JdAnalysis" ADD COLUMN "cvVersion" TEXT;
