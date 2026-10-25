const { execFile } = require('node:child_process');

function checkFfmpeg({ execFileImpl = execFile, platform = process.platform, executablePath = process.env.CVIDEO_FFMPEG_PATH } = {}) {
  const locator = platform === 'win32' ? 'where.exe' : 'which';
  return new Promise((resolve) => {
    const inspectEncoders = (candidatePath) => {
      if (!candidatePath) {
        resolve({ available: false, message: 'FFmpegが見つかりません。FFmpegを導入し、実行ファイルへPATHを通してください。' });
        return;
      }

      execFileImpl(candidatePath, ['-hide_banner', '-encoders'], { windowsHide: true, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 }, (encoderError, encoderStdout, encoderStderr) => {
        if (encoderError) {
          resolve({ available: false, path: candidatePath, message: 'FFmpegのエンコーダー一覧を取得できません。実行権限とインストール状態を確認してください。' });
          return;
        }

        const encoderOutput = `${encoderStdout}\n${encoderStderr}`;
        const hasH264 = /\blibx264\b/.test(encoderOutput);
        const hasAac = /\baac\b/.test(encoderOutput);
        if (!hasH264 || !hasAac) {
          const missing = [!hasH264 && 'H.264 (libx264)', !hasAac && 'AAC'].filter(Boolean).join('、');
          resolve({ available: false, path: candidatePath, message: `FFmpegに必要なエンコーダーがありません: ${missing}` });
          return;
        }

        resolve({ available: true, path: candidatePath, message: 'FFmpegとH.264/AACエンコーダーを確認しました。' });
      });
    };

    if (executablePath) {
      inspectEncoders(executablePath);
      return;
    }

    execFileImpl(locator, ['ffmpeg'], { windowsHide: true, timeout: 5_000 }, (lookupError, stdout) => {
      const pathFromEnvironment = lookupError ? '' : stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      inspectEncoders(pathFromEnvironment);
    });
  });
}

module.exports = { checkFfmpeg };