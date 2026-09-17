-- CreateTable
CREATE TABLE `PaymentAttempt` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `ordinal` INTEGER NOT NULL,
    `provider` VARCHAR(20) NOT NULL,
    `providerMerchantRef` VARCHAR(191) NOT NULL,
    `paymentType` VARCHAR(20) NOT NULL,
    `merchantTradeNo` VARCHAR(191) NOT NULL,
    `providerTradeNo` VARCHAR(191) NULL,
    `providerTradeIdentityHash` BINARY(32) NULL,
    `status` ENUM('ACTIVE', 'RETIRED', 'PAID', 'PAID_REQUIRES_REVIEW') NOT NULL DEFAULT 'ACTIVE',
    `paidAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PaymentAttempt_merchantTradeNo_key`(`merchantTradeNo`),
    UNIQUE INDEX `PaymentAttempt_providerTradeIdentityHash_key`(`providerTradeIdentityHash`),
    INDEX `PaymentAttempt_orderId_status_createdAt_idx`(`orderId`, `status`, `createdAt`),
    INDEX `PaymentAttempt_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `PaymentAttempt_provider_providerMerchantRef_providerTradeNo_idx`(`provider`, `providerMerchantRef`, `providerTradeNo`),
    UNIQUE INDEX `PaymentAttempt_orderId_ordinal_key`(`orderId`, `ordinal`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PaymentAttempt` ADD CONSTRAINT `PaymentAttempt_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
