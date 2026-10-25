const MAX_SUBTITLES = 1000;
const MAX_DURATION_SECONDS = 3600;

function toMilliseconds(seconds) {
  return Math.round(seconds * 1000);
}

function formatSrtTime(milliseconds) {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  const remainder = milliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(remainder).padStart(3, '0')}`;
}

function formatSrt(subtitles) {
  if (!Array.isArray(subtitles) || subtitles.length === 0 || subtitles.length > MAX_SUBTITLES) {
    throw new Error('字幕がありません。');
  }

  let previousEnd = 0;
  const cues = subtitles.map((subtitle, index) => {
    if (
      !Number.isFinite(subtitle?.startSeconds)
      || !Number.isFinite(subtitle?.endSeconds)
      || subtitle.startSeconds < 0
      || subtitle.endSeconds > MAX_DURATION_SECONDS
      || subtitle.endSeconds <= subtitle.startSeconds
      || (index > 0 && subtitle.startSeconds < previousEnd)
      || typeof subtitle.text !== 'string'
      || subtitle.text.trim().length === 0
      || subtitle.text.length > 1000
    ) {
      throw new Error('字幕の時刻と本文を確認してください。');
    }

    const start = toMilliseconds(subtitle.startSeconds);
    const end = toMilliseconds(subtitle.endSeconds);
    if (end <= start) throw new Error('字幕の表示時間が短すぎます。');
    previousEnd = subtitle.endSeconds;
    const text = subtitle.text.trim().replace(/\r\n|\r|\n/gu, '\r\n');
    return [String(index + 1), `${formatSrtTime(start)} --> ${formatSrtTime(end)}`, text].join('\r\n');
  });

  return `${cues.join('\r\n\r\n')}\r\n`;
}

module.exports = { formatSrt };