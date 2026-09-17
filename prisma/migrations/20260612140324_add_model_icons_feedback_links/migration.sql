-- AlterTable
ALTER TABLE `AiModel` ADD COLUMN `iconColor` VARCHAR(50) NULL,
    ADD COLUMN `iconText` VARCHAR(10) NULL,
    ADD COLUMN `iconUrl` VARCHAR(500) NULL;

-- CreateTable
CREATE TABLE `Feedback` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `userEmail` VARCHAR(191) NULL,
    `type` VARCHAR(20) NOT NULL,
    `content` TEXT NOT NULL,
    `screenshotUrl` VARCHAR(500) NULL,
    `status` ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Feedback_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `Feedback_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Link` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(100) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `description` VARCHAR(255) NULL,
    `category` VARCHAR(20) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Link_category_enabled_sortOrder_idx`(`category`, `enabled`, `sortOrder`),
    INDEX `Link_enabled_sortOrder_idx`(`enabled`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Feedback` ADD CONSTRAINT `Feedback_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
