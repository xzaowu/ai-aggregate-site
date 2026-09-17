-- CreateIndex
CREATE UNIQUE INDEX `Order_paymentTradeNo_key` ON `Order`(`paymentTradeNo`);

-- CreateIndex
CREATE UNIQUE INDEX `Order_providerTradeNo_key` ON `Order`(`providerTradeNo`);
