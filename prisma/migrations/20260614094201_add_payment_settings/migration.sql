-- CreateTable
CREATE TABLE `PaymentSetting` (
    `id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(20) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `gatewayUrl` VARCHAR(191) NULL,
    `pid` VARCHAR(191) NULL,
    `encryptedKey` TEXT NULL,
    `notifyUrl` VARCHAR(191) NULL,
    `returnUrl` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PaymentSetting_provider_key`(`provider`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
