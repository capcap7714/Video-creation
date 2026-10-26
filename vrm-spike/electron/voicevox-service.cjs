const API_ORIGIN = 'http://127.0.0.1:50021';
const MAX_MOUTH_CUES = 10_000;
const VOWEL_EXPRESSIONS = { a: 'aa', i: 'ih', u: 'ou', e: 'ee', o: 'oh' };
const MAX_WAV_BYTES = 50 * 1024 * 1024;
const MAX_SENTENCES = 100;

async function requestJson(url, options, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, options);
  } catch {
    throw new Error('VOICEVOX Engineに接続できません。Engineを起動してから再試行してください。');
  }
  if (!response.ok) {
    throw new Error('VOICEVOX Engineの応答を確認できません。Engineの状態を確認してください。');
  }
  try {
    return await response.json();
  } catch {
    throw new Error('VOICEVOX Engineの応答形式を確認できません。');
  }
}

async function listSpeakers(fetchImpl = fetch) {
  const result = await requestJson(`${API_ORIGIN}/speakers`, {
    signal: AbortSignal.timeout(5000),
  }, fetchImpl);
  if (!Array.isArray(result)) throw new Error('VOICEVOX Engineの話者一覧を確認できません。');

  return result.flatMap((speaker) => {
    if (typeof speaker?.name !== 'string' || !Array.isArray(speaker.styles)) return [];
    const styles = speaker.styles.filter((style) =>
      typeof style?.name === 'string' && Number.isSafeInteger(style.id) && style.id >= 0);
    return styles.length > 0 ? [{ name: speaker.name, styles }] : [];
  });
}

function splitSentences(text) {
  const fragments = text.match(/[^。！？!?]+[。！？!?]*|[。！？!?]+/gu) ?? [];
  return fragments.flatMap((fragment) => fragment.split(/\r?\n/u))
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function parsePcmWav(audio) {
  if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('VOICEVOX Engineの音声形式を確認できません。');
  }

  let format;
  let channels;
  let sampleRate;
  let bitsPerSample;
  let pcm;
  let offset = 12;
  while (offset + 8 <= audio.length) {
    const chunkId = audio.toString('ascii', offset, offset + 4);
    const chunkSize = audio.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > audio.length) throw new Error('VOICEVOX Engineの音声形式を確認できません。');
    if (chunkId === 'fmt ' && chunkSize >= 16) {
      format = audio.readUInt16LE(chunkStart);
      channels = audio.readUInt16LE(chunkStart + 2);
      sampleRate = audio.readUInt32LE(chunkStart + 4);
      bitsPerSample = audio.readUInt16LE(chunkStart + 14);
    } else if (chunkId === 'data') {
      pcm = audio.subarray(chunkStart, chunkEnd);
    }
    offset = chunkEnd + (chunkSize & 1);
  }

  const blockAlign = channels * bitsPerSample / 8;
  if (
    format !== 1
    || !Number.isSafeInteger(channels)
    || channels < 1
    || !Number.isSafeInteger(sampleRate)
    || sampleRate < 1
    || !Number.isSafeInteger(bitsPerSample)
    || bitsPerSample < 8
    || !pcm
    || !Number.isSafeInteger(blockAlign)
    || pcm.length === 0
    || pcm.length % blockAlign !== 0
  ) {
    throw new Error('VOICEVOX Engineの音声形式を確認できません。');
  }
  return { channels, sampleRate, bitsPerSample, pcm };
}

