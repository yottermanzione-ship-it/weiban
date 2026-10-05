/**
 * billing 模块装配（D-L0-16）。说明见 docs/backend/billing.md。
 */
import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/index.js';
import { BillingAdminService } from './application/admin.js';
import { Ledger } from './application/ledger.js';
import { BillingLifecycle } from './application/lifecycle.js';
import { PlatformBudget } from './application/platform-budget.js';
import { PriceService } from './application/prices.js';
import { ReconciliationService } from './application/reconciliation.js';
import { ReservationService } from './application/reservations.js';
import { WalletService } from './application/wallet.js';
import { BillingAdminController, BillingController } from './http/billing.controller.js';
import { BILLING_READ_PORT, BILLING_RESERVATION_PORT } from './tokens.js';

@Module({
  imports: [IdentityModule],
  controllers: [BillingController, BillingAdminController],
  providers: [
    Ledger,
    PlatformBudget,
    PriceService,
    ReservationService,
    WalletService,
    BillingAdminService,
    ReconciliationService,
    BillingLifecycle,
    { provide: BILLING_RESERVATION_PORT, useExisting: ReservationService },
    { provide: BILLING_READ_PORT, useExisting: WalletService },
  ],
  exports: [BILLING_RESERVATION_PORT, BILLING_READ_PORT],
})
export class BillingModule {}
