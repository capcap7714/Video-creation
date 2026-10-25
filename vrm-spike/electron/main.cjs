const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { loadChapterAudio, loadScenarioProject, saveChapterAudio, saveProjectModel, saveScenarioProject } = require('./project-store.cjs');
const { findGcc, runCProgram } = require('./c-runner.cjs');
const { checkFfmpeg } = require('./ffmpeg-service.cjs');
const { formatSrt } = require('./subtitle-export.cjs');
const { createVideoEncoder } = require('./video-export.cjs');
const { listSpeakers, synthesizeSpeech } = require('./voicevox-service.cjs');

const devUrl = process.env.CVIDEO_DEV_URL || 'http://127.0.0.1:5173';
const activeCExecutions = new Map();
const activeVideoExports = new Map();
const activeProjectDirectories = new Map();
let testVideoExportFailureInjected = false;
app.setPath('userData', path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'CVideoToolSpike'));

async function readScenarioAiProvider() {
  try {
    const settings = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'ai-provider-settings.json'), 'utf8'));
    return settings.provider === 'company-api' ? 'company-api' : 'copilot';
  } catch {
    return 'copilot';
  }
}

async function writeScenarioAiProvider(provider) {
  const directory = app.getPath('userData');
  const settingsPath = path.join(directory, 'ai-provider-settings.json');
  const temporaryPath = `${settingsPath}.${randomUUID()}.tmp`;
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(temporaryPath, JSON.stringify({ provider }), 'utf8');
    await fs.rename(temporaryPath, settingsPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('destroyed', () => {
    activeProjectDirectories.delete(contents.id);
    for (const [exportId, session] of activeVideoExports) {
      if (session.senderId === contents.id) {
        session.encoder.cancel();
        void session.encoder.finish().catch(() => {}).finally(() => fs.rm(session.workingDirectory, { recursive: true, force: true }));
        activeVideoExports.delete(exportId);
      }
    }
  });
});

function createTestWav() {
  const wav = Buffer.alloc(44 + 24000 * 2 * 4);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24);
  wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  return new Uint8Array(wav);
}

function createTestSubtitles(text) {
  const sentences = (text.match(/[^。！？!?]+[。！？!?]*|[。！？!?]+/gu) ?? [text])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const segmentDuration = 4 / sentences.length;
  return sentences.map((sentence, index) => ({
    startSeconds: Math.round((index * segmentDuration + 0.02) * 1000) / 1000,
    endSeconds: Math.round(((index + 1) * segmentDuration - 0.02) * 1000) / 1000,
    text: sentence,
  }));
}

async function checkOutputDirectoryWritable(directory) {
  let probeDirectory;
  try {
    probeDirectory = await fs.mkdtemp(path.join(directory, '.c-video-export-preflight-'));
    await fs.rm(probeDirectory, { recursive: true, force: true });
    return true;
  } catch {
    if (probeDirectory) await fs.rm(probeDirectory, { recursive: true, force: true }).catch(() => {});
    return false;
  }
}

ipcMain.handle('voicevox:list-speakers', async () => {
  if (process.env.NODE_ENV === 'test' && process.env.CVIDEO_TEST_VOICEVOX_MODE === 'offline') {
    return { connected: false, speakers: [], message: 'VOICEVOX Engineに接続できません。Engineを起動してから再試行してください。' };
  }
  if (process.env.NODE_ENV === 'test' && process.env.CVIDEO_TEST_VOICEVOX_MODE === 'empty-speakers') {
    return { connected: true, speakers: [] };
  }
  if (process.env.NODE_ENV === 'test' && process.env.CVIDEO_TEST_VOICEVOX_MODE === 'http-error') {
    return {
      connected: false,
      speakers: [],
      message: 'VOICEVOX Engineの応答を確認できません。Engineの状態を確認してください。',
    };
  }
  if (process.env.NODE_ENV === 'test' && process.env.CVIDEO_TEST_VOICEVOX_MODE === 'speakers') {
    return {
      connected: true,
      speakers: [{ name: 'テスト話者', styles: [{ name: 'ノーマル', id: 1 }, { name: '元気', id: 2 }] }],
    };
  }
  try {
    return { connected: true, speakers: await listSpeakers() };
  } catch (error) {
    return {
      connected: false,
      speakers: [],
      message: error instanceof Error ? error.message : 'VOICEVOX Engineに接続できません。',
    };
  }
});

