const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const baseUrl = 'http://127.0.0.1:50021';
const text = 'C言語では、変数にデータを保存します。';

async function main() {
  const versionResponse = await fetch(`${baseUrl}/version`);
  assert.equal(versionResponse.status, 200, 'VOICEVOX Engine should respond');
  const version = await versionResponse.text();

  const speakersResponse = await fetch(`${baseUrl}/speakers`);
  assert.equal(speakersResponse.status, 200, 'speaker list should be available');
  const speakers = await speakersResponse.json();
  const speaker = speakers.find((entry) => entry.name === '四国めたん');
  const style = speaker?.styles.find((entry) => entry.name === 'ノーマル');
  assert.ok(style, 'VOICEVOX:四国めたん (ノーマル) should be available');

  const queryUrl = new URL(`${baseUrl}/audio_query`);
  queryUrl.searchParams.set('text', text);
  queryUrl.searchParams.set('speaker', String(style.id));
  const queryResponse = await fetch(queryUrl, { method: 'POST' });
  assert.equal(queryResponse.status, 200, 'audio query should succeed');
  const audioQuery = await queryResponse.json();

  const synthesisResponse = await fetch(`${baseUrl}/synthesis?speaker=${style.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(audioQuery),
  });
  assert.equal(synthesisResponse.status, 200, 'speech synthesis should succeed');
  const wav = Buffer.from(await synthesisResponse.arrayBuffer());
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');

  const outputPath = path.resolve(__dirname, '../test-results/voicevox-smoke.wav');
  await fs.writeFile(outputPath, wav);
  console.log(`VOICEVOX ${version.trim()}: ${speaker.name} / ${style.name}`);
  console.log(`WAV: ${wav.length} bytes -> ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
