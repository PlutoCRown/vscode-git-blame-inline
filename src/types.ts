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
  /** 是否为尚未提交的本地改动 */
  isUncommitted?: boolean;
  /**
   * 该行对应 commit 时的仓库内路径（rename 后可能与当前文件名不同）
   * 来自 git blame porcelain 的 filename 字段
   */
  pathAtCommit?: string;
  /**
   * 上一版本路径（rename/copy 时用于 parent 侧内容）
   * 来自 git blame porcelain 的 previous 字段
   */
  previousPath?: string;
}

/** git blame 对未提交行使用的占位 hash */
export const UNCOMMITTED_HASH = '0000000000000000000000000000000000000000';

/**
 * 远程仓库信息
 */
export interface RemoteInfo {
  baseUrl: string;
  /**
   * 完整项目路径（可含 GitLab 多级 namespace）
   * 例如：owner/repo、team/repo、team/folder/repo
   */
  projectPath: string;
  host: string;
}
