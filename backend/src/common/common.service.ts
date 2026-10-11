import { BadRequestException, Injectable } from '@nestjs/common';
import { BasePaginateDto, NumberFilterDto, PaginateFilterDto, StringFilterDto } from './dto/paginate.dto';
import {
  Brackets,
  FindManyOptions,
  FindOptionsOrder,
  FindOptionsWhere,
  FindOperator,
  Repository,
} from 'typeorm';
import { BaseModel } from './entity/base.entity';
import { ConfigService } from '@nestjs/config';
import { SORTABLE_COLUMNS, SortableKey } from './const/sortable-columns.const';
import { encodeCursor, decodeCursor } from './utils/cursor';

type PaginatedEntity = Pick<BaseModel, 'id' | 'createdAt'>;
type SortKey<T extends PaginatedEntity> = Extract<SortableKey, keyof T>;

@Injectable()
export class CommonService {
  constructor(private readonly configService: ConfigService) {}

  /**
   * 범용 페이지네이션 함수
   * page가 있으면 페이지 기반, 없으면 커서 기반(무한 스크롤)
   * 쿼리 예시) /product?filter[category][equals]=BEAUTY&page=1&take=20
   */
  private static readonly MAX_TAKE = 100;

  async paginate<T extends PaginatedEntity>(
    dto: BasePaginateDto,
    repository: Repository<T>,
    path: string,
    overrideFindOptions: FindManyOptions<T> = {}
  ) {
    // page와 cursor를 동시에 사용하면 cursor가 무시되므로 명시적 에러
    if (dto.page && dto.cursor) {
      throw new BadRequestException('page와 cursor는 동시에 사용할 수 없습니다.');
    }

    // take 상한 제한 (과도한 DB 부하 방어)
    if (dto.take > CommonService.MAX_TAKE) {
      throw new BadRequestException(`take는 최대 ${CommonService.MAX_TAKE}까지 허용됩니다.`);
    }

    const sortBy = (dto.sortBy ?? 'createdAt') as SortKey<T>;
    const sortOrder = dto.sortOrder || 'DESC';

    // sortBy가 허용된 컬럼인지 검증 (undefined 제외 — 기본값 createdAt 으로 처리됨)
    if (dto.sortBy && !SORTABLE_COLUMNS.includes(dto.sortBy as SortableKey)) {
      throw new BadRequestException(
        `sortBy는 ${SORTABLE_COLUMNS.join(', ')} 중 하나여야 합니다.`,
      );
    }

    if (dto.page) {
      return this.pagePaginate(
        dto,
        repository,
        sortBy,
        sortOrder,
        overrideFindOptions
      );
    } else {
      return this.cursorPaginate(
        dto,
        repository,
        path,
        sortBy,
        sortOrder,
        overrideFindOptions
      );
    }
  }

  /**
   * 페이지 기반 페이지네이션
   */
  private async pagePaginate<T extends PaginatedEntity>(
    dto: BasePaginateDto,
    repository: Repository<T>,
    sortBy: SortKey<T>,
    sortOrder: 'ASC' | 'DESC',
    overrideFindOptions: FindManyOptions<T>
  ) {
    const page = dto.page ?? 1;
    const where = this.buildWhereClause<T>(dto.filter);
    const order = this.buildOrderClause<T>(sortBy, sortOrder);

    const overrideWhere = overrideFindOptions.where ?? {};
    const { where: _, ...restOverride } = overrideFindOptions;

    const [data, total] = await repository.findAndCount({
      where: { ...where, ...(overrideWhere as object) },
      order,
      take: dto.take,
      skip: ((page ?? 1) - 1) * dto.take,
      ...restOverride,
    });

    const lastPage = Math.ceil(total / dto.take);

    return {
      data,
      meta: {
        total,
        page,
        lastPage,
        take: dto.take,
        hasNextPage: page < lastPage,
        hasPreviousPage: page > 1,
      },
    };
  }

