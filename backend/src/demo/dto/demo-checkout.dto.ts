import { IsUUID } from 'class-validator';

export class CreateDemoCheckoutDto {
  @IsUUID('4') requestId: string;
}
