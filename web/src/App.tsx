import { useMemo, useState } from 'react';
import './App.css';

const sampleColumn = `78055
46465
34887
22789
22397
11626
11088`;

const numberFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

interface ParsedRow {
  raw: string;
  value: number | null;
  decimalSeparator: '.' | ',' | null;
  groupSeparator: string | null;
}

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
  const fractionalLength = input.length - sepIndex - 1;
  if (fractionalLength === 0) {
    return null;
  }
  const occurrences = (input.match(new RegExp(`\\${sepChar}`, 'g')) || []).length;
  if (occurrences === 1 && fractionalLength === 3) {
    return null;
  }
  return sepChar;
};

const parseColumn = (text: string): ParsedRow[] =>
  text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return { raw: line, value: null, decimalSeparator: null, groupSeparator: null };
    }

    const signMatch = trimmed.match(/^[-+]/);
    const sign = signMatch ? signMatch[0] : '';
    const unsigned = sign ? trimmed.slice(1) : trimmed;
    const decimalSeparator = detectDecimalSeparator(unsigned);

    let integerPartRaw = unsigned;
    let fractionalPartRaw = '';
    if (decimalSeparator) {
      const idx = unsigned.lastIndexOf(decimalSeparator);
      integerPartRaw = unsigned.slice(0, idx);
      fractionalPartRaw = unsigned.slice(idx + 1);
    }

    const groupMatches = integerPartRaw.match(/[^0-9]/g);
    const groupSeparator = groupMatches ? groupMatches[groupMatches.length - 1] : null;

    const integerClean = integerPartRaw.replace(/[^0-9]/g, '');
    const fractionClean = fractionalPartRaw.replace(/[^0-9]/g, '');
    let normalized = `${sign}${integerClean}`;
    if (decimalSeparator && fractionClean.length) {
      normalized += `.${fractionClean}`;
    }

    const numeric = Number.parseFloat(normalized);
    return {
      raw: line,
      value: Number.isFinite(numeric) ? numeric : null,
      decimalSeparator,
      groupSeparator,
    };
  });

const sumValues = (values: number[]) => values.reduce((acc, value) => acc + value, 0);

const buildScaledValues = (values: number[], desiredSum: number) => {
  if (values.length === 0) {
    return [];
  }

  const baseSum = sumValues(values);
  if (baseSum === 0) {
    const equal = desiredSum / values.length;
    return values.map(() => equal);
  }

  const factor = desiredSum / baseSum;
  return values.map((value) => value * factor);
};

const enforceRounding = (values: number[], desiredSum: number, decimals: number) => {
  if (!values.length) {
    return [];
  }

  const unit = 10 ** decimals;
  const desiredUnits = Math.round(desiredSum * unit);
  const roundedUnits = values.map((value) => Math.round(value * unit));
  const currentUnits = roundedUnits.reduce((acc, value) => acc + value, 0);
  const diffUnits = desiredUnits - currentUnits;

  if (diffUnits !== 0) {
    roundedUnits[roundedUnits.length - 1] += diffUnits;
  }

  return roundedUnits.map((value) => value / unit);
};

const formatRowValue = (value: number, decimals: number) => {
  const digits = Math.max(decimals, 2);
  const sign = value < 0 ? '-' : '';
  const fixed = Math.abs(value).toFixed(digits);
  const [integerPartRaw, fractionPart] = fixed.split('.');
  const integerPart = addGrouping(integerPartRaw);
  const fraction = fractionPart ? `.${fractionPart}` : '';
  return `${sign}${integerPart}${fraction}`;
};

