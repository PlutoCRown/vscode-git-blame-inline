import { t } from './i18n';

/**
 * 工具函数
 */

/**
 * 检查文件是否在 Git 仓库中
 */
export function isGitRepository(path: string): boolean {
  // 这个函数可以扩展以检查 .git 目录
  return true;
}

/**
 * 格式化相对时间
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;

  if (diff < 60) {
    return t.time.justNow;
  } else if (diff < 3600) {
    const minutes = Math.floor(diff / 60);
    return t.time.minutesAgo(minutes);
  } else if (diff < 86400) {
    const hours = Math.floor(diff / 3600);
    return t.time.hoursAgo(hours);
  } else if (diff < 2592000) {
    const days = Math.floor(diff / 86400);
    return t.time.daysAgo(days);
  } else if (diff < 31536000) {
    const months = Math.floor(diff / 2592000);
    return t.time.monthsAgo(months);
  } else {
    const years = Math.floor(diff / 31536000);
    return t.time.yearsAgo(years);
  }
}

/**
 * 截断文本
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * 格式化日期（带时区）
 */
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  // 使用 VS Code 的语言环境
  const vscode = require('vscode');
  const locale = vscode.env.language || 'en';
  
  return date.toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  });
}
