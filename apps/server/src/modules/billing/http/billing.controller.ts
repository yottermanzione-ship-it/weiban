/**
 * billing 的 HTTP 接口，一一对应契约 BillingEndpoints / BillingAdminEndpoints
 * （packages/contracts/src/http/billing.ts）。请求参数一律用契约里的 schema 校验。
 */
import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import {
  BillingAdminEndpoints,
  BillingEndpoints,
  type LedgerEntry,
  type PriceTable,
  type Wallet,
} from '@weiban/contracts';
import type { z } from 'zod';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { BillingAdminService } from '../application/admin.js';
import { PriceService } from '../application/prices.js';
import { ReconciliationService } from '../application/reconciliation.js';
import { WalletService } from '../application/wallet.js';

const E = BillingEndpoints;
const A = BillingAdminEndpoints;

type Out<S extends z.ZodType | undefined> = z.output<NonNullable<S>>;

function schema<S extends z.ZodType>(value: S | undefined): S {
  if (!value) throw new Error('契约接口缺少 schema');
  return value;
}

@Controller('api/v1/billing')
export class BillingController {
  constructor(
    @Inject(WalletService) private readonly wallet: WalletService,
    @Inject(PriceService) private readonly prices: PriceService,
  ) {}

  @Get('wallet')
  @RequireAuth(E.getWallet.auth)
  getWallet(@CurrentPrincipal() me: AuthPrincipal): Promise<Wallet> {
    return this.wallet.getWallet(me.userId);
  }

  @Patch('wallet/settings')
  @RequireAuth(E.updateWalletSettings.auth)
  updateSettings(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(E.updateWalletSettings.body)))
    body: Out<typeof E.updateWalletSettings.body>,
  ): Promise<Wallet> {
    return this.wallet.updateSettings(me.userId, body);
  }

  @Get('ledger')
  @RequireAuth(E.listLedger.auth)
  listLedger(
    @CurrentPrincipal() me: AuthPrincipal,
    @Query(new ContractPipe(schema(E.listLedger.query))) query: Out<typeof E.listLedger.query>,
  ): Promise<{ items: LedgerEntry[]; nextCursor: string | null }> {
    return this.wallet.listLedger(me.userId, query);
  }

  @Get('prices')
  @RequireAuth(E.getPrices.auth)
  getPrices(): Promise<PriceTable> {
    return this.prices.publicTable();
  }

  @Get('usage-summary')
  @RequireAuth(E.getUsageSummary.auth)
  usageSummary(
    @CurrentPrincipal() me: AuthPrincipal,
    @Query(new ContractPipe(schema(E.getUsageSummary.query)))
    query: Out<typeof E.getUsageSummary.query>,
  ) {
    return this.wallet.usageSummary(me.userId, query);
  }
}

@Controller('api/v1/admin/billing')
export class BillingAdminController {
  constructor(
    @Inject(BillingAdminService) private readonly admin: BillingAdminService,
    @Inject(PriceService) private readonly prices: PriceService,
    @Inject(ReconciliationService) private readonly reconciliation: ReconciliationService,
  ) {}

  @Get('accounts')
  @RequireAuth(A.listAccounts.auth)
  async listAccounts() {
    return { items: await this.admin.listAccounts() };
  }

  @Post('accounts/:userId/adjustments')
  @HttpCode(201)
  @RequireAuth(A.adjustBalance.auth)
  adjust(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(A.adjustBalance.params))) params: { userId: string },
    @Body(new ContractPipe(schema(A.adjustBalance.body))) body: Out<typeof A.adjustBalance.body>,
  ) {
    return this.admin.adjust(me.userId, params.userId, body);
  }

  @Get('accounts/:userId/ledger')
  @RequireAuth(A.listAccountLedger.auth)
  accountLedger(
    @Param(new ContractPipe(schema(A.listAccountLedger.params))) params: { userId: string },
    @Query(new ContractPipe(schema(A.listAccountLedger.query)))
    query: Out<typeof A.listAccountLedger.query>,
  ) {
    return this.admin.listAccountLedger(params.userId, query);
  }

  @Get('price-versions')
  @RequireAuth(A.listPriceVersions.auth)
  async listPriceVersions() {
    return { items: await this.prices.list() };
  }

  @Post('price-versions')
  @HttpCode(201)
  @RequireAuth(A.createPriceVersion.auth)
  createPriceVersion(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(A.createPriceVersion.body)))
    body: Out<typeof A.createPriceVersion.body>,
  ) {
    return this.prices.createDraft(me.userId, body);
  }

  @Patch('price-versions/:priceVersionId')
  @RequireAuth(A.updatePriceDraft.auth)
  updatePriceDraft(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(A.updatePriceDraft.params))) params: { priceVersionId: string },
    @Body(new ContractPipe(schema(A.updatePriceDraft.body)))
    body: Out<typeof A.updatePriceDraft.body>,
  ) {
    return this.prices.updateDraft(me.userId, params.priceVersionId, body);
  }

  @Post('price-versions/:priceVersionId/activate')
  @HttpCode(200)
  @RequireAuth(A.activatePriceVersion.auth)
  activate(
    @CurrentPrincipal() me: AuthPrincipal,
    @Param(new ContractPipe(schema(A.activatePriceVersion.params)))
    params: { priceVersionId: string },
    @Body(new ContractPipe(schema(A.activatePriceVersion.body)))
    body: Out<typeof A.activatePriceVersion.body>,
  ) {
    return this.prices.activate(me.userId, params.priceVersionId, body.effectiveFrom);
  }

  @Post('upstream-bills')
  @HttpCode(201)
  @RequireAuth(A.createUpstreamBill.auth)
  createUpstreamBill(
    @CurrentPrincipal() me: AuthPrincipal,
    @Body(new ContractPipe(schema(A.createUpstreamBill.body)))
    body: Out<typeof A.createUpstreamBill.body>,
  ) {
    return this.admin.createUpstreamBill(me.userId, body);
  }

  @Get('reconciliation')
  @RequireAuth(A.listReconciliation.auth)
  async listReconciliation(
    @Query(new ContractPipe(schema(A.listReconciliation.query)))
    query: Out<typeof A.listReconciliation.query>,
  ) {
    return { items: await this.reconciliation.list(query.from, query.to) };
  }

  @Get('platform-summary')
  @RequireAuth(A.getPlatformSummary.auth)
  platformSummary() {
    return this.admin.platformSummary();
  }
}
