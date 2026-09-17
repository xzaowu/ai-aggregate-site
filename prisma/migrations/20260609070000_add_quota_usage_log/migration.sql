-- CreateTable
CREATE TABLE `UserQuota` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `remainingCredits` INTEGER NOT NULL DEFAULT 20,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `UserQuota_userId_key`(`userId`),
    INDEX `UserQuota_remainingCredits_idx`(`remainingCredits`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UsageLog` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `sessionId` VARCHAR(191) NULL,
    `model` VARCHAR(191) NOT NULL,
    `status` ENUM('SUCCESS', 'FAILED') NOT NULL,
    `costCredits` INTEGER NOT NULL DEFAULT 0,
    `errorMessage` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `UsageLog_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `UsageLog_sessionId_createdAt_idx`(`sessionId`, `createdAt`),
    INDEX `UsageLog_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Backfill existing local users with the MVP default quota.
INSERT INTO `UserQuota` (`id`, `userId`, `remainingCredits`, `createdAt`, `updatedAt`)
SELECT CONCAT('quota_', `id`), `id`, 20, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `User`
WHERE NOT EXISTS (
    SELECT 1 FROM `UserQuota` WHERE `UserQuota`.`userId` = `User`.`id`
);

-- AddForeignKey
ALTER TABLE `UserQuota` ADD CONSTRAINT `UserQuota_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UsageLog` ADD CONSTRAINT `UsageLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UsageLog` ADD CONSTRAINT `UsageLog_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `ChatSession`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
