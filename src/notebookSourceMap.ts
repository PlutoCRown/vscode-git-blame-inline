type ParsedCell = {
  id?: string;
  source?: string | string[];
  metadata?: { id?: string };
};

type StringToken = {
  end: number;
  start: number;
  value: string;
};

/**
 * Parse an ipynb as JSON and map each cell's editor lines to physical file lines.
 *
 * Cell boundaries are followed structurally instead of searching near an id. This
 * matters for cells with large outputs. Cells without an id are intentionally
 * omitted because blame identity relies on the notebook's stable cell id.
 */
export function buildNotebookCellSourceLineMaps(
  rawContent: string
): Map<string, number[]> {
  const result = new Map<string, number[]>();

  let notebook: { cells?: ParsedCell[] };
  try {
    notebook = JSON.parse(rawContent);
  } catch {
    return result;
  }

  if (!Array.isArray(notebook.cells)) {
    return result;
  }

  const scanner = new NotebookJsonScanner(rawContent);
  const sourceTokenLines = scanner.scanCellSourceTokenLines();

  for (let index = 0; index < notebook.cells.length; index++) {
    const cell = notebook.cells[index];
    const tokenLines = sourceTokenLines[index] ?? [];
    const fileLines = expandSourceTokenLines(cell.source, tokenLines);

    const cellId = resolveStoredCellId(cell);
    if (cellId) {
      result.set(cellId, fileLines);
    }
  }

  return result;
}

/** nbformat top-level id, or the legacy VS Code metadata.id location. */
function resolveStoredCellId(cell: ParsedCell): string | undefined {
  const metadataId = cell.metadata?.id;
  if (typeof metadataId === 'string' && metadataId.length > 0) {
    return metadataId;
  }
  return typeof cell.id === 'string' && cell.id.length > 0 ? cell.id : undefined;
}

/**
 * A source array normally stores one logical line per JSON string. If a producer
 * stores multiple logical lines in one string, repeat that string's physical file
 * line so every visible editor line can still receive blame.
 */
function expandSourceTokenLines(
  source: string | string[] | undefined,
  tokenLines: number[]
): number[] {
  if (typeof source === 'string') {
    if (source.length === 0 || tokenLines.length === 0) {
      return [];
    }
    return Array(logicalLineCount(source)).fill(tokenLines[0]);
  }

  if (!Array.isArray(source)) {
    return [];
  }

  const result: number[] = [];
  for (let index = 0; index < source.length; index++) {
    const fileLine = tokenLines[index];
    if (fileLine === undefined) {
      break;
    }
    for (let line = 0; line < logicalLineCount(source[index]); line++) {
      result.push(fileLine);
    }
  }
  return result;
}

function logicalLineCount(value: string): number {
  if (value.length === 0) {
    return 1;
  }
  const parts = value.split(/\r\n|\n|\r/);
  return Math.max(1, parts.length - (parts[parts.length - 1] === '' ? 1 : 0));
}

/** Minimal position-aware JSON scanner specialized for the root cells array. */
class NotebookJsonScanner {
  private position = 0;
  private readonly lineStarts = [0];

  constructor(private readonly raw: string) {
    for (let index = 0; index < raw.length; index++) {
      if (raw.charCodeAt(index) === 10) {
        this.lineStarts.push(index + 1);
      }
    }
  }

  scanCellSourceTokenLines(): number[][] {
    this.position = 0;
    this.skipWhitespace();
    if (!this.consume('{')) {
      return [];
    }

    while (this.position < this.raw.length) {
      this.skipWhitespace();
      if (this.consume('}')) {
        return [];
      }

      const property = this.readString();
      if (!property) {
        return [];
      }
      this.skipWhitespace();
      if (!this.consume(':')) {
        return [];
      }
      this.skipWhitespace();

      if (property.value === 'cells') {
        return this.scanCellsArray();
      }

      if (!this.skipValue()) {
        return [];
      }
      this.skipWhitespace();
      if (!this.consume(',')) {
        this.consume('}');
        return [];
      }
    }

    return [];
  }

