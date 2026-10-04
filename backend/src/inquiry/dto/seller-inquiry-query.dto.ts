import { IsEnum, IsOptional } from 'class-validator';
import { BasePaginateDto } from '../../common/dto/paginate.dto';
import { InquiryStatus } from '../entity/inquiry.entity';

export class SellerInquiryQueryDto extends BasePaginateDto {
  // 없으면 전체(미답변·답변완료 모두)
  @IsOptional()
  @IsEnum(InquiryStatus)
  status?: InquiryStatus;
}