ipcMain.handle('video:check-ffmpeg', async () => checkFfmpeg());

ipcMain.handle('scenario:get-ai-provider', async () => ({ provider: await readScenarioAiProvider() }));

ipcMain.handle('scenario:set-ai-provider', async (_event, provider) => {
  if (!['copilot', 'company-api'].includes(provider)) {
    return { saved: false, provider: await readScenarioAiProvider(), message: 'AIプロバイダーの選択を確認してください。' };
  }
  try {
    await writeScenarioAiProvider(provider);
    return { saved: true, provider };
  } catch {
    return { saved: false, provider: await readScenarioAiProvider(), message: 'AIプロバイダー設定を保存できませんでした。' };
  }
});

ipcMain.handle('video:export-start', async (event, payload = {}) => {
  if (!Number.isSafeInteger(payload.chapterIndex) || payload.chapterIndex < 0 || payload.chapterIndex >= 12) {
    return { started: false, message: '書き出す章を確認してください。' };
  }
  if ([...activeVideoExports.values()].some((session) => session.senderId === event.sender.id)) {
    return { started: false, message: 'この画面では既に動画を書き出しています。' };
  }
  const projectDirectory = activeProjectDirectories.get(event.sender.id);
  if (!projectDirectory) return { started: false, message: '先にプロジェクトを保存してください。' };

  const dependency = await checkFfmpeg();
  if (!dependency.available || !dependency.path) return { started: false, message: dependency.message };

  let chapter;
  let audio;
  try {
    const loaded = await loadScenarioProject(projectDirectory);
    chapter = loaded.draft.chapters[payload.chapterIndex];
    const storedAudio = await loadChapterAudio(projectDirectory, payload.chapterIndex);
    if (!chapter || !storedAudio || !chapter.audioAsset) {
      return { started: false, message: 'この章の保存済み音声がありません。音声を生成してプロジェクトを保存してください。' };
    }
    if (chapter.subtitles.some((subtitle) => subtitle.endSeconds > storedAudio.audioAsset.durationSeconds)) {
      return { started: false, message: '字幕が章音声の範囲を超えています。字幕時刻を修正してください。' };
    }
    audio = storedAudio.audio;
  } catch (error) {
    return { started: false, message: error instanceof Error ? error.message : '章素材を読み込めません。' };
  }

  let subtitles;
  try {
    subtitles = formatSrt(chapter.subtitles);
  } catch (error) {
    return { started: false, message: error instanceof Error ? error.message : '字幕を確認してください。' };
  }

  const owner = BrowserWindow.fromWebContents(event.sender);
  const chapterId = String(payload.chapterIndex + 1).padStart(2, '0');
  const testOutputPath = process.env.NODE_ENV === 'test' && process.env.CVIDEO_TEST_VIDEO_EXPORT_PATH;
  const selected = testOutputPath
    ? { canceled: false, filePath: testOutputPath }
    : await dialog.showSaveDialog(owner, {
      title: '章MP4を書き出す',
      defaultPath: `chapter-${chapterId}.mp4`,
      filters: [{ name: 'MP4動画', extensions: ['mp4'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
  if (selected.canceled || !selected.filePath) return { started: false, cancelled: true, message: '動画の書き出しをキャンセルしました。' };

  const outputPath = path.extname(selected.filePath).toLowerCase() === '.mp4'
    ? selected.filePath
    : `${selected.filePath}.mp4`;
  const subtitlePath = path.join(path.dirname(outputPath), `${path.parse(outputPath).name}.srt`);
  if (!await checkOutputDirectoryWritable(path.dirname(outputPath))) {
    return {
      started: false,
      message: '保存先フォルダーに書き込めません。アクセス権と空き容量を確認し、別のフォルダーを選んでください。',
    };
  }
  try {
    await fs.access(subtitlePath);
    const overwrite = await dialog.showMessageBox(owner, {
      type: 'warning',
      buttons: ['MP4とSRTを上書き', 'キャンセル'],
      defaultId: 1,
      cancelId: 1,
      message: '同名のSRT字幕ファイルがあります。MP4と一緒に上書きしますか？',
    });
    if (overwrite.response !== 0) return { started: false, cancelled: true, message: '動画の書き出しをキャンセルしました。' };
  } catch (error) {
    if (error?.code !== 'ENOENT') return { started: false, message: '保存先を確認できません。別のフォルダーを選んでください。' };
  }

  let workingDirectory;
  try {
    workingDirectory = await fs.mkdtemp(path.join(path.dirname(outputPath), '.c-video-export-'));
    const audioPath = path.join(workingDirectory, 'narration.wav');
    const subtitlesPath = path.join(workingDirectory, 'subtitles.srt');
    const temporaryOutputPath = path.join(workingDirectory, 'video.mp4');
    await Promise.all([
      fs.writeFile(audioPath, audio),
      fs.writeFile(subtitlesPath, subtitles, 'utf8'),
    ]);
    const encoder = createVideoEncoder({
      ffmpegPath: dependency.path,
      audioPath,
      subtitlesPath,
      outputPath: temporaryOutputPath,
      contentDurationSeconds: chapter.audioAsset.durationSeconds,
    });
    const exportId = randomUUID();
    const contentFrames = Math.ceil(chapter.audioAsset.durationSeconds * 30);
    const frameCount = contentFrames + 90;
    activeVideoExports.set(exportId, {
      senderId: event.sender.id,
      encoder,
      workingDirectory,
      outputPath,
      subtitlePath,
      subtitles,
      temporaryOutputPath,
      frameCount,
      nextFrame: 0,
    });
    return {
      started: true,
      exportId,
      frameCount,
      chapterTitle: chapter.title,
      contentDurationSeconds: chapter.audioAsset.durationSeconds,
      creditText: `VOICEVOX: ${chapter.audioAsset.speakerName ?? `話者スタイルID ${chapter.audioAsset.styleId}`}`,
      message: 'フレームを生成しています。',
    };
  } catch (error) {
    if (workingDirectory) await fs.rm(workingDirectory, { recursive: true, force: true });
    return { started: false, message: error instanceof Error ? `書き出しを開始できません: ${error.message}` : '書き出しを開始できません。' };
  }
});

ipcMain.handle('video:export-frame', async (event, payload = {}) => {
  const session = activeVideoExports.get(payload.exportId);
  if (!session || session.senderId !== event.sender.id || payload.frameIndex !== session.nextFrame) {
    return { written: false, message: '動画フレームの順序または書き出し状態が不正です。' };
  }
  if (process.env.NODE_ENV === 'test' && process.env.CVIDEO_TEST_VIDEO_EXPORT_FAIL_ONCE === '1' && !testVideoExportFailureInjected) {
    testVideoExportFailureInjected = true;
    return { written: false, message: 'テスト用のフレーム書き込みエラーです。' };
  }
  try {
    await session.encoder.writeFrame(payload.frame);
    session.nextFrame += 1;
    return { written: true, nextFrame: session.nextFrame };
  } catch (error) {
    return { written: false, message: error instanceof Error ? error.message : '動画フレームを書き込めません。' };
  }
});

ipcMain.handle('video:export-finish', async (event, payload = {}) => {
  const session = activeVideoExports.get(payload.exportId);
  if (!session || session.senderId !== event.sender.id) return { saved: false, message: '動画書き出しが見つかりません。' };
  if (session.nextFrame !== session.frameCount) {
    session.encoder.cancel();
    await session.encoder.finish().catch(() => {});
    activeVideoExports.delete(payload.exportId);
    await fs.rm(session.workingDirectory, { recursive: true, force: true });
    return { saved: false, message: '必要なフレームが揃わないため、動画を書き出せませんでした。' };
  }

  try {
    await session.encoder.finish();
    const subtitleTemporaryPath = path.join(session.workingDirectory, 'subtitles-final.srt');
    await fs.writeFile(subtitleTemporaryPath, session.subtitles, 'utf8');
    const replacements = [
      { temporary: session.temporaryOutputPath, destination: session.outputPath, backup: path.join(session.workingDirectory, 'previous.mp4') },
      { temporary: subtitleTemporaryPath, destination: session.subtitlePath, backup: path.join(session.workingDirectory, 'previous.srt') },
    ];
    const backups = [];
    const committed = [];
    try {
      for (const replacement of replacements) {
        try {
          await fs.rename(replacement.destination, replacement.backup);
          backups.push(replacement);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      }
      for (const replacement of replacements) {
        await fs.rename(replacement.temporary, replacement.destination);
        committed.push(replacement);
      }
    } catch (error) {
      for (const replacement of committed.reverse()) await fs.rm(replacement.destination, { force: true });
      for (const replacement of backups.reverse()) await fs.rename(replacement.backup, replacement.destination);
      throw error;
    }
    return { saved: true, message: 'MP4動画とSRT字幕を保存しました。', path: session.outputPath };
  } catch (error) {
    return { saved: false, message: error instanceof Error ? error.message : '動画を書き出せませんでした。' };
  } finally {
    activeVideoExports.delete(payload.exportId);
    await fs.rm(session.workingDirectory, { recursive: true, force: true });
  }
});

ipcMain.handle('video:export-cancel', async (event, exportId) => {
  const session = activeVideoExports.get(exportId);
  if (!session || session.senderId !== event.sender.id) return false;
  activeVideoExports.delete(exportId);
  session.encoder.cancel();
  try {
    await session.encoder.finish().catch(() => {});
  } finally {
    await fs.rm(session.workingDirectory, { recursive: true, force: true });
  }
  return true;
});

ipcMain.handle('voicevox:synthesize', async (_event, payload = {}) => {
  if (
    typeof payload.text !== 'string'
    || payload.text.trim().length === 0
    || payload.text.length > 1000
    || !Number.isSafeInteger(payload.styleId)
    || payload.styleId < 0
  ) {
    return { generated: false, message: '読み上げ文と話者を確認してください。' };
  }
  if (process.env.NODE_ENV === 'test' && process.env.CVIDEO_TEST_VOICEVOX_MODE === 'speakers') {
    return { generated: true, audio: createTestWav(), subtitles: createTestSubtitles(payload.text) };
  }
  try {
    return await synthesizeSpeech({ ...payload, text: payload.text.trim() })
      .then(({ audio, subtitles }) => ({ generated: true, audio, subtitles }));
  } catch (error) {
    return {
      generated: false,
      message: error instanceof Error ? error.message : '音声を生成できませんでした。',
    };
  }
});

ipcMain.handle('voicevox:save-chapter-audio', async (event, payload = {}) => {
  const projectDirectory = activeProjectDirectories.get(event.sender.id);
  if (!projectDirectory) return { saved: false, message: '先にプロジェクトを保存または開いてください。' };
  if (
    !Number.isSafeInteger(payload.chapterIndex)
    || payload.chapterIndex < 0
    || payload.chapterIndex >= 12
    || !(payload.audio instanceof Uint8Array)
    || payload.audio.byteLength > 50 * 1024 * 1024
    || typeof payload.narration !== 'string'
    || typeof payload.speakerName !== 'string'
    || payload.speakerName.trim().length === 0
    || payload.speakerName.length > 100
  ) {
    return { saved: false, message: '章音声の保存内容を確認してください。' };
  }
  try {
    const audioAsset = await saveChapterAudio(projectDirectory, payload.chapterIndex, payload.audio, {
      durationSeconds: payload.durationSeconds,
      styleId: payload.styleId,
      narration: payload.narration,
      speakerName: payload.speakerName,
    });
    return { saved: true, audioAsset };
  } catch {
    return { saved: false, message: '章音声をプロジェクトへ保存できませんでした。保存先の権限と章の内容を確認してください。' };
  }
});

ipcMain.handle('voicevox:load-chapter-audio', async (event, chapterIndex) => {
  const projectDirectory = activeProjectDirectories.get(event.sender.id);
  if (!projectDirectory) return null;
  try {
    return await loadChapterAudio(projectDirectory, chapterIndex);
  } catch {
    return null;
  }
});

ipcMain.handle('subtitle:export-srt', async (event, payload = {}) => {
  if (!Number.isSafeInteger(payload.chapterIndex) || payload.chapterIndex < 0 || payload.chapterIndex >= 12) {
    return { saved: false, message: '章を確認してください。' };
  }
  let contents;
  try {
    contents = formatSrt(payload.subtitles);
  } catch (error) {
    return { saved: false, message: error instanceof Error ? error.message : '字幕を確認してください。' };
  }

  const owner = BrowserWindow.fromWebContents(event.sender);
  const chapterId = String(payload.chapterIndex + 1).padStart(2, '0');
  const selected = await dialog.showSaveDialog(owner, {
    title: '字幕ファイルを保存',
    defaultPath: `chapter-${chapterId}.srt`,
    filters: [{ name: '字幕ファイル', extensions: ['srt'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  });
  if (selected.canceled || !selected.filePath) {
    return { saved: false, cancelled: true, message: '字幕の保存をキャンセルしました。' };
  }

  try {
    await fs.writeFile(selected.filePath, contents, { encoding: 'utf8' });
    return { saved: true, message: 'SRT字幕を保存しました。' };
  } catch {
    return { saved: false, message: '字幕を保存できません。保存先の書き込み権限を確認してください。' };
  }
});

ipcMain.handle('c-program:run', async (event, payload = {}) => {
  if (
    typeof payload.executionId !== 'string'
    || !/^[a-f0-9-]{36}$/i.test(payload.executionId)
    || typeof payload.source !== 'string'
    || payload.source.trim().length === 0
    || payload.source.length > 5000
    || typeof payload.stdin !== 'string'
    || Buffer.byteLength(payload.stdin, 'utf8') > 1024 * 1024
  ) {
    return { status: 'invalid-input', message: 'Cコードまたは実行設定を確認してください。' };
  }
  if (activeCExecutions.has(payload.executionId)) {
    return { status: 'already-running', message: 'このコードは既に実行中です。' };
  }
  const testExecutionFailures = {
    'compile-error': {
      status: 'compile-error',
      stderr: 'main.c:1: error: expected expression',
      message: 'Cコードのコンパイルに失敗しました。標準エラーに表示されたGCCの診断を確認してください。',
    },
    failed: {
      status: 'failed',
      exitCode: 7,
      message: 'プログラムが終了コード7で終了しました。',
    },
    timeout: {
      status: 'timeout',
      message: '実行が10秒でタイムアウトし、プロセスを停止しました。',
    },
    'output-limit': {
      status: 'output-limit',
      message: '標準出力と標準エラーの合計が1 MiBに達したため、プロセスを停止しました。',
    },
  };
  if (process.env.NODE_ENV === 'test' && testExecutionFailures[process.env.CVIDEO_TEST_C_RUNNER_MODE]) {
    return testExecutionFailures[process.env.CVIDEO_TEST_C_RUNNER_MODE];
  }
  if (process.env.NODE_ENV === 'test' && process.env.CVIDEO_TEST_C_RUNNER_MODE === 'result') {
    return {
      status: 'success',
      stdout: 'captured stdout\n',
      stderr: 'captured stderr\n',
      exitCode: 0,
    };
  }
  if (process.env.NODE_ENV === 'test' && process.env.CVIDEO_TEST_GCC_MISSING === '1') {
    return {
      status: 'compiler-missing',
      message: 'GCCが見つかりません。MSYS2を導入し、UCRT64ターミナルで「pacman -S --needed base-devel mingw-w64-ucrt-x86_64-toolchain」を実行してください。C:\\msys64\\ucrt64\\binをPATHに追加し、アプリを再起動してから再試行してください。',
    };
  }

  if (process.env.NODE_ENV === 'test' && process.env.CVIDEO_TEST_C_RUNNER_MODE === 'hang') {
    const controller = new AbortController();
    activeCExecutions.set(payload.executionId, controller);
    try {
      return await new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ status: 'timeout', message: 'テスト実行が終了しました。' }), 30_000);
        controller.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve({ status: 'stopped', message: '実行を停止しました。' });
        }, { once: true });
        if (!event.sender.isDestroyed()) {
          event.sender.send('c-program:output', {
            executionId: payload.executionId,
            stream: 'stdout',
            text: 'test process running\n',
          });
        }
      });
    } finally {
      activeCExecutions.delete(payload.executionId);
    }
  }

  const compilerPath = await findGcc();
  if (!compilerPath) {
    return {
      status: 'compiler-missing',
      message: 'GCCが見つかりません。MSYS2を導入し、UCRT64ターミナルで「pacman -S --needed base-devel mingw-w64-ucrt-x86_64-toolchain」を実行してください。C:\\msys64\\ucrt64\\binをPATHに追加し、アプリを再起動してから再試行してください。',
    };
  }

  const owner = BrowserWindow.fromWebContents(event.sender);
  const confirmation = await dialog.showMessageBox(owner, {
    type: 'warning',
    buttons: ['コンパイル・実行', 'キャンセル'],
    defaultId: 1,
    cancelId: 1,
    message: 'Cコードを現在のWindowsユーザー権限で実行します。OSレベルのサンドボックスには隔離されません。信頼できるコードだけ実行してください。',
  });
  if (confirmation.response !== 0) return { status: 'cancelled', message: '実行をキャンセルしました。' };

  const controller = new AbortController();
  activeCExecutions.set(payload.executionId, controller);
  try {
    return await runCProgram({
      source: payload.source,
      stdin: payload.stdin,
      compilerPath,
      signal: controller.signal,
      onOutput: (stream, text) => {
        if (!event.sender.isDestroyed()) event.sender.send('c-program:output', { executionId: payload.executionId, stream, text });
      },
    });
  } finally {
    activeCExecutions.delete(payload.executionId);
  }
});

ipcMain.handle('c-program:stop', (_event, executionId) => {
  const controller = activeCExecutions.get(executionId);
  if (!controller) return false;
  controller.abort();
  return true;
});

ipcMain.handle('scenario:generate', async (_event, payload = {}) => {
  const input = payload?.input;
  const previousDraft = payload?.previousDraft ?? null;
  let client;
  try {
    const { ScenarioRequestSchema, generateScenarioDraftSafely } = await import('../src/scenario.ts');
    if (!ScenarioRequestSchema.safeParse(input).success) {
      return await generateScenarioDraftSafely(null, input, previousDraft);
    }

    if (await readScenarioAiProvider() === 'company-api') {
      return {
        status: 'failed',
        input,
        draft: previousDraft,
        error: {
          kind: 'service-error',
          message: '会社APIは未接続です。Copilot SDKに切り替えるか、会社APIの接続実装後に再試行してください。下書きは保持されています。',
        },
        canRetry: false,
      };
    }

    const simulatedFailure = process.env.CVIDEO_TEST_SCENARIO_FAILURE;
    if (process.env.NODE_ENV === 'test' && ['network', 'rate-limit'].includes(simulatedFailure)) {
      const failure = simulatedFailure === 'rate-limit'
        ? Object.assign(new Error('provider request failed'), {
          data: { status: 429, message: 'simulated quota response' },
        })
        : Object.assign(new Error('simulated network failure'), { code: 'ECONNRESET' });
      const failingClient = {
        createSession: async () => ({
          sendAndWait: async () => { throw failure; },
          disconnect: async () => {},
        }),
      };
      return await generateScenarioDraftSafely(failingClient, input, previousDraft ?? null);
    }
    if (process.env.NODE_ENV === 'test' && process.env.CVIDEO_TEST_SCENARIO_SUCCESS === '1') {
      const { ScenarioDraftSchema } = await import('../src/scenario.ts');
      const generatedDraft = ScenarioDraftSchema.parse({
        title: input.title,
        chapters: [{
          title: '未確認の章',
          learningObjective: '確認前には既存内容を上書きしない。',
          targetMinutes: input.targetMinutes,
          narration: 'この内容はユーザー確認前の一時的な生成案です。',
          codeExample: null,
          runCode: false,
        }],
      });
      const testClient = {
        createSession: async () => ({
          sendAndWait: async () => generatedDraft,
          disconnect: async () => {},
        }),
      };
      return await generateScenarioDraftSafely(testClient, input, previousDraft ?? null);
    }

    const { CopilotClient } = await import('@github/copilot-sdk');
    client = new CopilotClient({ mode: 'copilot-cli', logLevel: 'error' });
    await client.start();
    return await generateScenarioDraftSafely(client, input, previousDraft ?? null);
  } catch {
    return {
      status: 'failed',
      input,
      draft: previousDraft ?? null,
      error: {
        kind: 'service-error',
        message: 'Copilotに接続できませんでした。ログイン状態を確認して再試行してください。下書きは保持されています。',
      },
      canRetry: true,
    };
  } finally {
    await client?.stop().catch(() => {});
  }
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 1000,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#e9eeea',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== devUrl && !url.startsWith(`${devUrl}/`)) event.preventDefault();
  });
  window.loadURL(devUrl);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('scenario:save', async (event, payload = {}) => {
  const { ScenarioDraftSchema, ScenarioRequestSchema } = await import('../src/scenario.ts');
  const requestResult = ScenarioRequestSchema.safeParse(payload?.request);
  const draftResult = ScenarioDraftSchema.safeParse(payload?.draft);
  if (!requestResult.success || !draftResult.success) {
    return { saved: false, message: '保存内容を確認できません。入力と章の内容を確認してください。' };
  }

  const owner = BrowserWindow.fromWebContents(event.sender);
  const selected = await dialog.showOpenDialog(owner, {
    title: 'プロジェクトの保存先を選択',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (selected.canceled || selected.filePaths.length === 0) {
    return { saved: false, cancelled: true, message: '保存をキャンセルしました。確認済みの内容は保持されています。' };
  }

  const projectPath = path.join(selected.filePaths[0], 'project.json');
  try {
    await fs.access(projectPath);
    const decision = await dialog.showMessageBox(owner, {
      type: 'warning',
      buttons: ['上書き保存', 'キャンセル'],
      defaultId: 1,
      cancelId: 1,
      message: '選択したフォルダーには既にproject.jsonがあります。上書きしますか？',
    });
    if (decision.response !== 0) {
      return { saved: false, cancelled: true, message: '上書きをキャンセルしました。確認済みの内容は保持されています。' };
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      return { saved: false, message: '保存先を確認できません。別のフォルダーを選んでください。' };
    }
  }

  try {
    const savedPath = await saveScenarioProject(selected.filePaths[0], requestResult.data, draftResult.data);
    activeProjectDirectories.set(event.sender.id, selected.filePaths[0]);
    return { saved: true, path: savedPath, message: 'プロジェクトを保存しました。' };
  } catch {
    return {
      saved: false,
      message: '保存できませんでした。フォルダーの書き込み権限と空き容量を確認し、再試行してください。',
    };
  }
});

ipcMain.handle('scenario:auto-save', async (event, payload = {}) => {
  const projectDirectory = activeProjectDirectories.get(event.sender.id);
  if (!projectDirectory) {
    return { saved: false, unavailable: true, message: '自動保存先がありません。先にプロジェクトを保存してください。' };
  }

  const { ScenarioDraftSchema, ScenarioRequestSchema } = await import('../src/scenario.ts');
  const requestResult = ScenarioRequestSchema.safeParse(payload?.request);
  const draftResult = ScenarioDraftSchema.safeParse(payload?.draft);
  if (!requestResult.success || !draftResult.success) {
    return { saved: false, invalid: true, message: '入力が未完成のため自動保存できません。必須項目を確認してください。' };
  }

  try {
    const savedPath = await saveScenarioProject(projectDirectory, requestResult.data, draftResult.data);
    return { saved: true, path: savedPath, message: '自動保存しました。' };
  } catch {
    return { saved: false, message: '自動保存に失敗しました。保存先の権限と空き容量を確認してください。' };
  }
});

ipcMain.handle('scenario:save-model', async (event, payload = {}) => {
  const projectDirectory = activeProjectDirectories.get(event.sender.id);
  if (!projectDirectory) {
    return { saved: false, unavailable: true, message: '先にプロジェクトを保存または開いてください。' };
  }
  if (!(payload.bytes instanceof Uint8Array) || typeof payload.fileName !== 'string') {
    return { saved: false, message: 'VRMモデルを確認してください。' };
  }

  try {
    const modelAsset = await saveProjectModel(projectDirectory, payload.fileName, payload.bytes);
    return { saved: true, modelAsset: { fileName: modelAsset.fileName } };
  } catch {
    return { saved: false, message: 'VRMモデルをプロジェクトへコピーできませんでした。保存先の空き容量と権限を確認してください。' };
  }
});

ipcMain.handle('scenario:open', async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const selected = await dialog.showOpenDialog(owner, {
    title: 'プロジェクトを開く',
    properties: ['openDirectory'],
  });
  if (selected.canceled || selected.filePaths.length === 0) {
    return { opened: false, cancelled: true, message: 'プロジェクトを開く操作をキャンセルしました。' };
  }

  try {
    const { ScenarioDraftSchema, ScenarioRequestSchema } = await import('../src/scenario.ts');
    const stored = await loadScenarioProject(selected.filePaths[0]);
    const requestResult = ScenarioRequestSchema.safeParse(stored.request);
    const draftResult = ScenarioDraftSchema.safeParse(stored.draft);
    if (!requestResult.success || !draftResult.success) {
      return { opened: false, message: 'プロジェクトの内容が現在のシナリオ形式に合いません。' };
    }
    activeProjectDirectories.set(event.sender.id, selected.filePaths[0]);
    return {
      opened: true,
      request: requestResult.data,
      draft: draftResult.data,
      recoveredFromInterruptedSave: stored.recoveredFromInterruptedSave,
      modelAsset: stored.modelAsset,
      modelAssetMissing: stored.modelAssetMissing,
    };
  } catch (error) {
    if (['PROJECT_SAVE_RECOVERY_INVALID', 'PROJECT_SAVE_RECOVERY_FAILED'].includes(error.code)) {
      return {
        opened: false,
        message: '保存中断から復旧できませんでした。プロジェクトフォルダー内のファイルを削除せず、管理者に確認してください。',
      };
    }
    return {
      opened: false,
      message: 'プロジェクトを読み込めません。project.jsonと章ファイルの形式、読み取り権限を確認してください。',
    };
  }
});