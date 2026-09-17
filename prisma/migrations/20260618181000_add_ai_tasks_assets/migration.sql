-- CreateTable
CREATE TABLE `AiTask` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` ENUM('IMAGE', 'VIDEO', 'PPT', 'DOCUMENT') NOT NULL,
    `status` ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `modelId` VARCHAR(191) NULL,
    `prompt` TEXT NOT NULL,
    `input` JSON NOT NULL,
    `output` JSON NULL,
    `costCredits` INTEGER NOT NULL DEFAULT 0,
    `errorMessage` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `completedAt` DATETIME(3) NULL,

    INDEX `AiTask_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `AiTask_userId_type_status_createdAt_idx`(`userId`, `type`, `status`, `createdAt`),
    INDEX `AiTask_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AiAsset` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NULL,
    `type` ENUM('IMAGE', 'VIDEO', 'DOCUMENT') NOT NULL,
    `url` TEXT NOT NULL,
    `thumbnailUrl` VARCHAR(191) NULL,
    `title` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AiAsset_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `AiAsset_userId_type_createdAt_idx`(`userId`, `type`, `createdAt`),
    INDEX `AiAsset_taskId_idx`(`taskId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AiTask` ADD CONSTRAINT `AiTask_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AiAsset` ADD CONSTRAINT `AiAsset_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AiAsset` ADD CONSTRAINT `AiAsset_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `AiTask`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
