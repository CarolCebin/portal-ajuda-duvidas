export const EVALUATION_TEXT_LIMIT = 2000;
export const EVALUATION_REASON_LIMIT = 300;

function normalizedWord(text) {
  return text.normalize('NFD').replace(/\p{M}|\p{P}/gu, '').trim().toLowerCase();
}

export function suggestedMark(expected, decision) {
  const word = normalizedWord(expected);
  if (!decision || !/^[\p{L}\p{N}]+$/u.test(word)) return null;
  return word === normalizedWord(decision);
}