  /**
   * 커서 기반 페이지네이션 (무한 스크롤)
   * QueryBuilder를 사용하여 필터와 커서 조건을 정확히 결합
   */
  private async cursorPaginate<T extends PaginatedEntity>(
    dto: BasePaginateDto,
    repository: Repository<T>,
    path: string,
    sortBy: SortKey<T>,
    sortOrder: 'ASC' | 'DESC',
    overrideFindOptions: FindManyOptions<T>
  ) {
    const qb = repository.createQueryBuilder('entity');

    // 1. 필터 조건 추가 (alias 기본값 'entity')
    this.applyFilterToQueryBuilder(qb, dto.filter);

    // 2. 커서 조건 추가
    if (dto.cursor) {
      this.applyCursorCondition<T>(qb, dto.cursor, sortBy, sortOrder);
    }

    // 3. 정렬 조건 추가
    qb
      .orderBy(`entity.${String(sortBy)}`, sortOrder)
      .addOrderBy('entity.id', sortOrder);

    // 4. 고정 where 조건 추가 (원시값 및 In 등의 TypeORM 연산자)
    if (overrideFindOptions.where && typeof overrideFindOptions.where === 'object' && !Array.isArray(overrideFindOptions.where)) {
      Object.entries(overrideFindOptions.where).forEach(([key, value]) => {
        if (value instanceof FindOperator) {
          qb.andWhere({ [key]: value });
        } else if (value !== undefined && value !== null && typeof value !== 'object') {
          qb.andWhere(`entity.${key} = :__fixed_${key}`, { [`__fixed_${key}`]: value });
        }
      });
    }

    // 5. relations 추가 (overrideFindOptions에서)
    if (overrideFindOptions.relations) {
      const relations = Array.isArray(overrideFindOptions.relations)
        ? overrideFindOptions.relations
        : Object.keys(overrideFindOptions.relations);
      
      relations.forEach((relation) => {
        if (typeof relation === 'string') {
          qb.leftJoinAndSelect(`entity.${relation}`, relation);
        }
      });
    }

    // 6. take + 1로 조회 (다음 페이지 존재 여부 확인)
    qb.take(dto.take + 1);

    const data = await qb.getMany();

    const hasNext = data.length > dto.take;
    const items = hasNext ? data.slice(0, dto.take) : data;

    // 7. 다음 커서 생성
    let nextCursor: string | null = null;
    let nextUrl: string | null = null;

    if (hasNext && items.length > 0) {
      const lastItem = items[items.length - 1];
      nextCursor = this.encodeCursor(lastItem, sortBy);
      nextUrl = this.buildNextUrl<T>(dto, path, nextCursor, sortBy, sortOrder);
    }

    return {
      data: items,
      meta: {
        count: items.length,
        hasNext,
        nextCursor,
      },
      next: nextUrl,
    };
  }

  /**
   * QueryBuilder에 PaginateFilterDto를 적용한다.
   * - 커서/페이지 양쪽에서 재사용된다.
   * - 다른 엔티티 alias로도 재사용 가능하도록 alias 파라미터를 받는다. (예: 'entity' | 'product')
   *
   * EC-E: 바인드 파라미터 이름은 `${alias}_${column}...` 로 네임스페이스화해서
   *       같은 qb에 서로 다른 alias로 두 번 호출해도 충돌하지 않도록 한다.
   */
  applyFilterToQueryBuilder(
    qb: any,
    filter: PaginateFilterDto | undefined,
    alias = 'entity',
  ): void {
    if (!filter) return;

    // EC-D: alias는 SQL 조각에 그대로 삽입되므로 식별자 형태인지 검증한다.
    //       개발자 실수(사용자 입력을 그대로 전달) 방지용 가드. 위반 시 500이 맞다.
    if (!CommonService.VALID_IDENTIFIER.test(alias)) {
      throw new Error(`applyFilterToQueryBuilder: alias는 식별자 형식이어야 합니다. 받은 값: ${alias}`);
    }

    if (filter.rating) this.applyNumberFilter(qb, alias, 'rating', filter.rating);
    if (filter.price) this.applyNumberFilter(qb, alias, 'price', filter.price);
    if (filter.status) this.applyStringFilter(qb, alias, 'status', filter.status);
    if (filter.category) this.applyStringFilter(qb, alias, 'category', filter.category);
  }

