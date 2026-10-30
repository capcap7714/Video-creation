const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { createVideoEncoder } = require('../electron/video-export.cjs');

function makeFakeSpawn(exitCode = 0) {
  const calls = [];
  const spawnProcess = (command, args, options) => {
    const child = new EventEmitter();
    const frames = [];
    child.frames = frames;
    child.stderr = new PassThrough();
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        frames.push(Buffer.from(chunk));
        callback();
      },
    });
    child.kill = () => {
      setImmediate(() => child.emit('close', 1));
      return true;
    };
    child.stdin.on('finish', () => setImmediate(() => child.emit('close', exitCode)));
    calls.push({ command, args, options, child });
    return child;
  };
  return { calls, spawnProcess };
}

async function main() {
  const fake = makeFakeSpawn();
  const encoder = createVideoEncoder({
    ffmpegPath: 'C:\\tools\\ffmpeg.exe',
    audioPath: 'C:\\temp\\narration.wav',
    subtitlesPath: 'C:\\temp\\narration.srt',
    outputPath: 'C:\\temp\\chapter.mp4',
    contentDurationSeconds: 5.25,
    spawnProcess: fake.spawnProcess,
  });
  const call = fake.calls[0];
  assert.equal(call.command, 'C:\\tools\\ffmpeg.exe');
  assert.equal(call.options.shell, false);
  assert.deepEqual(call.args.slice(0, 12), [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe',
    '-framerate', '30', '-vcodec', 'png', '-i', 'pipe:0',
  ].slice(0, 12));
  assert.equal(call.args[call.args.indexOf('-t') + 1], '8.250');
  assert.equal(call.args[call.args.indexOf('-map') + 1], '0:v:0');
  assert.equal(call.args[call.args.indexOf('-af') + 1], 'adelay=delays=2000:all=1,apad=pad_dur=6');
  assert.ok(call.args.includes('libx264'));
  assert.ok(call.args.includes('aac'));
  assert.ok(call.args.includes('mov_text'));
  assert.equal(call.args[call.args.indexOf('-ar') + 1], '48000');

  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  await encoder.writeFrame(png);
  await encoder.writeFrame(png);
  await encoder.finish();
  assert.equal(call.child.frames.length, 2);
  await assert.rejects(encoder.writeFrame(png), /終了しています/);

  const failed = makeFakeSpawn(1);
  const failedEncoder = createVideoEncoder({
    ffmpegPath: 'ffmpeg',
    audioPath: 'audio.wav',
    subtitlesPath: 'captions.srt',
    outputPath: 'video.mp4',
    contentDurationSeconds: 1,
    spawnProcess: failed.spawnProcess,
  });
  failed.calls[0].child.stderr.write('simulated codec error');
  await assert.rejects(failedEncoder.finish(), /終了コード1.*simulated codec error/);

  const invalidFrame = createVideoEncoder({
    ffmpegPath: 'ffmpeg',
    audioPath: 'audio.wav',
    subtitlesPath: 'captions.srt',
    outputPath: 'video.mp4',
    contentDurationSeconds: 1,
    spawnProcess: makeFakeSpawn().spawnProcess,
  });
  await assert.rejects(invalidFrame.writeFrame(Buffer.from('not png')), /PNGフレーム/);
  await invalidFrame.finish();

  console.log('Video export: 30fps PNG streaming, 2-second intro and 3-second final hold/credit timing, chapter audio/SRT mapping, H.264/AAC mux, and frame validation passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});