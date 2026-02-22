import {
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import JSZip from 'jszip';
import { storeResizerTransfer } from './lib/resizerTransfer';

type AspectPreset = 'free' | 'original' | '1:1' | '4:5' | '5:4' | '16:9' | '9:16' | '4:3' | '3:4' | 'custom';

type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se';

type DragState = {
  mode: DragMode;
  pointerId: number;
  startX: number;
  startY: number;
  startRect: CropRect;
  boundsWidth: number;
  boundsHeight: number;
  aspectRatio: number | null;
};

type PanDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startPanX: number;
  startPanY: number;
};

type ResizerAsset = {
  id: string;
  file: File;
  nameBase: string;
  extension: string;
  previewUrl: string;
  width: number;
  height: number;
  cropCount: number;
};

type ReadyItem = {
  id: string;
  assetId: string;
  name: string;
  blob: Blob;
  previewUrl: string;
  width: number;
  height: number;
};

type OutputSize = {
  width: number;
  height: number;
};

const aspectOptions: Array<{ value: AspectPreset; label: string }> = [
  { value: 'free', label: 'Free' },
  { value: 'original', label: 'Original' },
  { value: '1:1', label: '1:1' },
  { value: '4:5', label: '4:5' },
  { value: '5:4', label: '5:4' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: 'custom', label: 'Custom' },
];

const imageExtensions = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'tif',
  'tiff',
  'svg',
  'avif',
]);

const imageMimeByExtension: Record<string, string> = {
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

const imageExtensionByMime: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/tiff': 'tif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

const createId = () => Math.random().toString(36).slice(2, 10);

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getExtension = (name: string) => {
  const match = name.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : '';
};

const getBaseName = (name: string) => name.replace(/\.[^.]+$/, '');

const getLeafName = (path: string) => path.split('/').pop() ?? path;

const decodedImageCache = new Map<string, Promise<HTMLImageElement>>();

const getDecodedImage = (src: string) => {
  const cached = decodedImageCache.get(src);
  if (cached) {
    return cached;
  }
  const imagePromise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      decodedImageCache.delete(src);
      reject(new Error('Image load failed.'));
    };
    image.src = src;
  });
  decodedImageCache.set(src, imagePromise);
  return imagePromise;
};

const releaseDecodedImage = (src: string) => {
  decodedImageCache.delete(src);
};

const isZipFile = (file: File) => file.name.toLowerCase().endsWith('.zip');

const isImageName = (name: string) => imageExtensions.has(getExtension(name));

const isImageFile = (file: File) => file.type.startsWith('image/') || isImageName(file.name);

const isTextEntryTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement
  && (target.isContentEditable
    || target.tagName === 'INPUT'
    || target.tagName === 'TEXTAREA'
    || target.tagName === 'SELECT');

const quantizePngData = (data: Uint8ClampedArray, quality: number) => {
  const clamped = clamp(quality, 0.02, 1);
  if (clamped >= 0.999) {
    return;
  }
  const levels = Math.max(8, Math.round(8 + clamped * 248));
  const step = Math.max(1, Math.round(256 / levels));
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.round(data[i] / step) * step;
    data[i + 1] = Math.round(data[i + 1] / step) * step;
    data[i + 2] = Math.round(data[i + 2] / step) * step;
  }
};

const parsePositiveInt = (value: string) => {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseAspectPair = (value: string): { width: string; height: string } | null => {
  const normalized = value
    .replace(/[С…РҐГ—]/g, 'x')
    .replace(/\u00A0/g, ' ')
    .trim();
  const match = normalized.match(/(\d+)\s*(?:x|[:;,/\\|*_\-вЂ“вЂ”]|\s)\s*(\d+)/i);
  if (!match) {
    return null;
  }
  const width = parsePositiveInt(match[1]);
  const height = parsePositiveInt(match[2]);
  if (!width || !height) {
    return null;
  }
  return {
    width: String(width),
    height: String(height),
  };
};

const getAspectRatioFromPreset = (
  preset: AspectPreset,
  currentAsset: ResizerAsset | null,
  customW: string,
  customH: string,
) => {
  if (preset === 'free') {
    return null;
  }
  if (preset === 'original') {
    if (!currentAsset || currentAsset.height <= 0) {
      return null;
    }
    return currentAsset.width / currentAsset.height;
  }
  if (preset === 'custom') {
    const w = Number.parseFloat(customW);
    const h = Number.parseFloat(customH);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      return null;
    }
    return w / h;
  }
  const [wRaw, hRaw] = preset.split(':');
  const w = Number.parseFloat(wRaw);
  const h = Number.parseFloat(hRaw);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return null;
  }
  return w / h;
};

const getImageAspectRatio = (asset: ResizerAsset | null) => {
  if (!asset || asset.height <= 0) {
    return null;
  }
  return asset.width / asset.height;
};

const getNormalizedAspectRatio = (targetAspectRatio: number | null, imageAspectRatio: number | null) => {
  if (!targetAspectRatio || !imageAspectRatio || imageAspectRatio <= 0) {
    return null;
  }
  return targetAspectRatio / imageAspectRatio;
};

const buildDefaultRect = (normalizedAspectRatio: number | null): CropRect => {
  if (!normalizedAspectRatio) {
    const width = 0.8;
    const height = 0.8;
    return { x: 0, y: 0, width, height };
  }
  let width = 0.9;
  let height = width / normalizedAspectRatio;
  if (height > 0.9) {
    height = 0.9;
    width = height * normalizedAspectRatio;
  }
  const x = 0;
  const y = 0;
  return { x, y, width, height };
};

const fitRectToAspectAtPosition = (
  current: CropRect,
  normalizedAspectRatio: number | null,
): CropRect => {
  if (!normalizedAspectRatio) {
    return current;
  }
  const seeded = buildDefaultRect(normalizedAspectRatio);
  const x = clamp(current.x, 0, 1 - seeded.width);
  const y = clamp(current.y, 0, 1 - seeded.height);
  return {
    x,
    y,
    width: seeded.width,
    height: seeded.height,
  };
};

const loadImageMeta = (file: File) =>
  new Promise<{ width: number; height: number; url: string } | null>((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        url,
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });

