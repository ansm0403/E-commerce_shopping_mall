const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, 'dist'),
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      // 배포용 마이그레이션 실행기(dist/migrate.js) — 운영 이미지에서
      // `node backend/dist/migrate.js` 로 호출 (docs/roadmap/ex-db-migration.md §4-0-1)
      additionalEntryPoints: [{ entryName: 'migrate', entryPath: './src/migrate.ts' }],
      tsConfig: './tsconfig.app.json',
      assets: ['./src/assets'],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMaps: true,
    }),
  ],
};
