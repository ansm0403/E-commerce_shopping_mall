import { queryOptions } from '@tanstack/react-query';
import { getMyOrders, getOrderDetail } from '../../service/order';
import { OrderQueryParams } from '../../model/order';

export const orderKeys = {
  all: ['orders'] as const,
  lists: () => [...orderKeys.all, 'list'] as const,
  list: (params: OrderQueryParams) => [...orderKeys.lists(), params] as const,
  details: () => [...orderKeys.all, 'detail'] as const,
  detail: (orderNumber: string) => [...orderKeys.details(), orderNumber] as const,
};

export const orderQueryOptions = {
  myOrders: (params: OrderQueryParams = {}) =>
    queryOptions({
      queryKey: orderKeys.list(params),
      queryFn: ({signal}) => getMyOrders(params,signal),
      staleTime: 1000 * 30, // 30초 — 주문 상태는 자주 바뀔 수 있음
    }),

  detail: (orderNumber: string) =>
    queryOptions({
      queryKey: orderKeys.detail(orderNumber),
      queryFn: ({signal}) => getOrderDetail(orderNumber,signal),
      staleTime: 1000 * 30,
      enabled: !!orderNumber,
    }),
};
