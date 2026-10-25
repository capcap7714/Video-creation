import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin } from '@pixiv/three-vrm';
import { createVRMAnimationClip, VRMAnimation, VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';
import { zipSync } from 'fflate';
import {
  checkChapterTimeline,
  ScenarioDraftSchema,
  ScenarioRequestSchema,
  type ScenarioDraft,
  type ScenarioGenerationOutcome,
  type ScenarioRequest,
} from './scenario';

declare global {
  interface Window {
    cProgramApi?: {
      run: (executionId: string, source: string, stdin: string) => Promise<{
        status: string;
        message?: string;
        stdout?: string;
        stderr?: string;
        exitCode?: number | null;
      }>;
      stop: (executionId: string) => Promise<boolean>;
      onOutput: (executionId: string, callback: (stream: 'stdout' | 'stderr', text: string) => void) => () => void;
    };
    scenarioApi?: {
      getAiProvider: () => Promise<{ provider: 'copilot' | 'company-api' }>;
      setAiProvider: (provider: 'copilot' | 'company-api') => Promise<{
        saved: boolean;
        provider: 'copilot' | 'company-api';
        message?: string;
      }>;
      generate: (input: ScenarioRequest, previousDraft: ScenarioDraft | null) => Promise<ScenarioGenerationOutcome>;
      save: (request: ScenarioRequest, draft: ScenarioDraft) => Promise<{
        saved: boolean;
        cancelled?: boolean;
        path?: string;
        message: string;
      }>;
      autoSave: (request: ScenarioRequest, draft: ScenarioDraft) => Promise<{
        saved: boolean;
        unavailable?: boolean;
        invalid?: boolean;
        path?: string;
        message: string;
      }>;
      open: () => Promise<{
        opened: boolean;
        cancelled?: boolean;
        message?: string;
        request?: ScenarioRequest;
        draft?: ScenarioDraft;
      }>;
      exportSubtitles: (
        chapterIndex: number,
        subtitles: { startSeconds: number; endSeconds: number; text: string }[],
      ) => Promise<{ saved: boolean; cancelled?: boolean; message: string }>;
    };
    voicevoxApi?: {
      listSpeakers: () => Promise<{
        connected: boolean;
        speakers: { name: string; styles: { name: string; id: number }[] }[];
        message?: string;
      }>;
      synthesize: (text: string, styleId: number) => Promise<{
        generated: boolean;
        audio?: Uint8Array;
        subtitles?: { startSeconds: number; endSeconds: number; text: string }[];
        message?: string;
      }>;
      saveChapterAudio: (
        chapterIndex: number,
        audio: Uint8Array,
        durationSeconds: number,
        styleId: number,
        narration: string,
        speakerName: string,
      ) => Promise<{
        saved: boolean;
        audioAsset?: ScenarioDraft['chapters'][number]['audioAsset'];
        message?: string;
      }>;
      loadChapterAudio: (chapterIndex: number) => Promise<{
        audioAsset: NonNullable<ScenarioDraft['chapters'][number]['audioAsset']>;
        audio: Uint8Array;
      } | null>;
    };
    videoApi?: {
      checkFfmpeg: () => Promise<{ available: boolean; path?: string; message: string }>;
      startExport: (chapterIndex: number) => Promise<{
        started: boolean;
        cancelled?: boolean;
        exportId?: string;
        frameCount?: number;
        chapterTitle?: string;
        contentDurationSeconds?: number;
        creditText?: string;
        message: string;
      }>;
      writeFrame: (exportId: string, frameIndex: number, frame: Uint8Array) => Promise<{ written: boolean; message?: string }>;
      finishExport: (exportId: string) => Promise<{ saved: boolean; path?: string; message: string }>;
      cancelExport: (exportId: string) => Promise<boolean>;
    };
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#render-canvas')!;
const videoFrameCanvas = document.createElement('canvas');
videoFrameCanvas.width = 1920;
videoFrameCanvas.height = 1080;
const videoFrameContext = videoFrameCanvas.getContext('2d')!;
const fileInput = document.querySelector<HTMLInputElement>('#model-file')!;
const motionInput = document.querySelector<HTMLInputElement>('#motion-file')!;
const mouthTimelineInput = document.querySelector<HTMLInputElement>('#mouth-timeline-file')!;
const timeline = document.querySelector<HTMLInputElement>('#timeline')!;
const timeValue = document.querySelector<HTMLOutputElement>('#time-value')!;
const timelineMarkers = document.querySelector<HTMLSpanElement>('#timeline-markers')!;
const playButton = document.querySelector<HTMLButtonElement>('#play-button')!;
const pauseButton = document.querySelector<HTMLButtonElement>('#pause-button')!;
const rewindButton = document.querySelector<HTMLButtonElement>('#rewind-button')!;
const captureButton = document.querySelector<HTMLButtonElement>('#capture-button')!;
const sequenceButton = document.querySelector<HTMLButtonElement>('#sequence-button')!;
const benchmarkButton = document.querySelector<HTMLButtonElement>('#benchmark-button')!;
const videoExportButton = document.querySelector<HTMLButtonElement>('#video-export-button')!;
const videoCancelButton = document.querySelector<HTMLButtonElement>('#video-cancel-button')!;
const videoExportStatus = document.querySelector<HTMLOutputElement>('#video-export-status')!;
const voicevoxConnectButton = document.querySelector<HTMLButtonElement>('#voicevox-connect-button')!;
const voicevoxStyle = document.querySelector<HTMLSelectElement>('#voicevox-style')!;
const voicevoxText = document.querySelector<HTMLTextAreaElement>('#voicevox-text')!;
const voicevoxGenerateButton = document.querySelector<HTMLButtonElement>('#voicevox-generate-button')!;
const voicevoxAudio = document.querySelector<HTMLAudioElement>('#voicevox-audio')!;
const voicevoxStatus = document.querySelector<HTMLElement>('#voicevox-status')!;
const ffmpegCheckButton = document.querySelector<HTMLButtonElement>('#ffmpeg-check-button')!;
const ffmpegStatus = document.querySelector<HTMLOutputElement>('#ffmpeg-status')!;
const runtimeStatus = document.querySelector<HTMLElement>('#runtime-status')!;
const modelReadout = document.querySelector<HTMLElement>('#model-readout')!;
const mouthReadout = document.querySelector<HTMLElement>('#mouth-readout')!;
const videoCodePreview = document.querySelector<HTMLPreElement>('#video-code-preview')!;
const videoResultPreview = document.querySelector<HTMLPreElement>('#video-result-preview')!;
const subtitlePreview = document.querySelector<HTMLElement>('#subtitle-preview')!;
const creditPreview = document.querySelector<HTMLElement>('#credit-preview')!;
const creditPreviewTitle = document.querySelector<HTMLElement>('#credit-preview-title')!;
const creditPreviewAttribution = document.querySelector<HTMLElement>('#credit-preview-attribution')!;
const resultReadout = document.querySelector<HTMLElement>('#result-readout')!;
const emptyState = document.querySelector<HTMLElement>('#empty-state')!;
const scenarioForm = document.querySelector<HTMLFormElement>('#scenario-request-form')!;
const scenarioEditor = document.querySelector<HTMLDivElement>('#scenario-editor')!;
const scenarioAiProviderSelect = document.querySelector<HTMLSelectElement>('#scenario-ai-provider')!;
const scenarioAiProviderStatus = document.querySelector<HTMLOutputElement>('#scenario-ai-provider-status')!;
const scenarioGenerateButton = document.querySelector<HTMLButtonElement>('#scenario-generate-button')!;
const scenarioConfirmButton = document.querySelector<HTMLButtonElement>('#scenario-confirm-button')!;
const scenarioSaveButton = document.querySelector<HTMLButtonElement>('#scenario-save-button')!;
const scenarioOpenButton = document.querySelector<HTMLButtonElement>('#scenario-open-button')!;
const chapterListActions = document.querySelector<HTMLDivElement>('.chapter-list-actions')!;
const chapterAddButton = document.querySelector<HTMLButtonElement>('#chapter-add-button')!;
const scenarioSaveStatus = document.querySelector<HTMLOutputElement>('#scenario-save-status')!;
const scenarioMessage = document.querySelector<HTMLElement>('#scenario-message')!;
const scenarioReviewState = document.querySelector<HTMLElement>('#scenario-review-state')!;
let scenarioDraft: ScenarioDraft | null = null;
let confirmedScenario: ScenarioDraft | null = null;
let scenarioHasUnsavedChanges = true;
let scenarioAutosaveTimer: ReturnType<typeof setTimeout> | null = null;
let scenarioAutosaveRevision = 0;
let scenarioAutosaveQueue = Promise.resolve();
let scenarioAiProvider: 'copilot' | 'company-api' = 'copilot';
let scenarioAiSettingsReady = false;
let playbackFrame: number | null = null;
let playbackStartedAt = 0;
let playbackOriginSeconds = 0;
let playbackLocked = false;
let voicevoxAudioUrl: string | null = null;
let activeVideoExportId: string | null = null;
const creditDurationSeconds = 3;

function updateScenarioAiProviderUi() {
  scenarioAiProviderSelect.value = scenarioAiProvider;
  scenarioAiProviderSelect.disabled = !scenarioAiSettingsReady;
  scenarioGenerateButton.disabled = !scenarioAiSettingsReady || scenarioAiProvider !== 'copilot';
  scenarioAiProviderStatus.textContent = scenarioAiProvider === 'company-api'
    ? '会社APIは未接続です。生成は停止中です。'
    : 'Copilot SDKでシナリオを生成します。';
}

async function loadScenarioAiProvider() {
  if (!window.scenarioApi) {
    scenarioAiProviderStatus.textContent = 'Electronアプリ内で設定を利用できます。';
    return;
  }
  try {
    const settings = await window.scenarioApi.getAiProvider();
    scenarioAiProvider = settings.provider;
    scenarioAiSettingsReady = true;
    updateScenarioAiProviderUi();
  } catch {
    scenarioAiProviderStatus.textContent = 'AIプロバイダー設定を読み込めませんでした。';
  }
}

scenarioAiProviderSelect.addEventListener('change', async () => {
  const requestedProvider = scenarioAiProviderSelect.value as 'copilot' | 'company-api';
  scenarioAiProviderSelect.disabled = true;
  scenarioAiProviderStatus.textContent = '設定を保存しています。';
  try {
    const result = await window.scenarioApi?.setAiProvider(requestedProvider);
    if (!result?.saved) {
      if (result) scenarioAiProvider = result.provider;
      scenarioAiProviderStatus.textContent = result?.message ?? 'AIプロバイダー設定を保存できませんでした。';
    } else {
      scenarioAiProvider = result.provider;
    }
  } catch {
    scenarioAiProviderStatus.textContent = 'AIプロバイダー設定を保存できませんでした。';
  } finally {
    updateScenarioAiProviderUi();
  }
});

void loadScenarioAiProvider();

function updatePlaybackControls() {
  playButton.disabled = playbackLocked || playbackFrame !== null;
  pauseButton.disabled = playbackLocked || playbackFrame === null;
  rewindButton.disabled = playbackLocked;
}

function getSelectedChapterAudio() {
  return scenarioEditor.querySelector<HTMLInputElement>('.chapter-preview-target:checked')
    ?.closest('fieldset')
    ?.querySelector<HTMLAudioElement>('.chapter-audio') ?? null;
}

function seekTo(seconds: number) {
  const boundedSeconds = Math.max(0, Math.min(seconds, Number(timeline.max)));
  timeline.value = String(boundedSeconds);
  const currentSeconds = Number(timeline.value);
  timeValue.value = `${currentSeconds.toFixed(2)} s`;
  timeValue.textContent = timeValue.value;
  const audio = getSelectedChapterAudio();
  if (audio?.src && Number.isFinite(audio.duration) && Math.abs(audio.currentTime - currentSeconds) > 0.08) {
    audio.currentTime = Math.max(0, Math.min(currentSeconds, audio.duration));
  }
  renderCompositionAt(currentSeconds);
}

function stopPlayback() {
  if (playbackFrame !== null) cancelAnimationFrame(playbackFrame);
  playbackFrame = null;
  getSelectedChapterAudio()?.pause();
  updatePlaybackControls();
}

function advancePlayback(timestamp: number) {
  if (playbackFrame === null) return;
  const frame = Math.floor((timestamp - playbackStartedAt) * 30 / 1000);
  const endSeconds = Number(timeline.max);
  const nextSeconds = Math.min(playbackOriginSeconds + frame / 30, endSeconds);
  seekTo(nextSeconds);
  if (nextSeconds >= endSeconds) {
    stopPlayback();
    return;
  }
  playbackFrame = requestAnimationFrame(advancePlayback);
}

function startPlayback() {
  if (playbackLocked || playbackFrame !== null) return;
  if (Number(timeline.value) >= Number(timeline.max)) seekTo(0);
  playbackOriginSeconds = Number(timeline.value);
  playbackStartedAt = performance.now();
  const audio = getSelectedChapterAudio();
  if (audio?.src && Number.isFinite(audio.duration)) {
    audio.currentTime = Math.min(playbackOriginSeconds, audio.duration);
    void audio.play().catch(() => {
      stopPlayback();
      setResult('章音声を再生できません。音声ファイルを確認してください。');
    });
  }
  playbackFrame = requestAnimationFrame(advancePlayback);
  updatePlaybackControls();
}

function setPlaybackLocked(locked: boolean) {
  playbackLocked = locked;
  updatePlaybackControls();
}

voicevoxConnectButton.addEventListener('click', async () => {
  voicevoxConnectButton.disabled = true;
  voicevoxStatus.textContent = 'VOICEVOX Engineへ接続しています...';
  voicevoxStatus.dataset.state = 'loading';
  try {
    if (!window.voicevoxApi) throw new Error('音声機能はElectronアプリ内で利用できます。');
    const result = await window.voicevoxApi.listSpeakers();
    voicevoxStyle.replaceChildren();
    for (const speaker of result.speakers) {
      for (const style of speaker.styles) {
        const option = document.createElement('option');
        option.value = String(style.id);
        option.textContent = `${speaker.name} / ${style.name}`;
        voicevoxStyle.append(option);
      }
    }
    voicevoxStyle.disabled = !result.connected || voicevoxStyle.options.length === 0;
    voicevoxGenerateButton.disabled = voicevoxStyle.disabled;
    for (const button of scenarioEditor.querySelectorAll<HTMLButtonElement>('.chapter-audio-generate')) {
      const narration = button.closest('fieldset')?.querySelector<HTMLTextAreaElement>('.chapter-narration');
      button.disabled = voicevoxStyle.disabled || !narration || narration.value.trim().length > 1000;
    }
    if (!result.connected) {
      voicevoxStatus.dataset.state = 'error';
      voicevoxStatus.textContent = result.message
        ?? 'VOICEVOX Engineが未起動か接続先が応答していません。Engineを起動し、127.0.0.1:50021を確認して再試行してください。';
    } else if (voicevoxStyle.options.length === 0) {
      voicevoxStatus.dataset.state = 'warning';
      voicevoxStatus.textContent = 'VOICEVOX Engineには接続しましたが、有効な話者スタイルがありません。Engineの話者設定を確認して再試行してください。';
    } else {
      voicevoxStatus.dataset.state = 'ready';
      voicevoxStatus.textContent = `接続しました。${voicevoxStyle.options.length}種類のスタイルを利用できます。`;
    }
  } catch {
    voicevoxStatus.dataset.state = 'error';
    voicevoxStatus.textContent = 'VOICEVOX Engineとの通信に失敗しました。Engineの起動状態と127.0.0.1:50021への接続を確認して再試行してください。';
  } finally {
    voicevoxConnectButton.disabled = false;
  }
});

ffmpegCheckButton.addEventListener('click', async () => {
  ffmpegCheckButton.disabled = true;
  ffmpegStatus.textContent = 'FFmpegを確認しています...';
  try {
    if (!window.videoApi) throw new Error('FFmpeg確認はElectronアプリ内で利用できます。');
    const result = await window.videoApi.checkFfmpeg();
    ffmpegStatus.textContent = result.message;
    ffmpegStatus.dataset.state = result.available ? 'ready' : 'missing';
    if (result.path) ffmpegStatus.title = result.path;
    else ffmpegStatus.removeAttribute('title');
  } catch (error) {
    ffmpegStatus.textContent = error instanceof Error ? error.message : 'FFmpegを確認できません。';
    ffmpegStatus.dataset.state = 'missing';
  } finally {
    ffmpegCheckButton.disabled = false;
  }
});

videoExportButton.addEventListener('click', async () => {
  if (!window.videoApi) {
    videoExportStatus.textContent = 'MP4書き出しはElectronアプリ内で利用できます。';
    return;
  }
  if (!activeVrm) {
    videoExportStatus.textContent = '先にVRMモデルを読み込んでください。';
    return;
  }
  if (scenarioReviewState.textContent !== '確認済み') {
    videoExportStatus.textContent = '章を確認し、プロジェクトを保存してから書き出してください。';
    return;
  }
  if (scenarioHasUnsavedChanges) {
    videoExportStatus.textContent = '確認済みの変更が未保存です。プロジェクトを保存してから書き出してください。';
    return;
  }
  const selectedChapter = scenarioEditor.querySelector<HTMLInputElement>('.chapter-preview-target:checked')?.closest('fieldset');
  const chapterIndex = [...scenarioEditor.querySelectorAll('fieldset')].indexOf(selectedChapter!);
  const codeInput = selectedChapter?.querySelector<HTMLTextAreaElement>('.chapter-code');
  const runInput = selectedChapter?.querySelector<HTMLTextAreaElement>('.c-run-input');
  const runCode = selectedChapter?.querySelector<HTMLInputElement>('.scenario-checkbox input')?.checked ?? false;
  const savedExecutionResult = selectedChapter?.dataset.executionResult
    ? JSON.parse(selectedChapter.dataset.executionResult) as NonNullable<ScenarioDraft['chapters'][number]['executionResult']>
    : null;
  if (selectedChapter && runCode && (
    !savedExecutionResult
    || savedExecutionResult.sourceCode !== codeInput?.value
    || savedExecutionResult.sourceInput !== runInput?.value
  )) {
    videoExportStatus.textContent = !savedExecutionResult
      ? 'この章で使うCコードの実行結果がありません。実行してから書き出してください。'
      : savedExecutionResult.sourceCode !== codeInput?.value
        ? 'Cコードが変更されています。実行結果を再取得してから書き出してください。'
        : '標準入力が変更されています。実行結果を再取得してから書き出してください。';
    codeInput?.focus();
    return;
  }
  const audio = getSelectedChapterAudio();
  const hasSavedAudioAsset = Boolean(selectedChapter?.querySelector<HTMLDivElement>('.chapter-audio-controls')?.dataset.audioAsset);
  if (!selectedChapter || chapterIndex < 0 || !hasSavedAudioAsset || !audio?.src || !Number.isFinite(audio.duration)) {
    const audioStatus = selectedChapter?.querySelector<HTMLSpanElement>('.chapter-audio-status')?.textContent ?? '';
    videoExportStatus.textContent = audioStatus.includes('読み上げ本文が変更されています')
      ? audioStatus
      : '選択した章に保存済み音声がありません。音声を生成して保存してください。';
    const audioRegenerateButton = selectedChapter?.querySelector<HTMLButtonElement>('.chapter-audio-generate');
    (audioRegenerateButton && !audioRegenerateButton.disabled ? audioRegenerateButton : voicevoxConnectButton).focus();
    return;
  }
  const subtitles = [...selectedChapter.querySelectorAll<HTMLDivElement>('.subtitle-row')].map((row) => ({
    startSeconds: Number(row.querySelector<HTMLInputElement>('.subtitle-start')!.value),
    endSeconds: Number(row.querySelector<HTMLInputElement>('.subtitle-end')!.value),
    text: row.querySelector<HTMLTextAreaElement>('.subtitle-text')!.value.trim(),
  }));
  if (subtitles.length === 0) {
    videoExportStatus.textContent = '字幕がありません。SRTを作成するため、字幕を追加してから書き出してください。';
    selectedChapter.querySelector<HTMLButtonElement>('.subtitle-add-button')?.focus();
    return;
  }
  const codeDisplayMode = selectedChapter.querySelector<HTMLInputElement>('.code-display-mode:checked')?.value;
  const codeStages = codeDisplayMode === 'staged'
    ? [...selectedChapter.querySelectorAll<HTMLDivElement>('.code-stage-row')].map((row) => ({
      atSeconds: Number(row.querySelector<HTMLInputElement>('.code-stage-time')!.value),
      visibleLines: Number(row.querySelector<HTMLInputElement>('.code-stage-lines')!.value),
    }))
    : [];
  const executionAtSeconds = Number(selectedChapter.querySelector<HTMLInputElement>('.execution-time')?.value ?? 0);
  const characterActions = [...selectedChapter.querySelectorAll<HTMLDivElement>('.character-action-row')].map((row) => ({
    atSeconds: Number(row.querySelector<HTMLInputElement>('.character-action-time')!.value),
    action: row.querySelector<HTMLSelectElement>('.character-action-type')!.value as 'explain' | 'attention' | 'happy',
  }));
  const timelineIssues = checkChapterTimeline({ subtitles, codeStages, runCode, executionAtSeconds, characterActions }, audio.duration);
  if (timelineIssues.length > 0) {
    videoExportStatus.textContent = `書き出し前チェックで問題が見つかりました。\n${timelineIssues.map((issue) => `・${issue.message}`).join('\n')}`;
    const firstIssue = timelineIssues[0];
    const issueSeconds = firstIssue.target === 'execution'
      ? executionAtSeconds
      : firstIssue.target === 'character-action'
        ? characterActions[firstIssue.index]?.atSeconds
        : firstIssue.target === 'code-stage'
          ? codeStages[firstIssue.index]?.atSeconds
          : firstIssue.field === 'endSeconds'
            ? subtitles[firstIssue.index]?.endSeconds
            : subtitles[firstIssue.index]?.startSeconds;
    if (Number.isFinite(issueSeconds)) seekTo(issueSeconds!);
    if (firstIssue.target === 'execution') {
      selectedChapter.querySelector<HTMLInputElement>('.execution-time')?.focus();
    } else if (firstIssue.target === 'character-action') {
      selectedChapter.querySelectorAll<HTMLDivElement>('.character-action-row')
        .item(firstIssue.index)
        ?.querySelector<HTMLInputElement>('.character-action-time')
        ?.focus();
    } else {
      const rowSelector = firstIssue.target === 'subtitle' ? '.subtitle-row' : '.code-stage-row';
      const inputSelector = firstIssue.target === 'code-stage'
        ? '.code-stage-time'
        : firstIssue.field === 'text' ? '.subtitle-text'
          : firstIssue.field === 'startSeconds' ? '.subtitle-start' : '.subtitle-end';
      selectedChapter.querySelectorAll<HTMLDivElement>(rowSelector)
        .item(firstIssue.index)
        ?.querySelector<HTMLElement>(inputSelector)
        ?.focus();
    }
    return;
  }
  const subtitleNarrationHash = selectedChapter.dataset.subtitleNarrationHash;
  if (subtitleNarrationHash) {
    const narrationText = selectedChapter.querySelector<HTMLTextAreaElement>('.chapter-narration')?.value.trim() ?? '';
    try {
      const currentSubtitleNarrationHash = await hashNarrationText(narrationText);
      if (currentSubtitleNarrationHash !== subtitleNarrationHash && !window.confirm(
        '読み上げ本文が変更されています。字幕の表示タイミングを確認しましたか？ OKで書き出し、キャンセルで字幕編集へ戻ります。',
      )) {
        videoExportStatus.textContent = '字幕タイミングを確認してから書き出してください。';
        selectedChapter.querySelector<HTMLInputElement>('.subtitle-start')?.focus();
        return;
      }
    } catch {
      videoExportStatus.textContent = '字幕タイミングの生成元を確認できません。内容を確認してから再試行してください。';
      selectedChapter.querySelector<HTMLInputElement>('.subtitle-start')?.focus();
      return;
    }
  }
  if (runCode && savedExecutionResult && savedExecutionResult.status !== 'success') {
    const warning = `C実行結果は「${savedExecutionResult.status}」です。内容を確認し、動画に含める場合は続行してください。`;
    if (!window.confirm(warning)) {
      videoExportStatus.textContent = 'C実行結果の注意を確認し、書き出しをキャンセルしました。';
      return;
    }
  }

  stopPlayback();
  setPlaybackLocked(true);
  scenarioEditor.inert = true;
  timeline.disabled = true;
  fileInput.disabled = true;
  motionInput.disabled = true;
  mouthTimelineInput.disabled = true;
  captureButton.disabled = true;
  sequenceButton.disabled = true;
  benchmarkButton.disabled = true;
  videoExportButton.disabled = true;
  videoCancelButton.disabled = true;
  videoExportStatus.textContent = 'FFmpegと章素材を確認しています...';
  try {
    const started = await window.videoApi.startExport(chapterIndex);
    if (!started.started || !started.exportId || !started.frameCount || !started.contentDurationSeconds) {
      videoExportStatus.textContent = started.message;
      return;
    }
    const exportId = started.exportId;
    activeVideoExportId = exportId;
    const contentFrames = Math.ceil(started.contentDurationSeconds * 30);
    videoCancelButton.disabled = false;
    for (let frameIndex = 0; frameIndex < started.frameCount; frameIndex += 1) {
      if (activeVideoExportId !== exportId) throw new Error('動画の書き出しを停止しました。');
      const frame = await createVideoFrame(
        frameIndex,
        contentFrames,
        started.chapterTitle ?? `第${chapterIndex + 1}章`,
        started.creditText ?? 'VOICEVOX',
      );
      const result = await window.videoApi.writeFrame(exportId, frameIndex, frame);
      if (!result.written) throw new Error(result.message ?? '動画フレームを書き込めません。');
      if ((frameIndex + 1) % 30 === 0 || frameIndex + 1 === started.frameCount) {
        const percentage = Math.floor((frameIndex + 1) * 100 / started.frameCount);
        videoExportStatus.textContent = `画面を生成・エンコード中: ${percentage}% (${frameIndex + 1}/${started.frameCount}フレーム)`;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    videoCancelButton.disabled = true;
    const completed = await window.videoApi.finishExport(exportId);
    activeVideoExportId = null;
    if (!completed.saved) throw new Error(completed.message);
    const chapterVideoStatus = selectedChapter.querySelector<HTMLSpanElement>('.chapter-video-status');
    if (chapterVideoStatus) {
      chapterVideoStatus.textContent = '動画: 最新';
      chapterVideoStatus.dataset.state = 'ready';
    }
    videoExportStatus.textContent = `${completed.message} ${completed.path ?? ''}`;
  } catch (error) {
    const exportId = activeVideoExportId;
    activeVideoExportId = null;
    if (exportId) await window.videoApi.cancelExport(exportId).catch(() => false);
    videoExportStatus.textContent = error instanceof Error ? error.message : '動画を書き出せませんでした。';
  } finally {
    scenarioEditor.inert = false;
    timeline.disabled = false;
    fileInput.disabled = false;
    motionInput.disabled = !activeVrm;
    mouthTimelineInput.disabled = !activeVrm;
    captureButton.disabled = !activeVrm;
    sequenceButton.disabled = !activeVrm;
    benchmarkButton.disabled = !activeVrm;
    videoExportButton.disabled = false;
    videoCancelButton.disabled = true;
    setPlaybackLocked(false);
    renderAt(Number(timeline.value));
    syncCodeStagePreviews(Number(timeline.value));
    syncSubtitlePreview(Number(timeline.value));
  }
});

videoCancelButton.addEventListener('click', async () => {
  const exportId = activeVideoExportId;
  if (!exportId || !window.videoApi) return;
  videoCancelButton.disabled = true;
  activeVideoExportId = null;
  await window.videoApi.cancelExport(exportId);
  videoExportStatus.textContent = '動画の書き出しを停止しました。';
});

voicevoxGenerateButton.addEventListener('click', async () => {
  const text = voicevoxText.value.trim();
  const styleId = Number(voicevoxStyle.value);
  if (!text || !Number.isSafeInteger(styleId)) {
    voicevoxStatus.textContent = '試聴テキストと話者・スタイルを確認してください。';
    return;
  }
  voicevoxGenerateButton.disabled = true;
  voicevoxStatus.textContent = 'VOICEVOXで音声を生成しています...';
  try {
    const result = await window.voicevoxApi?.synthesize(text, styleId);
    if (!result?.generated || !result.audio) {
      voicevoxStatus.textContent = result?.message ?? '音声を生成できませんでした。';
      return;
    }
    if (voicevoxAudioUrl) URL.revokeObjectURL(voicevoxAudioUrl);
    const audioBuffer = new ArrayBuffer(result.audio.byteLength);
    new Uint8Array(audioBuffer).set(result.audio);
    voicevoxAudioUrl = URL.createObjectURL(new Blob([audioBuffer], { type: 'audio/wav' }));
    voicevoxAudio.src = voicevoxAudioUrl;
    voicevoxAudio.hidden = false;
    voicevoxAudio.load();
    voicevoxStatus.textContent = '試聴音声を生成しました。再生ボタンで確認できます。';
  } catch {
    voicevoxStatus.textContent = '音声を生成できませんでした。VOICEVOX Engineの状態を確認してください。';
  } finally {
    voicevoxGenerateButton.disabled = voicevoxStyle.disabled;
  }
});

function getCreditRange() {
  const audioDuration = getSelectedChapterAudio()?.duration;
  if (typeof audioDuration !== 'number' || !Number.isFinite(audioDuration) || audioDuration <= 0) return null;
  const startSeconds = Math.ceil(audioDuration * 30 - 1e-9) / 30;
  return { startSeconds, endSeconds: startSeconds + creditDurationSeconds };
}

function refreshTimelineMarkers() {
  const selectedChapter = scenarioEditor.querySelector<HTMLInputElement>('.chapter-preview-target:checked')?.closest('fieldset');
  const maximumTime = Math.max(Number(timeline.max), 0.001);
  const markers = [
    ...(selectedChapter?.querySelectorAll<HTMLDivElement>('.subtitle-row') ?? []),
  ].map((row) => ({
    kind: 'subtitle',
    seconds: Number(row.querySelector<HTMLInputElement>('.subtitle-start')?.value),
    label: '字幕',
  })).concat(
    [...(selectedChapter?.querySelectorAll<HTMLDivElement>('.code-stage-row') ?? [])].map((row) => ({
      kind: 'code-stage',
      seconds: Number(row.querySelector<HTMLInputElement>('.code-stage-time')?.value),
      label: 'コード表示段階',
    })),
    [...(selectedChapter?.querySelectorAll<HTMLDivElement>('.character-action-row') ?? [])].map((row) => {
      const action = row.querySelector<HTMLSelectElement>('.character-action-type')?.value ?? 'explain';
      const actionLabel = { explain: '説明', attention: '注目', happy: '喜び' }[action as 'explain' | 'attention' | 'happy'] ?? '説明';
      return {
        kind: 'character-action',
        seconds: Number(row.querySelector<HTMLInputElement>('.character-action-time')?.value),
        label: `動作: ${actionLabel}`,
      };
    }),
  );
  const executionTimeInput = selectedChapter?.querySelector<HTMLInputElement>('.execution-time');
  if (selectedChapter?.querySelector<HTMLInputElement>('.scenario-checkbox input')?.checked && executionTimeInput) {
    markers.push({ kind: 'execution', seconds: Number(executionTimeInput.value), label: 'C実行結果' });
  }
  const creditRange = getCreditRange();
  if (creditRange) markers.push({ kind: 'credit', seconds: creditRange.startSeconds, label: 'クレジット画面' });

  timelineMarkers.replaceChildren(...markers.filter((marker) => Number.isFinite(marker.seconds) && marker.seconds >= 0).map((marker) => {
    const seconds = Math.min(marker.seconds, maximumTime);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'timeline-marker';
    button.dataset.kind = marker.kind;
    button.style.left = `${seconds / maximumTime * 100}%`;
    button.title = `${marker.label} ${seconds.toFixed(2)}秒へ移動`;
    button.setAttribute('aria-label', button.title);
    button.addEventListener('click', () => {
      timeline.value = String(seconds);
      timeline.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return button;
  }));
}

function refreshTimelineExtent() {
  const selectedChapter = scenarioEditor.querySelector<HTMLInputElement>('.chapter-preview-target:checked')?.closest('fieldset');
  const stageTimes = [...(selectedChapter?.querySelectorAll<HTMLInputElement>('.code-stage-time, .subtitle-end, .execution-time, .character-action-time') ?? [])]
    .map((input) => Number(input.value))
    .filter(Number.isFinite);
  const audioDuration = getSelectedChapterAudio()?.duration;
  const creditRange = getCreditRange();
  const maximumTime = Math.max(
    10,
    ...stageTimes,
    ...(typeof audioDuration === 'number' && Number.isFinite(audioDuration) ? [audioDuration] : []),
    ...(creditRange ? [creditRange.endSeconds] : []),
  );
  timeline.max = String(maximumTime);
  if (Number(timeline.value) > maximumTime) {
    seekTo(maximumTime);
  }
  refreshTimelineMarkers();
}

function syncSubtitlePreview(seconds: number) {
  const selectedChapter = scenarioEditor.querySelector<HTMLInputElement>('.chapter-preview-target:checked')?.closest('fieldset');
  const subtitles = selectedChapter
    ? [...selectedChapter.querySelectorAll<HTMLDivElement>('.subtitle-row')].map((row) => ({
      startSeconds: Number(row.querySelector<HTMLInputElement>('.subtitle-start')!.value),
      endSeconds: Number(row.querySelector<HTMLInputElement>('.subtitle-end')!.value),
      text: row.querySelector<HTMLTextAreaElement>('.subtitle-text')!.value.trim(),
    }))
    : [];
  const tolerance = Math.max(0.0001, Number(timeline.step) / 2);
  const activeSubtitle = subtitles.find((subtitle) =>
    subtitle.text && seconds + tolerance >= subtitle.startSeconds && seconds < subtitle.endSeconds);
  subtitlePreview.textContent = activeSubtitle?.text ?? '';
  subtitlePreview.hidden = !activeSubtitle || !creditPreview.hidden;
}

function syncCodeStagePreviews(seconds: number) {
  for (const previewRange of scenarioEditor.querySelectorAll<HTMLInputElement>('.stage-preview-control input')) {
    previewRange.value = String(seconds);
    previewRange.dispatchEvent(new Event('input'));
  }
  syncVideoComposition(seconds);
}

function syncVideoComposition(seconds: number) {
  const selectedChapter = scenarioEditor.querySelector<HTMLInputElement>('.chapter-preview-target:checked')?.closest('fieldset');
  const creditRange = getCreditRange();
  const showingCredit = Boolean(creditRange && seconds + 0.0001 >= creditRange.startSeconds && seconds < creditRange.endSeconds);
  creditPreview.hidden = !showingCredit;
  if (showingCredit && selectedChapter) {
    creditPreviewTitle.textContent = selectedChapter.querySelector<HTMLInputElement>('.chapter-title')?.value ?? '';
    const audioAssetJson = selectedChapter.querySelector<HTMLDivElement>('.chapter-audio-controls')?.dataset.audioAsset;
    const audioAsset = audioAssetJson ? JSON.parse(audioAssetJson) as { speakerName?: string; styleId?: number } : null;
    const attribution = audioAsset?.speakerName || (audioAsset?.styleId !== undefined
      ? `話者スタイルID ${audioAsset.styleId}`
      : 'VOICEVOX');
    creditPreviewAttribution.textContent = `VOICEVOX: ${attribution}`;
  }
  const code = selectedChapter?.querySelector<HTMLTextAreaElement>('.chapter-code')?.value ?? '';
  const mode = selectedChapter?.querySelector<HTMLInputElement>('.code-display-mode:checked')?.value ?? 'all';
  const codeLines = code.split(/\r?\n/);
  let visibleLineCount = codeLines.length;
  if (mode === 'staged') {
    const tolerance = Math.max(0.0001, Number(timeline.step) / 2);
    const stage = [...(selectedChapter?.querySelectorAll<HTMLDivElement>('.code-stage-row') ?? [])]
      .map((row) => ({
        atSeconds: Number(row.querySelector<HTMLInputElement>('.code-stage-time')!.value),
        visibleLines: Number(row.querySelector<HTMLInputElement>('.code-stage-lines')!.value),
      }))
      .filter((entry) => entry.atSeconds <= seconds + tolerance)
      .sort((left, right) => left.atSeconds - right.atSeconds)
      .at(-1);
    visibleLineCount = stage?.visibleLines ?? 0;
  }
  videoCodePreview.textContent = codeLines.slice(0, visibleLineCount).join('\n');
  videoCodePreview.hidden = showingCredit || videoCodePreview.textContent.length === 0;

  const executionResultText = selectedChapter
    ?.querySelector<HTMLTextAreaElement>('.video-execution-result')?.value.trim() ?? '';
  const executionAtSeconds = Number(selectedChapter?.querySelector<HTMLInputElement>('.execution-time')?.value ?? 0);
  const tolerance = Math.max(0.0001, Number(timeline.step) / 2);
  videoResultPreview.textContent = seconds + tolerance >= executionAtSeconds ? executionResultText : '';
  videoResultPreview.hidden = showingCredit || videoResultPreview.textContent.length === 0;
}

function drawVideoTextPanel(text: string, x: number, y: number, width: number, height: number, fontSize: number, align: CanvasTextAlign = 'left') {
  if (!text.trim()) return;
  const padding = 20;
  videoFrameContext.fillStyle = 'rgba(16, 27, 25, 0.88)';
  videoFrameContext.fillRect(x, y, width, height);
  videoFrameContext.font = `${fontSize}px Consolas, "Yu Gothic UI", sans-serif`;
  videoFrameContext.fillStyle = '#f2f5ed';
  videoFrameContext.textBaseline = 'top';
  videoFrameContext.textAlign = align;
  const maxWidth = width - padding * 2;
  const wrappedLines = text.split('\n').flatMap((sourceLine) => {
    const characters = [...sourceLine];
    const lines: string[] = [];
    let line = '';
    for (const character of characters) {
      if (line && videoFrameContext.measureText(line + character).width > maxWidth) {
        lines.push(line);
        line = character;
      } else {
        line += character;
      }
    }
    lines.push(line);
    return lines;
  });
  const lineHeight = Math.ceil(fontSize * 1.4);
  const maxLines = Math.max(1, Math.floor((height - padding * 2) / lineHeight));
  const visibleLines = wrappedLines.slice(0, maxLines);
  if (wrappedLines.length > maxLines) visibleLines[maxLines - 1] = `${visibleLines[maxLines - 1].slice(0, -1)}…`;
  visibleLines.forEach((line, index) => {
    videoFrameContext.fillText(line, align === 'center' ? x + width / 2 : x + padding, y + padding + index * lineHeight, maxWidth);
  });
}

function drawCreditFrame(chapterTitle: string, creditText: string) {
  videoFrameContext.fillStyle = '#18312d';
  videoFrameContext.fillRect(0, 0, 1920, 1080);
  videoFrameContext.textAlign = 'center';
  videoFrameContext.textBaseline = 'middle';
  videoFrameContext.fillStyle = '#d4a56d';
  videoFrameContext.font = '28px Consolas, "Yu Gothic UI", sans-serif';
  videoFrameContext.fillText('C LANGUAGE / CREDIT', 960, 360);
  videoFrameContext.fillStyle = '#f2f5ed';
  videoFrameContext.font = '56px "Yu Gothic UI", sans-serif';
  videoFrameContext.fillText(chapterTitle, 960, 480, 1500);
  videoFrameContext.font = '36px "Yu Gothic UI", sans-serif';
  videoFrameContext.fillText(creditText, 960, 600, 1500);
}

async function createVideoFrame(frameIndex: number, contentFrames: number, chapterTitle: string, creditText: string) {
  videoFrameContext.clearRect(0, 0, videoFrameCanvas.width, videoFrameCanvas.height);
  if (frameIndex >= contentFrames) {
    drawCreditFrame(chapterTitle, creditText);
  } else {
    const seconds = frameIndex / 30;
    renderCompositionAt(seconds);
    videoFrameContext.fillStyle = '#d4ddd7';
    videoFrameContext.fillRect(0, 0, videoFrameCanvas.width, videoFrameCanvas.height);
    videoFrameContext.strokeStyle = 'rgba(255, 255, 255, 0.17)';
    videoFrameContext.lineWidth = 1;
    for (let x = 0; x <= videoFrameCanvas.width; x += 32) {
      videoFrameContext.beginPath();
      videoFrameContext.moveTo(x + 0.5, 0);
      videoFrameContext.lineTo(x + 0.5, videoFrameCanvas.height);
      videoFrameContext.stroke();
    }
    for (let y = 0; y <= videoFrameCanvas.height; y += 32) {
      videoFrameContext.beginPath();
      videoFrameContext.moveTo(0, y + 0.5);
      videoFrameContext.lineTo(videoFrameCanvas.width, y + 0.5);
      videoFrameContext.stroke();
    }
    videoFrameContext.drawImage(canvas, 0, 0, videoFrameCanvas.width, videoFrameCanvas.height);
    drawVideoTextPanel(videoCodePreview.textContent ?? '', 48, 54, 820, 600, 22);
    drawVideoTextPanel(videoResultPreview.textContent ?? '', 48, 680, 820, 188, 20);
    drawVideoTextPanel(subtitlePreview.hidden ? '' : subtitlePreview.textContent ?? '', 96, 920, 1728, 110, 40, 'center');
  }
  const blob = await new Promise<Blob>((resolve, reject) => {
    videoFrameCanvas.toBlob((frame) => frame ? resolve(frame) : reject(new Error('PNGフレームの生成に失敗しました。')), 'image/png');
  });
  return new Uint8Array(await blob.arrayBuffer());
}

if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('cvideo_test_frame') === '1') {
  const testWindow = window as Window & {
    __cvideoTestCreateVideoFrame?: typeof createVideoFrame;
    __cvideoTestGetModelRotation?: () => number;
    __cvideoTestGetCharacterPose?: () => { head: [number, number, number] | null; happy: number | null };
    __cvideoTestGetCharacterActionAt?: typeof getCharacterActionAt;
    __cvideoTestReadExportText?: () => { code: string; result: string; subtitle: string };
    __cvideoTestLoadScenarioDraft?: (draft: ScenarioDraft) => void;
  };
  testWindow.__cvideoTestCreateVideoFrame = createVideoFrame;
  testWindow.__cvideoTestGetModelRotation = () => activeVrm?.scene.rotation.y ?? Number.NaN;
  testWindow.__cvideoTestGetCharacterPose = () => {
    const head = activeVrm?.humanoid.getNormalizedBoneNode('head');
    return {
      head: head ? [head.rotation.x, head.rotation.y, head.rotation.z] : null,
      happy: activeVrm?.expressionManager?.getValue('happy') ?? null,
    };
  };
  testWindow.__cvideoTestGetCharacterActionAt = getCharacterActionAt;
  testWindow.__cvideoTestLoadScenarioDraft = (draft) => {
    scenarioDraft = structuredClone(draft);
    renderScenarioDraft(scenarioDraft);
  };
  testWindow.__cvideoTestReadExportText = () => ({
    code: videoCodePreview.textContent ?? '',
    result: videoResultPreview.textContent ?? '',
    subtitle: subtitlePreview.hidden ? '' : subtitlePreview.textContent ?? '',
  });
}

function makeField(labelText: string, control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  const label = document.createElement('label');
  label.textContent = labelText;
  label.append(control);
  return label;
}

function renderScenarioDraft(draft: ScenarioDraft) {
  stopPlayback();
  for (const audio of scenarioEditor.querySelectorAll<HTMLAudioElement>('.chapter-audio')) {
    audio.pause();
    if (audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
  }
  scenarioEditor.replaceChildren();
  draft.chapters.forEach((chapter, index) => {
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = `第${index + 1}章`;
    fieldset.append(legend);
    const chapterActions = document.createElement('div');
    chapterActions.className = 'chapter-item-actions';
    for (const [action, label, disabled] of [
      ['move-up', '上へ', index === 0],
      ['move-down', '下へ', index === draft.chapters.length - 1],
      ['remove', '削除', draft.chapters.length <= 1],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.chapterAction = action;
      button.textContent = label;
      button.disabled = disabled;
      button.setAttribute('aria-label', `第${index + 1}章を${label}`);
      chapterActions.append(button);
    }
    fieldset.append(chapterActions);
    const chapterMaterialStatus = document.createElement('p');
    chapterMaterialStatus.className = 'chapter-material-status';
    chapterMaterialStatus.setAttribute('role', 'status');
    chapterMaterialStatus.setAttribute('aria-live', 'polite');
    const chapterVideoStatus = document.createElement('span');
    chapterVideoStatus.className = 'chapter-video-status';
    chapterVideoStatus.textContent = '動画: 状態未確認';
    chapterVideoStatus.dataset.state = 'unknown';
    chapterMaterialStatus.append(chapterVideoStatus);
    fieldset.append(chapterMaterialStatus);

    const previewTargetLabel = document.createElement('label');
    previewTargetLabel.className = 'chapter-preview-target-label';
    const previewTarget = document.createElement('input');
    previewTarget.type = 'radio';
    previewTarget.name = 'chapter-preview-target';
    previewTarget.className = 'chapter-preview-target';
    previewTarget.checked = index === 0;
    previewTarget.setAttribute('aria-label', `第${index + 1}章をプレビュー`);
    previewTarget.addEventListener('change', () => {
      stopPlayback();
      for (const audio of scenarioEditor.querySelectorAll<HTMLAudioElement>('.chapter-audio')) audio.pause();
      refreshTimelineExtent();
      seekTo(Number(timeline.value));
      syncSubtitlePreview(Number(timeline.value));
    });
    previewTargetLabel.append(previewTarget, document.createTextNode('この章をプレビュー'));
    fieldset.append(previewTargetLabel);

    const title = document.createElement('input');
    title.className = 'chapter-title';
    title.value = chapter.title;
    title.maxLength = 80;
    title.required = true;
    fieldset.append(makeField('章タイトル', title));

    const objective = document.createElement('textarea');
    objective.className = 'chapter-objective';
    objective.value = chapter.learningObjective;
    objective.maxLength = 240;
    objective.required = true;
    objective.rows = 2;
    fieldset.append(makeField('学習目標', objective));

    const minutes = document.createElement('input');
    minutes.className = 'chapter-minutes';
    minutes.type = 'number';
    minutes.min = '1';
    minutes.max = '60';
    minutes.value = String(chapter.targetMinutes);
    minutes.required = true;
    fieldset.append(makeField('目標時間（分）', minutes));

    const narration = document.createElement('textarea');
    narration.className = 'chapter-narration';
    narration.value = chapter.narration;
    narration.minLength = 20;
    narration.maxLength = 10000;
    narration.required = true;
    narration.rows = 6;
    fieldset.append(makeField('読み上げ本文', narration));

    const chapterAudioControls = document.createElement('div');
    chapterAudioControls.className = 'chapter-audio-controls';
    const chapterAudioGenerate = document.createElement('button');
    chapterAudioGenerate.type = 'button';
    chapterAudioGenerate.className = 'chapter-audio-generate';
    chapterAudioGenerate.textContent = 'この章の音声を生成／再生成';
    chapterAudioGenerate.disabled = voicevoxStyle.disabled || narration.value.trim().length > 1000;
    const chapterAudioStatus = document.createElement('span');
    chapterAudioStatus.className = 'chapter-audio-status';
    chapterAudioStatus.setAttribute('role', 'status');
    const chapterAudio = document.createElement('audio');
    chapterAudio.className = 'chapter-audio';
    chapterAudio.controls = true;
    chapterAudio.hidden = true;
    let chapterAudioUrl: string | null = null;
    let chapterAudioAsset = chapter.audioAsset ?? null;
    let hasStoredAudioToReplace = Boolean(chapter.audioAsset);
    let savedAudioNarration: string | null = chapter.audioAsset ? chapter.narration : null;
    let subtitleNarrationHash = chapter.subtitleNarrationHash ?? null;
    let generatedSubtitlePendingSave = false;
    if (subtitleNarrationHash) fieldset.dataset.subtitleNarrationHash = subtitleNarrationHash;
    let pendingAudioSave: {
      audio: Uint8Array;
      narration: string;
      styleId: number;
      subtitles: { startSeconds: number; endSeconds: number; text: string }[];
      speakerName: string;
    } | null = null;
    if (chapterAudioAsset) chapterAudioControls.dataset.audioAsset = JSON.stringify(chapterAudioAsset);
    const setChapterAudioSource = (audio: Uint8Array) => {
      if (chapterAudioUrl) URL.revokeObjectURL(chapterAudioUrl);
      const audioBuffer = new ArrayBuffer(audio.byteLength);
      new Uint8Array(audioBuffer).set(audio);
      chapterAudioUrl = URL.createObjectURL(new Blob([audioBuffer], { type: 'audio/wav' }));
      chapterAudio.src = chapterAudioUrl;
      chapterAudio.hidden = false;
      chapterAudio.load();
    };
    narration.addEventListener('input', () => {
      chapterAudioGenerate.disabled = voicevoxStyle.disabled || narration.value.trim().length > 1000;
      if (chapterAudioAsset || chapterAudioUrl) {
        chapterAudioAsset = null;
        delete chapterAudioControls.dataset.audioAsset;
        chapterAudioStatus.textContent = '読み上げ本文が変更されています。音声を再生成してください。';
      }
      refreshChapterMaterialStatus();
      void refreshSubtitleSourceStatus();
    });
    chapterAudio.addEventListener('loadedmetadata', async () => {
      const durationSeconds = chapterAudio.duration;
      refreshTimelineExtent();
      if (!pendingAudioSave) {
        chapterAudioStatus.textContent = `保存済み音声（${durationSeconds.toFixed(2)}秒）を読み込みました。`;
        refreshChapterMaterialStatus();
        return;
      }
      const pending = pendingAudioSave;
      pendingAudioSave = null;
      if (narration.value.trim() !== pending.narration) {
        chapterAudioStatus.textContent = '読み上げ本文が変更されています。音声を再生成してください。';
        refreshChapterMaterialStatus();
        return;
      }
      const subtitlesApplied = applyGeneratedSubtitles(pending.subtitles);
      try {
        const result = await window.voicevoxApi?.saveChapterAudio(
          index,
          pending.audio,
          durationSeconds,
          pending.styleId,
          pending.narration,
          pending.speakerName,
        );
        if (!result?.saved || !result.audioAsset) {
          const subtitleMessage = subtitlesApplied ? `字幕を${pending.subtitles.length}件設定しました。` : '';
          chapterAudioStatus.textContent = `${result?.message ?? '音声をプロジェクトへ保存できませんでした。'} 試聴はできます。 ${subtitleMessage}`;
          refreshChapterMaterialStatus();
          return;
        }
        chapterAudioAsset = result.audioAsset;
        hasStoredAudioToReplace = true;
        savedAudioNarration = pending.narration;
        chapterAudioControls.dataset.audioAsset = JSON.stringify(result.audioAsset);
        const subtitleMessage = subtitlesApplied
          ? `字幕を${pending.subtitles.length}件設定しました。`
          : pending.subtitles.length > 0 ? '既存字幕を保持しました。' : '';
        if (subtitlesApplied) {
          subtitleNarrationHash = result.audioAsset.narrationHash;
          fieldset.dataset.subtitleNarrationHash = subtitleNarrationHash;
          generatedSubtitlePendingSave = false;
        }
        chapterAudioStatus.textContent = `音声を保存しました（${durationSeconds.toFixed(2)}秒）。 ${subtitleMessage}`;
        refreshChapterMaterialStatus();
        void refreshSubtitleSourceStatus();
      } catch {
        chapterAudioStatus.textContent = '音声を生成しましたが、プロジェクトへ保存できませんでした。';
        refreshChapterMaterialStatus();
      }
    });
    chapterAudio.addEventListener('error', () => {
      pendingAudioSave = null;
      chapterAudioStatus.textContent = '音声を読み込めませんでした。再生成してください。';
      refreshChapterMaterialStatus();
    });
    chapterAudio.addEventListener('timeupdate', () => {
      if (getSelectedChapterAudio() === chapterAudio && !chapterAudio.paused && playbackFrame === null) {
        seekTo(chapterAudio.currentTime);
      }
    });
    chapterAudioGenerate.addEventListener('click', async () => {
      const styleId = Number(voicevoxStyle.value);
      const text = narration.value.trim();
      if (!window.voicevoxApi || !text || text.length > 1000 || !Number.isSafeInteger(styleId)) {
        chapterAudioStatus.textContent = 'Engine接続、話者・スタイル、本文（1000文字以内）を確認してください。';
        return;
      }
      if (hasStoredAudioToReplace && !window.confirm('保存済み音声を新しい音声で置き換えますか？')) {
        chapterAudioStatus.textContent = '音声の再生成をキャンセルしました。保存済み音声は保持されています。';
        refreshChapterMaterialStatus();
        return;
      }
      chapterAudioGenerate.disabled = true;
      chapterAudioStatus.textContent = 'VOICEVOXで章の音声を生成しています...';
      try {
        const result = await window.voicevoxApi.synthesize(text, styleId);
        if (!result.generated || !result.audio) {
          chapterAudioStatus.textContent = result.message ?? '章の音声を生成できませんでした。';
          return;
        }
        pendingAudioSave = {
          audio: result.audio,
          narration: text,
          styleId,
          subtitles: result.subtitles ?? [],
          speakerName: voicevoxStyle.selectedOptions[0]?.textContent?.trim() || '話者名未記録',
        };
        chapterAudioStatus.textContent = '音声を生成しました。長さを読み込んでいます...';
        setChapterAudioSource(result.audio);
      } catch {
        chapterAudioStatus.textContent = '章の音声を生成できませんでした。VOICEVOX Engineの状態を確認してください。';
      } finally {
        chapterAudioGenerate.disabled = voicevoxStyle.disabled || narration.value.trim().length > 1000;
      }
    });
    chapterAudioControls.append(chapterAudioGenerate, chapterAudioStatus, chapterAudio);
    fieldset.append(chapterAudioControls);

    const subtitleEditor = document.createElement('div');
    subtitleEditor.className = 'subtitle-editor';
    const subtitleList = document.createElement('div');
    subtitleList.className = 'subtitle-list';
    const subtitleSourceStatus = document.createElement('output');
    subtitleSourceStatus.className = 'subtitle-source-status';
    subtitleSourceStatus.setAttribute('role', 'status');
    const subtitleAddButton = document.createElement('button');
    subtitleAddButton.type = 'button';
    subtitleAddButton.className = 'subtitle-add-button';
    subtitleAddButton.textContent = '字幕を追加';
    const subtitleExportButton = document.createElement('button');
    subtitleExportButton.type = 'button';
    subtitleExportButton.className = 'subtitle-export-button';
    subtitleExportButton.textContent = 'SRTを書き出す';
    subtitleExportButton.disabled = true;
    const subtitleExportStatus = document.createElement('span');
    subtitleExportStatus.setAttribute('role', 'status');
    const readSubtitleRows = () => [...subtitleList.querySelectorAll<HTMLDivElement>('.subtitle-row')].map((row) => ({
      startSeconds: Number(row.querySelector<HTMLInputElement>('.subtitle-start')!.value),
      endSeconds: Number(row.querySelector<HTMLInputElement>('.subtitle-end')!.value),
      text: row.querySelector<HTMLTextAreaElement>('.subtitle-text')!.value,
    }));
    let subtitleStatusRevision = 0;
    const refreshSubtitleSourceStatus = async () => {
      const revision = ++subtitleStatusRevision;
      if (subtitleList.querySelectorAll('.subtitle-row').length === 0) {
        subtitleSourceStatus.textContent = '';
        subtitleSourceStatus.removeAttribute('data-state');
        return;
      }
      if (generatedSubtitlePendingSave) {
        subtitleSourceStatus.textContent = '字幕タイミング: 音声保存を確認中';
        subtitleSourceStatus.dataset.state = 'warning';
        return;
      }
      if (!subtitleNarrationHash) {
        subtitleSourceStatus.textContent = '字幕タイミング: 手動確認';
        subtitleSourceStatus.dataset.state = 'manual';
        return;
      }
      try {
        const currentHash = await hashNarrationText(narration.value.trim());
        if (revision !== subtitleStatusRevision) return;
        const isStale = currentHash !== subtitleNarrationHash;
        subtitleSourceStatus.textContent = isStale
          ? '字幕タイミング: 要確認（読み上げ本文が変更されています）'
          : '字幕タイミング: 本文と一致';
        subtitleSourceStatus.dataset.state = isStale ? 'stale' : 'ready';
      } catch {
        if (revision !== subtitleStatusRevision) return;
        subtitleSourceStatus.textContent = '字幕タイミングを確認できません。内容を確認してください。';
        subtitleSourceStatus.dataset.state = 'warning';
      }
    };
    const addSubtitleRow = (subtitle: { startSeconds: number; endSeconds: number; text: string }) => {
      const row = document.createElement('div');
      row.className = 'subtitle-row';
      const start = document.createElement('input');
      start.type = 'number';
      start.min = '0';
      start.max = '3600';
      start.step = '0.1';
      start.required = true;
      start.value = String(subtitle.startSeconds);
      start.className = 'subtitle-start';
      row.append(makeField('開始（秒）', start));

      const end = document.createElement('input');
      end.type = 'number';
      end.min = '0';
      end.max = '3600';
      end.step = '0.1';
      end.required = true;
      end.value = String(subtitle.endSeconds);
      end.className = 'subtitle-end';
      row.append(makeField('終了（秒）', end));

      const text = document.createElement('textarea');
      text.required = true;
      text.maxLength = 1000;
      text.rows = 2;
      text.value = subtitle.text;
      text.className = 'subtitle-text';
      row.append(makeField('字幕', text));

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.textContent = '削除';
      removeButton.setAttribute('aria-label', '字幕を削除');
      removeButton.addEventListener('click', () => {
        row.remove();
        subtitleExportButton.disabled = !subtitleList.querySelector('.subtitle-row');
        markScenarioAsUnconfirmed();
        void refreshSubtitleSourceStatus();
        refreshTimelineExtent();
        syncSubtitlePreview(Number(timeline.value));
      });
      row.append(removeButton);
      row.addEventListener('input', () => {
        refreshTimelineExtent();
        syncSubtitlePreview(Number(timeline.value));
      });
      subtitleList.append(row);
      subtitleExportButton.disabled = false;
    };
    const applyGeneratedSubtitles = (subtitles: { startSeconds: number; endSeconds: number; text: string }[]) => {
      if (subtitles.length === 0) return false;
      if (
        subtitleList.querySelector('.subtitle-row')
        && !window.confirm('音声から作成した字幕で現在の字幕を置き換えますか？')
      ) return false;
      subtitleList.replaceChildren();
      subtitles.forEach(addSubtitleRow);
      generatedSubtitlePendingSave = true;
      markScenarioAsUnconfirmed();
      void refreshSubtitleSourceStatus();
      refreshTimelineExtent();
      syncSubtitlePreview(Number(timeline.value));
      return true;
    };
    for (const subtitle of chapter.subtitles ?? []) addSubtitleRow(subtitle);
    subtitleAddButton.addEventListener('click', () => {
      const previous = readSubtitleRows().at(-1);
      const startSeconds = previous?.endSeconds ?? 0;
      addSubtitleRow({ startSeconds, endSeconds: startSeconds + 3, text: '' });
      markScenarioAsUnconfirmed();
      void refreshSubtitleSourceStatus();
      refreshTimelineExtent();
      syncSubtitlePreview(Number(timeline.value));
    });
    subtitleExportButton.addEventListener('click', async () => {
      if (!window.scenarioApi?.exportSubtitles) {
        subtitleExportStatus.textContent = 'SRT書き出しはElectronアプリ内で利用できます。';
        return;
      }
      subtitleExportButton.disabled = true;
      try {
        const result = await window.scenarioApi.exportSubtitles(index, readSubtitleRows());
        subtitleExportStatus.textContent = result.message;
      } catch {
        subtitleExportStatus.textContent = 'SRTを書き出せませんでした。字幕を確認して再試行してください。';
      } finally {
        subtitleExportButton.disabled = !subtitleList.querySelector('.subtitle-row');
      }
    });
    subtitleEditor.append(subtitleSourceStatus, subtitleList, subtitleAddButton, subtitleExportButton, subtitleExportStatus);
    void refreshSubtitleSourceStatus();
    fieldset.append(subtitleEditor);

    const characterActionEditor = document.createElement('div');
    characterActionEditor.className = 'character-action-editor';
    const characterActionList = document.createElement('div');
    characterActionList.className = 'character-action-list';
    const addCharacterActionButton = document.createElement('button');
    addCharacterActionButton.type = 'button';
    addCharacterActionButton.textContent = '動作を追加';
    const addCharacterActionRow = (item: ScenarioDraft['chapters'][number]['characterActions'][number]) => {
      const row = document.createElement('div');
      row.className = 'character-action-row';
      const atSeconds = document.createElement('input');
      atSeconds.type = 'number';
      atSeconds.min = '0';
      atSeconds.max = '3600';
      atSeconds.step = '0.1';
      atSeconds.required = true;
      atSeconds.value = String(item.atSeconds);
      atSeconds.className = 'character-action-time';
      row.append(makeField('時刻（秒）', atSeconds));

      const actionType = document.createElement('select');
      actionType.className = 'character-action-type';
      for (const [value, labelText] of [['explain', '説明'], ['attention', '注目'], ['happy', '喜び']] as const) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = labelText;
        option.selected = item.action === value;
        actionType.append(option);
      }
      row.append(makeField('動作プリセット', actionType));

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.textContent = '削除';
      removeButton.setAttribute('aria-label', 'キャラクター動作を削除');
      removeButton.addEventListener('click', () => {
        row.remove();
        addCharacterActionButton.disabled = characterActionList.querySelectorAll('.character-action-row').length >= 100;
        markScenarioAsUnconfirmed();
        refreshTimelineExtent();
        syncVideoComposition(Number(timeline.value));
      });
      row.append(removeButton);
      const refreshAction = () => {
        refreshTimelineExtent();
        syncVideoComposition(Number(timeline.value));
      };
      row.addEventListener('input', refreshAction);
      row.addEventListener('change', refreshAction);
      characterActionList.append(row);
    };
    for (const action of chapter.characterActions ?? []) addCharacterActionRow(action);
    addCharacterActionButton.addEventListener('click', () => {
      if (characterActionList.querySelectorAll('.character-action-row').length >= 100) return;
      const previous = [...characterActionList.querySelectorAll<HTMLDivElement>('.character-action-row')].at(-1);
      const previousTime = Number(previous?.querySelector<HTMLInputElement>('.character-action-time')?.value);
      addCharacterActionRow({
        atSeconds: Number.isFinite(previousTime) ? previousTime + 1 : 0,
        action: 'explain',
      });
      addCharacterActionButton.disabled = characterActionList.querySelectorAll('.character-action-row').length >= 100;
      markScenarioAsUnconfirmed();
      refreshTimelineExtent();
      syncVideoComposition(Number(timeline.value));
    });
    addCharacterActionButton.disabled = characterActionList.querySelectorAll('.character-action-row').length >= 100;
    characterActionEditor.append(characterActionList, addCharacterActionButton);
    const characterActionSection = document.createElement('div');
    characterActionSection.className = 'character-action-section';
    const characterActionHeading = document.createElement('span');
    characterActionHeading.className = 'code-stage-label';
    characterActionHeading.textContent = 'キャラクター動作';
    characterActionSection.append(characterActionHeading, characterActionEditor);
    fieldset.append(characterActionSection);

    const code = document.createElement('textarea');
    code.className = 'code-editor chapter-code';
    code.value = chapter.codeExample ?? '';
    code.maxLength = 5000;
    code.rows = 5;
    code.spellcheck = false;
    fieldset.append(makeField('C17コード例（任意）', code));

    const codeModeLabel = document.createElement('span');
    codeModeLabel.className = 'code-stage-label';
    codeModeLabel.textContent = 'コードの表示方法';
    const codeModeControl = document.createElement('div');
    codeModeControl.className = 'code-display-modes';
    const modeRadios: HTMLInputElement[] = [];
    for (const [value, labelText] of [['all', '一括表示'], ['staged', '段階表示']] as const) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `code-display-mode-${index}`;
      radio.value = value;
      radio.checked = (chapter.codeDisplayMode ?? 'all') === value;
      radio.className = 'code-display-mode';
      label.append(radio, document.createTextNode(labelText));
      codeModeControl.append(label);
      modeRadios.push(radio);
    }
    fieldset.append(codeModeLabel, codeModeControl);

    const stageEditor = document.createElement('div');
    stageEditor.className = 'code-stage-editor';
    const stageList = document.createElement('div');
    stageList.className = 'code-stage-list';
    const stageAddButton = document.createElement('button');
    stageAddButton.type = 'button';
    stageAddButton.textContent = '段階を追加';
    const previewLabel = document.createElement('label');
    previewLabel.className = 'stage-preview-control';
    previewLabel.append(document.createTextNode('段階プレビュー'));
    const previewRange = document.createElement('input');
    previewRange.type = 'range';
    previewRange.min = '0';
    previewRange.max = '0';
    previewRange.step = 'any';
    previewRange.value = '0';
    const previewTime = document.createElement('output');
    previewLabel.append(previewRange, previewTime);
    const stagedPreview = document.createElement('pre');
    stagedPreview.className = 'execution-output staged-code-preview';
    stageEditor.append(stageList, stageAddButton, previewLabel, stagedPreview);

    const getCodeLineCount = () => Math.max(code.value.split(/\r?\n/).length, 1);
    const readStageRows = () => [...stageList.querySelectorAll<HTMLDivElement>('.code-stage-row')].map((row) => ({
      atSeconds: Number(row.querySelector<HTMLInputElement>('.code-stage-time')!.value),
      visibleLines: Number(row.querySelector<HTMLInputElement>('.code-stage-lines')!.value),
    }));
    const addStageRow = (stage: { atSeconds: number; visibleLines: number }) => {
      const row = document.createElement('div');
      row.className = 'code-stage-row';
      const atSeconds = document.createElement('input');
      atSeconds.type = 'number';
      atSeconds.min = '0';
      atSeconds.max = '3600';
      atSeconds.step = '0.1';
      atSeconds.value = String(stage.atSeconds);
      atSeconds.required = true;
      atSeconds.className = 'code-stage-time';
      row.append(makeField('表示時刻（秒）', atSeconds));

      const visibleLines = document.createElement('input');
      visibleLines.type = 'number';
      visibleLines.min = '1';
      visibleLines.max = String(Math.min(getCodeLineCount(), 1000));
      visibleLines.value = String(Math.min(stage.visibleLines, getCodeLineCount()));
      visibleLines.required = true;
      visibleLines.className = 'code-stage-lines';
      row.append(makeField('表示行数', visibleLines));

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.textContent = '削除';
      removeButton.setAttribute('aria-label', '段階を削除');
      removeButton.addEventListener('click', () => {
        row.remove();
        markScenarioAsUnconfirmed();
        refreshStagePreview();
        refreshTimelineExtent();
        if (modeRadios[1].checked && readStageRows().length === 0) {
          addStageRow({ atSeconds: 0, visibleLines: 1 });
          refreshStagePreview();
          refreshTimelineExtent();
        }
      });
      row.append(removeButton);
      row.addEventListener('input', () => {
        refreshStagePreview();
        refreshTimelineExtent();
      });
      stageList.append(row);
    };
    const refreshStagePreview = () => {
      const stages = readStageRows();
      const codeLineCount = getCodeLineCount();
      for (const row of stageList.querySelectorAll<HTMLDivElement>('.code-stage-row')) {
        const lineInput = row.querySelector<HTMLInputElement>('.code-stage-lines')!;
        lineInput.max = String(Math.min(codeLineCount, 1000));
        lineInput.value = String(Math.min(Number(lineInput.value), codeLineCount));
      }
      previewRange.max = String(Math.max(0, ...stages.map((stage) => stage.atSeconds)));
      const previewSeconds = Number(previewRange.value);
      const frameTolerance = Math.max(0.0001, Number(timeline.step) / 2);
      const stage = stages
        .filter((entry) => entry.atSeconds <= previewSeconds + frameTolerance)
        .sort((left, right) => left.atSeconds - right.atSeconds)
        .at(-1);
      previewTime.textContent = stage
        ? `${previewSeconds.toFixed(1)}秒 / ${stage.visibleLines}行`
        : `${previewSeconds.toFixed(1)}秒 / 表示前`;
      stagedPreview.textContent = stage
        ? code.value.split(/\r?\n/).slice(0, stage.visibleLines).join('\n')
        : '';
      stageEditor.hidden = !modeRadios[1].checked;
    };
    for (const stage of chapter.codeStages ?? []) addStageRow(stage);
    stageAddButton.addEventListener('click', () => {
      const stages = readStageRows();
      const previous = stages.at(-1);
      addStageRow({
        atSeconds: previous ? previous.atSeconds + 1 : 0,
        visibleLines: Math.min(previous ? previous.visibleLines + 1 : 1, getCodeLineCount()),
      });
      markScenarioAsUnconfirmed();
      refreshStagePreview();
      refreshTimelineExtent();
    });
    previewRange.addEventListener('input', refreshStagePreview);
    for (const radio of modeRadios) {
      radio.addEventListener('change', () => {
        if (modeRadios[1].checked && readStageRows().length === 0) {
          addStageRow({ atSeconds: 0, visibleLines: 1 });
        }
        refreshStagePreview();
      });
    }
    code.addEventListener('input', refreshStagePreview);
    refreshStagePreview();
    fieldset.append(stageEditor);

    const runCodeLabel = document.createElement('label');
    runCodeLabel.className = 'scenario-checkbox';
    const runCode = document.createElement('input');
    runCode.type = 'checkbox';
    runCode.checked = chapter.runCode;
    runCodeLabel.append(runCode, document.createTextNode('この章でコードを実行する'));
    fieldset.append(runCodeLabel);

    const executionTime = document.createElement('input');
    executionTime.type = 'number';
    executionTime.min = '0';
    executionTime.max = '3600';
    executionTime.step = '0.1';
    executionTime.required = true;
    executionTime.className = 'execution-time';
    executionTime.value = String(chapter.executionAtSeconds ?? 0);
    executionTime.disabled = !runCode.checked;
    fieldset.append(makeField('C実行結果の表示時刻（秒）', executionTime));
    executionTime.addEventListener('input', refreshTimelineExtent);

    const runInput = document.createElement('textarea');
    runInput.value = chapter.runInput ?? '';
    runInput.maxLength = 1024 * 1024;
    runInput.rows = 3;
    runInput.spellcheck = false;
    runInput.className = 'code-editor c-run-input';
    fieldset.append(makeField('標準入力', runInput));
    const refreshChapterMaterialStatus = () => {
      const audioIsStale = savedAudioNarration !== null && narration.value !== savedAudioNarration;
      const audioState = audioIsStale
        ? '音声: 要更新'
        : chapterAudioControls.dataset.audioAsset
          ? '音声: 最新'
          : chapterAudioUrl ? '音声: 未保存' : '音声: 未生成';
      const savedResult = fieldset.dataset.executionResult
        ? JSON.parse(fieldset.dataset.executionResult) as NonNullable<ScenarioDraft['chapters'][number]['executionResult']>
        : null;
      const executionIsStale = Boolean(savedResult) && (
        savedResult!.sourceCode !== code.value || savedResult!.sourceInput !== runInput.value
      );
      const executionState = runCode.checked
        ? !savedResult ? 'C実行結果: 未実行'
          : executionIsStale ? 'C実行結果: 要更新' : `C実行結果: ${savedResult.status}`
        : '';
      chapterMaterialStatus.replaceChildren(
        document.createTextNode(`${[audioState, executionState].filter(Boolean).join(' / ')}${audioState || executionState ? ' / ' : ''}`),
        chapterVideoStatus,
      );
      chapterMaterialStatus.dataset.state = audioIsStale || !chapterAudioControls.dataset.audioAsset
        || (runCode.checked && (!savedResult || executionIsStale)) ? 'needs-attention' : 'ready';
    };
    const markChapterVideoStale = () => {
      chapterVideoStatus.textContent = '動画: 要更新';
      chapterVideoStatus.dataset.state = 'stale';
      refreshChapterMaterialStatus();
    };
    fieldset.addEventListener('input', markChapterVideoStale);
    fieldset.addEventListener('change', markChapterVideoStale);
    fieldset.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('button')) markChapterVideoStale();
    });
    refreshChapterMaterialStatus();

    const executionControls = document.createElement('div');
    executionControls.className = 'execution-controls';
    const executeButton = document.createElement('button');
    executeButton.type = 'button';
    executeButton.textContent = 'コンパイル・実行';
    executeButton.disabled = !chapter.runCode || chapter.codeExample === null;
    const stopButton = document.createElement('button');
    stopButton.type = 'button';
    stopButton.textContent = '停止';
    stopButton.disabled = true;
    executionControls.append(executeButton, stopButton);
    fieldset.append(executionControls);

    const securityNotice = document.createElement('p');
    securityNotice.className = 'execution-notice';
    securityNotice.textContent = '実行コードは現在のWindowsユーザー権限で動作し、OSサンドボックスでは隔離されません。信頼できるコードだけ実行してください。';
    fieldset.append(securityNotice);

    const executionStatus = document.createElement('p');
    executionStatus.className = 'execution-status';
    executionStatus.setAttribute('role', 'status');
    executionStatus.setAttribute('aria-live', 'polite');
    const stdoutOutput = document.createElement('pre');
    stdoutOutput.className = 'execution-output';
    stdoutOutput.setAttribute('aria-label', '標準出力');
    const stderrOutput = document.createElement('pre');
    stderrOutput.className = 'execution-output execution-stderr';
    stderrOutput.setAttribute('aria-label', '標準エラー');
    const videoExecutionResult = document.createElement('textarea');
    videoExecutionResult.className = 'video-execution-result';
    videoExecutionResult.maxLength = 1024 * 1024;
    videoExecutionResult.rows = 4;
    videoExecutionResult.spellcheck = false;
    videoExecutionResult.value = chapter.executionResult?.videoText ?? '';
    const getExecutionStatus = (savedResult: NonNullable<ScenarioDraft['chapters'][number]['executionResult']>) => {
      if (savedResult.sourceCode !== code.value) return 'Cコードが変更されています。実行結果は要更新です。';
      if (savedResult.sourceInput !== runInput.value) return '標準入力が変更されています。実行結果は要更新です。';
      return `保存済み実行状態: ${savedResult.status}`;
    };
    if (chapter.executionResult) {
      fieldset.dataset.executionResult = JSON.stringify(chapter.executionResult);
      stdoutOutput.textContent = chapter.executionResult.stdout;
      stderrOutput.textContent = chapter.executionResult.stderr;
      executionStatus.textContent = getExecutionStatus(chapter.executionResult);
    }
    refreshChapterMaterialStatus();
    fieldset.append(
      executionStatus,
      stdoutOutput,
      stderrOutput,
      makeField('動画に使う実行結果（編集可）', videoExecutionResult),
    );
    let activeExecutionId: string | null = null;

    const updateExecuteAvailability = () => {
      executeButton.disabled = !runCode.checked || code.value.trim().length === 0;
    };
    runCode.addEventListener('change', () => {
      updateExecuteAvailability();
      executionTime.disabled = !runCode.checked;
      refreshChapterMaterialStatus();
      refreshTimelineExtent();
    });
    code.addEventListener('input', updateExecuteAvailability);
    code.addEventListener('input', () => {
      if (fieldset.dataset.executionResult) {
        const savedResult = JSON.parse(fieldset.dataset.executionResult) as NonNullable<ScenarioDraft['chapters'][number]['executionResult']>;
        executionStatus.textContent = getExecutionStatus(savedResult);
      }
      refreshChapterMaterialStatus();
    });
    runInput.addEventListener('input', () => {
      if (fieldset.dataset.executionResult) {
        const savedResult = JSON.parse(fieldset.dataset.executionResult) as NonNullable<ScenarioDraft['chapters'][number]['executionResult']>;
        executionStatus.textContent = getExecutionStatus(savedResult);
      }
      refreshChapterMaterialStatus();
    });
    executeButton.addEventListener('click', async () => {
      if (!window.cProgramApi) {
        executionStatus.textContent = 'Cコード実行はElectronアプリ内で利用できます。';
        return;
      }
      const executionId = crypto.randomUUID();
      activeExecutionId = executionId;
      executeButton.disabled = true;
      stopButton.disabled = false;
      executionStatus.textContent = 'C17でコンパイルしています。';
      stdoutOutput.textContent = '';
      stderrOutput.textContent = '';
      const removeOutputListener = window.cProgramApi.onOutput(executionId, (stream, text) => {
        const output = stream === 'stdout' ? stdoutOutput : stderrOutput;
        output.textContent += text;
      });
      try {
        const result = await window.cProgramApi.run(executionId, code.value, runInput.value);
        stdoutOutput.textContent = result.stdout ?? stdoutOutput.textContent;
        stderrOutput.textContent = result.stderr ?? stderrOutput.textContent;
        const executionResult = {
          status: result.status,
          stdout: result.stdout ?? stdoutOutput.textContent,
          stderr: result.stderr ?? stderrOutput.textContent,
          exitCode: result.exitCode ?? null,
          videoText: result.stdout ?? stdoutOutput.textContent,
          sourceCode: code.value,
          sourceInput: runInput.value,
        };
        fieldset.dataset.executionResult = JSON.stringify(executionResult);
        videoExecutionResult.value = executionResult.videoText;
        markScenarioAsUnconfirmed();
        executionStatus.textContent = result.message
          ?? (result.status === 'success' ? `終了コード: ${result.exitCode ?? 0}` : `実行状態: ${result.status}`);
        refreshChapterMaterialStatus();
      } catch {
        executionStatus.textContent = '実行要求に失敗しました。コードと実行環境を確認してください。';
      } finally {
        removeOutputListener();
        activeExecutionId = null;
        executeButton.disabled = !runCode.checked || code.value.trim().length === 0;
        stopButton.disabled = true;
      }
    });
    stopButton.addEventListener('click', () => {
      if (activeExecutionId) void window.cProgramApi?.stop(activeExecutionId);
    });

    scenarioEditor.append(fieldset);
    if (chapter.audioAsset && window.voicevoxApi) {
      void window.voicevoxApi.loadChapterAudio(index).then((storedAudio) => {
        if (!fieldset.isConnected) return;
        if (
          !storedAudio
          || storedAudio.audioAsset.narrationHash !== chapter.audioAsset?.narrationHash
          || narration.value !== chapter.narration
        ) {
          chapterAudioAsset = null;
          delete chapterAudioControls.dataset.audioAsset;
          chapterAudioStatus.textContent = '保存済み音声が見つからないか、本文と一致しません。音声を再生成してください。';
          refreshChapterMaterialStatus();
          return;
        }
        chapterAudioAsset = storedAudio.audioAsset;
        setChapterAudioSource(storedAudio.audio);
      }).catch(() => {
        chapterAudioStatus.textContent = '保存済み音声を読み込めません。再生成してください。';
        refreshChapterMaterialStatus();
      });
    }
  });
  refreshTimelineExtent();
  syncCodeStagePreviews(Number(timeline.value));
  syncSubtitlePreview(Number(timeline.value));
  chapterListActions.hidden = false;
  chapterAddButton.disabled = draft.chapters.length >= 12;
  scenarioConfirmButton.disabled = false;
}

function readScenarioDraft(): ScenarioDraft | null {
  const chapters = [...scenarioEditor.querySelectorAll('fieldset')].map((fieldset) => {
    const runCode = fieldset.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const codeExample = fieldset.querySelector<HTMLTextAreaElement>('.chapter-code')!.value.trim();
    const audioAssetJson = fieldset.querySelector<HTMLDivElement>('.chapter-audio-controls')?.dataset.audioAsset;
    const savedExecutionResult = fieldset.dataset.executionResult
      ? JSON.parse(fieldset.dataset.executionResult) as NonNullable<ScenarioDraft['chapters'][number]['executionResult']>
      : null;
    const videoText = fieldset.querySelector<HTMLTextAreaElement>('.video-execution-result')!.value;
    return {
      title: fieldset.querySelector<HTMLInputElement>('.chapter-title')!.value,
      learningObjective: fieldset.querySelector<HTMLTextAreaElement>('.chapter-objective')!.value,
      targetMinutes: Number(fieldset.querySelector<HTMLInputElement>('.chapter-minutes')!.value),
      narration: fieldset.querySelector<HTMLTextAreaElement>('.chapter-narration')!.value,
      codeExample: codeExample || null,
      runInput: fieldset.querySelector<HTMLTextAreaElement>('.code-editor:not(.chapter-code)')?.value ?? '',
      codeDisplayMode: fieldset.querySelector<HTMLInputElement>('.code-display-mode:checked')?.value ?? 'all',
      codeStages: [...fieldset.querySelectorAll<HTMLDivElement>('.code-stage-row')].map((row) => ({
        atSeconds: Number(row.querySelector<HTMLInputElement>('.code-stage-time')!.value),
        visibleLines: Number(row.querySelector<HTMLInputElement>('.code-stage-lines')!.value),
      })),
      subtitles: [...fieldset.querySelectorAll<HTMLDivElement>('.subtitle-row')].map((row) => ({
        startSeconds: Number(row.querySelector<HTMLInputElement>('.subtitle-start')!.value),
        endSeconds: Number(row.querySelector<HTMLInputElement>('.subtitle-end')!.value),
        text: row.querySelector<HTMLTextAreaElement>('.subtitle-text')!.value,
      })),
      subtitleNarrationHash: fieldset.dataset.subtitleNarrationHash ?? null,
      characterActions: [...fieldset.querySelectorAll<HTMLDivElement>('.character-action-row')].map((row) => ({
        atSeconds: Number(row.querySelector<HTMLInputElement>('.character-action-time')!.value),
        action: row.querySelector<HTMLSelectElement>('.character-action-type')!.value as 'explain' | 'attention' | 'happy',
      })),
      ...(audioAssetJson ? { audioAsset: JSON.parse(audioAssetJson) } : {}),
      executionResult: savedExecutionResult
        ? { ...savedExecutionResult, videoText }
        : videoText
          ? { status: 'manual', stdout: '', stderr: '', exitCode: null, videoText }
          : null,
      runCode: runCode.checked,
      executionAtSeconds: Number(fieldset.querySelector<HTMLInputElement>('.execution-time')!.value),
    };
  });
  const result = ScenarioDraftSchema.safeParse({
    title: (document.querySelector<HTMLInputElement>('#scenario-title')!).value,
    chapters,
  });
  return result.success ? result.data : null;
}

function readScenarioRequest() {
  return ScenarioRequestSchema.safeParse({
    title: (document.querySelector<HTMLInputElement>('#scenario-title')!).value,
    overview: (document.querySelector<HTMLTextAreaElement>('#scenario-overview')!).value,
    audience: (document.querySelector<HTMLInputElement>('#scenario-audience')!).value || undefined,
    chapterCount: Number((document.querySelector<HTMLInputElement>('#scenario-chapter-count')!).value) || undefined,
    targetMinutes: Number((document.querySelector<HTMLInputElement>('#scenario-target-minutes')!).value),
  });
}

function markScenarioAsUnconfirmed() {
  if (!scenarioDraft) return;
  scenarioHasUnsavedChanges = true;
  confirmedScenario = null;
  scenarioReviewState.textContent = '未確認の変更';
  scenarioConfirmButton.disabled = false;
  scenarioSaveButton.disabled = true;
  scenarioSaveStatus.textContent = '未保存の変更';
  scenarioSaveStatus.dataset.state = 'modified';
  scheduleScenarioAutosave();
}

function scheduleScenarioAutosave(delayMilliseconds = 700) {
  const scenarioApi = window.scenarioApi;
  if (!scenarioApi || !scenarioDraft) return;
  scenarioAutosaveRevision += 1;
  const revision = scenarioAutosaveRevision;
  if (scenarioAutosaveTimer) clearTimeout(scenarioAutosaveTimer);
  scenarioAutosaveTimer = setTimeout(() => {
    scenarioAutosaveTimer = null;
    scenarioAutosaveQueue = scenarioAutosaveQueue.then(async () => {
      if (revision !== scenarioAutosaveRevision) return;
      const requestResult = readScenarioRequest();
      const draft = readScenarioDraft();
      if (!requestResult.success || !draft) {
        scenarioSaveStatus.textContent = '入力を修正すると保存できます';
        scenarioSaveStatus.dataset.state = 'error';
        return;
      }

      scenarioSaveStatus.textContent = '保存中';
      scenarioSaveStatus.dataset.state = 'saving';
      const result = await scenarioApi.autoSave(requestResult.data, draft);
      if (revision !== scenarioAutosaveRevision) return;
      if (result.saved) {
        scenarioHasUnsavedChanges = false;
        scenarioSaveStatus.textContent = '自動保存済み';
        scenarioSaveStatus.dataset.state = 'saved';
      } else {
        scenarioSaveStatus.textContent = result.unavailable ? '未保存（保存先未設定）' : result.message;
        scenarioSaveStatus.dataset.state = result.unavailable ? 'modified' : 'error';
      }
    }).catch(() => {
      if (revision !== scenarioAutosaveRevision) return;
      scenarioSaveStatus.textContent = '自動保存に失敗しました';
      scenarioSaveStatus.dataset.state = 'error';
    });
  }, delayMilliseconds);
}

function applyChapterListChange(nextDraft: ScenarioDraft, message: string) {
  scenarioDraft = nextDraft;
  confirmedScenario = null;
  document.querySelector<HTMLInputElement>('#scenario-chapter-count')!.value = String(nextDraft.chapters.length);
  renderScenarioDraft(nextDraft);
  markScenarioAsUnconfirmed();
  scenarioMessage.textContent = message;
}

function createBlankChapter(targetMinutes: number): ScenarioDraft['chapters'][number] {
  return {
    title: '新しい章',
    learningObjective: 'この章を通して身につけることを入力してください。',
    targetMinutes,
    narration: 'ここに読み上げる解説文を入力してください。内容を具体的に記入してから音声を生成します。',
    codeExample: null,
    runInput: '',
    codeDisplayMode: 'all',
    codeStages: [],
    subtitles: [],
    subtitleNarrationHash: null,
    characterActions: [],
    audioAsset: null,
    executionResult: null,
    runCode: false,
    executionAtSeconds: 0,
  };
}

chapterAddButton.addEventListener('click', () => {
  const currentDraft = readScenarioDraft();
  if (!currentDraft) {
    scenarioMessage.textContent = '章の追加前に、各章の入力エラーを修正してください。';
    return;
  }
  if (currentDraft.chapters.length >= 12) return;
  const targetMinutes = Number(document.querySelector<HTMLInputElement>('#scenario-target-minutes')!.value) || 3;
  applyChapterListChange(
    { ...currentDraft, chapters: [...currentDraft.chapters, createBlankChapter(targetMinutes)] },
    '章を追加しました。内容を確認してから保存してください。',
  );
});

scenarioEditor.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || !target.dataset.chapterAction) return;
  const fieldset = target.closest('fieldset');
  const chapterIndex = fieldset ? [...scenarioEditor.querySelectorAll('fieldset')].indexOf(fieldset) : -1;
  const currentDraft = readScenarioDraft();
  if (!currentDraft || chapterIndex < 0) {
    scenarioMessage.textContent = '章の操作前に、各章の入力エラーを修正してください。';
    return;
  }

  const chapters = [...currentDraft.chapters];
  if (target.dataset.chapterAction === 'remove') {
    if (chapters.length <= 1) return;
    if (!window.confirm(`第${chapterIndex + 1}章を削除しますか？この操作は内容を確認するまで保存されません。`)) return;
    chapters.splice(chapterIndex, 1);
    let invalidatedAudio = false;
    for (let index = chapterIndex; index < chapters.length; index += 1) {
      if (chapters[index].audioAsset) invalidatedAudio = true;
      chapters[index] = { ...chapters[index], audioAsset: null };
    }
    applyChapterListChange(
      { ...currentDraft, chapters },
      invalidatedAudio
        ? '章を削除しました。後続章の保存音声は章番号の変更により要再生成です。内容を確認してから保存してください。'
        : '章を削除しました。内容を確認してから保存してください。',
    );
  } else {
    const nextIndex = target.dataset.chapterAction === 'move-up' ? chapterIndex - 1 : chapterIndex + 1;
    if (nextIndex < 0 || nextIndex >= chapters.length) return;
    [chapters[chapterIndex], chapters[nextIndex]] = [chapters[nextIndex], chapters[chapterIndex]];
    const invalidatedAudio = Boolean(chapters[chapterIndex].audioAsset || chapters[nextIndex].audioAsset);
    chapters[chapterIndex] = { ...chapters[chapterIndex], audioAsset: null };
    chapters[nextIndex] = { ...chapters[nextIndex], audioAsset: null };
    applyChapterListChange(
      { ...currentDraft, chapters },
      invalidatedAudio
        ? '章を並べ替えました。移動対象の保存音声は誤結合を防ぐため要再生成です。内容を確認してから保存してください。'
        : '章を並べ替えました。内容を確認してから保存してください。',
    );
  }
});

