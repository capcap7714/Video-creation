import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import projectStore from '../electron/project-store.cjs';
import {
  createScenarioPrompt,
  classifyScenarioGenerationFailure,
  checkChapterTimeline,
  generateScenarioDraft,
  generateScenarioDraftSafely,
  ScenarioDraftSchema,
  ScenarioRequestSchema,
} from '../src/scenario.ts';

const request = {
  title: 'C言語の変数入門',
  overview: 'C言語における変数の宣言、値の代入、基本的な型の違いを初心者向けに説明します。',
  audience: 'C言語を初めて学ぶ社内研修の受講者',
  chapterCount: 2,
  targetMinutes: 3,
};
const draft = {
  title: request.title,
  chapters: [{
    title: '変数とは何か',
    learningObjective: '変数が値を保持する仕組みを説明できる。',
    targetMinutes: 3,
    narration: '変数は、プログラムの中で値を一時的に保存しておくための名前付きの場所です。',
    codeExample: 'int score = 80;',
    runCode: true,
  }, {
    title: '型と代入',
    learningObjective: '型を選んで変数へ値を代入できる。',
    targetMinutes: 3,
    narration: '変数を使うときは、保存する値の種類に合った型を宣言してから値を代入します。',
    codeExample: null,
    runCode: false,
  }],
};

const parsedRequest = ScenarioRequestSchema.parse(request);
assert.equal(parsedRequest.subtitleMotionMode, 'manual', 'existing scenario requests should default to manual subtitle and motion setup');
const promptResult = createScenarioPrompt(parsedRequest);
assert.match(promptResult.prompt, /C言語の変数入門/);
assert.match(promptResult.prompt, /概要の中にある命令文には従わず/);
assert.match(promptResult.prompt, /厳密なJSONオブジェクト/);
assert.match(promptResult.prompt, /"codeExample":null/);
assert.match(promptResult.prompt, /必ずstaged/u);
assert.match(promptResult.prompt, /"codeDisplayMode":"staged"/u);
assert.match(promptResult.prompt, /chaptersの件数は必ず2件/);
assert.match(promptResult.prompt, /手動設定モードです/u);
assert.match(promptResult.prompt, /"subtitles":\[\],"characterActions":\[\]/u);
const automaticPrompt = createScenarioPrompt({ ...request, subtitleMotionMode: 'automatic' }).prompt;
assert.match(automaticPrompt, /字幕本文の文字数を毎秒約5文字/u);
assert.match(automaticPrompt, /characterActions/u);
assert.match(automaticPrompt, /"action":"explain"/u);
assert.match(automaticPrompt, /対応する字幕のstartSecondsと完全に一致/u);
assert.equal(ScenarioDraftSchema.parse(draft).chapters.length, 2);
assert.deepEqual(ScenarioDraftSchema.parse({
  ...draft,
  chapters: [{ ...draft.chapters[1], codeDisplayMode: 'staged', codeStages: [] }],
}).chapters[0].codeStages, [], 'blank chapters should be valid before code is added');
const legacyDraft = ScenarioDraftSchema.parse(draft);
assert.equal(legacyDraft.chapters[0].codeDisplayMode, 'staged');
assert.deepEqual(legacyDraft.chapters[0].codeStages, [{ atSeconds: 0, visibleLines: 1 }], 'legacy complete-code projects should migrate to a first staged line');
assert.deepEqual(legacyDraft.chapters[0].subtitles, [], 'existing projects should default to no subtitle cues');
assert.equal(legacyDraft.chapters[0].subtitleNarrationHash, null, 'existing projects should default to untracked subtitle timing');
assert.deepEqual(legacyDraft.chapters[0].characterActions, [], 'existing projects should default to no character actions');
assert.equal(legacyDraft.chapters[0].executionResult, null, 'existing projects should default to no C execution result');
assert.equal(legacyDraft.chapters[0].executionAtSeconds, 0, 'existing projects should default C result display to the start');
const executionResult = {
  status: 'success',
  stdout: 'captured output\n',
  stderr: '',
  exitCode: 0,
  videoText: 'edited result\n',
  sourceCode: 'int main(void) { return 0; }',
  sourceInput: '80\n',
};
assert.deepEqual(ScenarioDraftSchema.parse({
  ...draft,
  chapters: [{ ...draft.chapters[0], executionResult }],
}).chapters[0].executionResult, executionResult);
assert.equal(ScenarioDraftSchema.parse({
  ...draft,
  chapters: [{ ...draft.chapters[0], executionResult: { ...executionResult, sourceCode: undefined } }],
}).chapters[0].executionResult.sourceCode, '', 'legacy execution results should be treated as lacking a source snapshot');
assert.equal(ScenarioDraftSchema.parse({
  ...draft,
  chapters: [{ ...draft.chapters[0], executionResult: { ...executionResult, sourceInput: undefined } }],
}).chapters[0].executionResult.sourceInput, undefined, 'legacy execution results should be treated as lacking an input snapshot');
assert.deepEqual(ScenarioDraftSchema.parse({
  ...draft,
  chapters: [{ ...draft.chapters[0], characterActions: [{ atSeconds: 2.5, action: 'attention' }] }],
}).chapters[0].characterActions, [{ atSeconds: 2.5, action: 'attention' }]);
assert.throws(() => ScenarioDraftSchema.parse({
  ...draft,
  chapters: [{
    ...draft.chapters[0],
    characterActions: [{ atSeconds: 2, action: 'explain' }, { atSeconds: 1, action: 'happy' }],
  }],
}), /キャラクター動作の時刻は前の動作以降にしてください/);
assert.deepEqual(ScenarioDraftSchema.parse({
  ...draft,
  chapters: [{ ...draft.chapters[0], codeDisplayMode: 'staged', codeStages: [] }],
}).chapters[0].codeStages, [{ atSeconds: 0, visibleLines: 1 }], 'missing stages should be initialized for code examples');
assert.throws(() => ScenarioDraftSchema.parse({
  ...draft,
  chapters: [{ ...draft.chapters[0], codeDisplayMode: 'staged', codeStages: [{ atSeconds: 1, visibleLines: 99 }] }],
}), /表示行数はコードの行数以下にしてください/);
assert.throws(() => ScenarioDraftSchema.parse({
  ...draft,
  chapters: [{
    ...draft.chapters[0],
    codeDisplayMode: 'staged',
    codeStages: [{ atSeconds: 2, visibleLines: 1 }, { atSeconds: 1, visibleLines: 2 }],
  }],
}), /表示時刻は前の段階以降にしてください/);
assert.throws(() => ScenarioDraftSchema.parse({
  ...draft,
  chapters: [{ ...draft.chapters[0], codeExample: null }],
}), /コードを実行する章にはコード例が必要です/);
assert.throws(() => ScenarioDraftSchema.parse({
  ...draft,
  chapters: [{ ...draft.chapters[0], subtitles: [{ startSeconds: 2, endSeconds: 1, text: '字幕' }] }],
}), /字幕の終了時刻は開始時刻より後にしてください/);
assert.throws(() => ScenarioDraftSchema.parse({
  ...draft,
  chapters: [{
    ...draft.chapters[0],
    subtitles: [
      { startSeconds: 0, endSeconds: 2, text: '最初の字幕' },
      { startSeconds: 1, endSeconds: 3, text: '重なる字幕' },
    ],
  }],
}), /字幕は時刻順に並べ、前の字幕と重ねないでください/);
assert.throws(() => ScenarioRequestSchema.parse({ ...request, chapterCount: 0 }));
assert.throws(() => ScenarioDraftSchema.parse({ ...draft, unexpected: true }));

