const supported = new Set([18, 20, 22]);
const major = Number.parseInt(process.versions.node.split('.')[0], 10);

if (!supported.has(major)) {
  console.error(
    [
      `webnav supports Node 18, 20, and 22. Current Node is ${process.version}.`,
      'Use an LTS version before installing, for example: nvm use 22',
      'This avoids native better-sqlite3 build failures on unsupported Node releases.',
    ].join('\n'),
  );
  process.exit(1);
}