scenarioForm.addEventListener('input', markScenarioAsUnconfirmed);
scenarioEditor.addEventListener('input', markScenarioAsUnconfirmed);
scenarioEditor.addEventListener('change', markScenarioAsUnconfirmed);
scenarioEditor.addEventListener('input', () => syncVideoComposition(Number(timeline.value)));
scenarioEditor.addEventListener('change', () => syncVideoComposition(Number(timeline.value)));

document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's' || !scenarioDraft) return;
  event.preventDefault();
  if (scenarioAutosaveTimer) clearTimeout(scenarioAutosaveTimer);
  scenarioAutosaveTimer = null;
  scheduleScenarioAutosave(0);
});

scenarioForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!scenarioForm.reportValidity()) return;
  if (!window.scenarioApi) {
    scenarioMessage.textContent = 'シナリオ生成はElectronアプリ内で利用できます。';
    return;
  }

  const inputResult = readScenarioRequest();
  if (!inputResult.success) {
    scenarioMessage.textContent = '入力を確認してください。概要は20〜4000文字、章数は1〜12、目標時間は1〜60分です。';
    return;
  }

  scenarioGenerateButton.disabled = true;
  scenarioConfirmButton.disabled = true;
  scenarioMessage.textContent = 'Copilot SDKでシナリオを生成しています...';
  scenarioReviewState.textContent = '生成中';
  try {
    const outcome = await window.scenarioApi.generate(inputResult.data, scenarioDraft);
    if (outcome.status === 'failed') {
      scenarioDraft = outcome.draft;
      confirmedScenario = null;
      scenarioReviewState.textContent = outcome.draft ? '下書き保持中' : '生成失敗';
      scenarioMessage.textContent = `${outcome.error.message}${outcome.canRetry ? ' 再試行できます。' : ''}`;
      scenarioGenerateButton.textContent = outcome.canRetry ? '再試行' : '入力を修正して再試行';
      scenarioConfirmButton.disabled = !outcome.draft;
      return;
    }

    scenarioDraft = outcome.draft;
    confirmedScenario = null;
    scenarioHasUnsavedChanges = true;
    scenarioSaveButton.disabled = true;
    (document.querySelector<HTMLInputElement>('#scenario-title')!).value = outcome.draft.title;
    renderScenarioDraft(outcome.draft);
    scenarioReviewState.textContent = '確認待ち';
    scenarioMessage.textContent = '生成案を確認し、必要に応じて編集してから内容を確認してください。';
    scenarioGenerateButton.textContent = '再生成';
  } catch {
    scenarioReviewState.textContent = scenarioDraft ? '下書き保持中' : '生成失敗';
    scenarioMessage.textContent = '生成結果を受け取れませんでした。表示中の入力・下書きを確認して再試行してください。';
    scenarioGenerateButton.textContent = '再試行';
  } finally {
    updateScenarioAiProviderUi();
  }
});

