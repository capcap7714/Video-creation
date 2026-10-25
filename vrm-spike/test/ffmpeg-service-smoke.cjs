const assert = require('node:assert/strict');
const { checkFfmpeg } = require('../electron/ffmpeg-service.cjs');

function makeExecFile({ lookupError = null, encoders = ' V..... libx264 H.264 / AVC\n A..... aac AAC' } = {}) {
  const calls = [];
  const execFileImpl = (command, args, options, callback) => {
    calls.push({ command, args, options });
    if (command === 'where.exe' || command === 'which') callback(lookupError, 'C:\\tools\\ffmpeg.exe\n', '');
    else callback(null, '', encoders);
  };
  return { calls, execFileImpl };
}

async function main() {
  const found = makeExecFile();
  const available = await checkFfmpeg({ execFileImpl: found.execFileImpl, platform: 'win32' });
  assert.equal(available.available, true);
  assert.equal(available.path, 'C:\\tools\\ffmpeg.exe');
  assert.equal(found.calls[0].command, 'where.exe');
  assert.deepEqual(found.calls[0].args, ['ffmpeg']);
  assert.deepEqual(found.calls[1].args, ['-hide_banner', '-encoders']);

  const explicitPath = makeExecFile();
  const explicit = await checkFfmpeg({
    execFileImpl: explicitPath.execFileImpl,
    platform: 'win32',
    executablePath: 'D:\\tools\\ffmpeg.exe',
  });
  assert.equal(explicit.available, true);
  assert.equal(explicit.path, 'D:\\tools\\ffmpeg.exe');
  assert.equal(explicitPath.calls.length, 1, 'explicit FFmpeg path should bypass PATH lookup');

  const missing = makeExecFile({ lookupError: new Error('not found') });
  const unavailable = await checkFfmpeg({ execFileImpl: missing.execFileImpl, platform: 'win32' });
  assert.equal(unavailable.available, false);
  assert.match(unavailable.message, /PATH/);
  assert.equal(missing.calls.length, 1);

  const noH264 = makeExecFile({ encoders: ' A..... aac AAC' });
  const unsupported = await checkFfmpeg({ execFileImpl: noH264.execFileImpl, platform: 'win32' });
  assert.equal(unsupported.available, false);
  assert.match(unsupported.message, /H\.264/);

  console.log('FFmpeg check: Windows PATH lookup, required H.264/AAC encoders, and missing dependency guidance passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});