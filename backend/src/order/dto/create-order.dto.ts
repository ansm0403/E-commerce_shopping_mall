import { IsArray, IsNotEmpty, IsOptional, IsString, ArrayMinSize } from 'class-validator';

export class CreateOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsNotEmpty({ each: true })
  cartItemIds: number[];

  // 	배송지 주소 (어디로 보낼지)
  @IsNotEmpty()
  @IsString()
  shippingAddress: string;

  // 수령인 이름 (누가 받을지)
  @IsNotEmpty()
  @IsString()
  recipientName: string;

  // 수령인 연락처 (배송 기사가 연락할 번호)	
  @IsNotEmpty()
  @IsString()
  recipientPhone: string;

  // 배송 메모 (선택)
  @IsOptional()
  @IsString()
  memo?: string;
}
