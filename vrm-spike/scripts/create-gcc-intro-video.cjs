const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { once } = require('node:events');
const { _electron: electron } = require('playwright');
const { runCProgram } = require('../electron/c-runner.cjs');
const { checkFfmpeg } = require('../electron/ffmpeg-service.cjs');
const projectStore = require('../electron/project-store.cjs');
const { listSpeakers, synthesizeSpeech } = require('../electron/voicevox-service.cjs');

const appDirectory = path.resolve(__dirname, '..');
const workspaceDirectory = path.resolve(appDirectory, '..');
const outputDirectory = path.join(
  appDirectory,
  'test-results',
  `gcc-c-intro-${new Date().toISOString().replace(/[:.]/g, '-')}`,
);
const projectDirectory = path.join(outputDirectory, 'project');
const outputPath = path.join(outputDirectory, 'gcc-c-intro.mp4');
const subtitlePath = path.join(outputDirectory, 'gcc-c-intro.srt');
const modelPath = path.join(workspaceDirectory, 'C1.vrm');
const sourceCode = '#include <stdio.h>\nint main(void) {\n    puts("Hello, C!");\n    return 0;\n}';
const narration = [
  '今回は、WindowsでGCCを使い、最初のCプログラムを作って実行します。',
  'GCCは、C言語のソースコードを実行可能なプログラムに変換するコンパイラーです。',
  '作業用フォルダーに、hello.cというファイルを用意しましょう。',
  'インクルード、スペース、stdio.hは、画面表示に使うputs関数の宣言を読み込む指示です。',
  'main関数がプログラムの開始地点です。putsに文字列を渡すと、その内容が画面に表示されます。',
  'returnゼロは正常終了を表します。波括弧とセミコロンも忘れずに付けましょう。',
  'ターミナルで、ジーシーシー、hello.c、ハイフンオー、hello.exeの順に指定してコンパイルします。',
  '生成された実行ファイルを起動すると、Hello, C と表示されます。',
  'もしGCCが見つからないと表示されたら、GCCのbinフォルダーをPATHに追加し、ターミナルを開き直してください。',
  'ソースコード、実行ファイル、表示結果を見比べて、編集、コンパイル、実行の流れを確認しましょう。',
].join('');

function getWavDurationSeconds(wav) {
  const channels = wav.readUInt16LE(22);
  const sampleRate = wav.readUInt32LE(24);
  const bitsPerSample = wav.readUInt16LE(34);
  const dataBytes = wav.readUInt32LE(40);
  return dataBytes / (sampleRate * channels * bitsPerSample / 8);
}

