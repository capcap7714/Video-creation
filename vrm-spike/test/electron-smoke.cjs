const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const withScenarioGeneration = process.argv.includes('--with-scenario-generation');
const withAiProviderSettings = process.argv.includes('--with-ai-provider-settings');
const withProjectFixture = process.argv.includes('--with-project-fixture');
const withProjectOpenFixture = process.argv.includes('--with-project-open-fixture');
const withAutosaveFixture = process.argv.includes('--with-autosave-fixture');
const withFailureFixture = process.argv.includes('--with-failure-fixture');
const withRateLimitFixture = process.argv.includes('--with-rate-limit-fixture');
const withCRunnerFixture = process.argv.includes('--with-c-runner-fixture');
const withCResultFixture = process.argv.includes('--with-c-result-fixture');
const withCErrorFixture = process.argv.includes('--with-c-error-fixture');
const withCStopFixture = process.argv.includes('--with-c-stop-fixture');
const withVoicevoxFixture = process.argv.includes('--with-voicevox-fixture');
const withVoicevoxOfflineFixture = process.argv.includes('--with-voicevox-offline-fixture');
const withVoicevoxEmptySpeakersFixture = process.argv.includes('--with-voicevox-empty-speakers-fixture');
const withAudioReplacementFixture = process.argv.includes('--with-audio-replacement-fixture');
const withFfmpegMissingFixture = process.argv.includes('--with-ffmpeg-missing-fixture');
const withFfmpegAvailableFixture = process.argv.includes('--with-ffmpeg-available-fixture');
const withChapterManagementFixture = process.argv.includes('--with-chapter-management-fixture');
const withTimelineMarkerFixture = process.argv.includes('--with-timeline-marker-fixture');
const withCharacterActionFixture = process.argv.includes('--with-character-action-fixture');
const withMissingSubtitleFixture = process.argv.includes('--with-missing-subtitle-fixture');
const withInvalidVrmFixture = process.argv.includes('--with-invalid-vrm-fixture');
const withLiveVoicevox = process.argv.includes('--with-live-voicevox');
const projectStore = require('../electron/project-store.cjs');

