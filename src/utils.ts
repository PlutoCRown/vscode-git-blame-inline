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
    return '刚刚';
  } else if (diff < 3600) {
    const minutes = Math.floor(diff / 60);
    return `${minutes}分钟前`;
  } else if (diff < 86400) {
    const hours = Math.floor(diff / 3600);
    return `${hours}小时前`;
  } else if (diff < 2592000) {
    const days = Math.floor(diff / 86400);
    return `${days}天前`;
  } else if (diff < 31536000) {
    const months = Math.floor(diff / 2592000);
    return `${months}个月前`;
  } else {
    const years = Math.floor(diff / 31536000);
    return `${years}年前`;
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
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  });
}