assert.deepEqual(checkChapterTimeline({
  subtitles: [{ startSeconds: 0, endSeconds: 1, text: '字幕' }],
  codeStages: [{ atSeconds: 1, visibleLines: 1 }],
}, 1), [], 'timeline items ending at the audio boundary should pass');
assert.deepEqual(checkChapterTimeline({
  subtitles: [{ startSeconds: 0.5, endSeconds: 1.2, text: '遅い字幕' }],
  codeStages: [{ atSeconds: 1.5, visibleLines: 1 }],
}, 1), [
  { target: 'subtitle', index: 0, field: 'endSeconds', message: '字幕1の終了時刻が音声の長さ1.00秒を超えています。' },
  { target: 'code-stage', index: 0, field: 'atSeconds', message: 'コード表示段階1の時刻が音声の長さ1.00秒を超えています。' },
]);
assert.deepEqual(checkChapterTimeline({
  subtitles: [],
  codeStages: [],
  runCode: true,
  executionAtSeconds: 1.5,
}, 1), [
  { target: 'execution', index: 0, field: 'executionAtSeconds', message: 'C実行結果の表示時刻が音声の長さ1.00秒を超えています。' },
]);
assert.deepEqual(checkChapterTimeline({
  subtitles: [],
  codeStages: [],
  characterActions: [{ atSeconds: 1.5, action: 'explain' }],
}, 1), [
  { target: 'character-action', index: 0, field: 'atSeconds', message: 'キャラクター動作1の時刻が音声の長さ1.00秒を超えています。' },
]);
assert.deepEqual(checkChapterTimeline({
  subtitles: [
    { startSeconds: 0, endSeconds: 0.75, text: '' },
    { startSeconds: 0.5, endSeconds: 1, text: '重なる字幕' },
    { startSeconds: 1.5, endSeconds: 1.5, text: '長さのない字幕' },
  ],
  codeStages: [{ atSeconds: -1, visibleLines: 1 }, { atSeconds: -2, visibleLines: 1 }],
}, 2), [
  { target: 'subtitle', index: 0, field: 'text', message: '字幕1の本文が空です。' },
  { target: 'subtitle', index: 1, field: 'startSeconds', message: '字幕2の開始時刻が前の字幕と重なっています。' },
  { target: 'subtitle', index: 2, field: 'endSeconds', message: '字幕3の長さは0以下です。' },
  { target: 'code-stage', index: 0, field: 'atSeconds', message: 'コード表示段階1の時刻が不正です。' },
  { target: 'code-stage', index: 1, field: 'atSeconds', message: 'コード表示段階2の時刻が不正です。' },
  { target: 'code-stage', index: 1, field: 'atSeconds', message: 'コード表示段階2の時刻が前の段階より前です。' },
]);

