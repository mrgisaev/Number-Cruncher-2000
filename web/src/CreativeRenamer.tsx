import {
  type CSSProperties,
  type ClipboardEvent,
  type DragEvent,
  type ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  pathIds: string[];
};

type GroupChange = {
  nodes: CreativeNode[];
  changed: boolean;
};

type RemoveResult = {
  nodes: CreativeNode[];
  removedFileIds: string[];
};

type DetachResult = {
  nodes: CreativeNode[];
  detached: CreativeNode | null;
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

const parsePasteLines = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => line.split('\t')[0]?.trim() ?? '')
    .filter((line) => line.length > 0);

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

const addSiblingGroup = (nodes: CreativeNode[], id: string, depth = 0): GroupChange => {
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

const addSiblingGroups = (nodes: CreativeNode[], id: string, labels: string[]): GroupChange => {
  if (!labels.length) {
    return { nodes, changed: false };
  }
  let changed = false;
  const next: CreativeNode[] = [];
  nodes.forEach((node) => {
    if (node.id === id && node.type === 'group') {
      next.push(node);
      labels.forEach((label) => {
        next.push(createGroupNode(label));
      });
      changed = true;
      return;
    }
    if (node.children.length) {
      const result = addSiblingGroups(node.children, id, labels);
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

const addChildGroup = (nodes: CreativeNode[], id: string, depth = 0): GroupChange => {
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

const addFilesToGroup = (
  nodes: CreativeNode[],
  groupId: string,
  files: CreativeFile[],
): CreativeNode[] => {
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

const insertNodeToGroup = (
  nodes: CreativeNode[],
  groupId: string,
  child: CreativeNode,
): CreativeNode[] =>
  nodes.map((node) => {
    if (node.id === groupId && node.type === 'group') {
      return { ...node, children: [...node.children, child] };
    }
    if (node.children.length) {
      return { ...node, children: insertNodeToGroup(node.children, groupId, child) };
    }
    return node;
  });

const removeNodeAndCollect = (nodes: CreativeNode[], id: string): RemoveResult => {
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

const detachFileNode = (nodes: CreativeNode[], fileId: string): DetachResult => {
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

const detachNode = (nodes: CreativeNode[], nodeId: string): DetachResult => {
  let detached: CreativeNode | null = null;
  const next = nodes
    .filter((node) => {
      if (node.id === nodeId) {
        detached = node;
        return false;
      }
      return true;
    })
    .map((node) => {
      if (!node.children.length) {
        return node;
      }
      const result = detachNode(node.children, nodeId);
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

const containsNodeId = (node: CreativeNode, targetId: string): boolean => {
  if (node.id === targetId) {
    return true;
  }
  return node.children.some((child) => containsNodeId(child, targetId));
};

const isDescendant = (nodes: CreativeNode[], ancestorId: string, targetId: string): boolean => {
  for (const node of nodes) {
    if (node.id === ancestorId) {
      return containsNodeId(node, targetId);
    }
    if (node.children.length && isDescendant(node.children, ancestorId, targetId)) {
      return true;
    }
  }
  return false;
};

const findParentId = (
  nodes: CreativeNode[],
  targetId: string,
  parentId: string | null = null,
): string | null => {
  for (const node of nodes) {
    if (node.id === targetId) {
      return parentId;
    }
    if (node.children.length) {
      const found = findParentId(node.children, targetId, node.id);
      if (found !== null) {
        return found;
      }
    }
  }
  return null;
};

const moveGroupToRoot = (nodes: CreativeNode[], groupId: string) => {
  const detachedResult = detachNode(nodes, groupId);
  if (!detachedResult.detached) {
    return nodes;
  }
  return [...detachedResult.nodes, detachedResult.detached];
};

const moveGroupToGroup = (nodes: CreativeNode[], groupId: string, targetGroupId: string) => {
  const detachedResult = detachNode(nodes, groupId);
  if (!detachedResult.detached) {
    return nodes;
  }
  return insertNodeToGroup(detachedResult.nodes, targetGroupId, detachedResult.detached);
};

const collectFileIds = (nodes: CreativeNode[]): string[] => {
  const ids: string[] = [];
  nodes.forEach((node) => {
    if (node.type === 'file') {
      ids.push(node.id);
      return;
    }
    ids.push(...collectFileIds(node.children));
  });
  return ids;
};

const getGroupFileIds = (nodes: CreativeNode[], groupId: string): string[] => {
  for (const node of nodes) {
    if (node.id === groupId && node.type === 'group') {
      return collectFileIds(node.children);
    }
    if (node.children.length) {
      const result = getGroupFileIds(node.children, groupId);
      if (result.length) {
        return result;
      }
    }
  }
  return [];
};

const flattenFiles = (nodes: CreativeNode[], path: string[] = [], pathIds: string[] = []) => {
  const entries: FileEntry[] = [];
  nodes.forEach((node) => {
    if (node.type === 'group') {
      const segment = normalizeSegment(node.name);
      const nextPath = segment ? [...path, segment] : path;
      const nextIds = [...pathIds, node.id];
      entries.push(...flattenFiles(node.children, nextPath, nextIds));
      return;
    }
    entries.push({ fileId: node.id, pathSegments: path, pathIds });
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
  const [includeFormat, setIncludeFormat] = useState(false);
  const [outputFormat, setOutputFormat] = useState<'keep' | 'jpg' | 'png' | 'mp4'>('keep');
  const [isFormatMenuOpen, setIsFormatMenuOpen] = useState(false);
  const [assetKind, setAssetKind] = useState<'image' | 'video' | 'mixed' | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [isExporting, setIsExporting] = useState(false);
  const [preview, setPreview] = useState<{ file: CreativeFile; x: number; y: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const formatMenuRef = useRef<HTMLDivElement | null>(null);
  const outputFormatOptions = useMemo(
    () => [
      { value: 'keep' as const, label: 'Keep original' },
      { value: 'jpg' as const, label: 'JPG' },
      { value: 'png' as const, label: 'PNG' },
      { value: 'mp4' as const, label: 'MP4' },
    ],
    [],
  );
  const outputFormatLabel =
    outputFormatOptions.find((option) => option.value === outputFormat)?.label ?? 'Keep original';

  const fileEntries = useMemo(() => flattenFiles(groups), [groups]);
  const filesArray = useMemo(() => Object.values(files), [files]);
  const hasFiles = filesArray.length > 0;

  const formatMismatch = useMemo(() => {
    if (outputFormat === 'keep' || filesArray.length === 0) {
      return '';
    }
    if (outputFormat === 'mp4') {
      return filesArray.some((file) => file.kind !== 'video')
        ? 'MP4 output only applies to video files.'
        : '';
    }
    if (outputFormat === 'jpg' || outputFormat === 'png') {
      return filesArray.some((file) => file.kind !== 'image')
        ? 'JPG/PNG output only applies to image files.'
        : '';
    }
    return '';
  }, [filesArray, outputFormat]);

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
      const displayName = baseName
        ? includeFormat
          ? `${baseName}.${extension}`
          : baseName
        : '';
      const exportName = baseName ? `${baseName}.${extension}` : '';
      return {
        file,
        baseName,
        displayName,
        exportName,
        sizeValue,
        pathLabel: entry.pathSegments.join(' / '),
        pathIds: entry.pathIds,
        pathSegments: entry.pathSegments,
      };
    });
    const nameCounts = new Map<string, number>();
    entries.forEach((entry) => {
      if (!entry || !entry.exportName) {
        return;
      }
      const pathKey = entry.pathIds.join('>');
      const key = `${entry.exportName}||${pathKey}`;
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
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
      if (outputFormat === 'mp4') {
        if (entry.file.kind !== 'video') {
          errors.push('MP4 output only applies to video files.');
        } else if (entry.file.extension !== 'mp4') {
          errors.push('Only MP4 input is supported for MP4 output.');
        }
      }
      if (outputFormat === 'jpg' || outputFormat === 'png') {
        if (entry.file.kind !== 'image') {
          errors.push('JPG/PNG output only applies to image files.');
        }
      }
      if (entry.exportName) {
        const pathKey = entry.pathIds.join('>');
        const key = `${entry.exportName}||${pathKey}`;
        if ((nameCounts.get(key) ?? 0) > 1) {
          errors.push('Duplicate filename.');
        }
      }
      return { ...entry, errors };
    });
  }, [fileEntries, files, includeSize, includeFormat, outputFormat, separator]);

  const hasErrors = renamePreview.some((entry) => entry && entry.errors.length > 0) || !!formatMismatch;

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!formatMenuRef.current) {
        return;
      }
      if (!formatMenuRef.current.contains(event.target as Node)) {
        setIsFormatMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  const handleFormatSelect = (value: 'keep' | 'jpg' | 'png' | 'mp4') => {
    setOutputFormat(value);
    setIsFormatMenuOpen(false);
  };

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
    const nextKind = kinds.size > 1 ? 'mixed' : Array.from(kinds)[0];
    setAssetKind((prev) => {
      if (!prev) {
        return nextKind ?? null;
      }
      if (prev === 'mixed' || nextKind === 'mixed') {
        return 'mixed';
      }
      if (nextKind && prev !== nextKind) {
        return 'mixed';
      }
      return prev;
    });
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

  const handleGroupPaste = (event: ClipboardEvent<HTMLInputElement>, groupId: string) => {
    const lines = parsePasteLines(event.clipboardData.getData('text'));
    if (lines.length <= 1) {
      return;
    }
    event.preventDefault();
    setGroups((prev) => {
      let next = handleUpdateGroupName(groupId, lines[0], prev);
      const siblings = lines.slice(1);
      const result = addSiblingGroups(next, groupId, siblings);
      return result.changed ? result.nodes : next;
    });
  };

  const handleIdentifierPaste = (event: ClipboardEvent<HTMLInputElement>, fileId: string) => {
    const lines = parsePasteLines(event.clipboardData.getData('text'));
    if (lines.length <= 1) {
      return;
    }
    event.preventDefault();
    const parentId = findParentId(groups, fileId);
    if (!parentId) {
      return;
    }
    const ids = getGroupFileIds(groups, parentId);
    if (!ids.length) {
      return;
    }
    setFiles((prev) => {
      const next = { ...prev };
      lines.forEach((line, index) => {
        const targetId = ids[index];
        if (!targetId) {
          return;
        }
        const target = next[targetId];
        if (!target) {
          return;
        }
        next[targetId] = { ...target, identifier: line };
      });
      return next;
    });
  };

  const handleDragStart = (event: DragEvent<HTMLDivElement>, fileId: string) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', fileId);
    event.dataTransfer.setData(
      'application/x-creative-node',
      JSON.stringify({ type: 'file', id: fileId }),
    );
    const dragTarget = (event.currentTarget.closest('.creative-cell') as HTMLElement | null)
      ?? event.currentTarget;
    if (dragTarget) {
      event.dataTransfer.setDragImage(dragTarget, 24, 24);
    }
    setPreview(null);
  };

  const handleDragStartGroup = (event: DragEvent<HTMLDivElement>, groupId: string) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(
      'application/x-creative-node',
      JSON.stringify({ type: 'group', id: groupId }),
    );
    const dragTarget = (event.currentTarget.closest('.creative-cell') as HTMLElement | null)
      ?? event.currentTarget;
    if (dragTarget) {
      event.dataTransfer.setDragImage(dragTarget, 24, 24);
    }
    setPreview(null);
  };

  const handleDropOnGroup = (event: DragEvent<HTMLDivElement>, groupId: string) => {
    event.preventDefault();
    setPreview(null);
    const rect = event.currentTarget.getBoundingClientRect();
    const isOutdent = event.clientX < rect.left + 32;
    const payload = event.dataTransfer.getData('application/x-creative-node');
    let parsed: { type: 'file' | 'group'; id: string } | null = null;
    if (payload) {
      try {
        const data = JSON.parse(payload) as { type?: string; id?: string };
        if ((data.type === 'file' || data.type === 'group') && data.id) {
          parsed = { type: data.type, id: data.id };
        }
      } catch {
        parsed = null;
      }
    }
    if (!parsed) {
      const fileId = event.dataTransfer.getData('text/plain');
      if (fileId) {
        parsed = { type: 'file', id: fileId };
      }
    }
    if (!parsed) {
      return;
    }
    setGroups((prev) => {
      if (parsed.type === 'file') {
        return moveFileToGroup(prev, parsed.id, groupId);
      }
      if (parsed.id === groupId || isDescendant(prev, parsed.id, groupId)) {
        return prev;
      }
      const currentParentId = findParentId(prev, parsed.id);
      if (currentParentId && (isOutdent || groupId === currentParentId)) {
        const newParentId = findParentId(prev, currentParentId);
        if (!newParentId) {
          return moveGroupToRoot(prev, parsed.id);
        }
        if (newParentId === parsed.id) {
          return prev;
        }
        return moveGroupToGroup(prev, parsed.id, newParentId);
      }
      return moveGroupToGroup(prev, parsed.id, groupId);
    });
  };

  const handleCopyNames = async () => {
    if (!renamePreview.length || hasErrors) {
      return;
    }
    const lines = renamePreview
      .filter((entry) => entry && entry.displayName)
      .map((entry) => entry?.displayName)
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
        entry?.displayName ?? '',
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
        if (!entry || !entry.exportName) {
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
        const folderPath = entry.pathSegments
          .map((segment) => normalizeSegment(segment))
          .filter(Boolean)
          .join('/');
        const filePath = folderPath ? `${folderPath}/${entry.exportName}` : entry.exportName;
        zip.file(filePath, blob);
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

  const renderRows = (nodes: CreativeNode[], depth = 0): ReactElement[] =>
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
                    <>
                      <span
                        className="creative-drag-handle"
                        draggable
                        onDragStart={(event) => handleDragStartGroup(event, node.id)}
                        aria-hidden="true"
                        title="Drag group"
                      >
                        ::
                      </span>
                      <input
                        className="creative-name-input"
                        value={node.name}
                        onChange={(event) =>
                          setGroups((prev) => handleUpdateGroupName(node.id, event.target.value, prev))
                        }
                        onPaste={(event) => handleGroupPaste(event, node.id)}
                        placeholder="Group name"
                      />
                    </>
                  ) : (
                    <>
                      <span
                        className="creative-drag-handle"
                        draggable
                        onDragStart={(event) => handleDragStart(event, node.id)}
                        aria-hidden="true"
                        title="Drag file"
                      >
                        ::
                      </span>
                      <div
                        className="creative-file-name"
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
                    </>
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
                      onPaste={(event) => handleIdentifierPaste(event, node.id)}
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
                  <label className="creative-toggle">
                    <span>Include size in name</span>
                    <input
                      type="checkbox"
                      checked={includeSize}
                      onChange={(event) => setIncludeSize(event.target.checked)}
                    />
                  </label>
                </div>
              </div>
            </div>
            <div className="stacked-field-column">
              <div className="stacked-field">
                <div className="number-field number-field-mode">
                  <label className="number-field-label">Output format</label>
                  <div className="number-field-input-wrapper">
                    <div className="split-output-dropdown creative-output-dropdown" ref={formatMenuRef}>
                      <button
                        type="button"
                        className="split-output-trigger"
                        aria-haspopup="listbox"
                        aria-expanded={isFormatMenuOpen}
                        onClick={() => setIsFormatMenuOpen((prev) => !prev)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            setIsFormatMenuOpen(false);
                          }
                        }}
                      >
                        <span className="split-output-label">{outputFormatLabel}</span>
                        <span className="split-output-caret" aria-hidden="true" />
                      </button>
                      {isFormatMenuOpen ? (
                        <div className="split-output-menu" role="listbox" aria-label="Output format">
                          {outputFormatOptions.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              className={`split-output-option${
                                option.value === outputFormat ? ' is-active' : ''
                              }`}
                              role="option"
                              aria-selected={option.value === outputFormat}
                              onClick={() => handleFormatSelect(option.value)}
                            >
                              <span className="split-output-option-text">{option.label}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <label className="creative-toggle">
                    <span>Include format in name</span>
                    <input
                      type="checkbox"
                      checked={includeFormat}
                      onChange={(event) => setIncludeFormat(event.target.checked)}
                    />
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
        <div className="creative-table">{renderRows(groups)}</div>
      </div>

      <section className="card results-card creative-results">
        <header className="card-header">
          <div className="card-header-top">
            <div className="creative-result-title">
              <h2>Result</h2>
              {hasFiles ? (
                <span className="creative-result-meta">
                  {filesArray.length} files ·{' '}
                  {assetKind === 'mixed' ? 'Mixed' : assetKind === 'video' ? 'Video' : 'Image'}
                </span>
              ) : null}
            </div>
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
                    <strong className="creative-result-name">{entry.displayName || '—'}</strong>
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
