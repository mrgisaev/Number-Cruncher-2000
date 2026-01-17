import { type CSSProperties, useMemo, useRef, useState } from 'react';

import { addGrouping, parseColumn } from './shareSplitterUtils';

type SplitNode = {
  id: string;
  name: string;
  valueInput: string;
  children: SplitNode[];
};

type ComputedNode = {
  id: string;
  sourceId: string | null;
  name: string;
  valueInput: string;
  amount: number;
  percent: number;
  depth: number;
  isNotSet: boolean;
  isIgnored: boolean;
  children: ComputedNode[];
  error?: string | null;
};

type CachedMode = {
  mode: 'percent' | 'absolute';
  remainder: number;
  remainderPercent: number;
  notSetValueInput: string;
};

const createId = () => Math.random().toString(36).slice(2, 10);

const createDefaultChildren = () => [
  { id: createId(), name: 'Subgroup 1', valueInput: '50%', children: [] },
  { id: createId(), name: 'Subgroup 2', valueInput: '50%', children: [] },
];

const createRow = (label: string) => ({
  id: createId(),
  name: label,
  valueInput: '',
  children: [],
});

const parseShareInput = (input: string) => {
  const trimmed = input.trim();
  if (!trimmed) {
    return { value: 0, hasValue: false, hasPercent: false };
  }
  const hasPercent = trimmed.includes('%');
  const cleaned = trimmed.replace(/[%\s]/g, '');
  const parsed = parseColumn(cleaned)[0];
  if (!parsed || parsed.value === null) {
    return { value: 0, hasValue: false, hasPercent };
  }
  return { value: parsed.value, hasValue: true, hasPercent };
};

const computeAbsoluteValue = (node: SplitNode): number => {
  const parsed = parseShareInput(node.valueInput);
  if (node.valueInput.trim() !== '' && parsed.hasValue) {
    return parsed.value;
  }
  if (!node.children.length) {
    return 0;
  }
  const childMode = detectMode(node.children);
  if (childMode.mode !== 'absolute') {
    return 0;
  }
  return node.children.reduce((acc, child) => acc + computeAbsoluteValue(child), 0);
};

const sumAbsoluteLevel = (nodes: SplitNode[]) => {
  return nodes.reduce((acc, node) => {
    if (node.name.trim() === '') {
      return acc;
    }
    return acc + computeAbsoluteValue(node);
  }, 0);
};

const formatAmount = (value: number, decimals: number) => {
  const fixed = value.toFixed(decimals);
  const [integerPart, fraction] = fixed.split('.');
  const grouped = addGrouping(integerPart);
  return fraction ? `${grouped}.${fraction}` : grouped;
};

const toPercentString = (value: number) => {
  const trimmed = Number.isFinite(value) ? value : 0;
  const normalized = Number(trimmed.toFixed(2));
  return `${normalized}%`;
};

const roundGroup = (rows: ComputedNode[], parentTotal: number, decimals: number) => {
  if (!rows.length) {
    return rows;
  }
  const unit = 10 ** decimals;
  const rounded = rows.map((row) => Math.round(row.amount * unit));
  const target = Math.round(parentTotal * unit);
  const diff = target - rounded.reduce((acc, val) => acc + val, 0);
  if (diff !== 0) {
    let lastIndex = rounded.length - 1;
    while (lastIndex >= 0 && rows[lastIndex].isIgnored) {
      lastIndex -= 1;
    }
    if (lastIndex >= 0) {
      rounded[lastIndex] += diff;
    }
  }
  return rows.map((row, index) => ({ ...row, amount: rounded[index] / unit }));
};

const detectMode = (rows: SplitNode[]) => {
  const active = rows.filter((row) => row.name.trim() !== '');
  const parsed = active.map((row) => parseShareInput(row.valueInput));
  const hasPercent = parsed.some((entry) => entry.hasPercent);
  const hasAbsolute = parsed.some((entry) => entry.hasValue && !entry.hasPercent);
  if (hasPercent && hasAbsolute) {
    return { mode: 'mixed' as const, error: 'Mixing percents and absolute values.' };
  }
  if (hasPercent) {
    return { mode: 'percent' as const, error: null };
  }
  return { mode: 'absolute' as const, error: null };
};

