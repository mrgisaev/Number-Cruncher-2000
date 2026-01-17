import { type CSSProperties, type DragEvent, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';

type CreativeNode = {
  id: string;
  type: 'group' | 'file';
  name: string;
  children: CreativeNode[];
};

type CreativeFile = {
  id: string;
  file: File;
  originalName: string;
  extension: string;
  kind: 'image' | 'video';
  width: number | null;
  height: number | null;
  sizeInput: string;
  identifier: string;
  previewUrl: string;
};

type FileEntry = {
  fileId: string;
  pathSegments: string[];
};

const imageExtensions = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'tiff',
  'svg',
]);

const videoExtensions = new Set(['mp4', 'mov', 'webm', 'avi', 'mkv']);

const createId = () => Math.random().toString(36).slice(2, 10);
const createGroupId = () => `group-${createId()}`;
const createFileId = () => `file-${createId()}`;

const getExtension = (name: string) => {
  const match = name.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : '';
};

const getKind = (extension: string) => {
  if (imageExtensions.has(extension)) {
    return 'image';
  }
  if (videoExtensions.has(extension)) {
    return 'video';
  }
  return null;
};

const getMime = (extension: string, kind: 'image' | 'video') => {
  if (kind === 'image') {
    if (extension === 'jpg' || extension === 'jpeg') {
      return 'image/jpeg';
    }
    if (extension === 'png') {
      return 'image/png';
    }
    if (extension === 'webp') {
      return 'image/webp';
    }
    if (extension === 'gif') {
      return 'image/gif';
    }
    if (extension === 'svg') {
      return 'image/svg+xml';
    }
    return 'image/png';
  }
  if (extension === 'mp4') {
    return 'video/mp4';
  }
  if (extension === 'webm') {
    return 'video/webm';
  }
  return 'video/mp4';
};