  private scanCellsArray(): number[][] {
    const result: number[][] = [];
    if (!this.consume('[')) {
      return result;
    }

    while (this.position < this.raw.length) {
      this.skipWhitespace();
      if (this.consume(']')) {
        break;
      }

      if (this.peek() === '{') {
        result.push(this.scanCellObject());
      } else {
        result.push([]);
        if (!this.skipValue()) {
          return result;
        }
      }

      this.skipWhitespace();
      if (!this.consume(',')) {
        this.consume(']');
        break;
      }
    }

    return result;
  }

  private scanCellObject(): number[] {
    let sourceLines: number[] = [];
    if (!this.consume('{')) {
      return sourceLines;
    }

    while (this.position < this.raw.length) {
      this.skipWhitespace();
      if (this.consume('}')) {
        break;
      }

      const property = this.readString();
      if (!property) {
        return sourceLines;
      }
      this.skipWhitespace();
      if (!this.consume(':')) {
        return sourceLines;
      }
      this.skipWhitespace();

      if (property.value === 'source') {
        sourceLines = this.scanSourceValue();
      } else if (!this.skipValue()) {
        return sourceLines;
      }

      this.skipWhitespace();
      if (!this.consume(',')) {
        this.consume('}');
        break;
      }
    }

    return sourceLines;
  }

  private scanSourceValue(): number[] {
    if (this.peek() === '"') {
      const token = this.readString();
      return token ? [this.lineAt(token.start)] : [];
    }

    if (!this.consume('[')) {
      this.skipValue();
      return [];
    }

    const lines: number[] = [];
    while (this.position < this.raw.length) {
      this.skipWhitespace();
      if (this.consume(']')) {
        break;
      }

      const token = this.readString();
      if (!token) {
        if (!this.skipValue()) {
          return lines;
        }
      } else {
        lines.push(this.lineAt(token.start));
      }

      this.skipWhitespace();
      if (!this.consume(',')) {
        this.consume(']');
        break;
      }
    }
    return lines;
  }

  private skipValue(): boolean {
    this.skipWhitespace();
    const character = this.peek();
    if (character === '"') {
      return this.readString() !== undefined;
    }
    if (character === '{') {
      return this.skipContainer('{', '}');
    }
    if (character === '[') {
      return this.skipContainer('[', ']');
    }
    if (character === undefined) {
      return false;
    }

    const start = this.position;
    while (this.position < this.raw.length) {
      const current = this.peek();
      if (current === ',' || current === '}' || current === ']' || /\s/.test(current ?? '')) {
        break;
      }
      this.position++;
    }
    return this.position > start;
  }

  private skipContainer(open: '{' | '[', close: '}' | ']'): boolean {
    if (!this.consume(open)) {
      return false;
    }

    let depth = 1;
    while (this.position < this.raw.length && depth > 0) {
      const current = this.peek();
      if (current === '"') {
        if (!this.readString()) {
          return false;
        }
      } else {
        this.position++;
        if (current === open) {
          depth++;
        } else if (current === close) {
          depth--;
        } else if (current === '{' || current === '[') {
          const nestedClose = current === '{' ? '}' : ']';
          this.position--;
          if (!this.skipContainer(current, nestedClose)) {
            return false;
          }
        }
      }
    }
    return depth === 0;
  }

  private readString(): StringToken | undefined {
    this.skipWhitespace();
    const start = this.position;
    if (!this.consume('"')) {
      return undefined;
    }

    let escaped = false;
    while (this.position < this.raw.length) {
      const character = this.raw[this.position++];
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        const end = this.position;
        try {
          const value = JSON.parse(this.raw.slice(start, end));
          return typeof value === 'string' ? { end, start, value } : undefined;
        } catch {
          return undefined;
        }
      }
    }
    return undefined;
  }

  private lineAt(offset: number): number {
    let low = 0;
    let high = this.lineStarts.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.lineStarts[middle] <= offset) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low;
  }

  private skipWhitespace(): void {
    while (this.position < this.raw.length && /\s/.test(this.raw[this.position])) {
      this.position++;
    }
  }

  private consume(expected: string): boolean {
    if (this.raw[this.position] !== expected) {
      return false;
    }
    this.position++;
    return true;
  }

  private peek(): string | undefined {
    return this.raw[this.position];
  }
}
