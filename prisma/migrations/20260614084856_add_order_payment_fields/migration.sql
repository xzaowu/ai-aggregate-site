-- AlterTable
ALTER TABLE `Order` ADD COLUMN `paymentProvider` VARCHAR(191) NULL,
    ADD COLUMN `paymentTradeNo` VARCHAR(191) NULL,
    ADD COLUMN `paymentUrl` VARCHAR(191) NULL,
    ADD COLUMN `providerTradeNo` VARCHAR(191) NULL;
