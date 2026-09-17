-- CreateTable
CREATE TABLE `AiProviderAccount` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `providerType` VARCHAR(50) NOT NULL,
    `baseUrl` VARCHAR(500) NOT NULL,
    `apiKey` TEXT NOT NULL,
    `capabilities` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `timeoutMs` INTEGER NOT NULL DEFAULT 60000,
    `headersJson` JSON NULL,
    `configJson` JSON NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `AiModel` ADD COLUMN `providerAccountId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `AiProviderAccount_enabled_priority_idx` ON `AiProviderAccount`(`enabled`, `priority`);

-- CreateIndex
CREATE INDEX `AiProviderAccount_providerType_idx` ON `AiProviderAccount`(`providerType`);

-- CreateIndex
CREATE INDEX `AiModel_providerAccountId_idx` ON `AiModel`(`providerAccountId`);

-- AddForeignKey
ALTER TABLE `AiModel` ADD CONSTRAINT `AiModel_providerAccountId_fkey` FOREIGN KEY (`providerAccountId`) REFERENCES `AiProviderAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
