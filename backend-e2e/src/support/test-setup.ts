/* eslint-disable */
import axios from 'axios';

/**
 * ⚠ setupFiles 는 모듈을 "실행"만 한다 — 함수를 export 해봐야 호출되지 않는다.
 *   (기본 스캐폴딩이 module.exports = async function 이라 baseURL 이 실제로는 설정된 적이 없었다)
 *   그래서 여기서는 최상위 부수효과로 설정한다.
 *
 * - baseURL 에 전역 prefix `/v1` 까지 포함한다(main.ts setGlobalPrefix).
 * - validateStatus 를 항상 통과시켜 4xx 를 try/catch 없이 그대로 단언한다 —
 *   이 스위트의 관심사가 대부분 "가드가 막았는가(401/403)" 라서.
 */
const host = process.env.HOST ?? 'localhost';
const port = process.env.PORT ?? '4000';

axios.defaults.baseURL = `http://${host}:${port}/v1`;
axios.defaults.validateStatus = () => true;
