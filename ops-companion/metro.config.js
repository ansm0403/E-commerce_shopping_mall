// Metro(React Native 번들러) 설정.
//
// 이 앱은 Yarn berry 모노레포의 워크스페이스다. `.yarnrc.yml` 의 `nmHoistingLimits: none` 때문에
// 의존성 상당수가 **저장소 루트 node_modules 로 호이스팅**되는데, Metro 는 기본적으로
// 프로젝트 폴더만 보고 상위 폴더는 감시하지도, 모듈 해석 대상으로 삼지도 않는다.
// 그래서 두 가지를 명시한다(설계 문서 §2):
//   · watchFolders     — 루트까지 파일 변경 감시(모노레포 공용 코드 수정이 앱에 반영되게)
//   · nodeModulesPaths — 앱 폴더와 루트 node_modules 양쪽에서 모듈을 찾게
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// watchFolders 를 루트로 열었으므로 **감시하지 않을 곳을 빼 줘야 한다.**
//
// 2026-09-20 에 실제로 겪은 일: `.yarn/cache` 가 2.9GB 까지 자라면서 파일 감시 초기화가
// 240초 제한(@expo/metro-file-map Watcher.js MAX_WAIT_TIME)을 넘겨 실패했고,
// 그 뒤 번들 요청이 HTTP 500(`DependencyGraph.js` 에서 undefined 읽기)으로 떨어졌다.
// 앱에서는 아무 메시지 없이 **흰 화면**으로만 보여서 원인 짚기가 어려웠다.
//
// blockList 는 모듈 해석에서 빼는 동시에 파일맵 크롤링 대상에서도 빠진다
// (metro/src/node-haste/DependencyGraph/createFileMap.js 의 getIgnorePattern → ignorePattern).
// 아래는 전부 앱 번들과 무관한 산출물·캐시다.
config.resolver.blockList = [
  /[/\\]\.yarn[/\\]cache[/\\].*/, // Yarn berry 패키지 캐시(가장 큰 원인)
  /[/\\]\.git[/\\].*/,
  /[/\\]\.nx[/\\].*/,
  /[/\\]backend[/\\]dist[/\\].*/,
  /[/\\]frontend[/\\]\.next[/\\].*/,
  /[/\\]shared[/\\]dist[/\\].*/,
  /[/\\]docs[/\\].*/, // 포트폴리오 이미지 97MB
  /[/\\]uploads[/\\].*/,
];

module.exports = config;
