const { spawn } = require('child_process');
const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');

let serverProcess = null;
let restartTimer = null;
const serverFile = path.join(__dirname, 'dist', 'main.js');
const DEBOUNCE_DELAY = 5000;

function startServer() {
  // 이전 프로세스가 있으면 종료
  if (serverProcess) {
    console.log('Restarting server...');
    serverProcess.kill();
    serverProcess = null;
  }

  // 파일이 존재하는지 확인
  if (!fs.existsSync(serverFile)) {
    console.log('Waiting for build...');
    return;
  }

  console.log('Starting server...');
  serverProcess = spawn('node', [serverFile], {
    stdio: 'inherit',
    cwd: __dirname
  });

  serverProcess.on('error', (err) => {
    console.error('Failed to start server:', err);
  });
}

function scheduleRestart() {
  // 기존 타이머가 있으면 취소
  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  // 빌드 파일이 안정화된 뒤에 재시작
  restartTimer = setTimeout(() => {
    console.log('File changed, restarting...');
    startServer();
    restartTimer = null;
  }, DEBOUNCE_DELAY);
}

// 파일 감시 시작
// Webpack이 dist 디렉터리를 삭제·재생성해도 감시가 유지되도록 부모 디렉터리를 감시한다.
const watcher = chokidar.watch(__dirname, {
  depth: 1,
  ignored: (filePath) => ![__dirname, path.dirname(serverFile), serverFile].includes(path.resolve(filePath)),
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 500,
    pollInterval: 100
  }
});

watcher.on('ready', () => {
  console.log('Watching for file changes...');
  startServer();
});

watcher.on('change', () => {
  console.log('File change detected, waiting for stabilization...');
  scheduleRestart();
});

watcher.on('add', () => {
  // 기존 서버가 있어도 재생성된 번들을 반영한다.
  scheduleRestart();
});

// 종료 처리
process.on('SIGINT', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
  watcher.close();
  process.exit();
});

