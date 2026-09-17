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

module.exports = config;
