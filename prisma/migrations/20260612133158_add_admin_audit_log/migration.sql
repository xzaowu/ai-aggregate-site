-- CreateTable
CREATE TABLE `AdminAuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `adminUserId` VARCHAR(191) NOT NULL,
    `adminEmail` VARCHAR(191) NOT NULL,
    `action` VARCHAR(50) NOT NULL,
    `targetType` VARCHAR(50) NOT NULL,
    `targetId` VARCHAR(100) NULL,
    `summary` VARCHAR(500) NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AdminAuditLog_adminUserId_createdAt_idx`(`adminUserId`, `createdAt`),
    INDEX `AdminAuditLog_action_createdAt_idx`(`action`, `createdAt`),
    INDEX `AdminAuditLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
