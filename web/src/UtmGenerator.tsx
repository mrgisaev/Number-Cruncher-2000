import { type CSSProperties, useMemo, useState } from 'react';

type UtmLevel = 'source' | 'medium' | 'campaign' | 'term' | 'content' | 'id';

type UtmNode = {
  id: string;
  level: UtmLevel;
  name: string;
  valueInput: string;
  children: UtmNode[];
};

type FlatNode = {
  id: string;
  parentId: string | null;
  depth: number;
  node: UtmNode;
};

type UtmPath = {
  source: string;
  medium: string;
  campaign: string;
  term: string;
  content: string;
  id: string;
  labelPath: string;
};

const levelOrder: UtmLevel[] = ['source', 'medium', 'campaign', 'term', 'content', 'id'];

const levelBaseLabel: Record<UtmLevel, string> = {
  source: 'Source',
  medium: 'Medium',
  campaign: 'Campaign',
  term: 'Term',
  content: 'Content',
  id: 'ID',
};

const levelParamKey: Record<UtmLevel, string> = {
  source: 'utm_source',
  medium: 'utm_medium',
  campaign: 'utm_campaign',
  term: 'utm_term',
  content: 'utm_content',
  id: 'utm_id',
};

const createId = () => Math.random().toString(36).slice(2, 10);

const getNextLevel = (level: UtmLevel): UtmLevel | null => {
  const index = levelOrder.indexOf(level);
  if (index === -1 || index === levelOrder.length - 1) {
    return null;
  }
  return levelOrder[index + 1];
};

const getNextLabel = (nodes: UtmNode[], level: UtmLevel) => {
  const base = levelBaseLabel[level];
  const regex = new RegExp(`^${base}(?:\\s+(\\d+))?$`, 'i');
  let max = 0;

  nodes.forEach((node) => {
    if (node.level !== level) {
      return;
    }
    const match = node.name.trim().match(regex);
    if (!match) {
      return;
    }
    const parsed = match[1] ? Number.parseInt(match[1], 10) : 1;
    if (Number.isFinite(parsed)) {
      max = Math.max(max, parsed);
    }
  });

  const next = max + 1;
  return next <= 1 ? base : `${base} ${next}`;
};

const createNode = (level: UtmLevel, siblings: UtmNode[]): UtmNode => ({
  id: createId(),
  level,
  name: getNextLabel(siblings, level),
  valueInput: '',
  children: [],
});

const cloneNodeTree = (node: UtmNode): UtmNode => ({
  ...node,
  id: createId(),
  children: node.children.map(cloneNodeTree),
});

const createSiblingFromNode = (node: UtmNode, siblings: UtmNode[]): UtmNode => {
  const cloned = cloneNodeTree(node);
  cloned.name = getNextLabel(siblings, node.level);
  return cloned;
};

const buildDefaultTree = () => {
  const sourceNode = createNode('source', []);
  const mediumNode = createNode('medium', []);
  const campaignNode = createNode('campaign', []);
  const termNode = createNode('term', []);
  const contentNode = createNode('content', []);
  const idNode = createNode('id', []);

  contentNode.children = [idNode];
  termNode.children = [contentNode];
  campaignNode.children = [termNode];
  mediumNode.children = [campaignNode];
  sourceNode.children = [mediumNode];

  return [sourceNode];
};

const updateNode = (nodes: UtmNode[], id: string, updater: (node: UtmNode) => UtmNode): UtmNode[] => {
  return nodes.map((node) => {
    if (node.id === id) {
      return updater(node);
    }
    if (!node.children.length) {
      return node;
    }
    return { ...node, children: updateNode(node.children, id, updater) };
  });
};

