import { publicClient } from "../lib/axios/axios-http-client";
import { PaginateParam } from "../model/paginate-param";

const productBaseUrl = "/products";

export function getAllProducts(){
    return publicClient.get(`${productBaseUrl}/all`);
}

export function getPaginateProducts(param: PaginateParam){
    const queryParams = new URLSearchParams();

    queryParams.append('page', param.page.toString());
    queryParams.append('take', param.limit.toString());

    if (param.sortBy) {
        queryParams.append('sortBy', param.sortBy);
    }
    if (param.sortOrder) {
        queryParams.append('sortOrder', param.sortOrder);
    }
    if (param.cursor) {
        queryParams.append('cursor', param.cursor);
    }
    if (param.categoryId) {
        queryParams.append('categoryId', param.categoryId.toString());
    }
    if (param.sellerId) {
        queryParams.append('sellerId', param.sellerId.toString());
    }
    if (param.keyword && param.keyword.trim() !== '') {
        queryParams.append('keyword', param.keyword.trim());
    }

    if (param.filter) {
        Object.entries(param.filter).forEach(([filterKey, filterValue]) => {
            if (filterValue) {
                Object.entries(filterValue).forEach(([operation, value]) => {
                    if (value !== undefined && value !== null) {
                        if (Array.isArray(value)) {
                            queryParams.append(`filter[${filterKey}][${operation}]`, value.join(','));
                        } else {
                            queryParams.append(`filter[${filterKey}][${operation}]`, value.toString());
                        }
                    }
                });
            }
        });
    }

    const query = `${productBaseUrl}?${queryParams.toString()}`;
    return publicClient.get(query);
}

export function getProductDetail(id: number) {
    return publicClient.get(`${productBaseUrl}/${id}`);
}