const buildComputed = (
  rows: SplitNode[],
  parentAmount: number,
  depth: number,
  decimals: number,
  randomPercent: number,
  modeCache: Map<string, CachedMode>,
  cacheKey: string,
): ComputedNode[] => {
  const { mode, error } = detectMode(rows);
  const cached = modeCache.get(cacheKey);
  const effectiveMode = mode === 'mixed' ? cached?.mode ?? 'absolute' : mode;
  const parsedAll = rows.map((row) => {
    const parsed = parseShareInput(row.valueInput);
    const isActive = row.name.trim() !== '';
    const isAutoAbsolute =
      isActive &&
      row.valueInput.trim() === '' &&
      row.children.length > 0 &&
      detectMode(row.children).mode === 'absolute';
    const derivedValue = isAutoAbsolute ? computeAbsoluteValue(row) : null;
    return {
      row,
      parsed,
      isActive,
      derivedValue,
    };
  });
  const parsedActive = parsedAll.filter((entry) => entry.isActive);

  const totals = parsedActive.reduce(
    (acc, entry) => {
      acc.sum += entry.derivedValue ?? entry.parsed.value;
      return acc;
    },
    { sum: 0 },
  );

  const maxValue = effectiveMode === 'percent' ? 100 : parentAmount;
  const overLimit = totals.sum > maxValue + 1e-9;
  let remainder = Math.max(0, maxValue - totals.sum);
  let showNotSet = !overLimit && remainder > 0.00001;
  let remainderPercent =
    effectiveMode === 'percent' ? remainder : parentAmount === 0 ? 0 : (remainder / parentAmount) * 100;
  const notSetLabel = 'Not set';
  let notSetValueInput =
    effectiveMode === 'percent' ? toPercentString(remainder) : formatAmount(remainder, decimals);
  const notSetIndex = parsedAll.reduce(
    (acc, entry, index) => (entry.isActive ? acc : index),
    -1,
  );

  if (mode === 'mixed' && cached) {
    remainder = cached.remainder;
    remainderPercent = cached.remainderPercent;
    notSetValueInput = cached.notSetValueInput;
    showNotSet = cached.remainder > 0.00001;
  }

  const computedRows = parsedAll.map(({ row, parsed: parsedRow, isActive, derivedValue }, index) => {
    const isNotSet = showNotSet && index === notSetIndex;
    const normalizedValue = isActive ? (derivedValue ?? parsedRow.value) : 0;
    const valueForCalc = isNotSet ? remainder : normalizedValue;
    const percent =
      effectiveMode === 'percent'
        ? valueForCalc
        : parentAmount === 0
          ? 0
          : (valueForCalc / parentAmount) * 100;
    const amount = effectiveMode === 'percent' ? parentAmount * (valueForCalc / 100) : valueForCalc;
    return {
      id: row.id,
      sourceId: row.id,
      name: isNotSet ? notSetLabel : row.name,
      valueInput: isNotSet ? notSetValueInput : row.valueInput,
      amount,
      percent,
      depth,
      isNotSet,
      isIgnored: !isActive && !isNotSet,
      children: [],
      error:
        isActive && overLimit
          ? `Sum exceeds ${effectiveMode === 'percent' ? '100%' : 'parent total'}.`
          : error,
    };
  });

  if (mode !== 'mixed') {
    modeCache.set(cacheKey, {
      mode: effectiveMode,
      remainder,
      remainderPercent,
      notSetValueInput,
    });
  }

  if (showNotSet && notSetIndex === -1) {
    computedRows.push({
      id: `not-set-${depth}-${createId()}`,
      sourceId: null,
      name: notSetLabel,
      valueInput: notSetValueInput,
      amount: effectiveMode === 'percent' ? parentAmount * (remainder / 100) : remainder,
      percent: remainderPercent,
      depth,
      isNotSet: true,
      isIgnored: false,
      children: [],
      error: null,
    });
  }

  if (randomPercent > 0 && !overLimit && parentAmount !== 0 && effectiveMode === 'percent' && mode !== 'mixed') {
    const fixedAmount = computedRows.reduce(
      (acc, row) => acc + (row.isNotSet ? row.amount : 0),
      0,
    );
    const adjustable = computedRows.filter((row) => !row.isIgnored && !row.isNotSet);
    if (adjustable.length > 0) {
      const factor = randomPercent / 100;
      const jittered = adjustable.map((row) => row.amount * (1 + (Math.random() * 2 - 1) * factor));
      const sum = jittered.reduce((acc, value) => acc + value, 0);
      const targetAmount = Math.max(0, parentAmount - fixedAmount);
      if (sum !== 0) {
        const scale = targetAmount / sum;
        const updated = new Map<string, number>();
        adjustable.forEach((row, index) => {
          updated.set(row.id, jittered[index] * scale);
        });
        computedRows.forEach((row, index) => {
          const nextAmount = updated.get(row.id);
          if (nextAmount !== undefined) {
            computedRows[index] = { ...row, amount: nextAmount };
          }
        });
      }
    }
  }

  return roundGroup(computedRows, parentAmount, decimals);
};

