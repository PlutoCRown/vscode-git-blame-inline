/**
 * Git Blame 信息类型定义
 */
export interface BlameInfo {
  /** commit hash */
  hash: string;
  /** 作者名称 */
  author: string;
  /** 作者邮箱 */
  authorEmail: string;
  /** 提交时间戳（秒） */
  timestamp: number;
  /** 提交信息 */
  summary: string;
  /** 行号（从 1 开始） */
  lineNumber: number;
}

/**
 * 远程仓库信息
 */
export interface RemoteInfo {
  baseUrl: string;
  owner: string;
  repo: string;
}

/**
 * 文件 Blame 缓存
 */
export interface FileBlameCache {
  filePath: string;
  blameInfo: Map<number, BlameInfo>;
  timestamp: number;
}
