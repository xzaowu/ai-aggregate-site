-- CreateTable
CREATE TABLE `AccountCreditEvent` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `deltaCredits` INTEGER NOT NULL,
    `balanceBefore` INTEGER NOT NULL,
    `balanceAfter` INTEGER NOT NULL,
    `sourceType` VARCHAR(64) NOT NULL,
    `sourceId` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `metadata` JSON NULL,

    UNIQUE INDEX `AccountCreditEvent_idempotencyKey_key`(`idempotencyKey`),
    INDEX `AccountCreditEvent_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `AccountCreditEvent_sourceType_sourceId_idx`(`sourceType`, `sourceId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `AccountCreditEvent_deltaCredits_check` CHECK (`deltaCredits` <> 0),
    CONSTRAINT `AccountCreditEvent_balanceAfter_check` CHECK (`balanceAfter` = `balanceBefore` + `deltaCredits`),
    CONSTRAINT `AccountCreditEvent_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