const buildTree = (
  nodes: SplitNode[],
  parentAmount: number,
  depth: number,
  decimals: number,
  randomPercent: number,
  modeCache: Map<string, CachedMode>,
  cacheKey: string,
): ComputedNode[] => {
  const computed = buildComputed(nodes, parentAmount, depth, decimals, randomPercent, modeCache, cacheKey);
  return computed.map((row) => {
    if (!row.sourceId) {
      return row;
    }
    const original = nodes.find((node) => node.id === row.sourceId);
    if (!original || original.children.length === 0) {
      return row;
    }
    const children = buildTree(
      original.children,
      row.amount,
      depth + 1,
      decimals,
      randomPercent,
      modeCache,
      original.id,
    );
    return { ...row, children };
  });
};

const flattenTree = (nodes: ComputedNode[]) => {
  const rows: ComputedNode[] = [];
  const walk = (list: ComputedNode[]) => {
    list.forEach((node) => {
      rows.push(node);
      if (node.children.length > 0) {
        walk(node.children);
      }
    });
  };
  walk(nodes);
  return rows;
};

const getMaxDepth = (nodes: SplitNode[], depth = 0): number => {
  if (!nodes.length) {
    return depth;
  }
  return nodes.reduce((acc, node) => {
    const childDepth = node.children.length ? getMaxDepth(node.children, depth + 1) : depth;
    return Math.max(acc, childDepth);
  }, depth);
};

const updateNode = (nodes: SplitNode[], id: string, updater: (node: SplitNode) => SplitNode): SplitNode[] => {
  return nodes.map((node) => {
    if (node.id === id) {
      return updater(node);
    }
    if (node.children.length) {
      return { ...node, children: updateNode(node.children, id, updater) };
    }
    return node;
  });
};

const updateListContaining = (
  nodes: SplitNode[],
  targetId: string,
  updater: (list: SplitNode[], index: number) => SplitNode[],
): SplitNode[] => {
  const index = nodes.findIndex((node) => node.id === targetId);
  if (index !== -1) {
    return updater(nodes, index);
  }
  let didChange = false;
  const next = nodes.map((node) => {
    if (!node.children.length) {
      return node;
    }
    const updatedChildren = updateListContaining(node.children, targetId, updater);
    if (updatedChildren !== node.children) {
      didChange = true;
      return { ...node, children: updatedChildren };
    }
    return node;
  });
  return didChange ? next : nodes;
};

const addSiblingRow = (nodes: SplitNode[], targetId: string, label: string) => {
  return updateListContaining(nodes, targetId, (list, index) => {
    const next = [...list];
    next.splice(index + 1, 0, createRow(label));
    return next;
  });
};

const removeNode = (nodes: SplitNode[], targetId: string) => {
  return updateListContaining(nodes, targetId, (list, index) => {
    const next = [...list];
    next.splice(index, 1);
    return next;
  });
};

