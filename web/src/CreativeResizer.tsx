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
};

type HistoryItem = {
  readyId: string;
  restoreIndex: number;
  restoreCrop: CropRect;
  assetId: string;
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

const createId = () => Math.random().toString(36).slice(2, 10);

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getExtension = (name: string) => {
  const match = name.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : '';
};

const getBaseName = (name: string) => name.replace(/\.[^.]+$/, '');

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

const cropImageBlob = async (asset: ResizerAsset, rect: CropRect) => {
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
  const canvas = document.createElement('canvas');
  canvas.width = sourceW;
  canvas.height = sourceH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas not supported.');
  }
  ctx.drawImage(image, sourceX, sourceY, sourceW, sourceH, 0, 0, sourceW, sourceH);

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
  return blob;
};

export const CreativeResizer = () => {
  const [assets, setAssets] = useState<ResizerAsset[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [readyItems, setReadyItems] = useState<ReadyItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [aspectPreset, setAspectPreset] = useState<AspectPreset>('free');
  const [customAspectW, setCustomAspectW] = useState('9');
  const [customAspectH, setCustomAspectH] = useState('16');
  const [cropRect, setCropRect] = useState<CropRect>({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
  const [isWorking, setIsWorking] = useState(false);
  const [hoverPreview, setHoverPreview] = useState<{ url: string; x: number; y: number } | null>(null);
  const imageWrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const assetsRef = useRef<ResizerAsset[]>([]);
  const readyItemsRef = useRef<ReadyItem[]>([]);

  const currentAsset = assets[currentIndex] ?? null;

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
    const incoming = Array.from(list).filter((file) => file.type.startsWith('image/'));
    if (!incoming.length) {
      return;
    }
    const loaded = await Promise.all(incoming.map(async (file) => {
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
    if (!imageWrapRef.current) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const bounds = imageWrapRef.current.getBoundingClientRect();
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

  const applyResize = async (goNext: boolean) => {
    if (!currentAsset || isWorking) {
      return;
    }
    setIsWorking(true);
    const restoreCrop = cropRect;
    const restoreIndex = currentIndex;
    try {
      const blob = await cropImageBlob(currentAsset, cropRect);
      const nextCount = currentAsset.cropCount + 1;
      const name = `${currentAsset.nameBase}-crop-${String(nextCount).padStart(2, '0')}.${currentAsset.extension}`;
      const previewUrl = URL.createObjectURL(blob);
      const readyId = `ready-${createId()}`;

      setReadyItems((prev) => [...prev, {
        id: readyId,
        assetId: currentAsset.id,
        name,
        blob,
        previewUrl,
      }]);
      setAssets((prev) =>
        prev.map((asset) =>
          asset.id === currentAsset.id
            ? { ...asset, cropCount: asset.cropCount + 1 }
            : asset,
        ),
      );
      setHistory((prev) => [...prev, {
        readyId,
        restoreIndex,
        restoreCrop,
        assetId: currentAsset.id,
      }]);

      if (goNext) {
        setCurrentIndex((prev) => clamp(prev + 1, 0, Math.max(assets.length - 1, 0)));
      }
    } catch {
      // keep state unchanged on crop failure
    } finally {
      setIsWorking(false);
    }
  };

  const handleUndo = () => {
    setHistory((prev) => {
      if (!prev.length) {
        return prev;
      }
      const nextHistory = [...prev];
      const last = nextHistory.pop();
      if (!last) {
        return prev;
      }
      setReadyItems((items) => {
        const target = items.find((item) => item.id === last.readyId);
        if (target) {
          URL.revokeObjectURL(target.previewUrl);
        }
        return items.filter((item) => item.id !== last.readyId);
      });
      setAssets((existing) =>
        existing.map((asset) =>
          asset.id === last.assetId
            ? { ...asset, cropCount: Math.max(0, asset.cropCount - 1) }
            : asset,
        ),
      );
      setCurrentIndex(last.restoreIndex);
      setCropRect(last.restoreCrop);
      return nextHistory;
    });
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
    setHistory([]);
  };

  const handleClearResults = () => {
    readyItems.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setReadyItems([]);
    setHistory([]);
    setHoverPreview(null);
  };

  const cropStyle: CSSProperties = {
    left: `${cropRect.x * 100}%`,
    top: `${cropRect.y * 100}%`,
    width: `${cropRect.width * 100}%`,
    height: `${cropRect.height * 100}%`,
  };

  return (
    <section className="creative-resizer">
      <header className="controls-wrapper">
        <div className="controls">
          <div className="controls-heading">
            <h1 className="controls-heading-title">Creative Resizer</h1>
            <p className="controls-subtitle">
              Upload many images, crop them one by one, and export a ZIP of ready creatives.
            </p>
          </div>
          <div className="resizer-primary-actions">
            <button type="button" onClick={handleUploadClick}>
              Upload images
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
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
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
          <p>
            {currentAsset
              ? `Image ${currentIndex + 1} / ${assets.length}: ${currentAsset.file.name}`
              : 'Upload images to start cropping.'}
          </p>
        </header>

        <div className={`resizer-preview-toolbar${aspectPreset === 'custom' ? ' is-custom' : ''}`}>
          <div className="number-field number-field-mode">
            <label className="number-field-label">Aspect ratio</label>
            <div className="number-field-input-wrapper">
              <select
                className="creative-output-select resizer-aspect-select"
                value={aspectPreset}
                onChange={(event) => {
                  const nextPreset = event.target.value as AspectPreset;
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
                  setCropRect((prev) =>
                    fitRectToAspect(prev, nextNormalizedAspectRatio),
                  );
                }}
              >
                {aspectOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {aspectPreset === 'custom' ? (
            <div className="number-field number-field-mode">
              <label className="number-field-label">Custom W:H</label>
              <div className="resizer-ratio-inputs">
                <div className="number-field-input-wrapper">
                  <input
                    type="text"
                    value={customAspectW}
                    onChange={(event) => setCustomAspectW(event.target.value)}
                    placeholder="W"
                  />
                </div>
                <div className="number-field-input-wrapper">
                  <input
                    type="text"
                    value={customAspectH}
                    onChange={(event) => setCustomAspectH(event.target.value)}
                    placeholder="H"
                  />
                </div>
              </div>
            </div>
          ) : null}
          <div className="number-field number-field-mode resizer-actions-field">
            <label className="number-field-label">Actions</label>
            <div className="resizer-toolbar-actions">
              <button
                type="button"
                className="resizer-toolbar-button"
                onClick={handleUndo}
                disabled={!history.length || isWorking}
              >
                Undo
              </button>
              <button
                type="button"
                className="resizer-toolbar-button"
                onClick={() => {
                  void applyResize(false);
                }}
                disabled={!currentAsset || isWorking}
              >
                Resize same image
              </button>
              <button
                type="button"
                className="resizer-toolbar-button resizer-toolbar-button-primary"
                onClick={() => {
                  void applyResize(true);
                }}
                disabled={!currentAsset || isWorking}
              >
                {assets.length <= 1 ? 'Resize image' : 'Next image'}
              </button>
            </div>
          </div>
        </div>

        <div className="resizer-stage">
          {currentAsset ? (
            <div className="resizer-image-wrap" ref={imageWrapRef}>
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
          <p>{readyItems.length} generated</p>
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
                <div className="result-value">{item.name}</div>
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