const cropImageBlob = async (
  asset: ResizerAsset,
  rect: CropRect,
  outputSize: OutputSize | null = null,
  quality = 0.92,
  maxBytes: number | null = null,
  targetBytes: number | null = null,
) => {
  const image = await getDecodedImage(asset.previewUrl);

  const sourceX = Math.round(rect.x * asset.width);
  const sourceY = Math.round(rect.y * asset.height);
  const sourceW = Math.max(1, Math.round(rect.width * asset.width));
  const sourceH = Math.max(1, Math.round(rect.height * asset.height));
  const outputW = outputSize?.width ?? sourceW;
  const outputH = outputSize?.height ?? sourceH;
  const isFullImageCrop = sourceX <= 0
    && sourceY <= 0
    && sourceW >= asset.width
    && sourceH >= asset.height;
  const keepsOriginalDimensions = outputW === asset.width && outputH === asset.height;
  const keepsOriginalQuality = quality >= 0.999;

  if (isFullImageCrop && keepsOriginalDimensions && keepsOriginalQuality) {
    return {
      blob: asset.file,
      width: asset.width,
      height: asset.height,
    };
  }

  const canvas = document.createElement('canvas');
  canvas.width = outputW;
  canvas.height = outputH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas not supported.');
  }
  ctx.drawImage(image, sourceX, sourceY, sourceW, sourceH, 0, 0, outputW, outputH);

  const sourceMime = asset.file.type.toLowerCase();
  const mimeType = sourceMime === 'image/jpeg'
    || sourceMime === 'image/webp'
    || sourceMime === 'image/png'
    ? sourceMime
    : 'image/png';
  const isLossyMime = mimeType === 'image/jpeg' || mimeType === 'image/webp';
  const isPngMime = mimeType === 'image/png';
  const sourcePixels = isPngMime ? ctx.getImageData(0, 0, outputW, outputH) : null;
  const encodeCanvas = (encodeQuality: number) =>
    new Promise<Blob>((resolve, reject) => {
      if (isPngMime && sourcePixels) {
        const copied = new Uint8ClampedArray(sourcePixels.data);
        quantizePngData(copied, encodeQuality);
        ctx.putImageData(new ImageData(copied, outputW, outputH), 0, 0);
      }
      canvas.toBlob(
        (result) => {
          if (!result) {
            reject(new Error('Crop failed.'));
            return;
          }
          resolve(result);
        },
        mimeType,
        isLossyMime
          ? clamp(encodeQuality, 0.02, 1)
          : undefined,
      );
    });

  let blob = await encodeCanvas(quality);
  if (isLossyMime) {
    const hardLimit = maxBytes && maxBytes > 0 ? Math.floor(maxBytes) : null;
    const requestedTarget = targetBytes && targetBytes > 0 ? Math.floor(targetBytes) : null;
    const normalizedTarget = requestedTarget
      ? Math.max(1, hardLimit ? Math.min(requestedTarget, hardLimit) : requestedTarget)
      : hardLimit;

    if (normalizedTarget) {
      let low = 0.02;
      let high = 1;
      let bestUnderTarget: Blob | null = null;
      let bestOverTarget: Blob | null = null;
      let smallest = blob;

      for (let iteration = 0; iteration < 9; iteration += 1) {
        const probe = (low + high) / 2;
        const candidate = await encodeCanvas(probe);
        if (candidate.size < smallest.size) {
          smallest = candidate;
        }
        if (candidate.size <= normalizedTarget) {
          bestUnderTarget = candidate;
          low = probe;
        } else {
          bestOverTarget = candidate;
          high = probe;
        }
      }

      blob = bestUnderTarget ?? bestOverTarget ?? smallest;
      if (hardLimit && blob.size > hardLimit && smallest.size < blob.size) {
        blob = smallest;
      }
    }
  } else if (isPngMime && targetBytes && targetBytes > 0) {
    const hardLimit = maxBytes && maxBytes > 0 ? Math.floor(maxBytes) : null;
    const normalizedTarget = Math.max(1, hardLimit ? Math.min(Math.floor(targetBytes), hardLimit) : Math.floor(targetBytes));
    let low = 0.02;
    let high = clamp(quality, 0.02, 1);
    let bestUnderTarget: Blob | null = blob.size <= normalizedTarget ? blob : null;
    let bestOverTarget: Blob | null = blob.size > normalizedTarget ? blob : null;
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const probe = (low + high) / 2;
      const candidate = await encodeCanvas(probe);
      if (candidate.size <= normalizedTarget) {
        bestUnderTarget = candidate;
        low = probe;
      } else {
        bestOverTarget = candidate;
        high = probe;
      }
    }
    blob = bestUnderTarget ?? bestOverTarget ?? blob;
  }

  return {
    blob,
    width: outputW,
    height: outputH,
  };
};

const rotateImageBlob = async (sourceUrl: string, mimeType: string, direction: -90 | 90) => {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Image load failed.'));
    image.src = sourceUrl;
  });

  const sourceW = image.naturalWidth || image.width;
  const sourceH = image.naturalHeight || image.height;
  const canvas = document.createElement('canvas');
  canvas.width = sourceH;
  canvas.height = sourceW;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas not supported.');
  }

  if (direction === 90) {
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
  } else {
    ctx.translate(0, canvas.height);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(image, 0, 0, sourceW, sourceH);

  const rotated = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (!result) {
          reject(new Error('Rotate failed.'));
          return;
        }
        resolve(result);
      },
      mimeType,
      mimeType === 'image/jpeg' || mimeType === 'image/webp' ? 0.92 : undefined,
    );
  });

  return {
    blob: rotated,
    width: canvas.width,
    height: canvas.height,
  };
};

const convertBlobToPng = async (blob: Blob) => {
  if (blob.type === 'image/png') {
    return blob;
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Image load failed.'));
      image.src = objectUrl;
    });

    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas not supported.');
    }
    context.drawImage(image, 0, 0, width, height);

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (!result) {
          reject(new Error('PNG conversion failed.'));
          return;
        }
        resolve(result);
      }, 'image/png');
    });

    return pngBlob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const formatSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

