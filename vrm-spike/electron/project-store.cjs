const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createHash } = require('node:crypto');
const {
  defaultPronunciationRules,
  getPronunciationRulesSignature,
} = require('./pronunciation-rules.cjs');

const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const MAX_MODEL_BYTES = 512 * 1024 * 1024;
const PROJECT_SAVE_RECOVERY_FILE = '.project-save-recovery.json';

function getOpeningText(title) {
  return `こんにちは。今日は${title}について勉強します。`;
}

function getNarrationHash(text, pronunciationRules = defaultPronunciationRules) {
  return createHash('sha256')
    .update(`${text}\0${getPronunciationRulesSignature(pronunciationRules)}`, 'utf8')
    .digest('hex');
}

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

async function recoverInterruptedProjectSave(projectDirectory) {
  const recoveryPath = path.join(projectDirectory, PROJECT_SAVE_RECOVERY_FILE);
  let journal;
  try {
    journal = JSON.parse(await fs.readFile(recoveryPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    const recoveryError = new Error('Project save recovery data is invalid.');
    recoveryError.code = 'PROJECT_SAVE_RECOVERY_INVALID';
    throw recoveryError;
  }

  if (journal?.schemaVersion !== 1 || !Array.isArray(journal.files) || journal.files.length < 1) {
    const error = new Error('Project save recovery data is invalid.');
    error.code = 'PROJECT_SAVE_RECOVERY_INVALID';
    throw error;
  }

  const projectRoot = path.resolve(projectDirectory);
  try {
    for (const snapshot of journal.files) {
      const isProjectFile = snapshot?.path === 'project.json';
      const isChapterFile = typeof snapshot?.path === 'string'
        && /^chapters\/\d{2}\/scenario\.json$/.test(snapshot.path);
      if (
        (!isProjectFile && !isChapterFile)
        || typeof snapshot.existed !== 'boolean'
        || (snapshot.existed && typeof snapshot.contents !== 'string')
        || (!snapshot.existed && snapshot.contents !== null)
      ) {
        const error = new Error('Project save recovery data is invalid.');
        error.code = 'PROJECT_SAVE_RECOVERY_INVALID';
        throw error;
      }

      const filePath = path.resolve(projectRoot, ...snapshot.path.split('/'));
      if (!filePath.startsWith(`${projectRoot}${path.sep}`)) {
        const error = new Error('Project save recovery path is invalid.');
        error.code = 'PROJECT_SAVE_RECOVERY_INVALID';
        throw error;
      }
      if (snapshot.existed) {
        const contents = Buffer.from(snapshot.contents, 'base64');
        if (contents.toString('base64') !== snapshot.contents) {
          const error = new Error('Project save recovery data is invalid.');
          error.code = 'PROJECT_SAVE_RECOVERY_INVALID';
          throw error;
        }
        await writeBytesAtomically(filePath, contents);
      } else {
        await fs.rm(filePath, { force: true });
      }
    }
    await fs.rm(recoveryPath, { force: true });
  } catch (error) {
    if (error.code === 'PROJECT_SAVE_RECOVERY_INVALID') throw error;
    const recoveryError = new Error('Project save recovery failed.');
    recoveryError.code = 'PROJECT_SAVE_RECOVERY_FAILED';
    throw recoveryError;
  }
  return true;
}

function getAudioAsset(fileBytes, scenario, pronunciationRules = defaultPronunciationRules) {
  if (
    fileBytes.length < 44
    || fileBytes.length > MAX_AUDIO_BYTES
    || fileBytes.toString('ascii', 0, 4) !== 'RIFF'
    || fileBytes.toString('ascii', 8, 12) !== 'WAVE'
    || typeof scenario?.narration !== 'string'
  ) return null;
  const audioAsset = scenario.audioAsset;
  const mouthTimeline = audioAsset?.mouthTimeline ?? [];
  if (
    audioAsset?.path !== 'audio/narration.wav'
    || !Number.isFinite(audioAsset.durationSeconds)
    || audioAsset.durationSeconds <= 0
    || !Number.isFinite(audioAsset.openingDurationSeconds)
    || audioAsset.openingDurationSeconds <= 0
    || audioAsset.openingDurationSeconds >= audioAsset.durationSeconds
    || !Number.isSafeInteger(audioAsset.styleId)
    || !/^[a-f0-9]{64}$/.test(audioAsset.narrationHash)
    || !isValidMouthTimeline(mouthTimeline, audioAsset.durationSeconds)
  ) return null;
  const narrationHash = getNarrationHash(`${getOpeningText(scenario.title)}${scenario.narration}`, pronunciationRules);
  return narrationHash === audioAsset.narrationHash
    ? { ...audioAsset, mouthTimeline }
    : null;
}

function isValidMouthTimeline(mouthTimeline, durationSeconds) {
  if (!Array.isArray(mouthTimeline) || mouthTimeline.length > 10_000) return false;
  let previousEnd = 0;
  return mouthTimeline.every((cue) => {
    if (
      !Number.isFinite(cue?.start)
      || cue.start < previousEnd
      || !Number.isFinite(cue?.end)
      || cue.end <= cue.start
      || cue.end > durationSeconds
      || !['aa', 'ih', 'ou', 'ee', 'oh'].includes(cue.expression)
    ) return false;
    previousEnd = cue.end;
    return true;
  });
}

async function saveScenarioProject(projectDirectory, request, draft) {
  await recoverInterruptedProjectSave(projectDirectory);
  const chapterReferences = draft.chapters.map((chapter, index) => {
    const id = String(index + 1).padStart(2, '0');
    const relativePath = `chapters/${id}/scenario.json`;
    return { id, path: relativePath, chapter };
  });
  const projectPath = path.join(projectDirectory, 'project.json');
  let existingModelAsset;
  try {
    const existingProject = JSON.parse(await fs.readFile(projectPath, 'utf8'));
    if (isValidProjectModelAsset(existingProject.modelAsset)) existingModelAsset = existingProject.modelAsset;
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  const filePaths = [
    ...chapterReferences.map((reference) => path.join(projectDirectory, ...reference.path.split('/'))),
    projectPath,
  ];
  const snapshots = await Promise.all(filePaths.map(async (filePath) => {
    try {
      return { filePath, contents: await fs.readFile(filePath) };
    } catch (error) {
      if (error.code === 'ENOENT') return { filePath, contents: null };
      throw error;
    }
  }));
  const recoveryPath = path.join(projectDirectory, PROJECT_SAVE_RECOVERY_FILE);
  await writeJsonAtomically(recoveryPath, {
    schemaVersion: 1,
    files: snapshots.map((snapshot) => ({
      path: path.relative(projectDirectory, snapshot.filePath).split(path.sep).join('/'),
      existed: snapshot.contents !== null,
      contents: snapshot.contents?.toString('base64') ?? null,
    })),
  });

  try {
    for (const reference of chapterReferences) {
      const chapterPath = path.join(projectDirectory, ...reference.path.split('/'));
      await fs.mkdir(path.dirname(chapterPath), { recursive: true });
      await writeJsonAtomically(chapterPath, {
        schemaVersion: 1,
        chapterId: reference.id,
        ...reference.chapter,
      });
    }

    const savedProject = {
      schemaVersion: 1,
      title: draft.title,
      language: 'ja',
      request,
      chapters: chapterReferences.map(({ id, path: relativePath }) => ({ id, path: relativePath })),
    };
    if (existingModelAsset) savedProject.modelAsset = existingModelAsset;
    await writeJsonAtomically(projectPath, savedProject);
    await fs.rm(recoveryPath, { force: true });
    return projectPath;
  } catch (error) {
    const rollbackErrors = [];
    for (const snapshot of snapshots) {
      try {
        if (snapshot.contents === null) await fs.rm(snapshot.filePath, { force: true });
        else await writeBytesAtomically(snapshot.filePath, snapshot.contents);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length === 0) {
      try {
        await fs.rm(recoveryPath, { force: true });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        'Project save failed and previous files could not be fully restored.',
      );
    }
    throw error;
  }
}

function isValidProjectModelAsset(modelAsset) {
  const validMetadata = typeof modelAsset?.fileName === 'string'
    && modelAsset.fileName.length > 0
    && /^[a-f0-9]{64}$/.test(modelAsset.sha256)
    && Number.isSafeInteger(modelAsset.sizeBytes)
    && modelAsset.sizeBytes >= 12
    && modelAsset.sizeBytes <= MAX_MODEL_BYTES;
  if (!validMetadata) return false;
  if (modelAsset.storageMode === 'external') {
    return typeof modelAsset.sourcePath === 'string' && path.isAbsolute(modelAsset.sourcePath);
  }
  return (modelAsset.storageMode === undefined || modelAsset.storageMode === 'copy')
    && typeof modelAsset.path === 'string'
    && /^assets\/models\/[a-f0-9]{64}\.vrm$/.test(modelAsset.path)
    && modelAsset.path === `assets/models/${modelAsset.sha256}.vrm`;
}

function createModelMetadata(fileName, modelBytes) {
  const bytes = Buffer.from(modelBytes);
  if (
    bytes.length < 12
    || bytes.length > MAX_MODEL_BYTES
    || bytes.toString('ascii', 0, 4) !== 'glTF'
    || typeof fileName !== 'string'
    || fileName.trim().length === 0
  ) throw new Error('Invalid VRM model asset.');

  return {
    fileName: path.basename(fileName.trim()).slice(0, 255),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
  };
}

async function saveProjectModel(projectDirectory, fileName, modelBytes) {
  const bytes = Buffer.from(modelBytes);
  const metadata = createModelMetadata(fileName, bytes);
  const projectPath = path.join(projectDirectory, 'project.json');
  const project = JSON.parse(await fs.readFile(projectPath, 'utf8'));
  if (project?.schemaVersion !== 1 || !Array.isArray(project.chapters)) {
    throw new Error('Invalid project manifest.');
  }

  const { sha256 } = metadata;
  const relativePath = `assets/models/${sha256}.vrm`;
  const modelPath = path.join(projectDirectory, ...relativePath.split('/'));
  await fs.mkdir(path.dirname(modelPath), { recursive: true });
  await writeBytesAtomically(modelPath, bytes);

  const modelAsset = {
    ...metadata,
    storageMode: 'copy',
    path: relativePath,
  };
  await writeJsonAtomically(projectPath, { ...project, modelAsset });
  return modelAsset;
}

async function saveExternalProjectModel(projectDirectory, sourcePath) {
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) {
    throw new Error('Invalid external VRM model path.');
  }
  const resolvedPath = await fs.realpath(sourcePath);
  const bytes = await fs.readFile(resolvedPath);
  const metadata = createModelMetadata(path.basename(resolvedPath), bytes);
  const projectPath = path.join(projectDirectory, 'project.json');
  const project = JSON.parse(await fs.readFile(projectPath, 'utf8'));
  if (project?.schemaVersion !== 1 || !Array.isArray(project.chapters)) {
    throw new Error('Invalid project manifest.');
  }

  const modelAsset = {
    ...metadata,
    storageMode: 'external',
    sourcePath: resolvedPath,
  };
  await writeJsonAtomically(projectPath, { ...project, modelAsset });
  return { ...modelAsset, bytes: new Uint8Array(bytes) };
}

async function loadScenarioProject(projectDirectory) {
  const recoveredFromInterruptedSave = await recoverInterruptedProjectSave(projectDirectory);
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

  let modelAsset;
  let modelAssetMissing = false;
  if (project.modelAsset !== undefined) {
    if (!isValidProjectModelAsset(project.modelAsset)) {
      modelAssetMissing = true;
    } else {
      const modelPath = project.modelAsset.storageMode === 'external'
        ? project.modelAsset.sourcePath
        : path.join(projectDirectory, ...project.modelAsset.path.split('/'));
      try {
        const bytes = await fs.readFile(modelPath);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        if (bytes.length !== project.modelAsset.sizeBytes || sha256 !== project.modelAsset.sha256) {
          modelAssetMissing = true;
        } else {
          modelAsset = {
            fileName: project.modelAsset.fileName,
            storageMode: project.modelAsset.storageMode ?? 'copy',
            sourcePath: project.modelAsset.sourcePath,
            bytes: new Uint8Array(bytes),
          };
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        modelAssetMissing = true;
      }
    }
  }

  return {
    project,
    request: project.request,
    draft: { title: project.title, chapters },
    recoveredFromInterruptedSave,
    modelAsset,
    modelAssetMissing,
  };
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
    || !Number.isFinite(details?.openingDurationSeconds)
    || details.openingDurationSeconds <= 0
    || details.openingDurationSeconds >= details.durationSeconds
    || (details.speakerName !== undefined && (typeof details.speakerName !== 'string' || details.speakerName.trim().length === 0 || details.speakerName.length > 100))
    || typeof details?.narration !== 'string'
    || details.narration !== scenario.narration
    || details.openingText !== getOpeningText(scenario.title)
    || !isValidMouthTimeline(details.mouthTimeline ?? [], details.durationSeconds)
  ) {
    throw new Error('Invalid audio asset.');
  }

  const audioAsset = {
    path: 'audio/narration.wav',
    durationSeconds: details.durationSeconds,
    styleId: details.styleId,
    speakerName: details.speakerName?.trim() || '話者名未記録',
    narrationHash: getNarrationHash(
      `${details.openingText}${details.narration}`,
      details.pronunciationRules ?? defaultPronunciationRules,
    ),
    openingDurationSeconds: details.openingDurationSeconds,
    mouthTimeline: details.mouthTimeline ?? [],
  };
  const audioPath = path.join(projectDirectory, 'chapters', id, 'audio', 'narration.wav');
  await fs.mkdir(path.dirname(audioPath), { recursive: true });
  await writeBytesAtomically(audioPath, fileBytes);
  await writeJsonAtomically(scenarioPath, { ...scenario, audioAsset });
  return audioAsset;
}

async function loadChapterAudio(projectDirectory, chapterIndex, pronunciationRules = defaultPronunciationRules) {
  const { id, scenario } = await resolveChapterScenario(projectDirectory, chapterIndex);
  const audioPath = path.join(projectDirectory, 'chapters', id, 'audio', 'narration.wav');
  const fileBytes = await fs.readFile(audioPath);
  const audioAsset = getAudioAsset(fileBytes, scenario, pronunciationRules);
  if (!audioAsset) return null;
  return { audioAsset, audio: new Uint8Array(fileBytes) };
}

module.exports = {
  loadChapterAudio,
  loadScenarioProject,
  saveChapterAudio,
  saveExternalProjectModel,
  saveProjectModel,
  saveScenarioProject,
};