import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import JSZip from 'jszip';

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

const createId = () => Math.random().toString(36).slice(2, 10);

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getExtension = (name: string) => {
  const match = name.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : '';
};

const getBaseName = (name: string) => name.replace(/\.[^.]+$/, '');

const getLeafName = (path: string) => path.split('/').pop() ?? path;

const isZipFile = (file: File) => file.name.toLowerCase().endsWith('.zip');

const isImageName = (name: string) => imageExtensions.has(getExtension(name));

const isImageFile = (file: File) => file.type.startsWith('image/') || isImageName(file.name);

const isTextEntryTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement
  && (target.isContentEditable
    || target.tagName === 'INPUT'
    || target.tagName === 'TEXTAREA'
    || target.tagName === 'SELECT');

const parsePositiveInt = (value: string) => {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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
    return { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
  }
  let width = 0.9;
  let height = width / normalizedAspectRatio;
  if (height > 0.9) {
    height = 0.9;
    width = height * normalizedAspectRatio;
  }
  const x = (1 - width) / 2;
  const y = (1 - height) / 2;
  return { x, y, width, height };
};

const fitRectToAspect = (rect: CropRect, normalizedAspectRatio: number | null): CropRect => {
  if (!normalizedAspectRatio) {
    return rect;
  }
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  let width = rect.width;
  let height = width / normalizedAspectRatio;
  if (height > rect.height) {
    height = rect.height;
    width = height * normalizedAspectRatio;
  }
  if (width > 1) {
    width = 1;
    height = width / normalizedAspectRatio;
  }
  if (height > 1) {
    height = 1;
    width = height * normalizedAspectRatio;
  }
  let x = centerX - width / 2;
  let y = centerY - height / 2;
  x = clamp(x, 0, 1 - width);
  y = clamp(y, 0, 1 - height);
  return { x, y, width, height };
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

const cropImageBlob = async (asset: ResizerAsset, rect: CropRect, outputSize: OutputSize | null = null) => {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Image load failed.'));
    image.src = asset.previewUrl;
  });

  const sourceX = Math.round(rect.x * asset.width);
  const sourceY = Math.round(rect.y * asset.height);
  const sourceW = Math.max(1, Math.round(rect.width * asset.width));
  const sourceH = Math.max(1, Math.round(rect.height * asset.height));
  const outputW = outputSize?.width ?? sourceW;
  const outputH = outputSize?.height ?? sourceH;
  const canvas = document.createElement('canvas');
  canvas.width = outputW;
  canvas.height = outputH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas not supported.');
  }
  ctx.drawImage(image, sourceX, sourceY, sourceW, sourceH, 0, 0, outputW, outputH);

  const mimeType = asset.file.type && asset.file.type.startsWith('image/')
    ? asset.file.type
    : 'image/png';
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (!result) {
          reject(new Error('Crop failed.'));
          return;
        }
        resolve(result);
      },
      mimeType,
      mimeType === 'image/jpeg' || mimeType === 'image/webp' ? 0.92 : undefined,
    );
  });
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
  const [zoomPercent, setZoomPercent] = useState(100);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [hoverPreview, setHoverPreview] = useState<{ url: string; x: number; y: number } | null>(null);
  const imageWrapRef = useRef<HTMLDivElement | null>(null);
  const zoomLayerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const panDragRef = useRef<PanDragState | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const assetsRef = useRef<ResizerAsset[]>([]);
  const readyItemsRef = useRef<ReadyItem[]>([]);

  const currentAsset = assets[currentIndex] ?? null;
  const deckStep = 52;
  const deckOffset = assets.length > 0
    ? (((assets.length - 1) / 2) - currentIndex) * deckStep
    : 0;
  const zoomScale = zoomPercent / 100;
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
    setCropRect(buildDefaultRect(normalizedAspectRatio));
  }, [currentAsset?.id, normalizedAspectRatio]);

  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  useEffect(() => {
    readyItemsRef.current = readyItems;
  }, [readyItems]);

  useEffect(() => {
    return () => {
      assetsRef.current.forEach((asset) => URL.revokeObjectURL(asset.previewUrl));
      readyItemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, []);

  useEffect(() => {
    setPanOffset((prev) => clampPanOffset(prev.x, prev.y, zoomScale));
  }, [zoomScale, currentAsset?.id]);

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

  const handleStartDrag = (event: ReactPointerEvent<HTMLElement>, mode: DragMode) => {
    if (!zoomLayerRef.current) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
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
      || target.closest('.resizer-zoom-controls')
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
      const cropped = await cropImageBlob(currentAsset, cropRect, customOutputSize);
      const nextCount = currentAsset.cropCount + 1;
      const name = `${currentAsset.nameBase}-crop-${String(nextCount).padStart(2, '0')}.${currentAsset.extension}`;
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

  const handleClearAssets = () => {
    assets.forEach((asset) => URL.revokeObjectURL(asset.previewUrl));
    setAssets([]);
    setCurrentIndex(0);
    setCropRect({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
    setZoomPercent(100);
    setPanOffset({ x: 0, y: 0 });
  };

  const handleClearResults = () => {
    readyItems.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setReadyItems([]);
    setHoverPreview(null);
  };

  const handleDownloadReadyItem = (item: ReadyItem) => {
    const url = URL.createObjectURL(item.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = item.name;
    anchor.click();
    URL.revokeObjectURL(url);
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

  const handleZoomStep = (direction: -1 | 1) => {
    setZoomPercent((prev) => clamp(prev + direction * 10, 50, 400));
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
    setCropRect((prev) => fitRectToAspect(prev, nextNormalizedAspectRatio));
  };

  return (
    <section className="creative-resizer">
      <header className="controls-wrapper">
        <div className="controls">
          <div className="controls-heading">
            <h1 className="controls-heading-title">Creative Resizer</h1>
            <p className="controls-subtitle">
              Upload many images, crop them one by one, and export a ZIP of ready creatives. Pick ratio, adjust crop frame, then resize current image.
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
                      onChange={(event) => setCustomAspectW(event.target.value)}
                      placeholder="W"
                      disabled={aspectPreset !== 'custom'}
                    />
                  </div>
                  <div className="number-field-input-wrapper">
                    <input
                      type="text"
                      value={customAspectH}
                      onChange={(event) => setCustomAspectH(event.target.value)}
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
          <div className="resizer-deck-row">
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
              ↺
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
              ↻
            </button>
          </div>
        </div>

        <div
          className={`resizer-stage${isPanning ? ' is-panning' : ''}${zoomScale > 1 ? ' is-zoomed' : ''}`}
          onPointerDown={handleStartPan}
        >
          {currentAsset ? (
            <div className="resizer-image-wrap" ref={imageWrapRef}>
              <div className="resizer-stage-meta">
                {`Image ${currentIndex + 1} / ${assets.length}: ${currentAsset.file.name}`}
              </div>
              <div className="resizer-zoom-layer" ref={zoomLayerRef} style={zoomLayerStyle}>
                <img src={currentAsset.previewUrl} alt={currentAsset.file.name} className="resizer-image" />
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
          <div className="resizer-zoom-controls">
            <button
              type="button"
              onClick={() => handleZoomStep(1)}
              disabled={!currentAsset || isWorking}
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => handleZoomStep(-1)}
              disabled={!currentAsset || isWorking}
              aria-label="Zoom out"
            >
              -
            </button>
            <button
              type="button"
              onClick={handleZoomReset}
              disabled={!currentAsset || isWorking}
              aria-label="Reset zoom"
            >
              100%
            </button>
          </div>
        </div>
      </section>

      <section className="card results-card">
        <header className="card-header">
          <div className="card-header-top">
            <h2>Ready images</h2>
            <div className="split-result-actions">
              <button
                type="button"
                className="resizer-clear-result-button"
                onClick={handleClearResults}
                disabled={!readyItems.length || isWorking}
              >
                Clear result
              </button>
              <button type="button" onClick={handleDownloadZip} disabled={!readyItems.length || isWorking}>
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
                  <span className="resizer-ready-name">{item.name}</span>
                  <div className="resizer-ready-meta">
                    <span className="resizer-ready-size">{`${item.width}x${item.height}`}</span>
                    <button
                      type="button"
                      className="resizer-ready-download"
                      aria-label="Download resized image"
                      onClick={() => handleDownloadReadyItem(item)}
                    >
                      download
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
