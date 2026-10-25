const { spawn } = require('node:child_process');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const OUTPUT_LIMIT = 1024 * 1024;
const RUN_TIMEOUT_MS = 10_000;
const COMPILE_TIMEOUT_MS = 30_000;

function findGcc() {
  return new Promise((resolve) => {
    execFile('where.exe', ['gcc'], { windowsHide: true, timeout: 5_000 }, (error, stdout) => {
      const compilerPath = error ? '' : stdout.split(/\r?\n/).find(Boolean)?.trim();
      resolve(compilerPath || null);
    });
  });
}

function runChild({ command, args, cwd, stdin = '', timeoutMs, signal, onOutput, spawnProcess = spawn, killProcessTree = spawn }) {
  return new Promise((resolve) => {
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let totalBytes = 0;
    let stopReason = null;
    let settled = false;
    let processTreeKill = Promise.resolve();
    const stdoutChunks = [];
    const stderrChunks = [];
    const child = spawnProcess(command, args, {
      cwd,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const terminate = (reason) => {
      if (stopReason || settled) return;
      stopReason = reason;
      if (process.platform === 'win32' && child.pid) {
        const killer = killProcessTree('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        processTreeKill = new Promise((resolve) => {
          let completed = false;
          const finish = (fallback) => {
            if (completed) return;
            completed = true;
            if (fallback) child.kill();
            resolve();
          };
          killer.once('error', () => finish(true));
          killer.once('close', (exitCode) => finish(exitCode !== 0));
        });
      } else {
        child.kill();
      }
    };

    const onAbort = () => terminate('stopped');
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });

    const collect = (stream, chunk) => {
      const remaining = Math.max(OUTPUT_LIMIT - totalBytes, 0);
      const accepted = chunk.subarray(0, remaining);
      totalBytes += accepted.length;
      if (stream === 'stdout') {
        stdoutBytes += accepted.length;
        stdoutChunks.push(accepted);
      } else {
        stderrBytes += accepted.length;
        stderrChunks.push(accepted);
      }
      if (accepted.length > 0) onOutput?.(stream, accepted.toString('utf8'));
      if (chunk.length > remaining || totalBytes >= OUTPUT_LIMIT) terminate('output-limit');
    };

    child.stdout.on('data', (chunk) => collect('stdout', chunk));
    child.stderr.on('data', (chunk) => collect('stderr', chunk));
    child.stdin.on('error', () => {});
    child.stdin.end(stdin, 'utf8');

    const timer = setTimeout(() => terminate('timeout'), timeoutMs);
    child.once('error', (error) => {
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({
        status: 'spawn-error',
        stdout: Buffer.concat(stdoutChunks, stdoutBytes).toString('utf8'),
        stderr: Buffer.concat(stderrChunks, stderrBytes).toString('utf8'),
        errorCode: error.code,
      });
    });
    child.once('close', (exitCode) => {
      void processTreeKill.then(() => {
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve({
          status: stopReason ?? (exitCode === 0 ? 'success' : 'failed'),
          stdout: Buffer.concat(stdoutChunks, stdoutBytes).toString('utf8'),
          stderr: Buffer.concat(stderrChunks, stderrBytes).toString('utf8'),
          exitCode,
        });
      });
    });
  });
}

async function runCProgram({
  source,
  stdin = '',
  compilerPath,
  findCompiler = findGcc,
  signal,
  onOutput,
  spawnProcess = spawn,
  killProcessTree = spawn,
  runTimeoutMs = RUN_TIMEOUT_MS,
  compileTimeoutMs = COMPILE_TIMEOUT_MS,
}) {
  if (typeof source !== 'string' || source.trim().length === 0 || source.length > 5000) {
    return { status: 'invalid-input', message: 'Cコードを入力してください（最大5000文字）。' };
  }
  if (typeof stdin !== 'string' || Buffer.byteLength(stdin, 'utf8') > OUTPUT_LIMIT) {
    return { status: 'invalid-input', message: '標準入力は1 MiB以内で設定してください。' };
  }

  const compiler = compilerPath ?? await findCompiler();
  if (!compiler) {
    return {
      status: 'compiler-missing',
      message: 'GCCが見つかりません。MSYS2を導入し、UCRT64ターミナルで「pacman -S --needed base-devel mingw-w64-ucrt-x86_64-toolchain」を実行してください。C:\\msys64\\ucrt64\\binをPATHに追加し、アプリを再起動してから再試行してください。',
    };
  }

  const workingDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'c-video-run-'));
  try {
    await fs.writeFile(path.join(workingDirectory, 'main.c'), source, 'utf8');
    const compile = await runChild({
      command: compiler,
      args: ['-std=c17', '-Wall', '-Wextra', '-O0', 'main.c', '-o', 'main.exe'],
      cwd: workingDirectory,
      timeoutMs: compileTimeoutMs,
      signal,
      onOutput,
      spawnProcess,
      killProcessTree,
    });
    if (compile.status !== 'success') {
      return {
        ...compile,
        status: compile.status === 'failed' ? 'compile-error' : compile.status,
        message: compile.status === 'timeout'
          ? 'コンパイルが30秒でタイムアウトしました。'
          : compile.status === 'output-limit'
            ? 'コンパイラ出力が1 MiBに達したため、処理を停止しました。'
            : compile.status === 'stopped'
              ? 'コンパイルを停止しました。'
              : compile.status === 'spawn-error'
                ? 'GCCを起動できません。インストール状態とPATHを確認してください。'
                  : compile.status === 'failed'
                    ? 'Cコードのコンパイルに失敗しました。標準エラーに表示されたGCCの診断を確認してください。'
                : undefined,
      };
    }

    const execution = await runChild({
      command: path.join(workingDirectory, 'main.exe'),
      args: [],
      cwd: workingDirectory,
      stdin,
      timeoutMs: runTimeoutMs,
      signal,
      onOutput,
      spawnProcess,
      killProcessTree,
    });
    return {
      ...execution,
      message: execution.status === 'timeout'
        ? `実行が${Math.round(runTimeoutMs / 1000)}秒でタイムアウトし、プロセスを停止しました。`
        : execution.status === 'output-limit'
          ? '標準出力と標準エラーの合計が1 MiBに達したため、プロセスを停止しました。'
          : execution.status === 'stopped'
            ? '実行を停止しました。'
            : execution.status === 'failed'
              ? `プログラムが終了コード${execution.exitCode ?? '不明'}で終了しました。`
              : execution.status === 'spawn-error'
                ? 'コンパイル後のプログラムを起動できませんでした。'
            : undefined,
    };
  } catch {
    return { status: 'runner-error', message: 'Cコードの作業フォルダーを作成または使用できませんでした。' };
  } finally {
    await fs.rm(workingDirectory, { recursive: true, force: true });
  }
}

module.exports = { findGcc, runCProgram };