scenarioConfirmButton.addEventListener('click', () => {
  const parsedDraft = readScenarioDraft();
  if (!parsedDraft) {
    scenarioMessage.textContent = '章の入力を確認してください。実行する章にはCコード例が必要です。';
    scenarioReviewState.textContent = '入力エラー';
    return;
  }
  scenarioDraft = parsedDraft;
  confirmedScenario = structuredClone(parsedDraft);
  scenarioReviewState.textContent = '確認済み';
  scenarioMessage.textContent = 'この内容を確認済みにしました。プロジェクト保存はまだ行われていません。';
  scenarioConfirmButton.disabled = true;
  scenarioSaveButton.disabled = false;
});

scenarioSaveButton.addEventListener('click', async () => {
  if (!confirmedScenario || !window.scenarioApi) {
    scenarioMessage.textContent = '保存するにはElectronで開き、シナリオを確認済みにしてください。';
    return;
  }
  const requestResult = readScenarioRequest();
  if (!requestResult.success) {
    scenarioMessage.textContent = '教材概要と目標時間を確認してから保存してください。';
    return;
  }

  scenarioSaveButton.disabled = true;
  scenarioMessage.textContent = '保存先フォルダーを選択してください。';
  try {
    const result = await window.scenarioApi.save(requestResult.data, confirmedScenario);
    if (result.saved) {
      scenarioHasUnsavedChanges = false;
      scenarioSaveStatus.textContent = '保存済み';
      scenarioSaveStatus.dataset.state = 'saved';
    } else {
      scenarioSaveStatus.textContent = result.message;
      scenarioSaveStatus.dataset.state = result.cancelled ? 'modified' : 'error';
    }
    scenarioMessage.textContent = result.saved && result.path
      ? `${result.message} ${result.path}`
      : result.message;
  } catch {
    scenarioMessage.textContent = '保存処理に失敗しました。確認済みの内容は保持されています。';
    scenarioSaveStatus.textContent = '保存に失敗しました';
    scenarioSaveStatus.dataset.state = 'error';
  } finally {
    scenarioSaveButton.disabled = false;
  }
});