  private static readonly VALID_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

  private applyNumberFilter(qb: any, alias: string, column: string, filter: NumberFilterDto): void {
    const col = `${alias}.${column}`;
    const p = (suffix: string) => `${alias}_${column}${suffix}`; // 예: product_ratingEquals

    if (filter.equals !== undefined) {
      qb.andWhere(`${col} = :${p('Equals')}`, { [p('Equals')]: filter.equals });
    }
    if (filter.gte !== undefined && filter.lte !== undefined) {
      qb.andWhere(`${col} BETWEEN :${p('Min')} AND :${p('Max')}`, {
        [p('Min')]: filter.gte,
        [p('Max')]: filter.lte,
      });
    } else if (filter.gte !== undefined) {
      qb.andWhere(`${col} >= :${p('Gte')}`, { [p('Gte')]: filter.gte });
    } else if (filter.gt !== undefined) {
      qb.andWhere(`${col} > :${p('Gt')}`, { [p('Gt')]: filter.gt });
    }
    if (filter.lte !== undefined && filter.gte === undefined) {
      qb.andWhere(`${col} <= :${p('Lte')}`, { [p('Lte')]: filter.lte });
    } else if (filter.lt !== undefined) {
      qb.andWhere(`${col} < :${p('Lt')}`, { [p('Lt')]: filter.lt });
    }
  }

  private applyStringFilter(qb: any, alias: string, column: string, filter: StringFilterDto): void {
    const col = `${alias}.${column}`;
    const p = (suffix: string) => `${alias}_${column}${suffix}`;

    if (filter.equals !== undefined) {
      qb.andWhere(`${col} = :${p('Equals')}`, { [p('Equals')]: filter.equals });
    }
    if (filter.contains !== undefined) {
      qb.andWhere(`${col} LIKE :${p('Contains')}`, { [p('Contains')]: `%${filter.contains}%` });
    }
    if (filter.in !== undefined && filter.in.length > 0) {
      qb.andWhere(`${col} IN (:...${p('In')})`, { [p('In')]: filter.in });
    }
  }

  /**
   * QueryBuilder에 커서 조건 적용
   * (sortBy < value) OR (sortBy = value AND id < lastId)
   */
  private applyCursorCondition<T extends PaginatedEntity>(
    qb: any,
    cursor: string,
    sortBy: SortKey<T>,
    sortOrder: 'ASC' | 'DESC'
  ): void {
    const { sortValue, id } = decodeCursor(cursor);
    const op = sortOrder === 'DESC' ? '<' : '>';

    qb.andWhere(
      new Brackets((qb) => {
        qb.where(`entity.${String(sortBy)} ${op} :cursorSortValue`, {
          cursorSortValue: sortValue,
        }).orWhere(
          new Brackets((qb) => {
            qb.where(`entity.${String(sortBy)} = :cursorSortValue`, {
              cursorSortValue: sortValue,
            }).andWhere(`entity.id ${op} :cursorId`, {
              cursorId: id,
            });
          })
        );
      })
    );
  }

  /**
   * 필터 DTO를 TypeORM Where 조건으로 변환 (페이지 기반용)
   */
  private buildWhereClause<T>(
    filter?: PaginateFilterDto
  ): FindOptionsWhere<T> {
    if (!filter) return {} as FindOptionsWhere<T>;

    const where: any = {};

    if (filter.rating) {
      where.rating = this.buildNumberFilter(filter.rating);
    }

    if (filter.status) {
      where.status = this.buildStringFilter(filter.status);
    }

    if (filter.category) {
      where.category = this.buildStringFilter(filter.category);
    }

    if (filter.price) {
      where.price = this.buildNumberFilter(filter.price);
    }

    return where as FindOptionsWhere<T>;
  }

