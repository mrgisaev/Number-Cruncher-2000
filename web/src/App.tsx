import { type ChangeEvent, type CSSProperties, useEffect, useId, useMemo, useRef, useState } from 'react';
import { CreativeRenamer } from './CreativeRenamer';
import { CreativeResizer } from './CreativeResizer';
import { ShareSplitter } from './ShareSplitter';
import { UtmGenerator } from './UtmGenerator';
import './App.css';

const sampleColumn = '';
const GA_ID = 'G-4FPWFTG76J';

const loadAnalytics = () => {
  if (typeof window === 'undefined') return;
  const anyWindow = window as any;
  if (anyWindow.__ncGaLoaded) return;

  const existing = document.querySelector(`script[src*="googletagmanager.com/gtag/js?id=${GA_ID}"]`);
  if (!existing) {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
    document.head.appendChild(script);
  }

  anyWindow.dataLayer = anyWindow.dataLayer || [];
  function gtag(...args: unknown[]) {
    anyWindow.dataLayer.push(args);
  }
  gtag('js', new Date());
  gtag('config', GA_ID, { anonymize_ip: true });
  anyWindow.__ncGaLoaded = true;
};

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

const particlePalette = [
  { color: 'rgba(140, 199, 218, 0.85)', blur: 2, glow: 90 },
  { color: 'rgba(164, 191, 216, 0.88)', blur: 1, glow: 90 },
  { color: 'rgba(218, 235, 255, 0.97)', blur: 1, glow: 90 },
  { color: 'rgba(142, 216, 250, 0.53)', blur: 0.5, glow: 90 },
];

const baseDustParticles = [
  { x: 6, y: 8, size: 50, duration: 42, delay: 0, dx: 8, dy: 12 },
  { x: 24, y: 12, size: 40, duration: 48, delay: 6, dx: -10, dy: 15 },
  { x: 42, y: 6, size: 60, duration: 52, delay: 2, dx: 12, dy: -10 },
  { x: 63, y: 14, size: 35, duration: 46, delay: 10, dx: -8, dy: 11 },
  { x: 78, y: 9, size: 58, duration: 50, delay: 4, dx: 10, dy: -12 },
  { x: 85, y: 32, size: 42, duration: 44, delay: 8, dx: -9, dy: 14 },
  { x: 12, y: 36, size: 54, duration: 55, delay: 3, dx: 11, dy: -9 },
  { x: 34, y: 42, size: 46, duration: 47, delay: 12, dx: -7, dy: 10 },
  { x: 58, y: 38, size: 52, duration: 53, delay: 5, dx: 9, dy: -11 },
  { x: 72, y: 44, size: 38, duration: 49, delay: 14, dx: -11, dy: 13 },
  { x: 28, y: 58, size: 48, duration: 51, delay: 9, dx: 13, dy: -8 },
  { x: 54, y: 62, size: 44, duration: 45, delay: 7, dx: -6, dy: 9 },
  { x: 77, y: 70, size: 56, duration: 58, delay: 11, dx: 10, dy: -13 },
  { x: 15, y: 72, size: 66, duration: 43, delay: 13, dx: -12, dy: 10 },
  { x: 46, y: 78, size: 58, duration: 57, delay: 1, dx: 12, dy: -12 },
  { x: 46, y: 78, size: 58, duration: 57, delay: 1, dx: 12, dy: -12 },
  { x: 46, y: 78, size: 58, duration: 57, delay: 1, dx: 12, dy: -12 },
].map((particle, index) => {
  const palette = particlePalette[index % particlePalette.length];
  return { ...particle, color: palette.color, blur: palette.blur, glow: palette.glow };
});

