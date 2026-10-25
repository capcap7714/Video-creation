const assert = require('node:assert/strict');
const { listSpeakers, synthesizeSpeech } = require('../electron/voicevox-service.cjs');

function makePcmWav() {
  const pcm = Buffer.alloc(2400 * 2);
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
const result = await synthesizeSpeech({ text: '試験音声です。もう一文です。', styleId: 2 }, async (url, options) => {
  const requestUrl = new URL(url);
  requests.push({ requestUrl, options });
  if (requestUrl.pathname === '/audio_query') {
    assert.ok(['試験音声です。', 'もう一文です。'].includes(requestUrl.searchParams.get('text')));
    assert.equal(requestUrl.searchParams.get('speaker'), '2');
    assert.equal(options.method, 'POST');
    return Response.json({ accent_phrases: [], prePhonemeLength: 0.01, postPhonemeLength: 0.01, speedScale: 1 });
  }
  assert.equal(requestUrl.pathname, '/synthesis');
  assert.equal(requestUrl.searchParams.get('speaker'), '2');
  assert.deepEqual(JSON.parse(options.body), {
    accent_phrases: [], prePhonemeLength: 0.01, postPhonemeLength: 0.01, speedScale: 1,
  });
  assert.equal(options.headers['content-type'], 'application/json');
  return new Response(makePcmWav(), { headers: { 'content-type': 'audio/wav' } });
});
assert.equal(Buffer.from(result.audio).toString('ascii', 0, 4), 'RIFF');
assert.equal(Buffer.from(result.audio).readUInt32LE(40), 2400 * 2 * 2);
assert.equal(requests.length, 4);
assert.deepEqual(result.subtitles, [
  { startSeconds: 0.01, endSeconds: 0.09, text: '試験音声です。' },
  { startSeconds: 0.11, endSeconds: 0.19, text: 'もう一文です。' },
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