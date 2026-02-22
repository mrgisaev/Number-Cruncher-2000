
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

type TextLayer = {
  id: string;
  type: 'text';
  text: string;
  x: number;
  y: number;
  boxWidth: number;
  boxHeight: number;
  size: number;
  fontFamily: string;
  align: 'left' | 'center' | 'right';
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
  resizeHandle?: 'nw' | 'ne' | 'sw' | 'se';
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
const getTextLayerHeight = (layer: TextLayer) => (Number.isFinite(layer.boxHeight) && layer.boxHeight > 0 ? layer.boxHeight : 22);
const getTextLayerBgOpacity = (layer: TextLayer) => (Number.isFinite(layer.opacity) ? clamp(Math.round(layer.opacity), 0, 100) : 100);

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
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>('center');
  const [textColor, setTextColor] = useState('#ffffff');
  const [textBold, setTextBold] = useState(true);
  const [textItalic, setTextItalic] = useState(false);
  const [textUnderline, setTextUnderline] = useState(false);
  const [textStrike, setTextStrike] = useState(false);
  const [textOpacity, setTextOpacity] = useState(100);
  const [textBgMode, setTextBgMode] = useState<TextBgMode>('none');
  const [textBgA, setTextBgA] = useState('#000000aa');
  const [textBgB, setTextBgB] = useState('#0ea5e9aa');
  const [textPadding, setTextPadding] = useState(12);
  const [textRadius, setTextRadius] = useState(12);

  const [selectedStickerId, setSelectedStickerId] = useState('');
  const [stickerScale, setStickerScale] = useState(24);
  const [stickerRotation, setStickerRotation] = useState(0);
  const [stickerOpacity, setStickerOpacity] = useState(100);

  const [isDeckDropActive, setIsDeckDropActive] = useState(false);
  const [hoverPreview, setHoverPreview] = useState<{ url: string; x: number; y: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stickerInputRef = useRef<HTMLInputElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const colorControlRef = useRef<HTMLDivElement | null>(null);
  const bgOpacityControlRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const deckDragDepthRef = useRef(0);
  const [isColorControlOpen, setIsColorControlOpen] = useState(false);
  const [isBgOpacityOpen, setIsBgOpacityOpen] = useState(false);

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
      setIsColorControlOpen(false);
      setIsBgOpacityOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, []);

  useEffect(() => {
    if (textBgMode !== 'none') return;
    setIsBgOpacityOpen(false);
  }, [textBgMode]);

  const currentAsset = assets[currentIndex] ?? null;
  const selectedLayer = layers.find((layer) => layer.id === selectedLayerId) ?? null;

  useEffect(() => {
    if (!selectedLayer || selectedLayer.type !== 'text') return;
    setTextSize(selectedLayer.size);
    setTextSizeInput(String(selectedLayer.size));
    setTextFont(selectedLayer.fontFamily);
    setTextAlign(selectedLayer.align);
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

  const handleUploadClick = () => fileInputRef.current?.click();
  const handleStickerUploadClick = () => stickerInputRef.current?.click();

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

  const handleStickerFilesAdded = async (list: FileList | null) => {
    if (!list) return;
    const files = Array.from(list).filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;

    const loaded = await Promise.all(files.map(async (file) => {
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

    setStickers((prev) => {
      const merged = [...prev, ...nextStickers];
      if (!selectedStickerId) setSelectedStickerId(nextStickers[0].id);
      return merged;
    });
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

  const buildTextLayer = (text: string): TextLayer => ({
    id: `layer-${createId()}`,
    type: 'text',
    text,
    x: 8,
    y: 8,
    boxWidth: 38,
    boxHeight: 22,
    size: clamp(Math.round(textSize), 1, 300),
    fontFamily: textFont,
    align: textAlign,
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
    const next = buildTextLayer(text);
    setLayers((prev) => [...prev, next]);
    setSelectedLayerId(next.id);
  };

  const addStickerLayer = () => {
    const stickerId = selectedStickerId || stickers[0]?.id;
    if (!stickerId) return;
    const next: StickerLayer = {
      id: `layer-${createId()}`,
      type: 'sticker',
      stickerId,
      x: 50,
      y: 50,
      scale: clamp(stickerScale, 2, 100),
      rotation: clamp(stickerRotation, -180, 180),
      opacity: clamp(stickerOpacity, 1, 100),
    };
    setLayers((prev) => [...prev, next]);
    setSelectedLayerId(next.id);
  };

  const updateSelected = (updater: (layer: Layer) => Layer) => {
    if (!selectedLayerId) return;
    setLayers((prev) => prev.map((layer) => (layer.id === selectedLayerId ? updater(layer) : layer)));
  };

  const removeSelected = () => {
    if (!selectedLayerId) return;
    setLayers((prev) => prev.filter((layer) => layer.id !== selectedLayerId));
    setSelectedLayerId(null);
  };

  const updateSelectedTextLayer = (patch: Partial<TextLayer>) => {
    if (!selectedLayer || selectedLayer.type !== 'text') return;
    updateSelected((layer) => (layer.type === 'text' ? { ...layer, ...patch } : layer));
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

  const applyTextOpacity = (rawValue: number) => {
    const opacity = clamp(Math.round(rawValue), 0, 100);
    setTextOpacity(opacity);
    updateSelectedTextLayer({ opacity });
  };

  const handleTextLayerInput = (layerId: string, value: string) => {
    setLayers((prev) => prev.map((layer) => (layer.id === layerId && layer.type === 'text' ? { ...layer, text: value } : layer)));
  };

  const layerPointerDown = (
    event: ReactPointerEvent<HTMLElement>,
    layerId: string,
    mode: 'move' | 'resize' = 'move',
    resizeHandle: 'nw' | 'ne' | 'sw' | 'se' = 'se',
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

              return {
                ...layer,
                x: nextLeft,
                y: nextTop,
                boxWidth: nextRight - nextLeft,
                boxHeight: nextBottom - nextTop,
              };
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
        const fontSize = clamp(layer.size, 1, 300);
        const lineHeight = fontSize * 1.24;

        ctx.save();
        ctx.font = `${layer.italic ? 'italic ' : ''}${layer.bold ? 700 : 500} ${fontSize}px ${layer.fontFamily}, Roboto, 'Segoe UI', sans-serif`;
        ctx.textAlign = layer.align;
        ctx.textBaseline = 'top';
        const lines = wrapTextLines(ctx, layer.text || ' ', Math.max(12, boxWidth - layer.padding * 2));
        const maxTextHeight = Math.max(lineHeight, boxHeight - layer.padding * 2);
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
        const anchorX = layer.align === 'left'
          ? x + layer.padding
          : layer.align === 'right'
            ? x + boxWidth - layer.padding
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
          const lineY = y + layer.padding + lineHeight * index;
          ctx.fillText(line, anchorX, lineY);
          const lineWidth = ctx.measureText(line || ' ').width;
          const lineStartX = layer.align === 'left'
            ? anchorX
            : layer.align === 'right'
              ? anchorX - lineWidth
              : anchorX - lineWidth / 2;
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
    setSelectedStickerId('');
    handleClearLayers();
    handleClearReady();
  };

  const handleDeckDragEnter = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    deckDragDepthRef.current += 1;
    setIsDeckDropActive(true);
  };

  const handleDeckDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDeckDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    deckDragDepthRef.current = Math.max(0, deckDragDepthRef.current - 1);
    if (deckDragDepthRef.current === 0) {
      setIsDeckDropActive(false);
    }
  };

  const handleDeckDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    deckDragDepthRef.current = 0;
    setIsDeckDropActive(false);
    void handleFilesAdded(event.dataTransfer.files);
  };

  const handleOpenReadyInNewTab = (item: ReadyItem) => {
    window.open(item.previewUrl, '_blank', 'noopener,noreferrer');
  };

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
            fontWeight: layer.bold ? 700 : 500,
            fontStyle: layer.italic ? 'italic' : 'normal',
            textDecorationLine: textDecorationFromFlags(layer.underline, layer.strike),
            textDecorationThickness: '0.08em',
            textUnderlineOffset: '0.14em',
            color: layer.color,
            padding: layer.bgMode === 'none' ? '0' : `${layer.padding}px`,
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
              }}
            />
          ) : (
            <div className="editor-layer-text-view">{layer.text}</div>
          )}
          {isSelected ? (
            <>
              <span
                className="editor-layer-resize-handle editor-layer-resize-handle-nw"
                onPointerDown={(event) => layerPointerDown(event, layer.id, 'resize', 'nw')}
                title="Resize text box"
              />
              <span
                className="editor-layer-resize-handle editor-layer-resize-handle-ne"
                onPointerDown={(event) => layerPointerDown(event, layer.id, 'resize', 'ne')}
                title="Resize text box"
              />
              <span
                className="editor-layer-resize-handle editor-layer-resize-handle-sw"
                onPointerDown={(event) => layerPointerDown(event, layer.id, 'resize', 'sw')}
                title="Resize text box"
              />
              <span
                className="editor-layer-resize-handle editor-layer-resize-handle-se"
                onPointerDown={(event) => layerPointerDown(event, layer.id, 'resize', 'se')}
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
        <p>Upload images, add text and sticker layers, then export edited creatives as a ZIP.</p>

        <div className="controls">
          <div className="resizer-primary-actions">
            <button type="button" onClick={handleUploadClick} disabled={isWorking}>
              Upload ZIPs or files
            </button>
            <button type="button" onClick={handleStickerUploadClick} disabled={isWorking}>
              Upload stickers
            </button>
            <button type="button" onClick={handleClearAll} disabled={isWorking || (!assets.length && !stickers.length && !readyItems.length)}>
              Clear all
            </button>
          </div>

          <div className="editor-controls-grid">
            <div className="editor-control-card">
              <label>Sticker layer</label>
              <select
                value={selectedStickerId}
                onChange={(event) => setSelectedStickerId(event.target.value)}
                disabled={!stickers.length}
              >
                {stickers.length ? (
                  stickers.map((sticker, index) => (
                    <option key={sticker.id} value={sticker.id}>
                      Sticker {index + 1} ({sticker.width}x{sticker.height})
                    </option>
                  ))
                ) : (
                  <option value="">No stickers</option>
                )}
              </select>
              <div className="editor-inline-fields">
                <input
                  type="number"
                  min={2}
                  max={100}
                  value={stickerScale}
                  onChange={(event) => setStickerScale(clamp(Number(event.target.value) || 2, 2, 100))}
                  title="Scale %"
                />
                <input
                  type="number"
                  min={-180}
                  max={180}
                  value={stickerRotation}
                  onChange={(event) => setStickerRotation(clamp(Number(event.target.value) || 0, -180, 180))}
                  title="Rotation"
                />
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={stickerOpacity}
                  onChange={(event) => setStickerOpacity(clamp(Number(event.target.value), 10, 100))}
                  title="Opacity"
                />
              </div>
              <div className="editor-inline-actions">
                <button type="button" onClick={addStickerLayer} disabled={!assets.length || !stickers.length}>
                  Add sticker
                </button>
              </div>
            </div>

            <div className="editor-control-card">
              <label>Layers</label>
              {selectedLayer ? (
                <>
                  <p className="editor-selected-label">
                    {selectedLayer.type === 'text' ? 'Text layer selected' : 'Sticker layer selected'}
                  </p>
                  <div className="editor-inline-actions">
                    <button type="button" className="clear-action-button" onClick={removeSelected}>
                      Remove selected
                    </button>
                    <button type="button" className="clear-action-button" onClick={handleClearLayers} disabled={!layers.length}>
                      Clear layers
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="muted">Click a layer in preview to edit or remove it.</p>
                  <div className="editor-inline-actions">
                    <button type="button" className="clear-action-button" onClick={handleClearLayers} disabled={!layers.length}>
                      Clear layers
                    </button>
                  </div>
                </>
              )}
            </div>
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
          accept="image/*"
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
          className={`resizer-deck-row${isDeckDropActive ? ' is-drop-active' : ''}`}
          onDragEnter={handleDeckDragEnter}
          onDragOver={handleDeckDragOver}
          onDragLeave={handleDeckDragLeave}
          onDrop={handleDeckDrop}
        >
          <button type="button" className="resizer-nav-button" onClick={() => handleStepAsset(-1)} disabled={currentIndex <= 0}>
            ‹
          </button>
          <div className="resizer-deck">
            {isDeckDropActive ? (
              <div className="resizer-deck-dropzone">
                <span>Drop files here</span>
              </div>
            ) : null}
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
                <div className="editor-bg-opacity-control" ref={bgOpacityControlRef}>
                  <button
                    type="button"
                    className="editor-bg-opacity-button"
                    onClick={() => {
                      setIsColorControlOpen(false);
                      setIsBgOpacityOpen((prev) => !prev);
                    }}
                    disabled={textBgMode === 'none'}
                    title="Background opacity"
                    aria-label="Background opacity"
                    aria-expanded={isBgOpacityOpen}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 2.5c-2.9 3.7-5.5 7-5.5 10a5.5 5.5 0 0 0 11 0c0-3-2.6-6.3-5.5-10Zm0 3.2c2.1 2.8 3.6 4.9 3.6 6.8A3.6 3.6 0 0 1 12 16.1V5.7Z" />
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
                  <svg className="editor-gradient-color-trigger-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M14.27 5.73 18.27 9.73 10 18H6v-4l8.27-8.27ZM13.56 3.61a1.5 1.5 0 0 1 2.12 0l2.71 2.71a1.5 1.5 0 0 1 0 2.12l-1.06 1.06-4.83-4.83 1.06-1.06Z" />
                  </svg>
                  <svg className="editor-gradient-color-trigger-caret" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M7 10l5 5 5-5z" />
                  </svg>
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
                  <svg className="editor-gradient-color-trigger-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M14.27 5.73 18.27 9.73 10 18H6v-4l8.27-8.27ZM13.56 3.61a1.5 1.5 0 0 1 2.12 0l2.71 2.71a1.5 1.5 0 0 1 0 2.12l-1.06 1.06-4.83-4.83 1.06-1.06Z" />
                  </svg>
                  <svg className="editor-gradient-color-trigger-caret" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M7 10l5 5 5-5z" />
                  </svg>
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

