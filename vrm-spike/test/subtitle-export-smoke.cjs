const assert = require('node:assert/strict');
const { formatSrt } = require('../electron/subtitle-export.cjs');

const srt = formatSrt([
  { startSeconds: 0.021, endSeconds: 1.98, text: '最初の字幕です。' },
  { startSeconds: 2.02, endSeconds: 3.9996, text: '2行目\n続きです。' },
]);
assert.equal(srt,
  '1\r\n00:00:00,021 --> 00:00:01,980\r\n最初の字幕です。\r\n\r\n'
  + '2\r\n00:00:02,020 --> 00:00:04,000\r\n2行目\r\n続きです。\r\n');
assert.throws(() => formatSrt([]), /字幕がありません/);
assert.throws(() => formatSrt([{ startSeconds: 1, endSeconds: 1, text: '短すぎる' }]), /時刻と本文/);
assert.throws(() => formatSrt([
  { startSeconds: 0, endSeconds: 2, text: '最初' },
  { startSeconds: 1, endSeconds: 3, text: '重複' },
]), /時刻と本文/);
assert.throws(() => formatSrt([{ startSeconds: 0, endSeconds: 2, text: '   ' }]), /時刻と本文/);

console.log('SRT export: UTF-8 text, millisecond timestamps, line breaks, ordering, and invalid cue rejection passed.');