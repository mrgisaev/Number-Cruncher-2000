
import {
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import JSZip from 'jszip';

type EditorAsset = {
  id: string;
  file: File;
  previewUrl: string;
  nameBase: string;
  extension: string;
  width: number;
  height: number;
};

type StickerAsset = {
  id: string;
  file: File;
  previewUrl: string;
  width: number;
  height: number;
};

type TextBgMode = 'none' | 'solid' | 'gradient';
type TextBgDirection = 'to-right' | 'to-bottom' | 'to-bottom-right' | 'to-bottom-left';
type TextAlignMode = 'left' | 'center' | 'right' | 'justify';
type TextVerticalAlignMode = 'top' | 'middle' | 'bottom';

type TextLayer = {
  id: string;
  type: 'text';
  text: string;
  richText: string;
  x: number;
  y: number;
  boxWidth: number;
  boxHeight: number;
  minBoxHeight: number;
  size: number;
  fontFamily: string;
  align: TextAlignMode;
  verticalAlign: TextVerticalAlignMode;
  lineHeight: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  opacity: number;
  bgMode: TextBgMode;
  bgDirection: TextBgDirection;
  bgA: string;
  bgB: string;
  bgOpacityA: number;
  bgOpacityB: number;
  paddingX: number;
  paddingY: number;
  padding?: number;
  radius: number;
};

type StickerLayer = {
  id: string;
  type: 'sticker';
  stickerId: string;
  x: number;
  y: number;
  boxWidth: number;
  boxHeight: number;
  opacity: number;
  rotation: number;
};

type Layer = TextLayer | StickerLayer;

type ReadyItem = {
  id: string;
  name: string;
  blob: Blob;
  previewUrl: string;
  width: number;
  height: number;
};

type DragState = {
  layerId: string;
  mode: 'move' | 'resize' | 'rotate';
  resizeHandle?: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 'e' | 's' | 'w';
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  startWidth?: number;
  startHeight?: number;
  startRotation?: number;
  startPointerAngle?: number;
  bounds: DOMRect;
};

const createId = () => Math.random().toString(36).slice(2, 10);
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const textDecorationFromFlags = (underline: boolean, strike: boolean) => {
  if (underline && strike) return 'underline line-through';
  if (underline) return 'underline';
  if (strike) return 'line-through';
  return 'none';
};
const getTextLayerHeight = (layer: TextLayer) => (Number.isFinite(layer.boxHeight) && layer.boxHeight > 0 ? layer.boxHeight : 8);
const getTextLayerMinHeight = (layer: TextLayer) => (Number.isFinite(layer.minBoxHeight) && layer.minBoxHeight > 0 ? layer.minBoxHeight : 8);
const getTextLayerBgOpacity = (layer: TextLayer) => (Number.isFinite(layer.opacity) ? clamp(Math.round(layer.opacity), 0, 100) : 100);
const getTextLayerBgOpacityA = (layer: TextLayer) =>
  (Number.isFinite(layer.bgOpacityA) ? clamp(Math.round(layer.bgOpacityA), 0, 100) : getTextLayerBgOpacity(layer));
const getTextLayerBgOpacityB = (layer: TextLayer) =>
  (Number.isFinite(layer.bgOpacityB) ? clamp(Math.round(layer.bgOpacityB), 0, 100) : getTextLayerBgOpacityA(layer));
const getTextLayerBgDirection = (layer: TextLayer): TextBgDirection => {
  const direction = layer.bgDirection;
  if (direction === 'to-right' || direction === 'to-bottom' || direction === 'to-bottom-left' || direction === 'to-bottom-right') {
    return direction;
  }
  return 'to-bottom-right';
};
const clampTextLineHeight = (value: number) => (Number.isFinite(value) ? clamp(value, 0.8, 2.5) : 1.24);
const getTextLayerLineHeight = (layer: TextLayer) => clampTextLineHeight(layer.lineHeight);
const getStickerLayerWidth = (layer: StickerLayer) =>
  (Number.isFinite(layer.boxWidth) && layer.boxWidth > 0 ? layer.boxWidth : 20);
const getStickerLayerHeight = (layer: StickerLayer) =>
  (Number.isFinite(layer.boxHeight) && layer.boxHeight > 0 ? layer.boxHeight : 20);
const getStickerLayerRotation = (layer: StickerLayer) => (Number.isFinite(layer.rotation) ? layer.rotation : 0);
const normalizeEditableText = (value: string) => value.replace(/\r/g, '').replace(/\u00a0/g, ' ').replace(/\n$/, '');
const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const plainTextToRichText = (value: string) => escapeHtml(value).replace(/\n/g, '<br>');
const normalizeEditableHtml = (value: string) => {
  const normalized = value
    .replace(/\r/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/<div><br><\/div>/gi, '<br>')
    .trim();
  if (!normalized || normalized === '<br>') return '';
  return normalized;
};
const getTextLayerRichText = (layer: TextLayer) => {
  const normalized = normalizeEditableHtml(layer.richText ?? '');
  if (normalized) return normalized;
  const fallback = plainTextToRichText(layer.text ?? '');
  return fallback || '<br>';
};
const textLineHeightOptions = [1, 1.1, 1.25, 1.5, 1.75, 2] as const;
const normalizeTextLineHeightOption = (value: number) => {
  const normalized = clampTextLineHeight(value);
  return textLineHeightOptions.reduce((closest, current) =>
    Math.abs(current - normalized) < Math.abs(closest - normalized) ? current : closest,
  textLineHeightOptions[0]);
};

const imageExt = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'svg', 'avif']);
const stickerExt = new Set(['png', 'jpg', 'jpeg']);

const getExt = (name: string) => {
  const match = name.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : '';
};

const getBase = (name: string) => name.replace(/\.[^.]+$/, '');

const getLeaf = (path: string) => path.split('/').pop() ?? path;

const isImageName = (name: string) => imageExt.has(getExt(name));

const isImageFile = (file: File) => file.type.startsWith('image/') || isImageName(file.name);
const isStickerFile = (file: File) => {
  const ext = getExt(file.name);
  if (stickerExt.has(ext)) return true;
  return file.type === 'image/png' || file.type === 'image/jpeg';
};

const isZipFile = (file: File) => file.name.toLowerCase().endsWith('.zip');

const mimeByExt: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  avif: 'image/avif',
};

const textFontOptions = ['Roboto', 'Arial', 'Verdana', 'Tahoma', 'Georgia', 'Times New Roman'];
const textBgModeOptions: ReadonlyArray<{ value: TextBgMode; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'solid', label: 'Solid' },
  { value: 'gradient', label: 'Gradient' },
];
const textBgDirectionOptions: ReadonlyArray<{ value: TextBgDirection; label: string }> = [
  { value: 'to-right', label: 'Left to right' },
  { value: 'to-bottom', label: 'Top to bottom' },
  { value: 'to-bottom-right', label: 'Diagonal down-right' },
  { value: 'to-bottom-left', label: 'Diagonal down-left' },
];

const formatSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const imageCache = new Map<string, Promise<HTMLImageElement>>();

const getDecodedImage = (src: string) => {
  const cached = imageCache.get(src);
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      imageCache.delete(src);
      reject(new Error('Image load failed'));
    };
    image.src = src;
  });
  imageCache.set(src, promise);
  return promise;
};

const loadImageMeta = (file: File) =>
  new Promise<{ width: number; height: number; url: string } | null>((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
        url,
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });

const convertBlobToPng = async (blob: Blob) => {
  if (blob.type === 'image/png') {
    return blob;
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas not supported');
    }
    ctx.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((nextBlob) => {
        if (!nextBlob) {
          reject(new Error('PNG conversion failed'));
          return;
        }
        resolve(nextBlob);
      }, 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
};

const drawRoundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
};

const parseHexRgb = (rawValue: string): { r: number; g: number; b: number } | null => {
  const raw = rawValue.trim().replace('#', '').toLowerCase();
  if (!raw) return null;
  const base = raw.length === 3 || raw.length === 4
    ? raw.slice(0, 3).split('').map((part) => `${part}${part}`).join('')
    : raw.length === 6 || raw.length === 8
      ? raw.slice(0, 6)
      : '';
  if (!/^[0-9a-f]{6}$/.test(base)) return null;
  return {
    r: Number.parseInt(base.slice(0, 2), 16),
    g: Number.parseInt(base.slice(2, 4), 16),
    b: Number.parseInt(base.slice(4, 6), 16),
  };
};

const normalizeHexColor = (value: string, fallback: string) => {
  const rgb = parseHexRgb(value) ?? parseHexRgb(fallback) ?? { r: 0, g: 0, b: 0 };
  const toHex = (part: number) => part.toString(16).padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
};

const rgbaFromHex = (value: string, opacity: number, fallback: string) => {
  const rgb = parseHexRgb(value) ?? parseHexRgb(fallback) ?? { r: 0, g: 0, b: 0 };
  const alpha = clamp(opacity, 0, 100) / 100;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
};

const getGradientCssDirection = (direction: TextBgDirection) => {
  switch (direction) {
    case 'to-right':
      return 'to right';
    case 'to-bottom':
      return 'to bottom';
    case 'to-bottom-left':
      return 'to bottom left';
    case 'to-bottom-right':
    default:
      return 'to bottom right';
  }
};

const getCanvasGradientLine = (
  direction: TextBgDirection,
  left: number,
  top: number,
  width: number,
  height: number,
) => {
  switch (direction) {
    case 'to-right':
      return { x0: left, y0: top + height / 2, x1: left + width, y1: top + height / 2 };
    case 'to-bottom':
      return { x0: left + width / 2, y0: top, x1: left + width / 2, y1: top + height };
    case 'to-bottom-left':
      return { x0: left + width, y0: top, x1: left, y1: top + height };
    case 'to-bottom-right':
    default:
      return { x0: left, y0: top, x1: left + width, y1: top + height };
  }
};

const wrapTextLines = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number) => {
  const rows: string[] = [];
  const hardLines = text.split(/\r?\n/);
  for (const hardLine of hardLines) {
    if (!hardLine.trim()) {
      rows.push('');
      continue;
    }
    const words = hardLine.split(/\s+/).filter(Boolean);
    let line = '';
    words.forEach((word) => {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !line) {
        line = candidate;
      } else {
        rows.push(line);
        line = word;
      }
    });
    rows.push(line);
  }
  return rows.length ? rows : [''];
};

const outputMime = (asset: EditorAsset) => {
  const source = asset.file.type.toLowerCase();
  if (source === 'image/jpeg' || source === 'image/webp' || source === 'image/png') return source;
  if (asset.extension === 'jpg' || asset.extension === 'jpeg') return 'image/jpeg';
  if (asset.extension === 'webp') return 'image/webp';
  return 'image/png';
};

