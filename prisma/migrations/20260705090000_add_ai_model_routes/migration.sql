-- CreateTable
CREATE TABLE `AiModelRoute` (
    `id` VARCHAR(191) NOT NULL,
    `modelId` VARCHAR(191) NOT NULL,
    `providerId` VARCHAR(191) NOT NULL,
    `upstreamModel` VARCHAR(255) NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AiModelRoute_modelId_providerId_upstreamModel_key`(`modelId`, `providerId`, `upstreamModel`),
    INDEX `AiModelRoute_modelId_enabled_priority_idx`(`modelId`, `enabled`, `priority`),
    INDEX `AiModelRoute_providerId_enabled_priority_idx`(`providerId`, `enabled`, `priority`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `UsageLog`
    ADD COLUMN `canonicalModel` VARCHAR(255) NULL,
    ADD COLUMN `providerId` VARCHAR(191) NULL,
    ADD COLUMN `providerName` VARCHAR(255) NULL,
    ADD COLUMN `upstreamModel` VARCHAR(255) NULL,
    ADD COLUMN `routeId` VARCHAR(191) NULL,
    ADD COLUMN `fallbackAttempts` INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE `AiModelRoute` ADD CONSTRAINT `AiModelRoute_modelId_fkey` FOREIGN KEY (`modelId`) REFERENCES `AiModel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AiModelRoute` ADD CONSTRAINT `AiModelRoute_providerId_fkey` FOREIGN KEY (`providerId`) REFERENCES `AiProviderAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
