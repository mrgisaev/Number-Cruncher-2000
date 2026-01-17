type ParsedRow = {
  raw: string;
  value: number | null;
};

const detectDecimalSeparator = (input: string): '.' | ',' | null => {
  const lastComma = input.lastIndexOf(',');
  const lastDot = input.lastIndexOf('.');

  if (lastComma === -1 && lastDot === -1) {
    return null;
  }

  if (lastComma !== -1 && lastDot !== -1) {
    return lastComma > lastDot ? ',' : '.';
  }

  const sepIndex = lastComma !== -1 ? lastComma : lastDot;
  const sepChar = lastComma !== -1 ? ',' : '.';
  const occurrences = (input.match(new RegExp(`\\${sepChar}`, 'g')) || []).length;
  if (occurrences > 1) {
    return null;
  }
  const fractionalLength = input.length - sepIndex - 1;
  if (fractionalLength === 0) {
    return null;
  }
  if (sepChar === ',' && occurrences === 1 && fractionalLength === 3) {
    return null;
  }
  return sepChar;
};

export const parseColumn = (text: string): ParsedRow[] => {
  if (!text) {
    return [];
  }

  return text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return { raw: '', value: null };
    }

    const numericMatch = trimmed.match(/[+-]?\d[\d\s.,]*/);
    if (!numericMatch) {
      return { raw: trimmed, value: null };
    }

    const matchValue = numericMatch[0];
    const sign = matchValue.trim().startsWith('-')
      ? '-'
      : matchValue.trim().startsWith('+')
        ? '+'
        : '';
    const unsignedNumeric = sign ? matchValue.trim().slice(1) : matchValue.trim();

    const decimalSeparator = detectDecimalSeparator(unsignedNumeric);

    let integerPartRaw = unsignedNumeric;
    let fractionalPartRaw = '';
    if (decimalSeparator) {
      const idx = unsignedNumeric.lastIndexOf(decimalSeparator);
      integerPartRaw = unsignedNumeric.slice(0, idx);
      fractionalPartRaw = unsignedNumeric.slice(idx + 1);
    }

    const integerClean = integerPartRaw.replace(/[^0-9]/g, '');
    const fractionClean = fractionalPartRaw.replace(/[^0-9]/g, '');
    let normalized = `${sign}${integerClean}`;
    if (decimalSeparator && fractionClean.length) {
      normalized += `.${fractionClean}`;
    }

    const numeric = Number.parseFloat(normalized);
    return { raw: trimmed, value: Number.isFinite(numeric) ? numeric : null };
  });
};

export const addGrouping = (digits: string) => {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};