  /**
   * NumberFilterDto를 TypeORM 조건으로 변환
   */
  private buildNumberFilter(filter: NumberFilterDto) {
    const { Equal, MoreThan, MoreThanOrEqual, LessThan, LessThanOrEqual, Between } = require('typeorm');
    
    if (filter.equals !== undefined) {
      return Equal(filter.equals);
    }
    if (filter.gte !== undefined && filter.lte !== undefined) {
      return Between(filter.gte, filter.lte);
    }
    if (filter.gte !== undefined) {
      return MoreThanOrEqual(filter.gte);
    }
    if (filter.gt !== undefined) {
      return MoreThan(filter.gt);
    }
    if (filter.lte !== undefined) {
      return LessThanOrEqual(filter.lte);
    }
    if (filter.lt !== undefined) {
      return LessThan(filter.lt);
    }
    return undefined;
  }

  /**
   * StringFilterDto를 TypeORM 조건으로 변환
   */
  private buildStringFilter(filter: StringFilterDto) {
    const { Equal, Like, In } = require('typeorm');
    
    if (filter.equals !== undefined) {
      return Equal(filter.equals);
    }
    if (filter.contains !== undefined) {
      return Like(`%${filter.contains}%`);
    }
    if (filter.in !== undefined && filter.in.length > 0) {
      return In(filter.in);
    }
    return undefined;
  }

  /**
   * 정렬 조건 생성
   */
  private buildOrderClause<T extends PaginatedEntity>(
    sortBy: SortKey<T>,
    sortOrder: 'ASC' | 'DESC'
  ): FindOptionsOrder<T> {
    return {
      [sortBy]: sortOrder,
      id: sortOrder,
    } as FindOptionsOrder<T>;
  }

  /**
   * 커서 인코딩: 마지막 아이템의 sortBy 값과 id를 base64로 인코딩
   */
  private encodeCursor<T extends PaginatedEntity, K extends keyof T>(item: T, sortBy: K): string {
    return encodeCursor({
      sortValue: item[sortBy],
      id: item['id'] as number,
    });
  }

  /**
   * 다음 페이지 URL 생성
   */
  private buildNextUrl<T extends PaginatedEntity>(
    dto: BasePaginateDto,
    path: string,
    nextCursor: string,
    sortBy: SortKey<T>,
    sortOrder: 'ASC' | 'DESC'
  ): string {
    const protocol = this.configService.get<string>('PROTOCOL');
    const host = this.configService.get<string>('HOST');
    const url = new URL(`${protocol}://${host}/v1/${path}`);

    url.searchParams.append('take', dto.take.toString());
    url.searchParams.append('sortBy', String(sortBy));
    url.searchParams.append('sortOrder', sortOrder);
    url.searchParams.append('cursor', nextCursor);

    if (dto.filter) {
      this.appendFilterParams(url, dto.filter);
    }

    return url.toString();
  }

  /**
   * URL에 필터 파라미터 추가
   */
  private appendFilterParams(url: URL, filter: PaginateFilterDto): void {
    if (filter.rating) {
      Object.entries(filter.rating).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(`filter[rating][${key}]`, value.toString());
        }
      });
    }

    if (filter.status) {
      Object.entries(filter.status).forEach(([key, value]) => {
        if (value !== undefined) {
          if (Array.isArray(value)) {
            value.forEach((v) =>
              url.searchParams.append(`filter[status][${key}][]`, v)
            );
          } else {
            url.searchParams.append(`filter[status][${key}]`, value);
          }
        }
      });
    }

    if (filter.category) {
      Object.entries(filter.category).forEach(([key, value]) => {
        if (value !== undefined) {
          if (Array.isArray(value)) {
            value.forEach((v) =>
              url.searchParams.append(`filter[category][${key}][]`, v)
            );
          } else {
            url.searchParams.append(`filter[category][${key}]`, value);
          }
        }
      });
    }

    if (filter.price) {
      Object.entries(filter.price).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(`filter[price][${key}]`, value.toString());
        }
      });
    }
  }
}
