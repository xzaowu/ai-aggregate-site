ALTER TABLE `Feedback` ADD COLUMN `archivedAt` DATETIME(3) NULL;

CREATE INDEX `Feedback_archivedAt_createdAt_idx` ON `Feedback`(`archivedAt`, `createdAt`);
