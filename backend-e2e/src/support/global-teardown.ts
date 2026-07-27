/* eslint-disable */

/**
 * 서버 생명주기는 이 스위트가 관리하지 않으므로 여기서 아무것도 죽이지 않는다.
 * (기본 스캐폴딩은 killPort 를 호출했는데, 내가 띄우지도 않은 개발 서버를 끄는 건 사고다)
 * 테스트가 만든 DB 레코드는 각 스펙의 beforeAll/afterAll 이 스스로 정리한다.
 */
module.exports = async function () {
  console.log('\n[e2e] 완료 — 서버는 그대로 둡니다.\n');
};
