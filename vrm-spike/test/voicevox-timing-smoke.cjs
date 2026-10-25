const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const baseUrl = 'http://127.0.0.1:50021';
const speakerId = 2;
const sentences = [
  'C言語では、変数にデータを保存します。',
  '次に、値を画面へ表示します。',
];
const vowelExpressions = { a: 'aa', i: 'ih', u: 'ou', e: 'ee', o: 'oh' };

function parsePcmWav(wav) {
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');

  let offset = 12;
  let format;
  let channels;
  let sampleRate;
  let bitsPerSample;
  let pcm;

  while (offset + 8 <= wav.length) {
    const chunkId = wav.toString('ascii', offset, offset + 4);
    const chunkSize = wav.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;

    if (chunkId === 'fmt ') {
      format = wav.readUInt16LE(chunkStart);
      channels = wav.readUInt16LE(chunkStart + 2);
      sampleRate = wav.readUInt32LE(chunkStart + 4);
      bitsPerSample = wav.readUInt16LE(chunkStart + 14);
    } else if (chunkId === 'data') {
      pcm = wav.subarray(chunkStart, chunkStart + chunkSize);
    }

    offset = chunkStart + chunkSize + (chunkSize & 1);
  }

  assert.equal(format, 1, 'VOICEVOX output should use PCM');
  assert.ok(pcm, 'WAV should contain PCM data');
  return { channels, sampleRate, bitsPerSample, pcm };
}

function makePcmWav(pcm, { channels, sampleRate, bitsPerSample }) {
  const header = Buffer.alloc(44);
  const blockAlign = channels * bitsPerSample / 8;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function formatSrtTime(seconds) {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((milliseconds % 60_000) / 1000);
  const remainder = milliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')},${String(remainder).padStart(3, '0')}`;
}

async function synthesizeSentence(text) {
  const queryUrl = new URL(`${baseUrl}/audio_query`);
  queryUrl.searchParams.set('text', text);
  queryUrl.searchParams.set('speaker', String(speakerId));
  const queryResponse = await fetch(queryUrl, { method: 'POST' });
  assert.equal(queryResponse.status, 200, `audio_query should succeed for: ${text}`);
  const query = await queryResponse.json();

  const synthesisResponse = await fetch(`${baseUrl}/synthesis?speaker=${speakerId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  });
  assert.equal(synthesisResponse.status, 200, `synthesis should succeed for: ${text}`);
  const wav = Buffer.from(await synthesisResponse.arrayBuffer());
  const parsedWav = parsePcmWav(wav);
  const bytesPerSample = parsedWav.bitsPerSample / 8;
  const duration = parsedWav.pcm.length / (parsedWav.sampleRate * parsedWav.channels * bytesPerSample);
  const moraDuration = query.accent_phrases.flatMap((phrase) => phrase.moras)
    .reduce((sum, mora) => sum + (mora.consonant_length || 0) + mora.vowel_length, 0);
  const pauseDuration = query.accent_phrases
    .reduce((sum, phrase) => sum + (phrase.pause_mora
      ? (phrase.pause_mora.consonant_length || 0) + phrase.pause_mora.vowel_length
      : 0), 0);
  const estimatedDuration = query.prePhonemeLength + moraDuration + pauseDuration + query.postPhonemeLength;

  assert.ok(Math.abs(duration - estimatedDuration) < 0.08, 'query timing should match synthesized WAV duration');
  return { text, query, ...parsedWav, duration, estimatedDuration };
}

async function main() {
  const segments = [];
  let totalDuration = 0;
  let wavFormat;

  for (const text of sentences) {
    const segment = await synthesizeSentence(text);
    wavFormat ??= segment;
    assert.equal(segment.sampleRate, wavFormat.sampleRate);
    assert.equal(segment.channels, wavFormat.channels);
    assert.equal(segment.bitsPerSample, wavFormat.bitsPerSample);
    segments.push({ ...segment, offset: totalDuration });
    totalDuration += segment.duration;
  }

  const cues = segments.map((segment) => ({
    start: segment.offset + segment.query.prePhonemeLength,
    end: segment.offset + segment.duration - segment.query.postPhonemeLength,
    text: segment.text,
  }));
  const subtitles = cues.map((cue, index) => [
    String(index + 1),
    `${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}`,
    cue.text,
  ].join('\n')).join('\n\n') + '\n';

  const mouthTimeline = [];
  for (const segment of segments) {
    let cursor = segment.offset + segment.query.prePhonemeLength;
    for (const phrase of segment.query.accent_phrases) {
      for (const mora of phrase.moras) {
        const consonantLength = mora.consonant_length || 0;
        const vowelStart = cursor + consonantLength;
        const expression = vowelExpressions[mora.vowel.toLowerCase()];
        if (expression) {
          mouthTimeline.push({
            start: vowelStart,
            end: vowelStart + mora.vowel_length,
            expression,
          });
        }
        cursor += consonantLength + mora.vowel_length;
      }
      if (phrase.pause_mora) {
        cursor += (phrase.pause_mora.consonant_length || 0) + phrase.pause_mora.vowel_length;
      }
    }
  }

  assert.equal(cues.length, sentences.length);
  assert.ok(cues.every((cue) => cue.start < cue.end && cue.end <= totalDuration));
  assert.ok(mouthTimeline.length > 0);

  const outputDir = path.resolve(__dirname, '../test-results');
  const combinedWav = makePcmWav(Buffer.concat(segments.map((segment) => segment.pcm)), wavFormat);
  const wavPath = path.join(outputDir, 'voicevox-timeline-smoke.wav');
  const srtPath = path.join(outputDir, 'voicevox-timeline-smoke.srt');
  const timelinePath = path.join(outputDir, 'voicevox-mouth-timeline.json');
  await fs.writeFile(wavPath, combinedWav);
  await fs.writeFile(srtPath, subtitles, 'utf8');
  await fs.writeFile(timelinePath, JSON.stringify({ duration: totalDuration, cues, mouthTimeline }, null, 2));

  console.log(`Generated ${cues.length} sentence cues and ${mouthTimeline.length} vowel shapes`);
  console.log(`Combined WAV duration: ${totalDuration.toFixed(3)} s`);
  console.log(`SRT: ${srtPath}`);
  console.log(`Mouth timeline: ${timelinePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});