async function reserveLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startViteServer() {
  const port = await reserveLoopbackPort();
  const url = `http://127.0.0.1:${port}`;
  const viteScript = path.join(appDirectory, 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(process.execPath, [viteScript, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: appDirectory,
    stdio: 'ignore',
    windowsHide: true,
  });
  let spawnError;
  server.once('error', (error) => { spawnError = error; });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (server.exitCode !== null) throw new Error(`Vite exited before becoming ready (code ${server.exitCode}).`);
    try {
      const response = await fetch(url);
      if (response.ok) return { server, url };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  server.kill();
  throw new Error(`Vite did not become ready at ${url}.`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await once(child, 'exit');
}

async function main() {
  const speakers = await listSpeakers();
  const styleId = 2;
  const speaker = speakers.find((candidate) => candidate.styles.some((style) => style.id === styleId));
  assert.ok(speaker, `VOICEVOX style ${styleId} is unavailable.`);

  const synthesized = await synthesizeSpeech({ text: narration, styleId });
  const audio = Buffer.from(synthesized.audio);
  const audioDurationSeconds = getWavDurationSeconds(audio);
  assert.ok(synthesized.subtitles.length >= 10, 'The lesson should have sentence-level subtitles.');

  const execution = await runCProgram({ source: sourceCode });
  assert.equal(execution.status, 'success', `GCC execution failed: ${JSON.stringify(execution)}`);
  assert.equal(execution.stdout.trim(), 'Hello, C!');

  const codeLineCount = sourceCode.split('\n').length;
  const codeStages = [
    { atSeconds: synthesized.subtitles[2].startSeconds, visibleLines: 1 },
    { atSeconds: synthesized.subtitles[3].startSeconds, visibleLines: 2 },
    { atSeconds: synthesized.subtitles[4].startSeconds, visibleLines: 3 },
    { atSeconds: synthesized.subtitles[5].startSeconds, visibleLines: 4 },
    { atSeconds: synthesized.subtitles[7].startSeconds, visibleLines: codeLineCount },
  ];
  const executionAtSeconds = synthesized.subtitles[8].startSeconds;
  const request = {
    title: 'WindowsでGCCを使う C入門',
    overview: 'GCCを使ったCプログラムの作成、コンパイル、実行をHello, C!の例で学ぶ入門教材です。',
    audience: 'C言語をこれから学ぶ人',
    chapterCount: 1,
    targetMinutes: 2,
  };
  const draft = {
    title: request.title,
    chapters: [{
      title: 'GCCで最初のCプログラムを動かす',
      learningObjective: 'hello.cをGCCでコンパイルし、Windowsで実行できる。',
      targetMinutes: 2,
      narration,
      codeExample: sourceCode,
      runInput: '',
      codeDisplayMode: 'staged',
      codeStages,
      subtitles: synthesized.subtitles,
      subtitleNarrationHash: null,
      characterActions: [
        { atSeconds: synthesized.subtitles[3].startSeconds, action: 'explain' },
        { atSeconds: executionAtSeconds, action: 'attention' },
        { atSeconds: synthesized.subtitles.at(-1).startSeconds, action: 'happy' },
      ],
      audioAsset: null,
      executionResult: {
        status: execution.status,
        stdout: execution.stdout,
        stderr: execution.stderr,
        exitCode: execution.exitCode,
        videoText: `コンパイル成功\n実行結果: ${execution.stdout.trim()}\n終了コード: ${execution.exitCode}`,
        sourceCode,
        sourceInput: '',
      },
      runCode: true,
      executionAtSeconds,
    }],
  };

  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.mkdir(projectDirectory);
  await fs.writeFile(path.join(outputDirectory, 'hello.c'), `${sourceCode}\n`, 'utf8');
  await fs.writeFile(path.join(outputDirectory, 'commands.txt'), 'gcc hello.c -o hello.exe\n.\\hello.exe\n', 'utf8');
  await projectStore.saveScenarioProject(projectDirectory, request, draft);
  await projectStore.saveChapterAudio(projectDirectory, 0, audio, {
    durationSeconds: audioDurationSeconds,
    styleId,
    speakerName: speaker.name,
    narration,
    mouthTimeline: synthesized.mouthTimeline,
  });
  await projectStore.saveExternalProjectModel(projectDirectory, modelPath);

  const ffmpeg = await checkFfmpeg({ executablePath: process.env.CVIDEO_FFMPEG_PATH || require('ffmpeg-static') || undefined });
  assert.equal(ffmpeg.available, true, ffmpeg.message);
  const { server, url } = await startViteServer();
  let app;
  try {
    app = await electron.launch({
      executablePath: require('electron'),
      args: [path.join(appDirectory, 'electron', 'main.cjs')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        CVIDEO_DEV_URL: `${url}/?cvideo_test_frame=1`,
        CVIDEO_FFMPEG_PATH: ffmpeg.path,
        CVIDEO_TEST_VIDEO_EXPORT_PATH: outputPath,
      },
    });
    let window = await app.firstWindow();
    await window.waitForLoadState('load');
    await window.evaluate(() => {
      const dialog = document.querySelector('#material-terms-dialog');
      const observer = new MutationObserver(() => {
        if (!dialog.open) return;
        document.querySelector('#material-terms-confirm-checkbox').click();
        document.querySelector('#material-terms-approve').click();
      });
      observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
    });

    const rendererErrors = [];
    window.on('console', (message) => {
      if (message.type() === 'error') rendererErrors.push(message.text());
    });
    window.on('pageerror', (error) => rendererErrors.push(error.message));
    await app.evaluate(({ dialog }, selectedProject) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedProject] });
      dialog.showMessageBox = async () => ({ response: 0 });
    }, projectDirectory);
    await window.locator('#scenario-open-button').click();
    await window.getByText('再確認が必要', { exact: true }).waitFor({ timeout: 30_000 });
    await window.getByText('VRM 1.0読込完了', { exact: true }).waitFor({ timeout: 60_000 });
    await window.locator('#scenario-confirm-button').click();
    const editedSourceCode = `${sourceCode}\n/* UI acceptance edit */`;
    await window.locator('.chapter-code').first().fill(editedSourceCode);
    await window.locator('#scenario-editor .execution-controls button').first().click();
    await window.getByText('終了コード: 0', { exact: true }).waitFor({ timeout: 30_000 });
    assert.equal(
      (await window.locator('.execution-output[aria-label="標準出力"]').textContent()).replace(/\r\n/g, '\n'),
      'Hello, C!\n',
    );
    await window.locator('#scenario-confirm-button').click();
    await window.locator('#scenario-save-button').click();
    await window.getByText(/プロジェクトを保存しました/).waitFor({ timeout: 30_000 });
    await window.evaluate(() => { window.confirm = () => true; });
    await window.locator('#video-export-button').click();
    try {
      await window.getByText(/MP4動画とSRT字幕を保存しました/).waitFor({ timeout: 600_000 });
    } catch (error) {
      const status = await window.locator('#video-export-status').textContent().catch(() => '<unavailable>');
      throw new Error(`${error instanceof Error ? error.message : String(error)}; export status: ${status}`);
    }
    assert.deepEqual(rendererErrors, [], `Renderer reported errors: ${rendererErrors.join(' | ')}`);

    await app.close();
    app = await electron.launch({
      executablePath: require('electron'),
      args: [path.join(appDirectory, 'electron', 'main.cjs')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        CVIDEO_DEV_URL: `${url}/?cvideo_test_frame=1`,
        CVIDEO_FFMPEG_PATH: ffmpeg.path,
        CVIDEO_TEST_VIDEO_EXPORT_PATH: outputPath,
      },
    });
    window = await app.firstWindow();
    await window.waitForLoadState('load');
    await window.evaluate(() => {
      const dialog = document.querySelector('#material-terms-dialog');
      const observer = new MutationObserver(() => {
        if (!dialog.open) return;
        document.querySelector('#material-terms-confirm-checkbox').click();
        document.querySelector('#material-terms-approve').click();
      });
      observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
    });
    const restoredRendererErrors = [];
    window.on('console', (message) => {
      if (message.type() === 'error') restoredRendererErrors.push(message.text());
    });
    window.on('pageerror', (error) => restoredRendererErrors.push(error.message));
    await app.evaluate(({ dialog }, selectedProject) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedProject] });
    }, projectDirectory);
    await window.locator('#scenario-open-button').click();
    await window.getByText('再確認が必要', { exact: true }).waitFor({ timeout: 30_000 });
    await window.getByText(/^保存済み音声（\d+\.\d+秒）を読み込みました。$/).waitFor({ timeout: 30_000 });
    await window.getByText('VRM 1.0読込完了', { exact: true }).waitFor({ timeout: 60_000 });
    assert.equal(await window.locator('.chapter-code').first().inputValue(), editedSourceCode);
    assert.equal(
      (await window.locator('.execution-output[aria-label="標準出力"]').textContent()).replace(/\r\n/g, '\n'),
      'Hello, C!\n',
    );
    assert.match(await window.locator('.execution-status').innerText(), /success/);
    assert.equal(await window.locator('.subtitle-row').count(), synthesized.subtitles.length);
    assert.deepEqual(restoredRendererErrors, [], `Renderer reported errors after restart: ${restoredRendererErrors.join(' | ')}`);
    console.log('The same project restored edited C code, GCC output, VOICEVOX audio, subtitles, and VRM after Electron restart.');
  } finally {
    await app?.close();
    await stopProcess(server);
  }

  const video = await fs.readFile(outputPath);
  const subtitles = await fs.readFile(subtitlePath, 'utf8');
  assert.ok(video.length > 20_000, `MP4 output is unexpectedly small: ${video.length} bytes`);
  assert.match(video.toString('latin1', 4, 8), /ftyp/);
  assert.ok(subtitles.includes('hello.c'));
  const decode = spawnSync(ffmpeg.path, ['-hide_banner', '-i', outputPath, '-f', 'null', '-'], {
    encoding: 'utf8',
    timeout: 300_000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  assert.equal(decode.status, 0, `FFmpeg could not decode the MP4: ${decode.stderr}`);
  assert.match(decode.stderr, /Video: h264.*1920x1080.*30 fps/);
  assert.match(decode.stderr, /Audio: aac.*48000 Hz/);
  assert.match(decode.stderr, /Subtitle: mov_text/);

  console.log(JSON.stringify({
    status: 'passed',
    outputDirectory,
    video: outputPath,
    videoBytes: video.length,
    subtitles: subtitlePath,
    subtitleCount: synthesized.subtitles.length,
    project: projectDirectory,
    source: path.join(outputDirectory, 'hello.c'),
    voice: `VOICEVOX: ${speaker.name}`,
    audioDurationSeconds,
    gccOutput: execution.stdout.trim(),
    ffmpeg: ffmpeg.version,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});