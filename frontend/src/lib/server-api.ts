/**
 * 서버 컴포넌트(RSC) 전용 fetch 헬퍼
 *
 * 왜 별도 파일인가?
 * - publicClient(axios)는 NEXT_PUBLIC_API_URL을 baseURL로 사용
 * - 운영에서 NEXT_PUBLIC_API_URL = '/api' (상대 경로) → RSC 서버 환경에서는 절대 URL이 필요
 * - RSC에서는 API_PROXY_TARGET (서버 전용 환경변수 = EC2 직접 URL)을 사용해야 함
 *
 * 반환 형태:
 * - axios AxiosResponse와 동일한 { data: T } 형태로 반환
 * - React Query 캐시 키가 동일하면 SSR prefetch 데이터를 클라이언트 useQuery가 그대로 사용
 */

const API_BASE =
  process.env.API_PROXY_TARGET ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4000/v1';

interface ServerFetchOptions extends RequestInit {
  revalidate?: number | false;
  tags?: string[];
}

/**
 * RSC에서 사용하는 GET 요청 헬퍼.
 * axios의 { data: T } 형태를 흉내내어 React Query 캐시 키 일치성을 보장한다.
 *
 * @example
 * // page.tsx (RSC)
 * const result = await serverGet<Product>(`/products/${id}`, { revalidate: 300 });
 * result.data // Product 타입
 */
export async function serverGet<T = unknown>(
  path: string,
  options: ServerFetchOptions = {}
): Promise<{ data: T }> {
  const { revalidate, tags, ...fetchInit } = options;

  const nextOptions: { revalidate?: number | false; tags?: string[] } = {};
  if (revalidate !== undefined) nextOptions.revalidate = revalidate;
  if (tags) nextOptions.tags = tags;

  const url = `${API_BASE}${path}`;

  const res = await fetch(url, {
    ...fetchInit,
    headers: { 'Content-Type': 'application/json', ...fetchInit.headers },
    // Next.js 15 fetch 캐시 옵션 — revalidate/tags는 ISR + on-demand revalidation용
    next: Object.keys(nextOptions).length > 0 ? nextOptions : undefined,
  });

  if (!res.ok) {
    throw new Error(`[server-api] fetch 실패: ${res.status} ${url}`);
  }

  const body: T = await res.json();

  // axios AxiosResponse 형태와 일치시켜 클라이언트 useQuery와 캐시 공유
  return { data: body };
}
