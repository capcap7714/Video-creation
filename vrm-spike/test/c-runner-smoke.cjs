const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { execFileSync, spawn } = require('node:child_process');
const path = require('node:path');
const { findGcc, runCProgram } = require('../electron/c-runner.cjs');

function makeFakeSpawn({ output = 'hello\n', errorOutput = '', floodBytes = 0, hang = false, pid, compileExitCode = 0 } = {}) {
  const calls = [];
  const spawnProcess = (command, args, options) => {
    const child = new EventEmitter();
    const inputChunks = [];
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        inputChunks.push(Buffer.from(chunk));
        callback();
      },
    });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.pid = pid;
    child.kill = () => {
      child.killed = true;
      setImmediate(() => child.emit('close', null, 'SIGTERM'));
      return true;
    };
    calls.push({ command, args, options, inputChunks, child });

    setImmediate(() => {
      if (args.includes('-std=c17')) {
        if (compileExitCode !== 0 && errorOutput) child.stderr.write(errorOutput);
        child.emit('close', compileExitCode, null);
        return;
      }
      if (hang) return;
      child.stdout.write(floodBytes > 0 ? Buffer.alloc(floodBytes, 65) : output);
      if (child.killed) return;
      if (errorOutput) child.stderr.write(errorOutput);
      child.emit('close', 0, null);
    });
    return child;
  };
  return { calls, spawnProcess };
}