const addGrouping = (digits: string) => {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

function App() {
  const [rawInput, setRawInput] = useState(sampleColumn);
  const [isTargetMode, setIsTargetMode] = useState(true);
  const [targetSum, setTargetSum] = useState(463915);
  const [additionValue, setAdditionValue] = useState(10000);
  const [useFractions, setUseFractions] = useState(true);
  const [fractionDigits, setFractionDigits] = useState(2);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  const parsedRows = useMemo(() => parseColumn(rawInput), [rawInput]);
  const numericValues = useMemo(
    () => parsedRows.filter((row) => row.value !== null).map((row) => row.value as number),
    [parsedRows],
  );
  const baseSum = useMemo(() => sumValues(numericValues), [numericValues]);

  const decimals = useFractions ? Math.min(Math.max(fractionDigits, 0), 6) : 0;
  const desiredSumRaw = isTargetMode ? baseSum + additionValue : targetSum;
  const desiredSum = decimals === 0 ? Math.round(desiredSumRaw) : desiredSumRaw;

  const scaledValues = useMemo(
    () => buildScaledValues(numericValues, desiredSum),
    [numericValues, desiredSum],
  );
  const adjustedValues = useMemo(
    () => enforceRounding(scaledValues, desiredSum, decimals),
    [scaledValues, desiredSum, decimals],
  );
  const adjustedSum = useMemo(() => sumValues(adjustedValues), [adjustedValues]);
  const formattedValues = (() => {
    let pointer = 0;
    return parsedRows.map((row) => {
      if (row.value === null) {
        return '';
      }
      const next = adjustedValues[pointer];
      pointer += 1;
      return typeof next === 'number' ? formatRowValue(next, decimals) : '';
    });
  })();
  const resultText = formattedValues.join('\n');

  const handleCopy = async () => {
    if (!numericValues.length) {
      return;
    }
    try {
      await navigator.clipboard.writeText(resultText);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      setCopyState('idle');
    }
  };

  const desiredLabel = isTargetMode ? 'Добавка' : 'Конечная сумма';
  const desiredInputValue = isTargetMode ? additionValue : targetSum;
  const onDesiredChange = (next: number) => {
    if (isTargetMode) {
      setAdditionValue(next);
    } else {
      setTargetSum(next);
    }
  };

  return (
    <div className="page">
      <header className="hero">
        <div>
          <h1>Подбиватель цифр 2000</h1>
          <p className="hero-tagline">Одна колонка для вставки, одна — для красивого результата.</p>
          <p className="hero-copy">
            Вставь числа из Excel, скажи, что нужно получить на выходе, и забери готовый столбец c
            подправленными значениями. Никаких формул и лишних кликов.
          </p>
        </div>
      </header>

      <section className="controls-wrapper">
        <div className="controls">
          <div className="controls-heading">
            <h2 className="controls-heading-title">Окно настройки</h2>
            <p>Задайте режим и параметры распределения перед тем, как копировать результат.</p>
          </div>
          <div className="split-control">
            <div className="stacked-field-column">
              <div className="stacked-field">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={isTargetMode}
                    onChange={(event) => setIsTargetMode(event.target.checked)}
                  />
                  Прибавлять?
                </label>
                <label className="number-field">
                  <span>{desiredLabel}</span>
                  <input
                    type="number"
                    value={Number.isFinite(desiredInputValue) ? desiredInputValue : ''}
                    onChange={(event) => onDesiredChange(Number(event.target.value) || 0)}
                  />
                </label>
              </div>
            </div>
            <div className="stacked-field-column">
              <div className="stacked-field">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={useFractions}
                    onChange={(event) => setUseFractions(event.target.checked)}
                  />
                  Выводить дробные значения
                </label>
                <label className="number-field">
                  <span>Знаков после запятой</span>
                  <input
                    type="number"
                    min={0}
                    max={6}
                    value={fractionDigits}
                    disabled={!useFractions}
                    onChange={(event) => setFractionDigits(Math.max(0, Number(event.target.value) || 0))}
                  />
                </label>
              </div>
            </div>
          </div>

        </div>
      </section>

      <main className="grid">
        <section className="card">
          <header className="card-header">
            <div>
              <h2>Вставь столбец</h2>
              <p>Скопируй значения в Excel и вставь сюда через Ctrl+V — мы всё распознаем.</p>
            </div>
          </header>
          <div className="result-summary summary-inline">
            <span>Сумма исходных значений</span>
            <strong>{numberFormatter.format(baseSum)}</strong>
          </div>
          <textarea
            className="paste-area"
            value={rawInput}
            placeholder="Вставьте числа..."
            onChange={(event) => setRawInput(event.target.value)}
            spellCheck={false}
          />
          <footer className="card-footer">
            <span>
              Строк: {parsedRows.length} / чисел: {numericValues.length}
            </span>
            {numericValues.length > 0 && (
              <span>
                Сумма: <strong>{numberFormatter.format(baseSum)}</strong>
              </span>
            )}
          </footer>
        </section>

        <section className="card results-card">
          <header className="card-header">
            <div>
              <h2>Результат</h2>
              <p>Все числа пропорционально подогнаны под новую сумму.</p>
            </div>
            <button type="button" onClick={handleCopy} disabled={!numericValues.length}>
              {copyState === 'copied' ? 'Скопировано!' : 'Скопировать столбец'}
            </button>
          </header>

          <div className="result-summary">
            <span>Сумма итогового столбца</span>
            <strong>{numberFormatter.format(adjustedSum)}</strong>
          </div>

          <div className="result-list">
            {numericValues.length === 0 ? (
              <p className="muted">Добавьте хотя бы одно число слева.</p>
            ) : (
              formattedValues.map((value, index) => (
                <div key={`${value}-${index}`} className="result-item">
                  <span className="result-index">{index + 1}</span>
                  <span className={`result-value${value === '' ? ' result-empty' : ''}`}>
                    {value === '' ? '—' : value}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