scenarioOpenButton.addEventListener('click', async () => {
  if (!window.scenarioApi) {
    scenarioMessage.textContent = 'プロジェクトを開く機能はElectronアプリ内で利用できます。';
    return;
  }

  scenarioOpenButton.disabled = true;
  scenarioMessage.textContent = 'プロジェクトを選択してください。';
  try {
    const result = await window.scenarioApi.open();
    if (!result.opened || !result.request || !result.draft) {
      scenarioMessage.textContent = result.message ?? 'プロジェクトを開けませんでした。';
      return;
    }

    (document.querySelector<HTMLInputElement>('#scenario-title')!).value = result.request.title;
    (document.querySelector<HTMLTextAreaElement>('#scenario-overview')!).value = result.request.overview;
    (document.querySelector<HTMLInputElement>('#scenario-audience')!).value = result.request.audience ?? '';
    (document.querySelector<HTMLInputElement>('#scenario-chapter-count')!).value = String(
      result.request.chapterCount ?? result.draft.chapters.length,
    );
    (document.querySelector<HTMLInputElement>('#scenario-target-minutes')!).value = String(result.request.targetMinutes);
    scenarioDraft = result.draft;
    confirmedScenario = null;
    scenarioHasUnsavedChanges = false;
    scenarioSaveStatus.textContent = '保存済み';
    scenarioSaveStatus.dataset.state = 'saved';
    renderScenarioDraft(result.draft);
    scenarioReviewState.textContent = '再確認が必要';
    scenarioMessage.textContent = 'プロジェクトを読み込みました。内容を確認し、必要なら編集してから確定してください。';
    scenarioGenerateButton.textContent = '再生成';
    scenarioSaveButton.disabled = true;
  } catch {
    scenarioMessage.textContent = 'プロジェクトを開けませんでした。選択したフォルダーと権限を確認してください。';
  } finally {
    scenarioOpenButton.disabled = false;
  }
});

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(1920, 1080, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#d4ddd7');
const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.01, 100);
camera.position.set(0, 1.35, 4.5);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1, 0);
controls.enableDamping = false;
controls.update();
scene.add(new THREE.HemisphereLight('#ffffff', '#718178', 1.0));
const keyLight = new THREE.DirectionalLight('#fff0df', 1.35);
keyLight.position.set(-3, 5, 4);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight('#d9e9ff', 0.3);
fillLight.position.set(3, 2, -2);
scene.add(fillLight);

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));
loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

