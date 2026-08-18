import 'dotenv/config';

/**
 * DB 접속 옵션의 단일 출처 — data-source.ts(CLI)와 migrate.ts(컨테이너 배치)가 공유.
 * env 키/기본값은 app.module.ts 의 TypeOrmModule.forRoot 와 동일하게 유지할 것(드리프트 방지).
 * dotenv 는 이미 설정된 프로세스 env 를 덮어쓰지 않는다(컨테이너에선 compose env 가 우선).
 */
export const connectionOptions = {
  type: 'postgres' as const,
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '4321', 10),
  username: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
};
