-- AlterTable
ALTER TABLE `CreditReservation`
    ADD COLUMN `requestId` VARCHAR(191) NULL,
    ADD COLUMN `providerAttemptStartedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `UsageLog`
    ADD COLUMN `attemptStatus` ENUM('STARTED', 'SUCCEEDED', 'FAILED', 'UNKNOWN', 'ABORTED') NULL,
    ADD COLUMN `attemptCompletedAt` DATETIME(3) NULL,
    ADD COLUMN `reservationId` VARCHAR(191) NULL,
    ADD COLUMN `requestId` VARCHAR(191) NULL,
    ADD COLUMN `attemptIndex` INTEGER NULL;

-- CreateIndex
CREATE UNIQUE INDEX `CreditReservation_requestId_key` ON `CreditReservation`(`requestId`);

-- CreateIndex
CREATE UNIQUE INDEX `UsageLog_requestId_attemptIndex_key` ON `UsageLog`(`requestId`, `attemptIndex`);

-- CreateIndex
CREATE INDEX `UsageLog_reservationId_createdAt_idx` ON `UsageLog`(`reservationId`, `createdAt`);

-- AddForeignKey
ALTER TABLE `UsageLog` ADD CONSTRAINT `UsageLog_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `CreditReservation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
