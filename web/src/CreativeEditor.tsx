
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
type TextAlignMode = 'left' | 'center' | 'right' | 'justify';

type TextLayer = {
  id: string;
  type: 'text';
  text: string;
  x: number;
  y: number;
  boxWidth: number;
  boxHeight: number;
  minBoxHeight: number;
  size: number;
  fontFamily: string;
  align: TextAlignMode;
  lineHeight: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  opacity: number;
  bgMode: TextBgMode;
  bgA: string;
  bgB: string;
  padding: number;
  radius: number;
};

type StickerLayer = {
  id: string;
  type: 'sticker';
  stickerId: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
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
  mode: 'move' | 'resize';
  resizeHandle?: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 'e' | 's' | 'w';
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  startWidth?: number;
  startHeight?: number;
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
const clampTextLineHeight = (value: number) => (Number.isFinite(value) ? clamp(value, 0.8, 2.5) : 1.24);
const getTextLayerLineHeight = (layer: TextLayer) => clampTextLineHeight(layer.lineHeight);
const normalizeEditableText = (value: string) => value.replace(/\r/g, '').replace(/\u00a0/g, ' ').replace(/\n$/, '');
const textLineHeightOptions = [1, 1.1, 1.25, 1.5, 1.75, 2] as const;
const normalizeTextLineHeightOption = (value: number) => {
  const normalized = clampTextLineHeight(value);
  return textLineHeightOptions.reduce((closest, current) =>
    Math.abs(current - normalized) < Math.abs(closest - normalized) ? current : closest,
  textLineHeightOptions[0]);
};

const imageExt = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'svg', 'avif']);

const getExt = (name: string) => {
  const match = name.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : '';
};

const getBase = (name: string) => name.replace(/\.[^.]+$/, '');

const getLeaf = (path: string) => path.split('/').pop() ?? path;

const isImageName = (name: string) => imageExt.has(getExt(name));

