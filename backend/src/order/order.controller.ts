import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { ShipOrderDto } from './dto/ship-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DemoAccountGuard } from '../auth/guards/demo-account.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../user/entity/role.entity';
import { Serialize } from '../common/interceptors/serialize.interceptor';
import { Auditable } from '../audit/decorators/auditable.decorator';
import { AuditAction } from '../audit/entity/audit-log.entity';

/** 구매자 주문 */
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.BUYER)
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Post()
  @Serialize(OrderResponseDto)
  @Auditable(AuditAction.ORDER_CREATED)
  createOrder(@Body() dto: CreateOrderDto, @Req() req: any) {
    return this.orderService.createOrder(req.user.sub, dto);
  }

  @Get()
  @Serialize(OrderResponseDto)
  getMyOrders(@Query() query: OrderQueryDto, @Req() req: any) {
    return this.orderService.getMyOrders(req.user.sub, query);
  }

  @Get(':orderNumber')
  @Serialize(OrderResponseDto)
  getOrderDetail(@Param('orderNumber') orderNumber: string, @Req() req: any) {
    return this.orderService.getOrderDetail(req.user.sub, orderNumber);
  }

  @Patch(':orderNumber/cancel')
  @Serialize(OrderResponseDto)
  @Auditable(AuditAction.ORDER_CANCELLED)
  cancelOrder(@Param('orderNumber') orderNumber: string, @Req() req: any) {
    return this.orderService.cancelOrder(req.user.sub, orderNumber);
  }

  @Patch(':orderNumber/confirm')
  @Serialize(OrderResponseDto)
  @Auditable(AuditAction.ORDER_CONFIRMED)
  confirmOrder(@Param('orderNumber') orderNumber: string, @Req() req: any) {
    return this.orderService.confirmOrder(req.user.sub, orderNumber);
  }
}

/** 셀러 주문 관리 */
@Controller('seller/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SELLER)
export class SellerOrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get()
  @Serialize(OrderResponseDto)
  getSellerOrders(@Query() query: OrderQueryDto, @Req() req: any) {
    return this.orderService.getSellerOrders(req.user.sub, query);
  }

  @Patch(':orderNumber/ship')
  @Serialize(OrderResponseDto)
  @Auditable(AuditAction.SHIPMENT_SHIPPED, { captureBody: ['trackingNumber', 'carrier'] })
  markShipped(
    @Param('orderNumber') orderNumber: string,
    @Body() dto: ShipOrderDto,
    @Req() req: any,
  ) {
    return this.orderService.markShipped(req.user.sub, orderNumber, dto);
  }
}

/** 관리자 주문 관리 */
@Controller('admin/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminOrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get()
  @Serialize(OrderResponseDto)
  getAllOrders(@Query() query: OrderQueryDto) {
    return this.orderService.getAllOrders(query);
  }

  @Get(':orderNumber')
  @Serialize(OrderResponseDto)
  getOrderDetail(@Param('orderNumber') orderNumber: string) {
    return this.orderService.getOrderDetailAdmin(orderNumber);
  }

  @Patch(':orderNumber/deliver')
  @UseGuards(DemoAccountGuard)
  @Serialize(OrderResponseDto)
  @Auditable(AuditAction.SHIPMENT_DELIVERED)
  markDelivered(
    @Param('orderNumber') orderNumber: string,
    @Body('sellerId') sellerId?: number,
  ) {
    return this.orderService.markDelivered(orderNumber, sellerId);
  }
}