function makePcmWav(pcm, { channels, sampleRate, bitsPerSample }) {
  if (pcm.length > 0xffffffff - 36) throw new Error('生成音声のサイズが許容範囲外です。');
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

async function synthesizeSpeech({ text, styleId }, fetchImpl = fetch) {
  const sentences = splitSentences(text);
  if (sentences.length === 0 || sentences.length > MAX_SENTENCES) {
    throw new Error('読み上げ文を100文以内にしてください。');
  }

  const segments = [];
  const subtitles = [];
  const mouthTimeline = [];
  let wavFormat;
  let totalDuration = 0;
  let totalBytes = 44;
  for (const sentence of sentences) {
    const queryUrl = new URL(`${API_ORIGIN}/audio_query`);
    queryUrl.searchParams.set('text', sentence);
    queryUrl.searchParams.set('speaker', String(styleId));
    const audioQuery = await requestJson(queryUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
    }, fetchImpl);

    let response;
    try {
      const synthesisUrl = new URL(`${API_ORIGIN}/synthesis`);
      synthesisUrl.searchParams.set('speaker', String(styleId));
      response = await fetchImpl(synthesisUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(audioQuery),
        signal: AbortSignal.timeout(120000),
      });
    } catch {
      throw new Error('VOICEVOX Engineで音声を合成できません。接続を確認して再試行してください。');
    }
    if (!response.ok) throw new Error('VOICEVOX Engineで音声を合成できません。話者設定を確認してください。');

    const wavBytes = Buffer.from(await response.arrayBuffer());
    const segmentFormat = parsePcmWav(wavBytes);
    if (wavFormat && (
      segmentFormat.channels !== wavFormat.channels
      || segmentFormat.sampleRate !== wavFormat.sampleRate
      || segmentFormat.bitsPerSample !== wavFormat.bitsPerSample
    )) {
      throw new Error('文ごとの音声形式が一致しません。');
    }
    wavFormat ??= segmentFormat;
    totalBytes += segmentFormat.pcm.length;
    if (totalBytes > MAX_WAV_BYTES) throw new Error('生成音声のサイズが許容範囲外です。');

    const durationSeconds = segmentFormat.pcm.length
      / (segmentFormat.sampleRate * segmentFormat.channels * segmentFormat.bitsPerSample / 8);
    const prePhonemeLength = Number(audioQuery.prePhonemeLength ?? 0);
    const postPhonemeLength = Number(audioQuery.postPhonemeLength ?? 0);
    if (
      !Number.isFinite(prePhonemeLength)
      || prePhonemeLength < 0
      || !Number.isFinite(postPhonemeLength)
      || postPhonemeLength < 0
    ) {
      throw new Error('VOICEVOX Engineの字幕タイミングを確認できません。');
    }
    const startSeconds = totalDuration + prePhonemeLength;
    const endSeconds = totalDuration + durationSeconds - postPhonemeLength;
    if (endSeconds <= startSeconds) throw new Error('VOICEVOX Engineの字幕タイミングを確認できません。');
    subtitles.push({
      startSeconds: Math.round(startSeconds * 1000) / 1000,
      endSeconds: Math.round(endSeconds * 1000) / 1000,
      text: sentence,
    });
    let phonemeCursor = totalDuration + prePhonemeLength;
    for (const phrase of Array.isArray(audioQuery.accent_phrases) ? audioQuery.accent_phrases : []) {
      for (const mora of Array.isArray(phrase?.moras) ? phrase.moras : []) {
        const consonantLength = Number(mora?.consonant_length ?? 0);
        const vowelLength = Number(mora?.vowel_length ?? 0);
        if (!Number.isFinite(consonantLength) || consonantLength < 0 || !Number.isFinite(vowelLength) || vowelLength < 0) {
          throw new Error('VOICEVOX Engineの母音タイミングを確認できません。');
        }
        const vowelStart = phonemeCursor + consonantLength;
        const expression = VOWEL_EXPRESSIONS[String(mora?.vowel ?? '').toLowerCase()];
        if (expression && vowelLength > 0) {
          const cueStart = Math.round(vowelStart * 1000) / 1000;
          const cueEnd = Math.round(Math.min(vowelStart + vowelLength, endSeconds) * 1000) / 1000;
          if (cueEnd > cueStart) mouthTimeline.push({ start: cueStart, end: cueEnd, expression });
          if (mouthTimeline.length > MAX_MOUTH_CUES) throw new Error('生成音声の口形タイミングが許容範囲を超えています。');
        }
        phonemeCursor += consonantLength + vowelLength;
      }
      if (phrase?.pause_mora) {
        const pauseConsonantLength = Number(phrase.pause_mora.consonant_length ?? 0);
        const pauseVowelLength = Number(phrase.pause_mora.vowel_length ?? 0);
        if (
          !Number.isFinite(pauseConsonantLength) || pauseConsonantLength < 0
          || !Number.isFinite(pauseVowelLength) || pauseVowelLength < 0
        ) throw new Error('VOICEVOX Engineの母音タイミングを確認できません。');
        phonemeCursor += pauseConsonantLength + pauseVowelLength;
      }
    }
    segments.push(segmentFormat.pcm);
    totalDuration += durationSeconds;
  }

  return { audio: new Uint8Array(makePcmWav(Buffer.concat(segments), wavFormat)), subtitles, mouthTimeline };
}

module.exports = { listSpeakers, synthesizeSpeech };