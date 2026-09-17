-- CreateTable
CREATE TABLE `StorageObject` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `storageProvider` ENUM('LOCAL', 'S3_COMPATIBLE') NOT NULL,
    `objectKey` VARCHAR(512) NOT NULL,
    `mimeType` VARCHAR(100) NULL,
    `sizeBytes` BIGINT NULL,
    `sha256` CHAR(64) NULL,
    `source` ENUM('UPLOAD', 'GENERATED', 'IMPORTED') NOT NULL,
    `status` ENUM('PENDING', 'READY', 'FAILED', 'DELETED') NOT NULL DEFAULT 'PENDING',
    `expiresAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StorageObject_storageProvider_objectKey_key`(`storageProvider`, `objectKey`),
    INDEX `StorageObject_userId_sha256_idx`(`userId`, `sha256`),
    INDEX `StorageObject_status_expiresAt_idx`(`status`, `expiresAt`),
    INDEX `StorageObject_userId_status_createdAt_idx`(`userId`, `status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `AiAsset` ADD COLUMN `storageObjectId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `AiAsset_storageObjectId_idx` ON `AiAsset`(`storageObjectId`);

-- AddForeignKey
ALTER TABLE `StorageObject` ADD CONSTRAINT `StorageObject_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AiAsset` ADD CONSTRAINT `AiAsset_storageObjectId_fkey` FOREIGN KEY (`storageObjectId`) REFERENCES `StorageObject`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
