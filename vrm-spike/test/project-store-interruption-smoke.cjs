const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { saveScenarioProject, loadScenarioProject } = require('../electron/project-store.cjs');

const originalDraft = { title: 'Old project', chapters: [{ title: 'Old chapter', narration: 'old narration' }] };
const updatedDraft = { title: 'New project', chapters: [{ title: 'New chapter', narration: 'new narration' }] };

async function terminateDuringSave(projectDirectory) {
  const rename = fs.rename;
  fs.rename = async (sourcePath, destinationPath) => {
    await rename(sourcePath, destinationPath);
    if (path.basename(destinationPath) === 'scenario.json') process.exit(75);
  };
  await saveScenarioProject(projectDirectory, {}, updatedDraft);
}

async function main() {
  const projectDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'cvideo-save-interruption-'));

  try {
    await saveScenarioProject(projectDirectory, {}, originalDraft);

    const rename = fs.rename;
    let failProjectCommit = true;
    fs.rename = async (sourcePath, destinationPath) => {
      if (failProjectCommit && path.basename(destinationPath) === 'project.json') {
        failProjectCommit = false;
        throw new Error('Injected project manifest interruption');
      }
      return rename(sourcePath, destinationPath);
    };

    try {
      await assert.rejects(
        saveScenarioProject(projectDirectory, {}, updatedDraft),
        /Injected project manifest interruption/,
      );
    } finally {
      fs.rename = rename;
    }

    const { draft } = await loadScenarioProject(projectDirectory);
    assert.deepEqual(draft, originalDraft, 'an interrupted save should preserve the complete previous project');

    const crashedSave = spawnSync(process.execPath, [__filename, '--crash-after-chapter', projectDirectory], {
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
    });
    assert.equal(crashedSave.status, 75, `child should terminate during chapter commit: ${crashedSave.stderr}`);
    const recovered = await loadScenarioProject(projectDirectory);
    assert.equal(recovered.recoveredFromInterruptedSave, true);
    assert.deepEqual(recovered.draft, originalDraft, 'loading after a process crash should restore the complete previous project');
    assert.equal(await fs.access(path.join(projectDirectory, '.project-save-recovery.json')).then(() => true, () => false), false);
    console.log('Interrupted and force-terminated project saves recovered the previous manifest and chapter data');
  } finally {
    await fs.rm(projectDirectory, { recursive: true, force: true });
  }
}

if (process.argv[2] === '--crash-after-chapter') {
  terminateDuringSave(process.argv[3]).catch(() => process.exit(1));
} else {
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
}