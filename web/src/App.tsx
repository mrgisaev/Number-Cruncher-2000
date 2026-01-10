import { type ChangeEvent, useId, useMemo, useState } from 'react';
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
  prefix: string;
  suffix: string;
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

const sanitizeInputText = (text: string) => {
  const lines = text.split(/\r?\n/);
  let lastIndex = lines.length - 1;
  while (lastIndex >= 0 && lines[lastIndex].trim() === '') {
    lastIndex -= 1;
  }
  return lines.slice(0, lastIndex + 1).join('\n');
};

const parseColumn = (text: string): ParsedRow[] => {
  const sanitized = sanitizeInputText(text);
  if (!sanitized) {
    return [];
  }

  return sanitized.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return {
        raw: '',
        value: null,
        decimalSeparator: null,
        groupSeparator: null,
        prefix: '',
        suffix: '',
      };
    }

    const numericMatch = trimmed.match(/[+-]?\d[\d\s.,]*/);
    if (!numericMatch) {
      return {
        raw: trimmed,
        value: null,
        decimalSeparator: null,
        groupSeparator: null,
        prefix: '',
        suffix: '',
      };
    }

    const matchStart = numericMatch.index ?? 0;
    const matchValue = numericMatch[0];
    const prefix = trimmed.slice(0, matchStart);
    const suffix = trimmed.slice(matchStart + matchValue.length);

    const sign = matchValue.trim().startsWith('-')
      ? '-'
      : matchValue.trim().startsWith('+')
        ? '+'
        : '';
    const unsignedNumeric = sign
      ? matchValue.trim().slice(1)
      : matchValue.trim();

    const decimalSeparator = detectDecimalSeparator(unsignedNumeric);

    let integerPartRaw = unsignedNumeric;
    let fractionalPartRaw = '';
    if (decimalSeparator) {
      const idx = unsignedNumeric.lastIndexOf(decimalSeparator);
      integerPartRaw = unsignedNumeric.slice(0, idx);
      fractionalPartRaw = unsignedNumeric.slice(idx + 1);
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
      raw: trimmed,
      value: Number.isFinite(numeric) ? numeric : null,
      decimalSeparator,
      groupSeparator,
      prefix,
      suffix,
    };
  });
};

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
  const digits = Math.max(0, decimals);
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
  const [fractionDigits, setFractionDigits] = useState(2);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const footerYear = new Date().getFullYear();
  const additionInputId = useId();
  const digitsInputId = useId();

  const parsedRows = useMemo(() => parseColumn(rawInput), [rawInput]);
  const numericValues = useMemo(
    () => parsedRows.filter((row) => row.value !== null).map((row) => row.value as number),
    [parsedRows],
  );
  const baseSum = useMemo(() => sumValues(numericValues), [numericValues]);

  const decimals = Math.min(Math.max(fractionDigits, 0), 6);
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
        return row.raw || '';
      }
      const next = adjustedValues[pointer];
      pointer += 1;
      if (typeof next !== 'number') {
        return row.raw || '';
      }
      const formatted = formatRowValue(next, decimals);
      return `${row.prefix || ''}${formatted}${row.suffix || ''}`;
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

  const handleInputChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const { value } = event.target;
    const inputType = (event.nativeEvent as InputEvent | undefined)?.inputType;
    if (inputType === 'insertFromPaste') {
      setRawInput(sanitizeInputText(value));
      return;
    }
    setRawInput(value);
  };
  const changeFractionDigits = (delta: number) => {
    setFractionDigits((prev) => Math.max(0, Math.min(6, prev + delta)));
  };

  const desiredLabel = isTargetMode ? 'Working value' : 'Target sum';
  const desiredInputValue = isTargetMode ? additionValue : targetSum;
  const onDesiredChange = (next: number) => {
    if (isTargetMode) {
      setAdditionValue(next);
    } else {
      setTargetSum(next);
    }
  };
  const handleModeToggle = (nextMode: boolean) => {
    const currentValue = Number.isFinite(desiredInputValue) ? desiredInputValue : 0;
    if (nextMode) {
      setAdditionValue(currentValue);
    } else {
      setTargetSum(currentValue);
    }
    setIsTargetMode(nextMode);
  };

  return (
    <div className="page">
      <div className="page-body">
        <aside className="card menu-card layout-menu">
          <header className="card-header">
            <div className="card-header-top">
              <h2>Tools</h2>
            </div>
            <p>Quick links to the other calculators from the suite.</p>
          </header>
          <nav>
            <ul className="tool-links">
              <li>
                <a href="https://number-cruncher.org" target="_blank" rel="noreferrer">
                  Number Cruncher 2026
                </a>
                <span>Current tool</span>
              </li>
            </ul>
          </nav>
        </aside>
        <div className="page-content">
          <section className="controls-wrapper">
            <div className="controls">
              <div className="controls-heading">
                <h1 className="controls-heading-title">Number Cruncher 2026</h1>
                <p className="controls-subtitle">
                  One column for your data, the other for a polished result. Pick the distribution mode and settings before copying the result.
                </p>
              </div>
              <div className="split-control">
                <div className="stacked-field-column">
                  <div className="stacked-field">
                    <div className="number-field number-field-mode">
                      <label className="number-field-label" htmlFor={additionInputId}>
                        {desiredLabel}
                      </label>
                      <div className="number-field-input-wrapper input-with-toggle addition-toggle">
                        <div className="mode-toggle mode-toggle-inline" role="group" aria-label="Sum mode toggle">
                          <button
                            type="button"
                            className={`mode-toggle-button${isTargetMode ? ' active' : ''}`}
                            aria-pressed={isTargetMode}
                            onClick={() => handleModeToggle(true)}
                            title="Distribute to a working value"
                          >
                            +
                          </button>
                          <button
                            type="button"
                            className={`mode-toggle-button${!isTargetMode ? ' active' : ''}`}
                            aria-pressed={!isTargetMode}
                            onClick={() => handleModeToggle(false)}
                            title="Aim for a target sum"
                          >
                            =
                          </button>
                        </div>
                        <input
                          id={additionInputId}
                          type="number"
                          value={Number.isFinite(desiredInputValue) ? desiredInputValue : ''}
                          onChange={(event) => onDesiredChange(Number(event.target.value) || 0)}
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="stacked-field-column">
                  <div className="stacked-field">
                    <div className="number-field number-field-mode">
                      <label className="number-field-label" htmlFor={digitsInputId}>
                        Decimal places
                      </label>
                      <div className="number-field-input-wrapper input-with-toggle digits-toggle">
                        <div className="mode-toggle mode-toggle-inline" role="group" aria-label="Decimal control">
                          <button
                            type="button"
                            className="mode-toggle-button"
                            onClick={() => changeFractionDigits(-1)}
                            disabled={fractionDigits <= 0}
                            title="Decrease decimal places"
                          >
                            -0.0
                          </button>
                          <button
                            type="button"
                            className="mode-toggle-button"
                            onClick={() => changeFractionDigits(1)}
                            disabled={fractionDigits >= 6}
                            title="Increase decimal places"
                          >
                            +0.00
                          </button>
                        </div>
                        <input
                          id={digitsInputId}
                          type="number"
                          min={0}
                          max={6}
                          value={fractionDigits}
                          onChange={(event) =>
                            setFractionDigits(Math.min(6, Math.max(0, Number(event.target.value) || 0)))
                          }
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </section>
          <main className="grid">
            <section className="card">
              <header className="card-header">
                <div className="card-header-top">
                  <h2>Input data</h2>
                  <button
                    type="button"
                    onClick={() => setRawInput('')}
                    disabled={rawInput.trim().length === 0}
                  >
                    Clear field
                  </button>
                </div>
                <p>Copy values in Excel and paste them here with Ctrl+V.</p>
              </header>
              <div className="result-summary summary-inline">
                <span>Sum of input values</span>
                <strong>{numberFormatter.format(baseSum)}</strong>
              </div>
              <textarea
                className="paste-area"
                value={rawInput}
                placeholder="Paste numbers..."
                onChange={handleInputChange}
                spellCheck={false}
              />
            </section>

            <section className="card results-card">
              <header className="card-header">
                <div className="card-header-top">
                  <h2>Result</h2>
                  <button type="button" onClick={handleCopy} disabled={!numericValues.length}>
                    {copyState === 'copied' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <p>All numbers are proportionally adjusted to the new sum.</p>
              </header>

              <div className="result-summary">
                <span>Sum of result column</span>
                <strong>{numberFormatter.format(adjustedSum)}</strong>
              </div>

              <div className="result-list">
                {numericValues.length === 0 ? (
                  <p className="muted">Add at least one number on the left.</p>
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
      </div>
      <footer className="site-footer">
        <p>
          Made by{' '}
          <a href="https://www.linkedin.com/in/mrgisaev/" target="_blank" rel="noreferrer">
            Grigorii Isaev
          </a>
          . &copy; {footerYear} Number Cruncher 2026.
        </p>
      </footer>
    </div>
  );
}

export default App;
