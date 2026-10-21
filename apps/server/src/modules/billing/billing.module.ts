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
import { ModelRateService } from './application/model-rates.js';
import { RechargeService } from './application/recharge.js';
import { WalletService } from './application/wallet.js';
import { MembershipOrderService } from './application/membership-orders.js';
import { BillingAdminController, BillingController } from './http/billing.controller.js';
import {
  MembershipAdminController,
  MembershipOfferController,
} from './http/membership.controller.js';
import { ChargeQueryService } from './application/charge-query.js';
import { BillingQuoteService } from './application/quotes.js';
import {
  BILLING_CHARGE_QUERY_PORT,
  BILLING_DAILY_SPEND_READ_PORT,
  BILLING_MODEL_RATE_PORT,
  BILLING_PAID_HISTORY_PORT,
  BILLING_QUOTE_PORT,
  BILLING_READ_PORT,
  BILLING_RESERVATION_PORT,
  BILLING_SERVICE_FEE_PORT,
} from './tokens.js';
import { PaidHistoryService } from './application/paid-history.js';
import { ServiceFeeService } from './application/service-fees.js';
import { CostResolutionService } from './application/cost-resolution.js';
import { PostpaidSettingsService } from './application/postpaid-settings.js';

@Module({
  imports: [IdentityModule],
  controllers: [
    BillingController,
    BillingAdminController,
    MembershipOfferController,
    MembershipAdminController,
  ],
  providers: [
    CostResolutionService,
    PostpaidSettingsService,
    Ledger,
    PlatformBudget,
    PriceService,
    ReservationService,
    WalletService,
    MembershipOrderService,
    BillingAdminService,
    ReconciliationService,
    BillingLifecycle,
    { provide: BILLING_RESERVATION_PORT, useExisting: ReservationService },
    { provide: BILLING_READ_PORT, useExisting: WalletService },
    ChargeQueryService,
    { provide: BILLING_CHARGE_QUERY_PORT, useExisting: ChargeQueryService },
    BillingQuoteService,
    { provide: BILLING_QUOTE_PORT, useExisting: BillingQuoteService },
    { provide: BILLING_DAILY_SPEND_READ_PORT, useExisting: BillingQuoteService },
    RechargeService,
    ModelRateService,
    { provide: BILLING_MODEL_RATE_PORT, useExisting: ModelRateService },
    ServiceFeeService,
    { provide: BILLING_SERVICE_FEE_PORT, useExisting: ServiceFeeService },
    PaidHistoryService,
    { provide: BILLING_PAID_HISTORY_PORT, useExisting: PaidHistoryService },
  ],
  exports: [
    BILLING_MODEL_RATE_PORT,
    BILLING_RESERVATION_PORT,
    BILLING_READ_PORT,
    BILLING_CHARGE_QUERY_PORT,
    BILLING_QUOTE_PORT,
    BILLING_DAILY_SPEND_READ_PORT,
    BILLING_SERVICE_FEE_PORT,
    BILLING_PAID_HISTORY_PORT,
  ],
})
export class BillingModule {}