const normalizeSegment = (value: string) =>
  value.trim().replace(/\s+/g, ' ').replace(/[\\/:*?"<>|]/g, '');

const formatSize = (width: number | null, height: number | null) => {
  if (!width || !height) {
    return '';
  }
  return `${width}x${height}`;
};

const buildCreativeFile = (
  file: File,
  fileName: string,
  extension: string,
  kind: 'image' | 'video',
): CreativeFile => ({
  id: createFileId(),
  file,
  originalName: fileName,
  extension,
  kind,
  width: null,
  height: null,
  sizeInput: '',
  identifier: '',
  previewUrl: URL.createObjectURL(file),
});

const createGroupNode = (label: string): CreativeNode => ({
  id: createGroupId(),
  type: 'group',
  name: label,
  children: [],
});

const createInitialGroups = () => [createGroupNode('Group 1')];

const getNextGroupIndex = (nodes: CreativeNode[], base: string) => {
  const regex = new RegExp(`^${base}\\s*(\\d+)?$`, 'i');
  return nodes.reduce((max, node) => {
    if (node.type !== 'group') {
      return max;
    }
    const match = node.name.trim().match(regex);
    if (!match) {
      return max;
    }
    const value = match[1] ? Number.parseInt(match[1], 10) : 1;
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0) + 1;
};

const getNextGroupLabel = (nodes: CreativeNode[], depth: number) => {
  const base = depth === 0 ? 'Group' : 'Subgroup';
  const nextIndex = getNextGroupIndex(nodes, base);
  return `${base} ${nextIndex}`;
};

const addSiblingGroup = (nodes: CreativeNode[], id: string, depth = 0) => {
  let changed = false;
  const next: CreativeNode[] = [];
  nodes.forEach((node) => {
    if (node.id === id && node.type === 'group') {
      next.push(node);
      next.push(createGroupNode(getNextGroupLabel(nodes, depth)));
      changed = true;
      return;
    }
    if (node.children.length) {
      const result = addSiblingGroup(node.children, id, depth + 1);
      if (result.changed) {
        next.push({ ...node, children: result.nodes });
        changed = true;
        return;
      }
    }
    next.push(node);
  });
  return { nodes: next, changed };
};

const addChildGroup = (nodes: CreativeNode[], id: string, depth = 0) => {
  let changed = false;
  const next = nodes.map((node) => {
    if (node.id === id && node.type === 'group') {
      changed = true;
      return {
        ...node,
        children: [...node.children, createGroupNode(getNextGroupLabel(node.children, depth + 1))],
      };
    }
    if (node.children.length) {
      const result = addChildGroup(node.children, id, depth + 1);
      if (result.changed) {
        changed = true;
        return { ...node, children: result.nodes };
      }
    }
    return node;
  });
  return { nodes: next, changed };
};

const addFilesToGroup = (nodes: CreativeNode[], groupId: string, files: CreativeFile[]) => {
  const fileNodes: CreativeNode[] = files.map((file) => ({
    id: file.id,
    type: 'file',
    name: file.originalName,
    children: [],
  }));
  return nodes.map((node) => {
    if (node.id === groupId && node.type === 'group') {
      return { ...node, children: [...node.children, ...fileNodes] };
    }
    if (node.children.length) {
      return { ...node, children: addFilesToGroup(node.children, groupId, files) };
    }
    return node;
  });
};

const insertNodeToGroup = (nodes: CreativeNode[], groupId: string, child: CreativeNode) =>
  nodes.map((node) => {
    if (node.id === groupId && node.type === 'group') {
      return { ...node, children: [...node.children, child] };
    }
    if (node.children.length) {
      return { ...node, children: insertNodeToGroup(node.children, groupId, child) };
    }
    return node;
  });

const removeNodeAndCollect = (nodes: CreativeNode[], id: string) => {
  const removedFileIds: string[] = [];
  const collectFileIds = (node: CreativeNode) => {
    if (node.type === 'file') {
      removedFileIds.push(node.id);
      return;
    }
    node.children.forEach(collectFileIds);
  };
  const next = nodes
    .filter((node) => {
      if (node.id === id) {
        collectFileIds(node);
        return false;
      }
      return true;
    })
    .map((node) => {
      if (!node.children.length) {
        return node;
      }
      const result = removeNodeAndCollect(node.children, id);
      removedFileIds.push(...result.removedFileIds);
      return { ...node, children: result.nodes };
    });
  return { nodes: next, removedFileIds };
};

const detachFileNode = (nodes: CreativeNode[], fileId: string) => {
  let detached: CreativeNode | null = null;
  const next = nodes
    .filter((node) => {
      if (node.id === fileId && node.type === 'file') {
        detached = node;
        return false;
      }
      return true;
    })
    .map((node) => {
      if (!node.children.length) {
        return node;
      }
      const result = detachFileNode(node.children, fileId);
      if (result.detached) {
        detached = result.detached;
      }
      return { ...node, children: result.nodes };
    });
  return { nodes: next, detached };
};

const moveFileToGroup = (nodes: CreativeNode[], fileId: string, groupId: string) => {
  const detachedResult = detachFileNode(nodes, fileId);
  if (!detachedResult.detached) {
    return nodes;
  }
  return insertNodeToGroup(detachedResult.nodes, groupId, detachedResult.detached);
};

const flattenFiles = (nodes: CreativeNode[], path: string[] = []) => {
  const entries: FileEntry[] = [];
  nodes.forEach((node) => {
    if (node.type === 'group') {
      const segment = normalizeSegment(node.name);
      const nextPath = segment ? [...path, segment] : path;
      entries.push(...flattenFiles(node.children, nextPath));
      return;
    }
    entries.push({ fileId: node.id, pathSegments: path });
  });
  return entries;
};

const loadImageSize = (url: string) =>
  new Promise<{ width: number; height: number } | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });

const loadVideoSize = (url: string) =>
  new Promise<{ width: number; height: number } | null>((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      resolve({ width: video.videoWidth, height: video.videoHeight });
    };
    video.onerror = () => resolve(null);
    video.src = url;
  });

