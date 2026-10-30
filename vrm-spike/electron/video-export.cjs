const { spawn } = require('node:child_process');

const MAX_FRAME_BYTES = 10 * 1024 * 1024;
const MAX_ERROR_BYTES = 32 * 1024;
let testEncoderFailureInjected = false;

function createVideoEncoder({
  ffmpegPath,
  audioPath,
  subtitlesPath,
  outputPath,
  contentDurationSeconds,
  spawnProcess = spawn,
}) {
  if (
    typeof ffmpegPath !== 'string'
    || typeof audioPath !== 'string'
    || typeof subtitlesPath !== 'string'
    || typeof outputPath !== 'string'
    || !Number.isFinite(contentDurationSeconds)
    || contentDurationSeconds <= 0
    || contentDurationSeconds > 3606
  ) {
    throw new Error('動画の書き出し設定を確認してください。');
  }

  const totalDurationSeconds = contentDurationSeconds + 3;
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', '30', '-vcodec', 'png', '-i', 'pipe:0',
    '-i', audioPath,
    '-i', subtitlesPath,
    '-map', '0:v:0', '-map', '1:a:0', '-map', '2:s:0',
    '-t', totalDurationSeconds.toFixed(3),
    '-vf', 'format=yuv420p',
    '-af', 'adelay=delays=3000:all=1,apad=pad_dur=6',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-c:s', 'mov_text', '-movflags', '+faststart',
    outputPath,
  ];
  if (process.env.NODE_ENV === 'test' && process.env.CVIDEO_TEST_FFMPEG_EXIT_ONCE === '1' && !testEncoderFailureInjected) {
    args.splice(args.length - 1, 0, '-c:v', 'cvideo_test_missing_encoder');
    testEncoderFailureInjected = true;
  }
  const child = spawnProcess(ffmpegPath, args, {
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  let errorOutput = Buffer.alloc(0);
  let finished = false;
  let ending = false;
  child.stdin.on('error', () => {});
  child.stderr.on('data', (chunk) => {
    errorOutput = Buffer.concat([errorOutput, chunk]).subarray(-MAX_ERROR_BYTES);
  });

  const closed = new Promise((resolve, reject) => {
    child.once('error', (error) => reject(new Error(`FFmpegを起動できません: ${error.message}`)));
    child.once('close', (code) => {
      finished = true;
      if (code === 0) resolve();
      else reject(new Error(`FFmpegが終了コード${code ?? '不明'}で失敗しました。${errorOutput.toString('utf8').trim()}`));
    });
  });
  void closed.catch(() => {});

  return {
    async writeFrame(frame) {
      if (finished) {
        await closed;
        throw new Error('動画エンコードは終了しています。');
      }
      const bytes = Buffer.from(frame);
      if (bytes.length < 8 || bytes.length > MAX_FRAME_BYTES || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        throw new Error('PNGフレームが不正、または10 MiBを超えています。');
      }
      await new Promise((resolve, reject) => {
        const rejectAfterClose = (error) => {
          void closed.then(() => reject(error), reject);
        };
        child.stdin.once('error', rejectAfterClose);
        child.stdin.write(bytes, (error) => {
          child.stdin.removeListener('error', rejectAfterClose);
          if (error) rejectAfterClose(error);
          else resolve();
        });
      });
    },
    async finish() {
      if (!ending && !finished) {
        ending = true;
        child.stdin.end();
      }
      await closed;
    },
    cancel() {
      if (!finished) child.kill();
    },
    get errorOutput() {
      return errorOutput.toString('utf8');
    },
    args,
  };
}

module.exports = { createVideoEncoder };