const updateListContaining = (
  nodes: UtmNode[],
  targetId: string,
  updater: (list: UtmNode[], index: number) => UtmNode[],
): UtmNode[] => {
  const index = nodes.findIndex((node) => node.id === targetId);
  if (index !== -1) {
    return updater(nodes, index);
  }

  let changed = false;
  const next = nodes.map((node) => {
    if (!node.children.length) {
      return node;
    }
    const updatedChildren = updateListContaining(node.children, targetId, updater);
    if (updatedChildren !== node.children) {
      changed = true;
      return { ...node, children: updatedChildren };
    }
    return node;
  });

  return changed ? next : nodes;
};

const addSibling = (nodes: UtmNode[], targetId: string) => {
  return updateListContaining(nodes, targetId, (list, index) => {
    const target = list[index];
    const next = [...list];
    next.splice(index + 1, 0, createSiblingFromNode(target, next));
    return next;
  });
};

const addChild = (nodes: UtmNode[], targetId: string) => {
  return updateNode(nodes, targetId, (node) => {
    const childLevel = getNextLevel(node.level);
    if (!childLevel) {
      return node;
    }
    return {
      ...node,
      children: [...node.children, createNode(childLevel, node.children)],
    };
  });
};

const removeNode = (nodes: UtmNode[], targetId: string) => {
  return updateListContaining(nodes, targetId, (list, index) => {
    const next = [...list];
    next.splice(index, 1);
    return next;
  });
};

const flattenTree = (nodes: UtmNode[]) => {
  const flat: FlatNode[] = [];

  const walk = (list: UtmNode[], depth: number, parentId: string | null) => {
    list.forEach((node) => {
      flat.push({ id: node.id, parentId, depth, node });
      if (node.children.length) {
        walk(node.children, depth + 1, node.id);
      }
    });
  };

  walk(nodes, 0, null);
  return flat;
};

const parsePastedCells = (text: string) =>
  text
    .split(/\r?\n/)
    .flatMap((line) => line.split('\t'))
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);

const parseLandingPages = (value: string) => {
  const seen = new Set<string>();
  const pages: string[] = [];

  value
    .split(/\r?\n/)
    .map((line) => line.split('\t')[0]?.trim() ?? '')
    .filter((line) => line.length > 0)
    .forEach((line) => {
      if (!seen.has(line)) {
        seen.add(line);
        pages.push(line);
      }
    });

  return pages;
};

const parseBaseUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return new URL(trimmed);
  } catch {
    if (/^[^\s./]+\.[^\s]+/.test(trimmed)) {
      try {
        return new URL(`https://${trimmed}`);
      } catch {
        return null;
      }
    }
    return null;
  }
};

const collectLeafPaths = (nodes: UtmNode[]) => {
  const collected: UtmPath[] = [];

  const walk = (
    list: UtmNode[],
    current: Record<UtmLevel, string>,
    labels: string[],
  ) => {
    list.forEach((node) => {
      const next = { ...current, [node.level]: node.valueInput.trim() };
      const nextLabels = [...labels, node.name];

      if (!node.children.length) {
        collected.push({
          source: next.source ?? '',
          medium: next.medium ?? '',
          campaign: next.campaign ?? '',
          term: next.term ?? '',
          content: next.content ?? '',
          id: next.id ?? '',
          labelPath: nextLabels.join(' > '),
        });
        return;
      }

      walk(node.children, next, nextLabels);
    });
  };

  walk(nodes, {
    source: '',
    medium: '',
    campaign: '',
    term: '',
    content: '',
    id: '',
  }, []);

  return collected;
};

const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
const normalizeUtmParamValue = (value: string) => value.trim().replace(/\s+/g, '-');

