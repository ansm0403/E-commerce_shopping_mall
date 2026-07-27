/* eslint-disable */
const { readFileSync } = require('fs');

/**
 * ⚠ 확장자가 .cjs 인 이유
 * Node 22.18+ 의 기본 타입 스트리핑은 `export default` 가 있는 .ts 를 ESM 으로 판정해
 * `__dirname` 을 없애버린다 → jest 가 config 파싱 단계에서 죽는다(로컬 Node 22, CI Node 24 는 정상).
 * CommonJS 로 못 박아 두면 두 환경 모두에서 그냥 돈다.
 */

const swcJestConfig = JSON.parse(readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'));
swcJestConfig.swcrc = false;

module.exports = {
  displayName: '@shopping-mall/backend-e2e',
  preset: '../jest.preset.js',
  globalSetup: '<rootDir>/src/support/global-setup.ts',
  globalTeardown: '<rootDir>/src/support/global-teardown.ts',
  setupFiles: ['<rootDir>/src/support/test-setup.ts'],
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: 'test-output/jest/coverage',
};