type MouthShape = { start: number; end: number; expression: string };
const mouthExpressions = ['aa', 'ih', 'ou', 'ee', 'oh'];
const modelFacingOffset = Math.PI;
let activeVrm: VRM | undefined;
let activeMixer: THREE.AnimationMixer | undefined;
let activeMouthTimeline: MouthShape[] = [];
const previousCharacterActionOffset = new THREE.Euler();
let previousCharacterHappyValue: number | null = null;

function getCharacterActionAt(seconds: number) {
  const selectedChapter = scenarioEditor.querySelector<HTMLInputElement>('.chapter-preview-target:checked')?.closest('fieldset');
  return [...(selectedChapter?.querySelectorAll<HTMLDivElement>('.character-action-row') ?? [])]
    .map((row) => ({
      atSeconds: Number(row.querySelector<HTMLInputElement>('.character-action-time')?.value),
      action: row.querySelector<HTMLSelectElement>('.character-action-type')?.value ?? 'explain',
    }))
    .filter((entry) => Number.isFinite(entry.atSeconds) && entry.atSeconds <= seconds)
    .sort((left, right) => left.atSeconds - right.atSeconds)
    .at(-1);
}

function renderAt(seconds: number) {
  if (activeVrm) {
    if (previousCharacterHappyValue !== null) {
      activeVrm.expressionManager?.setValue('happy', previousCharacterHappyValue);
      previousCharacterHappyValue = null;
    }
    const head = activeVrm.humanoid.getNormalizedBoneNode('head');
    if (head) {
      head.rotation.x -= previousCharacterActionOffset.x;
      head.rotation.y -= previousCharacterActionOffset.y;
      head.rotation.z -= previousCharacterActionOffset.z;
    }
    previousCharacterActionOffset.set(0, 0, 0);
    activeVrm.scene.rotation.y = modelFacingOffset + (activeMixer ? 0 : seconds * 0.35);
    if (activeMixer) {
      activeMixer.setTime(seconds);
    } else {
      const phase = ((seconds % 3) + 3) % 3;
      activeVrm.expressionManager?.setValue('happy', phase < 1 ? 0.65 : 0);
      activeVrm.expressionManager?.setValue('aa', phase >= 1 && phase < 2 ? 1 : 0);
      activeVrm.expressionManager?.setValue('blink', phase >= 2.7 ? 1 : 0);
    }
    const characterAction = getCharacterActionAt(seconds);
    const actionElapsed = characterAction ? seconds - characterAction.atSeconds : Number.POSITIVE_INFINITY;
    const actionDuration = 1.2;
    if (characterAction && actionElapsed < actionDuration) {
      const progress = Math.max(0, actionElapsed / actionDuration);
      const intensity = Math.sin(Math.PI * progress);
      if (head) {
        const action = characterAction.action;
        previousCharacterActionOffset.set(
          action === 'explain' ? 0.12 * Math.sin(progress * Math.PI * 4) * intensity : action === 'happy' ? -0.06 * intensity : 0,
          action === 'attention' ? -0.14 * intensity : 0,
          action === 'attention' ? 0.12 * intensity : action === 'happy' ? 0.1 * intensity : 0,
        );
        head.rotation.x += previousCharacterActionOffset.x;
        head.rotation.y += previousCharacterActionOffset.y;
        head.rotation.z += previousCharacterActionOffset.z;
      }
      if (characterAction.action === 'happy') {
        previousCharacterHappyValue = activeVrm.expressionManager?.getValue('happy') ?? 0;
        activeVrm.expressionManager?.setValue('happy', 0.8 * intensity);
      }
    }
    if (activeMouthTimeline.length > 0) {
      const mouthShape = activeMouthTimeline.find((entry) => seconds >= entry.start && seconds < entry.end);
      for (const expression of mouthExpressions) {
        activeVrm.expressionManager?.setValue(expression, expression === mouthShape?.expression ? 0.9 : 0);
      }
      mouthReadout.textContent = `口形: ${mouthShape?.expression ?? '閉じ'}`;
    }
    activeVrm.update(0);
  }
  renderer.render(scene, camera);
}