export const UtmGenerator = () => {
  const [lpPasteInput, setLpPasteInput] = useState('');
  const [rows, setRows] = useState<UtmNode[]>(() => buildDefaultTree());
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  const landingPages = useMemo(() => parseLandingPages(lpPasteInput), [lpPasteInput]);
  const flatRows = useMemo(() => flattenTree(rows), [rows]);
  const leafPaths = useMemo(() => collectLeafPaths(rows), [rows]);

  const activePaths = useMemo(
    () =>
      leafPaths.filter((path) =>
        (Object.keys(levelParamKey) as UtmLevel[]).some((level) => path[level].trim().length > 0),
      ),
    [leafPaths],
  );

  const validPages = useMemo(
    () => landingPages.map((page) => ({ page, parsed: parseBaseUrl(page) })).filter((item) => item.parsed),
    [landingPages],
  );

  const invalidPages = useMemo(
    () => landingPages.filter((page) => !parseBaseUrl(page)),
    [landingPages],
  );

  const generatedUrls = useMemo(() => {
    const unique = new Set<string>();

    const buildParams = (path: UtmPath) => {
      const params = new URLSearchParams();
      (Object.keys(levelParamKey) as UtmLevel[]).forEach((level) => {
        const key = levelParamKey[level];
        const value = normalizeUtmParamValue(path[level]);
        if (value) {
          params.set(key, value);
        }
      });
      return params;
    };

    if (validPages.length > 0) {
      validPages.forEach(({ parsed }) => {
        if (!parsed) {
          return;
        }
        activePaths.forEach((path) => {
          const url = new URL(parsed.toString());
          const params = buildParams(path);
          params.forEach((value, key) => {
            url.searchParams.set(key, value);
          });
          unique.add(url.toString());
        });
      });
    } else {
      activePaths.forEach((path) => {
        const params = buildParams(path);
        const query = params.toString();
        if (query) {
          unique.add(`?${query}`);
        }
      });
    }

    return Array.from(unique);
  }, [validPages, activePaths]);

  const hasLp = landingPages.length > 0;
  const hasRowsWithValues = activePaths.length > 0;

  const resultSubtitle = (() => {
    if (hasLp) {
      return `${landingPages.length} LPs | ${activePaths.length} branches | ${generatedUrls.length} unique URLs`;
    }
    if (hasRowsWithValues) {
      return `0 LPs | ${activePaths.length} branches | ${generatedUrls.length} generated query strings`;
    }
    return `0 LPs | 0 branches | 0 unique URLs`;
  })();

  const emptyHint = hasLp
    ? 'Fill Value fields in Input data to generate URLs.'
    : 'Add LP and/or fill Value fields to generate URL output.';

  const invalidLpCount = invalidPages.length;

  const handleClearTree = () => {
    setRows(buildDefaultTree());
  };

  const handleAddSibling = (id: string) => {
    setRows((prev) => addSibling(prev, id));
  };

  const handleAddChild = (id: string) => {
    setRows((prev) => addChild(prev, id));
  };

  const handleRemove = (id: string) => {
    setRows((prev) => {
      const next = removeNode(prev, id);
      return next.length ? next : buildDefaultTree();
    });
  };

  const handleUpdateName = (id: string, value: string) => {
    setRows((prev) => updateNode(prev, id, (node) => ({ ...node, name: value })));
  };

  const handleUpdateValue = (id: string, value: string) => {
    setRows((prev) => updateNode(prev, id, (node) => ({ ...node, valueInput: value })));
  };

  const handleValuePaste = (id: string, text: string) => {
    const values = parsePastedCells(text);
    if (!values.length) {
      return;
    }

    setRows((prev) =>
      updateListContaining(prev, id, (list, index) => {
        const template = list[index];
        const next = [...list];
        next[index] = { ...template, valueInput: values[0] };

        let insertAt = index + 1;
        values.slice(1).forEach((value) => {
          const sibling = createSiblingFromNode(template, next);
          sibling.valueInput = value;
          next.splice(insertAt, 0, sibling);
          insertAt += 1;
        });

        return next;
      }),
    );
  };

  const handleCopyUrls = async () => {
    if (!generatedUrls.length) {
      return;
    }
    try {
      await navigator.clipboard.writeText(generatedUrls.join('\n'));
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      setCopyState('idle');
    }
  };

  const handleExportCsv = () => {
    const lines = ['generated_url', ...generatedUrls.map((url) => escapeCsv(url))];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = 'utm-generated-links.csv';
    link.click();
    URL.revokeObjectURL(blobUrl);
  };

  return (
    <section className="utm-generator">
      <section className="controls-wrapper">
        <div className="controls">
          <div className="controls-heading">
            <h1 className="controls-heading-title">UTM Generator</h1>
            <p className="controls-subtitle">
              Build UTM links in bulk from LP list and nested parameter groups.
            </p>
          </div>
          <div className="split-control utm-lp-control">
            <div className="stacked-field-column">
              <div className="stacked-field">
                <label className="number-field-label" htmlFor="utm-lp-paste-input">
                  Paste LP
                </label>
                <textarea
                  id="utm-lp-paste-input"
                  className="utm-lp-input"
                  value={lpPasteInput}
                  onChange={(event) => setLpPasteInput(event.target.value)}
                  rows={1}
                  spellCheck={false}
                  placeholder="Paste URL (landing page)"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="card utm-grid">
        <header className="card-header split-grid-header-row">
          <div className="card-header-top">
            <h2>Input data</h2>
            <button type="button" onClick={handleClearTree}>
              Clear field
            </button>
          </div>
        </header>

        <div className="split-table utm-tree-table">
          {flatRows.map((row) => {
            const widthOffset = 38 + row.depth * 50;
            const childAllowed = getNextLevel(row.node.level) !== null;
            return (
              <div key={row.id} className="split-row" style={{ gridColumn: '1 / -1' }}>
                <div className="split-cell-wrapper">
                  <div
                    className="split-cell-with-outside"
                    style={{ '--panel-offset': `${widthOffset}px` } as CSSProperties}
                  >
                    <button
                      type="button"
                      className="split-outside-action"
                      onClick={() => handleAddSibling(row.id)}
                      title="Add row"
                    >
                      +
                    </button>
                    <div className="split-cell utm-tree-cell">
                      <div className="utm-level-cell">
                        <input
                          className="split-name-input"
                          value={row.node.name}
                          onChange={(event) => handleUpdateName(row.id, event.target.value)}
                        />
                      </div>
                      <input
                        className="split-value-input"
                        value={row.node.valueInput}
                        onChange={(event) => handleUpdateValue(row.id, event.target.value)}
                        onPaste={(event) => {
                          const text = event.clipboardData.getData('text');
                          const values = parsePastedCells(text);
                          if (values.length > 1) {
                            event.preventDefault();
                            handleValuePaste(row.id, text);
                          }
                        }}
                        placeholder="Value"
                      />
                      <div className="split-cell-actions">
                        <button
                          type="button"
                          onClick={() => handleAddChild(row.id)}
                          disabled={!childAllowed}
                          title="Add children"
                        >
                          +
                        </button>
                        <button
                          type="button"
                          className="split-remove-button"
                          onClick={() => handleRemove(row.id)}
                          title="Remove row"
                        >
                          x
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card results-card utm-results-card">
        <header className="card-header">
          <div className="card-header-top">
            <h2>Result</h2>
            <div className="utm-result-actions">
              <button type="button" onClick={handleCopyUrls} disabled={!generatedUrls.length}>
                {copyState === 'copied' ? 'Copied!' : 'Copy URLs'}
              </button>
              <button type="button" onClick={handleExportCsv} disabled={!generatedUrls.length}>
                Export CSV
              </button>
            </div>
          </div>
          <p>
            {resultSubtitle}
          </p>
        </header>

        {invalidLpCount > 0 ? (
          <div className="utm-errors">
            <p className="utm-result-error">Invalid LP rows: {invalidLpCount}</p>
          </div>
        ) : null}

        <div className="result-list utm-result-list">
          {generatedUrls.length ? (
            generatedUrls.map((url, index) => (
              <div key={url} className="result-item utm-result-item">
                <span className="result-index">{index + 1}</span>
                <div className="result-value utm-result-value">{url}</div>
              </div>
            ))
          ) : (
            <p className="muted">{emptyHint}</p>
          )}
        </div>
      </section>
    </section>
  );
};
