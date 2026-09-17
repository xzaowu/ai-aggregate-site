-- CreateTable
CREATE TABLE `IdempotencyRequest` (
    `id` VARCHAR(191) NOT NULL,
    `scope` VARCHAR(64) NOT NULL,
    `ownerType` ENUM('USER', 'GUEST') NOT NULL,
    `ownerKeyHash` BINARY(32) NOT NULL,
    `idempotencyKeyHash` BINARY(32) NOT NULL,
    `requestFingerprint` BINARY(32) NOT NULL,
    `status` ENUM('CLAIMED', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'CLAIMED',
    `claimTokenHash` BINARY(32) NULL,
    `claimExpiresAt` DATETIME(3) NULL,
    `aiTaskId` VARCHAR(191) NULL,
    `responseStatus` INTEGER NULL,
    `responseCode` VARCHAR(64) NULL,
    `expiresAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `IdempotencyRequest_aiTaskId_key`(`aiTaskId`),
    UNIQUE INDEX `IdempotencyRequest_scope_owner_key_key`(`scope`, `ownerType`, `ownerKeyHash`, `idempotencyKeyHash`),
    INDEX `IdempotencyRequest_status_updatedAt_idx`(`status`, `updatedAt`),
    INDEX `IdempotencyRequest_status_expiresAt_idx`(`status`, `expiresAt`),
    INDEX `IdempotencyRequest_status_claimExpiresAt_idx`(`status`, `claimExpiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `IdempotencyRequest` ADD CONSTRAINT `IdempotencyRequest_aiTaskId_fkey` FOREIGN KEY (`aiTaskId`) REFERENCES `AiTask`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
