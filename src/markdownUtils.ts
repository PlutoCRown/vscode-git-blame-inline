/** Escape repository-controlled text before inserting it into Markdown. */
export function escapeMarkdownText(value: string): string {
  return value
    .replace(/\r?\n/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/([`*_{}\[\]<>()#+\-.!|])/g, '\\$1');
}

/** Encode a URL for use as a Markdown link destination. */
export function escapeMarkdownLinkTarget(value: string): string {
  return encodeURI(value)
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

/** Build a VS Code command URI with an encoded JSON argument array. */
export function buildCommandUri(command: string, args: unknown[]): string {
  return `command:${command}?${encodeURIComponent(JSON.stringify(args))}`;
}