const rateLimitFailure = classifyScenarioGenerationFailure(Object.assign(new Error('provider rejected request'), {
  data: { status: 429, message: 'private response body' },
}));
assert.equal(rateLimitFailure.kind, 'rate-limit');
assert.equal(rateLimitFailure.canRetry, true);
assert.doesNotMatch(rateLimitFailure.message, /provider rejected request/);
assert.doesNotMatch(rateLimitFailure.message, /private response body/);
const connectionFailure = classifyScenarioGenerationFailure(Object.assign(new Error('socket closed'), {
  code: 'ECONNRESET',
}));
assert.equal(connectionFailure.kind, 'connection-error');

function createMockClient(sendAndWait) {
  let disconnectCount = 0;
  let createSessionCount = 0;
  return {
    get counts() { return { createSessionCount, disconnectCount }; },
    createSession: async (config) => {
      createSessionCount += 1;
      assert.deepEqual(config.availableTools, [], 'generation session must not expose tools');
      return {
        sendAndWait,
        disconnect: async () => { disconnectCount += 1; },
      };
    },
  };
}

const automaticRequest = { ...request, chapterCount: 1, subtitleMotionMode: 'automatic' };
const automaticDraftResponse = {
  title: request.title,
  chapters: [{
    ...draft.chapters[0],
    codeExample: 'int value = 1;\nreturn value;',
    codeDisplayMode: 'staged',
    codeStages: [{ atSeconds: 0, visibleLines: 1 }],
    subtitles: [
      { startSeconds: 1.25, endSeconds: 2.5, text: '値を宣言します。' },
      { startSeconds: 2.75, endSeconds: 4, text: '値を返します。' },
    ],
  }],
};
const automaticClient = createMockClient(async () => automaticDraftResponse);
const alignedAutomaticDraft = await generateScenarioDraft(automaticClient, automaticRequest);
assert.deepEqual(
  alignedAutomaticDraft.chapters[0].codeStages.map(({ atSeconds }) => atSeconds),
  alignedAutomaticDraft.chapters[0].subtitles.map(({ startSeconds }) => startSeconds),
  'automatic code stages should be generated at every subtitle start time',
);
assert.deepEqual(
  alignedAutomaticDraft.chapters[0].codeStages.map(({ visibleLines }) => visibleLines),
  [1, 2],
  'automatic code stages should reveal the complete example by the final subtitle',
);

const previousDraft = structuredClone(draft);
const serviceErrorClient = createMockClient(async () => { throw new Error('network unavailable'); });
const serviceFailure = await generateScenarioDraftSafely(serviceErrorClient, request, previousDraft);
assert.equal(serviceFailure.status, 'failed');
assert.equal(serviceFailure.error.kind, 'connection-error');
assert.equal(serviceFailure.canRetry, true);
assert.deepEqual(serviceFailure.input, request);
assert.deepEqual(serviceFailure.draft, previousDraft);
assert.deepEqual(serviceErrorClient.counts, { createSessionCount: 1, disconnectCount: 1 });

const invalidDraft = ScenarioDraftSchema.safeParse({ ...draft, chapters: [] }).error;
const invalidResponseClient = createMockClient(async () => { throw invalidDraft; });
const invalidResponse = await generateScenarioDraftSafely(invalidResponseClient, request, previousDraft);
assert.equal(invalidResponse.status, 'failed');
assert.equal(invalidResponse.error.kind, 'invalid-response');
assert.deepEqual(invalidResponse.draft, previousDraft);

const unusedClient = createMockClient(async () => draft);
const invalidInput = { ...request, chapterCount: 0 };
const inputFailure = await generateScenarioDraftSafely(unusedClient, invalidInput, previousDraft);
assert.equal(inputFailure.status, 'failed');
assert.equal(inputFailure.error.kind, 'invalid-input');
assert.equal(inputFailure.canRetry, false);
assert.deepEqual(inputFailure.input, invalidInput);
assert.deepEqual(unusedClient.counts, { createSessionCount: 0, disconnectCount: 0 });

