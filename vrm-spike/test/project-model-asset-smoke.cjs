const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  loadScenarioProject,
  saveExternalProjectModel,
  saveProjectModel,
  saveScenarioProject,
} = require('../electron/project-store.cjs');

async function main() {
  const projectDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'cvideo-project-model-'));
  const externalModelDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'cvideo-external-model-'));
  const draft = { title: 'VRM portability', chapters: [{ title: 'Model', narration: 'Persist the selected model.' }] };
  const modelBytes = Buffer.alloc(16);
  modelBytes.write('glTF');
  const externalModelPath = path.join(externalModelDirectory, 'external.vrm');

  try {
    await saveScenarioProject(projectDirectory, {}, draft);
    await fs.writeFile(externalModelPath, modelBytes);
    const externalModel = await saveExternalProjectModel(projectDirectory, externalModelPath);
    assert.equal(externalModel.storageMode, 'external');
    assert.equal(externalModel.sourcePath, await fs.realpath(externalModelPath));
    assert.deepEqual(Buffer.from(externalModel.bytes), modelBytes);
    let loaded = await loadScenarioProject(projectDirectory);
    assert.equal(loaded.modelAsset.storageMode, 'external');
    assert.equal(loaded.modelAsset.sourcePath, await fs.realpath(externalModelPath));
    assert.deepEqual(Buffer.from(loaded.modelAsset.bytes), modelBytes);
    assert.equal(loaded.modelAssetMissing, false);

    await saveScenarioProject(projectDirectory, {}, draft);
    loaded = await loadScenarioProject(projectDirectory);
    assert.equal(loaded.modelAsset.storageMode, 'external', 'scenario saves should retain external references');

    await fs.rm(externalModelPath);
    loaded = await loadScenarioProject(projectDirectory);
    assert.equal(loaded.modelAsset, undefined);
    assert.equal(loaded.modelAssetMissing, true, 'missing external models should be reported without rejecting the project');

    await fs.writeFile(externalModelPath, modelBytes);
    const modelAsset = await saveProjectModel(projectDirectory, 'character.vrm', modelBytes);
    loaded = await loadScenarioProject(projectDirectory);
    assert.equal(loaded.modelAsset.fileName, 'character.vrm');
    assert.deepEqual(Buffer.from(loaded.modelAsset.bytes), modelBytes);
    assert.equal(loaded.modelAssetMissing, false);

    await saveScenarioProject(projectDirectory, {}, draft);
    loaded = await loadScenarioProject(projectDirectory);
    assert.equal(loaded.modelAsset.fileName, 'character.vrm', 'scenario autosaves should retain the model reference');

    await fs.rm(path.join(projectDirectory, ...modelAsset.path.split('/')));
    loaded = await loadScenarioProject(projectDirectory);
    assert.equal(loaded.modelAsset, undefined);
    assert.equal(loaded.modelAssetMissing, true, 'missing copied models should be reported without rejecting the project');
    await assert.rejects(saveProjectModel(projectDirectory, 'invalid.vrm', Buffer.from('not a glb')));
    console.log('Project VRM copy, manifest retention, integrity checks, and missing-asset detection passed');
  } finally {
    await fs.rm(projectDirectory, { recursive: true, force: true });
    await fs.rm(externalModelDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});