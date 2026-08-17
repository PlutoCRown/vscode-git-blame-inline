import * as vscode from 'vscode';

export const NOTEBOOK_CELL_SCHEME = 'vscode-notebook-cell';

export type NotebookCellRef = {
  notebook: vscode.NotebookDocument;
  cell: vscode.NotebookCell;
  /** nbformat cell id（来自 metadata.id） */
  cellId: string;
};

/**
 * 从 cell 文档找到所属 notebook / cell，并读取稳定 id。
 * 支持工作区 file: notebook，以及 SCM / Diff 中的 git: notebook。
 */
export function findNotebookCellRef(
  document: vscode.TextDocument
): NotebookCellRef | undefined {
  if (document.uri.scheme !== NOTEBOOK_CELL_SCHEME) {
    return undefined;
  }

  for (const notebook of vscode.workspace.notebookDocuments) {
    for (const cell of notebook.getCells()) {
      if (cell.document.uri.toString() !== document.uri.toString()) {
        continue;
      }

      const cellId = getNotebookCellId(cell);
      if (!cellId) {
        return undefined;
      }

      return {
        notebook,
        cell,
        cellId
      };
    }
  }

  return undefined;
}

export function getNotebookCellId(cell: vscode.NotebookCell): string | undefined {
  const id = cell.metadata?.id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/**
 * 解析 ipynb 原始文本，建立 cellId → 各 source 行对应的文件行号（1-based）
 */
export function buildNotebookCellSourceLineMaps(
  rawContent: string
): Map<string, number[]> {
  const result = new Map<string, number[]>();

  let notebook: {
    cells?: Array<{
      id?: string;
      source?: string | string[];
      metadata?: { id?: string };
    }>;
  };
  try {
    notebook = JSON.parse(rawContent);
  } catch {
    return result;
  }

  if (!Array.isArray(notebook.cells)) {
    return result;
  }

  const rawLines = rawContent.split(/\r?\n/);

  for (const cell of notebook.cells) {
    const cellId = resolveStoredCellId(cell);
    if (!cellId) {
      continue;
    }

    const sourceElements = toSourceElements(cell.source);
    if (sourceElements.length === 0) {
      result.set(cellId, []);
      continue;
    }

    const idLineIdx = findCellIdLineIndex(rawLines, cellId);
    if (idLineIdx < 0) {
      continue;
    }

    const fileLines = mapSourceElementsToFileLines(rawLines, idLineIdx, sourceElements);
    if (fileLines.length > 0) {
      result.set(cellId, fileLines);
    }
  }

  return result;
}

/** nbformat 顶层 id，或 VS Code 持久化的 metadata.id */
function resolveStoredCellId(cell: {
  id?: string;
  metadata?: { id?: string };
}): string | undefined {
  const metaId = cell.metadata?.id;
  if (typeof metaId === 'string' && metaId.length > 0) {
    return metaId;
  }
  if (typeof cell.id === 'string' && cell.id.length > 0) {
    return cell.id;
  }
  return undefined;
}

/**
 * 将整文件 blame（按文件行）映射为 cell 编辑器行 blame（1-based）
 */
export function mapFileBlameToCellBlame<T extends { lineNumber: number }>(
  fileBlame: Map<number, T>,
  sourceFileLines: number[]
): Map<number, T> {
  const cellBlame = new Map<number, T>();

  for (let i = 0; i < sourceFileLines.length; i++) {
    const fileLine = sourceFileLines[i];
    const info = fileBlame.get(fileLine);
    if (!info) {
      continue;
    }
    cellBlame.set(i + 1, { ...info, lineNumber: i + 1 });
  }

  return cellBlame;
}

function toSourceElements(source: string | string[] | undefined): string[] {
  if (!source) {
    return [];
  }
  if (Array.isArray(source)) {
    return source;
  }

  // 单字符串：按行切开并保留换行，尽量贴近 Jupyter 数组写法
  if (source.length === 0) {
    return [];
  }
  const parts = source.split(/(?<=\n)/);
  return parts.filter((part, index) => !(index === parts.length - 1 && part === ''));
}

function findCellIdLineIndex(rawLines: string[], cellId: string): number {
  const compact = `"id":${JSON.stringify(cellId)}`;
  const spaced = `"id": ${JSON.stringify(cellId)}`;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (line.includes(spaced) || line.includes(compact)) {
      return i;
    }
  }
  return -1;
}

function mapSourceElementsToFileLines(
  rawLines: string[],
  idLineIdx: number,
  sourceElements: string[]
): number[] {
  // id 附近扫描 source 数组（id 可能在 source 前或后）
  const windowStart = Math.max(0, idLineIdx - 40);
  const windowEnd = Math.min(rawLines.length, idLineIdx + 120);

  let sourceHeaderIdx = -1;
  for (let i = windowStart; i < windowEnd; i++) {
    if (/"source"\s*:/.test(rawLines[i])) {
      // 优先选择离 id 更近、且看起来属于同一 cell 的 source
      if (sourceHeaderIdx < 0 || Math.abs(i - idLineIdx) < Math.abs(sourceHeaderIdx - idLineIdx)) {
        sourceHeaderIdx = i;
      }
    }
  }

  if (sourceHeaderIdx < 0) {
    return [];
  }

  const fileLines: number[] = [];
  let elementIndex = 0;
  let inArray = false;

  for (let i = sourceHeaderIdx; i < rawLines.length && elementIndex < sourceElements.length; i++) {
    const trimmed = rawLines[i].trim();

    if (!inArray) {
      if (/"source"\s*:\s*\[/.test(rawLines[i]) || trimmed === '[') {
        inArray = true;
      } else if (/"source"\s*:\s*"/.test(rawLines[i])) {
        // 单行字符串 source
        fileLines.push(i + 1);
        break;
      }
      if (/"source"\s*:\s*\[/.test(rawLines[i]) && trimmed.includes(']')) {
        // "source": []
        break;
      }
      continue;
    }

    if (trimmed.startsWith(']')) {
      break;
    }

    const parsed = tryParseJsonStringLine(trimmed);
    if (parsed === undefined) {
      continue;
    }

    const expected = sourceElements[elementIndex];
    if (parsed === expected || stripTrailingNewline(parsed) === stripTrailingNewline(expected)) {
      fileLines.push(i + 1);
      elementIndex++;
    }
  }

  return fileLines;
}

function tryParseJsonStringLine(trimmed: string): string | undefined {
  let candidate = trimmed;
  if (candidate.endsWith(',')) {
    candidate = candidate.slice(0, -1);
  }
  try {
    const value = JSON.parse(candidate);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

function stripTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value.slice(0, -1) : value;
}
