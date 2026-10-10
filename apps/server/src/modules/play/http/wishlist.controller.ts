/** 心愿清单（契约 WishlistEndpoints），T-092。 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { WishlistEndpoints as W } from '@weiban/contracts';
import {
  ContractPipe,
  CurrentPrincipal,
  RequireAuth,
  type AuthPrincipal,
} from '../../../platform/index.js';
import { WishlistService } from '../application/wishlist.service.js';

@Controller('api/v1/play')
@RequireAuth('user')
export class WishlistController {
  constructor(@Inject(WishlistService) private readonly wishlist: WishlistService) {}

  @Get('wishlists')
  listSummaries(@CurrentPrincipal() p: AuthPrincipal) {
    return this.wishlist.listSummaries(p.userId);
  }

  @Get('wishlists/:characterId')
  listItems(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(W.listItems.params!)) params: { characterId: string },
  ) {
    return this.wishlist.listItems(p.userId, params.characterId);
  }

  @Post('wishlists/:characterId/items')
  @HttpCode(200)
  addItem(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(W.addItem.params!)) params: { characterId: string },
    @Body() body: unknown,
  ) {
    return this.wishlist.addItem(p.userId, params.characterId, body);
  }

  @Patch('wishlist-items/:itemId')
  updateItem(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(W.updateItem.params!)) params: { itemId: string },
    @Body() body: unknown,
  ) {
    return this.wishlist.updateItem(p.userId, params.itemId, body);
  }

  @Delete('wishlist-items/:itemId')
  @HttpCode(204)
  async deleteItem(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param(new ContractPipe(W.deleteItem.params!)) params: { itemId: string },
  ) {
    await this.wishlist.deleteItem(p.userId, params.itemId);
  }
}