async function testRealProcessTreeStop() {
  if (process.env.CVIDEO_TEST_REAL_PROCESS_TREE !== '1') return;
  assert.equal(process.platform, 'win32', 'the real process-tree test requires Windows');
  const compilerPath = process.env.CVIDEO_TEST_GCC_PATH || await findGcc();
  assert.ok(compilerPath, 'Set CVIDEO_TEST_GCC_PATH to gcc.exe or add GCC to PATH for the real process-tree test');
  const source = String.raw`#include <stdio.h>
#include <string.h>
#include <windows.h>
int main(int argc, char **argv) {
  if (argc > 1 && strcmp(argv[1], "--child") == 0) { for (;;) Sleep(1000); }
  char modulePath[MAX_PATH];
  char commandLine[MAX_PATH + 32];
  STARTUPINFOA startup = {0};
  PROCESS_INFORMATION child = {0};
  startup.cb = sizeof(startup);
  if (!GetModuleFileNameA(NULL, modulePath, MAX_PATH)) return 2;
  snprintf(commandLine, sizeof(commandLine), "\"%s\" --child", modulePath);
  if (!CreateProcessA(NULL, commandLine, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, NULL, &startup, &child)) return 3;
  CloseHandle(child.hThread);
  printf("CHILD_PID=%lu\n", (unsigned long)child.dwProcessId);
  fflush(stdout);
  for (;;) Sleep(1000);
}`;
  const controller = new AbortController();
  let childPid;
  let workingDirectory;
  const run = runCProgram({
    source,
    compilerPath,
    signal: controller.signal,
    runTimeoutMs: 10_000,
    spawnProcess: (command, args, options) => {
      if (path.basename(command).toLowerCase() === 'main.exe') workingDirectory = options.cwd;
      const inheritedPath = options.env?.PATH ?? process.env.PATH ?? '';
      return spawn(command, args, {
        ...options,
        env: {
          ...process.env,
          ...options.env,
          PATH: [path.dirname(compilerPath), inheritedPath].filter(Boolean).join(path.delimiter),
        },
      });
    },
    onOutput: (_stream, text) => {
      const match = text.match(/CHILD_PID=(\d+)/);
      if (match && !childPid) {
        childPid = Number(match[1]);
        controller.abort();
      }
    },
  });

  try {
    const result = await run;
    assert.equal(result.status, 'stopped', `real C process should stop: ${JSON.stringify({
      message: result.message,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    })}`);
    assert.ok(childPid, `C parent should report its child PID: ${result.stdout}`);
    assert.ok(workingDirectory, 'the real C process working directory should be captured');
    await assert.rejects(fs.access(workingDirectory), { code: 'ENOENT' });
    const deadline = Date.now() + 5000;
    let childIsRunning = true;
    while (childIsRunning && Date.now() < deadline) {
      const output = execFileSync('tasklist.exe', ['/FI', `PID eq ${childPid}`, '/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      childIsRunning = output.includes(`"${childPid}"`);
      if (childIsRunning) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(childIsRunning, false, `descendant process ${childPid} should be terminated`);
    console.log('Real Windows C child process terminated and temporary working directory removed.');
  } finally {
    if (childPid) {
      try {
        execFileSync('taskkill.exe', ['/pid', String(childPid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
      } catch {}
    }
  }
}

async function main() {
  let compilerLookupCount = 0;
  const findCompiler = async () => {
    compilerLookupCount += 1;
    return null;
  };

  const missingCompiler = await runCProgram({

    source: 'int main(void) { return 0; }',
    findCompiler,
  });
  assert.equal(missingCompiler.status, 'compiler-missing');
  assert.match(missingCompiler.message, /GCC/);
  assert.equal(compilerLookupCount, 1);

  const invalidSource = await runCProgram({ source: '   ', findCompiler });
  assert.equal(invalidSource.status, 'invalid-input');
  assert.equal(compilerLookupCount, 1, 'invalid input must not inspect or start a compiler');

  const oversizedInput = await runCProgram({
    source: 'int main(void) { return 0; }',
    stdin: 'x'.repeat(1024 * 1024 + 1),
    findCompiler,
  });
  assert.equal(oversizedInput.status, 'invalid-input');
  assert.equal(compilerLookupCount, 1, 'oversized stdin must be rejected before compiler lookup');

  const fakeProcess = makeFakeSpawn({ output: 'answer: 42\n', errorOutput: 'warning: sample\n' });
  const executed = await runCProgram({
    source: '#include <stdio.h>\nint main(void) { puts("answer: 42"); }',
    stdin: 'sample input\n',
    compilerPath: 'C:\\tools\\gcc.exe',
    spawnProcess: fakeProcess.spawnProcess,
  });
  assert.equal(executed.status, 'success');
  assert.equal(executed.stdout, 'answer: 42\n');
  assert.equal(executed.stderr, 'warning: sample\n');
  assert.match(fakeProcess.calls[0].args.join(' '), /-std=c17/);
  assert.equal(fakeProcess.calls[0].options.shell, false);
  assert.equal(Buffer.concat(fakeProcess.calls[1].inputChunks).toString('utf8'), 'sample input\n');

  const failedCompileProcess = makeFakeSpawn({ compileExitCode: 1, errorOutput: 'main.c:1: error: expected expression\n' });
  const failedCompile = await runCProgram({
    source: 'int main(void) { return ; }',
    compilerPath: 'C:\\tools\\gcc.exe',
    spawnProcess: failedCompileProcess.spawnProcess,
  });
  assert.equal(failedCompile.status, 'compile-error');
  assert.equal(failedCompile.message, 'Cコードのコンパイルに失敗しました。標準エラーに表示されたGCCの診断を確認してください。');
  assert.match(failedCompile.stderr, /expected expression/);

  const floodProcess = makeFakeSpawn({ floodBytes: 1024 * 1024 + 1 });
  const limited = await runCProgram({
    source: 'int main(void) { return 0; }',
    compilerPath: 'C:\\tools\\gcc.exe',
    spawnProcess: floodProcess.spawnProcess,
  });
  assert.equal(limited.status, 'output-limit');
  assert.equal(Buffer.byteLength(limited.stdout, 'utf8'), 1024 * 1024);

  const exactLimitProcess = makeFakeSpawn({ floodBytes: 1024 * 1024 });
  const exactLimit = await runCProgram({
    source: 'int main(void) { return 0; }',
    compilerPath: 'C:\\tools\\gcc.exe',
    spawnProcess: exactLimitProcess.spawnProcess,
  });
  assert.equal(exactLimit.status, 'output-limit', 'execution must stop when output reaches the limit');
  assert.equal(Buffer.byteLength(exactLimit.stdout, 'utf8'), 1024 * 1024);

  const timeoutProcess = makeFakeSpawn({ hang: true });
  const timedOut = await runCProgram({
    source: 'int main(void) { return 0; }',
    compilerPath: 'C:\\tools\\gcc.exe',
    spawnProcess: timeoutProcess.spawnProcess,
    runTimeoutMs: 10,
  });
  assert.equal(timedOut.status, 'timeout');

  const stopProcess = makeFakeSpawn({ hang: true, pid: 4242 });
  const abortController = new AbortController();
  const treeKillCalls = [];
  let treeKillCompleted = false;
  const stoppedRun = runCProgram({
    source: 'int main(void) { return 0; }',
    compilerPath: 'C:\\tools\\gcc.exe',
    spawnProcess: stopProcess.spawnProcess,
    killProcessTree: (command, args, options) => {
      treeKillCalls.push({ command, args, options });
      const killer = new EventEmitter();
      setTimeout(() => stopProcess.calls[1].child.emit('close', null, 'SIGTERM'), 0);
      setTimeout(() => {
        treeKillCompleted = true;
        killer.emit('close', 0);
      }, 50);
      return killer;
    },
    signal: abortController.signal,
  });
  const executionDeadline = Date.now() + 1000;
  while (stopProcess.calls.length < 2 && Date.now() < executionDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(stopProcess.calls.length, 2, 'the program process should start before it is stopped');
  abortController.abort();
  let stoppedRunSettled = false;
  void stoppedRun.then(() => { stoppedRunSettled = true; });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(stoppedRunSettled, false, 'execution should wait for Windows process-tree termination');
  assert.equal((await stoppedRun).status, 'stopped');
  const stoppedWorkingDirectory = stopProcess.calls[1].options.cwd;
  await assert.rejects(fs.access(stoppedWorkingDirectory), { code: 'ENOENT' });
  if (process.platform === 'win32') {
    assert.equal(treeKillCompleted, true, 'execution should not return before taskkill completes');
    assert.equal(treeKillCalls.length, 1);
    assert.equal(treeKillCalls[0].command, 'taskkill');
    assert.deepEqual(treeKillCalls[0].args, ['/pid', '4242', '/t', '/f']);
    assert.equal(treeKillCalls[0].options.windowsHide, true);
  }

  await testRealProcessTreeStop();
  console.log('C runner: C17 arguments, stdin, output streams, limits, timeout, manual stop, process-tree kill, temp cleanup, invalid input, and missing-GCC guidance passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});