const isImageFile = (file: File) => file.type.startsWith('image/') || isImageName(file.name);

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

  const [textSize, setTextSize] = useState(56);
  const [textSizeInput, setTextSizeInput] = useState('56');
  const [textFont, setTextFont] = useState('Roboto');
  const [textAlign, setTextAlign] = useState<TextAlignMode>('center');
  const [textLineHeight, setTextLineHeight] = useState(1.25);
  const [textColor, setTextColor] = useState('#ffffff');
  const [textBold, setTextBold] = useState(true);
  const [textItalic, setTextItalic] = useState(false);
  const [textUnderline, setTextUnderline] = useState(false);
  const [textStrike, setTextStrike] = useState(false);
  const [textOpacity, setTextOpacity] = useState(100);
  const [textBgMode, setTextBgMode] = useState<TextBgMode>('none');
  const [textBgA, setTextBgA] = useState('#000000aa');
  const [textBgB, setTextBgB] = useState('#0ea5e9aa');
  const [textPadding, setTextPadding] = useState(0);
  const [textRadius, setTextRadius] = useState(12);

  const [isDeckDropActive, setIsDeckDropActive] = useState(false);
  const [isGlobalFileDragActive, setIsGlobalFileDragActive] = useState(false);
  const [hoverPreview, setHoverPreview] = useState<{ url: string; x: number; y: number } | null>(null);
  const [overlayBounds, setOverlayBounds] = useState<DOMRect | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const colorControlRef = useRef<HTMLDivElement | null>(null);
  const bgOpacityControlRef = useRef<HTMLDivElement | null>(null);
  const bgRadiusControlRef = useRef<HTMLDivElement | null>(null);
  const lineHeightControlRef = useRef<HTMLDivElement | null>(null);
  const justifyEditorRef = useRef<HTMLDivElement | null>(null);
  const textMeasureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const deckDragDepthRef = useRef(0);
  const globalFileDragDepthRef = useRef(0);
  const [isColorControlOpen, setIsColorControlOpen] = useState(false);
  const [isBgOpacityOpen, setIsBgOpacityOpen] = useState(false);
  const [isBgRadiusOpen, setIsBgRadiusOpen] = useState(false);
  const [isLineHeightOpen, setIsLineHeightOpen] = useState(false);

  const assetsRef = useRef<EditorAsset[]>([]);
  const stickersRef = useRef<StickerAsset[]>([]);
  const layersRef = useRef<Layer[]>([]);
  const readyItemsRef = useRef<ReadyItem[]>([]);

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
    };
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (colorControlRef.current?.contains(target)) return;
      if (bgOpacityControlRef.current?.contains(target)) return;
      if (bgRadiusControlRef.current?.contains(target)) return;
      if (lineHeightControlRef.current?.contains(target)) return;
      setIsColorControlOpen(false);
      setIsBgOpacityOpen(false);
      setIsBgRadiusOpen(false);
      setIsLineHeightOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, []);

  useEffect(() => {
    if (textBgMode !== 'none') return;
    setIsBgOpacityOpen(false);
    setIsBgRadiusOpen(false);
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
  const selectedTextAlign = selectedLayer?.type === 'text' ? selectedLayer.align : null;

  useEffect(() => {
    if (!selectedLayer || selectedLayer.type !== 'text') return;
    setTextSize(selectedLayer.size);
    setTextSizeInput(String(selectedLayer.size));
    setTextFont(selectedLayer.fontFamily);
    setTextAlign(selectedLayer.align);
    const nextLineHeight = normalizeTextLineHeightOption(getTextLayerLineHeight(selectedLayer));
    setTextLineHeight(nextLineHeight);
    setTextColor(selectedLayer.color);
    setTextBold(selectedLayer.bold);
    setTextItalic(selectedLayer.italic);
    setTextUnderline(selectedLayer.underline);
    setTextStrike(selectedLayer.strike);
    setTextOpacity(getTextLayerBgOpacity(selectedLayer));
    setTextBgMode(selectedLayer.bgMode);
    setTextBgA(selectedLayer.bgA);
    setTextBgB(selectedLayer.bgB);
    setTextPadding(selectedLayer.padding);
    setTextRadius(selectedLayer.radius);
  }, [selectedLayerId, selectedLayer]);

  useEffect(() => {
    if (!selectedLayer || selectedLayer.type !== 'text' || selectedLayer.align !== 'justify') return;
    const editor = justifyEditorRef.current;
    if (!editor) return;
    const currentText = normalizeEditableText(editor.innerText);
    if (currentText !== selectedLayer.text) {
      editor.innerText = selectedLayer.text;
    }
  }, [selectedLayerId, selectedLayer]);

  useEffect(() => {
    if (!selectedLayer || selectedLayer.type !== 'text' || selectedLayer.align !== 'justify') return;
    const editor = justifyEditorRef.current;
    if (!editor || document.activeElement === editor) return;
    editor.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }, [selectedLayerId, selectedTextAlign]);

  const handleUploadClick = () => fileInputRef.current?.click();

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

  const getTextLayerPadding = (_layer: TextLayer) => 0;
  const getTextLayerFont = (layer: TextLayer) =>
    `${layer.italic ? 'italic ' : ''}${layer.bold ? 700 : 500} ${clamp(layer.size, 1, 300)}px ${layer.fontFamily}, Roboto, 'Segoe UI', sans-serif`;

  const getTextLayerContentWidthPercent = (layer: TextLayer, bounds: DOMRect) => {
    if (bounds.width <= 0) return layer.boxWidth;
    const ctx = getTextMeasureContext();
    if (!ctx) return layer.boxWidth;
    const padding = getTextLayerPadding(layer);
    ctx.font = getTextLayerFont(layer);
    const hardLines = (layer.text || ' ').split(/\r?\n/);
    const widestLine = hardLines.reduce((max, line) => Math.max(max, ctx.measureText(line || ' ').width), 0);
    const contentWidthPx = Math.max(10, widestLine + padding * 2);
    return (contentWidthPx / bounds.width) * 100;
  };

  const getTextLayerContentHeightPercent = (layer: TextLayer, bounds: DOMRect) => {
    if (bounds.width <= 0 || bounds.height <= 0) return getTextLayerHeight(layer);
    const ctx = getTextMeasureContext();
    if (!ctx) return getTextLayerHeight(layer);
    const padding = getTextLayerPadding(layer);
    const boxWidthPx = Math.max(10, (layer.boxWidth / 100) * bounds.width);
    const maxTextWidth = Math.max(12, boxWidthPx - padding * 2);
    const fontSize = clamp(layer.size, 1, 300);
    ctx.font = getTextLayerFont(layer);
    const lines = wrapTextLines(ctx, layer.text || ' ', maxTextWidth);
    const lineHeight = fontSize * getTextLayerLineHeight(layer);
    const contentHeightPx = Math.max(lineHeight + padding * 2, lines.length * lineHeight + padding * 2);
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

  const getTextLayerVerticalInsetPx = (layer: TextLayer, bounds: DOMRect | null) => {
    if (!bounds || bounds.height <= 0) return 0;
    const boxHeightPx = Math.max(1, (getTextLayerHeight(layer) / 100) * bounds.height);
    const contentHeightPx = Math.max(1, (getTextLayerContentHeightPercent(layer, bounds) / 100) * bounds.height);
    return Math.max(0, (boxHeightPx - contentHeightPx) / 2);
  };

  const buildTextLayer = (text: string): TextLayer => ({
    id: `layer-${createId()}`,
    type: 'text',
    text,
    x: 8,
    y: 8,
    boxWidth: 10,
    boxHeight: 8,
    minBoxHeight: 8,
    size: clamp(Math.round(textSize), 1, 300),
    fontFamily: textFont,
    align: textAlign,
    lineHeight: normalizeTextLineHeightOption(textLineHeight),
    color: textColor,
    bold: textBold,
    italic: textItalic,
    underline: textUnderline,
    strike: textStrike,
    opacity: clamp(Math.round(textOpacity), 0, 100),
    bgMode: textBgMode,
    bgA: textBgA,
    bgB: textBgB,
    padding: clamp(Math.round(textPadding), 0, 80),
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

  const applyTextOpacity = (rawValue: number) => {
    const opacity = clamp(Math.round(rawValue), 0, 100);
    setTextOpacity(opacity);
    updateSelectedTextLayer({ opacity });
  };

  const applyTextRadius = (rawValue: number) => {
    const radius = clamp(Math.round(rawValue), 0, 80);
    setTextRadius(radius);
    updateSelectedTextLayer({ radius });
  };

  const handleTextLayerInput = (layerId: string, value: string) => {
    const bounds = overlayRef.current?.getBoundingClientRect();
    setLayers((prev) =>
      prev.map((layer) => {
        if (layer.id !== layerId || layer.type !== 'text') return layer;
        const nextLayer: TextLayer = { ...layer, text: value };
        if (!bounds) return nextLayer;
        return fitTextLayerToContent(nextLayer, bounds);
      }),
    );
  };

  const layerPointerDown = (
    event: ReactPointerEvent<HTMLElement>,
    layerId: string,
    mode: 'move' | 'resize' = 'move',
    resizeHandle: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 'e' | 's' | 'w' = 'se',
  ) => {
    if (!overlayRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const target = layers.find((layer) => layer.id === layerId);
    if (!target) return;
    dragRef.current = {
      layerId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: target.x,
      startY: target.y,
      startWidth: target.type === 'text' ? target.boxWidth : undefined,
      startHeight: target.type === 'text' ? getTextLayerHeight(target) : undefined,
      mode,
      resizeHandle,
      bounds: overlayRef.current.getBoundingClientRect(),
    };
    setSelectedLayerId(layerId);
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
          const nextX = clamp(drag.startX + (dx / drag.bounds.width) * 100, 0, 100);
          const nextY = clamp(drag.startY + (dy / drag.bounds.height) * 100, 0, 100);
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

  const renderOne = async (asset: EditorAsset, layerList: Layer[]) => {
    const base = await getDecodedImage(asset.previewUrl);
    const canvas = document.createElement('canvas');
    canvas.width = asset.width;
    canvas.height = asset.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported.');

    ctx.drawImage(base, 0, 0, asset.width, asset.height);

    for (const layer of layerList) {
      if (layer.type === 'text') {
        const x = (layer.x / 100) * asset.width;
        const y = (layer.y / 100) * asset.height;
        const boxWidth = Math.max(10, (layer.boxWidth / 100) * asset.width);
        const boxHeight = Math.max(10, (getTextLayerHeight(layer) / 100) * asset.height);
        const padding = getTextLayerPadding(layer);
        const fontSize = clamp(layer.size, 1, 300);
        const lineHeight = fontSize * getTextLayerLineHeight(layer);
        const contentMaxWidth = Math.max(12, boxWidth - padding * 2);

        ctx.save();
        ctx.font = `${layer.italic ? 'italic ' : ''}${layer.bold ? 700 : 500} ${fontSize}px ${layer.fontFamily}, Roboto, 'Segoe UI', sans-serif`;
        const alignForCanvas = layer.align === 'justify' ? 'left' : layer.align;
        ctx.textAlign = alignForCanvas;
        ctx.textBaseline = 'top';
        const lines = wrapTextLines(ctx, layer.text || ' ', contentMaxWidth);
        const maxTextHeight = Math.max(lineHeight, boxHeight - padding * 2);
        const maxLines = Math.max(1, Math.floor(maxTextHeight / lineHeight));
        const visibleLines = lines.slice(0, maxLines);

        if (layer.bgMode !== 'none') {
          const left = x;
          const top = y;
          ctx.save();
          ctx.globalAlpha = getTextLayerBgOpacity(layer) / 100;
          if (layer.bgMode === 'gradient') {
            const gradient = ctx.createLinearGradient(left, top, left + boxWidth, top + boxHeight);
            gradient.addColorStop(0, layer.bgA);
            gradient.addColorStop(1, layer.bgB);
            ctx.fillStyle = gradient;
          } else {
            ctx.fillStyle = layer.bgA;
          }
          drawRoundRect(ctx, left, top, boxWidth, boxHeight, layer.radius);
          ctx.fill();
          ctx.restore();
        }

        ctx.fillStyle = layer.color;
        const anchorX = alignForCanvas === 'left'
          ? x + padding
          : alignForCanvas === 'right'
            ? x + boxWidth - padding
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
          const lineY = y + padding + lineHeight * index;
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
            let cursorX = x + padding;
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
      const centerX = (layer.x / 100) * asset.width;
      const centerY = (layer.y / 100) * asset.height;
      const drawWidth = (layer.scale / 100) * asset.width;
      const ratio = sticker.height > 0 ? sticker.width / sticker.height : 1;
      const drawHeight = drawWidth / ratio;

      ctx.save();
      ctx.globalAlpha = clamp(layer.opacity / 100, 0.01, 1);
      ctx.translate(centerX, centerY);
      ctx.rotate((layer.rotation * Math.PI) / 180);
      ctx.drawImage(stickerImage, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
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

  const renderCurrent = async () => {
    if (!currentAsset || isWorking) return;
    setIsWorking(true);
    try {
      const out = await renderOne(currentAsset, layersRef.current);
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
        const out = await renderOne(asset, layersRef.current);
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

  const handleCopyResultNames = async () => {
    if (!readyItems.length) return;
    await navigator.clipboard.writeText(readyItems.map((item) => item.name).join('\n'));
  };

  const handleClearLayers = () => {
    setLayers([]);
    setSelectedLayerId(null);
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
      const verticalInsetPx = getTextLayerVerticalInsetPx(layer, overlayBounds);
      const background = layer.bgMode === 'none'
        ? 'transparent'
        : layer.bgMode === 'gradient'
          ? `linear-gradient(135deg, ${layer.bgA}, ${layer.bgB})`
          : layer.bgA;

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
            padding: '0',
            borderRadius: layer.bgMode === 'none' ? '0' : `${layer.radius}px`,
          }}
          onPointerDown={(event) => layerPointerDown(event, layer.id, 'move')}
          title={`Text ${index + 1}`}
        >
          {layer.bgMode !== 'none' ? (
            <span
              className="editor-layer-text-background"
              aria-hidden="true"
              style={{
                background,
                borderRadius: `${layer.radius}px`,
                opacity: getTextLayerBgOpacity(layer) / 100,
              }}
            />
          ) : null}
          {isSelected ? (
            layer.align === 'justify' ? (
              <div
                ref={justifyEditorRef}
                contentEditable
                suppressContentEditableWarning
                className="editor-layer-text-editor editor-layer-text-editor-contenteditable"
                onInput={(event) => handleTextLayerInput(layer.id, normalizeEditableText(event.currentTarget.innerText))}
                onPointerDown={(event) => event.stopPropagation()}
                style={{
                  textDecorationLine: textDecorationFromFlags(layer.underline, layer.strike),
                  textDecorationThickness: '0.08em',
                  textUnderlineOffset: '0.14em',
                  paddingTop: `${verticalInsetPx}px`,
                  paddingBottom: `${verticalInsetPx}px`,
                }}
              />
            ) : (
              <textarea
                className="editor-layer-text-editor"
                value={layer.text}
                onChange={(event) => handleTextLayerInput(layer.id, event.target.value)}
                onPointerDown={(event) => event.stopPropagation()}
                rows={1}
                autoFocus
                style={{
                  textDecorationLine: textDecorationFromFlags(layer.underline, layer.strike),
                  textDecorationThickness: '0.08em',
                  textUnderlineOffset: '0.14em',
                  paddingTop: `${verticalInsetPx}px`,
                  paddingBottom: `${verticalInsetPx}px`,
                }}
              />
            )
          ) : (
            <div
              className="editor-layer-text-view"
              style={{
                paddingTop: `${verticalInsetPx}px`,
                paddingBottom: `${verticalInsetPx}px`,
              }}
            >
              {layer.text}
            </div>
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

    return (
      <div
        key={layer.id}
        className={`editor-layer editor-layer-sticker${isSelected ? ' is-selected' : ''}`}
        style={{
          left: `${layer.x}%`,
          top: `${layer.y}%`,
          width: `${layer.scale}%`,
          transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)`,
          opacity: layer.opacity / 100,
        }}
        onPointerDown={(event) => layerPointerDown(event, layer.id)}
        title={`Sticker ${index + 1}`}
      >
        <img src={sticker.previewUrl} alt="Sticker layer" />
      </div>
    );
  };

  return (
    <section className="creative-editor">
      <section className="card controls-wrapper">
        <h1>Creative Editor</h1>
        <p>Upload images, add text layers, then export edited creatives as a ZIP.</p>

        <div className="controls">
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
              <button type="button" onClick={addTextLayer} disabled={!assets.length}>
                Add text layer
              </button>
            </div>
          </div>
        </header>

        <div className="editor-text-toolbar">
          <div className="editor-text-toolbar-row editor-text-toolbar-row-main">
            <div className="editor-text-field editor-text-field-bg-mode editor-text-field-compact">
              <label className="editor-visually-hidden">Background mode</label>
              <select
                value={textBgMode}
                onChange={(event) => {
                  const bgMode = event.target.value as TextBgMode;
                  setTextBgMode(bgMode);
                  updateSelectedTextLayer({ bgMode });
                }}
              >
                <option value="none">None</option>
                <option value="solid">Solid</option>
                <option value="gradient">Gradient</option>
              </select>
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
                      setIsLineHeightOpen(false);
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
                      <span>{textRadius}</span>
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
                      setIsLineHeightOpen(false);
                      setIsBgRadiusOpen(false);
                      setIsBgOpacityOpen((prev) => !prev);
                    }}
                    disabled={textBgMode === 'none'}
                    title="Background opacity"
                    aria-label="Background opacity"
                    aria-expanded={isBgOpacityOpen}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="12" cy="12" r="7" />
                      <path d="M12 5a7 7 0 0 0 0 14V5Z" fill="currentColor" stroke="none" />
                    </svg>
                  </button>
                  {isBgOpacityOpen && textBgMode !== 'none' ? (
                    <div className="editor-bg-opacity-popover" role="dialog" aria-label="Background opacity">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={textOpacity}
                        onChange={(event) => applyTextOpacity(Number(event.target.value))}
                      />
                      <span>{textOpacity}%</span>
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
                  <span className="editor-gradient-color-letter" aria-hidden="true">A</span>
                  <input
                    type="color"
                    value={textBgA}
                    onChange={(event) => {
                      const bgA = event.target.value;
                      setTextBgA(bgA);
                      updateSelectedTextLayer({ bgA });
                    }}
                    disabled={textBgMode === 'none'}
                  />
                </label>
              </div>

              <div className={`editor-gradient-control-slot${textBgMode === 'gradient' ? ' is-visible' : ''}`}>
                <label
                  className={`editor-gradient-color-trigger${textBgMode !== 'gradient' ? ' is-disabled' : ''}`}
                  style={{ '--editor-gradient-color': textBgB } as CSSProperties}
                >
                  <span className="editor-visually-hidden">Background color B</span>
                  <span className="editor-gradient-color-letter" aria-hidden="true">B</span>
                  <input
                    type="color"
                    value={textBgB}
                    onChange={(event) => {
                      const bgB = event.target.value;
                      setTextBgB(bgB);
                      updateSelectedTextLayer({ bgB });
                    }}
                    disabled={textBgMode !== 'gradient'}
                  />
                </label>
              </div>
            </div>

            <div className="editor-text-field editor-text-field-font">
              <label className="editor-visually-hidden">Font</label>
              <select
                value={textFont}
                onChange={(event) => {
                  const fontFamily = event.target.value;
                  setTextFont(fontFamily);
                  updateSelectedTextLayer({ fontFamily });
                }}
              >
                {textFontOptions.map((font) => (
                  <option key={font} value={font}>
                    {font}
                  </option>
                ))}
              </select>
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
                  onClick={() => {
                    setIsBgOpacityOpen(false);
                    setIsBgRadiusOpen(false);
                    setIsLineHeightOpen(false);
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
                          updateSelectedTextLayer({ color });
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
                onClick={() => {
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
                onClick={() => {
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
                onClick={() => {
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
                onClick={() => {
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
                    setIsBgRadiusOpen(false);
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
              <button type="button" onClick={() => { void handleCopyResultNames(); }} disabled={!readyItems.length || isWorking}>
                Copy names
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
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M5 20h14v-2H5v2zM11 2h2v10.17l3.59-3.58L18 10l-6 6-6-6 1.41-1.41L11 12.17V2z" />
                      </svg>
                    </button>
                  </div>
                </div>
                <button type="button" className="resizer-ready-remove" onClick={() => handleRemoveReady(item.id)}>
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

