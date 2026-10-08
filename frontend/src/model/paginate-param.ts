export type SortBy = "id" | "createdAt" | "rating" | "price" | "viewCount"

export type SortOrder = "ASC" | "DESC";

export interface PaginateParam {
    page: number;
    limit: number;
    sortBy?: SortBy;
    sortOrder?: SortOrder;
    cursor?: string;
    filter?: Filter;
    categoryId?: number;
    sellerId?: number;
    keyword?: string;
}

export interface Filter {
    rating?: NumberFilter;
    status?: StringFilter;
    category?: StringFilter;
    price?: NumberFilter;
}

export interface NumberFilter {
  equals?: number;

  gt?: number;

  gte?: number;

  lt?: number;

  lte?: number;
}

export interface StringFilter {
  equals?: string;

  contains?: string;

  in?: string[];
}