const dustParticles = baseDustParticles.flatMap((particle, index) => {
  const paletteA = particlePalette[(index + 1) % particlePalette.length];
  const paletteB = particlePalette[(index + 2) % particlePalette.length];
  const paletteC = particlePalette[(index + 3) % particlePalette.length];

  const mirrored = {
    ...particle,
    x: (particle.x + 10 + index * 4) % 100,
    y: (particle.y + 15 + index * 3) % 90,
    delay: particle.delay + 6,
    dx: -particle.dx * 0.8,
    dy: particle.dy * 0.85,
    color: paletteA.color,
    blur: paletteA.blur,
    glow: paletteA.glow,
  };

  const drifted = {
    ...particle,
    x: (particle.x + 32 + index * 5) % 100,
    y: (particle.y + 28 + index * 4) % 90,
    delay: particle.delay + 10,
    duration: particle.duration + 8,
    dx: particle.dx * 0.65,
    dy: -particle.dy * 0.7,
    color: paletteB.color,
    blur: paletteB.blur * 1.1,
    glow: paletteB.glow + 6,
  };

  const swirl = {
    ...particle,
    x: (particle.x + 52 + index * 3) % 100,
    y: (particle.y + 48 + index * 5) % 90,
    delay: particle.delay + 16,
    duration: particle.duration + 12,
    dx: -particle.dx * 0.6,
    dy: -particle.dy * 0.65,
    color: paletteC.color,
    blur: paletteC.blur * 0.9,
    glow: paletteC.glow + 8,
  };

  return [particle, mirrored, drifted, swirl];
});

const parsePercentInput = (input: string) => {
  const trimmed = input.trim();
  if (!trimmed) {
    return { value: null, isPercent: false };
  }
  const isPercent = trimmed.includes('%');
  const cleaned = trimmed.replace(/[%\s]/g, '');
  const parsed = parseColumn(cleaned)[0];
  if (!parsed || parsed.value === null) {
    return { value: null, isPercent: false };
  }
  return { value: parsed.value, isPercent };
};