function renderCompositionAt(seconds: number) {
  syncCodeStagePreviews(seconds);
  syncSubtitlePreview(seconds);
  renderAt(seconds);
}

function setResult(message: string) {
  resultReadout.textContent = message;
}

async function hashNarrationText(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  runtimeStatus.textContent = '読み込み中';
  runtimeStatus.dataset.state = 'loading';
  setResult(`${file.name} を解析しています...`);
  try {
    const buffer = await file.arrayBuffer();
    const gltf = await new Promise<{ userData: { vrm?: VRM } }>((resolve, reject) => {
      loader.parse(buffer, '', resolve, reject);
    });
    const loadedVrm = gltf.userData.vrm;
    if (!loadedVrm) throw new Error('VRM拡張情報が見つかりません。VRM 1.0ファイルを選択してください。');

    activeMixer?.stopAllAction();
    activeMixer = undefined;
    previousCharacterActionOffset.set(0, 0, 0);
    previousCharacterHappyValue = null;
    if (activeVrm) scene.remove(activeVrm.scene);
    activeVrm = loadedVrm;
    scene.add(activeVrm.scene);
    motionInput.disabled = false;
    motionInput.value = '';
    mouthTimelineInput.disabled = false;
    mouthTimelineInput.value = '';
    activeMouthTimeline = [];
    mouthReadout.textContent = '口形: --';

    const bounds = new THREE.Box3().setFromObject(activeVrm.scene);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const height = Math.max(size.y, 0.5);
    controls.target.set(center.x, center.y, center.z);
    camera.position.set(center.x, center.y + height * 0.08, center.z - height * 2.65);
    camera.near = Math.max(height / 1000, 0.01);
    camera.far = height * 20;
    camera.updateProjectionMatrix();
    controls.update();

    emptyState.hidden = true;
    captureButton.disabled = false;
    sequenceButton.disabled = false;
    benchmarkButton.disabled = false;
    videoExportButton.disabled = false;
    runtimeStatus.textContent = 'VRM 1.0読込完了';
    runtimeStatus.dataset.state = 'ready';
    modelReadout.textContent = `モデル: ${file.name} / ${Math.round(size.x * 100) / 100} × ${Math.round(size.y * 100) / 100} × ${Math.round(size.z * 100) / 100}`;
    renderAt(Number(timeline.value));
    const expressions = activeVrm.expressionManager?.expressions.map((expression) => expression.expressionName) ?? [];
    setResult(expressions.length > 0 ? `利用可能な表情: ${expressions.join(', ')}` : 'このモデルに表情プリセットはありません。');
  } catch (error) {
    runtimeStatus.textContent = '読み込み失敗';
    runtimeStatus.dataset.state = 'error';
    setResult('VRMモデルを読み込めませんでした。VRM 1.0形式で破損していないファイルを選び直して再試行してください。');
  }
});