export const CreativeEditor = () => {
  const [assets, setAssets] = useState<EditorAsset[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [stickers, setStickers] = useState<StickerAsset[]>([]);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [readyItems, setReadyItems] = useState<ReadyItem[]>([]);
  const [isWorking, setIsWorking] = useState(false);
  const [copiedReadyItemId, setCopiedReadyItemId] = useState<string | null>(null);

  const [textSize, setTextSize] = useState(56);
  const [textSizeInput, setTextSizeInput] = useState('56');
  const [textFont, setTextFont] = useState('Roboto');
  const [textAlign, setTextAlign] = useState<TextAlignMode>('center');
  const [textVerticalAlign, setTextVerticalAlign] = useState<TextVerticalAlignMode>('middle');
  const [textLineHeight, setTextLineHeight] = useState(1.25);
  const [textColor, setTextColor] = useState('#ffffff');
  const [textBold, setTextBold] = useState(true);
  const [textItalic, setTextItalic] = useState(false);
  const [textUnderline, setTextUnderline] = useState(false);
  const [textStrike, setTextStrike] = useState(false);
  const [textOpacity, setTextOpacity] = useState(100);
  const [textBgOpacityB, setTextBgOpacityB] = useState(100);
  const [textBgMode, setTextBgMode] = useState<TextBgMode>('none');
  const [textBgDirection, setTextBgDirection] = useState<TextBgDirection>('to-bottom-right');
  const [textBgA, setTextBgA] = useState('#000000');
  const [textBgB, setTextBgB] = useState('#0ea5e9');
  const [textPaddingX, setTextPaddingX] = useState(0);
  const [textPaddingY, setTextPaddingY] = useState(0);
  const [textRadius, setTextRadius] = useState(12);

  const [isDeckDropActive, setIsDeckDropActive] = useState(false);
  const [isGlobalFileDragActive, setIsGlobalFileDragActive] = useState(false);
  const [hoverPreview, setHoverPreview] = useState<{ url: string; x: number; y: number } | null>(null);
  const [overlayBounds, setOverlayBounds] = useState<DOMRect | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stickerInputRef = useRef<HTMLInputElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const colorControlRef = useRef<HTMLDivElement | null>(null);
  const bgOpacityControlRef = useRef<HTMLDivElement | null>(null);
  const bgOpacityBControlRef = useRef<HTMLDivElement | null>(null);
  const bgRadiusControlRef = useRef<HTMLDivElement | null>(null);
  const bgDirectionControlRef = useRef<HTMLDivElement | null>(null);
  const paddingXControlRef = useRef<HTMLDivElement | null>(null);
  const paddingYControlRef = useRef<HTMLDivElement | null>(null);
  const lineHeightControlRef = useRef<HTMLDivElement | null>(null);
  const bgModeControlRef = useRef<HTMLDivElement | null>(null);
  const fontControlRef = useRef<HTMLDivElement | null>(null);
  const textEditorRef = useRef<HTMLDivElement | null>(null);
  const textMeasureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const savedEditorRangeRef = useRef<Range | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const deckDragDepthRef = useRef(0);
  const globalFileDragDepthRef = useRef(0);
  const [isColorControlOpen, setIsColorControlOpen] = useState(false);
  const [isBgOpacityOpen, setIsBgOpacityOpen] = useState(false);
  const [isBgOpacityBOpen, setIsBgOpacityBOpen] = useState(false);
  const [isBgRadiusOpen, setIsBgRadiusOpen] = useState(false);
  const [isBgDirectionOpen, setIsBgDirectionOpen] = useState(false);
  const [isPaddingXOpen, setIsPaddingXOpen] = useState(false);
  const [isPaddingYOpen, setIsPaddingYOpen] = useState(false);
  const [isLineHeightOpen, setIsLineHeightOpen] = useState(false);
  const [isBgModeOpen, setIsBgModeOpen] = useState(false);
  const [isFontOpen, setIsFontOpen] = useState(false);

  const assetsRef = useRef<EditorAsset[]>([]);
  const stickersRef = useRef<StickerAsset[]>([]);
  const layersRef = useRef<Layer[]>([]);
  const readyItemsRef = useRef<ReadyItem[]>([]);
  const copiedReadyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  useEffect(() => {
    stickersRef.current = stickers;
  }, [stickers]);

  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  useEffect(() => {
    readyItemsRef.current = readyItems;
  }, [readyItems]);

  useEffect(() => {
    return () => {
      assetsRef.current.forEach((asset) => URL.revokeObjectURL(asset.previewUrl));
      stickersRef.current.forEach((sticker) => URL.revokeObjectURL(sticker.previewUrl));
      readyItemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      if (copiedReadyTimerRef.current) {
        window.clearTimeout(copiedReadyTimerRef.current);
        copiedReadyTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (colorControlRef.current?.contains(target)) return;
      if (bgOpacityControlRef.current?.contains(target)) return;
      if (bgOpacityBControlRef.current?.contains(target)) return;
      if (bgRadiusControlRef.current?.contains(target)) return;
      if (bgDirectionControlRef.current?.contains(target)) return;
      if (paddingXControlRef.current?.contains(target)) return;
      if (paddingYControlRef.current?.contains(target)) return;
      if (lineHeightControlRef.current?.contains(target)) return;
      if (bgModeControlRef.current?.contains(target)) return;
      if (fontControlRef.current?.contains(target)) return;
      setIsColorControlOpen(false);
      setIsBgOpacityOpen(false);
      setIsBgOpacityBOpen(false);
      setIsBgRadiusOpen(false);
      setIsBgDirectionOpen(false);
      setIsPaddingXOpen(false);
      setIsPaddingYOpen(false);
      setIsLineHeightOpen(false);
      setIsBgModeOpen(false);
      setIsFontOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, []);

  useEffect(() => {
    if (textBgMode === 'none') {
      setIsBgOpacityOpen(false);
      setIsBgOpacityBOpen(false);
      setIsBgRadiusOpen(false);
      setIsBgDirectionOpen(false);
      return;
    }
    if (textBgMode !== 'gradient') {
      setIsBgOpacityBOpen(false);
      setIsBgDirectionOpen(false);
    }
  }, [textBgMode]);

  useEffect(() => {
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
    const reset = () => {
      globalFileDragDepthRef.current = 0;
      setIsGlobalFileDragActive(false);
    };

    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      globalFileDragDepthRef.current += 1;
      setIsGlobalFileDragActive(true);
    };

    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      setIsGlobalFileDragActive(true);
    };

    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      globalFileDragDepthRef.current = Math.max(0, globalFileDragDepthRef.current - 1);
      if (globalFileDragDepthRef.current === 0) {
        setIsGlobalFileDragActive(false);
      }
    };

    const onDrop = () => {
      reset();
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', onDrop);
    window.addEventListener('blur', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', onDrop);
      window.removeEventListener('blur', onDrop);
    };
  }, []);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || typeof ResizeObserver === 'undefined') {
      setOverlayBounds(null);
      return;
    }

    const updateBounds = () => {
      setOverlayBounds(overlay.getBoundingClientRect());
    };

    updateBounds();
    const observer = new ResizeObserver(updateBounds);
    observer.observe(overlay);
    window.addEventListener('resize', updateBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateBounds);
    };
  }, [assets, currentIndex]);

  const currentAsset = assets[currentIndex] ?? null;
  const selectedLayer = layers.find((layer) => layer.id === selectedLayerId) ?? null;

  useEffect(() => {
    if (!selectedLayer || selectedLayer.type !== 'text') return;
    const isEditingSelectedText = document.activeElement === textEditorRef.current;
    setTextSize(selectedLayer.size);
    setTextSizeInput(String(selectedLayer.size));
    setTextFont(selectedLayer.fontFamily);
    setTextAlign(selectedLayer.align);
    setTextVerticalAlign(selectedLayer.verticalAlign ?? 'middle');
    const nextLineHeight = normalizeTextLineHeightOption(getTextLayerLineHeight(selectedLayer));
    setTextLineHeight(nextLineHeight);
    if (!isEditingSelectedText) {
      setTextColor(selectedLayer.color);
      setTextBold(selectedLayer.bold);
      setTextItalic(selectedLayer.italic);
      setTextUnderline(selectedLayer.underline);
      setTextStrike(selectedLayer.strike);
    }
    setTextOpacity(getTextLayerBgOpacityA(selectedLayer));
    setTextBgOpacityB(getTextLayerBgOpacityB(selectedLayer));
    setTextBgMode(selectedLayer.bgMode);
    setTextBgDirection(getTextLayerBgDirection(selectedLayer));
    setTextBgA(normalizeHexColor(selectedLayer.bgA, '#000000'));
    setTextBgB(normalizeHexColor(selectedLayer.bgB, '#0ea5e9'));
    const nextPaddingX = clamp(Math.round(selectedLayer.paddingX ?? selectedLayer.padding ?? 0), 0, 120);
    const nextPaddingY = clamp(Math.round(selectedLayer.paddingY ?? selectedLayer.padding ?? 0), 0, 120);
    setTextPaddingX(nextPaddingX);
    setTextPaddingY(nextPaddingY);
    setTextRadius(selectedLayer.radius);
  }, [selectedLayerId, selectedLayer]);

  useEffect(() => {
    if (!selectedLayer || selectedLayer.type !== 'text') return;
    const editor = textEditorRef.current;
    if (!editor) return;
    const nextRichText = getTextLayerRichText(selectedLayer);
    const currentText = normalizeEditableText(editor.innerText);
    const currentRichText = normalizeEditableHtml(editor.innerHTML);
    if (currentText !== selectedLayer.text || currentRichText !== nextRichText) {
      editor.innerHTML = nextRichText;
    }
  }, [selectedLayerId, selectedLayer]);

  useEffect(() => {
    if (!selectedLayer || selectedLayer.type !== 'text') return;
    const editor = textEditorRef.current;
    if (!editor || document.activeElement === editor) return;
    editor.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }, [selectedLayerId]);

  useEffect(() => {
    if (selectedLayer && selectedLayer.type === 'text') return;
    savedEditorRangeRef.current = null;
  }, [selectedLayerId, selectedLayer]);

  const handleUploadClick = () => fileInputRef.current?.click();
  const handleStickerUploadClick = () => stickerInputRef.current?.click();

  const isFileDragEvent = (event: ReactDragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files');

  const handleFilesAdded = async (list: FileList | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    if (!incoming.length) return;

    const directImages = incoming.filter((file) => !isZipFile(file) && isImageFile(file));
    const zipFiles = incoming.filter(isZipFile);
    const extracted: File[] = [];

    for (const zipFile of zipFiles) {
      try {
        const zip = await JSZip.loadAsync(zipFile);
        const entries = Object.values(zip.files);
        for (const entry of entries) {
          if (entry.dir) continue;
          if (entry.name.startsWith('__MACOSX/')) continue;
          if (!isImageName(entry.name)) continue;
          const blob = await entry.async('blob');
          const fileName = getLeaf(entry.name);
          const ext = getExt(fileName);
          const type = mimeByExt[ext] ?? blob.type ?? '';
          extracted.push(new File([blob], fileName, { type }));
        }
      } catch {
        // skip invalid archive
      }
    }

    const imageFiles = [...directImages, ...extracted];
    if (!imageFiles.length) return;

    const loaded = await Promise.all(imageFiles.map(async (file) => {
      const meta = await loadImageMeta(file);
      if (!meta) return null;
      return {
        id: `asset-${createId()}`,
        file,
        previewUrl: meta.url,
        nameBase: getBase(file.name),
        extension: getExt(file.name) || 'png',
        width: meta.width,
        height: meta.height,
      } satisfies EditorAsset;
    }));

    const nextAssets = loaded.filter((item): item is EditorAsset => item !== null);
    if (!nextAssets.length) return;
    setAssets((prev) => [...prev, ...nextAssets]);
  };

  const buildStickerLayer = (sticker: StickerAsset, index: number, asset: EditorAsset | null): StickerLayer => {
    const minWidth = 4;
    const minHeight = 4;
    let boxWidth = 22;
    let boxHeight = 22;
    if (asset) {
      const ratio = sticker.width > 0 && sticker.height > 0 ? sticker.height / sticker.width : 1;
      boxHeight = clamp(boxWidth * ratio * (asset.width / Math.max(1, asset.height)), minHeight, 60);
      if (boxHeight >= 60) {
        const reducedWidth = boxHeight > 0 ? boxWidth * (60 / boxHeight) : boxWidth;
        boxWidth = clamp(reducedWidth, minWidth, 60);
      }
    }
    const offset = (index % 6) * 2.5;
    const x = clamp((100 - boxWidth) / 2 + offset, 0, 100 - boxWidth);
    const y = clamp((100 - boxHeight) / 2 + offset, 0, 100 - boxHeight);
    return {
      id: `layer-${createId()}`,
      type: 'sticker',
      stickerId: sticker.id,
      x,
      y,
      boxWidth,
      boxHeight,
      opacity: 100,
      rotation: 0,
    };
  };

  const handleStickerFilesAdded = async (list: FileList | null) => {
    if (!list) return;
    const incoming = Array.from(list).filter(isStickerFile);
    if (!incoming.length) return;

    const loaded = await Promise.all(incoming.map(async (file) => {
      const meta = await loadImageMeta(file);
      if (!meta) return null;
      return {
        id: `sticker-${createId()}`,
        file,
        previewUrl: meta.url,
        width: meta.width,
        height: meta.height,
      } satisfies StickerAsset;
    }));

    const nextStickers = loaded.filter((item): item is StickerAsset => item !== null);
    if (!nextStickers.length) return;
    setStickers((prev) => [...prev, ...nextStickers]);

    const stickerLayers = nextStickers.map((sticker, index) => buildStickerLayer(sticker, index, currentAsset));
    if (stickerLayers.length) {
      setLayers((prev) => [...prev, ...stickerLayers]);
      setSelectedLayerId(stickerLayers[stickerLayers.length - 1]?.id ?? null);
    }
  };

  const handleClearAssets = () => {
    assets.forEach((asset) => URL.revokeObjectURL(asset.previewUrl));
    setAssets([]);
    setCurrentIndex(0);
  };

  const handleRemoveAsset = (assetId: string) => {
    setAssets((prev) => {
      const removeIndex = prev.findIndex((asset) => asset.id === assetId);
      if (removeIndex < 0) return prev;
      URL.revokeObjectURL(prev[removeIndex].previewUrl);
      const next = prev.filter((asset) => asset.id !== assetId);
      setCurrentIndex((index) => {
        if (!next.length) return 0;
        if (removeIndex < index) return index - 1;
        if (removeIndex === index) return Math.min(index, next.length - 1);
        return index;
      });
      return next;
    });
  };

  const handleStepAsset = (direction: -1 | 1) => {
    if (!assets.length) return;
    setCurrentIndex((prev) => clamp(prev + direction, 0, assets.length - 1));
  };

  const getTextMeasureContext = () => {
    if (!textMeasureCanvasRef.current) {
      textMeasureCanvasRef.current = document.createElement('canvas');
    }
    return textMeasureCanvasRef.current.getContext('2d');
  };

  const getTextLayerPaddingX = (layer: TextLayer) => clamp(Math.round(layer.paddingX ?? layer.padding ?? 0), 0, 120);
  const getTextLayerPaddingY = (layer: TextLayer) => clamp(Math.round(layer.paddingY ?? layer.padding ?? 0), 0, 120);
  const getTextLayerVerticalAlign = (layer: TextLayer): TextVerticalAlignMode => layer.verticalAlign ?? 'middle';
  const getTextLayerFont = (layer: TextLayer) =>
    `${layer.italic ? 'italic ' : ''}${layer.bold ? 700 : 500} ${clamp(layer.size, 1, 300)}px ${layer.fontFamily}, Roboto, 'Segoe UI', sans-serif`;

  const getTextLayerContentWidthPercent = (layer: TextLayer, bounds: DOMRect) => {
    if (bounds.width <= 0) return layer.boxWidth;
    const ctx = getTextMeasureContext();
    if (!ctx) return layer.boxWidth;
    const paddingX = getTextLayerPaddingX(layer);
    ctx.font = getTextLayerFont(layer);
    const hardLines = (layer.text || ' ').split(/\r?\n/);
    const widestLine = hardLines.reduce((max, line) => Math.max(max, ctx.measureText(line || ' ').width), 0);
    const contentWidthPx = Math.max(10, widestLine + paddingX * 2);
    return (contentWidthPx / bounds.width) * 100;
  };

  const getTextLayerContentHeightPercent = (layer: TextLayer, bounds: DOMRect) => {
    if (bounds.width <= 0 || bounds.height <= 0) return getTextLayerHeight(layer);
    const ctx = getTextMeasureContext();
    if (!ctx) return getTextLayerHeight(layer);
    const paddingX = getTextLayerPaddingX(layer);
    const paddingY = getTextLayerPaddingY(layer);
    const boxWidthPx = Math.max(10, (layer.boxWidth / 100) * bounds.width);
    const maxTextWidth = Math.max(12, boxWidthPx - paddingX * 2);
    const fontSize = clamp(layer.size, 1, 300);
    ctx.font = getTextLayerFont(layer);
    const lines = wrapTextLines(ctx, layer.text || ' ', maxTextWidth);
    const lineHeight = fontSize * getTextLayerLineHeight(layer);
    const contentHeightPx = Math.max(lineHeight + paddingY * 2, lines.length * lineHeight + paddingY * 2);
    return (contentHeightPx / bounds.height) * 100;
  };

  const fitTextLayerToContent = (layer: TextLayer, bounds: DOMRect, minHeightOverride?: number): TextLayer => {
    const requiredWidth = clamp(getTextLayerContentWidthPercent(layer, bounds), 10, 100);
    let boxWidth = clamp(Math.max(layer.boxWidth, requiredWidth), 10, 100);
    let x = clamp(layer.x, 0, 100);
    if (x + boxWidth > 100) {
      x = clamp(100 - boxWidth, 0, 100);
    }

    let y = clamp(layer.y, 0, 100);
    const sizedLayer = { ...layer, x, y, boxWidth };
    const minBoxHeight = clamp(minHeightOverride ?? getTextLayerMinHeight(layer), 8, 100);
    const requiredHeight = clamp(getTextLayerContentHeightPercent(sizedLayer, bounds), 8, 100);
    const boxHeight = clamp(Math.max(minBoxHeight, requiredHeight), 8, 100);
    if (y + boxHeight > 100) {
      y = clamp(100 - boxHeight, 0, 100);
    }

    return {
      ...sizedLayer,
      y,
      minBoxHeight,
      boxHeight,
    };
  };

  const getTextLayerVerticalInsetsPx = (layer: TextLayer, bounds: DOMRect | null) => {
    if (!bounds || bounds.height <= 0) {
      return { top: 0, bottom: 0 };
    }
    const boxHeightPx = Math.max(1, (getTextLayerHeight(layer) / 100) * bounds.height);
    const contentHeightPx = Math.max(1, (getTextLayerContentHeightPercent(layer, bounds) / 100) * bounds.height);
    const available = Math.max(0, boxHeightPx - contentHeightPx);
    const verticalAlign = getTextLayerVerticalAlign(layer);
    if (verticalAlign === 'top') {
      return { top: 0, bottom: available };
    }
    if (verticalAlign === 'bottom') {
      return { top: available, bottom: 0 };
    }
    return { top: available / 2, bottom: available / 2 };
  };

  const buildTextLayer = (text: string): TextLayer => ({
    id: `layer-${createId()}`,
    type: 'text',
    text,
    richText: plainTextToRichText(text),
    x: 8,
    y: 8,
    boxWidth: 10,
    boxHeight: 8,
    minBoxHeight: 8,
    size: clamp(Math.round(textSize), 1, 300),
    fontFamily: textFont,
    align: textAlign,
    verticalAlign: textVerticalAlign,
    lineHeight: normalizeTextLineHeightOption(textLineHeight),
    color: textColor,
    bold: textBold,
    italic: textItalic,
    underline: textUnderline,
    strike: textStrike,
    opacity: clamp(Math.round(textOpacity), 0, 100),
    bgMode: textBgMode,
    bgDirection: textBgDirection,
    bgA: normalizeHexColor(textBgA, '#000000'),
    bgB: normalizeHexColor(textBgB, '#0ea5e9'),
    bgOpacityA: clamp(Math.round(textOpacity), 0, 100),
    bgOpacityB: clamp(Math.round(textBgOpacityB), 0, 100),
    paddingX: clamp(Math.round(textPaddingX), 0, 120),
    paddingY: clamp(Math.round(textPaddingY), 0, 120),
    padding: clamp(Math.round(textPaddingY), 0, 120),
    radius: clamp(Math.round(textRadius), 0, 80),
  });

  const addTextLayer = () => {
    const text = 'Type text';
    const baseLayer = buildTextLayer(text);
    const bounds = overlayRef.current?.getBoundingClientRect();
    const next = bounds ? fitTextLayerToContent(baseLayer, bounds) : baseLayer;
    setLayers((prev) => [...prev, next]);
    setSelectedLayerId(next.id);
  };

  const updateSelected = (updater: (layer: Layer) => Layer) => {
    if (!selectedLayerId) return;
    setLayers((prev) => prev.map((layer) => (layer.id === selectedLayerId ? updater(layer) : layer)));
  };

  const updateSelectedTextLayer = (patch: Partial<TextLayer>) => {
    if (!selectedLayer || selectedLayer.type !== 'text') return;
    const bounds = overlayRef.current?.getBoundingClientRect();
    updateSelected((layer) => {
      if (layer.type !== 'text') return layer;
      const nextLayer: TextLayer = { ...layer, ...patch };
      if (!bounds) return nextLayer;
      return fitTextLayerToContent(nextLayer, bounds);
    });
  };

  const applyTextSize = (rawValue: number) => {
    const size = clamp(Math.round(rawValue), 1, 300);
    setTextSize(size);
    setTextSizeInput(String(size));
    updateSelectedTextLayer({ size });
  };

  const handleTextSizeInputChange = (rawValue: string) => {
    setTextSizeInput(rawValue);
    if (!rawValue.trim()) return;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;
    const size = clamp(Math.round(parsed), 1, 300);
    setTextSize(size);
    updateSelectedTextLayer({ size });
  };

  const commitTextSizeInput = () => {
    if (!textSizeInput.trim()) {
      setTextSizeInput(String(textSize));
      return;
    }
    const parsed = Number(textSizeInput);
    if (!Number.isFinite(parsed)) {
      setTextSizeInput(String(textSize));
      return;
    }
    applyTextSize(parsed);
  };

  const applyTextLineHeight = (rawValue: number) => {
    const lineHeight = normalizeTextLineHeightOption(rawValue);
    setTextLineHeight(lineHeight);
    updateSelectedTextLayer({ lineHeight });
  };

  const applyTextPaddingX = (rawValue: number) => {
    const paddingX = clamp(Math.round(rawValue), 0, 120);
    setTextPaddingX(paddingX);
    updateSelectedTextLayer({ paddingX });
  };

  const applyTextPaddingY = (rawValue: number) => {
    const paddingY = clamp(Math.round(rawValue), 0, 120);
    setTextPaddingY(paddingY);
    updateSelectedTextLayer({ paddingY });
  };

  const applyTextOpacity = (rawValue: number) => {
    const opacity = clamp(Math.round(rawValue), 0, 100);
    setTextOpacity(opacity);
    updateSelectedTextLayer({ opacity, bgOpacityA: opacity });
  };

  const applyTextOpacityB = (rawValue: number) => {
    const opacity = clamp(Math.round(rawValue), 0, 100);
    setTextBgOpacityB(opacity);
    updateSelectedTextLayer({ bgOpacityB: opacity });
  };

  const applyTextBgDirection = (direction: TextBgDirection) => {
    setTextBgDirection(direction);
    updateSelectedTextLayer({ bgDirection: direction });
  };

  const applyTextRadius = (rawValue: number) => {
    const radius = clamp(Math.round(rawValue), 0, 80);
    setTextRadius(radius);
    updateSelectedTextLayer({ radius });
  };

  const isSelectionInsideEditor = () => {
    const editor = textEditorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount < 1) return false;
    const range = selection.getRangeAt(0);
    return editor.contains(range.commonAncestorContainer);
  };

  const hasExpandedSelectionInsideEditor = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount < 1 || selection.isCollapsed) return false;
    return isSelectionInsideEditor();
  };

  const storeEditorSelectionRange = () => {
    const editor = textEditorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount < 1 || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    savedEditorRangeRef.current = range.cloneRange();
  };

  const restoreEditorSelectionRange = () => {
    const editor = textEditorRef.current;
    const selection = window.getSelection();
    const savedRange = savedEditorRangeRef.current;
    if (!editor || !selection || !savedRange) return false;
    if (!editor.contains(savedRange.commonAncestorContainer)) return false;
    try {
      selection.removeAllRanges();
      selection.addRange(savedRange);
      return true;
    } catch {
      return false;
    }
  };

  const syncToolbarStyleFromEditorSelection = () => {
    if (!selectedLayer || selectedLayer.type !== 'text') return;
    if (!isSelectionInsideEditor()) {
      setTextBold(selectedLayer.bold);
      setTextItalic(selectedLayer.italic);
      setTextUnderline(selectedLayer.underline);
      setTextStrike(selectedLayer.strike);
      return;
    }
    storeEditorSelectionRange();
    setTextBold(document.queryCommandState('bold'));
    setTextItalic(document.queryCommandState('italic'));
    setTextUnderline(document.queryCommandState('underline'));
    setTextStrike(document.queryCommandState('strikeThrough'));
  };

  const executeInlineTextCommand = (command: string, value?: string) => {
    if (!selectedLayer || selectedLayer.type !== 'text') return false;
    const editor = textEditorRef.current;
    if (!editor) return false;
    if (!hasExpandedSelectionInsideEditor()) {
      restoreEditorSelectionRange();
    }
    if (!hasExpandedSelectionInsideEditor()) return false;
    editor.focus();
    document.execCommand('styleWithCSS', false, 'true');
    const applied = document.execCommand(command, false, value);
    if (!applied) return false;
    const nextText = normalizeEditableText(editor.innerText);
    const nextRichText = normalizeEditableHtml(editor.innerHTML);
    handleTextLayerInput(selectedLayer.id, nextText, nextRichText);
    syncToolbarStyleFromEditorSelection();
    return true;
  };

  const preserveEditorSelectionOnToolbarPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!hasExpandedSelectionInsideEditor()) return;
    event.preventDefault();
  };

  const handleTextLayerInput = (layerId: string, value: string, richText?: string) => {
    const bounds = overlayRef.current?.getBoundingClientRect();
    const normalizedRichText = normalizeEditableHtml(richText ?? '');
    setLayers((prev) =>
      prev.map((layer) => {
        if (layer.id !== layerId || layer.type !== 'text') return layer;
        const nextLayer: TextLayer = {
          ...layer,
          text: value,
          richText: normalizedRichText || plainTextToRichText(value),
        };
        if (!bounds) return nextLayer;
        return fitTextLayerToContent(nextLayer, bounds);
      }),
    );
  };

  useEffect(() => {
    if (!selectedLayer || selectedLayer.type !== 'text') return;
    const onSelectionChange = () => {
      const editor = textEditorRef.current;
      if (!editor || document.activeElement !== editor) return;
      syncToolbarStyleFromEditorSelection();
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [selectedLayerId, selectedLayer]);

  const layerPointerDown = (
    event: ReactPointerEvent<HTMLElement>,
    layerId: string,
    mode: 'move' | 'resize' | 'rotate' = 'move',
    resizeHandle: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 'e' | 's' | 'w' = 'se',
  ) => {
    if (!overlayRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const target = layers.find((layer) => layer.id === layerId);
    if (!target) return;
    const bounds = overlayRef.current.getBoundingClientRect();
    const startWidth = target.type === 'text' ? target.boxWidth : getStickerLayerWidth(target);
    const startHeight = target.type === 'text' ? getTextLayerHeight(target) : getStickerLayerHeight(target);
    let startRotation: number | undefined;
    let startPointerAngle: number | undefined;
    if (mode === 'rotate' && target.type === 'sticker') {
      const centerX = bounds.left + ((target.x + startWidth / 2) / 100) * bounds.width;
      const centerY = bounds.top + ((target.y + startHeight / 2) / 100) * bounds.height;
      startRotation = getStickerLayerRotation(target);
      startPointerAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
    }

    dragRef.current = {
      layerId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: target.x,
      startY: target.y,
      startWidth,
      startHeight,
      startRotation,
      startPointerAngle,
      mode,
      resizeHandle,
      bounds,
    };
    setSelectedLayerId(layerId);
  };

  const isPointerOnTextContent = (
    event: ReactPointerEvent<HTMLElement>,
    layer: TextLayer,
  ) => {
    const target = event.currentTarget;
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return true;
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const paddingX = getTextLayerPaddingX(layer);
    const paddingY = getTextLayerPaddingY(layer);
    const fontSize = clamp(layer.size, 1, 300);
    const lineHeight = fontSize * getTextLayerLineHeight(layer);
    const contentMaxWidth = Math.max(12, rect.width - paddingX * 2);
    const ctx = getTextMeasureContext();
    if (!ctx) return true;
    ctx.font = getTextLayerFont(layer);
    const lines = wrapTextLines(ctx, layer.text || ' ', contentMaxWidth);
    const maxTextHeight = Math.max(lineHeight, rect.height - paddingY * 2);
    const maxLines = Math.max(1, Math.floor(maxTextHeight / lineHeight));
    const visibleLines = lines.slice(0, maxLines);
    const textBlockHeight = visibleLines.length * lineHeight;
    const totalContentHeight = Math.max(lineHeight + paddingY * 2, textBlockHeight + paddingY * 2);
    const verticalExtra = Math.max(0, rect.height - totalContentHeight);
    const verticalAlign = getTextLayerVerticalAlign(layer);
    const verticalOffset = verticalAlign === 'top' ? 0 : verticalAlign === 'bottom' ? verticalExtra : verticalExtra / 2;
    const textTop = verticalOffset + paddingY;
    const toleranceX = Math.max(2, fontSize * 0.06);
    const toleranceY = Math.max(2, fontSize * 0.08);

    return visibleLines.some((line, index) => {
      const lineTop = textTop + lineHeight * index;
      const lineBottom = lineTop + lineHeight;
      if (localY < lineTop - toleranceY || localY > lineBottom + toleranceY) {
        return false;
      }
      const words = line.trim().split(/\s+/).filter(Boolean);
      const canJustify = layer.align === 'justify' && index < visibleLines.length - 1 && words.length > 1;
      const lineWidth = canJustify ? contentMaxWidth : ctx.measureText(line || ' ').width;
      const lineStartX = canJustify || layer.align === 'left' || layer.align === 'justify'
        ? paddingX
        : layer.align === 'right'
          ? rect.width - paddingX - lineWidth
          : rect.width / 2 - lineWidth / 2;
      const lineEndX = lineStartX + lineWidth;
      return localX >= lineStartX - toleranceX && localX <= lineEndX + toleranceX;
    });
  };

  const handleTextEditorPointerDown = (event: ReactPointerEvent<HTMLElement>, layer: TextLayer) => {
    if (!isPointerOnTextContent(event, layer)) {
      layerPointerDown(event, layer.id, 'move');
      return;
    }
    event.stopPropagation();
  };

  const handleTextEditorPointerMove = (event: ReactPointerEvent<HTMLElement>, layer: TextLayer) => {
    event.currentTarget.style.cursor = isPointerOnTextContent(event, layer) ? 'text' : 'move';
  };

  const handleTextEditorPointerLeave = (event: ReactPointerEvent<HTMLElement>) => {
    event.currentTarget.style.cursor = 'text';
  };

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.startClientX;
      const dy = event.clientY - drag.startClientY;
      setLayers((prev) =>
        prev.map((layer) => {
          if (layer.id !== drag.layerId) return layer;
          if (layer.type === 'text') {
            const currentHeight = getTextLayerHeight(layer);
            if (drag.mode === 'resize') {
              const deltaX = (dx / drag.bounds.width) * 100;
              const deltaY = (dy / drag.bounds.height) * 100;
              const minWidth = 10;
              const minHeight = 8;
              const startLeft = drag.startX;
              const startTop = drag.startY;
              const startRight = startLeft + (drag.startWidth ?? layer.boxWidth);
              const startBottom = startTop + (drag.startHeight ?? currentHeight);
              const handle = drag.resizeHandle ?? 'se';

              let nextLeft = startLeft;
              let nextTop = startTop;
              let nextRight = startRight;
              let nextBottom = startBottom;

              if (handle.includes('w')) nextLeft += deltaX;
              if (handle.includes('e')) nextRight += deltaX;
              if (handle.includes('n')) nextTop += deltaY;
              if (handle.includes('s')) nextBottom += deltaY;

              nextLeft = clamp(nextLeft, 0, 100 - minWidth);
              nextTop = clamp(nextTop, 0, 100 - minHeight);
              nextRight = clamp(nextRight, nextLeft + minWidth, 100);
              nextBottom = clamp(nextBottom, nextTop + minHeight, 100);

              const resizedLayer: TextLayer = {
                ...layer,
                x: nextLeft,
                y: nextTop,
                boxWidth: nextRight - nextLeft,
                boxHeight: nextBottom - nextTop,
                minBoxHeight: nextBottom - nextTop,
              };
              return fitTextLayerToContent(resizedLayer, drag.bounds, resizedLayer.minBoxHeight);
            }
            const nextX = clamp(drag.startX + (dx / drag.bounds.width) * 100, 0, 100 - layer.boxWidth);
            const nextY = clamp(drag.startY + (dy / drag.bounds.height) * 100, 0, 100 - currentHeight);
            return { ...layer, x: nextX, y: nextY };
          }
          if (drag.mode === 'rotate') {
            const startPointerAngle = drag.startPointerAngle;
            const startRotation = drag.startRotation;
            if (startPointerAngle === undefined || startRotation === undefined) {
              return layer;
            }
            const startWidth = Math.max(1, drag.startWidth ?? getStickerLayerWidth(layer));
            const startHeight = Math.max(1, drag.startHeight ?? getStickerLayerHeight(layer));
            const centerX = drag.bounds.left + ((drag.startX + startWidth / 2) / 100) * drag.bounds.width;
            const centerY = drag.bounds.top + ((drag.startY + startHeight / 2) / 100) * drag.bounds.height;
            const pointerAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
            const deltaAngle = pointerAngle - startPointerAngle;
            const rotation = startRotation + (deltaAngle * 180) / Math.PI;
            return {
              ...layer,
              rotation,
            };
          }

          if (drag.mode === 'resize') {
            const handle = drag.resizeHandle ?? 'se';
            if (!['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].includes(handle)) {
              return layer;
            }

            const deltaX = (dx / drag.bounds.width) * 100;
            const deltaY = (dy / drag.bounds.height) * 100;
            const currentWidth = getStickerLayerWidth(layer);
            const currentHeight = getStickerLayerHeight(layer);
            const startWidth = Math.max(1, drag.startWidth ?? currentWidth);
            const startHeight = Math.max(1, drag.startHeight ?? currentHeight);
            const minWidth = 4;
            const minHeight = 4;
            const startLeft = drag.startX;
            const startTop = drag.startY;
            const startRight = startLeft + startWidth;
            const startBottom = startTop + startHeight;
            const startCenterX = startLeft + startWidth / 2;
            const startCenterY = startTop + startHeight / 2;
            const fromWest = handle.includes('w');
            const fromEast = handle.includes('e');
            const fromNorth = handle.includes('n');
            const fromSouth = handle.includes('s');
            let nextLeft = startLeft;
            let nextTop = startTop;
            let nextRight = startRight;
            let nextBottom = startBottom;

            if (fromWest) nextLeft += deltaX;
            if (fromEast) nextRight += deltaX;
            if (fromNorth) nextTop += deltaY;
            if (fromSouth) nextBottom += deltaY;

            if (event.shiftKey) {
              const rawWidth = clamp(nextRight - nextLeft, minWidth, 100);
              const rawHeight = clamp(nextBottom - nextTop, minHeight, 100);
              const scaleX = rawWidth / startWidth;
              const scaleY = rawHeight / startHeight;
              const isHorizontalOnly = (fromWest || fromEast) && !fromNorth && !fromSouth;
              const isVerticalOnly = (fromNorth || fromSouth) && !fromWest && !fromEast;
              let targetScale = isHorizontalOnly
                ? scaleX
                : isVerticalOnly
                  ? scaleY
                  : Math.abs(scaleX - 1) >= Math.abs(scaleY - 1)
                    ? scaleX
                    : scaleY;

              const maxWidthByBounds = fromWest && !fromEast
                ? startRight
                : fromEast && !fromWest
                  ? 100 - startLeft
                  : Math.min(startCenterX, 100 - startCenterX) * 2;
              const maxHeightByBounds = fromNorth && !fromSouth
                ? startBottom
                : fromSouth && !fromNorth
                  ? 100 - startTop
                  : Math.min(startCenterY, 100 - startCenterY) * 2;
              const minScale = Math.max(minWidth / startWidth, minHeight / startHeight);
              const maxScale = Math.max(
                minScale,
                Math.min(
                  Math.max(minWidth, maxWidthByBounds) / startWidth,
                  Math.max(minHeight, maxHeightByBounds) / startHeight,
                ),
              );
              targetScale = clamp(targetScale, minScale, maxScale);
              const targetWidth = clamp(startWidth * targetScale, minWidth, 100);
              const targetHeight = clamp(startHeight * targetScale, minHeight, 100);

              if (fromWest && !fromEast) {
                nextRight = startRight;
                nextLeft = nextRight - targetWidth;
              } else if (fromEast && !fromWest) {
                nextLeft = startLeft;
                nextRight = nextLeft + targetWidth;
              } else {
                nextLeft = startCenterX - targetWidth / 2;
                nextRight = nextLeft + targetWidth;
              }

              if (fromNorth && !fromSouth) {
                nextBottom = startBottom;
                nextTop = nextBottom - targetHeight;
              } else if (fromSouth && !fromNorth) {
                nextTop = startTop;
                nextBottom = nextTop + targetHeight;
              } else {
                nextTop = startCenterY - targetHeight / 2;
                nextBottom = nextTop + targetHeight;
              }
            }

            nextLeft = clamp(nextLeft, 0, 100 - minWidth);
            nextTop = clamp(nextTop, 0, 100 - minHeight);
            nextRight = clamp(nextRight, nextLeft + minWidth, 100);
            nextBottom = clamp(nextBottom, nextTop + minHeight, 100);

            return {
              ...layer,
              x: nextLeft,
              y: nextTop,
              boxWidth: nextRight - nextLeft,
              boxHeight: nextBottom - nextTop,
            };
          }

          const currentWidth = getStickerLayerWidth(layer);
          const currentHeight = getStickerLayerHeight(layer);
          const nextX = clamp(drag.startX + (dx / drag.bounds.width) * 100, 0, 100 - currentWidth);
          const nextY = clamp(drag.startY + (dy / drag.bounds.height) * 100, 0, 100 - currentHeight);
          return { ...layer, x: nextX, y: nextY };
        }),
      );
    };

    const onEnd = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      dragRef.current = null;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
  }, []);

  const renderRichTextToCanvas = async (
    ctx: CanvasRenderingContext2D,
    layer: TextLayer,
    x: number,
    y: number,
    width: number,
    height: number,
    fontSize: number,
    fontWeight: number,
    fontStyle: 'italic' | 'normal',
  ) => {
    const renderWidth = Math.max(1, Math.ceil(width));
    const renderHeight = Math.max(1, Math.ceil(height));
    const richText = getTextLayerRichText(layer);
    const fontFamily = layer.fontFamily.replace(/"/g, '');
    const decoration = textDecorationFromFlags(layer.underline, layer.strike);
    const alignCss = layer.align === 'justify' ? 'justify' : layer.align;
    const style = [
      'margin:0',
      'padding:0',
      `width:${renderWidth}px`,
      `min-height:${renderHeight}px`,
      `font-family:"${fontFamily}", Roboto, "Segoe UI", sans-serif`,
      `font-size:${fontSize}px`,
      `line-height:${getTextLayerLineHeight(layer)}`,
      `font-weight:${fontWeight}`,
      `font-style:${fontStyle}`,
      `text-decoration:${decoration}`,
      `text-align:${alignCss}`,
      `color:${layer.color}`,
      'white-space:pre-wrap',
      'overflow-wrap:anywhere',
      'word-break:break-word',
    ].join(';');
    const svgMarkup =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${renderWidth}" height="${renderHeight}" viewBox="0 0 ${renderWidth} ${renderHeight}">` +
      `<foreignObject x="0" y="0" width="${renderWidth}" height="${renderHeight}">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" style='${style}'>${richText}</div>` +
      '</foreignObject>' +
      '</svg>';
    const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Rich text render failed.'));
        img.src = svgUrl;
      });
      ctx.drawImage(image, x, y, renderWidth, renderHeight);
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  };

  const renderOne = async (asset: EditorAsset, layerList: Layer[], useRichTextExport = true) => {
    const base = await getDecodedImage(asset.previewUrl);
    const canvas = document.createElement('canvas');
    canvas.width = asset.width;
    canvas.height = asset.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported.');

    ctx.drawImage(base, 0, 0, asset.width, asset.height);

    const textRenderScale = (() => {
      if (!overlayBounds || overlayBounds.width <= 0 || overlayBounds.height <= 0) {
        return 1;
      }
      if (!currentAsset) {
        return asset.width / overlayBounds.width;
      }
      if (asset.id === currentAsset.id) {
        const scaleX = asset.width / overlayBounds.width;
        const scaleY = asset.height / overlayBounds.height;
        return (scaleX + scaleY) / 2;
      }
      return currentAsset.width / overlayBounds.width;
    })();

    for (const layer of layerList) {
      if (layer.type === 'text') {
        const x = (layer.x / 100) * asset.width;
        const y = (layer.y / 100) * asset.height;
        const boxWidth = Math.max(10, (layer.boxWidth / 100) * asset.width);
        const boxHeight = Math.max(10, (getTextLayerHeight(layer) / 100) * asset.height);
        const paddingX = getTextLayerPaddingX(layer) * textRenderScale;
        const paddingY = getTextLayerPaddingY(layer) * textRenderScale;
        const fontSize = clamp(layer.size * textRenderScale, 1, 3000);
        const lineHeight = fontSize * getTextLayerLineHeight(layer);
        const fontWeight = layer.bold ? 700 : 500;
        const fontStyle = layer.italic ? 'italic' : 'normal';
        const contentMaxWidth = Math.max(12, boxWidth - paddingX * 2);

        ctx.save();
        ctx.font = `${fontStyle === 'italic' ? 'italic ' : ''}${fontWeight} ${fontSize}px ${layer.fontFamily}, Roboto, 'Segoe UI', sans-serif`;
        const alignForCanvas = layer.align === 'justify' ? 'left' : layer.align;
        ctx.textAlign = alignForCanvas;
        ctx.textBaseline = 'top';
        const lines = wrapTextLines(ctx, layer.text || ' ', contentMaxWidth);
        const maxTextHeight = Math.max(lineHeight, boxHeight - paddingY * 2);
        const maxLines = Math.max(1, Math.floor(maxTextHeight / lineHeight));
        const visibleLines = lines.slice(0, maxLines);
        const textBlockHeight = visibleLines.length * lineHeight;
        const totalContentHeight = Math.max(lineHeight + paddingY * 2, textBlockHeight + paddingY * 2);
        const verticalExtra = Math.max(0, boxHeight - totalContentHeight);
        const verticalAlign = getTextLayerVerticalAlign(layer);
        const verticalOffset = verticalAlign === 'top' ? 0 : verticalAlign === 'bottom' ? verticalExtra : verticalExtra / 2;

        if (layer.bgMode !== 'none') {
          const left = x;
          const top = y;
          const bgColorA = rgbaFromHex(layer.bgA, getTextLayerBgOpacityA(layer), '#000000');
          const bgColorB = rgbaFromHex(layer.bgB, getTextLayerBgOpacityB(layer), '#0ea5e9');
          if (layer.bgMode === 'gradient') {
            const line = getCanvasGradientLine(getTextLayerBgDirection(layer), left, top, boxWidth, boxHeight);
            const gradient = ctx.createLinearGradient(line.x0, line.y0, line.x1, line.y1);
            gradient.addColorStop(0, bgColorA);
            gradient.addColorStop(1, bgColorB);
            ctx.fillStyle = gradient;
          } else {
            ctx.fillStyle = bgColorA;
          }
          drawRoundRect(ctx, left, top, boxWidth, boxHeight, layer.radius * textRenderScale);
          ctx.fill();
        }

        const richTextMarkup = normalizeEditableHtml(layer.richText ?? '');
        const hasInlineRichStyles = /<(span|font|b|strong|i|em|u|s|strike)\b/i.test(richTextMarkup);
        if (useRichTextExport && hasInlineRichStyles) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, boxWidth, boxHeight);
          ctx.clip();
          await renderRichTextToCanvas(
            ctx,
            layer,
            x + paddingX,
            y + verticalOffset + paddingY,
            contentMaxWidth,
            maxTextHeight,
            fontSize,
            fontWeight,
            fontStyle,
          );
          ctx.restore();
          ctx.restore();
          continue;
        }

        ctx.fillStyle = layer.color;
        const anchorX = alignForCanvas === 'left'
          ? x + paddingX
          : alignForCanvas === 'right'
            ? x + boxWidth - paddingX
            : x + boxWidth / 2;
        if (layer.underline || layer.strike) {
          ctx.strokeStyle = layer.color;
          ctx.lineWidth = Math.max(1, fontSize * 0.06);
        }
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, boxWidth, boxHeight);
        ctx.clip();
        visibleLines.forEach((line, index) => {
          const lineY = y + verticalOffset + paddingY + lineHeight * index;
          let lineStartX = anchorX;
          let lineWidth = ctx.measureText(line || ' ').width;
          const words = line.trim().split(/\s+/).filter(Boolean);
          const canJustify = layer.align === 'justify' && index < visibleLines.length - 1 && words.length > 1;

          if (canJustify) {
            const wordMetrics = words.map((word) => ctx.measureText(word).width);
            const wordsWidth = wordMetrics.reduce((sum, width) => sum + width, 0);
            const naturalSpace = ctx.measureText(' ').width;
            const gaps = words.length - 1;
            const totalNatural = wordsWidth + naturalSpace * gaps;
            const extraSpace = Math.max(0, contentMaxWidth - totalNatural);
            const gapWidth = naturalSpace + extraSpace / gaps;
            let cursorX = x + paddingX;
            lineStartX = cursorX;
            lineWidth = contentMaxWidth;
            words.forEach((word, wordIndex) => {
              ctx.fillText(word, cursorX, lineY);
              if (wordIndex < gaps) {
                cursorX += wordMetrics[wordIndex] + gapWidth;
              }
            });
          } else {
            ctx.fillText(line, anchorX, lineY);
            lineStartX = alignForCanvas === 'left'
              ? anchorX
              : alignForCanvas === 'right'
                ? anchorX - lineWidth
                : anchorX - lineWidth / 2;
          }

          if (layer.underline) {
            const underlineY = lineY + fontSize * 1.02;
            ctx.beginPath();
            ctx.moveTo(lineStartX, underlineY);
            ctx.lineTo(lineStartX + lineWidth, underlineY);
            ctx.stroke();
          }
          if (layer.strike) {
            const strikeY = lineY + fontSize * 0.58;
            ctx.beginPath();
            ctx.moveTo(lineStartX, strikeY);
            ctx.lineTo(lineStartX + lineWidth, strikeY);
            ctx.stroke();
          }
        });
        ctx.restore();
        ctx.restore();
        continue;
      }

      const sticker = stickersRef.current.find((item) => item.id === layer.stickerId);
      if (!sticker) continue;
      const stickerImage = await getDecodedImage(sticker.previewUrl);
      const drawX = (layer.x / 100) * asset.width;
      const drawY = (layer.y / 100) * asset.height;
      const drawWidth = Math.max(4, (getStickerLayerWidth(layer) / 100) * asset.width);
      const drawHeight = Math.max(4, (getStickerLayerHeight(layer) / 100) * asset.height);
      const rotationRadians = (getStickerLayerRotation(layer) * Math.PI) / 180;

      ctx.save();
      ctx.globalAlpha = clamp(layer.opacity / 100, 0.01, 1);
      if (Math.abs(rotationRadians) > 0.0001) {
        ctx.translate(drawX + drawWidth / 2, drawY + drawHeight / 2);
        ctx.rotate(rotationRadians);
        ctx.drawImage(stickerImage, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      } else {
        ctx.drawImage(stickerImage, drawX, drawY, drawWidth, drawHeight);
      }
      ctx.restore();
    }

    const mime = outputMime(asset);
    const quality = mime === 'image/jpeg' || mime === 'image/webp' ? 0.92 : undefined;

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (!result) {
          reject(new Error('Render failed.'));
          return;
        }
        resolve(result);
      }, mime, quality);
    });

    const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
    return { blob, width: canvas.width, height: canvas.height, ext };
  };

  const renderOneSafe = async (asset: EditorAsset, layerList: Layer[]) => {
    try {
      return await renderOne(asset, layerList, true);
    } catch {
      return renderOne(asset, layerList, false);
    }
  };

  const renderCurrent = async () => {
    if (!currentAsset || isWorking) return;
    setIsWorking(true);
    try {
      const out = await renderOneSafe(currentAsset, layersRef.current);
      const name = `${currentAsset.nameBase}-edited.${out.ext}`;
      const previewUrl = URL.createObjectURL(out.blob);
      setReadyItems((prev) => [...prev, {
        id: `ready-${createId()}`,
        name,
        blob: out.blob,
        previewUrl,
        width: out.width,
        height: out.height,
      }]);
    } finally {
      setIsWorking(false);
    }
  };

  const renderAll = async () => {
    if (!assets.length || isWorking) return;
    setIsWorking(true);
    try {
      const generated: ReadyItem[] = [];
      for (const asset of assetsRef.current) {
        const out = await renderOneSafe(asset, layersRef.current);
        const name = `${asset.nameBase}-edited.${out.ext}`;
        generated.push({
          id: `ready-${createId()}`,
          name,
          blob: out.blob,
          previewUrl: URL.createObjectURL(out.blob),
          width: out.width,
          height: out.height,
        });
      }
      setReadyItems((prev) => [...prev, ...generated]);
    } finally {
      setIsWorking(false);
    }
  };

  const handleDownloadReady = (item: ReadyItem) => {
    const href = URL.createObjectURL(item.blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = item.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 0);
  };

  const handleRemoveReady = (itemId: string) => {
    setReadyItems((prev) => {
      const found = prev.find((item) => item.id === itemId);
      if (found) URL.revokeObjectURL(found.previewUrl);
      return prev.filter((item) => item.id !== itemId);
    });
  };

  const handleClearReady = () => {
    setReadyItems((prev) => {
      prev.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return [];
    });
  };

  const handleDownloadZip = async () => {
    if (!readyItems.length || isWorking) return;
    setIsWorking(true);
    try {
      const zip = new JSZip();
      readyItems.forEach((item) => {
        zip.file(item.name, item.blob);
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = 'creative-editor-result.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 0);
    } finally {
      setIsWorking(false);
    }
  };

  const handleSendReadyItemToDeck = (item: ReadyItem) => {
    const extension = getExt(item.name) || 'png';
    const mimeType = item.blob.type || mimeByExt[extension] || 'image/png';
    const file = new File([item.blob], item.name, {
      type: mimeType,
      lastModified: Date.now(),
    });
    const previewUrl = URL.createObjectURL(item.blob);
    const nextAsset: EditorAsset = {
      id: `asset-${createId()}`,
      file,
      previewUrl,
      nameBase: getBase(item.name),
      extension,
      width: item.width,
      height: item.height,
    };
    const nextIndex = assets.length;
    setAssets((prev) => [...prev, nextAsset]);
    setCurrentIndex(nextIndex);
  };

  const handleCopyReadyItem = async (item: ReadyItem) => {
    try {
      if (!('clipboard' in navigator) || typeof ClipboardItem === 'undefined') {
        return;
      }
      if (!item.blob.type.startsWith('image/')) {
        return;
      }
      const pngBlob = await convertBlobToPng(item.blob);
      const clipboardItem = new ClipboardItem({
        'image/png': pngBlob,
      });
      await navigator.clipboard.write([clipboardItem]);
      if (copiedReadyTimerRef.current) {
        window.clearTimeout(copiedReadyTimerRef.current);
      }
      setCopiedReadyItemId(item.id);
      copiedReadyTimerRef.current = window.setTimeout(() => {
        setCopiedReadyItemId(null);
        copiedReadyTimerRef.current = null;
      }, 950);
    } catch {
      // keep silent on clipboard permission or support errors
    }
  };

  const handleClearLayers = () => {
    setLayers([]);
    setSelectedLayerId(null);
  };

  const handleDeleteLayer = (layerId: string) => {
    setLayers((prev) => prev.filter((layer) => layer.id !== layerId));
    setSelectedLayerId((prev) => (prev === layerId ? null : prev));
  };

  const handleDeleteSelectedLayer = () => {
    if (!selectedLayerId) return;
    handleDeleteLayer(selectedLayerId);
  };

  const handleResetStickerLayerSize = (layerId: string) => {
    if (!currentAsset) return;
    const assetWidth = Math.max(1, currentAsset.width);
    const assetHeight = Math.max(1, currentAsset.height);
    setLayers((prev) =>
      prev.map((layer) => {
        if (layer.id !== layerId || layer.type !== 'sticker') {
          return layer;
        }
        const sticker = stickersRef.current.find((item) => item.id === layer.stickerId);
        if (!sticker) {
          return layer;
        }
        const minWidth = 4;
        const minHeight = 4;
        const targetWidth = clamp((sticker.width / assetWidth) * 100, minWidth, 100);
        const targetHeight = clamp((sticker.height / assetHeight) * 100, minHeight, 100);
        const currentWidth = getStickerLayerWidth(layer);
        const currentHeight = getStickerLayerHeight(layer);
        const centerX = layer.x + currentWidth / 2;
        const centerY = layer.y + currentHeight / 2;
        const nextX = clamp(centerX - targetWidth / 2, 0, 100 - targetWidth);
        const nextY = clamp(centerY - targetHeight / 2, 0, 100 - targetHeight);
        return {
          ...layer,
          x: nextX,
          y: nextY,
          boxWidth: targetWidth,
          boxHeight: targetHeight,
        };
      }),
    );
  };

  const handleClearAll = () => {
    handleClearAssets();
    setStickers((prev) => {
      prev.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return [];
    });
    handleClearLayers();
    handleClearReady();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' || !selectedLayerId) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        const isFormField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
        if (isFormField || target.isContentEditable) {
          return;
        }
      }
      event.preventDefault();
      handleDeleteSelectedLayer();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedLayerId]);

  const handleDeckDragEnter = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!isFileDragEvent(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    deckDragDepthRef.current += 1;
    setIsDeckDropActive(true);
  };

  const handleDeckDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!isFileDragEvent(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDeckDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!isFileDragEvent(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    deckDragDepthRef.current = Math.max(0, deckDragDepthRef.current - 1);
    if (deckDragDepthRef.current === 0) {
      setIsDeckDropActive(false);
    }
  };

  const handleDeckDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!isFileDragEvent(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    deckDragDepthRef.current = 0;
    setIsDeckDropActive(false);
    void handleFilesAdded(event.dataTransfer.files);
  };

  const handleOpenReadyInNewTab = (item: ReadyItem) => {
    window.open(item.previewUrl, '_blank', 'noopener,noreferrer');
  };

  const isDeckDropVisualActive = isDeckDropActive || isGlobalFileDragActive;

  const deckOffset = assets.length > 0
    ? (((assets.length - 1) / 2) - currentIndex) * 52
    : 0;

  const deckTrackStyle = useMemo(
    () =>
      ({
        '--deck-offset': `${deckOffset}px`,
      }) as CSSProperties,
    [deckOffset],
  );

  const renderLayerItem = (layer: Layer, index: number) => {
    const isSelected = layer.id === selectedLayerId;
    if (layer.type === 'text') {
      const verticalInsetsPx = getTextLayerVerticalInsetsPx(layer, overlayBounds);
      const paddingX = getTextLayerPaddingX(layer);
      const paddingY = getTextLayerPaddingY(layer);
      const topInset = paddingY + verticalInsetsPx.top;
      const bottomInset = paddingY + verticalInsetsPx.bottom;
      const bgColorA = rgbaFromHex(layer.bgA, getTextLayerBgOpacityA(layer), '#000000');
      const bgColorB = rgbaFromHex(layer.bgB, getTextLayerBgOpacityB(layer), '#0ea5e9');
      const background = layer.bgMode === 'none'
        ? 'transparent'
        : layer.bgMode === 'gradient'
          ? `linear-gradient(${getGradientCssDirection(getTextLayerBgDirection(layer))}, ${bgColorA}, ${bgColorB})`
          : bgColorA;

      return (
        <div
          key={layer.id}
          className={`editor-layer editor-layer-text${isSelected ? ' is-selected' : ''}`}
          style={{
            left: `${layer.x}%`,
            top: `${layer.y}%`,
            width: `${layer.boxWidth}%`,
            height: `${getTextLayerHeight(layer)}%`,
            fontSize: `${layer.size}px`,
            fontFamily: `${layer.fontFamily}, Roboto, 'Segoe UI', sans-serif`,
            textAlign: layer.align,
            lineHeight: getTextLayerLineHeight(layer),
            fontWeight: layer.bold ? 700 : 500,
            fontStyle: layer.italic ? 'italic' : 'normal',
            textDecorationLine: textDecorationFromFlags(layer.underline, layer.strike),
            textDecorationThickness: '0.08em',
            textUnderlineOffset: '0.14em',
            color: layer.color,
            padding: 0,
            borderRadius: layer.bgMode === 'none' ? '0' : `${layer.radius}px`,
          }}
          onPointerDown={(event) => layerPointerDown(event, layer.id, 'move')}
          title={isSelected ? 'Drag empty area to move. Drag text to select.' : `Text ${index + 1}`}
        >
          {layer.bgMode !== 'none' ? (
            <span
              className="editor-layer-text-background"
              aria-hidden="true"
              style={{
                background,
                borderRadius: `${layer.radius}px`,
              }}
            />
          ) : null}
          <button
            type="button"
            className="editor-layer-delete-button"
            title="Delete layer"
            aria-label="Delete layer"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={() => handleDeleteLayer(layer.id)}
          >
            ×
          </button>
          {isSelected ? (
            <div
              ref={textEditorRef}
              contentEditable
              suppressContentEditableWarning
              className="editor-layer-text-editor editor-layer-text-editor-contenteditable"
              onInput={(event) =>
                handleTextLayerInput(
                  layer.id,
                  normalizeEditableText(event.currentTarget.innerText),
                  normalizeEditableHtml(event.currentTarget.innerHTML),
                )}
              onPointerDown={(event) => handleTextEditorPointerDown(event, layer)}
              onPointerMove={(event) => handleTextEditorPointerMove(event, layer)}
              onPointerLeave={handleTextEditorPointerLeave}
              style={{
                textDecorationLine: textDecorationFromFlags(layer.underline, layer.strike),
                textDecorationThickness: '0.08em',
                textUnderlineOffset: '0.14em',
                paddingTop: `${topInset}px`,
                paddingBottom: `${bottomInset}px`,
                paddingLeft: `${paddingX}px`,
                paddingRight: `${paddingX}px`,
              }}
            />
          ) : (
            <div
              className="editor-layer-text-view"
              style={{
                paddingTop: `${topInset}px`,
                paddingBottom: `${bottomInset}px`,
                paddingLeft: `${paddingX}px`,
                paddingRight: `${paddingX}px`,
              }}
              dangerouslySetInnerHTML={{ __html: getTextLayerRichText(layer) }}
            />
          )}
          {isSelected ? (
            <>
              <span
                className="editor-layer-resize-handle editor-layer-resize-handle-nw"
                onPointerDown={(event) => layerPointerDown(event, layer.id, 'resize', 'nw')}
                title="Resize text box"
              />
              <span
                className="editor-layer-resize-handle editor-layer-resize-handle-n"
                onPointerDown={(event) => layerPointerDown(event, layer.id, 'resize', 'n')}
                title="Resize text box"
              />
              <span
                className="editor-layer-resize-handle editor-layer-resize-handle-ne"
                onPointerDown={(event) => layerPointerDown(event, layer.id, 'resize', 'ne')}
                title="Resize text box"
              />
              <span
                className="editor-layer-resize-handle editor-layer-resize-handle-e"
                onPointerDown={(event) => layerPointerDown(event, layer.id, 'resize', 'e')}
                title="Resize text box"
              />
              <span
                className="editor-layer-resize-handle editor-layer-resize-handle-sw"
                onPointerDown={(event) => layerPointerDown(event, layer.id, 'resize', 'sw')}
                title="Resize text box"
              />
              <span
                className="editor-layer-resize-handle editor-layer-resize-handle-s"
                onPointerDown={(event) => layerPointerDown(event, layer.id, 'resize', 's')}
                title="Resize text box"
              />
              <span
                className="editor-layer-resize-handle editor-layer-resize-handle-se"
                onPointerDown={(event) => layerPointerDown(event, layer.id, 'resize', 'se')}
                title="Resize text box"
              />
              <span
                className="editor-layer-resize-handle editor-layer-resize-handle-w"
                onPointerDown={(event) => layerPointerDown(event, layer.id, 'resize', 'w')}
                title="Resize text box"
              />
            </>
          ) : null}
        </div>
      );
    }

    const sticker = stickers.find((item) => item.id === layer.stickerId);
    if (!sticker) return null;
    const stickerWidth = getStickerLayerWidth(layer);
    const stickerHeight = getStickerLayerHeight(layer);

    return (
      <div
        key={layer.id}
        className={`editor-layer editor-layer-sticker${isSelected ? ' is-selected' : ''}`}
        style={{
          left: `${layer.x}%`,
          top: `${layer.y}%`,
          width: `${stickerWidth}%`,
          height: `${stickerHeight}%`,
          opacity: layer.opacity / 100,
        }}
        onPointerDown={(event) => layerPointerDown(event, layer.id, 'move')}
        title="Drag to move. Resize from corners and sides. Hold Shift to keep proportions. Drag from outside ring to rotate."
      >
        {isSelected ? (
          <>
            <span
              className="editor-layer-rotate-zone editor-layer-rotate-zone-top"
              onPointerDown={(event) => layerPointerDown(event, layer.id, 'rotate')}
              title="Rotate sticker"
            />
            <span
              className="editor-layer-rotate-zone editor-layer-rotate-zone-right"
              onPointerDown={(event) => layerPointerDown(event, layer.id, 'rotate')}
              title="Rotate sticker"
            />
            <span
              className="editor-layer-rotate-zone editor-layer-rotate-zone-bottom"
              onPointerDown={(event) => layerPointerDown(event, layer.id, 'rotate')}
              title="Rotate sticker"
            />
            <span
              className="editor-layer-rotate-zone editor-layer-rotate-zone-left"
              onPointerDown={(event) => layerPointerDown(event, layer.id, 'rotate')}
              title="Rotate sticker"
            />
          </>
        ) : null}
        <div className="editor-layer-action-group">
          <button
            type="button"
            className="editor-layer-action-button editor-layer-reset-button"
            title="Reset to 100% size"
            aria-label="Reset to 100% size"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={() => handleResetStickerLayerSize(layer.id)}
          >
            1:1
          </button>
          <button
            type="button"
            className="editor-layer-action-button editor-layer-remove-button"
            title="Delete layer"
            aria-label="Delete layer"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={() => handleDeleteLayer(layer.id)}
          >
            ×
          </button>
        </div>
        <img
          src={sticker.previewUrl}
          alt="Sticker layer"
          style={{
            transform: `rotate(${getStickerLayerRotation(layer)}deg)`,
            transformOrigin: 'center center',
          }}
        />
        {isSelected ? (
          <>
            <span
              className="editor-layer-resize-handle editor-layer-resize-handle-nw"
              onPointerDown={(event) => layerPointerDown(event, layer.id, 'resize', 'nw')}
            />
            <span
              className="editor-layer-resize-handle editor-layer-resize-handle-n"
              onPointerDown={(event) => layerPointerDown(event, layer.id, 'resize', 'n')}
            />
            <span
              className="editor-layer-resize-handle editor-layer-resize-handle-ne"
              onPointerDown={(event) => layerPointerDown(event, layer.id, 'resize', 'ne')}
            />
            <span
              className="editor-layer-resize-handle editor-layer-resize-handle-e"
              onPointerDown={(event) => layerPointerDown(event, layer.id, 'resize', 'e')}
            />
            <span
              className="editor-layer-resize-handle editor-layer-resize-handle-sw"
              onPointerDown={(event) => layerPointerDown(event, layer.id, 'resize', 'sw')}
            />
            <span
              className="editor-layer-resize-handle editor-layer-resize-handle-s"
              onPointerDown={(event) => layerPointerDown(event, layer.id, 'resize', 's')}
            />
            <span
              className="editor-layer-resize-handle editor-layer-resize-handle-se"
              onPointerDown={(event) => layerPointerDown(event, layer.id, 'resize', 'se')}
            />
            <span
              className="editor-layer-resize-handle editor-layer-resize-handle-w"
              onPointerDown={(event) => layerPointerDown(event, layer.id, 'resize', 'w')}
            />
          </>
        ) : null}
      </div>
    );
  };

  return (
    <section className="creative-editor">
      <section className="controls-wrapper">
        <div className="controls">
          <div className="controls-heading">
            <h1 className="controls-heading-title">Creative Editor</h1>
            <p className="controls-subtitle">Upload images, add text layers, then export edited creatives as a ZIP.</p>
          </div>
          <div className="resizer-primary-actions creative-editor-primary-actions">
            <button type="button" onClick={handleUploadClick} disabled={isWorking}>
              Upload ZIPs or files
            </button>
            <button type="button" onClick={handleClearAll} disabled={isWorking || (!assets.length && !readyItems.length)}>
              Clear all
            </button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.zip"
          multiple
          hidden
          onChange={(event) => {
            void handleFilesAdded(event.target.files);
            event.currentTarget.value = '';
          }}
        />
        <input
          ref={stickerInputRef}
          type="file"
          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
          multiple
          hidden
          onChange={(event) => {
            void handleStickerFilesAdded(event.target.files);
            event.currentTarget.value = '';
          }}
        />
      </section>

      <section className="card resizer-stage-card">
        <header className="card-header">
          <div className="card-header-top">
            <h2>Preview</h2>
            <div className="split-result-actions">
              <button type="button" onClick={() => void renderCurrent()} disabled={!currentAsset || isWorking}>
                Render current
              </button>
              <button type="button" onClick={() => void renderAll()} disabled={!assets.length || isWorking}>
                Render all
              </button>
            </div>
          </div>
        </header>

        <div
          className={`resizer-deck-row${isDeckDropVisualActive ? ' is-drop-active' : ''}`}
          onDragEnter={handleDeckDragEnter}
          onDragOver={handleDeckDragOver}
          onDragLeave={handleDeckDragLeave}
          onDrop={handleDeckDrop}
        >
          <button type="button" className="resizer-nav-button" onClick={() => handleStepAsset(-1)} disabled={currentIndex <= 0}>
            ‹
          </button>
          <div className="resizer-deck">
            {assets.length ? (
              <div className="resizer-deck-track" style={deckTrackStyle}>
                {assets.map((asset, index) => (
                  <button
                    key={asset.id}
                    type="button"
                    className={`resizer-deck-item${index === currentIndex ? ' is-active' : ''}`}
                    style={
                      {
                        '--deck-y': `${Math.abs(index - currentIndex) * 4}px`,
                        '--deck-opacity': index === currentIndex ? 1 : 0.85,
                        '--deck-z': String(200 - Math.abs(index - currentIndex)),
                      } as CSSProperties
                    }
                    onClick={() => setCurrentIndex(index)}
                    onMouseEnter={(event) => setHoverPreview({ url: asset.previewUrl, x: event.clientX, y: event.clientY })}
                    onMouseMove={(event) => setHoverPreview({ url: asset.previewUrl, x: event.clientX, y: event.clientY })}
                    onMouseLeave={() => setHoverPreview(null)}
                    title={asset.file.name}
                  >
                    <img src={asset.previewUrl} alt={asset.file.name} />
                    <span className="resizer-deck-item-size">{asset.width}x{asset.height}</span>
                    <span
                      className="resizer-deck-item-remove"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleRemoveAsset(asset.id);
                      }}
                    >
                      ×
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="resizer-deck-empty">No images loaded.</div>
            )}
          </div>
          <button
            type="button"
            className="resizer-nav-button"
            onClick={() => handleStepAsset(1)}
            disabled={!assets.length || currentIndex >= assets.length - 1}
          >
            ›
          </button>
          {isDeckDropVisualActive ? (
            <div className="resizer-deck-dropzone" aria-hidden="true">
              <span>Drop ZIPs or image files here</span>
            </div>
          ) : null}
        </div>

        <div className="editor-stage">
          {currentAsset ? (
            <div className="editor-image-wrap">
              <img src={currentAsset.previewUrl} alt={currentAsset.file.name} className="editor-image" />
              <div className="editor-overlay" ref={overlayRef} onPointerDown={() => setSelectedLayerId(null)}>
                {layers.map((layer, index) => renderLayerItem(layer, index))}
              </div>
            </div>
          ) : (
            <div className="resizer-empty">Upload at least one image to start editing.</div>
          )}
        </div>
      </section>

      <section className="card editor-text-workbench">
        <header className="card-header">
          <div className="card-header-top">
            <h2>Text editor</h2>
            <div className="split-result-actions">
              <button
                type="button"
                onClick={handleStickerUploadClick}
                disabled={!assets.length || isWorking}
                title="Upload sticker (JPG or PNG)."
              >
                Upload sticker
              </button>
              <button type="button" onClick={addTextLayer} disabled={!assets.length}>
                Add text layer
              </button>
            </div>
          </div>
        </header>

        <div className="editor-text-toolbar">
          <div className="editor-text-toolbar-row editor-text-toolbar-row-background">
            <div className="editor-bg-tools-group">
              <div className="editor-text-field editor-text-field-bg-mode editor-text-field-compact">
                <label className="editor-visually-hidden">Background mode</label>
                <div className="editor-select-control" ref={bgModeControlRef}>
                  <button
                    type="button"
                    className={`editor-select-trigger${isBgModeOpen ? ' is-active' : ''}`}
                    onClick={() => {
                      setIsColorControlOpen(false);
                      setIsBgOpacityOpen(false);
                      setIsBgOpacityBOpen(false);
                      setIsBgRadiusOpen(false);
                      setIsPaddingXOpen(false);
                      setIsPaddingYOpen(false);
                      setIsLineHeightOpen(false);
                      setIsBgDirectionOpen(false);
                      setIsFontOpen(false);
                      setIsBgModeOpen((prev) => !prev);
                    }}
                    aria-haspopup="listbox"
                    aria-expanded={isBgModeOpen}
                    aria-label="Background mode"
                  >
                    <span className="editor-select-value">
                      {textBgModeOptions.find((option) => option.value === textBgMode)?.label ?? 'None'}
                    </span>
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M4 6l4 4 4-4" />
                    </svg>
                  </button>
                  {isBgModeOpen ? (
                    <div className="editor-select-popover editor-select-popover-bg" role="listbox" aria-label="Background mode values">
                      {textBgModeOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`editor-select-option${textBgMode === option.value ? ' is-active' : ''}`}
                          aria-selected={textBgMode === option.value}
                          onClick={() => {
                            setTextBgMode(option.value);
                            updateSelectedTextLayer({ bgMode: option.value });
                            setIsBgModeOpen(false);
                          }}
                        >
                          <span>{option.label}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="editor-gradient-color-controls" aria-label="Background colors">
                <div className={`editor-gradient-control-slot${textBgMode === 'none' ? '' : ' is-visible'}`}>
                  <div className="editor-bg-radius-control" ref={bgRadiusControlRef}>
                    <button
                      type="button"
                      className="editor-bg-radius-button"
                      onClick={() => {
                        setIsColorControlOpen(false);
                        setIsBgOpacityOpen(false);
                        setIsBgOpacityBOpen(false);
                        setIsPaddingXOpen(false);
                        setIsPaddingYOpen(false);
                        setIsLineHeightOpen(false);
                        setIsBgDirectionOpen(false);
                        setIsBgModeOpen(false);
                        setIsFontOpen(false);
                        setIsBgRadiusOpen((prev) => !prev);
                      }}
                      disabled={textBgMode === 'none'}
                      title="Background corner radius"
                      aria-label="Background corner radius"
                      aria-expanded={isBgRadiusOpen}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M5 5h14" />
                        <path d="M5 5v14" />
                        <path d="M9 19h6a4 4 0 0 0 4-4V9" />
                      </svg>
                    </button>
                    {isBgRadiusOpen && textBgMode !== 'none' ? (
                      <div className="editor-bg-radius-popover" role="dialog" aria-label="Background corner radius">
                        <input
                          type="range"
                          min={0}
                          max={80}
                          value={textRadius}
                          onChange={(event) => applyTextRadius(Number(event.target.value))}
                        />
                        <input
                          type="number"
                          min={0}
                          max={80}
                          value={textRadius}
                          onChange={(event) => applyTextRadius(Number(event.target.value))}
                          aria-label="Background corner radius value"
                        />
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className={`editor-gradient-control-slot${textBgMode === 'gradient' ? ' is-visible' : ''}`}>
                  <div className="editor-bg-direction-control" ref={bgDirectionControlRef}>
                    <button
                      type="button"
                      className={`editor-bg-direction-button${isBgDirectionOpen ? ' is-active' : ''}`}
                      onClick={() => {
                        setIsColorControlOpen(false);
                        setIsBgOpacityOpen(false);
                        setIsBgOpacityBOpen(false);
                        setIsPaddingXOpen(false);
                        setIsPaddingYOpen(false);
                        setIsLineHeightOpen(false);
                        setIsBgRadiusOpen(false);
                        setIsBgModeOpen(false);
                        setIsFontOpen(false);
                        setIsBgDirectionOpen((prev) => !prev);
                      }}
                      disabled={textBgMode !== 'gradient'}
                      title="Gradient direction"
                      aria-label="Gradient direction"
                      aria-expanded={isBgDirectionOpen}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        {textBgDirection === 'to-right' ? (
                          <path d="M5 12h14m-4-4 4 4-4 4" />
                        ) : textBgDirection === 'to-bottom' ? (
                          <path d="M12 5v14m-4-4 4 4 4-4" />
                        ) : textBgDirection === 'to-bottom-left' ? (
                          <path d="M18 6 6 18m0-5v5h5" />
                        ) : (
                          <path d="M6 6l12 12m-5 0h5v-5" />
                        )}
                      </svg>
                    </button>
                    {isBgDirectionOpen && textBgMode === 'gradient' ? (
                      <div className="editor-bg-direction-popover" role="listbox" aria-label="Gradient direction">
                        {textBgDirectionOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={`editor-bg-direction-option${textBgDirection === option.value ? ' is-active' : ''}`}
                            aria-selected={textBgDirection === option.value}
                            onClick={() => {
                              applyTextBgDirection(option.value);
                              setIsBgDirectionOpen(false);
                            }}
                            title={option.label}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              {option.value === 'to-right' ? (
                                <path d="M5 12h14m-4-4 4 4-4 4" />
                              ) : option.value === 'to-bottom' ? (
                                <path d="M12 5v14m-4-4 4 4 4-4" />
                              ) : option.value === 'to-bottom-left' ? (
                                <path d="M18 6 6 18m0-5v5h5" />
                              ) : (
                                <path d="M6 6l12 12m-5 0h5v-5" />
                              )}
                            </svg>
                            <span className="editor-visually-hidden">{option.label}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className={`editor-gradient-control-slot${textBgMode === 'none' ? '' : ' is-visible'}`}>
                  <div className="editor-bg-opacity-control" ref={bgOpacityControlRef}>
                    <button
                      type="button"
                      className="editor-bg-opacity-button"
                      onClick={() => {
                        setIsColorControlOpen(false);
                        setIsBgOpacityBOpen(false);
                        setIsPaddingXOpen(false);
                        setIsPaddingYOpen(false);
                        setIsLineHeightOpen(false);
                        setIsBgRadiusOpen(false);
                        setIsBgDirectionOpen(false);
                        setIsBgModeOpen(false);
                        setIsFontOpen(false);
                        setIsBgOpacityOpen((prev) => !prev);
                      }}
                      disabled={textBgMode === 'none'}
                      title={textBgMode === 'gradient' ? 'Opacity for side A' : 'Background opacity'}
                      aria-label={textBgMode === 'gradient' ? 'Opacity for side A' : 'Background opacity'}
                      aria-expanded={isBgOpacityOpen}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="12" cy="12" r="7" />
                        <path d="M12 5a7 7 0 0 0 0 14V5Z" fill="currentColor" stroke="none" />
                      </svg>
                      {textBgMode === 'gradient' ? <span className="editor-bg-control-badge" aria-hidden="true">A</span> : null}
                    </button>
                    {isBgOpacityOpen && textBgMode !== 'none' ? (
                      <div
                        className="editor-bg-opacity-popover"
                        role="dialog"
                        aria-label={textBgMode === 'gradient' ? 'Opacity for side A' : 'Background opacity'}
                      >
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={textOpacity}
                          onChange={(event) => applyTextOpacity(Number(event.target.value))}
                        />
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={textOpacity}
                          onChange={(event) => applyTextOpacity(Number(event.target.value))}
                          aria-label="Background opacity value"
                        />
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className={`editor-gradient-control-slot${textBgMode === 'none' ? '' : ' is-visible'}`}>
                  <label
                    className={`editor-gradient-color-trigger${textBgMode === 'none' ? ' is-disabled' : ''}`}
                    style={{ '--editor-gradient-color': textBgA } as CSSProperties}
                  >
                    <span className="editor-visually-hidden">Background color A</span>
                    <span className="editor-gradient-color-icon-wrap" aria-hidden="true">
                      <svg className="editor-gradient-color-tool" viewBox="0 0 24 24">
                        <path d="m14.8 4.8 4.4 4.4-2.2 2.2-4.4-4.4z" />
                        <path d="m12.6 7 4.4 4.4-5.8 5.8H8.4V14.4z" />
                        <path d="M6.5 18.5h3" />
                      </svg>
                      <svg className="editor-gradient-color-caret" viewBox="0 0 16 16">
                        <path d="m4.5 6.5 3.5 3 3.5-3" />
                      </svg>
                    </span>
                    <input
                      type="color"
                      value={textBgA}
                      onChange={(event) => {
                        const bgA = normalizeHexColor(event.target.value, '#000000');
                        setTextBgA(bgA);
                        updateSelectedTextLayer({ bgA });
                      }}
                      disabled={textBgMode === 'none'}
                    />
                  </label>
                </div>

                <div className={`editor-gradient-control-slot${textBgMode === 'gradient' ? ' is-visible' : ''}`}>
                  <div className="editor-bg-opacity-control" ref={bgOpacityBControlRef}>
                    <button
                      type="button"
                      className="editor-bg-opacity-button"
                      onClick={() => {
                        setIsColorControlOpen(false);
                        setIsBgOpacityOpen(false);
                        setIsPaddingXOpen(false);
                        setIsPaddingYOpen(false);
                        setIsLineHeightOpen(false);
                        setIsBgRadiusOpen(false);
                        setIsBgDirectionOpen(false);
                        setIsBgModeOpen(false);
                        setIsFontOpen(false);
                        setIsBgOpacityBOpen((prev) => !prev);
                      }}
                      disabled={textBgMode !== 'gradient'}
                      title="Opacity for side B"
                      aria-label="Opacity for side B"
                      aria-expanded={isBgOpacityBOpen}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="12" cy="12" r="7" />
                        <path d="M12 5a7 7 0 0 0 0 14V5Z" fill="currentColor" stroke="none" />
                      </svg>
                      <span className="editor-bg-control-badge" aria-hidden="true">B</span>
                    </button>
                    {isBgOpacityBOpen && textBgMode === 'gradient' ? (
                      <div className="editor-bg-opacity-popover" role="dialog" aria-label="Opacity for side B">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={textBgOpacityB}
                          onChange={(event) => applyTextOpacityB(Number(event.target.value))}
                        />
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={textBgOpacityB}
                          onChange={(event) => applyTextOpacityB(Number(event.target.value))}
                          aria-label="Opacity for side B value"
                        />
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className={`editor-gradient-control-slot${textBgMode === 'gradient' ? ' is-visible' : ''}`}>
                  <label
                    className={`editor-gradient-color-trigger${textBgMode !== 'gradient' ? ' is-disabled' : ''}`}
                    style={{ '--editor-gradient-color': textBgB } as CSSProperties}
                  >
                    <span className="editor-visually-hidden">Background color B</span>
                    <span className="editor-gradient-color-icon-wrap" aria-hidden="true">
                      <svg className="editor-gradient-color-tool" viewBox="0 0 24 24">
                        <path d="m14.8 4.8 4.4 4.4-2.2 2.2-4.4-4.4z" />
                        <path d="m12.6 7 4.4 4.4-5.8 5.8H8.4V14.4z" />
                        <path d="M6.5 18.5h3" />
                      </svg>
                      <svg className="editor-gradient-color-caret" viewBox="0 0 16 16">
                        <path d="m4.5 6.5 3.5 3 3.5-3" />
                      </svg>
                    </span>
                    <input
                      type="color"
                      value={textBgB}
                      onChange={(event) => {
                        const bgB = normalizeHexColor(event.target.value, '#0ea5e9');
                        setTextBgB(bgB);
                        updateSelectedTextLayer({ bgB });
                      }}
                      disabled={textBgMode !== 'gradient'}
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="editor-text-toolbar-row editor-text-toolbar-row-main">
            <div className="editor-text-field editor-text-field-font">
              <label className="editor-visually-hidden">Font</label>
              <div className="editor-select-control" ref={fontControlRef}>
                <button
                  type="button"
                  className={`editor-select-trigger${isFontOpen ? ' is-active' : ''}`}
                  onClick={() => {
                    setIsColorControlOpen(false);
                    setIsBgOpacityOpen(false);
                    setIsBgOpacityBOpen(false);
                    setIsBgRadiusOpen(false);
                    setIsPaddingXOpen(false);
                    setIsPaddingYOpen(false);
                    setIsLineHeightOpen(false);
                    setIsBgDirectionOpen(false);
                    setIsBgModeOpen(false);
                    setIsFontOpen((prev) => !prev);
                  }}
                  aria-haspopup="listbox"
                  aria-expanded={isFontOpen}
                  aria-label="Font family"
                >
                  <span className="editor-select-value">{textFont}</span>
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M4 6l4 4 4-4" />
                  </svg>
                </button>
                {isFontOpen ? (
                  <div className="editor-select-popover editor-select-popover-font" role="listbox" aria-label="Font family values">
                    {textFontOptions.map((font) => (
                      <button
                        key={font}
                        type="button"
                        className={`editor-select-option${textFont === font ? ' is-active' : ''}`}
                        aria-selected={textFont === font}
                        onClick={() => {
                          setTextFont(font);
                          updateSelectedTextLayer({ fontFamily: font });
                          setIsFontOpen(false);
                        }}
                      >
                        <span>{font}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="editor-text-field editor-text-field-size editor-text-field-compact">
              <label className="editor-visually-hidden">Text size</label>
              <div className="editor-size-inline">
                <button type="button" onClick={() => applyTextSize(textSize - 1)} title="Decrease text size">
                  -
                </button>
                <input
                  type="number"
                  min={1}
                  max={300}
                  value={textSizeInput}
                  onChange={(event) => handleTextSizeInputChange(event.target.value)}
                  onBlur={commitTextSizeInput}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur();
                    }
                  }}
                />
                <button type="button" onClick={() => applyTextSize(textSize + 1)} title="Increase text size">
                  +
                </button>
              </div>
            </div>

            <div className="editor-text-field editor-text-field-color editor-text-field-compact">
              <label className="editor-visually-hidden">Text color</label>
              <div className="editor-color-control" ref={colorControlRef}>
                <button
                  type="button"
                  className="editor-color-letter-button"
                  style={{ '--editor-color': textColor } as CSSProperties}
                  onPointerDown={preserveEditorSelectionOnToolbarPointerDown}
                  onClick={() => {
                    setIsBgOpacityOpen(false);
                    setIsBgOpacityBOpen(false);
                    setIsBgRadiusOpen(false);
                    setIsPaddingXOpen(false);
                    setIsPaddingYOpen(false);
                    setIsLineHeightOpen(false);
                    setIsBgDirectionOpen(false);
                    setIsBgModeOpen(false);
                    setIsFontOpen(false);
                    setIsColorControlOpen((prev) => !prev);
                  }}
                  title="Text color"
                >
                  <span aria-hidden="true">A</span>
                </button>
                {isColorControlOpen ? (
                  <div className="editor-color-popover" role="dialog" aria-label="Text color">
                    <label className="editor-color-popover-row">
                      <span>Color</span>
                      <input
                        type="color"
                        value={textColor}
                        onChange={(event) => {
                          const color = event.target.value;
                          setTextColor(color);
                          if (!executeInlineTextCommand('foreColor', color)) {
                            updateSelectedTextLayer({ color });
                          }
                        }}
                        aria-label="Text color"
                      />
                    </label>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="editor-icon-group" aria-label="Text style">
              <button
                type="button"
                className={textBold ? 'is-active' : ''}
                onPointerDown={preserveEditorSelectionOnToolbarPointerDown}
                onClick={() => {
                  if (executeInlineTextCommand('bold')) return;
                  const next = !textBold;
                  setTextBold(next);
                  updateSelectedTextLayer({ bold: next });
                }}
                title="Bold"
              >
                <span className="editor-style-letter" aria-hidden="true">B</span>
              </button>
              <button
                type="button"
                className={textItalic ? 'is-active' : ''}
                onPointerDown={preserveEditorSelectionOnToolbarPointerDown}
                onClick={() => {
                  if (executeInlineTextCommand('italic')) return;
                  const next = !textItalic;
                  setTextItalic(next);
                  updateSelectedTextLayer({ italic: next });
                }}
                title="Italic"
              >
                <span className="editor-style-letter is-italic" aria-hidden="true">I</span>
              </button>
              <button
                type="button"
                className={textUnderline ? 'is-active' : ''}
                onPointerDown={preserveEditorSelectionOnToolbarPointerDown}
                onClick={() => {
                  if (executeInlineTextCommand('underline')) return;
                  const next = !textUnderline;
                  setTextUnderline(next);
                  updateSelectedTextLayer({ underline: next });
                }}
                title="Underline"
              >
                <span className="editor-style-letter is-underlined" aria-hidden="true">U</span>
              </button>
              <button
                type="button"
                className={textStrike ? 'is-active' : ''}
                onPointerDown={preserveEditorSelectionOnToolbarPointerDown}
                onClick={() => {
                  if (executeInlineTextCommand('strikeThrough')) return;
                  const next = !textStrike;
                  setTextStrike(next);
                  updateSelectedTextLayer({ strike: next });
                }}
                title="Strikethrough"
              >
                <span className="editor-style-letter is-strike" aria-hidden="true">S</span>
              </button>
            </div>

            <div className="editor-icon-group editor-icon-group-align" aria-label="Text alignment">
              <button
                type="button"
                className={textAlign === 'left' ? 'is-active' : ''}
                onClick={() => {
                  setTextAlign('left');
                  updateSelectedTextLayer({ align: 'left' });
                }}
                title="Align left"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 5h16v2H4V5zm0 4h10v2H4V9zm0 4h16v2H4v-2zm0 4h10v2H4v-2z" />
                </svg>
              </button>
              <button
                type="button"
                className={textAlign === 'center' ? 'is-active' : ''}
                onClick={() => {
                  setTextAlign('center');
                  updateSelectedTextLayer({ align: 'center' });
                }}
                title="Align center"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 5h16v2H4V5zm3 4h10v2H7V9zm-3 4h16v2H4v-2zm3 4h10v2H7v-2z" />
                </svg>
              </button>
              <button
                type="button"
                className={textAlign === 'right' ? 'is-active' : ''}
                onClick={() => {
                  setTextAlign('right');
                  updateSelectedTextLayer({ align: 'right' });
                }}
                title="Align right"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 5h16v2H4V5zm10 4h6v2h-6V9zM4 13h16v2H4v-2zm10 4h6v2h-6v-2z" />
                </svg>
              </button>
              <button
                type="button"
                className={textAlign === 'justify' ? 'is-active' : ''}
                onClick={() => {
                  setTextAlign('justify');
                  updateSelectedTextLayer({ align: 'justify' });
                }}
                title="Align justify"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 5h16v2H4V5zm0 4h16v2H4V9zm0 4h16v2H4v-2zm0 4h16v2H4v-2z" />
                </svg>
              </button>
              <div className="editor-line-height-control" ref={lineHeightControlRef}>
                <button
                  type="button"
                  className={`editor-line-height-button${isLineHeightOpen ? ' is-active' : ''}`}
                  onClick={() => {
                    setIsColorControlOpen(false);
                    setIsBgOpacityOpen(false);
                    setIsBgOpacityBOpen(false);
                    setIsBgRadiusOpen(false);
                    setIsPaddingXOpen(false);
                    setIsPaddingYOpen(false);
                    setIsBgDirectionOpen(false);
                    setIsBgModeOpen(false);
                    setIsFontOpen(false);
                    setIsLineHeightOpen((prev) => !prev);
                  }}
                  title="Line height"
                  aria-label="Line height"
                  aria-expanded={isLineHeightOpen}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M7 5v14M7 5l-2 2M7 5l2 2M7 19l-2-2M7 19l2-2M11 8h8M11 12h8M11 16h8" />
                  </svg>
                </button>
                {isLineHeightOpen ? (
                  <div className="editor-line-height-popover" role="listbox" aria-label="Line height values">
                    {textLineHeightOptions.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={`editor-line-height-option${textLineHeight === value ? ' is-active' : ''}`}
                        aria-selected={textLineHeight === value}
                        onClick={() => {
                          applyTextLineHeight(value);
                          setIsLineHeightOpen(false);
                        }}
                      >
                        <span>{value}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="editor-icon-group editor-icon-group-vertical" aria-label="Vertical text alignment">
              <button
                type="button"
                className={textVerticalAlign === 'top' ? 'is-active' : ''}
                onClick={() => {
                  setTextVerticalAlign('top');
                  updateSelectedTextLayer({ verticalAlign: 'top' });
                }}
                title="Align top"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 5h14v2H5V5zm3 4h8v10H8V9z" />
                </svg>
              </button>
              <button
                type="button"
                className={textVerticalAlign === 'middle' ? 'is-active' : ''}
                onClick={() => {
                  setTextVerticalAlign('middle');
                  updateSelectedTextLayer({ verticalAlign: 'middle' });
                }}
                title="Align middle"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 7h8v10H8V7zm-3 4h14v2H5v-2z" />
                </svg>
              </button>
              <button
                type="button"
                className={textVerticalAlign === 'bottom' ? 'is-active' : ''}
                onClick={() => {
                  setTextVerticalAlign('bottom');
                  updateSelectedTextLayer({ verticalAlign: 'bottom' });
                }}
                title="Align bottom"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5h8v10H8V5zm-3 12h14v2H5v-2z" />
                </svg>
              </button>
            </div>

            <div className="editor-padding-controls" aria-label="Text padding">
              <div className="editor-padding-control" ref={paddingXControlRef}>
                <button
                  type="button"
                  className={`editor-padding-button${isPaddingXOpen ? ' is-active' : ''}`}
                  onClick={() => {
                    setIsColorControlOpen(false);
                    setIsBgOpacityOpen(false);
                    setIsBgOpacityBOpen(false);
                    setIsBgRadiusOpen(false);
                    setIsLineHeightOpen(false);
                    setIsBgDirectionOpen(false);
                    setIsBgModeOpen(false);
                    setIsFontOpen(false);
                    setIsPaddingYOpen(false);
                    setIsPaddingXOpen((prev) => !prev);
                  }}
                  title="Side padding"
                  aria-label="Side padding"
                  aria-expanded={isPaddingXOpen}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 12h14M5 12l2-2M5 12l2 2M19 12l-2-2M19 12l-2 2" />
                  </svg>
                </button>
                {isPaddingXOpen ? (
                  <div className="editor-padding-popover" role="dialog" aria-label="Side padding">
                    <input
                      type="range"
                      min={0}
                      max={120}
                      value={textPaddingX}
                      onChange={(event) => applyTextPaddingX(Number(event.target.value))}
                    />
                    <input
                      type="number"
                      min={0}
                      max={120}
                      value={textPaddingX}
                      onChange={(event) => applyTextPaddingX(Number(event.target.value))}
                      aria-label="Side padding value"
                    />
                  </div>
                ) : null}
              </div>

              <div className="editor-padding-control" ref={paddingYControlRef}>
                <button
                  type="button"
                  className={`editor-padding-button${isPaddingYOpen ? ' is-active' : ''}`}
                  onClick={() => {
                    setIsColorControlOpen(false);
                    setIsBgOpacityOpen(false);
                    setIsBgOpacityBOpen(false);
                    setIsBgRadiusOpen(false);
                    setIsLineHeightOpen(false);
                    setIsBgDirectionOpen(false);
                    setIsBgModeOpen(false);
                    setIsFontOpen(false);
                    setIsPaddingXOpen(false);
                    setIsPaddingYOpen((prev) => !prev);
                  }}
                  title="Top and bottom padding"
                  aria-label="Top and bottom padding"
                  aria-expanded={isPaddingYOpen}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 5v14M12 5l-2 2M12 5l2 2M12 19l-2-2M12 19l2-2" />
                  </svg>
                </button>
                {isPaddingYOpen ? (
                  <div className="editor-padding-popover" role="dialog" aria-label="Top and bottom padding">
                    <input
                      type="range"
                      min={0}
                      max={120}
                      value={textPaddingY}
                      onChange={(event) => applyTextPaddingY(Number(event.target.value))}
                    />
                    <input
                      type="number"
                      min={0}
                      max={120}
                      value={textPaddingY}
                      onChange={(event) => applyTextPaddingY(Number(event.target.value))}
                      aria-label="Top and bottom padding value"
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="card results-card">
        <header className="card-header">
          <div className="card-header-top">
            <h2>Result</h2>
            <div className="split-result-actions">
              <button type="button" className="clear-action-button" onClick={handleClearReady} disabled={!readyItems.length || isWorking}>
                Clear result
              </button>
              <button type="button" onClick={() => { void handleDownloadZip(); }} disabled={!readyItems.length || isWorking}>
                Download ZIP
              </button>
            </div>
          </div>
        </header>
        <div className="result-list resizer-ready-list">
          {readyItems.length ? (
            readyItems.map((item, index) => (
              <div
                key={item.id}
                className="result-item resizer-ready-item"
                onMouseEnter={(event) => setHoverPreview({ url: item.previewUrl, x: event.clientX, y: event.clientY })}
                onMouseMove={(event) => setHoverPreview({ url: item.previewUrl, x: event.clientX, y: event.clientY })}
                onMouseLeave={() => setHoverPreview(null)}
              >
                <span className="result-index">{index + 1}</span>
                <div className="result-value">
                  <button
                    type="button"
                    className="resizer-ready-name resizer-ready-name-link"
                    onClick={() => handleOpenReadyInNewTab(item)}
                    title="Open in new tab"
                  >
                    {item.name}
                  </button>
                  <div className="resizer-ready-meta">
                    <span className="resizer-ready-size">{item.width}x{item.height}</span>
                    <span className="resizer-ready-weight">{formatSize(item.blob.size)}</span>
                    <button
                      type="button"
                      className="resizer-ready-icon-button"
                      onClick={() => handleDownloadReady(item)}
                      title="Download"
                      aria-label="Download edited image"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M5 20h14v-2H5v2zM11 2h2v10.17l3.59-3.58L18 10l-6 6-6-6 1.41-1.41L11 12.17V2z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="resizer-ready-icon-button"
                      onClick={() => handleSendReadyItemToDeck(item)}
                      title="Send to deck"
                      aria-label="Send edited image back to deck"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M12 5V1L6 7l6 6V9c3.31 0 6 2.69 6 6 0 1.31-.42 2.52-1.14 3.5l1.46 1.46A7.96 7.96 0 0 0 20 15c0-4.42-3.58-8-8-8z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={`resizer-ready-icon-button${copiedReadyItemId === item.id ? ' is-copied' : ''}`}
                      onClick={() => {
                        void handleCopyReadyItem(item);
                      }}
                      title={copiedReadyItemId === item.id ? 'Copied' : 'Copy image'}
                      aria-label="Copy edited image to clipboard"
                    >
                      {copiedReadyItemId === item.id ? (
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path d="M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.5-1.5L9 16.2z" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path d="M16 1H4C2.9 1 2 1.9 2 3v12h2V3h12V1zm3 4H8C6.9 5 6 5.9 6 7v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  className="resizer-ready-remove"
                  onClick={() => handleRemoveReady(item.id)}
                  aria-label="Remove edited image"
                >
                  x
                </button>
              </div>
            ))
          ) : (
            <p className="muted">Edited creatives will appear here.</p>
          )}
        </div>
      </section>

      {hoverPreview ? (
        <div className="creative-preview" style={{ left: hoverPreview.x + 12, top: hoverPreview.y + 12 }}>
          <img src={hoverPreview.url} alt="Preview" />
        </div>
      ) : null}
    </section>
  );
};