export const CreativeResizer = () => {
  const [assets, setAssets] = useState<ResizerAsset[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [readyItems, setReadyItems] = useState<ReadyItem[]>([]);
  const [aspectPreset, setAspectPreset] = useState<AspectPreset>('free');
  const [customAspectW, setCustomAspectW] = useState('9');
  const [customAspectH, setCustomAspectH] = useState('16');
  const [useCustomOutputSize, setUseCustomOutputSize] = useState(false);
  const [cropRect, setCropRect] = useState<CropRect>({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
  const [isWorking, setIsWorking] = useState(false);
  const [isSendingToRenamer, setIsSendingToRenamer] = useState(false);
  const [sendError, setSendError] = useState('');
  const [zoomPercent, setZoomPercent] = useState(100);
  const [qualityPercent, setQualityPercent] = useState(100);
  const [qualityPreviewUrl, setQualityPreviewUrl] = useState<string | null>(null);
  const [qualityEstimatedSize, setQualityEstimatedSize] = useState('вЂ”');
  const [isDeckDropActive, setIsDeckDropActive] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isCropInteracting, setIsCropInteracting] = useState(false);
  const [hoverPreview, setHoverPreview] = useState<{ url: string; x: number; y: number } | null>(null);
  const [copiedReadyItemId, setCopiedReadyItemId] = useState<string | null>(null);
  const imageWrapRef = useRef<HTMLDivElement | null>(null);
  const zoomLayerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const panDragRef = useRef<PanDragState | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const assetsRef = useRef<ResizerAsset[]>([]);
  const readyItemsRef = useRef<ReadyItem[]>([]);
  const copiedReadyTimerRef = useRef<number | null>(null);
  const qualityPreviewTaskRef = useRef(0);
  const qualityEstimateTaskRef = useRef(0);
  const qualityPreviewUrlRef = useRef<string | null>(null);
  const deckDragDepthRef = useRef(0);

  const currentAsset = assets[currentIndex] ?? null;
  const deckStep = 52;
  const deckOffset = assets.length > 0
    ? (((assets.length - 1) / 2) - currentIndex) * deckStep
    : 0;
  const zoomScale = zoomPercent / 100;
  const qualityValue = clamp(qualityPercent / 100, 0.1, 1);
  const hasGifAsset = useMemo(
    () => assets.some((asset) => asset.extension === 'gif' || asset.file.type === 'image/gif'),
    [assets],
  );

  const activeAspectRatio = useMemo(
    () => getAspectRatioFromPreset(aspectPreset, currentAsset, customAspectW, customAspectH),
    [aspectPreset, currentAsset, customAspectW, customAspectH],
  );

  const imageAspectRatio = useMemo(
    () => getImageAspectRatio(currentAsset),
    [currentAsset],
  );

  const normalizedAspectRatio = useMemo(
    () => getNormalizedAspectRatio(activeAspectRatio, imageAspectRatio),
    [activeAspectRatio, imageAspectRatio],
  );

  const customOutputSize = useMemo<OutputSize | null>(() => {
    if (!useCustomOutputSize || aspectPreset !== 'custom') {
      return null;
    }
    const width = parsePositiveInt(customAspectW);
    const height = parsePositiveInt(customAspectH);
    if (!width || !height) {
      return null;
    }
    return { width, height };
  }, [useCustomOutputSize, aspectPreset, customAspectW, customAspectH]);

  const maxOutputBytes = useMemo<number | null>(() => {
    if (!currentAsset) {
      return null;
    }
    const areaRatio = clamp(cropRect.width * cropRect.height, 0.0001, 1);
    return Math.max(1, Math.floor(currentAsset.file.size * areaRatio));
  }, [currentAsset, cropRect.width, cropRect.height]);
  const targetOutputBytes = useMemo<number | null>(() => {
    if (!maxOutputBytes) {
      return null;
    }
    return Math.max(1, Math.floor(maxOutputBytes * (qualityPercent / 100)));
  }, [maxOutputBytes, qualityPercent]);

  const clampPanOffset = (x: number, y: number, scale = zoomScale) => {
    const wrap = imageWrapRef.current;
    if (!wrap || scale <= 1) {
      return { x: 0, y: 0 };
    }
    const width = wrap.offsetWidth;
    const height = wrap.offsetHeight;
    const maxX = Math.max(0, ((scale - 1) * width) / 2);
    const maxY = Math.max(0, ((scale - 1) * height) / 2);
    return {
      x: clamp(x, -maxX, maxX),
      y: clamp(y, -maxY, maxY),
    };
  };

  useEffect(() => {
    if (!currentAsset) {
      return;
    }
    setIsCropInteracting(false);
    setCropRect(buildDefaultRect(normalizedAspectRatio));
  }, [currentAsset?.id]);

  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  useEffect(() => {
    readyItemsRef.current = readyItems;
  }, [readyItems]);

  useEffect(() => {
    qualityPreviewUrlRef.current = qualityPreviewUrl;
  }, [qualityPreviewUrl]);

  useEffect(() => {
    return () => {
      assetsRef.current.forEach((asset) => {
        releaseDecodedImage(asset.previewUrl);
        URL.revokeObjectURL(asset.previewUrl);
      });
      readyItemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      if (qualityPreviewUrlRef.current) {
        URL.revokeObjectURL(qualityPreviewUrlRef.current);
        qualityPreviewUrlRef.current = null;
      }
      if (copiedReadyTimerRef.current) {
        window.clearTimeout(copiedReadyTimerRef.current);
        copiedReadyTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setPanOffset((prev) => clampPanOffset(prev.x, prev.y, zoomScale));
  }, [zoomScale, currentAsset?.id]);

  useEffect(() => {
    if (!currentAsset) {
      return;
    }
    setQualityPercent(100);
  }, [currentAsset?.id]);

  useEffect(() => {
    qualityPreviewTaskRef.current += 1;
    if (!currentAsset) {
      setQualityEstimatedSize('-');
      setQualityPreviewUrl((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev);
        }
        return null;
      });
      return undefined;
    }
    if (qualityPercent >= 100) {
      setQualityPreviewUrl((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev);
        }
        return null;
      });
      return undefined;
    }
    const taskId = qualityPreviewTaskRef.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const stagePreview = await cropImageBlob(
            currentAsset,
            { x: 0, y: 0, width: 1, height: 1 },
            null,
            qualityValue,
            null,
            null,
          );
          if (qualityPreviewTaskRef.current !== taskId) {
            return;
          }
          const nextUrl = URL.createObjectURL(stagePreview.blob);
          setQualityPreviewUrl((prev) => {
            if (prev) {
              URL.revokeObjectURL(prev);
            }
            return nextUrl;
          });
        } catch {
          if (qualityPreviewTaskRef.current !== taskId) {
            return;
          }
          setQualityPreviewUrl((prev) => {
            if (prev) {
              URL.revokeObjectURL(prev);
            }
            return null;
          });
        }
      })();
    }, 140);
    return () => {
      window.clearTimeout(timer);
    };
  }, [currentAsset, qualityValue, qualityPercent, targetOutputBytes]);

  useEffect(() => {
    qualityEstimateTaskRef.current += 1;
    if (!currentAsset) {
      setQualityEstimatedSize('-');
      return undefined;
    }
    if (isCropInteracting) {
      return undefined;
    }

    const taskId = qualityEstimateTaskRef.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const estimated = await cropImageBlob(
            currentAsset,
            cropRect,
            customOutputSize,
            qualityValue,
            maxOutputBytes,
            targetOutputBytes,
          );
          if (qualityEstimateTaskRef.current !== taskId) {
            return;
          }
          setQualityEstimatedSize(formatSize(estimated.blob.size));
        } catch {
          if (qualityEstimateTaskRef.current !== taskId) {
            return;
          }
          setQualityEstimatedSize('-');
        }
      })();
    }, 130);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    currentAsset,
    cropRect.x,
    cropRect.y,
    cropRect.width,
    cropRect.height,
    customOutputSize,
    qualityValue,
    maxOutputBytes,
    targetOutputBytes,
    isCropInteracting,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!assets.length || isTextEntryTarget(event.target)) {
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setCurrentIndex((prev) => clamp(prev - 1, 0, Math.max(assets.length - 1, 0)));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setCurrentIndex((prev) => clamp(prev + 1, 0, Math.max(assets.length - 1, 0)));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [assets.length]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const panDrag = panDragRef.current;
      if (!panDrag) {
        return;
      }
      if (event.pointerId !== panDrag.pointerId) {
        return;
      }
      const dx = event.clientX - panDrag.startX;
      const dy = event.clientY - panDrag.startY;
      const next = clampPanOffset(panDrag.startPanX + dx, panDrag.startPanY + dy, zoomScale);
      setPanOffset(next);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const panDrag = panDragRef.current;
      if (!panDrag) {
        return;
      }
      if (event.pointerId !== panDrag.pointerId) {
        return;
      }
      panDragRef.current = null;
      setIsPanning(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [zoomScale, currentAsset?.id]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      if (event.pointerId !== drag.pointerId) {
        return;
      }
      const minSize = 20;
      const minW = minSize / drag.boundsWidth;
      const minH = minSize / drag.boundsHeight;
      const dx = (event.clientX - drag.startX) / drag.boundsWidth;
      const dy = (event.clientY - drag.startY) / drag.boundsHeight;
      const start = drag.startRect;
      const right = start.x + start.width;
      const bottom = start.y + start.height;

      if (drag.mode === 'move') {
        const nextX = clamp(start.x + dx, 0, 1 - start.width);
        const nextY = clamp(start.y + dy, 0, 1 - start.height);
        setCropRect({ x: nextX, y: nextY, width: start.width, height: start.height });
        return;
      }

      if (!drag.aspectRatio) {
        if (drag.mode === 'nw') {
          const nextX = clamp(start.x + dx, 0, right - minW);
          const nextY = clamp(start.y + dy, 0, bottom - minH);
          setCropRect({ x: nextX, y: nextY, width: right - nextX, height: bottom - nextY });
          return;
        }
        if (drag.mode === 'ne') {
          const nextRight = clamp(right + dx, start.x + minW, 1);
          const nextY = clamp(start.y + dy, 0, bottom - minH);
          setCropRect({ x: start.x, y: nextY, width: nextRight - start.x, height: bottom - nextY });
          return;
        }
        if (drag.mode === 'sw') {
          const nextX = clamp(start.x + dx, 0, right - minW);
          const nextBottom = clamp(bottom + dy, start.y + minH, 1);
          setCropRect({ x: nextX, y: start.y, width: right - nextX, height: nextBottom - start.y });
          return;
        }
        const nextRight = clamp(right + dx, start.x + minW, 1);
        const nextBottom = clamp(bottom + dy, start.y + minH, 1);
        setCropRect({ x: start.x, y: start.y, width: nextRight - start.x, height: nextBottom - start.y });
        return;
      }

      const ratio = drag.aspectRatio;
      const cornerStart = (() => {
        if (drag.mode === 'nw') return { x: start.x, y: start.y, ax: right, ay: bottom, sx: -1, sy: -1 };
        if (drag.mode === 'ne') return { x: right, y: start.y, ax: start.x, ay: bottom, sx: 1, sy: -1 };
        if (drag.mode === 'sw') return { x: start.x, y: bottom, ax: right, ay: start.y, sx: -1, sy: 1 };
        return { x: right, y: bottom, ax: start.x, ay: start.y, sx: 1, sy: 1 };
      })();

      const currentCornerX = cornerStart.x + dx;
      const currentCornerY = cornerStart.y + dy;
      const distanceX = Math.abs(cornerStart.ax - currentCornerX);
      const distanceY = Math.abs(cornerStart.ay - currentCornerY);
      const minWidth = Math.max(minW, minH * ratio);
      const preferredW = Math.max(distanceX, distanceY * ratio, minWidth);
      const maxWByX = cornerStart.sx > 0 ? 1 - cornerStart.ax : cornerStart.ax;
      const maxHByY = cornerStart.sy > 0 ? 1 - cornerStart.ay : cornerStart.ay;
      const maxW = Math.max(minWidth, Math.min(maxWByX, maxHByY * ratio));
      const width = clamp(preferredW, minWidth, maxW);
      const height = width / ratio;
      const x = cornerStart.sx > 0 ? cornerStart.ax : cornerStart.ax - width;
      const y = cornerStart.sy > 0 ? cornerStart.ay : cornerStart.ay - height;
      setCropRect({
        x: clamp(x, 0, 1 - width),
        y: clamp(y, 0, 1 - height),
        width,
        height,
      });
    };

    const handlePointerUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      if (event.pointerId !== drag.pointerId) {
        return;
      }
      dragRef.current = null;
      setIsCropInteracting(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, []);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFilesAdded = async (list: FileList | null) => {
    if (!list) {
      return;
    }
    const incoming = Array.from(list);
    if (!incoming.length) {
      return;
    }

    const directImages = incoming.filter((file) => !isZipFile(file) && isImageFile(file));
    const zipFiles = incoming.filter(isZipFile);
    const extractedImages: File[] = [];

    for (const zipFile of zipFiles) {
      try {
        const zip = await JSZip.loadAsync(zipFile);
        const entries = Object.values(zip.files);
        for (const entry of entries) {
          if (entry.dir) {
            continue;
          }
          if (entry.name.startsWith('__MACOSX/')) {
            continue;
          }
          if (!isImageName(entry.name)) {
            continue;
          }
          const blob = await entry.async('blob');
          const fileName = getLeafName(entry.name);
          const extension = getExtension(fileName);
          const type = imageMimeByExtension[extension] ?? blob.type ?? '';
          extractedImages.push(new File([blob], fileName, { type }));
        }
      } catch {
        // Skip broken archives and continue processing other files.
      }
    }

    const imageFiles = [...directImages, ...extractedImages];
    if (!imageFiles.length) {
      return;
    }

    const loaded = await Promise.all(imageFiles.map(async (file) => {
      const meta = await loadImageMeta(file);
      if (!meta) {
        return null;
      }
      const extension = getExtension(file.name) || 'png';
      return {
        id: `asset-${createId()}`,
        file,
        nameBase: getBaseName(file.name),
        extension,
        previewUrl: meta.url,
        width: meta.width,
        height: meta.height,
        cropCount: 0,
      } satisfies ResizerAsset;
    }));

    const nextAssets = loaded.filter((item): item is ResizerAsset => item !== null);
    if (!nextAssets.length) {
      return;
    }
    setAssets((prev) => [...prev, ...nextAssets]);
  };

  const isFileDragEvent = (event: ReactDragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files');

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

  const handleStartDrag = (event: ReactPointerEvent<HTMLElement>, mode: DragMode) => {
    if (!zoomLayerRef.current) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setIsCropInteracting(true);
    const bounds = zoomLayerRef.current.getBoundingClientRect();
    dragRef.current = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRect: cropRect,
      boundsWidth: Math.max(1, bounds.width),
      boundsHeight: Math.max(1, bounds.height),
      aspectRatio: normalizedAspectRatio,
    };
  };

  const handleStartPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!currentAsset || isWorking || event.button !== 0 || zoomScale <= 1) {
      return;
    }
    if (dragRef.current) {
      return;
    }
    const target = event.target as HTMLElement;
    if (
      target.closest('.resizer-crop-box')
      || target.closest('.resizer-handle')
    ) {
      return;
    }
    event.preventDefault();
    panDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPanX: panOffset.x,
      startPanY: panOffset.y,
    };
    setIsPanning(true);
  };

  const applyResize = async () => {
    if (!currentAsset || isWorking) {
      return;
    }
    setIsWorking(true);
    try {
      const cropped = await cropImageBlob(
        currentAsset,
        cropRect,
        customOutputSize,
        qualityValue,
        maxOutputBytes,
        targetOutputBytes,
      );
      const nextCount = currentAsset.cropCount + 1;
      const outputExtension = imageExtensionByMime[cropped.blob.type] ?? currentAsset.extension;
      const name = `${currentAsset.nameBase}-crop-${String(nextCount).padStart(2, '0')}.${outputExtension}`;
      const previewUrl = URL.createObjectURL(cropped.blob);
      const readyId = `ready-${createId()}`;

      setReadyItems((prev) => [...prev, {
        id: readyId,
        assetId: currentAsset.id,
        name,
        blob: cropped.blob,
        previewUrl,
        width: cropped.width,
        height: cropped.height,
      }]);
      setAssets((prev) =>
        prev.map((asset) =>
          asset.id === currentAsset.id
            ? { ...asset, cropCount: asset.cropCount + 1 }
            : asset,
        ),
      );
    } catch {
      // keep state unchanged on crop failure
    } finally {
      setIsWorking(false);
    }
  };

  const handleDownloadZip = async () => {
    if (!readyItems.length || isWorking) {
      return;
    }
    const zip = new JSZip();
    readyItems.forEach((item) => {
      zip.file(item.name, item.blob);
    });
    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'creative-resizer.zip';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleSendToAssetRenamer = async () => {
    if (!readyItems.length || isWorking || isSendingToRenamer) {
      return;
    }
    setSendError('');
    setIsSendingToRenamer(true);
    try {
      const payloadId = await storeResizerTransfer(
        readyItems.map((item) => ({
          name: item.name,
          blob: item.blob,
          width: item.width,
          height: item.height,
        })),
      );
      window.location.href = `/creative-renamer.html?import=${encodeURIComponent(payloadId)}`;
    } catch {
      setSendError('Could not send files to Asset Renamer. Please try again.');
      setIsSendingToRenamer(false);
    }
  };

  const handleClearAssets = () => {
    assets.forEach((asset) => {
      releaseDecodedImage(asset.previewUrl);
      URL.revokeObjectURL(asset.previewUrl);
    });
    setAssets([]);
    setCurrentIndex(0);
    setCropRect({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
    setZoomPercent(100);
    setPanOffset({ x: 0, y: 0 });
    setIsCropInteracting(false);
  };

  const handleRemoveAsset = (assetId: string) => {
    setAssets((prev) => {
      const removedIndex = prev.findIndex((asset) => asset.id === assetId);
      if (removedIndex < 0) {
        return prev;
      }
      const target = prev[removedIndex];
      releaseDecodedImage(target.previewUrl);
      URL.revokeObjectURL(target.previewUrl);
      const next = prev.filter((asset) => asset.id !== assetId);
      setCurrentIndex((prevIndex) => {
        if (!next.length) {
          return 0;
        }
        if (removedIndex < prevIndex) {
          return prevIndex - 1;
        }
        if (removedIndex === prevIndex) {
          return Math.min(prevIndex, next.length - 1);
        }
        return prevIndex;
      });
      if (!next.length) {
        setZoomPercent(100);
        setPanOffset({ x: 0, y: 0 });
        setIsCropInteracting(false);
      }
      return next;
    });
  };

  const handleClearResults = () => {
    readyItems.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setReadyItems([]);
    setHoverPreview(null);
    setSendError('');
  };

  const handleDownloadReadyItem = (item: ReadyItem) => {
    const url = URL.createObjectURL(item.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = item.name;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenReadyItemInNewTab = (item: ReadyItem) => {
    window.open(item.previewUrl, '_blank', 'noopener,noreferrer');
  };

  const handleSendReadyItemToDeck = (item: ReadyItem) => {
    const extension = getExtension(item.name) || 'png';
    const mimeType = item.blob.type || imageMimeByExtension[extension] || 'image/png';
    const file = new File([item.blob], item.name, {
      type: mimeType,
      lastModified: Date.now(),
    });
    const previewUrl = URL.createObjectURL(item.blob);
    const nextAsset: ResizerAsset = {
      id: `asset-${createId()}`,
      file,
      nameBase: getBaseName(item.name),
      extension,
      previewUrl,
      width: item.width,
      height: item.height,
      cropCount: 0,
    };
    const nextIndex = assets.length;
    setAssets((prev) => [...prev, nextAsset]);
    setCurrentIndex(nextIndex);
    setAspectPreset('original');
    setCropRect(buildDefaultRect(getImageAspectRatio(nextAsset)));
    setZoomPercent(100);
    setPanOffset({ x: 0, y: 0 });
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

  const handleRemoveReadyItem = (id: string) => {
    setReadyItems((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
    setHoverPreview((prev) => (prev ? null : prev));
  };

  const handleStepAsset = (direction: -1 | 1) => {
    setCurrentIndex((prev) => clamp(prev + direction, 0, Math.max(assets.length - 1, 0)));
  };

  const handleRotateCurrentAsset = async (direction: -90 | 90) => {
    if (!currentAsset || isWorking) {
      return;
    }
    setIsWorking(true);
    try {
      const mimeType = currentAsset.file.type && currentAsset.file.type.startsWith('image/')
        ? currentAsset.file.type
        : 'image/png';
      const rotated = await rotateImageBlob(currentAsset.previewUrl, mimeType, direction);
      const rotatedFile = new File([rotated.blob], currentAsset.file.name, {
        type: mimeType,
        lastModified: Date.now(),
      });
      const nextPreviewUrl = URL.createObjectURL(rotated.blob);
      const rotatedAsset: ResizerAsset = {
        ...currentAsset,
        file: rotatedFile,
        previewUrl: nextPreviewUrl,
        width: rotated.width,
        height: rotated.height,
      };
      setAssets((prev) =>
        prev.map((asset) => (asset.id === currentAsset.id ? rotatedAsset : asset)),
      );
      const nextTargetAspectRatio = getAspectRatioFromPreset(
        aspectPreset,
        rotatedAsset,
        customAspectW,
        customAspectH,
      );
      const nextNormalizedAspectRatio = getNormalizedAspectRatio(
        nextTargetAspectRatio,
        getImageAspectRatio(rotatedAsset),
      );
      setCropRect(buildDefaultRect(nextNormalizedAspectRatio));
      URL.revokeObjectURL(currentAsset.previewUrl);
    } catch {
      // keep state unchanged on rotate failure
    } finally {
      setIsWorking(false);
    }
  };

  const cropStyle: CSSProperties = {
    left: `${cropRect.x * 100}%`,
    top: `${cropRect.y * 100}%`,
    width: `${cropRect.width * 100}%`,
    height: `${cropRect.height * 100}%`,
  };
  const zoomLayerStyle: CSSProperties = {
    transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
  };

  const handleZoomReset = () => {
    setZoomPercent(100);
    setPanOffset({ x: 0, y: 0 });
  };

  const handleAspectPresetChange = (nextPreset: AspectPreset) => {
    const nextTargetAspectRatio = getAspectRatioFromPreset(
      nextPreset,
      currentAsset,
      customAspectW,
      customAspectH,
    );
    const nextNormalizedAspectRatio = getNormalizedAspectRatio(
      nextTargetAspectRatio,
      imageAspectRatio,
    );
    setAspectPreset(nextPreset);
    setCropRect((prev) => fitRectToAspectAtPosition(prev, nextNormalizedAspectRatio));
  };

  const applyAspectPairIfPresent = (raw: string) => {
    const pair = parseAspectPair(raw);
    if (!pair) {
      return false;
    }
    setCustomAspectW(pair.width);
    setCustomAspectH(pair.height);
    return true;
  };

  const handleCustomAspectValueChange = (value: string, field: 'w' | 'h') => {
    if (applyAspectPairIfPresent(value)) {
      return;
    }
    if (field === 'w') {
      setCustomAspectW(value);
      return;
    }
    setCustomAspectH(value);
  };

  const handleCustomAspectPaste = (event: ReactClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text');
    if (!applyAspectPairIfPresent(text)) {
      return;
    }
    event.preventDefault();
  };

  useEffect(() => {
    if (aspectPreset !== 'custom') {
      return;
    }
    const nextTargetAspectRatio = getAspectRatioFromPreset(
      'custom',
      null,
      customAspectW,
      customAspectH,
    );
    const nextNormalizedAspectRatio = getNormalizedAspectRatio(
      nextTargetAspectRatio,
      imageAspectRatio,
    );
    setCropRect((prev) => fitRectToAspectAtPosition(prev, nextNormalizedAspectRatio));
  }, [aspectPreset, customAspectW, customAspectH, imageAspectRatio]);

  return (
    <section className="creative-resizer">
      <header className="controls-wrapper">
        <div className="controls">
          <div className="controls-heading">
            <h1 className="controls-heading-title">Creative Resizer</h1>
            <p className="controls-subtitle">
              Upload many images, crop them one by one, and export a ZIP of ready creatives. Use Upload ZIPs or files or drag and drop files into the deck. Pick ratio, adjust crop frame, then resize current image.
            </p>
          </div>
          <div className="resizer-primary-actions">
            <button type="button" onClick={handleUploadClick}>
              Upload ZIPs or files
            </button>
            <button type="button" disabled>
              {assets.length} loaded
            </button>
            <button
              type="button"
              className="clear-action-button"
              onClick={handleClearAssets}
              disabled={!assets.length}
            >
              Clear
            </button>
          </div>
          {hasGifAsset ? (
            <p className="resizer-gif-warning">GIF animation is not preserved after editing.</p>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.zip,application/zip,application/x-zip-compressed"
            multiple
            hidden
            onChange={(event) => {
              void handleFilesAdded(event.target.files);
              event.target.value = '';
            }}
          />
        </div>
      </header>

      <section className="card resizer-stage-card">
        <header className="card-header">
          <div className="card-header-top">
            <h2>Preview</h2>
          </div>
        </header>

        <div className="resizer-controls-row">
          <div className="number-field number-field-mode resizer-aspect-field">
            <div className={`resizer-aspect-panel${aspectPreset === 'custom' ? ' is-custom' : ''}`}>
              <div className="resizer-aspect-buttons" role="tablist" aria-label="Aspect ratio presets">
                {aspectOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`resizer-aspect-button${aspectPreset === option.value ? ' is-active' : ''}`}
                    onClick={() => handleAspectPresetChange(option.value)}
                    role="tab"
                    aria-selected={aspectPreset === option.value}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className={`resizer-custom-inline${aspectPreset === 'custom' ? ' is-visible' : ''}`}>
                <div className="resizer-ratio-inputs">
                  <div className="number-field-input-wrapper">
                    <input
                      type="text"
                      value={customAspectW}
                      onChange={(event) => handleCustomAspectValueChange(event.target.value, 'w')}
                      onPaste={handleCustomAspectPaste}
                      placeholder="W"
                      disabled={aspectPreset !== 'custom'}
                    />
                  </div>
                  <div className="number-field-input-wrapper">
                    <input
                      type="text"
                      value={customAspectH}
                      onChange={(event) => handleCustomAspectValueChange(event.target.value, 'h')}
                      onPaste={handleCustomAspectPaste}
                      placeholder="H"
                      disabled={aspectPreset !== 'custom'}
                    />
                  </div>
                </div>
                <label className="resizer-custom-size-toggle" title="Use W:H as output dimensions">
                  <input
                    type="checkbox"
                    checked={useCustomOutputSize}
                    onChange={(event) => setUseCustomOutputSize(event.target.checked)}
                    disabled={aspectPreset !== 'custom'}
                  />
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="number-field number-field-mode resizer-actions-field">
          <div
            className={`resizer-deck-row${isDeckDropActive ? ' is-drop-active' : ''}`}
            onDragEnter={handleDeckDragEnter}
            onDragOver={handleDeckDragOver}
            onDragLeave={handleDeckDragLeave}
            onDrop={handleDeckDrop}
          >
            <button
              type="button"
              className="resizer-nav-button"
              onClick={() => handleStepAsset(-1)}
              disabled={!currentAsset || currentIndex === 0 || isWorking}
              aria-label="Previous image"
            >
              &lsaquo;
            </button>
            <div className="resizer-deck" role="listbox" aria-label="Loaded images">
              {assets.length ? (
                <div
                  className="resizer-deck-track"
                  style={{ '--deck-offset': `${deckOffset}px` } as CSSProperties}
                >
                  {assets.map((asset, index) => {
                    const distance = index - currentIndex;
                    const depth = Math.min(Math.abs(distance), 9);
                    const deckStyle = {
                      '--deck-y': `${depth * 2}px`,
                      '--deck-opacity': `${Math.max(0.4, 1 - depth * 0.11)}`,
                      '--deck-z': String(140 - depth),
                    } as CSSProperties;
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        className={`resizer-deck-item${index === currentIndex ? ' is-active' : ''}`}
                        onClick={() => setCurrentIndex(index)}
                        role="option"
                        aria-label={`Image ${index + 1}`}
                        aria-selected={index === currentIndex}
                        style={deckStyle}
                      >
                        <img src={asset.previewUrl} alt={asset.file.name} />
                        <span
                          className="resizer-deck-item-remove"
                          role="button"
                          tabIndex={0}
                          aria-label={`Remove image ${index + 1}`}
                          title="Remove from deck"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            handleRemoveAsset(asset.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') {
                              return;
                            }
                            event.preventDefault();
                            event.stopPropagation();
                            handleRemoveAsset(asset.id);
                          }}
                        >
                          ×
                        </span>
                        <span className="resizer-deck-item-size">{`${asset.width}x${asset.height}`}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="resizer-deck-empty">No images in deck.</div>
              )}
            </div>
            <button
              type="button"
              className="resizer-nav-button"
              onClick={() => handleStepAsset(1)}
              disabled={!currentAsset || currentIndex >= assets.length - 1 || isWorking}
              aria-label="Next image"
            >
              &rsaquo;
            </button>
            {isDeckDropActive ? (
              <div className="resizer-deck-dropzone" aria-hidden="true">
                <span>Drop ZIPs or image files here</span>
              </div>
            ) : null}
          </div>
                    <div className="resizer-action-row">
            <button
              type="button"
              className="resizer-nav-button resizer-rotate-button"
              onClick={() => {
                void handleRotateCurrentAsset(-90);
              }}
              disabled={!currentAsset || isWorking}
              aria-label="Rotate left"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 5V2L8 6l4 4V7c2.76 0 5 2.24 5 5 0 1.38-.56 2.63-1.46 3.54l1.42 1.42A6.98 6.98 0 0 0 19 12c0-3.87-3.13-7-7-7z" />
              </svg>
            </button>
            <button
              type="button"
              className="resizer-toolbar-button resizer-toolbar-button-primary resizer-resize-button"
              onClick={() => {
                void applyResize();
              }}
              disabled={!currentAsset || isWorking}
            >
              Resize image
            </button>
            <button
              type="button"
              className="resizer-nav-button resizer-rotate-button"
              onClick={() => {
                void handleRotateCurrentAsset(90);
              }}
              disabled={!currentAsset || isWorking}
              aria-label="Rotate right"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 5c-3.87 0-7 3.13-7 7 0 1.93.78 3.68 2.05 4.95l1.42-1.42A4.98 4.98 0 0 1 7 12c0-2.76 2.24-5 5-5v3l4-4-4-4v3z" />
              </svg>
            </button>
          </div>
        </div>

        <div className="resizer-stage-toolbar">
          <div className="resizer-stage-title">
            {currentAsset ? `Image ${currentIndex + 1} / ${assets.length}: ${currentAsset.file.name}` : 'No image loaded.'}
          </div>
          <div className="resizer-stage-zoom" aria-label="Zoom controls">
            <span className="resizer-stage-zoom-label">Zoom</span>
            <input
              type="range"
              className="resizer-zoom-slider"
              min={50}
              max={400}
              step={10}
              value={zoomPercent}
              onChange={(event) => setZoomPercent(clamp(Number(event.target.value), 50, 400))}
              disabled={!currentAsset || isWorking}
              aria-label="Zoom level"
            />
            <button
              type="button"
              className="resizer-zoom-reset"
              onClick={handleZoomReset}
              disabled={!currentAsset || isWorking}
              aria-label="Reset zoom"
            >
              100%
            </button>
          </div>
          <div className="resizer-stage-quality" aria-label="Compression controls">
            <span className="resizer-stage-zoom-label">Weight</span>
            <input
              type="range"
              className="resizer-quality-slider"
              min={10}
              max={100}
              step={1}
              value={qualityPercent}
              onChange={(event) => setQualityPercent(clamp(Number(event.target.value), 10, 100))}
              disabled={!currentAsset || isWorking}
              aria-label="Compression quality"
            />
            <span className="resizer-stage-size">{qualityEstimatedSize}</span>
          </div>
        </div>

        <div
          className={`resizer-stage${isPanning ? ' is-panning' : ''}${zoomScale > 1 ? ' is-zoomed' : ''}`}
          onPointerDown={handleStartPan}
        >
          {currentAsset ? (
            <div className="resizer-image-wrap" ref={imageWrapRef}>
              <div className="resizer-zoom-layer" ref={zoomLayerRef} style={zoomLayerStyle}>
                <img
                  src={qualityPreviewUrl ?? currentAsset.previewUrl}
                  alt={currentAsset.file.name}
                  className="resizer-image"
                />
                <div className="resizer-overlay">
                  <div
                    className="resizer-crop-box"
                    style={cropStyle}
                    onPointerDown={(event) => handleStartDrag(event, 'move')}
                  >
                    <span className="resizer-handle resizer-handle-nw" onPointerDown={(event) => handleStartDrag(event, 'nw')} />
                    <span className="resizer-handle resizer-handle-ne" onPointerDown={(event) => handleStartDrag(event, 'ne')} />
                    <span className="resizer-handle resizer-handle-sw" onPointerDown={(event) => handleStartDrag(event, 'sw')} />
                    <span className="resizer-handle resizer-handle-se" onPointerDown={(event) => handleStartDrag(event, 'se')} />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="resizer-empty">No image loaded.</div>
          )}
        </div>
      </section>

      <section className="card results-card">
        <header className="card-header">
          <div className="card-header-top">
            <h2>Ready images</h2>
            <div className="split-result-actions">
              <button
                type="button"
                className="resizer-clear-result-button clear-action-button"
                onClick={handleClearResults}
                disabled={!readyItems.length || isWorking}
              >
                Clear result
              </button>
              <button type="button" onClick={handleDownloadZip} disabled={!readyItems.length || isWorking}>
                Download ZIP
              </button>
              <button
                type="button"
                onClick={() => void handleSendToAssetRenamer()}
                disabled={!readyItems.length || isWorking || isSendingToRenamer}
              >
                {isSendingToRenamer ? 'Sending...' : 'To Asset Renamer'}
              </button>
            </div>
          </div>
        </header>
        {sendError ? <p className="creative-error">{sendError}</p> : null}
        <div className="result-list resizer-ready-list">
          {readyItems.length ? (
            readyItems.map((item, index) => (
              <div
                key={item.id}
                className="result-item resizer-ready-item"
                onMouseEnter={(event) =>
                  setHoverPreview({ url: item.previewUrl, x: event.clientX, y: event.clientY })
                }
                onMouseMove={(event) =>
                  setHoverPreview({ url: item.previewUrl, x: event.clientX, y: event.clientY })
                }
                onMouseLeave={() => setHoverPreview(null)}
              >
                <span className="result-index">{index + 1}</span>
                <div className="result-value">
                  <button
                    type="button"
                    className="resizer-ready-name resizer-ready-name-link"
                    onClick={() => handleOpenReadyItemInNewTab(item)}
                    title="Open image in new tab"
                  >
                    {item.name}
                  </button>
                  <div className="resizer-ready-meta">
                    <span className="resizer-ready-size">{`${item.width}x${item.height}`}</span>
                    <span className="resizer-ready-weight">{formatSize(item.blob.size)}</span>
                    <button
                      type="button"
                      className="resizer-ready-icon-button"
                      aria-label="Download resized image"
                      onClick={() => handleDownloadReadyItem(item)}
                      title="Download"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M5 20h14v-2H5v2zM11 2h2v10.17l3.59-3.58L18 10l-6 6-6-6 1.41-1.41L11 12.17V2z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="resizer-ready-icon-button"
                      aria-label="Send resized image back to deck"
                      onClick={() => handleSendReadyItemToDeck(item)}
                      title="Send to deck"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M12 5V1L6 7l6 6V9c3.31 0 6 2.69 6 6 0 1.31-.42 2.52-1.14 3.5l1.46 1.46A7.96 7.96 0 0 0 20 15c0-4.42-3.58-8-8-8z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={`resizer-ready-icon-button${copiedReadyItemId === item.id ? ' is-copied' : ''}`}
                      aria-label="Copy resized image to clipboard"
                      onClick={() => {
                        void handleCopyReadyItem(item);
                      }}
                      title={copiedReadyItemId === item.id ? 'Copied' : 'Copy image'}
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
                  aria-label="Remove resized image"
                  onClick={() => handleRemoveReadyItem(item.id)}
                >
                  x
                </button>
              </div>
            ))
          ) : (
            <p className="muted">Resized images will appear here.</p>
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