const fixtureRequest = {
  title: 'C言語の保存テスト',
  overview: '変数の宣言と代入を学ぶための確認用教材です。',
  audience: '初学者',
  chapterCount: 1,
  targetMinutes: 3,
};
const fixtureDraft = {
  title: fixtureRequest.title,
  chapters: [{
    title: '変数を使う',
    learningObjective: '変数を宣言して値を代入できる。',
    targetMinutes: 3,
    narration: '変数は値を保存する名前付きの場所です。型を宣言し、代入して使います。',
    codeExample: '#include <stdio.h>\nint main(void) { puts("C17 ready"); return 0; }',
    runInput: '80\n',
    codeDisplayMode: 'staged',
    codeStages: [{ atSeconds: 0, visibleLines: 1 }, { atSeconds: 1, visibleLines: 2 }],
    subtitles: [{ startSeconds: 1, endSeconds: 2, text: '変数を宣言します。' }],
    runCode: true,
  }],
};

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
  let app;
  let projectDirectory;
  let viteServer;
  let aiProviderToRestore;

  try {
    if (withProjectFixture || withProjectOpenFixture || withAutosaveFixture || withFailureFixture || withRateLimitFixture || withCRunnerFixture || withCResultFixture || withCStopFixture || withCErrorFixture || withVoicevoxFixture || withAudioReplacementFixture || withLiveVoicevox || withMissingSubtitleFixture) {
      projectDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'c-video-project-ui-'));
      await projectStore.saveScenarioProject(projectDirectory, fixtureRequest, fixtureDraft);
    }
    viteServer = await startViteServer();
    app = await electron.launch({
      executablePath: require('electron'),
      args: [path.resolve(__dirname, '../electron/main.cjs')],
      env: {
        ...process.env,
        CVIDEO_DEV_URL: `${viteServer.url}/?cvideo_test_frame=1`,
        ...(withFailureFixture || withRateLimitFixture || withCRunnerFixture || withCResultFixture || withCStopFixture || withCErrorFixture || withVoicevoxFixture || withVoicevoxOfflineFixture || withVoicevoxEmptySpeakersFixture || withAudioReplacementFixture || withFfmpegMissingFixture || withFfmpegAvailableFixture || withMissingSubtitleFixture
          ? {
          NODE_ENV: 'test',
          CVIDEO_TEST_SCENARIO_FAILURE: withRateLimitFixture ? 'rate-limit' : withFailureFixture ? 'network' : '',
          CVIDEO_TEST_GCC_MISSING: withCRunnerFixture ? '1' : '0',
          CVIDEO_TEST_C_RUNNER_MODE: withCErrorFixture ? 'compile-error' : withCStopFixture ? 'hang' : withCResultFixture ? 'result' : '',
          CVIDEO_TEST_VOICEVOX_MODE: withVoicevoxOfflineFixture
            ? 'offline'
            : withVoicevoxEmptySpeakersFixture
              ? 'empty-speakers'
              : withVoicevoxFixture || withAudioReplacementFixture || withMissingSubtitleFixture ? 'speakers' : '',
          ...(withFfmpegMissingFixture ? { CVIDEO_FFMPEG_PATH: path.join(os.tmpdir(), 'cvideo-test-missing-ffmpeg.exe') } : {}),
          }
          : {}),
      },
    });
    console.log('Electron launched');

    let window = await app.firstWindow();
    const consoleErrors = [];
    window.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    window.on('pageerror', (error) => consoleErrors.push(error.message));
    await window.waitForLoadState('load');
    console.log(`Window ready: ${window.url()}`);

    const invalidScenario = await window.evaluate(async () => {
      if (typeof window.scenarioApi?.generate !== 'function') return null;
      const invalidInput = { title: '', overview: '', targetMinutes: 0 };
      return {
        generation: await window.scenarioApi.generate(invalidInput, null),
        save: await window.scenarioApi.save(invalidInput, null),
      };
    });
    assert.equal(invalidScenario?.generation.status, 'failed', 'preload should expose scenario generation IPC');
    assert.equal(invalidScenario?.generation.error.kind, 'invalid-input');
    assert.equal(invalidScenario?.generation.canRetry, false);
    assert.equal(invalidScenario?.save.saved, false, 'invalid project data should be rejected before opening a dialog');
    const invalidCProgram = await window.evaluate(() => window.cProgramApi.run('invalid', '', ''));
    assert.equal(invalidCProgram?.status, 'invalid-input', 'C execution IPC should reject invalid requests');
    const invalidVoicevoxRequest = await window.evaluate(() => window.voicevoxApi.synthesize('', -1));
    assert.equal(invalidVoicevoxRequest?.generated, false, 'VOICEVOX IPC should reject invalid synthesis input');
    let initialScenarioTitle;
    try {
      initialScenarioTitle = await window.locator('#scenario-title').inputValue({ timeout: 10_000 });
    } catch (error) {
      const pageState = await window.evaluate(() => ({
        title: document.title,
        body: document.body?.innerText.slice(0, 500),
        hasScenarioForm: Boolean(document.querySelector('#scenario-request-form')),
        hasScenarioTitle: Boolean(document.querySelector('#scenario-title')),
        hasRendererEntry: Boolean(document.querySelector('script[type="module"]')),
      })).catch((evaluationError) => ({ evaluationError: evaluationError.message }));
      throw new Error(`Electron UI did not initialize: ${JSON.stringify({ pageState, consoleErrors })}; ${error.message}`);
    }
    assert.equal(initialScenarioTitle, 'C言語の変数入門');
    console.log('Scenario preload and input-validation IPC passed');

    if (withAiProviderSettings) {
      await window.waitForFunction(() => !document.querySelector('#scenario-ai-provider').disabled);
      aiProviderToRestore = (await window.evaluate(() => window.scenarioApi.getAiProvider())).provider;
      assert.ok(['copilot', 'company-api'].includes(aiProviderToRestore));
      await window.locator('#scenario-ai-provider').selectOption('company-api');
      await window.getByText('会社APIは未接続です。生成は停止中です。', { exact: true }).waitFor();
      assert.equal(await window.locator('#scenario-generate-button').isDisabled(), true);
      const blockedOutcome = await window.evaluate((request) => window.scenarioApi.generate(request, null), fixtureRequest);
      assert.equal(blockedOutcome.status, 'failed');
      assert.equal(blockedOutcome.error.kind, 'service-error');
      assert.equal(blockedOutcome.canRetry, false);
      assert.match(blockedOutcome.error.message, /会社APIは未接続/);

      await app.close();
      app = await electron.launch({
        executablePath: require('electron'),
        args: [path.resolve(__dirname, '../electron/main.cjs')],
        env: {
          ...process.env,
          CVIDEO_DEV_URL: `${viteServer.url}/?cvideo_test_frame=1`,
        },
      });
      window = await app.firstWindow();
      window.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      window.on('pageerror', (error) => consoleErrors.push(error.message));
      await window.waitForLoadState('load');
      await window.waitForFunction(() => !document.querySelector('#scenario-ai-provider').disabled);
      assert.equal(await window.locator('#scenario-ai-provider').inputValue(), 'company-api');
      await window.getByText('会社APIは未接続です。生成は停止中です。', { exact: true }).waitFor();

      await window.locator('#scenario-ai-provider').selectOption('copilot');
      await window.getByText('Copilot SDKでシナリオを生成します。', { exact: true }).waitFor();
      assert.equal(await window.locator('#scenario-generate-button').isEnabled(), true);
      assert.deepEqual(await window.evaluate(() => window.scenarioApi.getAiProvider()), { provider: 'copilot' });
      console.log('Scenario AI provider selection, restart persistence, and unconfigured-provider blocking passed');
    }

    if (withInvalidVrmFixture) {
      await window.locator('#model-file').setInputFiles({
        name: 'broken.vrm',
        mimeType: 'model/gltf-binary',
        buffer: Buffer.from('not a VRM or GLB file'),
      });
      const loadGuidance = 'VRMモデルを読み込めませんでした。VRM 1.0形式で破損していないファイルを選び直して再試行してください。';
      await window.getByText(loadGuidance, { exact: true }).waitFor({ timeout: 15_000 });
      assert.equal(await window.locator('#runtime-status').innerText(), '読み込み失敗');
      assert.equal(await window.locator('#runtime-status').getAttribute('data-state'), 'error');
      assert.equal(await window.locator('#video-export-button').isDisabled(), true);
      assert.equal(await window.locator('#capture-button').isDisabled(), true);
      console.log('Invalid VRM input showed actionable retry guidance and kept export disabled');
      return;
    }

    if (withVoicevoxOfflineFixture || withVoicevoxEmptySpeakersFixture) {
      await window.locator('#voicevox-connect-button').click();
      const expectedStatus = withVoicevoxOfflineFixture
        ? 'VOICEVOX Engineに接続できません。Engineを起動してから再試行してください。'
        : 'VOICEVOX Engineには接続しましたが、有効な話者スタイルがありません。Engineの話者設定を確認して再試行してください。';
      await window.getByText(expectedStatus, { exact: true }).waitFor({ timeout: 15_000 });
      assert.equal(await window.locator('#voicevox-status').getAttribute('data-state'), withVoicevoxOfflineFixture ? 'error' : 'warning');
      assert.equal(await window.locator('#voicevox-style').isDisabled(), true);
      assert.equal(await window.locator('#voicevox-generate-button').isDisabled(), true);
      assert.equal(await window.locator('#voicevox-connect-button').isEnabled(), true, 'retry should remain available');
      await window.locator('#voicevox-connect-button').click();
      await window.getByText(expectedStatus, { exact: true }).waitFor({ timeout: 15_000 });
      console.log(withVoicevoxOfflineFixture
        ? 'VOICEVOX unavailable state explains how to start/retry the Engine'
        : 'VOICEVOX empty speaker list is distinct from connection failure and supports retry');
      return;
    }

    if (withFfmpegMissingFixture) {
      await window.locator('#ffmpeg-check-button').click();
      await window.getByText('FFmpegのエンコーダー一覧を取得できません。実行権限とインストール状態を確認してください。', { exact: true }).waitFor({ timeout: 15_000 });
      assert.equal(await window.locator('#ffmpeg-status').getAttribute('data-state'), 'missing');
      console.log('FFmpeg verification UI reported the missing external executable');
      return;
    }

    if (withFfmpegAvailableFixture) {
      await window.locator('#ffmpeg-check-button').click();
      await window.getByText('FFmpegとH.264/AACエンコーダーを確認しました。', { exact: true }).waitFor({ timeout: 15_000 });
      assert.equal(await window.locator('#ffmpeg-status').getAttribute('data-state'), 'ready');
      assert.match(await window.locator('#ffmpeg-status').getAttribute('title'), /ffmpeg\.exe$/i);
      console.log('FFmpeg verification UI detected the installed PATH executable and required encoders');
      return;
    }

    if (withChapterManagementFixture) {
      const chapterFixture = {
        title: fixtureDraft.title,
        chapters: [
          fixtureDraft.chapters[0],
          { ...fixtureDraft.chapters[0], title: '計算結果を表示する' },
        ],
      };
      await window.evaluate((draft) => window.__cvideoTestLoadScenarioDraft(draft), chapterFixture);
      const chapterTitles = () => window.locator('.chapter-title').evaluateAll((inputs) => inputs.map((input) => input.value));
      assert.deepEqual(await chapterTitles(), ['変数を使う', '計算結果を表示する']);
      await window.locator('[data-chapter-action="move-up"]').nth(1).click();
      assert.deepEqual(await chapterTitles(), ['計算結果を表示する', '変数を使う']);
      assert.equal(await window.locator('#scenario-review-state').innerText(), '未確認の変更');
      assert.equal(await window.locator('#scenario-save-button').isDisabled(), true);

      await window.evaluate(() => { window.confirm = () => false; });
      await window.locator('[data-chapter-action="remove"]').first().click();
      assert.equal(await window.locator('.chapter-title').count(), 2, 'declining deletion should preserve both chapters');
      await window.evaluate(() => { window.confirm = () => true; });
      await window.locator('[data-chapter-action="remove"]').first().click();
      assert.deepEqual(await chapterTitles(), ['変数を使う']);
      assert.equal(await window.locator('[data-chapter-action="remove"]').isDisabled(), true);

      await window.locator('#chapter-add-button').click();
      assert.deepEqual(await chapterTitles(), ['変数を使う', '新しい章']);
      assert.equal(await window.locator('#scenario-chapter-count').inputValue(), '2');
      assert.match(await window.locator('.chapter-material-status').nth(1).innerText(), /動画: 状態未確認/);
      for (let index = 2; index < 12; index += 1) await window.locator('#chapter-add-button').click();
      assert.equal(await window.locator('.chapter-title').count(), 12);
      assert.equal(await window.locator('#chapter-add-button').isDisabled(), true);
      await window.locator('#scenario-confirm-button').click();
      assert.equal(await window.locator('#scenario-review-state').innerText(), '確認済み');
      assert.equal(await window.locator('#scenario-save-button').isEnabled(), true);
      console.log('Chapter add, reorder, delete confirmation, 12-chapter limit, and review gating passed');
      return;
    }

    if (withTimelineMarkerFixture) {
      const timelineDraft = {
        title: fixtureDraft.title,
        chapters: [{
          ...fixtureDraft.chapters[0],
          codeStages: [{ atSeconds: 0, visibleLines: 1 }, { atSeconds: 4, visibleLines: 2 }],
          subtitles: [{ startSeconds: 7, endSeconds: 8, text: '字幕マーカーを選びました。' }],
          executionAtSeconds: 6.5,
          characterActions: [
            { atSeconds: 2, action: 'explain' },
            { atSeconds: 5, action: 'attention' },
          ],
          executionResult: {
            status: 'success',
            stdout: '80\n',
            stderr: '',
            exitCode: 0,
            videoText: '80\n',
            sourceCode: fixtureDraft.chapters[0].codeExample,
            sourceInput: fixtureDraft.chapters[0].runInput,
          },
        }],
      };
      await window.evaluate((draft) => window.__cvideoTestLoadScenarioDraft(draft), timelineDraft);
      assert.equal(await window.locator('.timeline-marker[data-kind="code-stage"]').count(), 2);
      assert.equal(await window.locator('.timeline-marker[data-kind="subtitle"]').count(), 1);
      assert.equal(await window.locator('.timeline-marker[data-kind="execution"]').count(), 1);
      assert.equal(await window.locator('.timeline-marker[data-kind="character-action"]').count(), 2);
      assert.equal(await window.locator('.execution-time').inputValue(), '6.5');

      await window.locator('.timeline-marker[data-kind="code-stage"]').nth(1).click();
      assert.ok(Math.abs(Number(await window.locator('#timeline').inputValue()) - 4) < 0.02);
      assert.equal(await window.locator('.staged-code-preview').innerText(), fixtureDraft.chapters[0].codeExample);
      assert.equal(await window.locator('#video-result-preview').isHidden(), true);

      await window.locator('.timeline-marker[data-kind="execution"]').click();
      assert.ok(Math.abs(Number(await window.locator('#timeline').inputValue()) - 6.5) < 0.02);
      assert.equal(await window.locator('#video-result-preview').innerText(), '80');

      await window.locator('.timeline-marker[data-kind="character-action"]').nth(1).click();
      assert.ok(Math.abs(Number(await window.locator('#timeline').inputValue()) - 5) < 0.02);
      assert.equal(await window.evaluate(() => window.__cvideoTestGetCharacterActionAt?.(5)?.action), 'attention');

      await window.locator('.timeline-marker[data-kind="subtitle"]').click();
      assert.ok(Math.abs(Number(await window.locator('#timeline').inputValue()) - 7) < 0.02);
      assert.equal(await window.locator('#subtitle-preview').innerText(), '字幕マーカーを選びました。');
      console.log('Timeline code-stage, execution, character-action, and subtitle markers seek and update the preview');
      return;
    }

    if (withVoicevoxFixture || withAudioReplacementFixture || withLiveVoicevox || withMissingSubtitleFixture) {
      await window.locator('#voicevox-connect-button').click();
      if (withLiveVoicevox) {
        await window.getByText(/^接続しました。\d+種類のスタイルを利用できます。$/).waitFor({ timeout: 30000 });
        const firstStyleId = await window.locator('#voicevox-style option').first().getAttribute('value');
        assert.ok(firstStyleId, 'live VOICEVOX Engine should expose at least one style');
        await window.locator('#voicevox-style').selectOption(firstStyleId);
      } else {
        await window.getByText('接続しました。2種類のスタイルを利用できます。', { exact: true }).waitFor();
        assert.equal(await window.locator('#voicevox-style option').count(), 2);
        await window.locator('#voicevox-style').selectOption('2');
      }
      await window.locator('#voicevox-generate-button').click();
      await window.getByText('試聴音声を生成しました。再生ボタンで確認できます。', { exact: true }).waitFor();
      assert.equal(await window.locator('#voicevox-audio').isVisible(), true);
      assert.match(await window.locator('#voicevox-audio').getAttribute('src'), /^blob:/);
      await window.waitForFunction(() => {
        const audio = document.querySelector('#voicevox-audio');
        return audio && audio.readyState >= 1 && Number.isFinite(audio.duration) && audio.duration > 0;
      }, null, { timeout: 30000 });
      console.log(withLiveVoicevox
        ? 'Live VOICEVOX speaker selection and WAV preview generation passed'
        : 'VOICEVOX speaker selection and WAV preview generation passed');
    }

    if (withScenarioGeneration) {
      await window.locator('#scenario-generate-button').click();
      await window.getByText('確認待ち', { exact: true }).waitFor({ timeout: 180000 });
      assert.equal(await window.locator('#scenario-editor fieldset').count(), 2);
      assert.equal(await window.locator('#scenario-confirm-button').isEnabled(), true);

      const scenarioTitle = window.locator('#scenario-title');
      await scenarioTitle.fill('C言語の変数入門・確認テスト');
      assert.equal(await window.locator('#scenario-review-state').innerText(), '未確認の変更');
      await window.locator('#scenario-confirm-button').click();
      assert.equal(await window.locator('#scenario-review-state').innerText(), '確認済み');
      assert.match(await window.locator('#scenario-message').innerText(), /プロジェクト保存はまだ行われていません/);

      await window.screenshot({
        path: path.resolve(__dirname, '../test-results/scenario-review.png'),
        fullPage: true,
      });
      console.log('Scenario generation, manual edit, and review confirmation passed');
    }

    if (withProjectFixture || withProjectOpenFixture || withAutosaveFixture || withAudioReplacementFixture || withMissingSubtitleFixture) {
      console.log('Preparing project dialog fixture');
      const dialogsPatched = await app.evaluate(({ dialog }, selectedPath) => {
        const showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
        const showMessageBox = async () => ({ response: 0 });
        const showSaveDialog = async (_owner, options) => ({
          canceled: false,
          filePath: `${selectedPath}\\captions-${String(options.defaultPath).match(/chapter-(\d+)\.srt/)?.[1] ?? '01'}.srt`,
        });
        dialog.showOpenDialog = showOpenDialog;
        dialog.showMessageBox = showMessageBox;
        dialog.showSaveDialog = showSaveDialog;
        return dialog.showOpenDialog === showOpenDialog
          && dialog.showMessageBox === showMessageBox
          && dialog.showSaveDialog === showSaveDialog;
      }, projectDirectory);
      assert.equal(dialogsPatched, true, 'Electron dialog methods should be replaceable for integration testing');

      console.log('Opening project fixture');
      await window.locator('#scenario-open-button').click();
      await window.waitForFunction(() => {
        const reviewState = document.querySelector('#scenario-review-state')?.textContent;
        const message = document.querySelector('#scenario-message')?.textContent ?? '';
        return reviewState === '再確認が必要' || message.includes('プロジェクトを開けません');
      }, null, { timeout: 30000 });
      assert.equal(
        await window.locator('#scenario-review-state').innerText(),
        '再確認が必要',
        `project fixture should open successfully: ${await window.locator('#scenario-message').innerText()}`,
      );
      assert.equal(await window.locator('#scenario-title').inputValue(), fixtureDraft.title);
      assert.equal(await window.locator('#scenario-editor fieldset').count(), 1);
      if (withProjectOpenFixture) {
        assert.equal(await window.locator('#scenario-confirm-button').isEnabled(), true);
        assert.equal(await window.locator('#scenario-save-button').isDisabled(), true);
        console.log('Project open restored the draft and required user review before saving');
        return;
      }
      if (withAutosaveFixture) {
        const chapterPath = path.join(projectDirectory, 'chapters', '01', 'scenario.json');
        const updatedNarration = '自動保存の動作を確認するために、この章の解説本文を編集しました。';
        await window.locator('.chapter-narration').fill(updatedNarration);
        await window.getByText('自動保存済み', { exact: true }).waitFor({ timeout: 15_000 });
        assert.equal(JSON.parse(await fs.readFile(chapterPath, 'utf8')).narration, updatedNarration);

        const updatedTitle = 'Ctrl+S即時保存テスト';
        await window.locator('#scenario-title').fill(updatedTitle);
        await window.keyboard.press('Control+s');
        await window.getByText('自動保存済み', { exact: true }).waitFor({ timeout: 15_000 });
        assert.equal(JSON.parse(await fs.readFile(path.join(projectDirectory, 'project.json'), 'utf8')).title, updatedTitle);
        assert.equal(JSON.parse(await fs.readFile(chapterPath, 'utf8')).title, fixtureDraft.chapters[0].title);
        console.log('Debounced edit autosave and Ctrl+S immediate persistence passed');
        return;
      }
      if (withMissingSubtitleFixture) {
        await window.locator('.scenario-checkbox input').uncheck();
        await window.locator('#scenario-confirm-button').click();
        await window.locator('#scenario-save-button').click();
        await window.getByText(/プロジェクトを保存しました/).waitFor({ timeout: 30000 });
      }
      if (withVoicevoxFixture || withAudioReplacementFixture || withLiveVoicevox || withMissingSubtitleFixture) {
        await window.evaluate(() => { window.confirm = () => true; });
        await window.locator('.chapter-audio-generate').click();
        try {
          await window.getByText(/^音声を保存しました（\d+\.\d+秒）。/)
            .waitFor({ timeout: withLiveVoicevox ? 30000 : 120000 });
        } catch (error) {
          if (!withLiveVoicevox) throw error;
          throw new Error(`Live chapter audio save status: ${await window.locator('.chapter-audio-status').innerText()}`);
        }
        console.log(`Chapter audio save status: ${await window.locator('.chapter-audio-status').innerText()}`);
        assert.equal(await window.locator('.chapter-audio').isVisible(), true);
        assert.match(await window.locator('.chapter-audio').getAttribute('src'), /^blob:/);
        assert.equal(await window.locator('.subtitle-row').count(), 2);
        assert.equal(await window.locator('.subtitle-text').first().inputValue(), '変数は値を保存する名前付きの場所です。');
        if (!withAudioReplacementFixture) {
          await window.waitForFunction(() => Number.isFinite(document.querySelector('.chapter-audio')?.duration)
            && document.querySelector('.chapter-audio').duration > 0, null, { timeout: 30000 });
        }
        if (withAudioReplacementFixture) {
          const audioPath = path.join(projectDirectory, 'chapters', '01', 'audio', 'narration.wav');
          const chapterPath = path.join(projectDirectory, 'chapters', '01', 'scenario.json');
          const previousAudio = await fs.readFile(audioPath);
          const previousAudioAsset = JSON.parse(await fs.readFile(chapterPath, 'utf8')).audioAsset;
          await window.getByText('字幕タイミング: 本文と一致', { exact: true }).waitFor();
          await window.locator('.subtitle-text').first().fill('手動編集した字幕を保持します。');
          const preservedSubtitles = await window.locator('.subtitle-row').evaluateAll((rows) => rows.map((row) => ({
            startSeconds: Number(row.querySelector('.subtitle-start').value),
            endSeconds: Number(row.querySelector('.subtitle-end').value),
            text: row.querySelector('.subtitle-text').value,
          })));
          const updatedNarration = `${fixtureDraft.chapters[0].narration} 再生成確認。`;
          await window.locator('.chapter-narration').fill(updatedNarration);
          await window.getByText('字幕タイミング: 要確認（読み上げ本文が変更されています）', { exact: true }).waitFor();
          assert.match(await window.locator('.chapter-material-status').first().innerText(), /音声: 要更新/);
          assert.match(await window.locator('.chapter-material-status').first().innerText(), /動画: 要更新/);
          await window.evaluate(() => {
            window.__audioReplacementPrompts = [];
            window.confirm = (message) => {
              window.__audioReplacementPrompts.push(message);
              return false;
            };
          });
          await window.locator('.chapter-audio-generate').click();
          await window.getByText('音声の再生成をキャンセルしました。保存済み音声は保持されています。', { exact: true }).waitFor();
          assert.deepEqual(await fs.readFile(audioPath), previousAudio, 'declining audio replacement should preserve the previous WAV');
          assert.deepEqual(JSON.parse(await fs.readFile(chapterPath, 'utf8')).audioAsset, previousAudioAsset);
          assert.match(await window.locator('.chapter-material-status').first().innerText(), /音声: 要更新/);
          assert.deepEqual(await window.evaluate(() => window.__audioReplacementPrompts), [
            '保存済み音声を新しい音声で置き換えますか？',
          ]);

          await window.locator('#scenario-confirm-button').click();
          await window.locator('#scenario-save-button').click();
          await window.getByText(/プロジェクトを保存しました/).waitFor({ timeout: 30000 });
          assert.deepEqual(await fs.readFile(audioPath), previousAudio, 'saving narration edits should not replace the old WAV');
          assert.equal(JSON.parse(await fs.readFile(chapterPath, 'utf8')).subtitleNarrationHash, previousAudioAsset.narrationHash);
          await window.evaluate(() => {
            window.__audioReplacementPrompts = [];
            window.confirm = (message) => {
              window.__audioReplacementPrompts.push(message);
              return message === '保存済み音声を新しい音声で置き換えますか？';
            };
          });
          await window.locator('.chapter-audio-generate').click();
          await window.getByText(/^音声を保存しました（\d+\.\d+秒）。/).waitFor({ timeout: 120000 });
          const updatedAudioAsset = JSON.parse(await fs.readFile(chapterPath, 'utf8')).audioAsset;
          assert.notEqual(updatedAudioAsset.narrationHash, previousAudioAsset.narrationHash);
          assert.deepEqual(await window.locator('.subtitle-row').evaluateAll((rows) => rows.map((row) => ({
            startSeconds: Number(row.querySelector('.subtitle-start').value),
            endSeconds: Number(row.querySelector('.subtitle-end').value),
            text: row.querySelector('.subtitle-text').value,
          }))), preservedSubtitles);
          assert.deepEqual(JSON.parse(await fs.readFile(chapterPath, 'utf8')).subtitles, preservedSubtitles);
          await window.getByText('字幕タイミング: 要確認（読み上げ本文が変更されています）', { exact: true }).waitFor();
          assert.deepEqual(await window.evaluate(() => window.__audioReplacementPrompts), [
            '保存済み音声を新しい音声で置き換えますか？',
            '音声から作成した字幕で現在の字幕を置き換えますか？',
          ]);
          assert.match(await window.locator('.chapter-material-status').first().innerText(), /音声: 最新/);
          console.log('Declined narration replacement preserved the saved WAV; approved audio regeneration retained manually edited subtitles');
          return;
        }
        if (!withLiveVoicevox && !withMissingSubtitleFixture) {
          await window.locator('.chapter-narration').fill('本文を変更したため、音声を再生成して確認します。');
          await window.getByText('読み上げ本文が変更されています。音声を再生成してください。', { exact: true }).waitFor();
          assert.equal(await window.locator('.chapter-audio-generate').isEnabled(), true);
          await window.locator('.chapter-narration').fill(fixtureDraft.chapters[0].narration);
          await window.locator('.chapter-audio-generate').click();
          await window.getByText(/^音声を保存しました（\d+\.\d+秒）。/).waitFor({ timeout: 120000 });
        }
      }
      if (withMissingSubtitleFixture) {
        const subtitleRows = window.locator('.subtitle-row');
        while (await subtitleRows.count() > 0) await subtitleRows.first().locator('button[aria-label="字幕を削除"]').click();
        await window.locator('#scenario-confirm-button').click();
        await window.locator('#scenario-save-button').click();
        await window.getByText(/プロジェクトを保存しました/).waitFor({ timeout: 30000 });
        await window.locator('#model-file').setInputFiles(path.resolve(__dirname, '../../C1.vrm'));
        await window.getByText('VRM 1.0読込完了', { exact: true }).waitFor({ timeout: 30000 });
        await app.evaluate(({ dialog }) => {
          globalThis.__missingSubtitleSaveDialogCount = 0;
          dialog.showSaveDialog = async () => {
            globalThis.__missingSubtitleSaveDialogCount += 1;
            return { canceled: true };
          };
        });
        await window.locator('#video-export-button').click();
        assert.equal(
          await window.locator('#video-export-status').innerText(),
          '字幕がありません。SRTを作成するため、字幕を追加してから書き出してください。',
        );
        assert.equal(await window.locator('.subtitle-add-button').evaluate((button) => document.activeElement === button), true);
        assert.equal(await app.evaluate(() => globalThis.__missingSubtitleSaveDialogCount), 0);
        console.log('Missing subtitles blocked export before the save dialog and focused the add button');
        return;
      }
      await window.locator('.subtitle-export-button').click();
      await window.getByText('SRT字幕を保存しました。', { exact: true }).waitFor();
      const savedSrt = await fs.readFile(path.join(projectDirectory, 'captions-01.srt'), 'utf8');
      assert.match(savedSrt, /^1\r\n\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}\r\n/u);
      assert.match(savedSrt, /変数は値を保存する名前付きの場所です。|変数を宣言します。/u);
      if (await window.locator('.subtitle-row').count() > 1) {
        assert.ok(savedSrt.includes('\r\n\r\n'), 'SRT cues should be separated by a blank line');
      }
      assert.equal(await window.locator('.code-stage-row').count(), 2);
      assert.equal(await window.locator('.staged-code-preview').innerText(), '#include <stdio.h>');
      assert.equal(await window.locator('#subtitle-preview').isHidden(), true);
      await window.locator('#timeline').evaluate((input) => {
        input.value = '1';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      assert.equal(await window.locator('.staged-code-preview').innerText(), fixtureDraft.chapters[0].codeExample);
      assert.equal(await window.locator('#subtitle-preview').innerText(), withVoicevoxFixture || withLiveVoicevox
        ? '変数は値を保存する名前付きの場所です。'
        : '変数を宣言します。');
      await window.locator('#timeline').evaluate((input) => {
        input.value = '0';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      assert.equal(await window.locator('.staged-code-preview').innerText(), '#include <stdio.h>');
      assert.equal(await window.locator('#subtitle-preview').isHidden(), true);
      await window.waitForFunction(() => {
        const audio = document.querySelector('.chapter-audio');
        return audio && Number.isFinite(audio.duration) && audio.duration > 0;
      });
      await window.locator('#timeline').evaluate((input) => {
        input.value = '0.5';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      assert.ok(Math.abs(Number(await window.locator('.chapter-audio').evaluate((audio) => audio.currentTime)) - 0.5) < 0.05);
      await window.locator('#timeline').evaluate((input) => {
        input.value = '0';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await window.locator('.stage-preview-control input').evaluate((input) => {
        input.value = '1';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      assert.equal(await window.locator('.staged-code-preview').innerText(), fixtureDraft.chapters[0].codeExample);
      await window.locator('.code-stage-time').nth(1).evaluate((input) => {
        input.value = '11';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      assert.equal(await window.locator('#timeline').getAttribute('max'), '11');
      await window.locator('#timeline').evaluate((input) => {
        input.value = '11';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      assert.equal(await window.locator('.staged-code-preview').innerText(), fixtureDraft.chapters[0].codeExample);
      await window.locator('.code-stage-time').nth(1).evaluate((input) => {
        input.value = '1';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      assert.equal(await window.locator('#timeline').getAttribute('max'), '10');

      await window.locator('#rewind-button').click();
      assert.equal(await window.locator('#timeline').inputValue(), '0');
      await window.locator('#play-button').click();
      await window.waitForFunction(
        ({ expectedCode, expectedSubtitle }) =>
          document.querySelector('.staged-code-preview').textContent === expectedCode
          && document.querySelector('#subtitle-preview').textContent === expectedSubtitle,
        {
          expectedCode: fixtureDraft.chapters[0].codeExample,
          expectedSubtitle: withVoicevoxFixture || withLiveVoicevox
            ? '変数は値を保存する名前付きの場所です。'
            : '変数を宣言します。',
        },
        { timeout: 3000 },
      );
      assert.ok(Number(await window.locator('#timeline').inputValue()) >= 0.98);
      assert.equal(await window.locator('.chapter-audio').evaluate((audio) => audio.paused), false);
      assert.ok(await window.locator('.chapter-audio').evaluate((audio) => audio.currentTime) >= 0.9);
      await window.locator('#pause-button').click();
      assert.equal(await window.locator('.chapter-audio').evaluate((audio) => audio.paused), true);
      const pausedAt = await window.locator('#timeline').inputValue();
      await window.waitForTimeout(120);
      assert.equal(await window.locator('#timeline').inputValue(), pausedAt, 'pause should hold the preview position');
      await window.locator('#rewind-button').click();
      assert.equal(await window.locator('#timeline').inputValue(), '0');
      await window.locator('.chapter-audio').evaluate((audio) => { void audio.play(); });
      await window.waitForFunction(() => Number(document.querySelector('#timeline').value) > 0.15, null, { timeout: 3000 });
      assert.ok(await window.locator('.chapter-audio').evaluate((audio) => audio.currentTime) > 0.15);
      await window.locator('.chapter-audio').evaluate((audio) => audio.pause());
      await window.locator('#rewind-button').click();

      await window.getByRole('button', { name: '字幕を追加' }).click();
      assert.equal(await window.locator('.subtitle-row').count(), withVoicevoxFixture || withLiveVoicevox ? 3 : 2);
      assert.equal(await window.locator('#scenario-review-state').innerText(), '未確認の変更');
      await window.getByRole('button', { name: '字幕を削除' }).last().click();
      assert.equal(await window.locator('.subtitle-row').count(), withVoicevoxFixture || withLiveVoicevox ? 2 : 1);

      await window.getByRole('button', { name: '段階を追加' }).click();
      assert.equal(await window.locator('.code-stage-row').count(), 3);
      assert.equal(await window.locator('#scenario-review-state').innerText(), '未確認の変更');
      await window.getByRole('button', { name: '段階を削除' }).nth(2).click();
      assert.equal(await window.locator('.code-stage-row').count(), 2);

      console.log('Confirming and saving project fixture');
      await window.locator('#scenario-confirm-button').click();
      assert.equal(await window.locator('#scenario-review-state').innerText(), '確認済み');
      await window.locator('#scenario-save-button').click();
      await window.getByText(/プロジェクトを保存しました/).waitFor({ timeout: 30000 });
      const savedProject = JSON.parse(await fs.readFile(path.join(projectDirectory, 'project.json'), 'utf8'));
      assert.equal(savedProject.title, fixtureDraft.title);
      if (withLiveVoicevox) {
        const chapterPath = path.join(projectDirectory, 'chapters', '01', 'scenario.json');
        const savedChapter = JSON.parse(await fs.readFile(chapterPath, 'utf8'));
        assert.equal(savedChapter.audioAsset?.path, 'audio/narration.wav');
        assert.ok((await fs.stat(path.join(projectDirectory, 'chapters', '01', 'audio', 'narration.wav'))).size > 44);
        assert.deepEqual(consoleErrors, [], 'renderer should not report console errors');
        console.log('Live VOICEVOX audio generated, synchronized with preview playback, and saved to the project; checking restart restoration');
      }

      console.log('Restarting Electron to verify persisted project');
      await app.close();
      app = await electron.launch({
        executablePath: require('electron'),
        args: [path.resolve(__dirname, '../electron/main.cjs')],
        env: { ...process.env, CVIDEO_DEV_URL: `${viteServer.url}/?cvideo_test_frame=1` },
      });
      const restartedWindow = await app.firstWindow();
      window = restartedWindow;
      await restartedWindow.waitForLoadState('load');
      if (withLiveVoicevox) {
        restartedWindow.on('console', (message) => {
          if (message.type() === 'error') consoleErrors.push(message.text());
        });
        restartedWindow.on('pageerror', (error) => consoleErrors.push(error.message));
      }
      await app.evaluate(({ dialog }, selectedPath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
      }, projectDirectory);
      await restartedWindow.locator('#scenario-open-button').click();
      await restartedWindow.getByText('再確認が必要', { exact: true }).waitFor({ timeout: 30000 });
      assert.equal(await restartedWindow.locator('#scenario-title').inputValue(), fixtureDraft.title);
      assert.equal(await restartedWindow.locator('#scenario-editor fieldset').count(), 1);
      assert.equal(await restartedWindow.locator('#scenario-editor .code-editor:not(.chapter-code)').inputValue(), '80\n');
      assert.equal(await restartedWindow.locator('.code-display-mode:checked').inputValue(), 'staged');
      assert.equal(await restartedWindow.locator('.code-stage-row').count(), 2);
      assert.equal(await restartedWindow.locator('.subtitle-row').count(), withVoicevoxFixture || withLiveVoicevox ? 2 : 1);
      assert.equal(await restartedWindow.locator('.subtitle-text').first().inputValue(), withVoicevoxFixture || withLiveVoicevox
        ? '変数は値を保存する名前付きの場所です。'
        : '変数を宣言します。');
      if (withCResultFixture) {
        assert.equal(await restartedWindow.locator('.execution-output[aria-label="標準出力"]').textContent(), 'captured stdout\n');
        assert.equal(await restartedWindow.locator('.execution-output[aria-label="標準エラー"]').textContent(), 'captured stderr\n');
        assert.equal(await restartedWindow.locator('.video-execution-result').inputValue(), 'edited video result');
      }
      if (withVoicevoxFixture || withLiveVoicevox) {
        await restartedWindow.getByText(/^保存済み音声（\d+\.\d+秒）を読み込みました。$/).waitFor({ timeout: 30000 });
        console.log(`Restored chapter audio status: ${await restartedWindow.locator('.chapter-audio-status').innerText()}`);
        assert.equal(await restartedWindow.locator('.chapter-audio').isVisible(), true);
        assert.match(await restartedWindow.locator('.chapter-audio').getAttribute('src'), /^blob:/);
      }
      assert.equal(await restartedWindow.locator('#scenario-save-button').isEnabled(), false);
      console.log('Project survived Electron restart and reopened as unconfirmed');
      if (withLiveVoicevox) {
        await restartedWindow.locator('#rewind-button').click();
        await restartedWindow.locator('.chapter-audio').evaluate((audio) => { void audio.play(); });
        await restartedWindow.waitForFunction(
          () => Number(document.querySelector('#timeline').value) > 0.15,
          null,
          { timeout: 5000 },
        );
        assert.ok(await restartedWindow.locator('.chapter-audio').evaluate((audio) => audio.currentTime) > 0.15);
        await restartedWindow.locator('.chapter-audio').evaluate((audio) => audio.pause());
        assert.deepEqual(consoleErrors, [], 'renderer should not report console errors after restoring live audio');
        console.log('Live VOICEVOX chapter audio restored after restart and synchronized with the preview timeline');
        return;
      }
    }

    if (withFailureFixture || withRateLimitFixture) {
      await app.evaluate(({ dialog }, selectedPath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
      }, projectDirectory);
      await window.locator('#scenario-open-button').click();
      await window.getByText('再確認が必要', { exact: true }).waitFor({ timeout: 30000 });
      const chapterTitle = await window.locator('#scenario-editor fieldset input').first().inputValue();

      await window.locator('#scenario-generate-button').click();
      const failureMessage = withRateLimitFixture
        ? /利用上限に達した可能性/
        : /接続が中断された可能性/;
      await window.getByText(failureMessage).waitFor({ timeout: 30000 });
      assert.equal(await window.locator('#scenario-review-state').innerText(), '下書き保持中');
      assert.equal(await window.locator('#scenario-generate-button').innerText(), '再試行');
      assert.equal(await window.locator('#scenario-editor fieldset input').first().inputValue(), chapterTitle);
      assert.equal(await window.locator('#scenario-confirm-button').isEnabled(), true);
      console.log(withRateLimitFixture
        ? 'Simulated rate limit preserved the draft and exposed retry'
        : 'Simulated connection failure preserved the draft and exposed retry');
    }

    if (withCRunnerFixture || withCStopFixture) {
      await app.evaluate(({ dialog }, selectedPath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
        dialog.showMessageBox = async () => ({ response: 0 });
      }, projectDirectory);
      await window.locator('#scenario-open-button').click();
      await window.getByText('再確認が必要', { exact: true }).waitFor({ timeout: 30000 });
      const executeButton = window.locator('#scenario-editor .execution-controls button').first();
      assert.equal(await executeButton.isEnabled(), true);
      await executeButton.click();
      const executionStatus = window.locator('#scenario-editor .execution-status');
      const stopButton = window.locator('#scenario-editor .execution-controls button').nth(1);
      if (withCRunnerFixture) {
        await window.getByText(/GCCが見つかりません/).waitFor({ timeout: 30000 });
        const compilerGuidance = await executionStatus.innerText();
        assert.match(compilerGuidance, /UCRT64ターミナル/);
        assert.match(compilerGuidance, /mingw-w64-ucrt-x86_64-toolchain/);
        assert.match(compilerGuidance, /C:\\msys64\\ucrt64\\bin/);
        assert.match(compilerGuidance, /アプリを再起動/);
        console.log('C execution UI reported missing GCC without starting a process');
      } else if (withCStopFixture) {
        await window.getByText('test process running', { exact: false }).waitFor({ timeout: 30000 });
        assert.equal(await stopButton.isEnabled(), true);
        await stopButton.click();
        await window.getByText('実行を停止しました。', { exact: true }).waitFor({ timeout: 30000 });
        assert.equal(await stopButton.isEnabled(), false);
        console.log('C execution UI stop button cancelled the active execution');
      }
    }

    if (withCErrorFixture) {
      await app.evaluate(({ dialog }, selectedPath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
        dialog.showMessageBox = async () => ({ response: 0 });
      }, projectDirectory);
      await window.locator('#scenario-open-button').click();
      await window.getByText('再確認が必要', { exact: true }).waitFor({ timeout: 30_000 });
      const executeButton = window.locator('#scenario-editor .execution-controls button').first();
      const executionStatus = window.locator('#scenario-editor .execution-status');
      const expectedFailures = [
        ['compile-error', 'Cコードのコンパイルに失敗しました。標準エラーに表示されたGCCの診断を確認してください。'],
        ['failed', 'プログラムが終了コード7で終了しました。'],
        ['timeout', '実行が10秒でタイムアウトし、プロセスを停止しました。'],
        ['output-limit', '標準出力と標準エラーの合計が1 MiBに達したため、プロセスを停止しました。'],
      ];
      for (const [mode, message] of expectedFailures) {
        await app.evaluate((_electron, selectedMode) => { process.env.CVIDEO_TEST_C_RUNNER_MODE = selectedMode; }, mode);
        await executeButton.click();
        await window.getByText(message, { exact: true }).waitFor({ timeout: 15_000 });
        await window.waitForFunction(
          () => !document.querySelector('#scenario-editor .execution-controls button')?.disabled,
          null,
          { timeout: 15_000 },
        );
        assert.equal(await executionStatus.innerText(), message);
        if (mode === 'compile-error') {
          assert.match(await window.locator('.execution-output[aria-label="標準エラー"]').innerText(), /expected expression/);
        }
      }
      console.log('C execution UI showed actionable compile, non-zero exit, timeout, and output-limit guidance');
      return;
    }

    if (withCResultFixture) {
      await app.evaluate(({ dialog }, selectedPath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
        dialog.showMessageBox = async () => ({ response: 0 });
      }, projectDirectory);
      await window.locator('#scenario-open-button').click();
      await window.getByText('再確認が必要', { exact: true }).waitFor({ timeout: 30000 });
      assert.match(await window.locator('.chapter-video-status').first().innerText(), /動画: 状態未確認/);
      await window.locator('#scenario-editor .execution-controls button').first().click();
      await window.getByText('終了コード: 0', { exact: true }).waitFor({ timeout: 30000 });
      assert.equal(await window.locator('.execution-output[aria-label="標準出力"]').textContent(), 'captured stdout\n');
      assert.equal(await window.locator('.execution-output[aria-label="標準エラー"]').textContent(), 'captured stderr\n');
      const materialStatus = window.locator('.chapter-material-status').first();
      assert.match(await materialStatus.innerText(), /C実行結果: success/);
      assert.match(await materialStatus.innerText(), /動画: 要更新/);
      const codeInput = window.locator('.chapter-code').first();
      const executedSourceCode = await codeInput.inputValue();
      await codeInput.fill(`${executedSourceCode}\n// changed after execution`);
      assert.equal(await window.locator('.execution-status').innerText(), 'Cコードが変更されています。実行結果は要更新です。');
      assert.match(await materialStatus.innerText(), /C実行結果: 要更新/);
      assert.match(await materialStatus.innerText(), /動画: 要更新/);
      await codeInput.fill(executedSourceCode);
      assert.equal(await window.locator('.execution-status').innerText(), '保存済み実行状態: success');
      assert.match(await materialStatus.innerText(), /C実行結果: success/);
      const runInput = window.locator('.c-run-input').first();
      const executedSourceInput = await runInput.inputValue();
      await runInput.fill('81\n');
      assert.equal(await window.locator('.execution-status').innerText(), '標準入力が変更されています。実行結果は要更新です。');
      assert.match(await materialStatus.innerText(), /C実行結果: 要更新/);
      assert.match(await materialStatus.innerText(), /動画: 要更新/);
      const videoResult = window.locator('.video-execution-result');
      assert.equal(await videoResult.inputValue(), 'captured stdout\n');
      await videoResult.fill('edited video result');
      assert.equal(await window.locator('#scenario-review-state').innerText(), '未確認の変更');
      await window.locator('#scenario-confirm-button').click();
      await window.locator('#scenario-save-button').click();
      await window.getByText(/プロジェクトを保存しました/).waitFor({ timeout: 30000 });
      const savedChapter = JSON.parse(await fs.readFile(
        path.join(projectDirectory, 'chapters', '01', 'scenario.json'),
        'utf8',
      ));
      assert.deepEqual(savedChapter.executionResult, {
        status: 'success',
        stdout: 'captured stdout\n',
        stderr: 'captured stderr\n',
        exitCode: 0,
        videoText: 'edited video result',
        sourceCode: executedSourceCode,
        sourceInput: executedSourceInput,
      });
      console.log('C execution result was captured, edited for video, and saved to the chapter');

      await app.close();
      app = await electron.launch({
        executablePath: require('electron'),
        args: [path.resolve(__dirname, '../electron/main.cjs')],
        env: {
          ...process.env,
          NODE_ENV: 'test',
          CVIDEO_DEV_URL: `${viteServer.url}/?cvideo_test_frame=1`,
          CVIDEO_TEST_C_RUNNER_MODE: withCResultFixture ? 'result' : '',
        },
      });
      window = await app.firstWindow();
      await window.waitForLoadState('load');
      await app.evaluate(({ dialog }, selectedPath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
      }, projectDirectory);
      await window.locator('#scenario-open-button').click();
      await window.getByText('再確認が必要', { exact: true }).waitFor({ timeout: 30000 });
      assert.equal(await window.locator('.execution-status').innerText(), '標準入力が変更されています。実行結果は要更新です。');
      assert.match(await window.locator('.chapter-material-status').first().innerText(), /C実行結果: 要更新/);
      assert.match(await window.locator('.chapter-material-status').first().innerText(), /動画: 状態未確認/);
      assert.equal(await window.locator('.execution-output[aria-label="標準出力"]').textContent(), 'captured stdout\n');
      assert.equal(await window.locator('.execution-output[aria-label="標準エラー"]').textContent(), 'captured stderr\n');
      assert.equal(await window.locator('.video-execution-result').inputValue(), 'edited video result');
      console.log('C execution result and edited video text restored after Electron restart');
    }

    await window.locator('#model-file').setInputFiles(path.resolve(__dirname, '../../C1.vrm'));
    await window.waitForTimeout(3000);
    const runtimeStatus = await window.locator('#runtime-status').innerText();
    console.log(`VRM load status: ${runtimeStatus}`);
    if (runtimeStatus !== 'VRM 1.0読込完了') {
      console.log(`Renderer errors: ${consoleErrors.join(' | ') || 'none'}`);
      await window.screenshot({ path: path.resolve(__dirname, '../test-results/electron-failure.png') });
      throw new Error(`VRM failed to load in Electron: ${runtimeStatus}`);
    }
    assert.equal(await window.locator('#video-export-button').isEnabled(), true, 'MP4 export should be enabled after loading a VRM');
    if (withCharacterActionFixture) {
      const actionDraft = {
        title: fixtureDraft.title,
        chapters: [{
          ...fixtureDraft.chapters[0],
          characterActions: [
            { atSeconds: 1, action: 'explain' },
            { atSeconds: 3, action: 'attention' },
            { atSeconds: 5, action: 'happy' },
          ],
        }],
      };
      await window.evaluate((draft) => window.__cvideoTestLoadScenarioDraft(draft), actionDraft);
      const readPoseAt = async (seconds) => {
        await window.locator('#timeline').evaluate((input, value) => {
          input.value = String(value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }, seconds);
        return window.evaluate(() => window.__cvideoTestGetCharacterPose?.());
      };
      const baselinePose = await readPoseAt(0);
      assert.ok(baselinePose?.head, 'loaded VRM should expose a normalized head bone');
      const explainPose = await readPoseAt(1.4);
      assert.notDeepEqual(explainPose.head, baselinePose.head, 'explain action should animate the head');
      assert.deepEqual(await readPoseAt(1.4), explainPose, 'the same action timestamp should reproduce the pose');
      const exportFrameBytes = await window.evaluate(async () => (
        await window.__cvideoTestCreateVideoFrame?.(42, 200, '動作テスト', 'VOICEVOX: テスト話者')
      )?.byteLength ?? 0);
      assert.ok(exportFrameBytes > 0, 'the action timestamp should render to an MP4 frame');
      const exportPose = await window.evaluate(() => window.__cvideoTestGetCharacterPose?.());
      assert.ok(
        exportPose.head?.every((angle, index) => Math.abs(angle - explainPose.head[index]) < 0.001),
        'video frame rendering should use the same character pose as preview seeking',
      );
      assert.deepEqual((await readPoseAt(2.5)).head, baselinePose.head, 'the explain gesture should return to rest');
      const attentionPose = await readPoseAt(3.6);
      assert.notDeepEqual(attentionPose.head, baselinePose.head, 'attention action should animate the head');
      const happyPose = await readPoseAt(5.6);
      assert.notDeepEqual(happyPose.head, baselinePose.head, 'happy action should animate the head');
      assert.ok(happyPose.happy > 0.7, 'happy action should activate the happy expression');
      assert.ok(Math.abs((await readPoseAt(6.4)).happy - 0.65) < 0.01, 'happy expression should restore the baseline after the gesture');
      console.log('Character action presets animate reproducible VRM poses and restore after each gesture');
      return;
    }
    await window.locator('#timeline').evaluate((input) => {
      input.value = '0';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const modelRotation = await window.evaluate(() => window.__cvideoTestGetModelRotation?.());
    if (withCResultFixture) {
      await window.locator('#scenario-confirm-button').click();
      await window.locator('#video-export-button').click();
      assert.equal(
        await window.locator('#video-export-status').innerText(),
        '標準入力が変更されています。実行結果を再取得してから書き出してください。',
      );
      console.log('Stale C execution result was restored after restart and blocked from MP4 export');
      return;
    } else {
      await window.locator('#video-export-button').click();
      assert.match(await window.locator('#video-export-status').innerText(), /章を確認し/);
    }

    const mouthTimelinePath = path.resolve(__dirname, '../test-results/voicevox-mouth-timeline.json');
    const mouthTimeline = JSON.parse(await fs.readFile(mouthTimelinePath, 'utf8'));
    await window.locator('#mouth-timeline-file').setInputFiles(mouthTimelinePath);
    await window.waitForFunction(
      () => document.querySelector('#result-readout')?.textContent.includes('口パク時刻表読込完了'),
      null,
      { timeout: 30000 },
    );
    const seekAndCapture = async (seconds) => window.locator('#timeline').evaluate((input, value) => {
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return document.querySelector('#render-canvas').toDataURL('image/png');
    }, seconds);
    const aaShape = mouthTimeline.mouthTimeline.find((entry) => entry.expression === 'aa');
    const ihShape = mouthTimeline.mouthTimeline.find((entry) => entry.expression === 'ih');
    assert.ok(aaShape && ihShape, 'timeline should contain open and narrow vowel shapes');
    const aaTime = (aaShape.start + aaShape.end) / 2;
    const aaFrame = await seekAndCapture(aaTime);
    assert.equal(await window.locator('#mouth-readout').innerText(), '口形: aa');
    assert.equal(await seekAndCapture(aaTime), aaFrame, 'same vowel timestamp should reproduce the frame');
    const ihFrame = await seekAndCapture((ihShape.start + ihShape.end) / 2);
    assert.equal(await window.locator('#mouth-readout').innerText(), '口形: ih');
    assert.notEqual(aaFrame, ihFrame, 'different vowels should render different mouth poses');
    console.log('VOICEVOX vowel timeline drives deterministic VRM mouth expressions');

    const motionPath = path.resolve(__dirname, '../test-results/three-vrm-test.vrma');
    assert.ok((await fs.stat(motionPath)).size > 0, 'official VRMA sample should be available');
    await window.locator('#motion-file').setInputFiles(motionPath);
    await window.waitForFunction(
      () => document.querySelector('#result-readout')?.textContent.includes('VRMA読込完了'),
      null,
      { timeout: 30000 },
    );
    const motionFrameA = await seekAndCapture(0.5);
    const motionFrameB = await seekAndCapture(1.5);
    const repeatedMotionFrame = await seekAndCapture(0.5);
    assert.notEqual(motionFrameA, motionFrameB, 'VRMA should change the pose at different times');
    assert.equal(motionFrameA, repeatedMotionFrame, 'seeking to the same time should reproduce the pose');
    console.log('VRMA loaded; distinct-time pose and deterministic seek checks passed');

    if (projectDirectory) {
      const captureComposition = async (seconds) => window.locator('#timeline').evaluate((input, value) => {
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return {
          frame: document.querySelector('#render-canvas').toDataURL('image/png'),
          code: document.querySelector('.staged-code-preview').textContent,
          subtitle: document.querySelector('#subtitle-preview').textContent,
          mouth: document.querySelector('#mouth-readout').textContent,
          codeOverlay: document.querySelector('#video-code-preview').textContent,
          resultOverlay: document.querySelector('#video-result-preview').textContent,
        };
      }, seconds);
      const compositionAtOneSecond = await captureComposition(1);
      await captureComposition(0.5);
      assert.deepEqual(
        await captureComposition(1),
        compositionAtOneSecond,
        'the same timestamp should reproduce the VRM frame, staged code, subtitle, and mouth state',
      );
      const exportFrameComparison = await window.evaluate(async (previewDataUrl) => {
        if (typeof window.__cvideoTestCreateVideoFrame !== 'function') {
          throw new Error('Test-only video frame capture hook is unavailable.');
        }
        const exportFrame = await window.__cvideoTestCreateVideoFrame(30, 120, '変数を使う', 'VOICEVOX: テスト話者');
        const exportText = window.__cvideoTestReadExportText?.();
        if (!exportText) throw new Error('Test-only export text snapshot is unavailable.');
        const previewImage = await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = previewDataUrl;
        });
        const exportImage = await createImageBitmap(new Blob([exportFrame], { type: 'image/png' }));
        const comparisonCanvas = document.createElement('canvas');
        comparisonCanvas.width = 1920;
        comparisonCanvas.height = 1080;
        const context = comparisonCanvas.getContext('2d');
        if (!context) throw new Error('Could not create the frame comparison context.');
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
        return { differingPixels, comparedPixels: previewPixels.length / 4, exportText };
      }, compositionAtOneSecond.frame);
      assert.deepEqual(
        exportFrameComparison.exportText,
        {
          code: compositionAtOneSecond.codeOverlay,
          result: compositionAtOneSecond.resultOverlay,
          subtitle: compositionAtOneSecond.subtitle,
        },
        'the text passed into export rendering should match the preview at the same timestamp',
      );
      assert.equal(
        exportFrameComparison.differingPixels,
        0,
        `preview/export pixels should match outside text overlays: ${JSON.stringify(exportFrameComparison)}`,
      );
      console.log('Full preview composition reproduced at the same timestamp');
      console.log(`Preview/export pixels matched: ${exportFrameComparison.comparedPixels}`);
    }

    await window.locator('#capture-button').click();
    const dataUrl = await window.locator('#render-canvas').evaluate((canvas) => canvas.toDataURL('image/png'));
    const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    const pngPath = path.resolve(__dirname, '../test-results/electron-frame.png');
    await fs.writeFile(pngPath, png);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), 1920);
    assert.equal(png.readUInt32BE(20), 1080);
    console.log(`PNG validated: ${png.length} bytes`);

    await window.locator('#benchmark-button').click();
    await window.getByText(/90フレーム完了/).waitFor({ timeout: 30000 });
    const benchmark = await window.locator('#result-readout').innerText();
    const overBudget = Number(benchmark.match(/33\.3 ms超過 (\d+)枚/)?.[1]);
    assert.equal(overBudget, 0, `30fps frame budget exceeded: ${benchmark}`);
    assert.deepEqual(consoleErrors, [], 'renderer should not report console errors');
    console.log('Benchmark and console checks passed');

    console.log(`VRM: ${await window.locator('#model-readout').innerText()}`);
    console.log(`PNG: ${png.readUInt32BE(16)}x${png.readUInt32BE(20)}, ${(png.length / 1024 / 1024).toFixed(2)} MiB`);
    console.log(`Benchmark: ${benchmark}`);
    console.log('Electron renderer console errors: 0');
  } finally {
    if (aiProviderToRestore && app) {
      const restoreWindow = await app.firstWindow().catch(() => null);
      await restoreWindow?.evaluate((provider) => window.scenarioApi?.setAiProvider(provider), aiProviderToRestore).catch(() => {});
    }
    await app?.close();
    await stopProcess(viteServer?.server);
    if (projectDirectory) await fs.rm(projectDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});