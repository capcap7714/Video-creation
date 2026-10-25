const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { format } = require('node:util');
const { _electron: electron } = require('playwright');
const { checkFfmpeg } = require('../electron/ffmpeg-service.cjs');
const projectStore = require('../electron/project-store.cjs');
const keepArtifacts = process.env.CVIDEO_KEEP_VIDEO_EXPORT_ARTIFACTS === '1';
const useLiveVoicevox = process.env.CVIDEO_VIDEO_EXPORT_VOICEVOX === '1' || process.argv.includes('--with-live-voicevox');
const missingAudioOnly = process.argv.includes('--missing-audio-only');
const timelineSyncExportOnly = process.argv.includes('--timeline-sync-export-only');
const timelineSyncOnly = !timelineSyncExportOnly && process.argv.includes('--timeline-sync-only');
const syncResultPath = process.argv.find((argument) => argument.startsWith('--sync-result='))?.slice('--sync-result='.length);
const resultFileArgument = process.argv.find((argument) => argument.startsWith('--result-file='))?.slice('--result-file='.length);
const resultFilePath = resultFileArgument
  ? path.resolve(resultFileArgument)
  : path.resolve(__dirname, '../test-results/video-export-e2e-result.json');
const testStartedAt = Date.now();
const capturedTestLogs = [];
const originalConsoleLog = console.log.bind(console);
const originalConsoleError = console.error.bind(console);
console.log = (...values) => {
  capturedTestLogs.push({ level: 'info', message: format(...values) });
  originalConsoleLog(...values);
};
console.error = (...values) => {
  capturedTestLogs.push({ level: 'error', message: format(...values) });
  originalConsoleError(...values);
};

const request = {
  title: 'MP4出力E2E',
  overview: 'ElectronからFFmpegへ章映像を出力するための自動確認教材です。',
  audience: '初学者',
  chapterCount: 1,
  targetMinutes: 1,
};
const draft = {
  title: request.title,
  chapters: [{
    title: '動画を書き出す',
    learningObjective: '章の映像をMP4として保存できる。',
    targetMinutes: 1,
    narration: 'これはMP4書き出しの自動テストに使う読み上げ本文です。',
    codeExample: '#include <stdio.h>\nint main(void) {\n  puts("ready");\n  return 0;\n}',
    runInput: '',
    codeDisplayMode: 'staged',
    codeStages: [],
    subtitles: [{ startSeconds: 0.1, endSeconds: 0.85, text: 'MP4出力テスト字幕です。' }],
    executionResult: {
      status: 'compile-error',
      stdout: '',
      stderr: 'テスト用のコンパイルエラー',
      exitCode: null,
      videoText: 'エラー内容の解説',
      sourceCode: '#include <stdio.h>\nint main(void) {\n  puts("ready");\n  return 0;\n}',
      sourceInput: '',
    },
    executionAtSeconds: 0,
    runCode: true,
  }],
};

