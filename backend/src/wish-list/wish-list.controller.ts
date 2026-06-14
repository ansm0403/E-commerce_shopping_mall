import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { WishListService } from './wish-list.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../user/entity/role.entity';
import { User } from '../auth/decorators/user.decorator';
import { ToggleWishlistDto } from './dto/toggle-wishlist.dto';
import { Serialize } from '../common/interceptors/serialize.interceptor';
import { WishlistItemResponseDto } from './dto/wishlist-response.dto';
import { BasePaginateDto } from '../common/dto/paginate.dto';

@Controller('wishlist')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.BUYER)
export class WishListController {
  constructor(private readonly wishListService: WishListService) {}

  @Post('toggle')
  toggle(
    @User('sub') userId: number,
    @Body() dto: ToggleWishlistDto,
  ) {
    return this.wishListService.toggle(userId, dto.productId);
  }

  @Get()
  @Serialize(WishlistItemResponseDto)
  getMyList(
    @User('sub') userId: number,
    @Query() query: BasePaginateDto,
  ) {
    return this.wishListService.getMyList(userId, query);
  }

  @Delete()
  clearAll(@User('sub') userId: number) {
    return this.wishListService.clearAll(userId);
  }
}