motionInput.addEventListener('change', async () => {
  const file = motionInput.files?.[0];
  if (!file || !activeVrm) return;

  try {
    const buffer = await file.arrayBuffer();
    const gltf = await new Promise<{ userData: { vrmAnimations?: VRMAnimation[] } }>((resolve, reject) => {
      loader.parse(buffer, '', resolve, reject);
    });
    const animation = gltf.userData.vrmAnimations?.[0];
    if (!animation) throw new Error('VRMAアニメーションが見つかりません。');

    activeMixer?.stopAllAction();
    const clip = createVRMAnimationClip(animation, activeVrm);
    activeMixer = new THREE.AnimationMixer(activeVrm.scene);
    activeMixer.clipAction(clip).play();
    renderAt(Number(timeline.value));
    setResult(`VRMA読込完了: ${file.name} / ${clip.duration.toFixed(2)} 秒`);
  } catch (error) {
    activeMixer?.stopAllAction();
    activeMixer = undefined;
    setResult(error instanceof Error ? error.message : String(error));
  }
});

mouthTimelineInput.addEventListener('change', async () => {
  const file = mouthTimelineInput.files?.[0];
  if (!file || !activeVrm) return;

  try {
    const parsed = JSON.parse(await file.text()) as { mouthTimeline?: MouthShape[] };
    const availableExpressions = new Set(
      activeVrm.expressionManager?.expressions.map((expression) => expression.expressionName) ?? [],
    );
    const timelineEntries = parsed.mouthTimeline;
    if (!Array.isArray(timelineEntries) || timelineEntries.length === 0) {
      throw new Error('母音タイムラインに口形データがありません。');
    }
    if (timelineEntries.some((entry) =>
      !Number.isFinite(entry.start)
      || !Number.isFinite(entry.end)
      || entry.end <= entry.start
      || !mouthExpressions.includes(entry.expression)
      || !availableExpressions.has(entry.expression))) {
      throw new Error('タイムラインに未対応の口形または時刻があります。');
    }

    activeMouthTimeline = [...timelineEntries].sort((left, right) => left.start - right.start);
    renderAt(Number(timeline.value));
    setResult(`口パク時刻表読込完了: ${activeMouthTimeline.length}区間`);
  } catch (error) {
    setResult(error instanceof Error ? error.message : String(error));
  }
});