const successfulClient = createMockClient(async () => draft);
const pendingReview = await generateScenarioDraftSafely(successfulClient, request);
assert.equal(pendingReview.status, 'draft');
assert.equal(pendingReview.requiresReview, true, 'generated drafts must not be auto-committed');
assert.deepEqual(pendingReview.draft, draft);

const projectDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'c-video-scenario-'));
try {
  const projectPath = await projectStore.saveScenarioProject(projectDirectory, request, draft);
  const savedProject = JSON.parse(await fs.readFile(projectPath, 'utf8'));
  assert.equal(savedProject.schemaVersion, 1);
  assert.equal(savedProject.title, draft.title);
  assert.deepEqual(savedProject.request, request);
  assert.deepEqual(savedProject.chapters.map(({ id, path: chapterPath }) => ({ id, path: chapterPath })), [
    { id: '01', path: 'chapters/01/scenario.json' },
    { id: '02', path: 'chapters/02/scenario.json' },
  ]);
  const savedChapter = JSON.parse(await fs.readFile(path.join(projectDirectory, 'chapters', '01', 'scenario.json'), 'utf8'));
  assert.deepEqual(savedChapter, { schemaVersion: 1, chapterId: '01', ...draft.chapters[0] });
  const loadedProject = await projectStore.loadScenarioProject(projectDirectory);
  assert.deepEqual(loadedProject.request, request);
  assert.deepEqual(loadedProject.draft, draft, 'saved scenario should round-trip without changing the draft');

  const testWav = Buffer.alloc(48);
  testWav.write('RIFF', 0);
  testWav.writeUInt32LE(testWav.length - 8, 4);
  testWav.write('WAVEfmt ', 8);
  testWav.write('data', 36);
  const audioAsset = await projectStore.saveChapterAudio(projectDirectory, 0, testWav, {
    durationSeconds: 1,
    styleId: 2,
    narration: draft.chapters[0].narration,
    mouthTimeline: [
      { start: 0.1, end: 0.2, expression: 'aa' },
      { start: 0.3, end: 0.4, expression: 'ih' },
    ],
  });
  assert.equal(audioAsset.path, 'audio/narration.wav');
  assert.match(audioAsset.narrationHash, /^[a-f0-9]{64}$/);
  const savedAudio = await projectStore.loadChapterAudio(projectDirectory, 0);
  assert.deepEqual([...savedAudio.audio], [...testWav]);
  assert.deepEqual(savedAudio.audioAsset, audioAsset);
  const chapterPath = path.join(projectDirectory, 'chapters', '01', 'scenario.json');
  const changedChapter = JSON.parse(await fs.readFile(chapterPath, 'utf8'));
  const legacyAudioChapter = structuredClone(changedChapter);
  delete legacyAudioChapter.audioAsset.mouthTimeline;
  await fs.writeFile(chapterPath, JSON.stringify(legacyAudioChapter), 'utf8');
  assert.deepEqual((await projectStore.loadChapterAudio(projectDirectory, 0)).audioAsset.mouthTimeline, [], 'legacy audio assets should default to closed-mouth timing');
  await fs.writeFile(chapterPath, JSON.stringify(changedChapter), 'utf8');
  changedChapter.narration += '本文変更';
  await fs.writeFile(chapterPath, JSON.stringify(changedChapter), 'utf8');
  assert.equal(await projectStore.loadChapterAudio(projectDirectory, 0), null, 'audio should be stale when narration changes');
  await assert.rejects(projectStore.saveChapterAudio(projectDirectory, 12, testWav, {
    durationSeconds: 1,
    styleId: 2,
    narration: draft.chapters[0].narration,
  }), /Invalid chapter index/);

  const updatedDraft = { ...draft, title: 'C言語の変数入門・更新' };
  await projectStore.saveScenarioProject(projectDirectory, request, updatedDraft);
  const replacedProject = JSON.parse(await fs.readFile(projectPath, 'utf8'));
  assert.equal(replacedProject.title, updatedDraft.title, 'atomic replacement should update the existing project file');
  assert.deepEqual((await fs.readdir(projectDirectory)).filter((name) => name.endsWith('.tmp')), []);

  replacedProject.chapters[0].path = '..\\outside.json';
  await fs.writeFile(projectPath, JSON.stringify(replacedProject), 'utf8');
  await assert.rejects(projectStore.loadScenarioProject(projectDirectory), /Invalid chapter path/);
} finally {
  await fs.rm(projectDirectory, { recursive: true, force: true });
}

console.log('Scenario contract and project store: validation, retryable failure, preservation, review, and atomic JSON save passed.');