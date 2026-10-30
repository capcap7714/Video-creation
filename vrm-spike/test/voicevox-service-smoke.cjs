const assert = require('node:assert/strict');
const {
  convertPronunciationText,
  defaultPronunciationRules,
} = require('../electron/pronunciation-rules.cjs');
const { listSpeakers, synthesizeSpeech } = require('../electron/voicevox-service.cjs');

function makePcmWav(durationSeconds = 1) {
  const pcm = Buffer.alloc(24000 * 2 * durationSeconds);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function main() {
assert.equal(
  convertPronunciationText('printf関数とint型。sprintf、fprintf、uint、integer、printf2、_intは変えません。'),
  'ぷりんとえふ関数といんと型。エス・ピー・アール・アイ・エヌ・ティー・エフ、エフ・ピー・アール・アイ・エヌ・ティー・エフ、ユー・アイ・エヌ・ティー、インテジャー、ピー・アール・アイ・エヌ・ティー・エフ2、_intは変えません。',
);
assert.equal(
  convertPronunciationText('値はprintfで設定する。', { ...defaultPronunciationRules, 値: 'あたい' }),
  'あたいはぷりんとえふで設定する。',
);
assert.equal(
  convertPronunciationText('value printf int xyz', {
    ...defaultPronunciationRules,
    value: 'ばりゅー',
  }),
  'バリュー ぷりんとえふ いんと エックス・ワイ・ゼット',
);
const speakers = await listSpeakers(async (url, options) => {
  assert.equal(new URL(url).origin, 'http://127.0.0.1:50021');
  assert.equal(new URL(url).pathname, '/speakers');
  assert.equal(options.signal.aborted, false);
  return Response.json([
    { name: '四国めたん', styles: [{ name: 'ノーマル', id: 2 }, { name: '不正', id: 'x' }] },
    { name: '壊れた話者', styles: null },
  ]);
});
assert.deepEqual(speakers, [{ name: '四国めたん', styles: [{ name: 'ノーマル', id: 2 }] }]);

const requests = [];
let lastAudioQuery;
let lastSentence;
const result = await synthesizeSpeech({
  openingText: '冒頭の挨拶です。',
  text: 'printfとintとsize_tと値とvalueとxyzを使います。もう一文です。',
  styleId: 2,
  pronunciationRules: { ...defaultPronunciationRules, size_t: 'サイズティー', 値: 'あたい' },
}, async (url, options) => {
  const requestUrl = new URL(url);
  requests.push({ requestUrl, options });
  if (requestUrl.pathname === '/audio_query') {
    const sentence = requestUrl.searchParams.get('text');
    lastSentence = sentence;
    assert.ok([
      '冒頭の挨拶です。',
      'ぷりんとえふといんととサイズティーとあたいとバリューとエックス・ワイ・ゼットを使います。',
      'もう一文です。',
    ].includes(sentence));
    assert.equal(requestUrl.searchParams.get('speaker'), '2');
    assert.equal(options.method, 'POST');
    lastAudioQuery = {
      accent_phrases: [{
        moras: [{ consonant: 't', consonant_length: 0.01, vowel: sentence.includes('ぷりんとえふ') ? 'a' : 'i', vowel_length: 0.03 }],
        pause_mora: null,
      }],
      prePhonemeLength: 0.01,
      postPhonemeLength: 0.01,
      speedScale: 1,
    };
    return Response.json(lastAudioQuery);
  }
  assert.equal(requestUrl.pathname, '/synthesis');
  assert.equal(requestUrl.searchParams.get('speaker'), '2');
  assert.deepEqual(JSON.parse(options.body), lastAudioQuery);
  assert.equal(options.headers['content-type'], 'application/json');
  const durationSeconds = lastSentence.includes('ぷりんとえふ') ? 2 : 1;
  return new Response(makePcmWav(durationSeconds), { headers: { 'content-type': 'audio/wav' } });
});
assert.equal(Buffer.from(result.audio).toString('ascii', 0, 4), 'RIFF');
assert.equal(Buffer.from(result.audio).readUInt32LE(40), 24000 * 2 * 4);
assert.equal(requests.length, 6);
assert.deepEqual(result.subtitles, [
  { startSeconds: 1.01, endSeconds: 2.81, text: 'printfとintとsize_tと値とvalueとxyzを使います。' },
  { startSeconds: 3.01, endSeconds: 3.99, text: 'もう一文です。' },
]);
assert.equal(result.openingDurationSeconds, 1.01);
assert.ok(result.subtitles.every((subtitle) => !subtitle.text.includes('冒頭の挨拶')));
assert.ok(Math.round((result.subtitles[1].startSeconds - result.subtitles[0].endSeconds) * 1000) >= 200);
assert.ok(result.subtitles.every((subtitle) => subtitle.endSeconds - subtitle.startSeconds >= 0.8));
assert.deepEqual(result.mouthTimeline, [
  { start: 0.02, end: 0.05, expression: 'ih' },
  { start: 1.02, end: 1.05, expression: 'aa' },
  { start: 3.02, end: 3.05, expression: 'ih' },
]);

await assert.rejects(
  listSpeakers(async () => { throw new Error('private endpoint details'); }),
  (error) => error.message.includes('Engineを起動') && !error.message.includes('private endpoint details'),
);
await assert.rejects(
  listSpeakers(async () => new Response('{}', { status: 503 })),
  /応答を確認できません/,
);

console.log('VOICEVOX service: fixed loopback, speaker validation, style query, WAV response, and unavailable-engine guidance passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});