const addChildren = (nodes: SplitNode[], targetId: string) => {
  return updateNode(nodes, targetId, (node) => {
    if (node.children.length === 0) {
      return { ...node, children: createDefaultChildren() };
    }
    return {
      ...node,
      children: [
        ...node.children,
        { id: createId(), name: 'Subgroup', valueInput: '', children: [] },
        { id: createId(), name: 'Subgroup', valueInput: '', children: [] },
      ],
    };
  });
};

const addLevelToLeaves = (nodes: SplitNode[]) => {
  return nodes.map((node) => {
    if (!node.children.length) {
      return { ...node, children: createDefaultChildren() };
    }
    return { ...node, children: addLevelToLeaves(node.children) };
  });
};

const removeDeepestLevel = (nodes: SplitNode[], depth: number, maxDepth: number): SplitNode[] => {
  if (depth === maxDepth - 1) {
    return nodes.map((node) => ({ ...node, children: [] }));
  }
  return nodes.map((node) => ({
    ...node,
    children: removeDeepestLevel(node.children, depth + 1, maxDepth),
  }));
};

const createInitialRows = () => [
  { id: createId(), name: 'Group 1', valueInput: '50%', children: [] },
  { id: createId(), name: 'Group 2', valueInput: '50%', children: [] },
];

