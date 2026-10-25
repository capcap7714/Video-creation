const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const args = process.argv.slice(2);
const reportArgumentIndex = args.findIndex((argument) => argument.startsWith('--report-file='));
const reportPath = reportArgumentIndex === -1
  ? path.resolve(process.cwd(), 'test-results/video-export-last-run.json')
  : path.resolve(args.splice(reportArgumentIndex, 1)[0].slice('--report-file='.length));
const scriptArgument = args.shift();

if (!scriptArgument) {
  console.error('Usage: node test/run-with-report.cjs <script> [args...] [--report-file=<path>]');
  process.exitCode = 2;
} else {
  const scriptPath = path.resolve(process.cwd(), scriptArgument);
  const startedAt = new Date();
  const stdoutChunks = [];
  const stderrChunks = [];
  let launchError = null;
  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.on('data', (chunk) => {
    stdoutChunks.push(chunk);
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderrChunks.push(chunk);
    process.stderr.write(chunk);
  });
  child.on('error', (error) => { launchError = error; });
  child.on('close', async (code, signal) => {
    const finishedAt = new Date();
    const exitCode = Number.isInteger(code) ? code : 1;
    const report = {
      script: path.relative(process.cwd(), scriptPath),
      args,
      status: exitCode === 0 ? 'passed' : 'failed',
      exitCode,
      signal,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      stdout: Buffer.concat(stdoutChunks).toString('utf8'),
      stderr: Buffer.concat(stderrChunks).toString('utf8'),
      error: launchError ? launchError.message : null,
    };

    try {
      await fs.mkdir(path.dirname(reportPath), { recursive: true });
      await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      console.log(`Completion report: ${reportPath}`);
      process.exitCode = exitCode;
    } catch (error) {
      console.error(`Could not write completion report: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    }
  });
}