const convertImage = (file: File, target: 'jpg' | 'png') =>
  new Promise<Blob>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Canvas not supported.'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      const mime = target === 'png' ? 'image/png' : 'image/jpeg';
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          if (!blob) {
            reject(new Error('Image conversion failed.'));
            return;
          }
          resolve(blob);
        },
        mime,
        target === 'jpg' ? 0.92 : undefined,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image conversion failed.'));
    };
    img.src = url;
  });

export const CreativeRenamer = () => {
  const [groups, setGroups] = useState<CreativeNode[]>(createInitialGroups());
  const [files, setFiles] = useState<Record<string, CreativeFile>>({});
  const [separator, setSeparator] = useState('-');
  const [includeSize, setIncludeSize] = useState(true);
  const [outputFormat, setOutputFormat] = useState<'keep' | 'jpg' | 'png' | 'mp4'>('keep');
  const [assetKind, setAssetKind] = useState<'image' | 'video' | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [isExporting, setIsExporting] = useState(false);
  const [preview, setPreview] = useState<{ file: CreativeFile; x: number; y: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fileEntries = useMemo(() => flattenFiles(groups), [groups]);
  const filesArray = useMemo(() => Object.values(files), [files]);
  const hasFiles = filesArray.length > 0;

  const formatMismatch = useMemo(() => {
    if (!assetKind || outputFormat === 'keep') {
      return '';
    }
    if (outputFormat === 'mp4' && assetKind !== 'video') {
      return 'MP4 output is only available for video creatives.';
    }
    if ((outputFormat === 'jpg' || outputFormat === 'png') && assetKind !== 'image') {
      return 'JPG/PNG output is only available for image creatives.';
    }
    return '';
  }, [assetKind, outputFormat]);

  const renamePreview = useMemo(() => {
    const entries = fileEntries.map((entry) => {
      const file = files[entry.fileId];
      if (!file) {
        return null;
      }
      const parts = entry.pathSegments.map((segment) => normalizeSegment(segment)).filter(Boolean);
      const sizeValue = file.sizeInput.trim() || formatSize(file.width, file.height);
      if (includeSize && sizeValue) {
        parts.push(sizeValue);
      }
      const identifier = normalizeSegment(file.identifier);
      if (identifier) {
        parts.push(identifier);
      }
      const baseName = parts.join(separator);
      const extension =
        outputFormat === 'keep'
          ? file.extension
          : outputFormat === 'jpg'
            ? 'jpg'
            : outputFormat === 'png'
              ? 'png'
              : 'mp4';
      const fullName = baseName ? `${baseName}.${extension}` : '';
      return {
        file,
        baseName,
        fullName,
        sizeValue,
        pathLabel: entry.pathSegments.join(' / '),
      };
    });
    const nameCounts = new Map<string, number>();
    entries.forEach((entry) => {
      if (!entry || !entry.fullName) {
        return;
      }
      nameCounts.set(entry.fullName, (nameCounts.get(entry.fullName) ?? 0) + 1);
    });
    return entries.map((entry) => {
      if (!entry) {
        return null;
      }
      const errors: string[] = [];
      if (!entry.baseName) {
        errors.push('Missing name parts.');
      }
      if (includeSize && !entry.sizeValue) {
        errors.push('Missing size.');
      }
      if (outputFormat === 'mp4' && entry.file.kind === 'video' && entry.file.extension !== 'mp4') {
        errors.push('Only MP4 input is supported for MP4 output.');
      }
      if (entry.fullName && (nameCounts.get(entry.fullName) ?? 0) > 1) {
        errors.push('Duplicate filename.');
      }
      return { ...entry, errors };
    });
  }, [fileEntries, files, includeSize, outputFormat, separator]);

  const hasErrors = renamePreview.some((entry) => entry && entry.errors.length > 0) || !!formatMismatch;

  const handleFileButton = () => {
    fileInputRef.current?.click();
  };

  const handleFilesAdded = async (fileList: FileList | null) => {
    if (!fileList) {
      return;
    }
    setUploadError('');
    const incoming = Array.from(fileList);
    const zipFiles = incoming.filter((file) => file.name.toLowerCase().endsWith('.zip'));
    const directFiles = incoming.filter((file) => !file.name.toLowerCase().endsWith('.zip'));
    const extracted: CreativeFile[] = [];
    const directExtracted: CreativeFile[] = [];
    const zipBatches: { label: string; files: CreativeFile[] }[] = [];
    directFiles.forEach((file) => {
      const extension = getExtension(file.name);
      const kind = getKind(extension);
      if (!kind) {
        return;
      }
      const created = buildCreativeFile(file, file.name, extension, kind);
      directExtracted.push(created);
      extracted.push(created);
    });
    for (const zipFile of zipFiles) {
      const zip = await JSZip.loadAsync(zipFile);
      const entries = Object.values(zip.files);
      const batch: CreativeFile[] = [];
      for (const entry of entries) {
        if (entry.dir) {
          continue;
        }
        const fileName = entry.name.split('/').pop() || entry.name;
        const extension = getExtension(fileName);
        const kind = getKind(extension);
        if (!kind) {
          continue;
        }
        const blob = await entry.async('blob');
        const file = new File([blob], fileName, { type: getMime(extension, kind) });
        const created = buildCreativeFile(file, fileName, extension, kind);
        batch.push(created);
        extracted.push(created);
      }
      if (batch.length) {
        zipBatches.push({
          label: zipFile.name.replace(/\.zip$/i, ''),
          files: batch,
        });
      }
    }
    if (!extracted.length) {
      setUploadError('No supported creatives found. Upload ZIPs or supported files.');
      return;
    }
    const kinds = new Set(extracted.map((file) => file.kind));
    if (kinds.size > 1) {
      extracted.forEach((file) => URL.revokeObjectURL(file.previewUrl));
      setUploadError('Upload either images or videos, not both.');
      return;
    }
    const nextKind = Array.from(kinds)[0];
    if (assetKind && assetKind !== nextKind) {
      extracted.forEach((file) => URL.revokeObjectURL(file.previewUrl));
      setUploadError('Upload either images or videos, not both.');
      return;
    }
    setAssetKind(nextKind);
    setFiles((prev) => {
      const next = { ...prev };
      extracted.forEach((file) => {
        next[file.id] = file;
      });
      return next;
    });
    setGroups((prev) => {
      let next = prev.length ? prev : createInitialGroups();
      if (directExtracted.length) {
        next = addFilesToGroup(next, next[0].id, directExtracted);
      }
      zipBatches.forEach((batch) => {
        const label = batch.label.trim() || 'Archive';
        const newGroup = createGroupNode(label);
        next = [...next, newGroup];
        next = addFilesToGroup(next, newGroup.id, batch.files);
      });
      return next;
    });
    extracted.forEach((file) => {
      if (file.kind === 'image') {
        void loadImageSize(file.previewUrl).then((size) => {
          if (!size) {
            return;
          }
          setFiles((prev) => {
            const target = prev[file.id];
            if (!target) {
              return prev;
            }
            return {
              ...prev,
              [file.id]: {
                ...target,
                width: size.width,
                height: size.height,
                sizeInput: target.sizeInput || formatSize(size.width, size.height),
              },
            };
          });
        });
      } else {
        void loadVideoSize(file.previewUrl).then((size) => {
          if (!size) {
            return;
          }
          setFiles((prev) => {
            const target = prev[file.id];
            if (!target) {
              return prev;
            }
            return {
              ...prev,
              [file.id]: {
                ...target,
                width: size.width,
                height: size.height,
                sizeInput: target.sizeInput || formatSize(size.width, size.height),
              },
            };
          });
        });
      }
    });
  };

  const handleClear = () => {
    filesArray.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    setFiles({});
    setGroups(createInitialGroups());
    setAssetKind(null);
    setUploadError('');
  };

  const handleUpdateGroupName = (id: string, value: string, nodes: CreativeNode[]): CreativeNode[] =>
    nodes.map((node) => {
      if (node.id === id && node.type === 'group') {
        return { ...node, name: value };
      }
      if (node.children.length) {
        return { ...node, children: handleUpdateGroupName(id, value, node.children) };
      }
      return node;
    });

  const handleUpdateFile = (id: string, patch: Partial<CreativeFile>) => {
    setFiles((prev) => {
      const target = prev[id];
      if (!target) {
        return prev;
      }
      return { ...prev, [id]: { ...target, ...patch } };
    });
  };

  const handleAddSibling = (id: string) => {
    setGroups((prev) => {
      const result = addSiblingGroup(prev, id);
      return result.changed ? result.nodes : prev;
    });
  };

  const handleAddChild = (id: string) => {
    setGroups((prev) => {
      const result = addChildGroup(prev, id);
      return result.changed ? result.nodes : prev;
    });
  };

  const handleRemoveNode = (id: string, disableRemove: boolean) => {
    if (disableRemove) {
      return;
    }
    const result = removeNodeAndCollect(groups, id);
    if (result.removedFileIds.length) {
      setFiles((prev) => {
        const next = { ...prev };
        result.removedFileIds.forEach((fileId) => {
          if (next[fileId]) {
            URL.revokeObjectURL(next[fileId].previewUrl);
            delete next[fileId];
          }
        });
        return next;
      });
    }
    setGroups(result.nodes);
  };

  const handleDragStart = (event: DragEvent<HTMLDivElement>, fileId: string) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', fileId);
    setPreview(null);
  };

  const handleDropOnGroup = (event: DragEvent<HTMLDivElement>, groupId: string) => {
    event.preventDefault();
    const fileId = event.dataTransfer.getData('text/plain');
    if (!fileId) {
      return;
    }
    setPreview(null);
    setGroups((prev) => moveFileToGroup(prev, fileId, groupId));
  };

  const handleCopyNames = async () => {
    if (!renamePreview.length || hasErrors) {
      return;
    }
    const lines = renamePreview
      .filter((entry) => entry && entry.fullName)
      .map((entry) => entry?.fullName)
      .join('\n');
    try {
      await navigator.clipboard.writeText(lines);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      setCopyState('idle');
    }
  };

  const handleExportCsv = () => {
    if (!renamePreview.length || hasErrors) {
      return;
    }
    const rows = renamePreview
      .filter((entry) => entry)
      .map((entry) => [
        entry?.file.originalName ?? '',
        entry?.fullName ?? '',
        entry?.pathLabel ?? '',
        entry?.sizeValue ?? '',
        entry?.file.identifier ?? '',
      ]);
    const csv = [
      ['Original', 'New name', 'Group path', 'Size', 'Identifier'],
      ...rows,
    ]
      .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'creative-renamer.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadZip = async () => {
    if (!renamePreview.length || hasErrors || isExporting) {
      return;
    }
    setIsExporting(true);
    try {
      const zip = new JSZip();
      for (const entry of renamePreview) {
        if (!entry || !entry.fullName) {
          continue;
        }
        const file = entry.file;
        let blob: Blob = file.file;
        if (outputFormat === 'jpg' || outputFormat === 'png') {
          blob = await convertImage(file.file, outputFormat);
        } else if (outputFormat === 'mp4' && file.extension === 'mp4') {
          blob = file.file;
        } else if (outputFormat === 'keep') {
          blob = file.file;
        }
        zip.file(entry.fullName, blob);
      }
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'creative-renamer.zip';
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  const renderRows = (nodes: CreativeNode[], depth = 0): JSX.Element[] =>
    nodes.flatMap((node) => {
      const isGroup = node.type === 'group';
      const file = files[node.id];
      const disableRemove = isGroup && depth === 0 && groups.length <= 1;
      const widthOffset = 38 + depth * 50;
      const row = (
        <div key={node.id} className="creative-row" style={{ gridColumn: '1 / -1' }}>
          <div className="split-cell-wrapper">
            <div className="split-cell-with-outside" style={{ '--panel-offset': `${widthOffset}px` } as CSSProperties}>
              {isGroup ? (
                <button
                  type="button"
                  className="split-outside-action"
                  onClick={() => handleAddSibling(node.id)}
                  title="Add group"
                >
                  +
                </button>
              ) : (
                <span className="creative-outside-spacer" />
              )}
              <div
                className={`creative-cell${isGroup ? ' is-group' : ' is-file'}`}
                onDragOver={(event) => {
                  if (isGroup) {
                    event.preventDefault();
                  }
                }}
                onDrop={(event) => {
                  if (isGroup) {
                    handleDropOnGroup(event, node.id);
                  }
                }}
              >
                <div className="creative-name-cell">
                  {isGroup ? (
                    <input
                      className="creative-name-input"
                      value={node.name}
                      onChange={(event) =>
                        setGroups((prev) => handleUpdateGroupName(node.id, event.target.value, prev))
                      }
                      placeholder="Group name"
                    />
                  ) : (
                    <div
                      className="creative-file-name"
                      draggable
                      onDragStart={(event) => handleDragStart(event, node.id)}
                      onMouseEnter={(event) => {
                        if (!file) {
                          return;
                        }
                        setPreview({ file, x: event.clientX, y: event.clientY });
                      }}
                      onMouseMove={(event) => {
                        if (!preview || preview.file.id !== node.id) {
                          return;
                        }
                        setPreview({ file: preview.file, x: event.clientX, y: event.clientY });
                      }}
                      onMouseLeave={() => setPreview(null)}
                    >
                      {node.name}
                    </div>
                  )}
                </div>
                <div className="creative-size-cell">
                  {isGroup ? (
                    <span className="creative-placeholder">—</span>
                  ) : (
                    <input
                      className="creative-size-input"
                      value={file?.sizeInput ?? ''}
                      onChange={(event) =>
                        handleUpdateFile(node.id, { sizeInput: event.target.value })
                      }
                      placeholder={formatSize(file?.width ?? null, file?.height ?? null) || '1080x1080'}
                    />
                  )}
                </div>
                <div className="creative-id-cell">
                  {isGroup ? (
                    <span className="creative-placeholder">—</span>
                  ) : (
                    <input
                      className="creative-id-input"
                      value={file?.identifier ?? ''}
                      onChange={(event) => handleUpdateFile(node.id, { identifier: event.target.value })}
                      placeholder="Identifier"
                    />
                  )}
                </div>
                <div className="split-cell-actions">
                  {isGroup ? (
                    <button type="button" onClick={() => handleAddChild(node.id)} title="Add subgroup">
                      +
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="split-remove-button"
                    onClick={() => handleRemoveNode(node.id, disableRemove)}
                    title="Remove"
                    disabled={disableRemove}
                  >
                    x
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
      if (!node.children.length) {
        return [row];
      }
      return [row, ...renderRows(node.children, depth + 1)];
    });

  return (
    <section className="creative-renamer">
      <header className="controls-wrapper">
        <div className="controls">
          <div className="controls-heading">
            <h1 className="controls-heading-title">Creative Renamer</h1>
            <p className="controls-subtitle">
              Upload archives, group your creatives, and generate consistent names with sizes and identifiers.
            </p>
          </div>
          <div className="split-control">
            <div className="stacked-field-column">
              <div className="stacked-field">
                <div className="number-field number-field-mode">
                  <label className="number-field-label">Select creatives</label>
                  <div className="number-field-input-wrapper creative-upload">
                    <button type="button" onClick={handleFileButton}>
                      Upload ZIPs or files
                    </button>
                    <span>
                      {hasFiles
                        ? `${filesArray.length} files · ${assetKind === 'video' ? 'Video' : 'Image'}`
                        : 'ZIPs or files'}
                    </span>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".zip,image/*,video/*"
                    multiple
                    onChange={(event) => {
                      void handleFilesAdded(event.target.files);
                      event.target.value = '';
                    }}
                    hidden
                  />
                </div>
              </div>
            </div>
            <div className="stacked-field-column">
              <div className="stacked-field">
                <div className="number-field number-field-mode">
                  <label className="number-field-label">Separator</label>
                  <div className="number-field-input-wrapper">
                    <input
                      type="text"
                      value={separator}
                      onChange={(event) => setSeparator(event.target.value)}
                      placeholder="-"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="stacked-field-column">
              <div className="stacked-field">
                <div className="number-field number-field-mode">
                  <label className="number-field-label">Output format</label>
                  <div className="number-field-input-wrapper">
                    <select
                      className="creative-output-select"
                      value={outputFormat}
                      onChange={(event) =>
                        setOutputFormat(event.target.value as 'keep' | 'jpg' | 'png' | 'mp4')
                      }
                    >
                      <option value="keep">Keep original</option>
                      <option value="jpg">JPG</option>
                      <option value="png">PNG</option>
                      <option value="mp4">MP4</option>
                    </select>
                  </div>
                  <label className="creative-toggle">
                    <input
                      type="checkbox"
                      checked={includeSize}
                      onChange={(event) => setIncludeSize(event.target.checked)}
                    />
                    Include size in name
                  </label>
                </div>
              </div>
            </div>
          </div>
          {uploadError ? <p className="creative-error">{uploadError}</p> : null}
          {formatMismatch ? <p className="creative-error">{formatMismatch}</p> : null}
        </div>
      </header>

      <div className="creative-grid">
        <header className="card-header creative-header">
          <div className="card-header-top">
            <h2>Input data</h2>
            <button type="button" onClick={handleClear} disabled={!hasFiles && groups.length === 1}>
              Clear field
            </button>
          </div>
        </header>
        <div className="creative-grid-header">
          <span>Name</span>
          <span>Size</span>
          <span>Identifier</span>
          <span className="creative-header-spacer" />
        </div>
        <div className="creative-table">{renderRows(groups)}</div>
      </div>

      <section className="card results-card creative-results">
        <header className="card-header">
          <div className="card-header-top">
            <h2>Result</h2>
            <div className="split-result-actions">
              <button type="button" onClick={handleCopyNames} disabled={hasErrors || !hasFiles}>
                {copyState === 'copied' ? 'Copied!' : 'Copy names'}
              </button>
              <button type="button" onClick={handleExportCsv} disabled={hasErrors || !hasFiles}>
                Export CSV
              </button>
              <button type="button" onClick={handleDownloadZip} disabled={hasErrors || !hasFiles || isExporting}>
                {isExporting ? 'Preparing...' : 'Download ZIP'}
              </button>
            </div>
          </div>
        </header>
        <div className="creative-result-list">
          {renamePreview.length === 0 ? (
            <p className="muted">Upload creatives to see the new names.</p>
          ) : (
            renamePreview.map((entry) => {
              if (!entry) {
                return null;
              }
              return (
                <div key={entry.file.id} className="creative-result-item">
                  <div className="creative-result-main">
                    <span className="creative-result-original">{entry.file.originalName}</span>
                    <strong className="creative-result-name">{entry.fullName || '—'}</strong>
                  </div>
                  {entry.errors.length ? (
                    <span className="creative-result-error">{entry.errors.join(' ')}</span>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </section>

      {preview ? (
        <div
          className="creative-preview"
          style={{ left: preview.x + 16, top: preview.y + 16 }}
        >
          {preview.file.kind === 'image' ? (
            <img src={preview.file.previewUrl} alt={preview.file.originalName} />
          ) : (
            <video src={preview.file.previewUrl} muted autoPlay loop playsInline />
          )}
        </div>
      ) : null}
    </section>
  );
};