timeline.addEventListener('input', () => {
  const seconds = Number(timeline.value);
  seekTo(seconds);
  if (playbackFrame !== null) {
    playbackOriginSeconds = Number(timeline.value);
    playbackStartedAt = performance.now();
  }
});

playButton.addEventListener('click', startPlayback);
pauseButton.addEventListener('click', stopPlayback);
rewindButton.addEventListener('click', () => {
  stopPlayback();
  seekTo(0);
});

captureButton.addEventListener('click', () => {
  renderAt(Number(timeline.value));
  canvas.toBlob((blob) => {
    if (!blob) {
      setResult('PNG生成に失敗しました。WebGL描画状態を確認してください。');
      return;
    }
    saveBlob(blob, `vrm-frame-${Number(timeline.value).toFixed(2)}s.png`);
    setResult(`1920×1080 PNGを保存しました (${(blob.size / 1024 / 1024).toFixed(2)} MiB)`);
  }, 'image/png');
});

sequenceButton.addEventListener('click', async () => {
  stopPlayback();
  setPlaybackLocked(true);
  sequenceButton.disabled = true;
  captureButton.disabled = true;
  benchmarkButton.disabled = true;
  runtimeStatus.textContent = 'フレーム生成中';
  const frameCount = 90;
  const files: Record<string, Uint8Array> = {};
  try {
    for (let frame = 0; frame < frameCount; frame += 1) {
      renderAt(frame / 30);
      const dataUrl = canvas.toDataURL('image/png');
      const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      files[`frame-${String(frame).padStart(3, '0')}.png`] = bytes;
      if ((frame + 1) % 10 === 0) setResult(`${frame + 1}/${frameCount} フレーム生成済み`);
    }

    const archive = zipSync(files, { level: 0 });
    saveBlob(new Blob([archive], { type: 'application/zip' }), 'vrm-frames-30fps.zip');
    runtimeStatus.textContent = '連番生成完了';
    setResult(`1920×1080 PNG ${frameCount}枚 / 30fps / 3秒のZIPを保存しました`);
  } catch (error) {
    runtimeStatus.textContent = '連番生成失敗';
    setResult(error instanceof Error ? error.message : String(error));
  } finally {
    renderAt(Number(timeline.value));
    sequenceButton.disabled = false;
    captureButton.disabled = false;
    benchmarkButton.disabled = false;
    setPlaybackLocked(false);
  }
});

benchmarkButton.addEventListener('click', async () => {
  stopPlayback();
  setPlaybackLocked(true);
  benchmarkButton.disabled = true;
  captureButton.disabled = true;
  runtimeStatus.textContent = '計測中';
  const frameCount = 90;
  const renderTimes: number[] = [];
  try {
    for (let frame = 0; frame < frameCount; frame += 1) {
      const startedAt = performance.now();
      renderAt(frame / 30);
      renderer.getContext().finish();
      renderTimes.push(performance.now() - startedAt);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    const average = renderTimes.reduce((sum, value) => sum + value, 0) / frameCount;
    const sorted = [...renderTimes].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(frameCount * 0.95)];
    const overBudget = renderTimes.filter((value) => value > 1000 / 30).length;
    runtimeStatus.textContent = overBudget === 0 ? '30fps基準内' : '30fps超過あり';
    setResult(`90フレーム完了 / 平均 ${average.toFixed(1)} ms / p95 ${p95.toFixed(1)} ms / 33.3 ms超過 ${overBudget}枚`);
  } catch (error) {
    runtimeStatus.textContent = '計測失敗';
    setResult(error instanceof Error ? error.message : String(error));
  } finally {
    renderAt(Number(timeline.value));
    benchmarkButton.disabled = false;
    captureButton.disabled = false;
    setPlaybackLocked(false);
  }
});

renderAt(0);