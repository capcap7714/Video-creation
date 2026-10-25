const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createHash } = require('node:crypto');

const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

async function writeJsonAtomically(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

async function writeBytesAtomically(filePath, bytes) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, bytes, { flag: 'wx' });
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

function getAudioAsset(fileBytes, scenario) {
  if (
    fileBytes.length < 44
    || fileBytes.length > MAX_AUDIO_BYTES
    || fileBytes.toString('ascii', 0, 4) !== 'RIFF'
    || fileBytes.toString('ascii', 8, 12) !== 'WAVE'
    || typeof scenario?.narration !== 'string'
  ) return null;
  const audioAsset = scenario.audioAsset;
  if (
    audioAsset?.path !== 'audio/narration.wav'
    || !Number.isFinite(audioAsset.durationSeconds)
    || audioAsset.durationSeconds <= 0
    || !Number.isSafeInteger(audioAsset.styleId)
    || !/^[a-f0-9]{64}$/.test(audioAsset.narrationHash)
  ) return null;
  const narrationHash = createHash('sha256').update(scenario.narration, 'utf8').digest('hex');
  return narrationHash === audioAsset.narrationHash ? audioAsset : null;
}

async function saveScenarioProject(projectDirectory, request, draft) {
  const chapterReferences = draft.chapters.map((chapter, index) => {
    const id = String(index + 1).padStart(2, '0');
    const relativePath = `chapters/${id}/scenario.json`;
    return { id, path: relativePath, chapter };
  });

  for (const reference of chapterReferences) {
    const chapterPath = path.join(projectDirectory, ...reference.path.split('/'));
    await fs.mkdir(path.dirname(chapterPath), { recursive: true });
    await writeJsonAtomically(chapterPath, {
      schemaVersion: 1,
      chapterId: reference.id,
      ...reference.chapter,
    });
  }

  const projectPath = path.join(projectDirectory, 'project.json');
  await writeJsonAtomically(projectPath, {
    schemaVersion: 1,
    title: draft.title,
    language: 'ja',
    request,
    chapters: chapterReferences.map(({ id, path: relativePath }) => ({ id, path: relativePath })),
  });
  return projectPath;
}

async function loadScenarioProject(projectDirectory) {
  const projectPath = path.join(projectDirectory, 'project.json');
  const project = JSON.parse(await fs.readFile(projectPath, 'utf8'));
  if (
    project?.schemaVersion !== 1
    || typeof project.title !== 'string'
    || !Array.isArray(project.chapters)
    || project.chapters.length < 1
    || project.chapters.length > 12
  ) {
    throw new Error('Unsupported or invalid project file.');
  }

  const chapters = [];
  for (const reference of project.chapters) {
    if (
      typeof reference?.id !== 'string'
      || typeof reference.path !== 'string'
      || path.posix.isAbsolute(reference.path)
      || path.win32.isAbsolute(reference.path)
      || reference.path.includes('\\')
      || reference.path.split('/').some((segment) => segment === '..' || segment === '.')
    ) {
      throw new Error('Invalid chapter path.');
    }
    const chapterPath = path.resolve(projectDirectory, ...reference.path.split('/'));
    const projectRoot = path.resolve(projectDirectory) + path.sep;
    if (!chapterPath.startsWith(projectRoot)) throw new Error('Chapter path escapes project folder.');

    const savedChapter = JSON.parse(await fs.readFile(chapterPath, 'utf8'));
    if (savedChapter?.schemaVersion !== 1 || savedChapter.chapterId !== reference.id) {
      throw new Error('Invalid chapter file.');
    }
    const { schemaVersion: _schemaVersion, chapterId: _chapterId, ...chapter } = savedChapter;
    chapters.push(chapter);
  }

  return { project, request: project.request, draft: { title: project.title, chapters } };
}

async function resolveChapterScenario(projectDirectory, chapterIndex) {
  if (!Number.isSafeInteger(chapterIndex) || chapterIndex < 0 || chapterIndex >= 12) {
    throw new Error('Invalid chapter index.');
  }
  const id = String(chapterIndex + 1).padStart(2, '0');
  const project = JSON.parse(await fs.readFile(path.join(projectDirectory, 'project.json'), 'utf8'));
  const reference = project?.chapters?.find((chapter) => chapter.id === id);
  if (reference?.path !== `chapters/${id}/scenario.json`) throw new Error('Chapter is not in this project.');
  const scenarioPath = path.join(projectDirectory, 'chapters', id, 'scenario.json');
  const scenario = JSON.parse(await fs.readFile(scenarioPath, 'utf8'));
  if (scenario?.schemaVersion !== 1 || scenario.chapterId !== id) throw new Error('Invalid chapter file.');
  return { id, scenarioPath, scenario };
}

async function saveChapterAudio(projectDirectory, chapterIndex, audio, details) {
  const { id, scenarioPath, scenario } = await resolveChapterScenario(projectDirectory, chapterIndex);
  const fileBytes = Buffer.from(audio);
  if (
    fileBytes.length < 44
    || fileBytes.length > MAX_AUDIO_BYTES
    || fileBytes.toString('ascii', 0, 4) !== 'RIFF'
    || fileBytes.toString('ascii', 8, 12) !== 'WAVE'
    || !Number.isFinite(details?.durationSeconds)
    || details.durationSeconds <= 0
    || details.durationSeconds > 3600
    || !Number.isSafeInteger(details?.styleId)
    || details.styleId < 0
    || (details.speakerName !== undefined && (typeof details.speakerName !== 'string' || details.speakerName.trim().length === 0 || details.speakerName.length > 100))
    || typeof details?.narration !== 'string'
    || details.narration !== scenario.narration
  ) {
    throw new Error('Invalid audio asset.');
  }

  const audioAsset = {
    path: 'audio/narration.wav',
    durationSeconds: details.durationSeconds,
    styleId: details.styleId,
    speakerName: details.speakerName?.trim() || '話者名未記録',
    narrationHash: createHash('sha256').update(details.narration, 'utf8').digest('hex'),
  };
  const audioPath = path.join(projectDirectory, 'chapters', id, 'audio', 'narration.wav');
  await fs.mkdir(path.dirname(audioPath), { recursive: true });
  await writeBytesAtomically(audioPath, fileBytes);
  await writeJsonAtomically(scenarioPath, { ...scenario, audioAsset });
  return audioAsset;
}

async function loadChapterAudio(projectDirectory, chapterIndex) {
  const { id, scenario } = await resolveChapterScenario(projectDirectory, chapterIndex);
  const audioPath = path.join(projectDirectory, 'chapters', id, 'audio', 'narration.wav');
  const fileBytes = await fs.readFile(audioPath);
  const audioAsset = getAudioAsset(fileBytes, scenario);
  if (!audioAsset) return null;
  return { audioAsset, audio: new Uint8Array(fileBytes) };
}

module.exports = { loadChapterAudio, loadScenarioProject, saveChapterAudio, saveScenarioProject };