function App() {
  const [rawInput, setRawInput] = useState(sampleColumn);
  const [sumMode, setSumMode] = useState<'add' | 'target' | 'multiply'>('add');
  const [targetInput, setTargetInput] = useState('');
  const [additionInput, setAdditionInput] = useState('');
  const [multiplierInput, setMultiplierInput] = useState('');
  const [fractionDigitsInput, setFractionDigitsInput] = useState('');
  const [randomPercentInput, setRandomPercentInput] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [showScrollCue, setShowScrollCue] = useState(false);
  const [menuOverflow, setMenuOverflow] = useState(false);
  const [menuFadeLeft, setMenuFadeLeft] = useState(false);
  const [menuFadeRight, setMenuFadeRight] = useState(false);
  const pasteAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const menuScrollRef = useRef<HTMLUListElement | null>(null);
  const [showConsent, setShowConsent] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('nc-analytics-consent') !== 'granted';
  });
  const footerYear = new Date().getFullYear();
  const isWhatsNew = typeof window !== 'undefined' && window.location.pathname.includes('whats-new');
  const isShareSplitter = typeof window !== 'undefined' && window.location.pathname.includes('share-splitter');
  const isCreativeRenamer =
    typeof window !== 'undefined' && window.location.pathname.includes('creative-renamer');
  const isCreativeResizer =
    typeof window !== 'undefined' && window.location.pathname.includes('creative-resizer');
  const isUtmGenerator = typeof window !== 'undefined' && window.location.pathname.includes('utm-generator');
  const latestReleaseDate = 'Feb 17, 2026';
  const feb15ReleaseDate = 'Feb 15, 2026';
  const jan18ReleaseDate = 'Jan 18, 2026';
  const shareSplitterReleaseDate = 'Jan 17, 2026';
  const releaseDate = 'Jan 14, 2026';
  const firstReleaseDate = 'Jan 12, 2026';
  const additionInputId = useId();
  const digitsInputId = useId();
  const randomInputId = useId();

  const parsedRows = useMemo(() => parseColumn(rawInput), [rawInput]);
  const numericValues = useMemo(
    () => parsedRows.filter((row) => row.value !== null).map((row) => row.value as number),
    [parsedRows],
  );
  const baseSum = useMemo(() => sumValues(numericValues), [numericValues]);

  const parsedFractionDigits = Number.parseInt(fractionDigitsInput, 10);
  const fractionDigitsValue = Number.isFinite(parsedFractionDigits)
    ? Math.min(Math.max(parsedFractionDigits, 0), 6)
    : 0;
  const parsedRandomPercent = Number.parseFloat(randomPercentInput.replace(',', '.'));
  const randomPercentValue = Number.isFinite(parsedRandomPercent)
    ? Math.min(Math.max(parsedRandomPercent, 0), 100)
    : 0;

  const decimals = fractionDigitsValue;
  const additionValue = (() => {
    const parsed = parsePercentInput(additionInput);
    if (parsed.value === null) {
      return 0;
    }
    return parsed.isPercent ? baseSum * (parsed.value / 100) : parsed.value;
  })();

  const targetSum = (() => {
    const parsed = parsePercentInput(targetInput);
    if (parsed.value === null) {
      return 0;
    }
    return parsed.isPercent ? baseSum * (parsed.value / 100) : parsed.value;
  })();

  const multiplier = (() => {
    const parsed = parsePercentInput(multiplierInput);
    if (parsed.value === null) {
      return 1;
    }
    return parsed.isPercent ? parsed.value / 100 : parsed.value;
  })();

  const desiredSumRaw =
    sumMode === 'add'
      ? baseSum + additionValue
      : sumMode === 'target'
        ? targetSum
        : baseSum * multiplier;
  const desiredSum = decimals === 0 ? Math.round(desiredSumRaw) : desiredSumRaw;

  const scaledValues = useMemo(
    () => buildScaledValues(numericValues, desiredSum),
    [numericValues, desiredSum],
  );

  const randomizedValues = useMemo(() => {
    if (!scaledValues.length || randomPercentValue <= 0) {
      return scaledValues;
    }
    const factor = randomPercentValue / 100;
    const jittered = scaledValues.map((value) => {
      const offset = (Math.random() * 2 - 1) * factor;
      return value * (1 + offset);
    });
    const jitterSum = sumValues(jittered);
    if (jitterSum === 0) {
      return scaledValues;
    }
    return jittered.map((value) => value * (desiredSum / jitterSum));
  }, [scaledValues, randomPercentValue, desiredSum]);

  const adjustedValues = useMemo(
    () => enforceRounding(randomizedValues, desiredSum, decimals),
    [randomizedValues, desiredSum, decimals],
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
    setFractionDigitsInput((prev) => {
      const parsed = Number.parseInt(prev, 10);
      const current = Number.isFinite(parsed) ? parsed : 0;
      const next = Math.max(0, Math.min(6, current + delta));
      return String(next);
    });
  };

  const desiredLabel =
    sumMode === 'add' ? 'Working value' : sumMode === 'target' ? 'Target sum' : 'Multiplier';
  const desiredInputValue =
    sumMode === 'add' ? additionInput : sumMode === 'target' ? targetInput : multiplierInput;
  const onDesiredChange = (next: string) => {
    if (sumMode === 'add') {
      setAdditionInput(next);
    } else if (sumMode === 'target') {
      setTargetInput(next);
    } else {
      setMultiplierInput(next);
    }
  };
  const handleModeToggle = (nextMode: 'add' | 'target' | 'multiply') => {
    const currentValue = desiredInputValue;
    if (nextMode === 'add') {
      setAdditionInput(currentValue);
    } else if (nextMode === 'target') {
      setTargetInput(currentValue);
    } else {
      setMultiplierInput(currentValue);
    }
    setSumMode(nextMode);
  };

  const changeRandomPercent = (delta: number) => {
    setRandomPercentInput((prev) => {
      const parsed = Number.parseFloat(prev.replace(',', '.'));
      const current = Number.isFinite(parsed) ? parsed : 0;
      const next = Math.max(0, Math.min(100, current + delta));
      return String(Math.round(next));
    });
  };

  const handleScrollTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleConsent = (choice: 'granted' | 'denied') => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('nc-analytics-consent', choice);
    setShowConsent(false);
    if (choice === 'granted') {
      loadAnalytics();
    }
  };

  const handlePasteStayTop = () => {
    if (typeof window === 'undefined') return;
    const scrollTop = () => {
      pasteAreaRef.current?.scrollTo({ top: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      window.scrollTo({ top: 0, behavior: 'auto' });
    };
    // do it on next frame to avoid Safari rubber-band artefacts
    requestAnimationFrame(scrollTop);
    setTimeout(scrollTop, 0);
  };

  useEffect(() => {
    const updateScrollCue = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight > window.innerHeight + 4;
      setShowScrollCue(scrollable);
    };
    updateScrollCue();
    window.addEventListener('resize', updateScrollCue);
    window.addEventListener('scroll', updateScrollCue, { passive: true });
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => updateScrollCue());
      if (document.body) {
        resizeObserver.observe(document.body);
      }
      resizeObserver.observe(document.documentElement);
    }
    return () => {
      window.removeEventListener('resize', updateScrollCue);
      window.removeEventListener('scroll', updateScrollCue);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, []);

  useEffect(() => {
    const updateMenuOverflow = () => {
      const el = menuScrollRef.current;
      if (!el) return;
      const hasOverflow = el.scrollWidth > el.clientWidth + 2;
      setMenuOverflow(hasOverflow);
      const leftVisible = el.scrollLeft > 2;
      const rightVisible = el.scrollLeft < el.scrollWidth - el.clientWidth - 2;
      setMenuFadeLeft(hasOverflow && leftVisible);
      setMenuFadeRight(hasOverflow && rightVisible);
    };
    updateMenuOverflow();
    window.addEventListener('resize', updateMenuOverflow);
    const el = menuScrollRef.current;
    if (el) {
      el.addEventListener('scroll', updateMenuOverflow, { passive: true });
    }
    return () => {
      window.removeEventListener('resize', updateMenuOverflow);
      if (el) {
        el.removeEventListener('scroll', updateMenuOverflow);
      }
    };
  }, []);

  useEffect(() => {
    const consent = typeof window !== 'undefined' ? localStorage.getItem('nc-analytics-consent') : null;
    if (consent === 'granted') {
      loadAnalytics();
      setShowConsent(false);
    }
  }, []);

  return (
    <>
      <div className="dust-overlay" aria-hidden="true">
        {dustParticles.map((particle, index) => (
          <span
            key={`dust-${index}`}
            className="dust-particle"
            style={
              {
                '--start-x': `${particle.x}%`,
                '--start-y': `${particle.y}%`,
                '--size': `${particle.size * 0.3}px`,
                '--duration': `${particle.duration}s`,
                '--delay': `${particle.delay}s`,
                '--dx': `${particle.dx}vw`,
                '--dy': `${particle.dy}vh`,
                '--return-x': `${-particle.dx}vw`,
                '--return-y': `${-particle.dy}vh`,
                '--particle-color': particle.color,
                '--particle-blur': `${particle.blur}px`,
                '--particle-glow': `${particle.glow}px`,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="app-shell">
      <aside className="card menu-card floating-menu">
        <nav
          className={`menu-nav${menuOverflow ? ' is-scrollable' : ''}${menuFadeLeft ? ' has-left-fade' : ''}${menuFadeRight ? ' has-right-fade' : ''}`}
        >
          <ul
            className={`tool-links${menuOverflow ? ' is-scrollable' : ''}`}
            ref={menuScrollRef}
          >
            <li>
              <a className="tool-link-button" href="https://number-cruncher.org">
                Number Cruncher
              </a>
            </li>
            <li>
              <a className="tool-link-button" href="/share-splitter.html">
                Share Splitter
              </a>
            </li>
            <li>
              <a className="tool-link-button" href="/creative-renamer.html">
                Asset Renamer
              </a>
            </li>
            <li>
              <a className="tool-link-button" href="/creative-resizer.html">
                Creative Resizer
              </a>
            </li>
            <li>
              <a className="tool-link-button" href="/utm-generator.html">
                UTM Generator
              </a>
            </li>
            <li>
              <a className="tool-link-button" href="/whats-new.html">
                What's new
              </a>
            </li>
          </ul>
        </nav>
      </aside>
      <div className="page">
        {isWhatsNew ? (
          <>
            <section className="controls-wrapper">
              <div className="controls-heading">
                <h1 className="controls-heading-title">What&apos;s new</h1>
                <p className="controls-subtitle">
                  A quick log of updates and fixes for Number Cruncher 2026.
                </p>
              </div>
            </section>
            <main className="grid single-grid">
              <section className="card">
                <header className="card-header release-header">
                  <div className="card-header-top">
                    <h2>Release notes</h2>
                  </div>
                </header>
                <div className="release-entry">
                  <p className="release-date">{latestReleaseDate}</p>
                  <ul className="whats-new-list">
                    <li>Released Asset Renamer updates: broader file support, including documents and mixed asset batches.</li>
                    <li>Added better keyboard navigation in editable rows and improved Input data behavior for large trees.</li>
                    <li>Refined UTM Generator flow and result rendering for faster bulk setup and copy/export.</li>
                  </ul>
                </div>
                <div className="release-entry">
                  <p className="release-date">{feb15ReleaseDate}</p>
                  <ul className="whats-new-list">
                    <li>&quot;Not set&quot; rows in Share Splitter can now be clicked to become full groups with editable names.</li>
                    <li>Improved paste handling on Number Cruncher to keep the viewport anchored at the top, including on Safari/mobile.</li>
                    <li>Released UTM Generator with nested Source / Medium / Campaign / Term / Content / ID grouping.</li>
                    <li>Updated LP input flow: &quot;Paste LP&quot; label, corrected placeholder text, and persistent pasted URLs in the field.</li>
                    <li>Added Ctrl+V bulk paste into Value to create same-level rows automatically and preserve child values on duplicated groups.</li>
                    <li>Minor fixes and polish to grouping, exports, and scrolling behaviour.</li>
                  </ul>
                </div>
                <div className="release-entry">
                  <p className="release-date">{jan18ReleaseDate}</p>
                  <ul className="whats-new-list">
                    <li>Released the Asset Renamer with ZIP uploads and nested grouping.</li>
                    <li>Added drag-and-drop grouping plus copy/export and ZIP outputs.</li>
                    <li>Enabled size/format toggles for naming and preview-on-hover.</li>
                  </ul>
                </div>
                <div className="release-entry">
                  <p className="release-date">{shareSplitterReleaseDate}</p>
                  <ul className="whats-new-list">
                    <li>Added the Share Splitter tool with nested group breakdowns.</li>
                    <li>Introduced pivot-style copy/export modes, including a values-only table.</li>
                    <li>Improved auto naming, row controls, and input/clear UX for large trees.</li>
                    <li>Added rounding and randomizer controls to Share Splitter.</li>
                  </ul>
                </div>
                <div className="release-entry">
                  <p className="release-date">{releaseDate}</p>
                  <ul className="whats-new-list">
                    <li>Added randomizer with adjustable percent and sum preservation.</li>
                    <li>Improved number parsing for mixed separators and trailing blanks.</li>
                    <li>Updated copy/clear controls and pastel UI polish.</li>
                    <li>Added multiply mode and percent input support for sum controls.</li>
                    <li>Added a dedicated What&apos;s new page with dated release notes.</li>
                  </ul>
                </div>
                <div className="release-entry">
                  <p className="release-date">{firstReleaseDate}</p>
                  <p className="release-note">First version published on Monday.</p>
                </div>
              </section>
            </main>
          </>
        ) : isCreativeRenamer ? (
          <CreativeRenamer />
        ) : isCreativeResizer ? (
          <CreativeResizer />
        ) : isUtmGenerator ? (
          <UtmGenerator />
        ) : isShareSplitter ? (
          <ShareSplitter />
        ) : (
          <>
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
                                className={`mode-toggle-button${sumMode === 'add' ? ' active' : ''}`}
                                aria-pressed={sumMode === 'add'}
                                onClick={() => handleModeToggle('add')}
                                title="Add to the base sum"
                              >
                                +
                              </button>
                              <button
                                type="button"
                                className={`mode-toggle-button${sumMode === 'multiply' ? ' active' : ''}`}
                                aria-pressed={sumMode === 'multiply'}
                                onClick={() => handleModeToggle('multiply')}
                                title="Multiply the base sum"
                              >
                                ×
                              </button>
                              <button
                                type="button"
                                className={`mode-toggle-button${sumMode === 'target' ? ' active' : ''}`}
                                aria-pressed={sumMode === 'target'}
                                onClick={() => handleModeToggle('target')}
                                title="Aim for a target sum"
                              >
                                =
                              </button>
                            </div>
                            <input
                              id={additionInputId}
                              type="text"
                              inputMode="decimal"
                              value={desiredInputValue}
                              onChange={(event) => onDesiredChange(event.target.value)}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="stacked-field-column">
                      <div className="stacked-field">
                        <div className="number-field number-field-mode">
                          <label className="number-field-label" htmlFor={digitsInputId}>
                            Rounding
                          </label>
                          <div className="number-field-input-wrapper input-with-toggle digits-toggle">
                            <div className="mode-toggle mode-toggle-inline" role="group" aria-label="Decimal control">
                          <button
                            type="button"
                            className="mode-toggle-button"
                            onClick={() => changeFractionDigits(-1)}
                            disabled={fractionDigitsValue <= 0}
                            title="Decrease decimal places"
                          >
                            -0.0
                          </button>
                          <button
                            type="button"
                            className="mode-toggle-button"
                            onClick={() => changeFractionDigits(1)}
                            disabled={fractionDigitsValue >= 6}
                            title="Increase decimal places"
                          >
                            +0.00
                          </button>
                        </div>
                        <input
                          id={digitsInputId}
                          type="text"
                          inputMode="numeric"
                          value={fractionDigitsInput}
                          onChange={(event) => setFractionDigitsInput(event.target.value)}
                        />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="stacked-field-column">
                      <div className="stacked-field">
                        <div className="number-field number-field-mode">
                          <label className="number-field-label" htmlFor={randomInputId}>
                            Randomizer (%)
                          </label>
                          <div className="number-field-input-wrapper input-with-toggle random-toggle">
                            <div className="mode-toggle mode-toggle-inline" role="group" aria-label="Randomizer control">
                          <button
                            type="button"
                            className="mode-toggle-button"
                            onClick={() => changeRandomPercent(-1)}
                            disabled={randomPercentValue <= 0}
                            title="Decrease randomness"
                          >
                            -
                          </button>
                          <button
                            type="button"
                            className="mode-toggle-button"
                            onClick={() => changeRandomPercent(1)}
                            disabled={randomPercentValue >= 100}
                            title="Increase randomness"
                          >
                            +
                          </button>
                        </div>
                        <input
                          id={randomInputId}
                          type="text"
                          inputMode="numeric"
                          value={randomPercentInput}
                          onChange={(event) => setRandomPercentInput(event.target.value)}
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
                      ref={pasteAreaRef}
                      onPaste={handlePasteStayTop}
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
                    <p>Numbers adjusted to the new sum.</p>
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
          </>
        )}
        <footer className="site-footer">
          <p className="site-disclaimer">
            Please verify the calculated results and separators before use. The author is not liable for errors or
            omissions.
          </p>
          <p>
            Made by{' '}
            <a href="https://www.linkedin.com/in/mrgisaev/" target="_blank" rel="noreferrer">
              Grigorii Isaev
            </a>
            . &copy; {footerYear} Number Cruncher 2026.
          </p>
        </footer>
      </div>
      <button
        className={`scroll-cue${showScrollCue ? ' is-visible' : ''}`}
        type="button"
        onClick={handleScrollTop}
        aria-label="Scroll to top"
      >
        <span className="scroll-cue-arrow" aria-hidden="true" />
      </button>
      {showConsent && (
        <div className="consent-banner" role="dialog" aria-label="Analytics consent">
          <div className="consent-text">
            I use Google Analytics to understand usage. You can accept or reject analytics cookies. Please allow data
            collection — it really helps me improve the tool.
          </div>
          <div className="consent-actions">
            <button type="button" className="consent-button" onClick={() => handleConsent('granted')}>
              Accept
            </button>
            <button type="button" className="consent-button ghost" onClick={() => handleConsent('denied')}>
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
    </>
  );
}

export default App;
