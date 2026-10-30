const defaultPronunciationRules = require('../src/pronunciation-rules.json');
const fs = require('node:fs');
const path = require('node:path');
const { toKatakana } = require('@allpaqa/multilingual-katakana');

const MAX_PRONUNCIATION_RULES = 100;
const MAX_PRONUNCIATION_TERM_LENGTH = 80;
const MAX_PRONUNCIATION_READING_LENGTH = 100;
const C_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const ASCII_WORD_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/u;
const ASCII_WORD_ALTERNATIVE = '\\b[A-Za-z][A-Za-z0-9_]*\\b';
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/u;
const ENGLISH_WORDS_PATH = path.join(path.dirname(require.resolve('word-list')), 'words.txt');
const ENGLISH_WORDS = new Set(
  fs.readFileSync(ENGLISH_WORDS_PATH, 'utf8')
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((word) => word.toLowerCase()),
);
const ENGLISH_LETTER_READINGS = {
  a: 'エー',
  b: 'ビー',
  c: 'シー',
  d: 'ディー',
  e: 'イー',
  f: 'エフ',
  g: 'ジー',
  h: 'エイチ',
  i: 'アイ',
  j: 'ジェイ',
  k: 'ケー',
  l: 'エル',
  m: 'エム',
  n: 'エヌ',
  o: 'オー',
  p: 'ピー',
  q: 'キュー',
  r: 'アール',
  s: 'エス',
  t: 'ティー',
  u: 'ユー',
  v: 'ブイ',
  w: 'ダブリュー',
  x: 'エックス',
  y: 'ワイ',
  z: 'ゼット',
};
const ENGLISH_PRONUNCIATION_OVERRIDES = {
  computer: 'コンピューター',
  data: 'データ',
  function: 'ファンクション',
  integer: 'インテジャー',
  program: 'プログラム',
  string: 'ストリング',
  value: 'バリュー',
  variable: 'バリアブル',
};
ENGLISH_WORDS.add('a');
ENGLISH_WORDS.add('i');

function normalizePronunciationRules(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('読み替え辞書の形式を確認してください。');
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_PRONUNCIATION_RULES) {
    throw new Error(`読み替え辞書は${MAX_PRONUNCIATION_RULES}件以内にしてください。`);
  }

  const normalized = new Map();
  for (const [rawTerm, rawReading] of entries) {
    const term = rawTerm.trim();
    const reading = typeof rawReading === 'string' ? rawReading.trim() : '';
    if (
      term.length === 0
      || term.length > MAX_PRONUNCIATION_TERM_LENGTH
      || CONTROL_CHARACTER_PATTERN.test(term)
      || reading.length === 0
      || [...reading].length > MAX_PRONUNCIATION_READING_LENGTH
    ) {
      throw new Error('読み替え前は1〜80文字、読みは1〜100文字で入力してください。');
    }
    if (normalized.has(term)) throw new Error(`「${term}」が重複しています。`);
    normalized.set(term, reading);
  }

  return Object.fromEntries([...normalized.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0));
}

function getPronunciationRulesSignature(rules) {
  return JSON.stringify(normalizePronunciationRules(rules));
}

function createPronunciationConverter(rules = defaultPronunciationRules) {
  const normalized = normalizePronunciationRules(rules);
  const terms = Object.keys(normalized).sort((left, right) => right.length - left.length);
  const pattern = new RegExp(
    [
      ...terms.map((term) => {
        const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return C_IDENTIFIER_PATTERN.test(term) ? `\\b${escapedTerm}\\b` : escapedTerm;
      }),
      ASCII_WORD_ALTERNATIVE,
    ].join('|'),
    'gu',
  );
  return (text) => text.replace(pattern, (term) => {
    if (!ASCII_WORD_PATTERN.test(term)) return normalized[term] ?? term;
    const englishWord = term.toLowerCase();
    if (ENGLISH_WORDS.has(englishWord)) {
      return ENGLISH_PRONUNCIATION_OVERRIDES[englishWord] ?? toKatakana(englishWord);
    }
    if (Object.hasOwn(normalized, term)) return normalized[term];
    return term.replace(/[A-Za-z]+/gu, (letters) =>
      [...letters].map((letter) => ENGLISH_LETTER_READINGS[letter.toLowerCase()]).join('・'));
  });
}

function convertPronunciationText(text, rules = defaultPronunciationRules) {
  return createPronunciationConverter(rules)(text);
}

module.exports = {
  createPronunciationConverter,
  convertPronunciationText,
  defaultPronunciationRules: normalizePronunciationRules(defaultPronunciationRules),
  getPronunciationRulesSignature,
  normalizePronunciationRules,
};
