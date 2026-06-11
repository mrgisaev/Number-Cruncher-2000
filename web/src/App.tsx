import {
  Suspense,
  lazy,
  type ChangeEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
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

const CreativeRenamer = lazy(() =>
  import('./CreativeRenamer').then((module) => ({ default: module.CreativeRenamer })),
);
const CreativeResizer = lazy(() =>
  import('./CreativeResizer').then((module) => ({ default: module.CreativeResizer })),
);
const CreativeEditor = lazy(() =>
  import('./CreativeEditor').then((module) => ({ default: module.CreativeEditor })),
);
const ShareSplitter = lazy(() =>
  import('./ShareSplitter').then((module) => ({ default: module.ShareSplitter })),
);
const UtmGenerator = lazy(() =>
  import('./UtmGenerator').then((module) => ({ default: module.UtmGenerator })),
);
const ScreenRecorder = lazy(() =>
  import('./ScreenRecorder').then((module) => ({ default: module.ScreenRecorder })),
);

const numberFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const DISPLAY_ZERO_THRESHOLD = 0.005;

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

type BulkInputType =
  | 'initial'
  | 'final'
  | 'markup'
  | 'margin'
  | 'markup_percent'
  | 'margin_percent';
type BulkWorkingType = 'initial' | 'final' | 'markup' | 'margin';
type BulkResultViewType =
  | 'initial'
  | 'final'
  | 'markup_value'
  | 'markup_percent'
  | 'margin_value'
  | 'margin_percent';
type BulkResultType = 'auto' | BulkResultViewType;

interface BulkScenarioConfig {
  input: BulkInputType;
  working: BulkWorkingType;
  autoResult: BulkResultViewType;
  resultOptions: BulkResultViewType[];
}

interface BulkDerivedRow {
  initial: number | null;
  final: number | null;
  markup: number | null;
  margin: number | null;
}

interface BulkMapSegment {
  id: 'initial' | 'delta';
  label: string;
  meta: string;
  value: number;
  formatted: string;
  width: number;
}

interface BulkMapData {
  segments: BulkMapSegment[];
  finalLabel: string;
  finalValue: number;
}

const BULK_TYPE_LABELS: Record<BulkInputType | BulkWorkingType, string> = {
  initial: 'Initial sum',
  final: 'Final sum',
  markup: 'Markup',
  margin: 'Margin',
  markup_percent: 'Markup %',
  margin_percent: 'Margin %',
};

const BULK_RESULT_LABELS: Record<BulkResultViewType, string> = {
  initial: 'Initial sum',
  final: 'Final sum',
  markup_value: 'Markup',
  markup_percent: 'Markup %',
  margin_value: 'Margin',
  margin_percent: 'Margin %',
};

const BULK_INPUT_ORDER: BulkInputType[] = [
  'initial',
  'final',
  'markup',
  'margin',
  'markup_percent',
  'margin_percent',
];
const BULK_WORKING_ORDER: BulkWorkingType[] = ['initial', 'final', 'markup', 'margin'];

const BULK_SCENARIOS: BulkScenarioConfig[] = [
  {
    input: 'final',
    working: 'initial',
    autoResult: 'markup_value',
    resultOptions: ['markup_value', 'markup_percent', 'margin_value', 'margin_percent'],
  },
  {
    input: 'markup',
    working: 'initial',
    autoResult: 'final',
    resultOptions: ['final', 'margin_value', 'margin_percent'],
  },
  {
    input: 'margin',
    working: 'initial',
    autoResult: 'final',
    resultOptions: ['final', 'markup_value', 'markup_percent'],
  },
  {
    input: 'markup_percent',
    working: 'initial',
    autoResult: 'final',
    resultOptions: ['final', 'markup_value', 'margin_percent'],
  },
  {
    input: 'margin_percent',
    working: 'initial',
    autoResult: 'final',
    resultOptions: ['final', 'markup_value', 'markup_percent'],
  },
  {
    input: 'initial',
    working: 'final',
    autoResult: 'markup_value',
    resultOptions: ['markup_value', 'markup_percent', 'margin_value', 'margin_percent'],
  },
  {
    input: 'initial',
    working: 'markup',
    autoResult: 'final',
    resultOptions: ['final', 'markup_value', 'markup_percent', 'margin_value', 'margin_percent'],
  },
  {
    input: 'initial',
    working: 'margin',
    autoResult: 'final',
    resultOptions: ['final', 'markup_value', 'markup_percent'],
  },
  {
    input: 'final',
    working: 'markup',
    autoResult: 'initial',
    resultOptions: ['initial', 'markup_value', 'markup_percent', 'margin_value', 'margin_percent'],
  },
  {
    input: 'final',
    working: 'margin',
    autoResult: 'initial',
    resultOptions: ['initial', 'markup_value', 'markup_percent'],
  },
  {
    input: 'markup',
    working: 'final',
    autoResult: 'initial',
    resultOptions: ['initial', 'margin_value', 'margin_percent'],
  },
  {
    input: 'margin',
    working: 'final',
    autoResult: 'initial',
    resultOptions: ['initial', 'markup_value', 'markup_percent'],
  },
  {
    input: 'markup_percent',
    working: 'final',
    autoResult: 'initial',
    resultOptions: ['initial', 'markup_value', 'margin_percent'],
  },
  {
    input: 'margin_percent',
    working: 'final',
    autoResult: 'initial',
    resultOptions: ['initial', 'markup_value', 'markup_percent'],
  },
];

const getBulkInputOptionsForWorking = (working: BulkWorkingType): BulkInputType[] =>
  BULK_INPUT_ORDER.filter((input) =>
    BULK_SCENARIOS.some((scenario) => scenario.input === input && scenario.working === working),
  );

const findBulkScenario = (input: BulkInputType, working: BulkWorkingType) =>
  BULK_SCENARIOS.find((scenario) => scenario.input === input && scenario.working === working) ?? null;

const getRouteTitle = (pathname: string) => {
  if (pathname.includes('bulk-percent')) return 'Percent Cruncher - Number Cruncher';
  if (pathname.includes('creative-editor')) return 'Creative Editor - Number Cruncher 2026';
  if (pathname.includes('creative-resizer')) return 'Creative Resizer - Number Cruncher 2026';
  if (pathname.includes('creative-renamer')) return 'Asset Renamer - Number Cruncher 2026';
  if (pathname.includes('screen-recorder')) return 'Screen Recorder - Number Cruncher 2026';
  if (pathname.includes('share-splitter')) return 'Share Splitter - Number Cruncher 2026';
  if (pathname.includes('utm-generator')) return 'UTM Generator - Number Cruncher 2026';
  if (pathname.includes('whats-new')) return "What's new - Number Cruncher 2026";
  return 'Number Cruncher';
};

function App() {
  const [rawInput, setRawInput] = useState(sampleColumn);
  const [sumMode, setSumMode] = useState<'add' | 'target' | 'multiply'>('add');
  const [targetInput, setTargetInput] = useState('');
  const [additionInput, setAdditionInput] = useState('');
  const [multiplierInput, setMultiplierInput] = useState('');
  const [bulkWorkingInput, setBulkWorkingInput] = useState('');
  const [bulkInputType, setBulkInputType] = useState<BulkInputType>('initial');
  const [bulkWorkingType, setBulkWorkingType] = useState<BulkWorkingType>('markup');
  const [bulkResultType, setBulkResultType] = useState<BulkResultType>('auto');
  const [isBulkWorkingTypeOpen, setIsBulkWorkingTypeOpen] = useState(false);
  const [isBulkInputTypeOpen, setIsBulkInputTypeOpen] = useState(false);
  const [isBulkResultTypeOpen, setIsBulkResultTypeOpen] = useState(false);
  const [fractionDigitsInput, setFractionDigitsInput] = useState('');
  const [randomPercentInput, setRandomPercentInput] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [showScrollCue, setShowScrollCue] = useState(false);
  const [menuOverflow, setMenuOverflow] = useState(false);
  const [menuFadeLeft, setMenuFadeLeft] = useState(false);
  const [menuFadeRight, setMenuFadeRight] = useState(false);
  const [menuIsDragging, setMenuIsDragging] = useState(false);
  const [routePath, setRoutePath] = useState(() =>
    typeof window !== 'undefined' ? window.location.pathname : '/index.html',
  );
  const [, startRouteTransition] = useTransition();
  const pasteAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const menuScrollRef = useRef<HTMLUListElement | null>(null);
  const menuDragRef = useRef<{
    startX: number;
    startScrollLeft: number;
    didDrag: boolean;
  } | null>(null);
  const menuSuppressClickRef = useRef(false);
  const menuSuppressClickTimeoutRef = useRef<number | null>(null);
  const bulkWorkingControlRef = useRef<HTMLDivElement | null>(null);
  const bulkInputControlRef = useRef<HTMLDivElement | null>(null);
  const bulkResultControlRef = useRef<HTMLDivElement | null>(null);
  const [showConsent, setShowConsent] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('nc-analytics-consent') !== 'granted';
  });
  const footerYear = new Date().getFullYear();
  const isWhatsNew = routePath.includes('whats-new');
  const isShareSplitter = routePath.includes('share-splitter');
  const isCreativeRenamer = routePath.includes('creative-renamer');
  const isCreativeResizer = routePath.includes('creative-resizer');
  const isCreativeEditor = routePath.includes('creative-editor');
  const isUtmGenerator = routePath.includes('utm-generator');
  const isScreenRecorder = routePath.includes('screen-recorder');
  const isBulkPercent = routePath.includes('bulk-percent');
  const mainToolTitle = isBulkPercent ? 'Percent Cruncher' : 'Number Cruncher';
  const mar8ReleaseDate = 'Mar 8, 2026';
  const feb28ReleaseDate = 'Feb 28, 2026';
  const latestReleaseDate = 'Feb 21, 2026';
  const feb17ReleaseDate = 'Feb 17, 2026';
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

  const bulkWorkingOptions = BULK_WORKING_ORDER;
  const bulkInputOptions = useMemo(
    () => getBulkInputOptionsForWorking(bulkWorkingType),
    [bulkWorkingType],
  );
  const bulkScenario = useMemo(
    () => findBulkScenario(bulkInputType, bulkWorkingType),
    [bulkInputType, bulkWorkingType],
  );
  const bulkResultOptions = bulkScenario?.resultOptions ?? ['markup_value'];
  const bulkAutoResultType = bulkScenario?.autoResult ?? bulkResultOptions[0];
  const bulkEffectiveResultType: BulkResultViewType =
    bulkResultType !== 'auto' && bulkResultOptions.includes(bulkResultType as BulkResultViewType)
      ? (bulkResultType as BulkResultViewType)
      : bulkAutoResultType;

  useEffect(() => {
    if (!isBulkPercent) return;
    const nextInputOptions = getBulkInputOptionsForWorking(bulkWorkingType);
    if (!nextInputOptions.includes(bulkInputType)) {
      setBulkInputType(nextInputOptions[0]);
    }
  }, [isBulkPercent, bulkInputType, bulkWorkingType]);

  useEffect(() => {
    if (!isBulkPercent) return;
    if (bulkResultType === 'auto') return;
    if (!bulkResultOptions.includes(bulkResultType as BulkResultViewType)) {
      setBulkResultType('auto');
    }
  }, [isBulkPercent, bulkResultType, bulkResultOptions]);

  useEffect(() => {
    if (!isBulkPercent) {
      setIsBulkWorkingTypeOpen(false);
      setIsBulkInputTypeOpen(false);
      setIsBulkResultTypeOpen(false);
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (bulkWorkingControlRef.current?.contains(target)) return;
      if (bulkInputControlRef.current?.contains(target)) return;
      if (bulkResultControlRef.current?.contains(target)) return;
      setIsBulkWorkingTypeOpen(false);
      setIsBulkInputTypeOpen(false);
      setIsBulkResultTypeOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isBulkPercent]);

  const bulkInputLabel = BULK_TYPE_LABELS[bulkInputType];
  const bulkWorkingLabel = BULK_TYPE_LABELS[bulkWorkingType];
  const bulkResultTypeLabel = BULK_RESULT_LABELS[bulkEffectiveResultType];

  const parseBulkMetricInput = (input: string) => {
    const parsed = parsePercentInput(input);
    if (parsed.value === null) {
      return null;
    }
    if (parsed.isPercent) {
      return { isPercent: true, value: parsed.value / 100 };
    }
    const absolute = Math.abs(parsed.value);
    if (absolute > 0 && absolute < 1) {
      return { isPercent: true, value: parsed.value };
    }
    return { isPercent: false, value: parsed.value };
  };

  const bulkDerivedRows = useMemo<BulkDerivedRow[]>(() => {
    if (!isBulkPercent) {
      return [];
    }
    const parsedWorkingValue = parseColumn(bulkWorkingInput)[0]?.value ?? null;
    const metricInput =
      bulkWorkingType === 'final' || bulkWorkingType === 'initial'
        ? null
        : parseBulkMetricInput(bulkWorkingInput);
    const absoluteWorkingInput =
      bulkWorkingType === 'final' || bulkWorkingType === 'initial'
        ? parsedWorkingValue
        : null;
    const inputTotal = sumValues(numericValues);
    const emptyRow: BulkDerivedRow = { initial: null, final: null, markup: null, margin: null };

    if (
      (bulkWorkingType === 'final' || bulkWorkingType === 'initial') &&
      absoluteWorkingInput === null
    ) {
      return numericValues.map(() => emptyRow);
    }

    if (bulkWorkingType !== 'final' && bulkWorkingType !== 'initial' && !metricInput) {
      return numericValues.map(() => emptyRow);
    }

    return numericValues.map((inputValue) => {
      let initialValue: number | null = null;
      let finalValue: number | null = null;
      let markupValue: number | null = null;
      let marginValue: number | null = null;

      if (bulkWorkingType === 'final') {
        const finalTotal = absoluteWorkingInput as number;
        if (inputTotal === 0 || bulkInputType === 'final') {
          return emptyRow;
        }
        const allocatedFinal = inputValue * (finalTotal / inputTotal);
        finalValue = allocatedFinal;

        if (bulkInputType === 'initial') {
          initialValue = inputValue;
          markupValue = finalValue - initialValue;
        } else if (bulkInputType === 'markup_percent') {
          const pct = inputValue / 100;
          if (pct <= -1) {
            return emptyRow;
          }
          initialValue = finalValue / (1 + pct);
          markupValue = finalValue - initialValue;
        } else if (bulkInputType === 'margin_percent') {
          const pct = inputValue / 100;
          if (pct >= 1) {
            return emptyRow;
          }
          initialValue = finalValue * (1 - pct);
          markupValue = finalValue - initialValue;
        } else {
          // For input Markup/Margin we treat each row value as absolute markup amount.
          markupValue = inputValue;
          initialValue = finalValue - markupValue;
        }
      } else if (bulkWorkingType === 'initial') {
        const initialTotal = absoluteWorkingInput as number;
        if (inputTotal === 0 || bulkInputType === 'initial') {
          return emptyRow;
        }
        const allocatedInitial = inputValue * (initialTotal / inputTotal);
        initialValue = allocatedInitial;

        if (bulkInputType === 'final') {
          finalValue = inputValue;
          markupValue = finalValue - initialValue;
        } else if (bulkInputType === 'markup_percent') {
          const pct = inputValue / 100;
          finalValue = initialValue * (1 + pct);
          markupValue = finalValue - initialValue;
        } else if (bulkInputType === 'margin_percent') {
          const pct = inputValue / 100;
          if (pct >= 1) {
            return emptyRow;
          }
          finalValue = initialValue / (1 - pct);
          markupValue = finalValue - initialValue;
        } else {
          // For input Markup/Margin we treat each row value as absolute markup amount.
          markupValue = inputValue;
          finalValue = initialValue + markupValue;
        }
      } else if (bulkWorkingType === 'markup') {
        const metricValue = metricInput?.value as number;
        if (bulkInputType !== 'initial' && bulkInputType !== 'final') {
          return emptyRow;
        }
        if (bulkInputType === 'initial') {
          initialValue = inputValue;
          if (metricInput?.isPercent) {
            markupValue = initialValue * metricValue;
          } else {
            if (inputTotal === 0) {
              return emptyRow;
            }
            // Absolute markup is treated as total delta across the whole column.
            markupValue = initialValue * (metricValue / inputTotal);
          }
          finalValue = initialValue + markupValue;
        } else {
          finalValue = inputValue;
          if (metricInput?.isPercent) {
            if (metricValue <= -1) {
              return emptyRow;
            }
            initialValue = finalValue / (1 + metricValue);
            markupValue = finalValue - initialValue;
          } else {
            if (inputTotal === 0) {
              return emptyRow;
            }
            const initialTotal = inputTotal - metricValue;
            initialValue = finalValue * (initialTotal / inputTotal);
            markupValue = finalValue - initialValue;
          }
        }
      } else {
        const metricValue = metricInput?.value as number;
        if (bulkInputType !== 'initial' && bulkInputType !== 'final') {
          return emptyRow;
        }
        if (bulkInputType === 'initial') {
          initialValue = inputValue;
          if (metricInput?.isPercent) {
            if (metricValue >= 1) {
              return emptyRow;
            }
            finalValue = initialValue / (1 - metricValue);
            markupValue = finalValue - initialValue;
            marginValue = metricValue;
          } else {
            if (inputTotal === 0) {
              return emptyRow;
            }
            // Absolute margin is treated as total markup delta across the whole column.
            markupValue = initialValue * (metricValue / inputTotal);
            finalValue = initialValue + markupValue;
          }
        } else {
          finalValue = inputValue;
          if (metricInput?.isPercent) {
            if (metricValue >= 1) {
              return emptyRow;
            }
            initialValue = finalValue * (1 - metricValue);
            markupValue = finalValue - initialValue;
            marginValue = metricValue;
          } else {
            if (inputTotal === 0) {
              return emptyRow;
            }
            const initialTotal = inputTotal - metricValue;
            initialValue = finalValue * (initialTotal / inputTotal);
            markupValue = finalValue - initialValue;
          }
        }
      }

      if (marginValue === null && finalValue !== null && markupValue !== null && finalValue !== 0) {
        marginValue = markupValue / finalValue;
      }

      return {
        initial:
          typeof initialValue === 'number' && Number.isFinite(initialValue) ? initialValue : null,
        final: typeof finalValue === 'number' && Number.isFinite(finalValue) ? finalValue : null,
        markup:
          typeof markupValue === 'number' && Number.isFinite(markupValue) ? markupValue : null,
        margin:
          typeof marginValue === 'number' && Number.isFinite(marginValue) ? marginValue : null,
      };
    });
  }, [isBulkPercent, bulkWorkingInput, bulkInputType, bulkWorkingType, numericValues]);

  const baseComputedValues = useMemo<Array<number | null>>(() => {
    if (isBulkPercent) {
      return bulkDerivedRows.map((row) => {
        const result =
          bulkEffectiveResultType === 'initial'
            ? row.initial
            : bulkEffectiveResultType === 'final'
              ? row.final
              : bulkEffectiveResultType === 'markup_value'
                ? row.markup
                : bulkEffectiveResultType === 'markup_percent'
                  ? row.initial !== null && row.markup !== null && row.initial !== 0
                    ? (row.markup / row.initial) * 100
                    : null
                  : bulkEffectiveResultType === 'margin_value'
                    ? row.markup
                    : row.margin !== null
                      ? row.margin * 100
                      : null;

        if (typeof result !== 'number' || !Number.isFinite(result)) {
          return null;
        }
        return result;
      });
    }

    return buildScaledValues(numericValues, desiredSum).map((value) =>
      Number.isFinite(value) ? value : null,
    );
  }, [
    isBulkPercent,
    bulkDerivedRows,
    bulkEffectiveResultType,
    numericValues,
    desiredSum,
  ]);

  const isPercentResultOutput =
    isBulkPercent &&
    (bulkEffectiveResultType === 'markup_percent' ||
      bulkEffectiveResultType === 'margin_percent');

  const randomizedValues = useMemo<Array<number | null>>(() => {
    if (!baseComputedValues.length || randomPercentValue <= 0) {
      return baseComputedValues;
    }
    const factor = randomPercentValue / 100;
    const jittered = [...baseComputedValues];
    const numericIndexes: number[] = [];
    let baseNumericSum = 0;

    for (let index = 0; index < baseComputedValues.length; index += 1) {
      const value = baseComputedValues[index];
      if (typeof value === 'number' && Number.isFinite(value)) {
        numericIndexes.push(index);
        baseNumericSum += value;
      }
    }

    if (!numericIndexes.length) {
      return baseComputedValues;
    }

    let jitterSum = 0;
    numericIndexes.forEach((index) => {
      const source = baseComputedValues[index] as number;
      const offset = (Math.random() * 2 - 1) * factor;
      const next = source * (1 + offset);
      jittered[index] = next;
      jitterSum += next;
    });

    if (jitterSum !== 0) {
      const scale = baseNumericSum / jitterSum;
      numericIndexes.forEach((index) => {
        const value = jittered[index];
        if (typeof value === 'number' && Number.isFinite(value)) {
          jittered[index] = value * scale;
        }
      });
    }

    return jittered;
  }, [baseComputedValues, randomPercentValue]);

  const adjustedValues = useMemo<Array<number | null>>(() => {
    const finiteValues = randomizedValues.filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value),
    );
    if (!finiteValues.length) {
      return randomizedValues.map(() => null);
    }
    const roundingTarget = isBulkPercent ? sumValues(finiteValues) : desiredSum;
    const rounded = enforceRounding(finiteValues, roundingTarget, decimals);
    let pointer = 0;
    return randomizedValues.map((value) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
      }
      const next = rounded[pointer];
      pointer += 1;
      return Number.isFinite(next) ? next : null;
    });
  }, [randomizedValues, isBulkPercent, desiredSum, decimals]);

  const adjustedSum = useMemo(
    () => {
      const finite = adjustedValues.filter(
        (value): value is number => typeof value === 'number' && Number.isFinite(value),
      );
      if (!finite.length) {
        return 0;
      }
      if (isPercentResultOutput) {
        return sumValues(finite) / finite.length;
      }
      return sumValues(finite);
    },
    [adjustedValues, isPercentResultOutput],
  );

  const bulkInputSummaryValue = useMemo(() => {
    if (!isBulkPercent) {
      return baseSum;
    }
    if (bulkInputType === 'markup_percent' || bulkInputType === 'margin_percent') {
      const markupSum = sumValues(
        bulkDerivedRows
          .map((row) => row.markup)
          .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
      );
      return markupSum;
    }
    return baseSum;
  }, [isBulkPercent, bulkInputType, bulkDerivedRows, baseSum]);

  const hasCalculatedValues = useMemo(
    () => adjustedValues.some((value) => typeof value === 'number' && Number.isFinite(value)),
    [adjustedValues],
  );
  const adjustedSumLabel = isPercentResultOutput
    ? `${numberFormatter.format(adjustedSum)}%`
    : numberFormatter.format(adjustedSum);
  const bulkMapData = useMemo<BulkMapData | null>(() => {
    if (!isBulkPercent) {
      return null;
    }

    const finiteInitialValues = bulkDerivedRows
      .map((row) => row.initial)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const finiteDeltaValues = bulkDerivedRows
      .map((row) => row.markup)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const finiteFinalValues = bulkDerivedRows
      .map((row) => row.final)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

    const initialTotal = sumValues(finiteInitialValues);
    const deltaTotal = sumValues(finiteDeltaValues);
    const computedFinalTotal = sumValues(finiteFinalValues);
    const finalTotal = computedFinalTotal || initialTotal + deltaTotal;
    if (!Number.isFinite(finalTotal) || finalTotal < DISPLAY_ZERO_THRESHOLD) {
      return null;
    }

    const deltaLabel =
      bulkWorkingType === 'margin' ||
      bulkInputType === 'margin' ||
      bulkInputType === 'margin_percent' ||
      bulkEffectiveResultType === 'margin_value' ||
      bulkEffectiveResultType === 'margin_percent'
        ? 'Margin'
        : 'Markup';

    const candidates: Array<Omit<BulkMapSegment, 'formatted' | 'width'>> = [
      {
        id: 'initial',
        label: 'Initial sum',
        meta: 'Base',
        value: initialTotal,
      },
      {
        id: 'delta',
        label: deltaLabel,
        meta: 'Added value',
        value: deltaTotal,
      },
    ];

    return {
      finalLabel: numberFormatter.format(finalTotal),
      finalValue: finalTotal,
      segments: candidates
        .filter((item) => Number.isFinite(item.value) && item.value >= DISPLAY_ZERO_THRESHOLD)
        .map((item) => ({
          ...item,
          formatted: numberFormatter.format(item.value),
          width: Math.min(100, (item.value / finalTotal) * 100),
        })),
    };
  }, [
    bulkDerivedRows,
    bulkEffectiveResultType,
    bulkInputType,
    bulkWorkingType,
    isBulkPercent,
  ]);
  const formattedValues = (() => {
    let pointer = 0;
    return parsedRows.map((row) => {
      if (row.value === null) {
        return row.raw || '';
      }
      const next = adjustedValues[pointer];
      pointer += 1;
      if (typeof next !== 'number' || !Number.isFinite(next)) {
        return '';
      }
      const formatted = formatRowValue(next, decimals);
      if (isBulkPercent) {
        return isPercentResultOutput ? `${formatted}%` : formatted;
      }
      if (isPercentResultOutput) {
        return `${formatted}%`;
      }
      return `${row.prefix || ''}${formatted}${row.suffix || ''}`;
    });
  })();
  const resultText = formattedValues.join('\n');

  const handleCopy = async () => {
    if (!hasCalculatedValues) {
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

  const preloadRouteModule = useCallback((pathname: string) => {
    if (pathname.includes('creative-renamer')) {
      void import('./CreativeRenamer');
      return;
    }
    if (pathname.includes('creative-resizer')) {
      void import('./CreativeResizer');
      return;
    }
    if (pathname.includes('creative-editor')) {
      void import('./CreativeEditor');
      return;
    }
    if (pathname.includes('utm-generator')) {
      void import('./UtmGenerator');
      return;
    }
    if (pathname.includes('screen-recorder')) {
      void import('./ScreenRecorder');
      return;
    }
    if (pathname.includes('share-splitter')) {
      void import('./ShareSplitter');
    }
  }, []);

  const navigateTo = useCallback(
    (href: string) => {
      if (typeof window === 'undefined') return;
      const nextUrl = new URL(href, window.location.origin);
      if (nextUrl.origin !== window.location.origin) {
        window.location.href = href;
        return;
      }
      const nextPath = nextUrl.pathname;
      const isToolPage = nextPath === '/' || nextPath === '/index.html' || nextPath.endsWith('.html');
      if (!isToolPage) {
        window.location.href = href;
        return;
      }
      if (nextPath === routePath) return;

      preloadRouteModule(nextPath);
      window.history.pushState({}, '', `${nextPath}${nextUrl.search}${nextUrl.hash}`);
      startRouteTransition(() => {
        setRoutePath(nextPath);
      });
      window.scrollTo({ top: 0, behavior: 'auto' });
    },
    [preloadRouteModule, routePath, startRouteTransition],
  );

  const handleToolLinkClick = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>) => {
      if (menuSuppressClickRef.current) {
        event.preventDefault();
        if (typeof window !== 'undefined' && menuSuppressClickTimeoutRef.current !== null) {
          window.clearTimeout(menuSuppressClickTimeoutRef.current);
        }
        menuSuppressClickTimeoutRef.current = null;
        menuSuppressClickRef.current = false;
        return;
      }
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const href = event.currentTarget.getAttribute('href');
      if (!href) return;
      event.preventDefault();
      navigateTo(href);
    },
    [navigateTo],
  );

  const handleToolLinkHover = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>) => {
      const href = event.currentTarget.getAttribute('href');
      if (!href || typeof window === 'undefined') return;
      const nextUrl = new URL(href, window.location.origin);
      if (nextUrl.origin !== window.location.origin) return;
      preloadRouteModule(nextUrl.pathname);
    },
    [preloadRouteModule],
  );

  const clearMenuSuppressClick = useCallback(() => {
    if (typeof window !== 'undefined' && menuSuppressClickTimeoutRef.current !== null) {
      window.clearTimeout(menuSuppressClickTimeoutRef.current);
    }
    menuSuppressClickTimeoutRef.current = null;
    menuSuppressClickRef.current = false;
  }, []);

  const armMenuSuppressClick = useCallback(() => {
    if (typeof window === 'undefined') {
      menuSuppressClickRef.current = false;
      menuSuppressClickTimeoutRef.current = null;
      return;
    }
    if (menuSuppressClickTimeoutRef.current !== null) {
      window.clearTimeout(menuSuppressClickTimeoutRef.current);
    }
    menuSuppressClickRef.current = true;
    menuSuppressClickTimeoutRef.current = window.setTimeout(() => {
      menuSuppressClickRef.current = false;
      menuSuppressClickTimeoutRef.current = null;
    }, 0);
  }, []);

  const finishMenuDrag = useCallback(
    (pointerId?: number) => {
      const el = menuScrollRef.current;
      if (el && typeof pointerId === 'number' && el.hasPointerCapture?.(pointerId)) {
        el.releasePointerCapture(pointerId);
      }
      const didDrag = menuDragRef.current?.didDrag ?? false;
      menuDragRef.current = null;
      setMenuIsDragging(false);
      if (didDrag) {
        armMenuSuppressClick();
      }
    },
    [armMenuSuppressClick],
  );

  const handleMenuMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLUListElement>) => {
      if (event.button !== 0) return;
      const el = menuScrollRef.current;
      if (!el || el.scrollWidth <= el.clientWidth + 2) return;
      clearMenuSuppressClick();
      menuDragRef.current = {
        startX: event.clientX,
        startScrollLeft: el.scrollLeft,
        didDrag: false,
      };
    },
    [clearMenuSuppressClick],
  );

  useEffect(() => {
    let rafId = 0;
    const updateScrollCue = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight > window.innerHeight + 4;
      setShowScrollCue(scrollable);
    };
    const scheduleScrollCueUpdate = () => {
      if (rafId !== 0) {
        return;
      }
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        updateScrollCue();
      });
    };
    updateScrollCue();
    window.addEventListener('resize', scheduleScrollCueUpdate);
    window.addEventListener('scroll', scheduleScrollCueUpdate, { passive: true });
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => scheduleScrollCueUpdate());
      if (document.body) {
        resizeObserver.observe(document.body);
      }
      resizeObserver.observe(document.documentElement);
    }
    return () => {
      window.removeEventListener('resize', scheduleScrollCueUpdate);
      window.removeEventListener('scroll', scheduleScrollCueUpdate);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, []);

  useEffect(() => {
    let rafId = 0;
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
    const scheduleMenuOverflowUpdate = () => {
      if (rafId !== 0) {
        return;
      }
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        updateMenuOverflow();
      });
    };
    updateMenuOverflow();
    window.addEventListener('resize', scheduleMenuOverflowUpdate);
    const el = menuScrollRef.current;
    if (el) {
      el.addEventListener('scroll', scheduleMenuOverflowUpdate, { passive: true });
    }
    return () => {
      window.removeEventListener('resize', scheduleMenuOverflowUpdate);
      if (el) {
        el.removeEventListener('scroll', scheduleMenuOverflowUpdate);
      }
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const drag = menuDragRef.current;
      const el = menuScrollRef.current;
      if (!drag || !el) {
        return;
      }

      const deltaX = event.clientX - drag.startX;
      if (!drag.didDrag) {
        if (Math.abs(deltaX) < 10) {
          return;
        }
        drag.didDrag = true;
        setMenuIsDragging(true);
      }

      el.scrollLeft = drag.startScrollLeft - deltaX;
      event.preventDefault();
    };

    const handleMouseUp = () => {
      if (!menuDragRef.current) {
        return;
      }
      finishMenuDrag();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [finishMenuDrag]);

  useEffect(() => () => {
    clearMenuSuppressClick();
  }, [clearMenuSuppressClick]);

  useEffect(() => {
    const consent = typeof window !== 'undefined' ? localStorage.getItem('nc-analytics-consent') : null;
    if (consent === 'granted') {
      loadAnalytics();
      setShowConsent(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = () => {
      setRoutePath(window.location.pathname);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    document.title = getRouteTitle(routePath);
  }, [routePath]);

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
            className={`tool-links${menuOverflow ? ' is-scrollable' : ''}${menuIsDragging ? ' is-dragging' : ''}`}
            ref={menuScrollRef}
            onMouseDown={handleMenuMouseDown}
          >
            <li className="tool-links-section-title" aria-hidden="true">
              Numbers:
            </li>
            <li>
              <a className="tool-link-button" href="/index.html" onClick={handleToolLinkClick} onMouseEnter={handleToolLinkHover}>
                Number Cruncher
              </a>
            </li>
            <li>
              <a className="tool-link-button" href="/bulk-percent.html" onClick={handleToolLinkClick} onMouseEnter={handleToolLinkHover}>
                Percent Cruncher
              </a>
            </li>
            <li>
              <a className="tool-link-button" href="/share-splitter.html" onClick={handleToolLinkClick} onMouseEnter={handleToolLinkHover}>
                Share Splitter
              </a>
            </li>
            <li className="tool-links-section-title" aria-hidden="true">
              Creatives:
            </li>
            <li>
              <a className="tool-link-button" href="/creative-resizer.html" onClick={handleToolLinkClick} onMouseEnter={handleToolLinkHover}>
                Creative Resizer
              </a>
            </li>
            <li>
              <a className="tool-link-button" href="/creative-editor.html" onClick={handleToolLinkClick} onMouseEnter={handleToolLinkHover}>
                Creative Editor
              </a>
            </li>
            <li>
              <a className="tool-link-button" href="/creative-renamer.html" onClick={handleToolLinkClick} onMouseEnter={handleToolLinkHover}>
                Asset Renamer
              </a>
            </li>
            <li className="tool-links-section-title" aria-hidden="true">
              Other:
            </li>
            <li>
              <a className="tool-link-button" href="/utm-generator.html" onClick={handleToolLinkClick} onMouseEnter={handleToolLinkHover}>
                UTM Generator
              </a>
            </li>
            <li>
              <a className="tool-link-button" href="/screen-recorder.html" onClick={handleToolLinkClick} onMouseEnter={handleToolLinkHover}>
                Screen Recorder
              </a>
            </li>
            <li>
              <a className="tool-link-button" href="/whats-new.html" onClick={handleToolLinkClick} onMouseEnter={handleToolLinkHover}>
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
                  <p className="release-date">{mar8ReleaseDate}</p>
                  <ul className="whats-new-list">
                    <li>Released Screen Recorder for capturing a screen, window, or browser tab with audio.</li>
                    <li>Added cursor capture, optional webcam overlay, and save flow with WebM or MP4 output.</li>
                  </ul>
                </div>
                <div className="release-entry">
                  <p className="release-date">{feb28ReleaseDate}</p>
                  <ul className="whats-new-list">
                    <li>Released Creative Editor with text layers, rich style controls, background fills, gradients, and live drag/resize editing.</li>
                    <li>Added sticker workflow: upload/paste, move, resize, rotate, duplicate, and export matching the preview.</li>
                    <li>Released Percent Cruncher for bulk Initial/Final/Markup/Margin scenarios with automatic input/output filtering.</li>
                    <li>Added smart percent or absolute parsing, plus rounding, randomizer, and copy-ready bulk results.</li>
                  </ul>
                </div>
                <div className="release-entry">
                  <p className="release-date">{latestReleaseDate}</p>
                  <ul className="whats-new-list">
                    <li>Released Creative Resizer for bulk image cropping with a fast one-by-one workflow.</li>
                    <li>Added ratio presets plus custom W:H with smooth controls, zoom, pan, and rotate actions.</li>
                    <li>Introduced a stacked preview deck, per-item download/copy actions, and ZIP export of ready images.</li>
                    <li>Added direct handoff of resized assets to Asset Renamer for faster production flow.</li>
                  </ul>
                </div>
                <div className="release-entry">
                  <p className="release-date">{feb17ReleaseDate}</p>
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
        ) : isCreativeRenamer || isCreativeResizer || isCreativeEditor || isUtmGenerator || isShareSplitter || isScreenRecorder ? (
          <Suspense fallback={null}>
            {isCreativeRenamer ? (
              <CreativeRenamer />
            ) : isCreativeResizer ? (
              <CreativeResizer />
            ) : isCreativeEditor ? (
              <CreativeEditor />
            ) : isUtmGenerator ? (
              <UtmGenerator />
            ) : isScreenRecorder ? (
              <ScreenRecorder />
            ) : (
              <ShareSplitter />
            )}
          </Suspense>
        ) : (
          <>
            <section className="controls-wrapper">
                  <div className="controls">
                  <div className="controls-heading">
                    <h1 className="controls-heading-title">{mainToolTitle}</h1>
                    <p className="controls-subtitle">
                      One column for your data, the other for a polished result. Pick the distribution mode and settings before copying the result.
                    </p>
                  </div>
                  <div className="split-control">
                    <div className="stacked-field-column">
                      <div className="stacked-field">
                        <div className="number-field number-field-mode">
                          <label className="number-field-label" htmlFor={additionInputId}>
                            {isBulkPercent ? 'Working value' : desiredLabel}
                          </label>
                          {isBulkPercent ? (
                            <>
                              <div className="number-field-input-wrapper input-with-toggle bulk-working-inline">
                                <div className="editor-select-control bulk-working-type-control" ref={bulkWorkingControlRef}>
                                  <button
                                    type="button"
                                    className={`editor-select-trigger bulk-select-trigger${isBulkWorkingTypeOpen ? ' is-active' : ''}`}
                                    onClick={() => {
                                      setIsBulkInputTypeOpen(false);
                                      setIsBulkResultTypeOpen(false);
                                      setIsBulkWorkingTypeOpen((prev) => !prev);
                                    }}
                                    aria-haspopup="listbox"
                                    aria-expanded={isBulkWorkingTypeOpen}
                                    aria-label="Working value type"
                                  >
                                    <span className="editor-select-value">{bulkWorkingLabel}</span>
                                    <svg viewBox="0 0 16 16" aria-hidden="true">
                                      <path d="M4 6l4 4 4-4" />
                                    </svg>
                                  </button>
                                  {isBulkWorkingTypeOpen ? (
                                    <div className="editor-select-popover bulk-select-popover" role="listbox" aria-label="Working value options">
                                      {bulkWorkingOptions.map((option) => (
                                        <button
                                          key={option}
                                          type="button"
                                          className={`editor-select-option${bulkWorkingType === option ? ' is-active' : ''}`}
                                          aria-selected={bulkWorkingType === option}
                                          onClick={() => {
                                            setBulkWorkingType(option);
                                            setIsBulkWorkingTypeOpen(false);
                                          }}
                                        >
                                          <span>{BULK_TYPE_LABELS[option]}</span>
                                        </button>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                                <input
                                  id={additionInputId}
                                  type="text"
                                  inputMode="decimal"
                                  value={bulkWorkingInput}
                                  onChange={(event) => setBulkWorkingInput(event.target.value)}
                                />
                              </div>
                            </>
                          ) : (
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
                          )}
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
              {isBulkPercent ? (
                <section className="card bulk-visualizer-card" aria-label="Percent data visualizer">
                  <header className="bulk-visualizer-header">
                    <h2>Data map</h2>
                  </header>
                  {bulkMapData?.segments.length ? (
                    <>
                      <div className="bulk-zone-line">
                        {bulkMapData.segments.map((item) => (
                          <div
                            className={`bulk-zone-segment is-${item.id}`}
                            key={item.id}
                            style={{ '--zone-width': `${item.width}%` } as CSSProperties}
                            title={`${item.label}: ${item.formatted}`}
                          >
                            <span>{item.label}</span>
                            <strong>{item.formatted}</strong>
                          </div>
                        ))}
                        <div className="bulk-zone-final-marker">
                          <span>Final sum</span>
                          <strong>{bulkMapData.finalLabel}</strong>
                        </div>
                      </div>
                      <div className="bulk-zone-legend" aria-label="Displayed data points">
                        {bulkMapData.segments.map((item) => (
                          <span className={`bulk-zone-legend-item is-${item.id}`} key={item.id}>
                            <i aria-hidden="true" />
                            {item.meta}
                          </span>
                        ))}
                        <span className="bulk-zone-legend-item is-final">
                          <i aria-hidden="true" />
                          Final sum
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="bulk-zone-empty">Non-zero values will appear here.</div>
                  )}
                </section>
              ) : null}
            <main className="grid">
              <section className="card">
                  <header className="card-header">
                    <div className="card-header-top">
                      <h2>Input data</h2>
                      <button
                        type="button"
                        className="clear-action-button"
                        onClick={() => setRawInput('')}
                        disabled={rawInput.trim().length === 0}
                      >
                        Clear field
                      </button>
                    </div>
                    <p>Copy values in Excel and paste them here with Ctrl+V.</p>
                  </header>
                    <div className="result-summary summary-inline">
                      {isBulkPercent ? (
                        <div className="editor-select-control bulk-input-type-control" ref={bulkInputControlRef}>
                          <button
                            id="bulk-input-type"
                            type="button"
                            className={`editor-select-trigger bulk-select-trigger${isBulkInputTypeOpen ? ' is-active' : ''}`}
                            onClick={() => {
                              setIsBulkWorkingTypeOpen(false);
                              setIsBulkResultTypeOpen(false);
                              setIsBulkInputTypeOpen((prev) => !prev);
                            }}
                            aria-haspopup="listbox"
                            aria-expanded={isBulkInputTypeOpen}
                            aria-label="Input data type"
                          >
                            <span className="editor-select-value">{bulkInputLabel}</span>
                            <svg viewBox="0 0 16 16" aria-hidden="true">
                              <path d="M4 6l4 4 4-4" />
                            </svg>
                          </button>
                          {isBulkInputTypeOpen ? (
                            <div className="editor-select-popover bulk-select-popover" role="listbox" aria-label="Input data type options">
                              {bulkInputOptions.map((option) => (
                                <button
                                  key={option}
                                  type="button"
                                  className={`editor-select-option${bulkInputType === option ? ' is-active' : ''}`}
                                  aria-selected={bulkInputType === option}
                                  onClick={() => {
                                    setBulkInputType(option);
                                    setIsBulkInputTypeOpen(false);
                                  }}
                                >
                                  <span>{BULK_TYPE_LABELS[option]}</span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <span>Sum of input values</span>
                      )}
                      <strong>{numberFormatter.format(bulkInputSummaryValue)}</strong>
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
                      <button type="button" onClick={handleCopy} disabled={!hasCalculatedValues}>
                        {copyState === 'copied' ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <p>{isBulkPercent ? 'Values calculated from the selected scenario.' : 'Numbers adjusted to the new sum.'}</p>
                  </header>

                  <div className="result-summary">
                    {isBulkPercent ? (
                      <div className="editor-select-control bulk-result-type-control" ref={bulkResultControlRef}>
                        <button
                          type="button"
                          className={`editor-select-trigger bulk-select-trigger${isBulkResultTypeOpen ? ' is-active' : ''}`}
                          onClick={() => {
                            setIsBulkWorkingTypeOpen(false);
                            setIsBulkInputTypeOpen(false);
                            setIsBulkResultTypeOpen((prev) => !prev);
                          }}
                          aria-haspopup="listbox"
                          aria-expanded={isBulkResultTypeOpen}
                          aria-label="Result type"
                        >
                          <span className="editor-select-value">{bulkResultTypeLabel}</span>
                          <svg viewBox="0 0 16 16" aria-hidden="true">
                            <path d="M4 6l4 4 4-4" />
                          </svg>
                        </button>
                        {isBulkResultTypeOpen ? (
                          <div className="editor-select-popover bulk-select-popover" role="listbox" aria-label="Result type options">
                            {bulkResultOptions.map((option) => (
                              <button
                                key={option}
                                type="button"
                                className={`editor-select-option${bulkEffectiveResultType === option ? ' is-active' : ''}`}
                                aria-selected={bulkEffectiveResultType === option}
                                onClick={() => {
                                  setBulkResultType(option);
                                  setIsBulkResultTypeOpen(false);
                                }}
                              >
                                <span>{BULK_RESULT_LABELS[option]}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <span>Sum of result column</span>
                    )}
                    <strong>{adjustedSumLabel}</strong>
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
            . &copy; {footerYear} Number Cruncher.
          </p>
          <p>Let&apos;s meet on LinkedIn!</p>
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

