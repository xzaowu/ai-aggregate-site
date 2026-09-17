-- Reuse the existing Plan table for manual order packages.
ALTER TABLE `Plan` CHANGE COLUMN `priceCents` `price` INTEGER NOT NULL;

ALTER TABLE `Plan`
    MODIFY `slug` VARCHAR(191) NULL,
    ADD COLUMN `enabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `sortOrder` INTEGER NOT NULL DEFAULT 0;

CREATE INDEX `Plan_enabled_sortOrder_idx` ON `Plan`(`enabled`, `sortOrder`);
CREATE INDEX `Plan_sortOrder_idx` ON `Plan`(`sortOrder`);

-- CreateTable
CREATE TABLE `Order` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `credits` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'PAID', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `paidAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Order_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `Order_planId_createdAt_idx`(`planId`, `createdAt`),
    INDEX `Order_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `Plan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
