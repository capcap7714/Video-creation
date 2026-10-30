async function writeSyntheticVrmaFixture(outputPath) {
  const timeValues = [0, 1, 2];
  const rotationValues = [
    0, 0, 0, 1,
    0, 0.38268343, 0, 0.92387953,
    0, 0, 0, 1,
  ];
  const animationBuffer = Buffer.alloc((timeValues.length + rotationValues.length) * 4);
  timeValues.forEach((value, index) => animationBuffer.writeFloatLE(value, index * 4));
  rotationValues.forEach((value, index) => animationBuffer.writeFloatLE(value, (timeValues.length + index) * 4));
  const fixture = {
    asset: { version: '2.0', generator: 'C Video synthetic VRMA test fixture' },
    extensionsUsed: ['VRMC_vrm_animation'],
    extensions: {
      VRMC_vrm_animation: {
        specVersion: '1.0',
        humanoid: { humanBones: { hips: { node: 0 } } },
      },
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'hips', translation: [0, 1, 0] }],
    animations: [{
      samplers: [{ input: 0, output: 1, interpolation: 'LINEAR' }],
      channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }],
    }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'SCALAR', min: [0], max: [2] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC4' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 12 },
      { buffer: 0, byteOffset: 12, byteLength: 48 },
    ],
    buffers: [{ byteLength: animationBuffer.length }],
  };

  const jsonBuffer = Buffer.from(JSON.stringify(fixture), 'utf8');
  const paddedJsonBuffer = Buffer.alloc(Math.ceil(jsonBuffer.length / 4) * 4, 0x20);
  jsonBuffer.copy(paddedJsonBuffer);
  const binaryChunkOffset = 20 + paddedJsonBuffer.length;
  const totalLength = binaryChunkOffset + 8 + animationBuffer.length;
  const glbBuffer = Buffer.alloc(totalLength);
  glbBuffer.writeUInt32LE(0x46546c67, 0);
  glbBuffer.writeUInt32LE(2, 4);
  glbBuffer.writeUInt32LE(totalLength, 8);
  glbBuffer.writeUInt32LE(paddedJsonBuffer.length, 12);
  glbBuffer.writeUInt32LE(0x4e4f534a, 16);
  paddedJsonBuffer.copy(glbBuffer, 20);
  glbBuffer.writeUInt32LE(animationBuffer.length, binaryChunkOffset);
  glbBuffer.writeUInt32LE(0x004e4942, binaryChunkOffset + 4);
  animationBuffer.copy(glbBuffer, binaryChunkOffset + 8);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, glbBuffer);
}

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const withScenarioGeneration = process.argv.includes('--with-scenario-generation');
const withScenarioReviewFixture = process.argv.includes('--with-scenario-review-fixture');
const withNewProjectFlowFixture = process.argv.includes('--with-new-project-flow-fixture');
const withAiProviderSettings = process.argv.includes('--with-ai-provider-settings');
const withPronunciationSettingsFixture = process.argv.includes('--with-pronunciation-settings-fixture');
const withProjectFixture = process.argv.includes('--with-project-fixture');
const introSilenceSeconds = 2;
const withProjectOpenFixture = process.argv.includes('--with-project-open-fixture');
const withProjectModelAssetFixture = process.argv.includes('--with-project-model-asset-fixture');
const withProjectRecoveryFixture = process.argv.includes('--with-project-recovery-fixture');
const withProjectRecoveryFailureFixture = process.argv.includes('--with-project-recovery-failure-fixture');
const withCorruptProjectFixture = process.argv.includes('--with-corrupt-project-fixture');
const withAutosaveFixture = process.argv.includes('--with-autosave-fixture');
const withFailureFixture = process.argv.includes('--with-failure-fixture');
const withRateLimitFixture = process.argv.includes('--with-rate-limit-fixture');
const withCRunnerFixture = process.argv.includes('--with-c-runner-fixture');
const withCResultFixture = process.argv.includes('--with-c-result-fixture');
const withMaterialFreshnessFixture = process.argv.includes('--with-material-freshness-fixture');
const withCErrorFixture = process.argv.includes('--with-c-error-fixture');
const withCStopFixture = process.argv.includes('--with-c-stop-fixture');
const withVoicevoxFixture = process.argv.includes('--with-voicevox-fixture');
const withVoicevoxOfflineFixture = process.argv.includes('--with-voicevox-offline-fixture');
const withVoicevoxEmptySpeakersFixture = process.argv.includes('--with-voicevox-empty-speakers-fixture');
const withVoicevoxHttpErrorFixture = process.argv.includes('--with-voicevox-http-error-fixture');
const withAudioReplacementFixture = process.argv.includes('--with-audio-replacement-fixture');
const withFfmpegMissingFixture = process.argv.includes('--with-ffmpeg-missing-fixture');
const withFfmpegAvailableFixture = process.argv.includes('--with-ffmpeg-available-fixture');
const withDependencySummaryFixture = process.argv.includes('--with-dependency-summary-fixture');
const withDependencySummaryLiveFixture = process.argv.includes('--with-dependency-summary-live-fixture');
const withChapterManagementFixture = process.argv.includes('--with-chapter-management-fixture');
const withTimelineMarkerFixture = process.argv.includes('--with-timeline-marker-fixture');
const withCharacterActionFixture = process.argv.includes('--with-character-action-fixture');
const withMissingSubtitleFixture = process.argv.includes('--with-missing-subtitle-fixture');
const withInvalidVrmFixture = process.argv.includes('--with-invalid-vrm-fixture');
const withMaterialEligibilityFixture = process.argv.includes('--with-material-eligibility-fixture');
const withLiveVoicevox = process.argv.includes('--with-live-voicevox');
const projectStore = require('../electron/project-store.cjs');

