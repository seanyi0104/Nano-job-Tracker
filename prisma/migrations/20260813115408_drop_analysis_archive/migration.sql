-- The Archive button became Delete, so nothing writes this column any more.
-- Every existing row has NULL here, so the drop is data-preserving.
ALTER TABLE "JdAnalysis" DROP COLUMN "archivedAt";