export const ShareSplitter = () => {
  const [totalInput, setTotalInput] = useState('');
  const [roundingInput, setRoundingInput] = useState('2');
  const [rows, setRows] = useState<SplitNode[]>(createInitialRows());
  const [outputMode, setOutputMode] = useState<'pivot' | 'pivot-leaves' | 'pivot-values'>('pivot');
  const [randomPercentInput, setRandomPercentInput] = useState('');
  const modeCacheRef = useRef<Map<string, CachedMode>>(new Map());

  const totalParsed = parseColumn(totalInput)[0];
  const totalValue = useMemo(() => {
    if (totalInput.trim() !== '') {
      return totalParsed && totalParsed.value !== null ? totalParsed.value : 0;
    }
    const { mode } = detectMode(rows);
    if (mode !== 'absolute') {
      return 0;
    }
    return sumAbsoluteLevel(rows);
  }, [rows, totalInput, totalParsed]);
  const decimals = Number.isFinite(Number.parseInt(roundingInput, 10))
    ? Math.min(Math.max(Number.parseInt(roundingInput, 10), 0), 6)
    : 2;
  const parsedRandomPercent = Number.parseFloat(randomPercentInput.replace(',', '.'));
  const randomPercentValue = Number.isFinite(parsedRandomPercent)
    ? Math.min(Math.max(parsedRandomPercent, 0), 100)
    : 0;

  const computedTree = useMemo(
    () => buildTree(rows, totalValue, 0, decimals, randomPercentValue, modeCacheRef.current, 'root'),
    [rows, totalValue, decimals, randomPercentValue],
  );
  const computedRows = useMemo(() => flattenTree(computedTree), [computedTree]);
  const resultRows = useMemo(
    () => computedRows.filter((row) => row.name.trim() !== ''),
    [computedRows],
  );
  const maxDepth = useMemo(() => getMaxDepth(rows, 0) + 1, [rows]);
  const outputRows = useMemo(() => {
    const collected: { row: ComputedNode; path: string[] }[] = [];
    const walk = (nodes: ComputedNode[], path: string[]) => {
      nodes.forEach((node) => {
        const nextPath = [...path];
        nextPath[node.depth] = node.name;
        if (node.name.trim() !== '') {
          collected.push({ row: node, path: nextPath });
        }
        if (node.children.length) {
          walk(node.children, nextPath);
        }
      });
    };
    const initialPath = Array.from({ length: maxDepth }, () => '');
    walk(computedTree, initialPath);
    if (outputMode === 'pivot-leaves') {
      return collected.filter(({ row }) => row.children.length === 0);
    }
    return collected;
  }, [computedTree, maxDepth, outputMode]);
  const pivotValueRows = useMemo(() => {
    const collected: { ids: Array<string | null>; amounts: Array<number | null> }[] = [];
    const walk = (nodes: ComputedNode[], ids: Array<string | null>, amounts: Array<number | null>) => {
      nodes.forEach((node) => {
        const nextIds = [...ids];
        const nextAmounts = [...amounts];
        nextIds[node.depth] = node.id;
        nextAmounts[node.depth] = node.amount;
        if (node.children.length === 0) {
          collected.push({ ids: nextIds, amounts: nextAmounts });
          return;
        }
        walk(node.children, nextIds, nextAmounts);
      });
    };
    walk(computedTree, Array.from({ length: maxDepth }, () => null), Array.from({ length: maxDepth }, () => null));
    return collected;
  }, [computedTree, maxDepth]);

  const handleAddSibling = (id: string) => {
    setRows((prev) => addSiblingRow(prev, id, 'Group'));
  };

  const changeRounding = (delta: number) => {
    setRoundingInput((prev) => {
      const parsed = Number.parseInt(prev, 10);
      const current = Number.isFinite(parsed) ? parsed : 0;
      const next = Math.max(0, Math.min(6, current + delta));
      return String(next);
    });
  };

  const changeRandomPercent = (delta: number) => {
    setRandomPercentInput((prev) => {
      const parsed = Number.parseFloat(prev.replace(',', '.'));
      const current = Number.isFinite(parsed) ? parsed : 0;
      const next = Math.max(0, Math.min(100, current + delta));
      return String(Math.round(next));
    });
  };

  const handleAddChild = (id: string) => {
    setRows((prev) => addChildren(prev, id));
  };

  const handleRemoveRow = (id: string, isNotSet: boolean) => {
    if (isNotSet) {
      return;
    }
    setRows((prev) => removeNode(prev, id));
  };

  const handleAddLevel = () => {
    setRows((prev) => addLevelToLeaves(prev));
  };

  const handleRemoveLevel = () => {
    const depth = getMaxDepth(rows, 0);
    if (depth === 0) {
      return;
    }
    setRows((prev) => removeDeepestLevel(prev, 0, depth));
  };

  const handleUpdateName = (id: string, nextValue: string) => {
    setRows((prev) => updateNode(prev, id, (node) => ({ ...node, name: nextValue })));
  };

  const handleUpdateValue = (id: string, nextValue: string) => {
    setRows((prev) => updateNode(prev, id, (node) => ({ ...node, valueInput: nextValue })));
  };

  const handlePaste = (id: string, field: 'name' | 'value', text: string) => {
    const rowsData = text
      .trimEnd()
      .split(/\r?\n/)
      .map((line) => {
        if (line.includes('\t')) {
          return line.split('\t');
        }
        if (line.includes(',') && (line.includes('"') || /[A-Za-z]/.test(line))) {
          return line.split(',');
        }
        return [line];
      });

    setRows((prev) =>
      updateListContaining(prev, id, (list, startIndex) => {
        const parent = [...list];
        rowsData.forEach((rowData, offset) => {
          const idx = startIndex + offset;
          if (!parent[idx]) {
            parent.push(createRow('Group'));
          }
          const target = parent[idx];
          const nameValue = rowData[0] ?? '';
          const shareValue = rowData[1] ?? '';
          parent[idx] = {
            ...target,
            name: field === 'name' ? nameValue : target.name || nameValue,
            valueInput: field === 'value' ? nameValue : shareValue || target.valueInput,
          };
        });
        return parent;
      }),
    );
  };

  const handleCopyResult = () => {
    let previousIds: Array<string | null> | null = null;
    const lines =
      outputMode === 'pivot-values'
        ? pivotValueRows.map(({ ids, amounts }) => {
            const cells = amounts.map((amount, index) => {
              if (amount === null) {
                return '';
              }
              if (previousIds && ids[index] === previousIds[index]) {
                return '';
              }
              return formatAmount(amount, decimals);
            });
            previousIds = ids;
            return cells.join('\t');
          })
        : outputRows.map(({ row, path }) =>
            [...path, formatAmount(row.amount, decimals)].join('\t'),
          );
    navigator.clipboard.writeText(lines.join('\n')).catch(() => null);
  };

  const handleExportCsv = () => {
    const escapeCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const lines =
      outputMode === 'pivot-values'
        ? []
        : [
            [...Array.from({ length: maxDepth }, (_, index) => `Level ${index + 1}`), 'Amount'].join(
              ',',
            ),
          ];
    if (outputMode === 'pivot-values') {
      let previousIds: Array<string | null> | null = null;
      pivotValueRows.forEach(({ ids, amounts }) => {
        const rowValues = amounts.map((amount, index) => {
          if (amount === null) {
            return '';
          }
          if (previousIds && ids[index] === previousIds[index]) {
            return '';
          }
          return formatAmount(amount, decimals);
        });
        previousIds = ids;
        lines.push(rowValues.map(escapeCell).join(','));
      });
    } else {
      outputRows.forEach(({ row, path }) => {
        const rowValues = [...path, formatAmount(row.amount, decimals)];
        lines.push(rowValues.map(escapeCell).join(','));
      });
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'share-splitter.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const renderInputCell = (row: ComputedNode, rowIndex: number) => {
    const disableActions = row.isNotSet;
    return (
      <div className={`split-cell${row.isNotSet ? ' split-cell-muted' : ''}`}>
        <div className="split-name-cell">
          <input
            className="split-name-input"
            value={row.name}
            disabled={row.isNotSet}
            onChange={(event) => handleUpdateName(row.id, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                handleAddSibling(row.id);
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                const direction = event.key === 'ArrowDown' ? 1 : -1;
                const next = document.querySelector<HTMLInputElement>(
                  `[data-row="${rowIndex + direction}"][data-field="name"]`,
                );
                if (next) {
                  next.focus();
                  event.preventDefault();
                }
              }
              if (event.key === 'ArrowRight') {
                const next = document.querySelector<HTMLInputElement>(
                  `[data-row="${rowIndex}"][data-field="value"]`,
                );
                if (next) {
                  next.focus();
                  event.preventDefault();
                }
              }
            }}
            onPaste={(event) => {
              if (!row.isNotSet) {
                event.preventDefault();
                handlePaste(row.id, 'name', event.clipboardData.getData('text'));
              }
            }}
            data-row={rowIndex}
            data-field="name"
          />
          {row.error ? <span className="split-error-inline">{row.error}</span> : null}
        </div>
        <input
          className="split-value-input"
          value={row.valueInput}
          disabled={row.isNotSet}
          onChange={(event) => handleUpdateValue(row.id, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              handleAddSibling(row.id);
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              const direction = event.key === 'ArrowDown' ? 1 : -1;
              const next = document.querySelector<HTMLInputElement>(
                `[data-row="${rowIndex + direction}"][data-field="value"]`,
              );
              if (next) {
                next.focus();
                event.preventDefault();
              }
            }
            if (event.key === 'ArrowLeft') {
              const next = document.querySelector<HTMLInputElement>(
                `[data-row="${rowIndex}"][data-field="name"]`,
              );
              if (next) {
                next.focus();
                event.preventDefault();
              }
            }
          }}
          onPaste={(event) => {
            if (!row.isNotSet) {
              event.preventDefault();
              handlePaste(row.id, 'value', event.clipboardData.getData('text'));
            }
          }}
          data-row={rowIndex}
          data-field="value"
        />
        <div className="split-cell-actions">
          <button
            type="button"
            onClick={() => handleAddChild(row.id)}
            title="Add children"
            disabled={disableActions}
          >
            +
          </button>
          <button
            type="button"
            onClick={() => handleRemoveRow(row.id, row.isNotSet)}
            title="Remove row"
            disabled={disableActions}
          >
            x
          </button>
        </div>
      </div>
    );
  };

  return (
    <section className="share-splitter">
      <header className="controls-wrapper">
        <div className="controls">
          <div className="controls-heading">
            <h1 className="controls-heading-title">Share Splitter</h1>
            <p className="controls-subtitle">
              Split a total across groups and nested subgroups with automatic balancing.
            </p>
          </div>
          <div className="split-control">
            <div className="stacked-field-column">
              <div className="stacked-field">
                <div className="number-field number-field-mode">
                  <label className="number-field-label">Total sum</label>
                  <div className="number-field-input-wrapper">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={totalInput}
                      onChange={(event) => setTotalInput(event.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="stacked-field-column">
              <div className="stacked-field">
                <div className="number-field number-field-mode">
                  <label className="number-field-label">Rounding</label>
                  <div className="number-field-input-wrapper input-with-toggle digits-toggle">
                    <div className="mode-toggle mode-toggle-inline" role="group" aria-label="Rounding control">
                      <button
                        type="button"
                        className="mode-toggle-button"
                        onClick={() => changeRounding(-1)}
                        disabled={decimals <= 0}
                        title="Decrease decimal places"
                      >
                        -0.0
                      </button>
                      <button
                        type="button"
                        className="mode-toggle-button"
                        onClick={() => changeRounding(1)}
                        disabled={decimals >= 6}
                        title="Increase decimal places"
                      >
                        +0.00
                      </button>
                    </div>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={roundingInput}
                      onChange={(event) => setRoundingInput(event.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="stacked-field-column">
              <div className="stacked-field">
                <div className="number-field number-field-mode">
                  <label className="number-field-label">Randomizer (%)</label>
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
      </header>

      <div className="split-grid">
        <header className="card-header split-grid-header-row">
          <div className="card-header-top">
            <h2>Input data</h2>
            <button
              type="button"
              onClick={() => setRows(createInitialRows())}
              disabled={!rows.length}
            >
              Clear field
            </button>
          </div>
        </header>
        <div className="split-grid-header">
          <span>Name</span>
          <span>Share</span>
        </div>
        <div
          className="split-table"
          style={{ gridTemplateColumns: `repeat(${maxDepth}, minmax(0, 1fr))` }}
        >
          {computedRows.map((row, rowIndex) => {
            const widthOffset = 38 + row.depth * 50;
            return (
              <div key={row.id} className="split-row" style={{ gridColumn: '1 / -1' }}>
                {Array.from({ length: maxDepth }).map((_, level) => (
                  <div key={`${row.id}-${level}`} className="split-cell-wrapper">
                    {level === row.depth ? (
                      <div
                        className="split-cell-with-outside"
                        style={{ '--panel-offset': `${widthOffset}px` } as CSSProperties}
                      >
                        <button
                          type="button"
                          className="split-outside-action"
                          onClick={() => handleAddSibling(row.id)}
                          title="Add row"
                          disabled={row.isNotSet}
                        >
                          +
                        </button>
                        {renderInputCell(row, rowIndex)}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <section className="card results-card split-results">
        <header className="card-header">
          <div className="card-header-top">
            <h2>Result</h2>
            <div className="split-result-actions">
              <select
                className="split-output-select"
                value={outputMode}
                onChange={(event) =>
                  setOutputMode(event.target.value as 'pivot' | 'pivot-leaves' | 'pivot-values')
                }
                aria-label="Output format"
              >
                <option value="pivot">Pivot style</option>
                <option value="pivot-leaves">Table leaves only</option>
                <option value="pivot-values">Table without names</option>
              </select>
              <button type="button" onClick={handleCopyResult}>
                Copy result
              </button>
              <button type="button" onClick={handleExportCsv}>
                Export CSV
              </button>
            </div>
          </div>
        </header>
        <div className="result-summary">
          <span>Total</span>
          <strong>{formatAmount(totalValue, decimals)}</strong>
        </div>
        <div className="split-result-list">
          {resultRows.map((row) => (
            <div key={`result-${row.id}`} className="split-result-row">
              <span style={{ paddingLeft: `${row.depth * 18}px` }}>{row.name}</span>
              <strong>{formatAmount(row.amount, decimals)}</strong>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
};