const fixtureRequest = {
  title: 'C言語の保存テスト',
  overview: '変数の宣言と代入を学ぶための確認用教材です。',
  audience: '初学者',
  chapterCount: 1,
  targetMinutes: 3,
  subtitleMotionMode: 'manual',
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

async function configureMaterialTermsAutomation(page, mode = 'approve') {
  await page.evaluate((initialMode) => {
    window.__cvideoMaterialTermsMode = initialMode;
    const dialog = document.querySelector('#material-terms-dialog');
    if (!dialog) return;
    const observer = new MutationObserver(() => {
      if (!dialog.open || window.__cvideoMaterialTermsMode !== 'approve') return;
      const checkbox = document.querySelector('#material-terms-confirm-checkbox');
      const approveButton = document.querySelector('#material-terms-approve');
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      approveButton.click();
    });
    observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
  }, mode);
}

async function main() {
  let app;
  let projectDirectory;
  let externalModelDirectory;
  let externalModelPath;
  let syntheticMotionFixturePath;
  let viteServer;
  let aiProviderToRestore;
  let pronunciationRulesToRestore;

  try {
    if (withScenarioGeneration || withScenarioReviewFixture || withNewProjectFlowFixture || withProjectFixture || withProjectOpenFixture || withProjectModelAssetFixture || withProjectRecoveryFixture || withProjectRecoveryFailureFixture || withCorruptProjectFixture || withAutosaveFixture || withFailureFixture || withRateLimitFixture || withCRunnerFixture || withCResultFixture || withCStopFixture || withCErrorFixture || withVoicevoxFixture || withAudioReplacementFixture || withLiveVoicevox || withMissingSubtitleFixture) {
      projectDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'c-video-project-ui-'));
      if (withProjectModelAssetFixture) {
        externalModelDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'c-video-external-model-ui-'));
        externalModelPath = path.join(externalModelDirectory, 'C1.vrm');
        await fs.copyFile(path.resolve(__dirname, '../../C1.vrm'), externalModelPath);
      }
      if (!withNewProjectFlowFixture && !withScenarioGeneration) await projectStore.saveScenarioProject(projectDirectory, fixtureRequest, fixtureDraft);
      if (withAudioReplacementFixture) {
        const audioReplacementDraft = structuredClone(fixtureDraft);
        audioReplacementDraft.chapters[0].runCode = false;
        await projectStore.saveScenarioProject(projectDirectory, fixtureRequest, audioReplacementDraft);
      }
      if (withProjectRecoveryFailureFixture) {
        await fs.writeFile(path.join(projectDirectory, '.project-save-recovery.json'), '{ invalid recovery journal', 'utf8');
      }
      if (withProjectRecoveryFixture) {
        const projectPath = path.join(projectDirectory, 'project.json');
        const chapterPath = path.join(projectDirectory, 'chapters', '01', 'scenario.json');
        const snapshots = await Promise.all([projectPath, chapterPath].map(async (filePath) => ({
          path: path.relative(projectDirectory, filePath).split(path.sep).join('/'),
          existed: true,
          contents: (await fs.readFile(filePath)).toString('base64'),
        })));
        await fs.writeFile(
          path.join(projectDirectory, '.project-save-recovery.json'),
          JSON.stringify({ schemaVersion: 1, files: snapshots }),
          'utf8',
        );
        const interruptedChapter = JSON.parse(await fs.readFile(chapterPath, 'utf8'));
        interruptedChapter.narration = '保存中断で残った不整合データ';
        await fs.writeFile(chapterPath, JSON.stringify(interruptedChapter), 'utf8');
      }
    }
    viteServer = await startViteServer();
    app = await electron.launch({
      executablePath: require('electron'),
      args: [path.resolve(__dirname, '../electron/main.cjs')],
      env: {
        ...process.env,
        CVIDEO_DEV_URL: `${viteServer.url}/?cvideo_test_frame=1`,
        ...(withScenarioReviewFixture || withNewProjectFlowFixture || withFailureFixture || withRateLimitFixture || withCRunnerFixture || withCResultFixture || withCStopFixture || withCErrorFixture || withVoicevoxFixture || withPronunciationSettingsFixture || withVoicevoxOfflineFixture || withVoicevoxEmptySpeakersFixture || withVoicevoxHttpErrorFixture || withAudioReplacementFixture || withFfmpegMissingFixture || withFfmpegAvailableFixture || withDependencySummaryFixture || withDependencySummaryLiveFixture || withMissingSubtitleFixture || withAiProviderSettings || withProjectModelAssetFixture || withMaterialEligibilityFixture
          ? {
          NODE_ENV: 'test',
          CVIDEO_TEST_SCENARIO_SUCCESS: withScenarioReviewFixture || withNewProjectFlowFixture ? '1' : '0',
          CVIDEO_TEST_SCENARIO_GENERATION_DELAY_MS: withNewProjectFlowFixture ? '1200' : '0',
          CVIDEO_TEST_SCENARIO_FAILURE: withRateLimitFixture ? 'rate-limit' : withFailureFixture ? 'network' : '',
          CVIDEO_TEST_COMPANY_API_MODE: withAiProviderSettings ? 'success' : '',
          CVIDEO_TEST_GCC_MISSING: withCRunnerFixture ? '1' : '0',
          CVIDEO_TEST_C_RUNNER_MODE: withCErrorFixture ? 'compile-error' : withCStopFixture ? 'hang' : withCResultFixture ? 'result' : '',
          CVIDEO_TEST_VOICEVOX_MODE: withVoicevoxOfflineFixture
            ? 'offline'
            : withVoicevoxEmptySpeakersFixture
              ? 'empty-speakers'
              : withVoicevoxHttpErrorFixture
                ? 'http-error'
              : withVoicevoxFixture || withPronunciationSettingsFixture || withAudioReplacementFixture || withMissingSubtitleFixture || withMaterialEligibilityFixture ? 'speakers' : '',
              CVIDEO_TEST_DEPENDENCY_SUMMARY: withDependencySummaryFixture ? '1' : '0',
              CVIDEO_TEST_EXTERNAL_MODEL_PATH: externalModelPath ?? '',
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
    await configureMaterialTermsAutomation(window, withMaterialEligibilityFixture ? 'manual' : 'approve');
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
    const mainRegionOrder = await window.evaluate(() => {
      const scenario = document.querySelector('.scenario-workspace').getBoundingClientRect();
      const header = document.querySelector('.topbar').getBoundingClientRect();
      const toolbar = document.querySelector('.toolbar').getBoundingClientRect();
      const stage = document.querySelector('.stage').getBoundingClientRect();
      const readout = document.querySelector('.readout').getBoundingClientRect();
      return {
        scenarioBottom: scenario.bottom,
        headerTop: header.top,
        headerBottom: header.bottom,
        toolbarTop: toolbar.top,
        toolbarBottom: toolbar.bottom,
        stageTop: stage.top,
        stageBottom: stage.bottom,
        readoutTop: readout.top,
      };
    });
    assert.ok(mainRegionOrder.scenarioBottom <= mainRegionOrder.headerTop, 'the scenario workspace should appear above the screenshot UI');
    assert.ok(mainRegionOrder.headerBottom <= mainRegionOrder.toolbarTop, 'the header should remain above the toolbar');
    assert.ok(mainRegionOrder.stageBottom <= mainRegionOrder.readoutTop, 'the VRM readout should remain below the stage');
    assert.equal(await window.locator('#scenario-creation-mode-automatic').isChecked(), true);
    assert.equal(await window.locator('#scenario-creation-mode-manual').isChecked(), false);
    const creationModeOrder = await window.evaluate(() => {
      const automatic = document.querySelector('#scenario-creation-mode-automatic').getBoundingClientRect();
      const manual = document.querySelector('#scenario-creation-mode-manual').getBoundingClientRect();
      return { automaticLeft: automatic.left, manualLeft: manual.left };
    });
    assert.ok(creationModeOrder.automaticLeft < creationModeOrder.manualLeft, 'automatic creation should appear to the left of manual setup');
    console.log('Scenario preload and input-validation IPC passed');

    if (withPronunciationSettingsFixture) {
      await window.waitForFunction(() => document.querySelector('#pronunciation-settings-status')?.textContent.includes('件を全プロジェクト'));
      const currentSettings = await window.evaluate(() => window.voicevoxApi.getPronunciationRules());
      assert.equal(currentSettings.loaded, true);
      pronunciationRulesToRestore = currentSettings.rules;
      assert.equal(await window.locator('#pronunciation-settings-button').isEnabled(), true);
      await window.locator('#pronunciation-settings-button').click();
      await window.locator('#pronunciation-settings-dialog').waitFor({ state: 'visible' });
      assert.deepEqual(
        await window.locator('.pronunciation-rule-row').evaluateAll((rows) => rows.map((row) => [
          row.querySelector('.pronunciation-rule-term').value,
          row.querySelector('.pronunciation-rule-reading').value,
        ])),
        Object.entries(currentSettings.rules),
      );
      await window.locator('#pronunciation-rule-add').click();
      const testTerm = `値テスト${process.pid}`;
      await window.locator('.pronunciation-rule-term').last().fill(testTerm);
      await window.locator('.pronunciation-rule-reading').last().fill('あたいテスト');
      await window.locator('#pronunciation-settings-save').click();
      await window.locator('#pronunciation-settings-dialog').waitFor({ state: 'hidden' });
      const savedSettings = await window.evaluate(() => window.voicevoxApi.getPronunciationRules());
      assert.equal(savedSettings.loaded, true);
      assert.equal(savedSettings.rules[testTerm], 'あたいテスト');
      const preview = await window.evaluate((text) => window.voicevoxApi.synthesize(text, 1), testTerm);
      assert.equal(preview.generated, true);
      assert.equal(preview.pronunciationRulesSignature, savedSettings.signature);
      const invalidRules = await window.evaluate(() =>
        window.voicevoxApi.setPronunciationRules({ '': '読み' }));
      assert.equal(invalidRules.saved, false);
      assert.equal((await window.evaluate(() => window.voicevoxApi.getPronunciationRules())).rules[testTerm], 'あたいテスト');
      console.log('App-wide pronunciation dictionary settings persist, validate, and are included in VOICEVOX synthesis');
      return;
    }

    if (withMaterialEligibilityFixture) {
      const modelPath = path.resolve(__dirname, '../../C1.vrm');
      await window.evaluate(() => { window.__cvideoMaterialTermsMode = 'manual'; });
      await window.locator('#model-file').setInputFiles(modelPath);
      await window.locator('#material-terms-dialog').waitFor({ state: 'visible' });
      assert.equal(await window.locator('#material-terms-approve').isDisabled(), true, 'unconfirmed terms must not be approvable');
      await window.locator('#material-terms-cancel').click();
      await window.getByText(/利用条件が未確認のため、VRMモデル「C1\.vrm」の読み込みをキャンセルしました/u).waitFor();
      assert.equal(await window.locator('#runtime-status').innerText(), 'モデル未読込');
      assert.equal(await window.locator('#video-export-button').isDisabled(), true);

      await window.locator('#model-file').setInputFiles(modelPath);
      await window.locator('#material-terms-dialog').waitFor({ state: 'visible' });
      await window.locator('#material-terms-confirm-checkbox').check();
      assert.equal(await window.locator('#material-terms-approve').isEnabled(), true);
      await window.locator('#material-terms-approve').click();
      await window.getByText('VRM 1.0読込完了', { exact: true }).waitFor({ timeout: 30_000 });

      syntheticMotionFixturePath = path.join(os.tmpdir(), `c-video-material-eligibility-${process.pid}.vrma`);
      await writeSyntheticVrmaFixture(syntheticMotionFixturePath);
      await window.locator('#motion-file').setInputFiles(syntheticMotionFixturePath);
      await window.locator('#material-terms-dialog').waitFor({ state: 'visible' });
      await window.locator('#material-terms-cancel').click();
      await window.getByText(/利用条件が未確認のため、VRMAモーション/u).waitFor();
      assert.equal(await window.locator('#runtime-status').innerText(), 'VRM 1.0読込完了', 'rejecting motion must preserve the selected model');

      await window.locator('#voicevox-connect-button').click();
      await window.getByText('接続しました。2種類のスタイルを利用できます。', { exact: true }).waitFor();
      await window.locator('#voicevox-style').selectOption('2');
      await window.locator('#material-terms-dialog').waitFor({ state: 'visible' });
      await window.locator('#material-terms-cancel').click();
      await window.waitForFunction(() => document.querySelector('#voicevox-style')?.value === '');
      assert.equal(await window.locator('#voicevox-style').inputValue(), '', 'rejecting voice terms must clear the unapproved selection');
      assert.equal(await window.locator('#voicevox-generate-button').isDisabled(), true);
      await window.locator('#voicevox-style').selectOption('2');
      await window.locator('#material-terms-dialog').waitFor({ state: 'visible' });
      await window.locator('#material-terms-confirm-checkbox').check();
      assert.equal(await window.locator('#material-terms-approve').isEnabled(), true);
      await window.locator('#material-terms-approve').click();
      await window.waitForFunction(() => !document.querySelector('#voicevox-generate-button')?.disabled);
      assert.equal(await window.locator('#voicevox-generate-button').isEnabled(), true);
      await window.locator('#voicevox-generate-button').click();
      await window.getByText('試聴音声を生成しました。再生ボタンで確認できます。', { exact: true }).waitFor();
      console.log('Unconfirmed VRM, VRMA, and VOICEVOX selections were blocked; explicit approval enabled eligible assets');
      return;
    }

    if (withDependencySummaryFixture || withDependencySummaryLiveFixture) {
      await window.locator('#scenario-api-key').fill('SECRET_API_KEY_CANARY_82f1');
      await window.locator('#scenario-overview').fill('SCENARIO_BODY_CANARY_71ac この本文はコピー対象外です。');
      await window.locator('#voicevox-text').fill('VOICE_TEXT_CANARY_54be');
      await window.locator('#dependency-check-button').click();
      await window.waitForFunction(
        () => !document.querySelector('#dependency-status')?.textContent?.includes('確認しています'),
        null,
        { timeout: 30_000 },
      );
      const status = await window.locator('#dependency-status').innerText();
      assert.match(status, /FFmpeg: (利用可能|要対応)/u);
      assert.match(status, /VOICEVOX Engine: (利用可能|要対応)/u);
      assert.match(status, /MSYS2 \/ GCC: (利用可能|要対応)/u);
      assert.match(status, withDependencySummaryFixture
        ? /Node\.js: Electron内蔵 vtest/u
        : /Node\.js: Electron内蔵 v\d+\.\d+/u);
      assert.match(await window.locator('#dependency-status').getAttribute('data-state'), /^(ready|warning)$/u);
      if (withDependencySummaryFixture) {
        assert.match(status, /FFmpeg: 利用可能/u);
        assert.match(status, /VOICEVOX Engine: 要対応/u);
        assert.match(status, /MSYS2 \/ GCC: 要対応/u);
      }
      console.log(withDependencySummaryFixture
        ? 'Dependency summary reports all four fixture states'
        : 'Dependency summary queried FFmpeg, VOICEVOX, GCC, and the bundled Node.js runtime');
      if (withDependencySummaryFixture) {
        await window.locator('#diagnostic-copy-button').click();
        await window.getByText('環境情報をクリップボードにコピーしました。', { exact: true }).waitFor();
        const copiedText = await app.evaluate(({ clipboard }) => clipboard.readText());
        assert.match(copiedText, /C言語学習動画ツール 環境情報/u);
        assert.match(copiedText, /FFmpeg: 利用可能/u);
        assert.match(copiedText, /VOICEVOX Engine: 要対応/u);
        assert.match(copiedText, /MSYS2 \/ GCC: 要対応/u);
        assert.match(copiedText, /Electron: v\d+\.\d+/u);
        assert.match(copiedText, /Node\.js: vtest/u);
        assert.doesNotMatch(copiedText, /SECRET_API_KEY_CANARY_82f1|SCENARIO_BODY_CANARY_71ac|VOICE_TEXT_CANARY_54be/u);
        console.log('Diagnostic clipboard report excludes secret and training-content canaries');
      }
      return;
    }

    if (withScenarioReviewFixture) {
      aiProviderToRestore = (await window.evaluate(() => window.scenarioApi.getAiProvider())).provider;
      await window.waitForFunction(() => !document.querySelector('#scenario-ai-provider').disabled);
      if (aiProviderToRestore !== 'copilot') {
        await window.locator('#scenario-ai-provider').selectOption('copilot');
        await window.getByText('Copilot SDKでシナリオを生成します。', { exact: true }).waitFor();
      }
      await app.evaluate(({ dialog }, selectedPath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
      }, projectDirectory);
      await window.locator('#scenario-open-button').click();
      await window.getByText('再確認が必要', { exact: true }).waitFor({ timeout: 30_000 });
      const chapterPath = path.join(projectDirectory, 'chapters', '01', 'scenario.json');
      const originalChapter = await fs.readFile(chapterPath);
      await window.locator('#scenario-generate-button').click();
      await window.getByText('確認待ち', { exact: true }).waitFor({ timeout: 30_000 });
      assert.equal(await window.locator('#scenario-save-button').isDisabled(), true);
      assert.equal(await window.locator('#scenario-confirm-button').isEnabled(), true);
      assert.deepEqual(await fs.readFile(chapterPath), originalChapter, 'unconfirmed generation must not overwrite the saved chapter');
      assert.equal(await window.locator('#scenario-review-state').innerText(), '確認待ち');
      await window.locator('#scenario-confirm-button').click();
      assert.equal(await window.locator('#scenario-save-button').isEnabled(), true);
      assert.deepEqual(await fs.readFile(chapterPath), originalChapter, 'confirmation alone must not overwrite files before explicit save');
      console.log('Generated scenarios remained unconfirmed without overwriting saved files; confirmation enabled explicit save');
      return;
    }

    if (withNewProjectFlowFixture) {
      aiProviderToRestore = (await window.evaluate(() => window.scenarioApi.getAiProvider())).provider;
      await window.waitForFunction(() => !document.querySelector('#scenario-ai-provider').disabled);
      if (aiProviderToRestore !== 'copilot') {
        await window.locator('#scenario-ai-provider').selectOption('copilot');
      }
      const request = {
        title: '新規Cプロジェクト通し確認',
        overview: '新規作成、明示確認、保存、再起動後の復元を検証します。',
        audience: 'C言語初学者',
        chapterCount: 1,
        targetMinutes: 3,
        subtitleMotionMode: 'automatic',
      };
      await window.locator('#scenario-title').fill(request.title);
      await window.locator('#scenario-overview').fill(request.overview);
      await window.locator('#scenario-audience').fill(request.audience);
      await window.locator('#scenario-chapter-count').fill(String(request.chapterCount));
      await window.locator('#scenario-target-minutes').fill(String(request.targetMinutes));
      await window.locator('#scenario-creation-mode-automatic').check();
      await app.evaluate(({ dialog }, selectedPath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
      }, projectDirectory);
      await window.locator('#scenario-generate-button').click();
      await window.getByText('Copilot SDKでシナリオを生成しています...', { exact: true }).waitFor({ timeout: 5000 });
      await window.waitForTimeout(300);
      assert.equal(
        await window.locator('#scenario-message').innerText(),
        'Copilot SDKでシナリオを生成しています...',
        'the save-location status should be replaced while scenario generation is in progress',
      );
      await window.getByText('確認待ち', { exact: true }).waitFor({ timeout: 30_000 });
      assert.equal(await window.locator('#scenario-editor fieldset').count(), 1);
      assert.equal(await window.locator('#scenario-save-button').isDisabled(), true);
      assert.equal(await window.locator('#chapter-workflow').isVisible(), true);
      assert.match(await window.locator('#chapter-workflow-status').innerText(), /章の内容を確認してください/);
      assert.match(await window.locator('.narration-timing-status').first().innerText(), /本文 \d+文字・(?:冒頭挨拶を含む)?推定 \d+\.\d+秒/u);
      assert.match(await window.locator('.narration-timing-status').first().innerText(), /目標 3分 \/ 本文目安 720〜1080文字/u);
      await window.locator('#chapter-add-button').click();
      assert.deepEqual(await window.locator('.chapter-title').evaluateAll((inputs) => inputs.map((input) => input.value)), [
        '未確認の章', '新しい章',
      ]);
      const addedChapter = window.locator('#scenario-editor fieldset').nth(1);
      await addedChapter.locator('.chapter-code').fill('int count = 1;');
      assert.equal(await addedChapter.locator('.code-stage-row').count(), 1, 'adding code should create its first display stage');
      assert.equal(await addedChapter.locator('.code-display-mode').count(), 0);
      await window.evaluate(() => { window.confirm = () => false; });
      await window.locator('[data-chapter-action="remove"]').nth(1).click();
      assert.equal(await window.locator('.chapter-title').count(), 2, 'declining chapter deletion should preserve the new chapter');
      await window.locator('[data-chapter-action="move-up"]').nth(1).click();
      assert.deepEqual(await window.locator('.chapter-title').evaluateAll((inputs) => inputs.map((input) => input.value)), [
        '新しい章', '未確認の章',
      ]);
      await window.evaluate(() => { window.confirm = () => true; });
      await window.locator('[data-chapter-action="remove"]').first().click();
      assert.deepEqual(await window.locator('.chapter-title').evaluateAll((inputs) => inputs.map((input) => input.value)), [
        '未確認の章',
      ]);
      await window.locator('#scenario-confirm-button').click();
      assert.equal(await window.locator('#scenario-save-button').isEnabled(), true);
      assert.match(await window.locator('#chapter-workflow-status').innerText(), /VOICEVOXで章音声を生成してください/);
      assert.match(await window.locator('#scenario-message').innerText(), /自動保存/u);
      await app.evaluate(({ dialog }, selectedPath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
      }, projectDirectory);
      await window.locator('#scenario-save-button').click();
      await window.getByText(/プロジェクトを保存しました/u).waitFor({ timeout: 30_000 });
      const savedProject = JSON.parse(await fs.readFile(path.join(projectDirectory, 'project.json'), 'utf8'));
      const savedChapter = JSON.parse(await fs.readFile(path.join(projectDirectory, 'chapters', '01', 'scenario.json'), 'utf8'));
      assert.deepEqual(savedProject.request, request);
      assert.equal(savedChapter.title, '未確認の章');
      assert.equal(savedChapter.narration, 'この内容はユーザー確認前の一時的な生成案です。');

      await app.close();
      app = await electron.launch({
        executablePath: require('electron'),
        args: [path.resolve(__dirname, '../electron/main.cjs')],
        env: { ...process.env, CVIDEO_DEV_URL: `${viteServer.url}/?cvideo_test_frame=1` },
      });
      window = await app.firstWindow();
      await window.waitForLoadState('load');
      await app.evaluate(({ dialog }, selectedPath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
      }, projectDirectory);
      await window.locator('#scenario-open-button').click();
      await window.getByText('再確認が必要', { exact: true }).waitFor({ timeout: 30_000 });
      assert.equal(await window.locator('#scenario-title').inputValue(), request.title);
      assert.equal(await window.locator('#scenario-creation-mode-automatic').isChecked(), true);
      assert.equal(await window.locator('.chapter-title').first().inputValue(), '未確認の章');
      assert.equal(await window.locator('.chapter-narration').inputValue(), savedChapter.narration);
      assert.equal(await window.locator('#scenario-save-button').isDisabled(), true);
      console.log('New project generation, user confirmation, save, restart, and review-before-edit flow passed');
      return;
    }

    if (withAiProviderSettings) {
      await window.waitForFunction(() => !document.querySelector('#scenario-ai-provider').disabled);
      aiProviderToRestore = (await window.evaluate(() => window.scenarioApi.getAiProvider())).provider;
      assert.ok(['copilot', 'company-api'].includes(aiProviderToRestore));
      const storageStatus = await window.evaluate(() => window.scenarioApi.getCompanyApiKeyStatus());
      assert.equal(storageStatus.available, true, 'OS-protected credential storage should be available in the target Windows app');
      await window.locator('#scenario-api-key').fill('dummy-test-key-not-a-real-secret');
      await window.locator('#scenario-api-key-save').click();
      await window.getByText('APIキー保存済み', { exact: true }).waitFor();
      assert.equal(await window.locator('#scenario-api-key').inputValue(), '');
      assert.deepEqual(await window.evaluate(() => window.scenarioApi.getCompanyApiKeyStatus()), { available: true, configured: true });
      assert.deepEqual(await window.evaluate(() => window.scenarioApi.verifyCompanyApi()), {
        verified: true,
        message: '会社APIとモデルを確認しました。',
      });
      await window.locator('#scenario-ai-provider').selectOption('company-api');
      await window.getByText('会社API / gpt-6-lunaを使用します。失敗時にCopilotへ切り替わることはありません。', { exact: true }).waitFor();
      assert.equal(await window.locator('#scenario-generate-button').isEnabled(), true);
      const generatedOutcome = await window.evaluate((request) => window.scenarioApi.generate(request, null), fixtureRequest);
      assert.equal(generatedOutcome.status, 'draft', JSON.stringify(generatedOutcome));
      assert.equal(generatedOutcome.requiresReview, true);
      assert.equal(generatedOutcome.draft.chapters.length, fixtureRequest.chapterCount);
      await app.evaluate(() => {
        process.env.CVIDEO_TEST_COMPANY_API_MODE = 'invalid-scenario';
      });
      const invalidScenarioOutcome = await window.evaluate(({ request, draft }) => window.scenarioApi.generate(request, draft), {
        request: fixtureRequest,
        draft: generatedOutcome.draft,
      });
      assert.equal(invalidScenarioOutcome.error.kind, 'invalid-response');
      assert.match(invalidScenarioOutcome.error.message, /JSON応答がシナリオ項目の要件を満たしませんでした/);
      assert.match(invalidScenarioOutcome.error.message, /該当項目: chapters/);
      assert.equal(invalidScenarioOutcome.draft.title, generatedOutcome.draft.title);
      await app.evaluate(() => {
        process.env.CVIDEO_TEST_COMPANY_API_MODE = 'success';
      });
      const failedOutcome = await window.evaluate(async ({ request, draft }) => {
        await window.scenarioApi.deleteCompanyApiKey();
        return window.scenarioApi.generate(request, draft);
      }, { request: fixtureRequest, draft: generatedOutcome.draft });
      assert.equal(failedOutcome.status, 'failed');
      assert.equal(failedOutcome.draft.title, generatedOutcome.draft.title);
      assert.equal(failedOutcome.error.kind, 'authentication-error');
      assert.equal(await window.evaluate(() => window.scenarioApi.getCompanyApiKeyStatus().then((status) => status.configured)), false);

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
      assert.equal(await window.locator('#scenario-generate-button').isDisabled(), true);

      await window.locator('#scenario-ai-provider').selectOption('copilot');
      await window.getByText('Copilot SDKでシナリオを生成します。', { exact: true }).waitFor();
      assert.equal(await window.locator('#scenario-generate-button').isEnabled(), true);
      assert.deepEqual(await window.evaluate(() => window.scenarioApi.getAiProvider()), { provider: 'copilot' });
      console.log('Scenario AI provider persistence, OS-protected key lifecycle, company API generation, draft retention, and no-fallback behavior passed');
      return;
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

    if (withVoicevoxOfflineFixture || withVoicevoxEmptySpeakersFixture || withVoicevoxHttpErrorFixture) {
      await window.locator('#voicevox-connect-button').click();
      const expectedStatus = withVoicevoxOfflineFixture
        ? 'VOICEVOX Engineに接続できません。Engineを起動してから再試行してください。'
        : withVoicevoxEmptySpeakersFixture
          ? 'VOICEVOX Engineには接続しましたが、有効な話者スタイルがありません。Engineの話者設定を確認して再試行してください。'
          : 'VOICEVOX Engineの応答を確認できません。Engineの状態を確認してください。';
      await window.getByText(expectedStatus, { exact: true }).waitFor({ timeout: 15_000 });
      assert.equal(await window.locator('#voicevox-status').getAttribute('data-state'), withVoicevoxEmptySpeakersFixture ? 'warning' : 'error');
      assert.equal(await window.locator('#voicevox-style').isDisabled(), true);
      assert.equal(await window.locator('#voicevox-generate-button').isDisabled(), true);
      assert.equal(await window.locator('#voicevox-connect-button').isEnabled(), true, 'retry should remain available');
      await window.locator('#voicevox-connect-button').click();
      await window.getByText(expectedStatus, { exact: true }).waitFor({ timeout: 15_000 });
      console.log(withVoicevoxOfflineFixture
        ? 'VOICEVOX unavailable state explains how to start/retry the Engine'
        : withVoicevoxEmptySpeakersFixture
          ? 'VOICEVOX empty speaker list is distinct from connection failure and supports retry'
          : 'VOICEVOX HTTP error shows actionable guidance and keeps retry available');
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
      assert.equal(await window.locator('.execution-time').first().inputValue(), '2', 'C results should default to appearing after the opening frames');
      assert.equal(await window.locator('.voicevox-panel').evaluate((panel) => {
        const selected = document.querySelector('.chapter-preview-target:checked')?.closest('fieldset');
        return panel.closest('.chapter-audio-controls') === selected?.querySelector('.chapter-audio-controls');
      }), true, 'VOICEVOX controls should appear beside the selected chapter audio controls');
      await window.locator('.chapter-preview-target').nth(1).check();
      assert.equal(await window.locator('.scenario-editor fieldset').nth(1).locator('.chapter-audio-controls').locator('.voicevox-panel').count(), 1,
        'VOICEVOX controls should follow the selected preview chapter');
      const previewControlLayout = await window.locator('.chapter-preview-target-label').first().evaluate((label) => {
        const radio = label.querySelector('input').getBoundingClientRect();
        const textNode = [...label.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
        const range = document.createRange();
        range.selectNode(textNode);
        const text = range.getBoundingClientRect();
        return { radioRight: radio.right, radioTop: radio.top, textLeft: text.left, textTop: text.top };
      });
      assert.ok(previewControlLayout.textLeft >= previewControlLayout.radioRight, 'chapter preview text should appear to the right of its radio button');
      assert.ok(Math.abs(previewControlLayout.textTop - previewControlLayout.radioTop) < 8, 'chapter preview text should align with its radio button');
      const actionSection = window.locator('.character-action-section').first();
      const actionRows = actionSection.locator('.character-action-row');
      const addActionButton = actionSection.getByRole('button', { name: '動作を追加' });
      while (await actionRows.count() < 4) await addActionButton.click();
      const actionButtonGap = await actionSection.evaluate((section) => {
        const lastRow = section.querySelector('.character-action-row:last-child').getBoundingClientRect();
        const addButton = section.querySelector('.character-action-editor > button').getBoundingClientRect();
        return addButton.top - lastRow.bottom;
      });
      assert.ok(actionButtonGap >= 8, `add-action button should not touch the last time input row (gap: ${actionButtonGap}px)`);
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
      assert.ok(Math.abs(Number(await window.locator('#timeline').inputValue()) - 7) < 0.02);
      assert.equal(await window.locator('.staged-code-preview').innerText(), '#include <stdio.h>');
      assert.equal(await window.locator('#video-result-preview').isHidden(), true);

      await window.locator('.timeline-marker[data-kind="execution"]').click();
      assert.ok(Math.abs(Number(await window.locator('#timeline').inputValue()) - 9.5) < 0.02);
      assert.equal(await window.locator('#video-result-preview').innerText(), '80');

      await window.locator('.timeline-marker[data-kind="character-action"]').nth(1).click();
      assert.ok(Math.abs(Number(await window.locator('#timeline').inputValue()) - 8) < 0.02);
      assert.equal(await window.evaluate(() => window.__cvideoTestGetCharacterActionAt?.(5)?.action), 'attention');

      await window.locator('.timeline-marker[data-kind="subtitle"]').click();
      assert.ok(Math.abs(Number(await window.locator('#timeline').inputValue()) - 10) < 0.02);
      assert.equal(await window.locator('#subtitle-preview').innerText(), '字幕マーカーを選びました。');
      console.log('Timeline code-stage, execution, character-action, and subtitle markers seek and update the preview');
      return;
    }

    if (withScenarioGeneration) {
      await app.evaluate(({ dialog }, selectedPath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
      }, projectDirectory);
      await window.locator('#scenario-generate-button').click();
      await window.getByText('確認待ち', { exact: true }).waitFor({ timeout: 180000 });
      assert.equal(await window.locator('#scenario-editor fieldset').count(), 2);
      assert.equal(await window.locator('#scenario-confirm-button').isEnabled(), true);

      const scenarioTitle = window.locator('#scenario-title');
      await scenarioTitle.fill('C言語の変数入門・確認テスト');
      assert.equal(await window.locator('#scenario-review-state').innerText(), '未確認の変更');
      await window.locator('#scenario-confirm-button').click();
      assert.equal(await window.locator('#scenario-review-state').innerText(), '確認済み');
      assert.match(await window.locator('#scenario-message').innerText(), /自動保存/u);

      await window.screenshot({
        path: path.resolve(__dirname, '../test-results/scenario-review.png'),
        fullPage: true,
      });
      console.log('Scenario generation, manual edit, and review confirmation passed');
    }

    if (withProjectFixture || withProjectOpenFixture || withProjectModelAssetFixture || withProjectRecoveryFixture || withProjectRecoveryFailureFixture || withCorruptProjectFixture || withAutosaveFixture || withAudioReplacementFixture || withMissingSubtitleFixture) {
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

      if (withCorruptProjectFixture) {
        const projectPath = path.join(projectDirectory, 'project.json');
        const malformedProject = '{ invalid project json';
        await fs.writeFile(projectPath, malformedProject, 'utf8');
        await window.locator('#scenario-open-button').click();
        await window.getByText(
          'プロジェクトを読み込めません。project.jsonと章ファイルの形式、読み取り権限を確認してください。',
          { exact: true },
        ).waitFor({ timeout: 15_000 });
        assert.equal(await window.locator('#scenario-title').inputValue(), 'C言語の変数入門');
        assert.equal(await window.locator('#scenario-editor fieldset').count(), 0);
        assert.equal(await fs.readFile(projectPath, 'utf8'), malformedProject, 'failed project open should preserve the original malformed file for recovery');
        console.log('Malformed project JSON was rejected without changing the visible draft or source file');
        return;
      }

      console.log('Opening project fixture');
      await window.locator('#scenario-open-button').click();
      await window.waitForFunction(() => {
        const reviewState = document.querySelector('#scenario-review-state')?.textContent;
        const message = document.querySelector('#scenario-message')?.textContent ?? '';
        return reviewState === '再確認が必要'
          || message.includes('プロジェクトを開けません')
          || message.includes('保存中断から復旧できませんでした');
      }, null, { timeout: 30000 });
      if (withProjectRecoveryFailureFixture) {
        await window.getByText(
          '保存中断から復旧できませんでした。プロジェクトフォルダー内のファイルを削除せず、管理者に確認してください。',
          { exact: true },
        ).waitFor({ timeout: 15_000 });
        assert.equal(await window.locator('#scenario-title').inputValue(), 'C言語の変数入門');
        assert.equal(await window.locator('#scenario-editor fieldset').count(), 0);
        assert.equal(
          JSON.parse(await fs.readFile(path.join(projectDirectory, 'chapters', '01', 'scenario.json'), 'utf8')).narration,
          fixtureDraft.chapters[0].narration,
        );
        assert.equal(
          await fs.readFile(path.join(projectDirectory, '.project-save-recovery.json'), 'utf8'),
          '{ invalid recovery journal',
        );
        console.log('Invalid recovery journal was preserved and the UI advised keeping project files');
        return;
      }
      assert.equal(
        await window.locator('#scenario-review-state').innerText(),
        '再確認が必要',
        `project fixture should open successfully: ${await window.locator('#scenario-message').innerText()}`,
      );
      assert.equal(await window.locator('#scenario-title').inputValue(), fixtureDraft.title);
      assert.equal(await window.locator('#scenario-editor fieldset').count(), 1);
      if (withProjectModelAssetFixture) {
        assert.equal(
          await window.locator('#model-file').evaluate((input) => input.parentElement?.innerText.trim()),
          'プロジェクトへコピーして開く',
        );
        assert.equal(await window.locator('#external-model-button').innerText(), 'プロジェクト外のVRMを参照');
        const sourceModelPath = path.resolve(__dirname, '../../C1.vrm');
        await window.locator('#model-file').setInputFiles(sourceModelPath);
        await window.getByText(/VRMモデルをプロジェクトにコピーしました/u).waitFor({ timeout: 30_000 });
        let project = JSON.parse(await fs.readFile(path.join(projectDirectory, 'project.json'), 'utf8'));
        assert.equal(project.modelAsset.fileName, 'C1.vrm');
        const copiedModelPath = path.join(projectDirectory, ...project.modelAsset.path.split('/'));
        assert.deepEqual(await fs.readFile(copiedModelPath), await fs.readFile(sourceModelPath));

        await window.locator('#scenario-open-button').click();
        await window.waitForFunction(
          () => document.querySelector('#runtime-status')?.textContent === 'VRM 1.0読込完了',
          null,
          { timeout: 30_000 },
        );
        assert.match(await window.locator('#model-readout').innerText(), /C1\.vrm/u);

        await fs.rm(copiedModelPath);
        await window.locator('#scenario-open-button').click();
        await window.getByText(/保存済みVRMが見つからないか破損しています/u).waitFor({ timeout: 15_000 });
        assert.equal(await window.locator('#runtime-status').innerText(), 'モデル未読込');
        assert.equal(await window.locator('#video-export-button').isDisabled(), true);
        project = JSON.parse(await fs.readFile(path.join(projectDirectory, 'project.json'), 'utf8'));
        assert.equal(project.modelAsset.fileName, 'C1.vrm', 'the missing model reference should remain available for repair');
        await window.locator('#external-model-button').click();
        await window.waitForFunction(
          () => document.querySelector('#runtime-status')?.textContent === 'VRM 1.0読込完了',
          null,
          { timeout: 30_000 },
        );
        await window.waitForFunction(
          () => document.querySelector('#runtime-status')?.textContent === 'VRM 1.0読込完了',
          null,
          { timeout: 30_000 },
        );
        project = JSON.parse(await fs.readFile(path.join(projectDirectory, 'project.json'), 'utf8'));
        assert.equal(project.modelAsset.storageMode, 'external');
        assert.equal(project.modelAsset.sourcePath, await fs.realpath(externalModelPath));
        assert.equal(project.modelAsset.path, undefined, 'external references should not create a project copy');

        await window.locator('#scenario-open-button').click();
        await window.waitForFunction(
          () => document.querySelector('#runtime-status')?.textContent === 'VRM 1.0読込完了',
          null,
          { timeout: 30_000 },
        );
        assert.match(await window.locator('#model-readout').innerText(), /C1\.vrm/u);
        await fs.rm(externalModelPath);
        await window.locator('#scenario-open-button').click();
        await window.getByText(/保存済みVRMが見つからないか破損しています/u).waitFor({ timeout: 15_000 });
        assert.equal(await window.locator('#runtime-status').innerText(), 'モデル未読込');
        assert.equal(await window.locator('#video-export-button').isDisabled(), true);
        console.log('Copied and external VRM storage restored; missing copied or external assets were detected and blocked export');
        return;
      }
      if (withProjectRecoveryFixture) {
        assert.match(
          await window.locator('#scenario-message').innerText(),
          /保存中断を検出し、前回保存時点の内容へ復旧しました/u,
        );
        assert.equal(
          JSON.parse(await fs.readFile(path.join(projectDirectory, 'chapters', '01', 'scenario.json'), 'utf8')).narration,
          fixtureDraft.chapters[0].narration,
        );
        console.log('Interrupted project save was recovered on open and explained in the UI');
        return;
      }
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
        if (await window.locator('#scenario-review-state').innerText() !== '確認済み') {
          await window.locator('#scenario-confirm-button').click();
        }
        await window.locator('#voicevox-connect-button').click();
        if (withLiveVoicevox) {
          await window.getByText(/^接続しました。\d+種類のスタイルを利用できます。$/).waitFor({ timeout: 30_000 });
          const firstStyleId = await window.locator('#voicevox-style option').first().getAttribute('value');
          assert.ok(firstStyleId, 'live VOICEVOX Engine should expose at least one style');
          await window.locator('#voicevox-style').selectOption(firstStyleId);
        } else {
          await window.getByText('接続しました。2種類のスタイルを利用できます。', { exact: true }).waitFor();
          assert.equal(await window.locator('#voicevox-style option').count(), 2);
          await window.locator('#voicevox-style').selectOption('2');
        }
        await window.waitForFunction(() => !document.querySelector('.chapter-audio-generate')?.disabled, null, { timeout: 30_000 });
        if (withVoicevoxFixture || withLiveVoicevox) {
          await window.locator('#voicevox-generate-button').click();
          await window.getByText('試聴音声を生成しました。再生ボタンで確認できます。', { exact: true }).waitFor({ timeout: 30_000 });
          assert.equal(await window.locator('#voicevox-audio').isVisible(), true);
          assert.match(await window.locator('#voicevox-audio').getAttribute('src'), /^blob:/);
          await window.waitForFunction(() => {
            const audio = document.querySelector('#voicevox-audio');
            return audio && audio.readyState >= 1 && Number.isFinite(audio.duration) && audio.duration > 0;
          }, null, { timeout: 30_000 });
          console.log(withLiveVoicevox
            ? 'Live VOICEVOX speaker selection and WAV preview generation passed'
            : 'VOICEVOX speaker selection and WAV preview generation passed');
        }
        await window.evaluate(() => { window.confirm = () => true; });
        assert.equal(
          await window.locator('.chapter-audio-generate').isEnabled(),
          true,
          `chapter audio should be ready after review and voice selection: ${await window.locator('.chapter-audio-requirements').innerText()}; ${await window.locator('#voicevox-license-status').innerText()}`,
        );
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
        await window.waitForFunction(() => Number.isFinite(document.querySelector('.chapter-audio')?.duration)
          && document.querySelector('.chapter-audio').duration > 0, null, { timeout: 30000 });
        if (withLiveVoicevox) {
          await window.waitForFunction(
            () => document.querySelector('.narration-timing-status')?.dataset.state === 'warning',
            null,
            { timeout: 30_000 },
          );
          assert.match(await window.locator('.narration-timing-status').first().innerText(), /音声実尺 \d+\.\d+秒/u);
          assert.match(await window.locator('.narration-timing-status').first().innerText(), /目標との差が±20%を超えています/u);
        }
        if (withVoicevoxFixture) {
          const chapterAudioAsset = JSON.parse(await fs.readFile(path.join(projectDirectory, 'chapters', '01', 'scenario.json'), 'utf8')).audioAsset;
          assert.deepEqual(chapterAudioAsset.mouthTimeline, [
            { start: 0.1, end: 0.35, expression: 'aa' },
            { start: 0.45, end: 0.65, expression: 'ih' },
            { start: 2.1, end: 2.35, expression: 'ou' },
            { start: 2.45, end: 2.65, expression: 'ee' },
          ], 'generated mouth cues should persist with the chapter WAV');
        }
        if (withAudioReplacementFixture) {
          const audioPath = path.join(projectDirectory, 'chapters', '01', 'audio', 'narration.wav');
          const chapterPath = path.join(projectDirectory, 'chapters', '01', 'scenario.json');
          const previousAudio = await fs.readFile(audioPath);
          const previousAudioAsset = JSON.parse(await fs.readFile(chapterPath, 'utf8')).audioAsset;
          await window.getByText('字幕タイミング: 本文と一致', { exact: true }).waitFor();
          await window.locator('.subtitle-text').first().fill('手動編集した字幕を保持します。');
          const firstSubtitleStart = window.locator('.subtitle-start').first();
          const firstSubtitleEnd = window.locator('.subtitle-end').first();
          const originalStartSeconds = Number(await firstSubtitleStart.inputValue());
          const originalEndSeconds = Number(await firstSubtitleEnd.inputValue());
          await firstSubtitleStart.fill((originalStartSeconds + 0.05).toFixed(3));
          await firstSubtitleEnd.fill((originalEndSeconds - 0.05).toFixed(3));
          const preservedSubtitles = await window.locator('.subtitle-row').evaluateAll((rows) => rows.map((row) => ({
            startSeconds: Number(row.querySelector('.subtitle-start').value),
            endSeconds: Number(row.querySelector('.subtitle-end').value),
            text: row.querySelector('.subtitle-text').value,
          })));
          assert.ok(preservedSubtitles[0].startSeconds > originalStartSeconds, 'manual subtitle start adjustment should be applied');
          assert.ok(preservedSubtitles[0].endSeconds < originalEndSeconds, 'manual subtitle end adjustment should be applied');
          const updatedNarration = `${fixtureDraft.chapters[0].narration} 再生成確認。`;
          await window.locator('.chapter-narration').fill(updatedNarration);
          await window.getByText('字幕タイミング: 要確認（章タイトルまたは読み上げ本文が変更されています）', { exact: true }).waitFor();
          assert.match(await window.locator('.chapter-material-status').first().innerText(), /音声: 要更新/);
          assert.match(await window.locator('.chapter-material-status').first().innerText(), /動画: 要更新/);
          await window.locator('#scenario-confirm-button').click();
          await window.locator('#scenario-save-button').click();
          await window.getByText(/プロジェクトを保存しました/).waitFor({ timeout: 30000 });
          assert.deepEqual(await fs.readFile(audioPath), previousAudio, 'saving narration edits should not replace the old WAV');
          assert.equal(JSON.parse(await fs.readFile(chapterPath, 'utf8')).subtitleNarrationHash, previousAudioAsset.narrationHash);
          await window.locator('#model-file').setInputFiles(path.resolve(__dirname, '../../C1.vrm'));
          await window.waitForFunction(() => document.querySelector('#runtime-status')?.textContent === 'VRM 1.0読込完了');
          assert.equal(await window.locator('#video-export-button').isEnabled(), true);
          await window.evaluate(() => { window.confirm = () => true; });
          await window.locator('#video-export-button').click();
          assert.equal(
            await window.locator('#video-export-status').innerText(),
            '読み上げ本文が変更されています。音声を再生成してください。',
          );
          assert.equal(
            await window.locator('.chapter-audio-generate').evaluate((button) => button === document.activeElement),
            true,
            'stale narration export should focus the audio regeneration button',
          );
          assert.deepEqual(await fs.readFile(audioPath), previousAudio, 'stale narration audio should block export without changing the WAV');
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
          assert.equal(JSON.parse(await fs.readFile(chapterPath, 'utf8')).audioAsset, null, 'stale audio metadata should stay invalidated after narration is saved');
          assert.match(await window.locator('.chapter-material-status').first().innerText(), /音声: 要更新/);
          assert.deepEqual(await window.evaluate(() => window.__audioReplacementPrompts), [
            '保存済み音声を新しい音声で置き換えますか？',
          ]);

          await window.evaluate(() => {
            window.__audioReplacementPrompts = [];
            window.confirm = (message) => {
              window.__audioReplacementPrompts.push(message);
              return message === '保存済み音声を新しい音声で置き換えますか？';
            };
          });
          await window.locator('.chapter-audio-generate').click();
          await window.getByText(/^音声を保存しました（\d+\.\d+秒）。/).waitFor({ timeout: 120000 });
          await window.getByText('自動保存済み', { exact: true }).waitFor({ timeout: 30_000 });
          const updatedAudioAsset = JSON.parse(await fs.readFile(chapterPath, 'utf8')).audioAsset;
          assert.notEqual(updatedAudioAsset.narrationHash, previousAudioAsset.narrationHash);
          const retimedSubtitles = await window.locator('.subtitle-row').evaluateAll((rows) => rows.map((row) => ({
            startSeconds: Number(row.querySelector('.subtitle-start').value),
            endSeconds: Number(row.querySelector('.subtitle-end').value),
            text: row.querySelector('.subtitle-text').value,
          })));
          assert.deepEqual(retimedSubtitles.map((subtitle) => subtitle.text), preservedSubtitles.map((subtitle) => subtitle.text));
          assert.notDeepEqual(
            retimedSubtitles.map((subtitle) => [subtitle.startSeconds, subtitle.endSeconds]),
            preservedSubtitles.map((subtitle) => [subtitle.startSeconds, subtitle.endSeconds]),
          );
          assert.ok(retimedSubtitles.every((subtitle) => subtitle.endSeconds - subtitle.startSeconds >= 0.8));
          assert.ok(retimedSubtitles.every((subtitle) => subtitle.endSeconds <= updatedAudioAsset.durationSeconds));
          for (let index = 1; index < retimedSubtitles.length; index += 1) {
            assert.ok(Math.round((retimedSubtitles[index].startSeconds - retimedSubtitles[index - 1].endSeconds) * 1000) >= 200);
          }
          assert.deepEqual(JSON.parse(await fs.readFile(chapterPath, 'utf8')).subtitles, retimedSubtitles);
          await window.getByText('字幕タイミング: 本文と一致', { exact: true }).waitFor();
          assert.deepEqual(await window.evaluate(() => window.__audioReplacementPrompts), [
            '保存済み音声を新しい音声で置き換えますか？',
            '音声から作成した字幕へ置き換えますか？ キャンセルすると手動字幕の本文を保持し、新しい音声に合わせて時刻を再生成します。',
          ]);
          assert.match(await window.locator('.chapter-material-status').first().innerText(), /音声: 最新/);
          assert.equal(
            await window.locator('.chapter-material-status').first().getAttribute('data-state'),
            'needs-attention',
            'a completed audio and subtitle refresh should keep the chapter material summary current',
          );
          console.log('Declined narration replacement preserved the saved WAV; approved audio regeneration retained manually edited subtitles');
          return;
        }
        if (!withLiveVoicevox && !withMissingSubtitleFixture) {
          await window.locator('.chapter-narration').fill('本文を変更したため、音声を再生成して確認します。');
          await window.getByText('読み上げ本文が変更されています。音声を再生成してください。', { exact: true }).waitFor();
          assert.equal(await window.locator('.chapter-audio-generate').isEnabled(), false);
          await window.locator('#scenario-confirm-button').click();
          assert.equal(await window.locator('.chapter-audio-generate').isEnabled(), true);
          await window.locator('.chapter-narration').fill(fixtureDraft.chapters[0].narration);
          assert.equal(await window.locator('.chapter-audio-generate').isEnabled(), false);
          await window.locator('#scenario-confirm-button').click();
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
        assert.equal(
          await window.locator('.chapter-material-status').first().getAttribute('data-state'),
          'needs-attention',
          'a chapter without subtitles should remain in a needs-attention state',
        );
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
      const savedCue = savedSrt.match(/^1\r\n(\d{2}):(\d{2}):(\d{2}),(\d{3}) -->/u);
      assert.ok(savedCue, 'SRT export should contain a formatted first cue');
      assert.match(savedSrt, /変数は値を保存する名前付きの場所です。|変数を宣言します。/u);
      const savedCueStartSeconds = Number(savedCue[1]) * 3600 + Number(savedCue[2]) * 60
        + Number(savedCue[3]) + Number(savedCue[4]) / 1000;
      const chapterCueStartSeconds = Number(await window.locator('.subtitle-start').first().inputValue());
      assert.ok(
        Math.abs(savedCueStartSeconds - chapterCueStartSeconds - 2) <= 0.001,
        'standalone SRT should include the two-second video intro offset',
      );
      if (await window.locator('.subtitle-row').count() > 1) {
        assert.ok(savedSrt.includes('\r\n\r\n'), 'SRT cues should be separated by a blank line');
      }
      assert.equal(await window.locator('.code-stage-row').count(), 2);
      assert.equal(await window.locator('.staged-code-preview').innerText(), '#include <stdio.h>');
      assert.equal(await window.locator('#subtitle-preview').isHidden(), true);
      const openingDuration = await window.locator('.chapter-audio-controls').evaluate((controls) => {
        const audioAsset = JSON.parse(controls.dataset.audioAsset || 'null');
        return audioAsset?.openingDurationSeconds ?? 0;
      });
      const finalStageTime = Number(await window.locator('.code-stage-time').nth(1).inputValue());
      const firstSubtitleStart = Number(await window.locator('.subtitle-start').first().inputValue());
      const codePreviewTime = introSilenceSeconds + openingDuration + finalStageTime;
      const subtitlePreviewTime = introSilenceSeconds + firstSubtitleStart + 0.1;
      await window.locator('#timeline').evaluate((input, seconds) => {
        input.value = String(seconds);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, codePreviewTime);
      assert.equal(await window.locator('.staged-code-preview').innerText(), fixtureDraft.chapters[0].codeExample);
      await window.locator('#timeline').evaluate((input, seconds) => {
        input.value = String(seconds);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, subtitlePreviewTime);
      assert.equal(await window.locator('#subtitle-preview').innerText(), withVoicevoxFixture || withLiveVoicevox
        ? '変数は値を保存する名前付きの場所です。'
        : '変数を宣言します。');
      const compositionBounds = await window.evaluate(() => {
        const stage = document.querySelector('.stage').getBoundingClientRect();
        const board = document.querySelector('#video-code-preview').getBoundingClientRect();
        const subtitle = document.querySelector('#subtitle-preview').getBoundingClientRect();
        return {
          boardBottom: (board.bottom - stage.top) / stage.height,
          subtitleTop: (subtitle.top - stage.top) / stage.height,
        };
      });
      assert.ok(
        compositionBounds.subtitleTop >= compositionBounds.boardBottom,
        `subtitle background should stay below the blackboard (board bottom: ${compositionBounds.boardBottom}, subtitle top: ${compositionBounds.subtitleTop})`,
      );
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
      assert.equal(Number(await window.locator('.chapter-audio').evaluate((audio) => audio.currentTime)), 0);
      await window.locator('#timeline').evaluate((input) => {
        input.value = '2.5';
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
      const lateStageVideoTime = introSilenceSeconds + openingDuration + 11;
      assert.equal(await window.locator('#timeline').getAttribute('max'), String(lateStageVideoTime));
      await window.locator('#timeline').evaluate((input, seconds) => {
        input.value = String(seconds);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, lateStageVideoTime);
      assert.equal(await window.locator('.staged-code-preview').innerText(), '#include <stdio.h>');
      await window.locator('.code-stage-time').nth(1).evaluate((input) => {
        input.value = '1';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const executionVideoTime = introSilenceSeconds + openingDuration + Number(await window.locator('.execution-time').inputValue());
      assert.ok(Number(await window.locator('#timeline').getAttribute('max')) >= executionVideoTime);

      await window.locator('#rewind-button').click();
      assert.equal(await window.locator('#timeline').inputValue(), '0');
      await window.locator('#timeline').evaluate((input, seconds) => {
        input.value = String(seconds);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, codePreviewTime - 0.4);
      await window.locator('#play-button').click();
      await window.waitForFunction(
        ({ expectedCode, expectedTime }) =>
          Number(document.querySelector('#timeline').value) >= expectedTime
          && document.querySelector('.staged-code-preview').textContent === expectedCode,
        {
          expectedCode: fixtureDraft.chapters[0].codeExample,
          expectedTime: codePreviewTime,
        },
        { timeout: 3000 },
      );
      assert.ok(Number(await window.locator('#timeline').inputValue()) >= codePreviewTime);
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
      await window.waitForFunction(
        () => document.querySelector('.chapter-audio').currentTime > 0.15,
        null,
        { timeout: 3000 },
      );
      await window.waitForFunction(
        () => Number(document.querySelector('#timeline').value) > 3.15,
        null,
        { timeout: 3000 },
      );
      assert.ok(Number(await window.locator('#timeline').inputValue()) > 3.15);
      await window.locator('.chapter-audio').evaluate((audio) => audio.pause());
      await window.locator('#rewind-button').click();

      const chapterFieldset = window.locator('#scenario-editor fieldset').first();
      await chapterFieldset.getByRole('button', { name: '字幕を追加' }).click();
      assert.equal(await window.locator('.subtitle-row').count(), withVoicevoxFixture || withLiveVoicevox ? 3 : 2);
      assert.equal(await window.locator('#scenario-review-state').innerText(), '未確認の変更');
      assert.equal(await chapterFieldset.locator('.code-display-mode').count(), 0);
      await chapterFieldset.locator('.code-stage-row button[aria-label="段階を削除"]').last().click();
      assert.equal(await chapterFieldset.locator('.code-stage-row').count(), 1);
      const nextSubtitleStart = Number(await chapterFieldset.locator('.subtitle-start').nth(1).inputValue());
      await chapterFieldset.getByRole('button', { name: '段階を追加' }).click();
      assert.equal(await chapterFieldset.locator('.code-stage-row').count(), 2);
      assert.equal(Number(await chapterFieldset.locator('.code-stage-time').last().inputValue()), nextSubtitleStart);
      await chapterFieldset.getByRole('button', { name: '段階を追加' }).click();
      assert.equal(
        Number(await chapterFieldset.locator('.code-stage-time').last().inputValue()),
        Number(await chapterFieldset.locator('.subtitle-start').nth(2).inputValue()),
      );
      assert.equal(await window.locator('#scenario-review-state').innerText(), '未確認の変更');
      await chapterFieldset.getByRole('button', { name: '段階を削除' }).last().click();
      await chapterFieldset.locator('.code-stage-time').nth(0).fill('0');
      await chapterFieldset.locator('.code-stage-time').nth(1).fill('1');
      await chapterFieldset.getByRole('button', { name: '字幕を削除' }).last().click();
      assert.equal(await window.locator('.subtitle-row').count(), withVoicevoxFixture || withLiveVoicevox ? 2 : 1);

      console.log('Confirming and saving project fixture');
      await window.locator('#scenario-confirm-button').click();
      assert.equal(await window.locator('#scenario-review-state').innerText(), '確認済み');
      await window.locator('#scenario-save-button').click();
      await window.getByText(/プロジェクトを保存しました/).waitFor({ timeout: 30000 });
      const savedProject = JSON.parse(await fs.readFile(path.join(projectDirectory, 'project.json'), 'utf8'));
      assert.equal(savedProject.title, fixtureDraft.title);
      if (withProjectFixture && !withAudioReplacementFixture) {
        assert.deepEqual(savedProject.request, fixtureRequest);
        const chapterPath = path.join(projectDirectory, 'chapters', '01', 'scenario.json');
        const savedChapter = JSON.parse(await fs.readFile(chapterPath, 'utf8'));
        assert.equal(savedChapter.narration, fixtureDraft.chapters[0].narration);
        assert.equal(savedChapter.codeExample, fixtureDraft.chapters[0].codeExample);
        assert.equal(savedChapter.runInput, fixtureDraft.chapters[0].runInput);
        assert.equal(savedChapter.runCode, fixtureDraft.chapters[0].runCode);
        assert.equal(savedChapter.codeDisplayMode, fixtureDraft.chapters[0].codeDisplayMode);
        assert.deepEqual(savedChapter.codeStages, fixtureDraft.chapters[0].codeStages);
        assert.equal(savedChapter.subtitles.length, 2);
        assert.equal(typeof savedChapter.audioAsset?.speakerName, 'string');
        assert.ok(Number.isSafeInteger(savedChapter.audioAsset?.styleId));
        assert.ok(savedChapter.audioAsset?.durationSeconds > 0);
      }
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
      await configureMaterialTermsAutomation(restartedWindow);
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
      if (withProjectFixture && !withAudioReplacementFixture) {
        const savedChapter = JSON.parse(await fs.readFile(
          path.join(projectDirectory, 'chapters', '01', 'scenario.json'),
          'utf8',
        ));
        assert.equal(await restartedWindow.locator('.chapter-narration').inputValue(), savedChapter.narration);
        assert.equal(await restartedWindow.locator('.chapter-code').inputValue(), savedChapter.codeExample);
        assert.equal(await restartedWindow.locator('.c-run-input').inputValue(), savedChapter.runInput);
        assert.deepEqual(await restartedWindow.locator('.code-stage-row').evaluateAll((rows) => rows.map((row) => ({
          atSeconds: Number(row.querySelector('.code-stage-time').value),
          visibleLines: Number(row.querySelector('.code-stage-lines').value),
        }))), savedChapter.codeStages);
        assert.deepEqual(await restartedWindow.locator('.subtitle-row').evaluateAll((rows) => rows.map((row) => ({
          startSeconds: Number(row.querySelector('.subtitle-start').value),
          endSeconds: Number(row.querySelector('.subtitle-end').value),
          text: row.querySelector('.subtitle-text').value,
        }))), savedChapter.subtitles);
      }
      assert.equal(await restartedWindow.locator('#scenario-editor .code-editor:not(.chapter-code)').inputValue(), '80\n');
      assert.equal(await restartedWindow.locator('.code-display-mode').count(), 0);
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
      aiProviderToRestore = (await window.evaluate(() => window.scenarioApi.getAiProvider())).provider;
      await window.waitForFunction(() => !document.querySelector('#scenario-ai-provider').disabled);
      if (aiProviderToRestore !== 'copilot') {
        await window.locator('#scenario-ai-provider').selectOption('copilot');
      }
      await window.waitForFunction(() => document.querySelector('#scenario-ai-provider')?.value === 'copilot');
      assert.equal((await window.evaluate(() => window.scenarioApi.getAiProvider())).provider, 'copilot');
      await app.evaluate(({ dialog }, selectedPath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
      }, projectDirectory);
      await window.locator('#scenario-open-button').click();
      await window.getByText('再確認が必要', { exact: true }).waitFor({ timeout: 30000 });
      const chapterTitle = await window.locator('#scenario-editor fieldset input').first().inputValue();

      await window.locator('#scenario-generate-button').click();
      const failureMessage = withRateLimitFixture
        ? /利用上限に達した可能性/
        : /Copilotへの接続が中断された可能性/;
      await window.waitForFunction(
        () => document.querySelector('#scenario-review-state')?.textContent !== '生成中',
        null,
        { timeout: 30000 },
      );
      assert.match(await window.locator('#scenario-message').innerText(), failureMessage);
      assert.equal(await window.locator('#scenario-review-state').innerText(), '下書き保持中');
      assert.equal(await window.locator('#scenario-generate-button').innerText(), '再試行');
      assert.equal(await window.locator('#scenario-editor fieldset input').first().inputValue(), chapterTitle);
      assert.equal(await window.locator('#scenario-confirm-button').isEnabled(), true);
      console.log(withRateLimitFixture
        ? 'Simulated rate limit preserved the draft and exposed retry'
        : 'Simulated connection failure preserved the draft and exposed retry');
      return;
    }

    if (withCRunnerFixture || withCStopFixture) {
      await app.evaluate(({ dialog }, selectedPath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
        dialog.showMessageBox = async () => ({ response: 0 });
      }, projectDirectory);
      await window.locator('#scenario-open-button').click();
      await window.getByText('再確認が必要', { exact: true }).waitFor({ timeout: 30000 });
      const executeButton = window.locator('#scenario-editor .execution-controls button').first();
      assert.equal(await executeButton.isEnabled(), false, 'unconfirmed C code must not execute');
      await window.locator('#scenario-confirm-button').click();
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
      assert.equal(await executeButton.isEnabled(), false, 'unconfirmed C code must not execute');
      await window.locator('#scenario-confirm-button').click();
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
        if (mode !== expectedFailures.at(-1)[0]) await window.locator('#scenario-confirm-button').click();
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
      await window.locator('#model-file').setInputFiles(path.resolve(__dirname, '../../C1.vrm'));
      await window.waitForFunction(() => document.querySelector('#runtime-status')?.textContent === 'VRM 1.0読込完了');
      await window.locator('#video-export-button').click();
      assert.equal(
        await window.locator('#video-export-status').innerText(),
        '標準入力が変更されています。実行結果を再取得してから書き出してください。',
      );
      assert.equal(
        await window.locator('.chapter-code').first().evaluate((input) => input === document.activeElement),
        true,
        'stale C execution results should direct the user to the code editor before export',
      );
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

    const testVrmPath = process.env.CVIDEO_TEST_VRM_PATH
      ? path.resolve(process.env.CVIDEO_TEST_VRM_PATH)
      : path.resolve(__dirname, '../../C1.vrm');
    await window.locator('#model-file').setInputFiles(testVrmPath);
    await window.waitForFunction(
      () => document.querySelector('#runtime-status')?.textContent === 'VRM 1.0読込完了',
      null,
      { timeout: 30_000 },
    );
    const runtimeStatus = await window.locator('#runtime-status').innerText();
    console.log(`VRM load status: ${runtimeStatus}`);
    if (runtimeStatus !== 'VRM 1.0読込完了') {
      console.log(`Renderer errors: ${consoleErrors.join(' | ') || 'none'}`);
      await window.screenshot({ path: path.resolve(__dirname, '../test-results/electron-failure.png') });
      throw new Error(`VRM failed to load in Electron: ${runtimeStatus}`);
    }
    assert.equal(await window.locator('#video-export-button').isEnabled(), true, 'MP4 export should be enabled after loading a VRM');
    const armHandHeights = await window.evaluate(() => window.__cvideoTestGetArmHandHeights?.());
    assert.ok(
      armHandHeights?.baseline.left !== null
        && armHandHeights?.baseline.right !== null
        && armHandHeights.current.left < armHandHeights.baseline.left - 0.1
        && armHandHeights.current.right < armHandHeights.baseline.right - 0.1,
      `both hands should lower from the VRM bind pose: ${JSON.stringify(armHandHeights)}`,
    );
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
      const restoredPose = await readPoseAt(6.4);
      const expectedHappy = await window.evaluate(() => window.__cvideoTestGetRandomExpressionAt(6.4).happy);
      assert.ok(Math.abs(restoredPose.happy - expectedHappy) < 0.01, 'happy expression should restore the randomized baseline after the gesture');
      console.log('Character action presets animate reproducible VRM poses and restore after each gesture');
      return;
    }
    await window.locator('#timeline').evaluate((input) => {
      input.value = '0';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const modelRotation = await window.evaluate(() => window.__cvideoTestGetModelRotation?.());
    assert.ok(
      Number.isFinite(modelRotation) && Math.abs(modelRotation + Math.PI / 6) < 1e-6,
      `VRM should face 30 degrees to the viewer's left at the initial timeline position (rotation: ${modelRotation})`,
    );
    assert.equal(await window.locator('#model-flip-button').isEnabled(), true);
    await window.locator('#model-flip-button').click();
    assert.ok(
      Math.abs((await window.evaluate(() => window.__cvideoTestGetModelRotation?.())) - 5 * Math.PI / 6) < 1e-6,
      'the flip control should rotate the model by 180 degrees',
    );
    const cameraFrontOffset = await window.evaluate(() => window.__cvideoTestGetCameraFrontOffset?.());
    assert.ok(cameraFrontOffset > 0, `camera should view the VRM from its front side (offset: ${cameraFrontOffset})`);
    const modelScreenX = await window.evaluate(() => window.__cvideoTestGetModelScreenX?.());
    assert.ok(modelScreenX > 0.1, `VRM should be framed to the right of center (screen x: ${modelScreenX})`);
    const modelScreenBoundsX = await window.evaluate(() => window.__cvideoTestGetModelScreenBoundsX?.());
    const boardLayout = await window.locator('#video-code-preview').evaluate((panel) => {
      const stage = panel.closest('.stage');
      const stageBounds = stage.getBoundingClientRect();
      const panelBounds = panel.getBoundingClientRect();
      return {
        right: (panelBounds.right - stageBounds.left) / stageBounds.width,
        width: panelBounds.width / stageBounds.width,
        height: panelBounds.height / stageBounds.height,
        fontSize: getComputedStyle(panel).fontSize,
      };
    });
    const modelLeftOnScreen = ((modelScreenBoundsX?.left ?? -1) + 1) / 2;
    const modelRightOnScreen = ((modelScreenBoundsX?.right ?? 1) + 1) / 2;
    assert.ok(boardLayout.width > 0.63 && boardLayout.height > 0.82, 'the blackboard should be about 1.5 times its former size');
    assert.equal(boardLayout.fontSize, '24px', 'the code font size should increase one step');
    assert.ok(
      modelRightOnScreen < 1,
      `the VRM should remain inside the right edge of the frame (left: ${modelLeftOnScreen}, right: ${modelRightOnScreen})`,
    );
    assert.ok(
      modelLeftOnScreen > boardLayout.right,
      `the VRM should not overlap the enlarged blackboard (VRM left: ${modelLeftOnScreen}, board right: ${boardLayout.right})`,
    );
    const headAndKneeScreenY = await window.evaluate(() => window.__cvideoTestGetHeadAndKneeScreenY?.());
    assert.ok(
      headAndKneeScreenY?.head !== null && headAndKneeScreenY.head < 1,
      `the VRM head should remain inside the top of the frame (screen y: ${headAndKneeScreenY?.head})`,
    );
    for (const [knee, screenY] of Object.entries({ left: headAndKneeScreenY?.leftKnee, right: headAndKneeScreenY?.rightKnee })) {
      assert.ok(
        screenY !== null && screenY !== undefined && screenY > -1,
        `the ${knee} knee should remain inside the bottom of the frame (screen y: ${screenY})`,
      );
    }
    await window.locator('#timeline').evaluate((input) => {
      input.value = '10';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.ok(
      Math.abs((await window.evaluate(() => window.__cvideoTestGetModelRotation?.())) - 5 * Math.PI / 6) < 1e-6,
      'the flipped orientation should remain after seeking to later timestamps',
    );
    if (withCResultFixture) {
      await window.locator('#scenario-confirm-button').click();
      await window.locator('#scenario-save-button').click();
      await window.getByText(/プロジェクトを保存しました/).waitFor({ timeout: 30_000 });
      await window.locator('#video-export-button').click();
      assert.equal(
        await window.locator('#video-export-status').innerText(),
        '標準入力が変更されています。実行結果を再取得してから書き出してください。',
      );
      console.log('Stale C execution result was restored after restart and blocked from MP4 export');
      return;
    } else {
      await window.locator('#video-export-button').click();
      assert.equal(
        await window.locator('#video-export-status').innerText(),
        await window.locator('.scenario-checkbox input').isChecked()
          ? 'この章で使うCコードの実行結果がありません。実行してから書き出してください。'
          : '選択した章に保存済み音声がありません。音声を生成して保存してください。',
      );
    }

    const mouthTimelinePath = path.resolve(__dirname, '../test-results/voicevox-mouth-timeline.json');
    const chapterVideoStatus = window.locator('.chapter-video-status').first();
    const markVideoCurrentForFreshnessCheck = () => chapterVideoStatus.evaluate((status) => {
      status.textContent = '動画: 最新';
      status.dataset.state = 'ready';
      status.closest('fieldset')?.dispatchEvent(new Event('chapter-video-state-change'));
    });
    const seekAndCapture = async (seconds) => window.locator('#timeline').evaluate((input, value) => {
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return document.querySelector('#render-canvas').toDataURL('image/png');
    }, seconds);
    if (withVoicevoxFixture) {
      const savedAudioMouthFrame = await seekAndCapture(introSilenceSeconds + 0.2);
      assert.equal(await window.locator('#mouth-readout').innerText(), '口形: aa', 'saved chapter audio should drive lip sync without importing JSON');
      assert.equal(await seekAndCapture(introSilenceSeconds + 0.2), savedAudioMouthFrame, 'saved audio mouth cues should reproduce the same frame after seeking');
    }
    if (withLiveVoicevox) {
      const mouthTimeline = JSON.parse(await fs.readFile(mouthTimelinePath, 'utf8'));
      await window.locator('#mouth-timeline-file').setInputFiles(mouthTimelinePath);
      await window.waitForFunction(
        () => document.querySelector('#result-readout')?.textContent.includes('口パク時刻表読込完了'),
        null,
        { timeout: 30000 },
      );
      const aaShape = mouthTimeline.mouthTimeline.find((entry) => entry.expression === 'aa');
      const ihShape = mouthTimeline.mouthTimeline.find((entry) => entry.expression === 'ih');
      assert.ok(aaShape && ihShape, 'timeline should contain open and narrow vowel shapes');
      const aaTime = (aaShape.start + aaShape.end) / 2;
      const aaFrame = await seekAndCapture(introSilenceSeconds + aaTime);
      assert.equal(await window.locator('#mouth-readout').innerText(), '口形: aa');
      assert.equal(await seekAndCapture(introSilenceSeconds + aaTime), aaFrame, 'same vowel timestamp should reproduce the frame');
      const ihFrame = await seekAndCapture(introSilenceSeconds + (ihShape.start + ihShape.end) / 2);
      assert.equal(await window.locator('#mouth-readout').innerText(), '口形: ih');
      assert.notEqual(aaFrame, ihFrame, 'different vowels should render different mouth poses');
      console.log('VOICEVOX vowel timeline drives deterministic VRM mouth expressions');
    }

    const motionPath = withMaterialFreshnessFixture
      ? path.join(os.tmpdir(), `c-video-material-freshness-${process.pid}.vrma`)
      : path.resolve(__dirname, '../test-results/three-vrm-test.vrma');
    if (withMaterialFreshnessFixture) {
      syntheticMotionFixturePath = motionPath;
      await writeSyntheticVrmaFixture(motionPath);
    }
    let motionFixtureAvailable = true;
    try {
      await fs.access(motionPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      motionFixtureAvailable = false;
    }
    if (motionFixtureAvailable) {
      assert.ok((await fs.stat(motionPath)).size > 0, 'VRMA fixture should not be empty');
      await window.locator('#result-readout').evaluate((readout) => { readout.textContent = ''; });
      await window.locator('#motion-file').setInputFiles(motionPath);
      await window.waitForFunction(
        () => Boolean(document.querySelector('#result-readout')?.textContent),
        null,
        { timeout: 30000 },
      );
      assert.match(await window.locator('#result-readout').innerText(), /VRMA読込完了/);
      const motionFrameA = await seekAndCapture(3.5);
      const motionFrameB = await seekAndCapture(4);
      const repeatedMotionFrame = await seekAndCapture(3.5);
      assert.notEqual(motionFrameA, motionFrameB, 'VRMA should change the pose at different times');
      assert.equal(motionFrameA, repeatedMotionFrame, 'seeking to the same time should reproduce the pose');
      console.log('VRMA loaded; distinct-time pose and deterministic seek checks passed');
    } else {
      console.warn('VRMA fixture missing; skipping VRMA-specific animation checks');
    }

    if (withMaterialFreshnessFixture) {
      assert.ok(await chapterVideoStatus.count() > 0, 'freshness fixture should contain a chapter video status');
      await markVideoCurrentForFreshnessCheck();
      await window.locator('#mouth-timeline-file').setInputFiles([]);
      await window.locator('#result-readout').evaluate((readout) => { readout.textContent = ''; });
      await window.locator('#mouth-timeline-file').setInputFiles(mouthTimelinePath);
      await window.waitForFunction(
        () => document.querySelector('#result-readout')?.textContent.includes('口パク時刻表読込完了'),
        null,
        { timeout: 30000 },
      );
      assert.match(await chapterVideoStatus.innerText(), /動画: 要更新/);
      assert.equal(
        await window.locator('.chapter-material-status').first().getAttribute('data-state'),
        'needs-attention',
        'a stale video should make the chapter material summary require attention',
      );

      if (motionFixtureAvailable) {
        await markVideoCurrentForFreshnessCheck();
        await window.locator('#motion-file').setInputFiles([]);
        await window.locator('#result-readout').evaluate((readout) => { readout.textContent = ''; });
        await window.locator('#motion-file').setInputFiles(motionPath);
        await window.waitForFunction(
          () => Boolean(document.querySelector('#result-readout')?.textContent),
          null,
          { timeout: 30000 },
        );
        assert.match(await window.locator('#result-readout').innerText(), /VRMA読込完了/);
        assert.match(await chapterVideoStatus.innerText(), /動画: 要更新/);
        assert.equal(
          await window.locator('.chapter-material-status').first().getAttribute('data-state'),
          'needs-attention',
          'a stale video after motion replacement should make the chapter material summary require attention',
        );
      }
      console.log('Changing shared mouth/motion assets marks the chapter video stale');
      return;
    }

    if (projectDirectory) {
      const captureComposition = async (seconds) => window.locator('#timeline').evaluate((input, value) => {
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return {
          frame: document.querySelector('#render-canvas').toDataURL('image/png'),
          code: document.querySelector('.staged-code-preview').textContent,
          subtitle: document.querySelector('#subtitle-preview').textContent,
          mouth: document.querySelector('#mouth-readout').textContent,
          chapterTitle: document.querySelector('#video-chapter-title-preview').textContent,
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
        const previewPixels = context.getImageData(1280, 0, 640, 880).data;
        context.clearRect(0, 0, comparisonCanvas.width, comparisonCanvas.height);
        context.drawImage(exportImage, 0, 0);
        const exportPixels = context.getImageData(1280, 0, 640, 880).data;
        let differingPixels = 0;
        let maximumChannelDelta = 0;
        let pixelsOverOneChannelDelta = 0;
        const differenceBounds = { left: 640, top: 880, right: -1, bottom: -1 };
        for (let index = 0; index < previewPixels.length; index += 4) {
          let pixelMaximumChannelDelta = 0;
          for (let channel = 0; channel < 4; channel += 1) {
            pixelMaximumChannelDelta = Math.max(
              pixelMaximumChannelDelta,
              Math.abs(previewPixels[index + channel] - exportPixels[index + channel]),
            );
          }
          if (pixelMaximumChannelDelta === 0) continue;
          differingPixels += 1;
          maximumChannelDelta = Math.max(maximumChannelDelta, pixelMaximumChannelDelta);
          if (pixelMaximumChannelDelta > 1) pixelsOverOneChannelDelta += 1;
          const pixelNumber = index / 4;
          const pixelX = pixelNumber % 640;
          const pixelY = Math.floor(pixelNumber / 640);
          differenceBounds.left = Math.min(differenceBounds.left, pixelX);
          differenceBounds.top = Math.min(differenceBounds.top, pixelY);
          differenceBounds.right = Math.max(differenceBounds.right, pixelX);
          differenceBounds.bottom = Math.max(differenceBounds.bottom, pixelY);
        }
        return {
          differingPixels,
          comparedPixels: previewPixels.length / 4,
          maximumChannelDelta,
          pixelsOverOneChannelDelta,
          differenceBounds: differingPixels > 0 ? differenceBounds : null,
          exportText,
        };
      }, compositionAtOneSecond.frame);
      assert.deepEqual(
        exportFrameComparison.exportText,
        {
          title: compositionAtOneSecond.chapterTitle,
          code: compositionAtOneSecond.codeOverlay,
          result: compositionAtOneSecond.resultOverlay,
          subtitle: compositionAtOneSecond.subtitle,
        },
        'the text passed into export rendering should match the preview at the same timestamp',
      );
      assert.equal(
        exportFrameComparison.differingPixels,
        0,
        `preview/export avatar pixels should match outside the code and text overlays: ${JSON.stringify(exportFrameComparison)}`,
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
    if (pronunciationRulesToRestore && app) {
      const restoreWindow = await app.firstWindow().catch(() => null);
      await restoreWindow?.evaluate((rules) => window.voicevoxApi?.setPronunciationRules(rules), pronunciationRulesToRestore).catch(() => {});
    }
    await app?.close();
    await stopProcess(viteServer?.server);
    if (syntheticMotionFixturePath) await fs.rm(syntheticMotionFixturePath, { force: true });
    if (projectDirectory) await fs.rm(projectDirectory, { recursive: true, force: true });
    if (externalModelDirectory) await fs.rm(externalModelDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});