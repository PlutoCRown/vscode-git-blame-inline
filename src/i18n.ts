import * as vscode from 'vscode';

/**
 * 国际化字符串定义
 */
interface I18nStrings {
  // Hover 提示
  hover: {
    title: string;
    commit: string;
    author: string;
    email: string;
    time: string;
    message: string;
    viewOn: string;
    viewChanges: string;
  };
  // 相对时间
  time: {
    justNow: string;
    minutesAgo: (n: number) => string;
    hoursAgo: (n: number) => string;
    daysAgo: (n: number) => string;
    monthsAgo: (n: number) => string;
    yearsAgo: (n: number) => string;
  };
  // 错误消息
  error: {
    noCommitHash: string;
    noEditor: string;
    notInWorkspace: string;
    showDiffFailed: string;
    noGitExtension: string;
    noRepository: string;
    stashFailed: string;
  };
  // 成功消息
  success: {
    enabled: string;
    disabled: string;
    stagedStashed: string;
    unstagedStashed: string;
  };
  // Stash 相关
  stash: {
    selectType: string;
    staged: string;
    unstaged: string;
    inputMessage: string;
    inputPlaceholder: string;
    defaultStagedMessage: string;
    defaultUnstagedMessage: string;
  };
}

/**
 * 英语翻译
 */
const en: I18nStrings = {
  hover: {
    title: 'Git Blame',
    commit: 'Commit',
    author: 'Author',
    email: 'Email',
    time: 'Time',
    message: 'Message',
    viewOn: 'View on',
    viewChanges: 'View Changes',
  },
  time: {
    justNow: 'just now',
    minutesAgo: (n: number) => `${n} minute${n > 1 ? 's' : ''} ago`,
    hoursAgo: (n: number) => `${n} hour${n > 1 ? 's' : ''} ago`,
    daysAgo: (n: number) => `${n} day${n > 1 ? 's' : ''} ago`,
    monthsAgo: (n: number) => `${n} month${n > 1 ? 's' : ''} ago`,
    yearsAgo: (n: number) => `${n} year${n > 1 ? 's' : ''} ago`,
  },
  error: {
    noCommitHash: 'Unable to get commit information',
    noEditor: 'Unable to show commit diff: No active editor',
    notInWorkspace: 'Unable to show commit diff: File is not in workspace',
    showDiffFailed: 'Unable to show commit diff',
    noGitExtension: 'Git extension is not installed or enabled',
    noRepository: 'No open Git repository',
    stashFailed: 'Stash failed',
  },
  success: {
    enabled: 'Git Blame Inline Enabled',
    disabled: 'Git Blame Inline Disabled',
    stagedStashed: '✅ Staged changes stashed',
    unstagedStashed: '✅ Changes stashed (keeping staged changes)',
  },
  stash: {
    selectType: 'Select the type of changes to stash',
    staged: 'Staged Changes',
    unstaged: 'Changes',
    inputMessage: 'Enter stash message',
    inputPlaceholder: 'Optional stash description',
    defaultStagedMessage: 'Stashed staged changes',
    defaultUnstagedMessage: 'Stashed unstaged changes',
  },
};

/**
 * 简体中文翻译
 */
const zhCN: I18nStrings = {
  hover: {
    title: 'Git Blame',
    commit: 'Commit',
    author: '作者',
    email: '邮箱',
    time: '时间',
    message: '提交信息',
    viewOn: '在',
    viewChanges: '查看更改',
  },
  time: {
    justNow: '刚刚',
    minutesAgo: (n: number) => `${n}分钟前`,
    hoursAgo: (n: number) => `${n}小时前`,
    daysAgo: (n: number) => `${n}天前`,
    monthsAgo: (n: number) => `${n}个月前`,
    yearsAgo: (n: number) => `${n}年前`,
  },
  error: {
    noCommitHash: '无法获取 commit 信息',
    noEditor: '无法显示提交差异: 没有打开的编辑器',
    notInWorkspace: '无法显示提交差异: 文件不在工作区中',
    showDiffFailed: '无法显示提交差异',
    noGitExtension: 'Git 扩展未安装或未启用',
    noRepository: '没有打开的 Git 仓库',
    stashFailed: 'Stash 失败',
  },
  success: {
    enabled: 'Git Blame Inline 已启用',
    disabled: 'Git Blame Inline 已禁用',
    stagedStashed: '✅ 暂存的更改已 stash',
    unstagedStashed: '✅ 更改已 stash（保留已暂存的更改）',
  },
  stash: {
    selectType: '选择要 stash 的更改类型',
    staged: '暂存的更改',
    unstaged: '更改',
    inputMessage: '输入 stash 消息',
    inputPlaceholder: '可选的 stash 描述信息',
    defaultStagedMessage: 'Stashed 暂存的更改',
    defaultUnstagedMessage: 'Stashed 未暂存的更改',
  },
};

/**
 * 语言映射表
 */
const translations: Record<string, I18nStrings> = {
  'en': en,
  'zh-cn': zhCN,
  'zh-CN': zhCN,
  'zh': zhCN,
};

/**
 * 获取当前语言的翻译
 */
export function getTranslations(): I18nStrings {
  const locale = vscode.env.language.toLowerCase();
  return translations[locale] || en;
}

/**
 * 翻译快捷方式
 */
export const t = getTranslations();
