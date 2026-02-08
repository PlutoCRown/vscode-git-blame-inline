# Git Blame Inline - 项目总结

## 项目概述

这是一个轻量级的 VSCode 扩展，实现了类似 GitLens 的 Git Blame 功能，在代码行尾显示 blame 信息，并在鼠标悬停时显示完整的提交详情。

## 技术栈

- **语言**: TypeScript
- **构建工具**: Bun
- **运行时**: Node.js
- **框架**: VSCode Extension API

## 项目结构

```
git-blame-inline/
├── src/                          # 源代码目录
│   ├── extension.ts              # 扩展入口点
│   ├── blameController.ts        # 主控制器
│   ├── gitService.ts             # Git 命令执行服务
│   ├── decorationProvider.ts    # 行内装饰提供器
│   ├── hoverProvider.ts          # 悬停提示提供器
│   ├── types.ts                  # TypeScript 类型定义
│   └── utils.ts                  # 工具函数
├── dist/                         # 编译输出（自动生成）
├── .vscode/                      # VSCode 配置
│   ├── launch.json               # 调试配置
│   ├── tasks.json                # 任务配置
│   └── settings.json             # 工作区设置
├── gitlens-reference/            # GitLens 参考仓库
├── package.json                  # 扩展清单和依赖
├── tsconfig.json                 # TypeScript 配置
├── README.md                     # 项目说明
├── DEVELOPMENT.md                # 详细开发文档
├── QUICKSTART.md                 # 快速开始指南
└── test-file.ts                  # 测试文件
```

## 核心功能

### 1. Git Blame 信息显示

- ✅ 在代码行尾显示灰色的 blame 信息
- ✅ 格式：`作者, 相对时间 • 提交信息`
- ✅ 自动适配编辑器主题（深色/浅色）
- ✅ 只为可见区域创建装饰（性能优化）

### 2. 悬停提示

- ✅ 鼠标悬停显示完整 commit 信息
- ✅ 包含：Commit Hash、作者、邮箱、时间、完整提交信息
- ✅ 使用 Markdown 格式化

### 3. 智能缓存

- ✅ 60 秒缓存机制，避免重复 Git 查询
- ✅ 文档变化时自动清除缓存
- ✅ 文档保存时自动刷新 blame 信息

### 4. 配置选项

- ✅ `gitBlameInline.enabled` - 启用/禁用功能
- ✅ `gitBlameInline.format` - 自定义显示格式
- ✅ `gitBlameInline.messageLength` - 提交信息长度限制

### 5. 命令

- ✅ `Git Blame Inline: Toggle Inline Blame` - 切换显示/隐藏

## 实现细节

### Git Service (gitService.ts)

**职责**: 执行 Git blame 命令并解析结果

**核心方法**:
- `getBlameForFile()` - 获取文件的 blame 信息
- `parseBlameOutput()` - 解析 `git blame --line-porcelain` 输出
- `clearCache()` - 清除缓存

**特点**:
- 使用 `child_process.execFile` 执行 Git 命令
- 解析 porcelain 格式输出（结构化、易解析）
- 实现 60 秒缓存机制
- 错误静默处理，不影响编辑器使用

### Decoration Provider (decorationProvider.ts)

**职责**: 在行尾添加装饰文本

**核心方法**:
- `updateDecorations()` - 更新编辑器装饰
- `createDecoration()` - 创建单行装饰

**特点**:
- 使用 VSCode Decoration API
- 只处理可见区域（性能优化）
- 使用 `ThemeColor` 确保主题兼容
- 相对时间显示（刚刚、X分钟前、X天前等）

### Hover Provider (hoverProvider.ts)

**职责**: 提供鼠标悬停时的详细信息

**核心方法**:
- `provideHover()` - VSCode HoverProvider 接口实现
- `createMarkdown()` - 创建 Markdown 格式内容

**特点**:
- 实现 VSCode HoverProvider 接口
- 使用 MarkdownString 格式化输出
- 显示完整的 commit 信息

### Blame Controller (blameController.ts)

**职责**: 协调各组件工作

**核心功能**:
- 监听编辑器切换事件
- 监听可见区域变化
- 监听文档变化和保存
- 监听配置变化
- 管理 Hover Provider 注册

**特点**:
- 事件驱动架构
- 自动更新机制
- 配置响应式更新

## 性能优化

1. **可见区域优化**: 只为可见行创建装饰，避免处理整个文件
2. **智能缓存**: 60 秒缓存避免重复 Git 查询
3. **异步处理**: 所有 Git 操作都是异步的，不阻塞 UI
4. **增量更新**: 只在必要时更新装饰

## 开发工作流

### 快速开始

1. 按 `F5` 启动调试
2. 在新窗口中测试功能
3. 修改代码后按 `Cmd+R` / `Ctrl+R` 重载

### 构建命令

```bash
# 开发模式（watch）
bun run dev

# 生产构建
bun run build

# 打包扩展
bun run package
```

## 测试方法

### 手动测试

1. 打开 `test-file.ts`
2. 查看行尾 blame 信息
3. 鼠标悬停查看详情
4. 使用命令切换显示

### 调试技巧

- 在源代码中设置断点
- 使用 VSCode 调试器查看变量
- 查看开发者工具控制台（`Help > Toggle Developer Tools`）

## 已完成的功能

- ✅ Git blame 命令执行和解析
- ✅ 行内装饰显示
- ✅ 悬停提示
- ✅ 智能缓存
- ✅ 配置选项
- ✅ 切换命令
- ✅ 主题兼容
- ✅ 性能优化
- ✅ 错误处理
- ✅ 完整文档

## 可扩展功能（未来）

- [ ] 自定义颜色配置
- [ ] 快捷键绑定
- [ ] 状态栏显示
- [ ] 行号旁边的 gutter 图标
- [ ] 点击跳转到 commit
- [ ] 与 GitHub/GitLab 集成
- [ ] 多语言支持

## 参考资源

- [VSCode Extension API](https://code.visualstudio.com/api)
- [GitLens 源码](./gitlens-reference/)
- [Bun 文档](https://bun.sh/docs)

## 许可证

MIT

## 作者

Your Name

---

**祝你使用愉快！** 🎉

如有问题或建议，欢迎提交 Issue 或 PR。
