import { Transform, Type } from 'class-transformer';
import { IsArray, IsEnum, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { SORTABLE_COLUMNS } from '../const/sortable-columns.const';

export class NumberFilterDto {
  @IsOptional()
  @IsNumber()
  equals?: number;

  @IsOptional()
  @IsNumber()
  gt?: number;

  @IsOptional()
  @IsNumber()
  gte?: number;

  @IsOptional()
  @IsNumber()
  lt?: number;

  @IsOptional()
  @IsNumber()
  lte?: number;
}

export class StringFilterDto {
  @IsOptional()
  @IsString()
  equals?: string;

  @IsOptional()
  @IsString()
  contains?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  in?: string[];
}

export class PaginateFilterDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => NumberFilterDto)
  rating?: NumberFilterDto;

  @IsOptional()
  @ValidateNested()
  @Type(()=>StringFilterDto)
  status?: StringFilterDto;

  @IsOptional()
  @ValidateNested()
  @Transform(({ value }) => {
    // value가 없으면 패스
    if (!value) return value;

    // 1. equals 처리
    if (typeof value.equals === 'string') {
      value.equals = value.equals.toUpperCase();
    }

    // 2. contains 처리 (ENUM은 보통 like 검색이 안 되지만 혹시 몰라 처리)
    if (typeof value.contains === 'string') {
      value.contains = value.contains.toUpperCase();
    }

    // 3. in 처리 (배열)
    if (Array.isArray(value.in)) {
      value.in = value.in.map((v: any) => 
        typeof v === 'string' ? v.toUpperCase() : v
      );
    }

    return value;
  })
  @Type(()=>StringFilterDto)
  category?: StringFilterDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => NumberFilterDto)
  price?: NumberFilterDto;
}

/**
 * 페이지 기반 페이지네이션의 예시 쿼리
 * {
 *  page: 3, 
 *  order__id: "DESC",
 *  take: 20,
 * }
 * 
 * 무한 스크롤 페이지네이션의 예시 쿼리
 * {
 *  where__id__more_than: 21,
 *  order__id: "DESC",
 *  take: 20,
 * }
 * 
 * page 쿼리는 페이지 기반에선 필수이며, 해당 쿼리가 없을 때 무한 스크롤이다.
 * where__id 이던 where__rating 이던간에 무한 스크롤에서 where 쿼리는 필수이다.(하지만 페이지 첫 진입시에는 where 에 넣을 id 값이나 rating 값을 알 수 없기에 예외이다.)
 * 그래서 order__id 나 order__rating 을 기준으로 먼저 데이터를 받아온 후 커서값을 where__id 나 where__rating 에 넣어서 프론트엔드에 전달해줘야 한다.
 * 페이지 기반에서는 특정 평점이상의 상품들만 보여달라는 조건(where__rating__more_than=4.0)이나 특정 카테고리의 상품만 보여달라는 조건(where__category="book") 등이 있을 때 where 쿼리를 받는다.
 * order 쿼리는 두 페이지네이션에서 필수 쿼리이다. 
 * order 쿼리가 들어오지 않을 때는 자동으로 where 쿼리에서 요구하는 기준(where__id 면 order__id 로 받는다.)과 동일하게 한다.
 * 하지만 where 쿼리가가 없는 경우에는 order__rating="DESC" 를 default 로 한다.
 * 
 */
export class BasePaginateDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100, { message: '한 번에 최대 100개까지 조회 가능합니다' })
  @IsOptional()
  take = 20;

  @IsOptional()
  @IsEnum([...SORTABLE_COLUMNS])
  sortBy?: string = 'createdAt';

  @IsOptional()
  @IsEnum(['ASC', 'DESC'])
  sortOrder?: 'ASC' | 'DESC' = 'DESC';

  // ✅ 커서 추가
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @ValidateNested()
  @Type(()=>PaginateFilterDto)
  filter? : PaginateFilterDto;

  // 예전에는 `[key: string]: any` 인덱스 시그니처로 where__필드__연산 형식의 동적 키를 받는다고 선언했지만,
  // CommonService.paginate 는 filter·cursor 만 읽고 어떤 클라이언트(웹·운영 앱·e2e)도 그 키를 보내지 않았다.
  // 전역 ValidationPipe whitelist 와 충돌하는 죽은 선언이라 지웠다(위 주석의 where__ 예시는 설계 당시 메모).
}