function createSilentWav() {
  const sampleRate = 24_000;
  const sampleCount = sampleRate;
  const wav = Buffer.alloc(44 + sampleCount * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(sampleCount * 2, 40);
  return wav;
}

function getWavDurationSeconds(wav) {
  const channels = wav.readUInt16LE(22);
  const sampleRate = wav.readUInt32LE(24);
  const bitsPerSample = wav.readUInt16LE(34);
  const dataBytes = wav.readUInt32LE(40);
  return dataBytes / (sampleRate * channels * bitsPerSample / 8);
}

function srtTimeToSeconds(value) {
  const [clock, milliseconds] = value.split(',');
  const [hours, minutes, seconds] = clock.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds + Number(milliseconds) / 1000;
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

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await new Promise((resolve) => child.once('exit', resolve));
}

async function startViteServer() {
  const port = await reserveLoopbackPort();
  const url = `http://127.0.0.1:${port}`;
  const viteScript = path.resolve(__dirname, '../node_modules/vite/bin/vite.js');
  const server = spawn(process.execPath, [viteScript, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: path.resolve(__dirname, '..'),
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
  await stopProcess(server);
  throw new Error(`Vite did not become ready at ${url}.`);
}

async function main() {
  const ffmpegPath = process.env.CVIDEO_FFMPEG_PATH || require('ffmpeg-static') || undefined;
  const dependency = await checkFfmpeg({ executablePath: ffmpegPath });
  assert.equal(dependency.available, true, dependency.message);
  const testDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'c-video-export-e2e-'));
  const projectDirectory = path.join(testDirectory, 'project');
  const outputPath = path.join(testDirectory, 'chapter-01.mp4');
  const subtitlePath = path.join(testDirectory, 'chapter-01.srt');
  const previousVideo = Buffer.from('previous mp4 output');
  const previousSubtitles = 'previous subtitle output\n';
  let app;
  let viteServer;
  let testDraft = draft;
  let chapterAudio = createSilentWav();
  let audioDurationSeconds = 1;
  let speakerName = 'テスト話者 / ノーマル';
  let synchronizationFrames;

  try {
    if (useLiveVoicevox) {
      const { synthesizeSpeech } = require('../electron/voicevox-service.cjs');
      const synthesized = await synthesizeSpeech({ text: draft.chapters[0].narration, styleId: 2 });
      chapterAudio = Buffer.from(synthesized.audio);
      audioDurationSeconds = getWavDurationSeconds(chapterAudio);
      speakerName = '四国めたん / ノーマル';
      testDraft = {
        ...draft,
        chapters: [{ ...draft.chapters[0], subtitles: synthesized.subtitles }],
      };
    }
    const synchronizationCue = testDraft.chapters[0].subtitles[0];
    assert.ok(synchronizationCue, 'the composite timing fixture requires a subtitle cue');
    const actionFrame = Math.ceil((synchronizationCue.startSeconds + (synchronizationCue.endSeconds - synchronizationCue.startSeconds) * 0.4) * 30);
    const actionAtSeconds = actionFrame / 30;
    const executionFrame = actionFrame - 3;
    synchronizationFrames = {
      beforeExecution: executionFrame - 1,
      afterExecution: actionFrame - 1,
      afterStageAndAction: actionFrame + 6,
      actionAtSeconds,
    };
    assert.ok(synchronizationFrames.beforeExecution >= 0, 'the fixture needs a frame before the execution marker');
    assert.ok(synchronizationFrames.afterStageAndAction / 30 < synchronizationCue.endSeconds, 'the subtitle must remain active after the stage and action markers');
    testDraft = {
      ...testDraft,
      chapters: [{
        ...testDraft.chapters[0],
        codeExample: draft.chapters[0].codeExample,
        codeDisplayMode: 'staged',
        codeStages: [
          { atSeconds: 0, visibleLines: 1 },
          { atSeconds: actionAtSeconds, visibleLines: draft.chapters[0].codeExample.split('\n').length },
        ],
        executionResult: {
          ...draft.chapters[0].executionResult,
          sourceCode: draft.chapters[0].codeExample,
        },
        executionAtSeconds: executionFrame / 30,
        characterActions: [{ atSeconds: actionAtSeconds, action: 'happy' }],
      }],
    };
    viteServer = await startViteServer();
    await fs.mkdir(projectDirectory);
    await Promise.all([
      fs.writeFile(outputPath, previousVideo),
      fs.writeFile(subtitlePath, previousSubtitles, 'utf8'),
    ]);
    await projectStore.saveScenarioProject(projectDirectory, request, testDraft);
    if (!missingAudioOnly) {
      await projectStore.saveChapterAudio(projectDirectory, 0, chapterAudio, {
        durationSeconds: audioDurationSeconds,
        styleId: 2,
        speakerName,
        narration: draft.chapters[0].narration,
      });
    }

    app = await electron.launch({
      executablePath: require('electron'),
      args: [path.resolve(__dirname, '../electron/main.cjs')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        CVIDEO_DEV_URL: `${viteServer.url}/?cvideo_test_frame=1`,
        CVIDEO_FFMPEG_PATH: dependency.path,
        CVIDEO_TEST_VIDEO_EXPORT_PATH: outputPath,
      },
    });
    const window = await app.firstWindow();
    await window.waitForLoadState('load');
    const rendererErrors = [];
    window.on('console', (message) => {
      if (message.type() === 'error') rendererErrors.push(message.text());
    });
    window.on('pageerror', (error) => rendererErrors.push(error.message));
    const dialogsPatched = await app.evaluate(({ dialog }, selectedProject, selectedOutput) => {
      const showOpenDialog = async () => ({ canceled: false, filePaths: [selectedProject] });
      const showSaveDialog = async () => ({ canceled: false, filePath: selectedOutput });
      globalThis.__videoExportOverwritePrompts = [];
      const showMessageBox = async (_owner, options) => {
        globalThis.__videoExportOverwritePrompts.push(options.message);
        return { response: globalThis.__videoExportOverwriteResponse ?? 0 };
      };
      dialog.showOpenDialog = showOpenDialog;
      dialog.showSaveDialog = showSaveDialog;
      dialog.showMessageBox = showMessageBox;
      return dialog.showOpenDialog === showOpenDialog
        && dialog.showSaveDialog === showSaveDialog
        && dialog.showMessageBox === showMessageBox;
    }, projectDirectory, outputPath);
    assert.equal(dialogsPatched, true, 'Electron dialog methods should be replaceable for integration testing');

    await window.locator('#scenario-open-button').click();
    await window.getByText('再確認が必要', { exact: true }).waitFor({ timeout: 30_000 });
    if (!missingAudioOnly) {
      await window.getByText(/^保存済み音声（\d+\.\d+秒）を読み込みました。$/).waitFor({ timeout: 30_000 });
    }
    await window.locator('#scenario-confirm-button').click();
    await window.locator('#scenario-save-button').click();
    await window.getByText(/プロジェクトを保存しました/).waitFor({ timeout: 30_000 });
    assert.deepEqual(await app.evaluate(() => globalThis.__videoExportOverwritePrompts), [
      '選択したフォルダーには既にproject.jsonがあります。上書きしますか？',
    ]);
    await window.locator('#model-file').setInputFiles(path.resolve(__dirname, '../../C1.vrm'));
    await window.getByText('VRM 1.0読込完了', { exact: true }).waitFor({ timeout: 30_000 });

    if (missingAudioOnly) {
      await window.locator('#video-export-button').click();
      const missingAudioMessage = '選択した章に保存済み音声がありません。音声を生成して保存してください。';
      await window.getByText(missingAudioMessage, { exact: true }).waitFor({ timeout: 15_000 });
      assert.equal(await window.locator('#voicevox-connect-button').evaluate((button) => document.activeElement === button), true);
      assert.deepEqual(await fs.readFile(outputPath), previousVideo, 'missing audio should preserve the existing MP4');
      assert.equal(await fs.readFile(subtitlePath, 'utf8'), previousSubtitles, 'missing audio should preserve the existing SRT');
      console.log('Missing chapter audio blocked export and focused the VOICEVOX connection action without replacing outputs');
      return;
    }

    const subtitleEndInput = window.locator('.subtitle-row .subtitle-end').first();
    const originalSubtitleEnd = await subtitleEndInput.inputValue();
    const loadedAudioDurationSeconds = await window.locator('.chapter-audio').evaluate((audio) => audio.duration);
    assert.ok(Number.isFinite(loadedAudioDurationSeconds) && loadedAudioDurationSeconds > 0, 'chapter audio duration should be available for timeline validation');
    const creditStartSeconds = Math.ceil(loadedAudioDurationSeconds * 30 - 1e-9) / 30;
    assert.equal(await window.locator('.timeline-marker[data-kind="credit"]').count(), 1);
    assert.ok(Number(await window.locator('#timeline').getAttribute('max')) >= creditStartSeconds + 3);
    await window.locator('.timeline-marker[data-kind="credit"]').click();
    assert.ok(Math.abs(Number(await window.locator('#timeline').inputValue()) - creditStartSeconds) < 0.02);
    assert.equal(await window.locator('#credit-preview').isVisible(), true);
    assert.equal(await window.locator('#credit-preview-title').innerText(), draft.chapters[0].title);
    assert.match(await window.locator('#credit-preview-attribution').innerText(), /^VOICEVOX:/);
    assert.equal(await window.locator('#video-code-preview').isHidden(), true);
    await window.locator('#timeline').evaluate((input) => {
      input.value = '0';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await window.locator('#credit-preview').isHidden(), true);

    const comparePreviewAndExportAt = async (frameIndex) => window.evaluate(async ({ frameIndex, contentFrames, chapterTitle, creditText }) => {
      const timelineInput = document.querySelector('#timeline');
      timelineInput.value = String(frameIndex / 30);
      timelineInput.dispatchEvent(new Event('input', { bubbles: true }));
      const previewDataUrl = document.querySelector('#render-canvas').toDataURL('image/png');
      const previewText = window.__cvideoTestReadExportText?.();
      const previewCodeStage = document.querySelector('.staged-code-preview').textContent;
      const previewPose = window.__cvideoTestGetCharacterPose?.();
      const exportPng = await window.__cvideoTestCreateVideoFrame(frameIndex, contentFrames, chapterTitle, creditText);
      const exportText = window.__cvideoTestReadExportText?.();
      const previewImage = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = previewDataUrl;
      });
      const exportImage = await createImageBitmap(new Blob([exportPng], { type: 'image/png' }));
      const comparisonCanvas = document.createElement('canvas');
      comparisonCanvas.width = 1920;
      comparisonCanvas.height = 1080;
      const context = comparisonCanvas.getContext('2d');
      context.drawImage(previewImage, 0, 0);
      const previewPixels = context.getImageData(900, 0, 1020, 880).data;
      context.clearRect(0, 0, comparisonCanvas.width, comparisonCanvas.height);
      context.drawImage(exportImage, 0, 0);
      const exportPixels = context.getImageData(900, 0, 1020, 880).data;
      let differingPixels = 0;
      for (let index = 0; index < previewPixels.length; index += 4) {
        if (
          previewPixels[index] !== exportPixels[index]
          || previewPixels[index + 1] !== exportPixels[index + 1]
          || previewPixels[index + 2] !== exportPixels[index + 2]
          || previewPixels[index + 3] !== exportPixels[index + 3]
        ) differingPixels += 1;
      }
      return { differingPixels, comparedPixels: previewPixels.length / 4, previewText, exportText, previewCodeStage, previewPose };
    }, {
      frameIndex,
      contentFrames: Math.ceil(loadedAudioDurationSeconds * 30),
      chapterTitle: draft.chapters[0].title,
      creditText: `VOICEVOX: ${speakerName}`,
    });
    const assertFrameMatchesPreview = (comparison, label) => {
      assert.ok(
        comparison.differingPixels <= comparison.comparedPixels * 0.001,
        `${label}: VRM preview/export pixel difference exceeded 0.1% (${comparison.differingPixels}/${comparison.comparedPixels})`,
      );
    };
    const beforeExecution = await comparePreviewAndExportAt(synchronizationFrames.beforeExecution);
    assert.deepEqual(beforeExecution.previewText, beforeExecution.exportText, 'the preview and export should agree before the C-result timestamp');
    assert.equal(beforeExecution.previewText.result, '', 'the C result should remain hidden before its timeline timestamp');
    assert.equal(beforeExecution.previewText.subtitle, synchronizationCue.text, 'the generated subtitle should be visible at the pre-execution sample');
    assertFrameMatchesPreview(beforeExecution, 'before C-result timestamp');

    const afterExecution = await comparePreviewAndExportAt(synchronizationFrames.afterExecution);
    assert.deepEqual(afterExecution.previewText, afterExecution.exportText, 'the preview and export should agree between execution and code/action timestamps');
    assert.equal(afterExecution.previewText.code.split('\n').length, 1, 'only the first staged code line should be visible before the code-stage timestamp');
    assert.equal(afterExecution.previewText.result, draft.chapters[0].executionResult.videoText, 'the C result should appear at its configured timestamp');
    assert.equal(afterExecution.previewText.subtitle, synchronizationCue.text, 'the generated subtitle should remain synchronized between timeline events');
    assertFrameMatchesPreview(afterExecution, 'after C-result timestamp');

    const afterStageAndAction = await comparePreviewAndExportAt(synchronizationFrames.afterStageAndAction);
    assert.deepEqual(afterStageAndAction.previewText, afterStageAndAction.exportText, 'the preview and export should agree after the code-stage and action timestamps');
    assert.equal(afterStageAndAction.previewText.code, draft.chapters[0].codeExample, 'all staged code lines should appear at the configured timestamp');
    assert.equal(afterStageAndAction.previewText.result, draft.chapters[0].executionResult.videoText);
    assert.equal(afterStageAndAction.previewText.subtitle, synchronizationCue.text);
    assert.ok(Math.abs(afterStageAndAction.previewPose.head[2] - afterExecution.previewPose.head[2]) > 0.02, 'the character action should change the VRM head pose in the corresponding frame');
    assert.ok(afterStageAndAction.previewPose.happy > 0.3, 'the happy character expression should be active during its action event');
    assertFrameMatchesPreview(afterStageAndAction, 'while character action is active');
    const currentSubtitleNarrationHash = await window.evaluate(async () => {
      const text = document.querySelector('.chapter-narration').value.trim();
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
    });
    await window.evaluate(() => {
      document.querySelector('#scenario-editor fieldset').dataset.subtitleNarrationHash = '0'.repeat(64);
      window.__cvideoLastSubtitleReviewPrompt = '';
      window.confirm = (message) => {
        window.__cvideoLastSubtitleReviewPrompt = message;
        return false;
      };
    });
    await window.locator('#video-export-button').click();
    assert.match(await window.evaluate(() => window.__cvideoLastSubtitleReviewPrompt), /字幕の表示タイミングを確認しましたか/);
    assert.equal(await window.locator('#video-export-status').innerText(), '字幕タイミングを確認してから書き出してください。');
    assert.equal(await window.locator('.subtitle-start').first().evaluate((input) => document.activeElement === input), true);
    await window.evaluate((hash) => {
      document.querySelector('#scenario-editor fieldset').dataset.subtitleNarrationHash = hash;
    }, currentSubtitleNarrationHash);
    console.log('Code stage, C result, VRM action, generated subtitle, and export frames stayed synchronized across timeline timestamps');
    if (timelineSyncOnly) return;
    if (timelineSyncExportOnly) {
      console.log('Starting MP4 export for encoded-frame synchronization check');
      await window.evaluate(() => { window.confirm = () => true; });
      await window.locator('#video-export-button').click();
      await window.getByText(/MP4動画とSRT字幕を保存しました/).waitFor({ timeout: 120_000 });
      console.log('MP4 export completed; extracting the synchronized event frame');
      const encodedSubtitles = await fs.readFile(subtitlePath, 'utf8');
      const encodedCues = [...encodedSubtitles.matchAll(/^\d+\r?\n(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})\r?\n([\s\S]*?)(?=\r?\n\r?\n|$)/gm)];
      assert.equal(encodedCues.length, testDraft.chapters[0].subtitles.length, 'encoded MP4 export should write every generated SRT cue');
      for (const [index, cue] of encodedCues.entries()) {
        const expectedCue = testDraft.chapters[0].subtitles[index];
        assert.ok(Math.abs(srtTimeToSeconds(cue[1]) - expectedCue.startSeconds) <= 0.001, `encoded SRT cue ${index + 1} start time should match the timeline`);
        assert.ok(Math.abs(srtTimeToSeconds(cue[2]) - expectedCue.endSeconds) <= 0.001, `encoded SRT cue ${index + 1} end time should match the timeline`);
        assert.equal(cue[3].trim(), expectedCue.text, `encoded SRT cue ${index + 1} should match the generated subtitle`);
      }
      const extractedSubtitles = spawnSync(dependency.path, [
        '-hide_banner', '-i', outputPath, '-map', '0:s:0', '-c:s', 'srt', '-f', 'srt', 'pipe:1',
      ], { encoding: 'utf8', timeout: 120_000, windowsHide: true });
      assert.equal(extractedSubtitles.status, 0, `FFmpeg could not extract the embedded MP4 subtitle track: ${extractedSubtitles.stderr}`);
      const embeddedCues = [...extractedSubtitles.stdout.matchAll(/^(\d+)\r?\n(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})\r?\n([\s\S]*?)(?=\r?\n\r?\n|$)/gm)];
      assert.equal(embeddedCues.length, encodedCues.length, 'embedded MP4 subtitle cue count should match the SRT file');
      for (const [index, cue] of embeddedCues.entries()) {
        const srtCue = encodedCues[index];
        assert.equal(Number(cue[1]), index + 1, `embedded MP4 subtitle cue ${index + 1} should retain sequential numbering`);
        assert.ok(Math.abs(srtTimeToSeconds(cue[2]) - srtTimeToSeconds(srtCue[1])) <= 0.001, `embedded MP4 subtitle cue ${index + 1} start should match SRT`);
        assert.ok(Math.abs(srtTimeToSeconds(cue[3]) - srtTimeToSeconds(srtCue[2])) <= 0.001, `embedded MP4 subtitle cue ${index + 1} end should match SRT`);
        assert.equal(cue[4].trim(), srtCue[3].trim(), `embedded MP4 subtitle cue ${index + 1} text should match SRT`);
      }
      const fullDecode = spawnSync(dependency.path, ['-hide_banner', '-i', outputPath, '-f', 'null', '-'], {
        encoding: 'utf8', timeout: 120_000, windowsHide: true,
      });
      assert.equal(fullDecode.status, 0, `FFmpeg could not fully decode the synchronized MP4: ${fullDecode.stderr}`);
      assert.match(fullDecode.stderr, /Video: h264.*1920x1080.*30 fps/);
      assert.match(fullDecode.stderr, /Audio: aac.*48000 Hz/);
      assert.match(fullDecode.stderr, /Subtitle: mov_text/);
      const decodedDuration = fullDecode.stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      assert.ok(decodedDuration, `FFmpeg should report the synchronized MP4 duration: ${fullDecode.stderr}`);
      const outputDurationSeconds = Number(decodedDuration[1]) * 3600 + Number(decodedDuration[2]) * 60 + Number(decodedDuration[3]);
      assert.ok(Math.abs(outputDurationSeconds - (creditStartSeconds + 3)) <= 1 / 30, 'MP4 duration should match the audio plus three-second credits within one frame');
      const framePng = spawnSync(dependency.path, [
        '-hide_banner', '-i', outputPath,
        '-vf', `select=eq(n\\,${synchronizationFrames.afterStageAndAction})`,
        '-vsync', '0', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1',
      ], { encoding: null, timeout: 120_000, windowsHide: true });
      assert.equal(framePng.status, 0, `FFmpeg could not extract the synchronized MP4 frame: ${framePng.stderr?.toString('utf8')}`);
      assert.ok(framePng.stdout.length > 1000, 'FFmpeg should return an extracted PNG frame');
      const expectedFrameDataUrl = await window.evaluate(async ({ frameIndex, contentFrames, chapterTitle, creditText }) => {
        const png = await window.__cvideoTestCreateVideoFrame(frameIndex, contentFrames, chapterTitle, creditText);
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(new Blob([png], { type: 'image/png' }));
        });
      }, {
        frameIndex: synchronizationFrames.afterStageAndAction,
        contentFrames: Math.ceil(loadedAudioDurationSeconds * 30),
        chapterTitle: draft.chapters[0].title,
        creditText: `VOICEVOX: ${speakerName}`,
      });
      const actualFrameDataUrl = `data:image/png;base64,${framePng.stdout.toString('base64')}`;
      const encodedFrameComparison = await window.evaluate(async ({ expectedUrl, actualUrl }) => {
        const loadImage = (source) => new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = source;
        });
        const [expectedImage, actualImage] = await Promise.all([loadImage(expectedUrl), loadImage(actualUrl)]);
        const canvas = document.createElement('canvas');
        canvas.width = 1920;
        canvas.height = 1080;
        const context = canvas.getContext('2d');
        context.drawImage(expectedImage, 0, 0);
        const expectedPixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(actualImage, 0, 0);
        const actualPixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let absoluteDifference = 0;
        let severeDifferencePixels = 0;
        for (let index = 0; index < expectedPixels.length; index += 4) {
          const difference = Math.max(
            Math.abs(expectedPixels[index] - actualPixels[index]),
            Math.abs(expectedPixels[index + 1] - actualPixels[index + 1]),
            Math.abs(expectedPixels[index + 2] - actualPixels[index + 2]),
          );
          absoluteDifference += difference;
          if (difference > 48) severeDifferencePixels += 1;
        }
        const pixelCount = expectedPixels.length / 4;
        return {
          meanAbsoluteDifference: absoluteDifference / (pixelCount * 3),
          severeDifferenceRatio: severeDifferencePixels / pixelCount,
        };
      }, { expectedUrl: expectedFrameDataUrl, actualUrl: actualFrameDataUrl });
      assert.ok(encodedFrameComparison.meanAbsoluteDifference < 8, `encoded MP4 frame differs too much from the expected composition: ${JSON.stringify(encodedFrameComparison)}`);
      assert.ok(encodedFrameComparison.severeDifferenceRatio < 0.01, `encoded MP4 frame has too many divergent pixels: ${JSON.stringify(encodedFrameComparison)}`);
      if (syncResultPath) {
        await fs.writeFile(syncResultPath, JSON.stringify({
          status: 'passed',
          meanAbsoluteDifference: encodedFrameComparison.meanAbsoluteDifference,
          severeDifferenceRatio: encodedFrameComparison.severeDifferenceRatio,
          audioDurationSeconds: loadedAudioDurationSeconds,
          outputDurationSeconds,
          subtitleCueCount: encodedCues.length,
        }, null, 2), 'utf8');
      }
      console.log(`Encoded MP4 event frame matched the expected composition (mean RGB error ${encodedFrameComparison.meanAbsoluteDifference.toFixed(2)}, severe pixels ${(encodedFrameComparison.severeDifferenceRatio * 100).toFixed(3)}%).`);
      console.log('MP4 embedded subtitle track matched SRT timing and text; full decode, audio-plus-credits duration, and encoded-frame synchronization all passed.');
      return;
    }

    const outOfRangeSubtitleEnd = (loadedAudioDurationSeconds + 1).toFixed(2);
    await subtitleEndInput.fill(outOfRangeSubtitleEnd);
    await window.locator('#scenario-confirm-button').click();
    await window.locator('#scenario-save-button').click();
    await window.getByText(/プロジェクトを保存しました/).waitFor({ timeout: 30_000 });
    await window.locator('#video-export-button').click();
    const timelinePreflightStatus = await window.locator('#video-export-status').innerText();
    assert.ok(
      timelinePreflightStatus.includes(`字幕1の終了時刻が音声の長さ${loadedAudioDurationSeconds.toFixed(2)}秒を超えています。`),
      `out-of-range subtitle should be rejected before export: ${timelinePreflightStatus}`,
    );
    assert.equal(await subtitleEndInput.evaluate((input) => document.activeElement === input), true);
    assert.ok(
      Math.abs(Number(await window.locator('#timeline').inputValue()) - Number(outOfRangeSubtitleEnd)) < 0.02,
      'preflight should seek the preview to the invalid subtitle timestamp',
    );
    await subtitleEndInput.fill(originalSubtitleEnd);
    await window.locator('#scenario-confirm-button').click();
    await window.locator('#scenario-save-button').click();
    await window.getByText(/プロジェクトを保存しました/).waitFor({ timeout: 30_000 });

    await window.getByRole('button', { name: '動作を追加' }).click();
    const characterActionTime = window.locator('.character-action-time').last();
    await characterActionTime.fill((loadedAudioDurationSeconds + 1).toFixed(2));
    await window.locator('#scenario-confirm-button').click();
    await window.locator('#scenario-save-button').click();
    await window.getByText(/プロジェクトを保存しました/).waitFor({ timeout: 30_000 });
    await window.locator('#video-export-button').click();
    const characterActionPreflightStatus = await window.locator('#video-export-status').innerText();
    assert.ok(
      characterActionPreflightStatus.includes(`キャラクター動作2の時刻が音声の長さ${loadedAudioDurationSeconds.toFixed(2)}秒を超えています。`),
      `out-of-range character action should be rejected before export: ${characterActionPreflightStatus}`,
    );
    assert.equal(await characterActionTime.evaluate((input) => document.activeElement === input), true);
    assert.ok(
      Math.abs(Number(await window.locator('#timeline').inputValue()) - Number(await characterActionTime.inputValue())) < 0.02,
      'preflight should seek the preview to the invalid character-action timestamp',
    );
    await characterActionTime.fill((synchronizationFrames.actionAtSeconds + Math.min(0.1, (loadedAudioDurationSeconds - synchronizationFrames.actionAtSeconds) / 2)).toFixed(2));
    await window.locator('#scenario-confirm-button').click();
    await window.locator('#scenario-save-button').click();
    await window.getByText(/プロジェクトを保存しました/).waitFor({ timeout: 30_000 });

    await app.evaluate(() => { globalThis.__videoExportOverwritePrompts = []; });
    await app.evaluate(() => { globalThis.__videoExportOverwriteResponse = 1; });
    await window.evaluate(() => {
      window.__cvideoLastPreflightWarning = '';
      window.confirm = (message) => {
        window.__cvideoLastPreflightWarning = message;
        return false;
      };
    });
    await window.locator('#video-export-button').click();
    assert.equal(
      await window.locator('#video-export-status').innerText(),
      'C実行結果の注意を確認し、書き出しをキャンセルしました。',
    );
    assert.match(await window.evaluate(() => window.__cvideoLastPreflightWarning), /compile-error/);
    assert.deepEqual(await app.evaluate(() => globalThis.__videoExportOverwritePrompts), [], 'declining a content warning should stop before export IPC');
    assert.deepEqual(await fs.readFile(outputPath), previousVideo, 'declining a content warning should preserve the existing MP4');

    await window.evaluate(() => { window.confirm = () => true; });
    await window.locator('#video-export-button').click();
    await window.getByText('動画の書き出しをキャンセルしました。', { exact: true }).waitFor({ timeout: 30_000 });
    assert.deepEqual(await app.evaluate(() => globalThis.__videoExportOverwritePrompts), [
      '同名のSRT字幕ファイルがあります。MP4と一緒に上書きしますか？',
    ], 'accepting a content warning should continue to the output overwrite check');
    assert.deepEqual(await fs.readFile(outputPath), previousVideo, 'cancelling after accepting a warning should preserve the existing MP4');

    await app.evaluate(() => { globalThis.__videoExportOverwritePrompts = []; });

    await app.evaluate(() => { globalThis.__videoExportOverwriteResponse = 1; });
    await window.locator('#video-export-button').click();
    await window.getByText('動画の書き出しをキャンセルしました。', { exact: true }).waitFor({ timeout: 30_000 });
    await window.waitForFunction(
      () => !document.querySelector('#video-export-button')?.disabled,
      null,
      { timeout: 30_000 },
    );
    assert.deepEqual(await fs.readFile(outputPath), previousVideo, 'declining overwrite should preserve the previous MP4');
    assert.equal(await fs.readFile(subtitlePath, 'utf8'), previousSubtitles, 'declining overwrite should preserve the previous SRT');

    await app.evaluate(() => { globalThis.__videoExportOverwriteResponse = 0; });
    await window.locator('#video-export-button').click();
    await window.waitForFunction(
      () => {
        const button = document.querySelector('#video-cancel-button');
        return button && !button.disabled;
      },
      null,
      { timeout: 30_000 },
    );
    await window.getByText(/^画面を生成・エンコード中:/).waitFor({ timeout: 60_000 });
    await window.locator('#video-cancel-button').click();
    await window.getByText('動画の書き出しを停止しました。', { exact: true }).waitFor({ timeout: 30_000 });
    await window.waitForFunction(
      () => !document.querySelector('#video-export-button')?.disabled,
      null,
      { timeout: 30_000 },
    );
    assert.deepEqual(await fs.readFile(outputPath), previousVideo, 'cancelled export should preserve the previous MP4');
    assert.equal(await fs.readFile(subtitlePath, 'utf8'), previousSubtitles, 'cancelled export should preserve the previous SRT');

    await app.evaluate(() => { process.env.CVIDEO_TEST_VIDEO_EXPORT_FAIL_ONCE = '1'; });
    await window.locator('#video-export-button').click();
    await window.getByText('テスト用のフレーム書き込みエラーです。', { exact: true }).waitFor({ timeout: 30_000 });
    await window.waitForFunction(
      () => !document.querySelector('#video-export-button')?.disabled,
      null,
      { timeout: 30_000 },
    );
    assert.deepEqual(await fs.readFile(outputPath), previousVideo, 'failed export should preserve the previous MP4');
    assert.equal(await fs.readFile(subtitlePath, 'utf8'), previousSubtitles, 'failed export should preserve the previous SRT');

    await app.evaluate(() => { process.env.CVIDEO_TEST_FFMPEG_EXIT_ONCE = '1'; });
    await window.locator('#video-export-button').click();
    await window.waitForFunction(
      () => !document.querySelector('#video-export-button')?.disabled,
      null,
      { timeout: 120_000 },
    );
    const ffmpegFailureStatus = await window.locator('#video-export-status').innerText();
    assert.match(ffmpegFailureStatus, /FFmpegが終了コード\d+で失敗しました。/);
    assert.match(ffmpegFailureStatus, /Unknown encoder 'cvideo_test_missing_encoder'/);
    assert.deepEqual(await fs.readFile(outputPath), previousVideo, 'FFmpeg failure should preserve the previous MP4');
    assert.equal(await fs.readFile(subtitlePath, 'utf8'), previousSubtitles, 'FFmpeg failure should preserve the previous SRT');

    const unavailableOutputParent = path.join(testDirectory, 'not-a-directory');
    await fs.writeFile(unavailableOutputParent, 'not a directory');
    const unavailableOutputPath = path.join(unavailableOutputParent, 'chapter.mp4');
    await app.evaluate((_electron, selectedPath) => { process.env.CVIDEO_TEST_VIDEO_EXPORT_PATH = selectedPath; }, unavailableOutputPath);
    assert.equal(
      await app.evaluate(() => process.env.CVIDEO_TEST_VIDEO_EXPORT_PATH),
      unavailableOutputPath,
      'Electron main process should receive the unwritable test output path',
    );
    await window.locator('#video-export-button').click();
    await window.waitForFunction(
      () => !document.querySelector('#video-export-button')?.disabled,
      null,
      { timeout: 30_000 },
    );
    const outputPreflightStatus = await window.locator('#video-export-status').innerText();
    assert.match(
      outputPreflightStatus,
      /保存先フォルダーに書き込めません。アクセス権と空き容量を確認し、別のフォルダーを選んでください。/,
      `unavailable output folder should be rejected before export: ${outputPreflightStatus}`,
    );
    assert.deepEqual(await fs.readFile(outputPath), previousVideo, 'unwritable destination should preserve the previous MP4');
    assert.equal(await fs.readFile(subtitlePath, 'utf8'), previousSubtitles, 'unwritable destination should preserve the previous SRT');
    await app.evaluate((_electron, selectedPath) => { process.env.CVIDEO_TEST_VIDEO_EXPORT_PATH = selectedPath; }, outputPath);

    const readAppMetrics = () => app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics().map((metric) => ({
      cpuPercent: Number(metric.cpu?.percentCPUUsage) || 0,
      workingSetKiB: Number(metric.memory?.workingSetSize) || 0,
    })));
    const resourceSamples = [await readAppMetrics()];
    const exportStartedAt = Date.now();
    const resourceSampler = setInterval(() => {
      void readAppMetrics().then((sample) => resourceSamples.push(sample)).catch(() => {});
    }, 500);
    await window.locator('#video-export-button').click();
    try {
      await window.waitForFunction(
        () => !document.querySelector('#video-export-button')?.disabled,
        null,
        { timeout: 120_000 },
      );
    } finally {
      clearInterval(resourceSampler);
    }
    resourceSamples.push(await readAppMetrics());
    const exportDurationMs = Date.now() - exportStartedAt;
    const peakCpuPercent = Math.max(...resourceSamples.map((sample) => sample.reduce((sum, metric) => sum + metric.cpuPercent, 0)));
    const peakWorkingSetMiB = Math.max(...resourceSamples.map((sample) => sample.reduce((sum, metric) => sum + metric.workingSetKiB, 0))) / 1024;
    assert.ok(exportDurationMs > 0, 'MP4 export duration should be measurable');
    assert.ok(resourceSamples.length >= 2, 'Electron process metrics should be sampled during export');
    const exportStatus = await window.locator('#video-export-status').innerText();
    assert.match(exportStatus, /MP4動画とSRT字幕を保存しました/, `MP4 export did not complete successfully: ${exportStatus}`);
    assert.match(await window.locator('.chapter-video-status').first().innerText(), /動画: 最新/);
    const subtitleOverwritePrompts = (await app.evaluate(() => globalThis.__videoExportOverwritePrompts))
      .filter((message) => message.includes('SRT'));
    assert.equal(subtitleOverwritePrompts.length, 5, 'each export should request SRT overwrite confirmation');
    const video = await fs.readFile(outputPath);
    const subtitles = await fs.readFile(subtitlePath, 'utf8');
    assert.ok(video.length > 20_000, `MP4 output is unexpectedly small: ${video.length} bytes`);
    assert.match(video.toString('latin1', 4, 8), /ftyp/);
    assert.ok(subtitles.includes(testDraft.chapters[0].subtitles[0].text), 'SRT should contain the exported chapter subtitle');
    const exportedCues = [...subtitles.matchAll(/^\d+\r?\n(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})\r?\n([\s\S]*?)(?=\r?\n\r?\n|$)/gm)];
    assert.equal(exportedCues.length, testDraft.chapters[0].subtitles.length, 'SRT cue count should match the saved chapter subtitles');
    for (const [index, cue] of exportedCues.entries()) {
      const expectedCue = testDraft.chapters[0].subtitles[index];
      assert.ok(Math.abs(srtTimeToSeconds(cue[1]) - expectedCue.startSeconds) <= 0.001, `SRT cue ${index + 1} start time should match the chapter timeline`);
      assert.ok(Math.abs(srtTimeToSeconds(cue[2]) - expectedCue.endSeconds) <= 0.001, `SRT cue ${index + 1} end time should match the chapter timeline`);
      assert.equal(cue[3].trim(), expectedCue.text, `SRT cue ${index + 1} text should match the chapter subtitle`);
    }
    assert.deepEqual(rendererErrors, [], 'renderer should not report console errors during MP4 export');

    const decode = spawnSync(dependency.path, [
      '-hide_banner', '-i', outputPath, '-f', 'null', '-',
    ], { encoding: 'utf8', timeout: 120_000, windowsHide: true });
    assert.equal(decode.status, 0, `FFmpeg could not decode exported MP4: ${decode.stderr}`);
    assert.match(decode.stderr, /Video: h264.*1920x1080.*30 fps/, 'MP4 should contain 1080p30 H.264 video');
    assert.match(decode.stderr, /Audio: aac.*48000 Hz/, 'MP4 should contain 48 kHz AAC audio');
    assert.match(decode.stderr, /Subtitle: mov_text/, 'MP4 should contain mov_text subtitles');
    const decodedDuration = decode.stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    assert.ok(decodedDuration, `FFmpeg should report the output duration: ${decode.stderr}`);
    const outputDurationSeconds = Number(decodedDuration[1]) * 3600 + Number(decodedDuration[2]) * 60 + Number(decodedDuration[3]);
    assert.ok(
      Math.abs(outputDurationSeconds - (creditStartSeconds + 3)) <= 1 / 30,
      `MP4 duration should match the real audio duration rounded to 30fps plus 3s credits: ${outputDurationSeconds}s`,
    );

    const completedVideo = await fs.readFile(outputPath);
    const completedSubtitles = await fs.readFile(subtitlePath, 'utf8');
    const narrationInput = window.locator('.chapter-narration').first();
    await narrationInput.fill(`${await narrationInput.inputValue()} 本文変更テスト。`);
    assert.match(await window.locator('.chapter-material-status').first().innerText(), /音声: 要更新/);
    assert.match(await window.locator('.chapter-video-status').first().innerText(), /動画: 要更新/);
    await window.locator('#scenario-confirm-button').click();
    await window.locator('#scenario-save-button').click();
    await window.getByText(/プロジェクトを保存しました/).waitFor({ timeout: 30_000 });
    await window.locator('#video-export-button').click();
    assert.equal(
      await window.locator('#video-export-status').innerText(),
      '読み上げ本文が変更されています。音声を再生成してください。',
      'changed narration must not reuse the stale audio element source',
    );
    const audioNextAction = await window.locator('.chapter-audio-generate').isDisabled()
      ? '#voicevox-connect-button'
      : '.chapter-audio-generate';
    assert.equal(
      await window.locator(audioNextAction).evaluate((button) => document.activeElement === button),
      true,
      'stale audio preflight should focus regeneration or VOICEVOX connection',
    );
    assert.deepEqual(await fs.readFile(outputPath), completedVideo, 'stale audio rejection should preserve the completed MP4');
    assert.equal(await fs.readFile(subtitlePath, 'utf8'), completedSubtitles, 'stale audio rejection should preserve the completed SRT');

    console.log(`MP4 export measurements: ${exportDurationMs} ms; peak Electron process-group CPU ${peakCpuPercent.toFixed(1)}%; peak summed working set ${peakWorkingSetMiB.toFixed(1)} MiB (${resourceSamples.length} samples; dedicated GPU memory not included).`);
    console.log(`Electron MP4 export passed${useLiveVoicevox ? ' with live VOICEVOX audio' : ''}: ${video.length} bytes, 1080p30 H.264, 48 kHz AAC, mov_text subtitles, ${subtitles.trim().split(/\r?\n\r?\n/).length} SRT cue(s), full FFmpeg decode succeeded.`);
  } finally {
    await app?.close();
    await stopProcess(viteServer?.server);
    if (keepArtifacts) console.log(`MP4/SRT test artifacts retained at: ${testDirectory}`);
    else await fs.rm(testDirectory, { recursive: true, force: true });
  }
}

async function writeCompletionReport(status, error = null) {
  const report = {
    status,
    exitCode: status === 'passed' ? 0 : 1,
    durationMs: Date.now() - testStartedAt,
    logs: capturedTestLogs,
    error: error ? {
      name: error.name ?? 'Error',
      message: error.message ?? String(error),
      stack: error.stack ?? null,
    } : null,
  };
  try {
    await fs.mkdir(path.dirname(resultFilePath), { recursive: true });
    await fs.writeFile(resultFilePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  } catch (reportError) {
    process.exitCode = 1;
    originalConsoleError(`Could not write E2E completion report: ${reportError instanceof Error ? reportError.message : reportError}`);
  }
}

main()
  .then(() => writeCompletionReport('passed'))
  .catch(async (error) => {
    process.exitCode = 1;
    console.error(error);
    await writeCompletionReport('failed', error);
  });