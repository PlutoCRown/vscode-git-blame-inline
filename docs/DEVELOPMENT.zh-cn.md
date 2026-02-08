# 开发指南

本指南将帮助您设置开发环境并为 Git Blame Inline 做出贡献。

## 前置要求

- **Node.js** (>= 16.x)
- **Bun** (>= 1.0.0) - 快速的 JavaScript 运行时和包管理器
- **Visual Studio Code** (>= 1.80.0)
- **Git**

## 开始开发

### 1. 克隆仓库

```bash
git clone https://github.com/PlutoCRown/vscode-git-blame-inline
cd git-blame-inline
```

### 2. 安装依赖

我们使用 Bun 进行包管理：

```bash
bun install
```

### 3. 构建扩展

```bash
# 开发构建（带源映射和监视模式）
bun run dev

# 生产构建（压缩）
bun run build
```

### 4. 运行和调试

1. 在 VS Code 中打开项目
2. 按 `F5` 或转到 运行 > 启动调试
3. 将打开一个新的 VS Code 窗口（扩展开发主机），已加载扩展
4. 打开一个 Git 仓库并测试扩展功能

## 项目结构

```
git-blame-inline/
├── src/
│   ├── extension.ts          # 扩展入口点
│   ├── blameController.ts    # 主控制器，协调所有组件
│   ├── gitService.ts         # Git 操作（blame、远程信息）
│   ├── decorationProvider.ts # 行内装饰渲染
│   ├── hoverProvider.ts      # 显示提交详情的悬停提示
│   ├── diffDocProvider.ts    # 差异的虚拟文档提供器
│   ├── i18n.ts               # 国际化支持
│   ├── types.ts              # TypeScript 类型定义
│   └── utils.ts              # 工具函数
├── dist/                     # 编译输出
├── package.json              # 扩展清单
├── package.nls.json          # 英文本地化
├── package.nls.zh-cn.json    # 中文本地化
├── tsconfig.json             # TypeScript 配置
└── README.md                 # 主文档
```

## 核心组件

### BlameController

协调所有组件的主控制器：
- 管理 blame 缓存和远程仓库缓存
- 监听编辑器事件（文档更改、光标移动等）
- 更新装饰和悬停提供器

### GitService

处理所有 Git 操作：
- 执行 `git blame` 命令
- 将 blame 输出解析为结构化数据
- 获取远程仓库信息
- 缓存结果以提高性能

### DecorationProvider

渲染行内 blame 标注：
- 在每行末尾创建文本装饰
- 根据编辑器主题适配颜色
- 优化为仅渲染可见行

### HoverProvider

悬停时显示详细的提交信息：
- 以 Markdown 格式化提交详情
- 生成指向 GitHub/GitLab 的链接
- 提供查看差异的操作按钮

### DiffDocProvider

用于显示提交差异的虚拟文档提供器：
- 获取特定提交时的文件内容
- 与 VS Code 的差异查看器集成

## 开发工作流

### 进行更改

1. 创建新分支：
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. 在 `src/` 目录中进行更改

3. 测试您的更改：
   - 按 `F5` 启动扩展开发主机
   - 测试所有受影响的功能
   - 检查浅色和深色主题

4. 生产构建：
   ```bash
   bun run build
   ```

### 添加新功能

1. **新命令**：在 `package.json` 的 `contributes.commands` 中添加
2. **新设置**：在 `package.json` 的 `contributes.configuration` 中添加
3. **本地化**：同时更新 `package.nls.json` 和 `package.nls.zh-cn.json`
4. **类型**：如需要，在 `types.ts` 中添加类型定义

### 调试技巧

- 使用 `console.log()` 进行调试 - 输出显示在调试控制台中
- 检查输出面板 > "Git Blame Inline" 频道查看扩展日志
- 使用 VS Code 的内置调试器和断点
- 使用不同的 Git 仓库和文件大小进行测试

## 国际化（i18n）

扩展支持多种语言：

1. **包元数据**：
   - 英文：`package.nls.json`
   - 中文：`package.nls.zh-cn.json`

2. **运行时消息**：
   - 在 `src/i18n.ts` 中定义
   - 根据 VS Code 设置自动选择语言

添加新语言：
1. 创建 `package.nls.<locale>.json`
2. 在 `src/i18n.ts` 中添加翻译

## 测试

### 手动测试清单

- [ ] 在 Git 仓库中打开文件
- [ ] 验证 blame 标注显示在行末
- [ ] 悬停在行上查看提交详情
- [ ] 点击悬停中的"查看更改"链接
- [ ] 使用命令切换 blame 显示
- [ ] 测试已暂存/未暂存的更改
- [ ] 尝试 stash 功能
- [ ] 在浅色/深色主题间切换
- [ ] 测试大文件（性能）
- [ ] 测试非 Git 文件（应不显示）

### 需要测试的边缘情况

- [ ] 有未提交更改的文件
- [ ] 有合并冲突的文件
- [ ] 很长的提交消息
- [ ] 没有 Git 历史的文件
- [ ] 没有远程 URL 的仓库
- [ ] 第一次提交（无父提交）

## 构建发布版本

### 1. 更新版本

在 `package.json` 中更新版本：

```json
{
  "version": "0.1.0"
}
```

### 2. 打包扩展

```bash
bun run package
```

这将在项目根目录创建一个 `.vsix` 文件。

### 3. 测试包

本地安装 `.vsix` 文件：

```bash
code --install-extension git-blame-inline-0.1.0.vsix
```

### 4. 发布到市场

```bash
# 首次：在 Azure DevOps 上创建个人访问令牌
# 访问：https://dev.azure.com/<org>/_usersSettings/tokens

# 登录
vsce login PlutoCRown

# 发布
vsce publish
```

## 代码风格

- 使用 TypeScript 确保类型安全
- 遵循现有的代码格式
- 为复杂逻辑添加注释
- 使用有意义的变量名
- 保持函数专注和简洁

## 性能考虑

- **缓存**：缓存 blame 结果以避免重复的 Git 操作
- **防抖**：对光标移动事件进行防抖以减少更新
- **懒加载**：仅处理可见的编辑器范围
- **资源释放**：正确释放资源以防止内存泄漏

## 常见问题

### 问题：装饰不显示

**解决方案**：检查是否：
- 文件在 Git 仓库中
- `gitBlameInline.enabled` 为 true
- Git 已安装且可访问
- 文件已提交到 Git

### 问题：悬停不起作用

**解决方案**：
- 检查 blame 缓存是否已填充
- 验证悬停提供器是否已注册
- 检查调试控制台中的错误

### 问题：大文件性能问题

**解决方案**：
- 装饰仅渲染可见行
- 检查控制台日志中的缓存命中率
- 考虑增加防抖超时

## 贡献

1. Fork 仓库
2. 创建您的功能分支
3. 用清晰的消息提交您的更改
4. 推送到您的 fork
5. 打开 Pull Request

### Pull Request 指南

- 描述您的 PR 做了什么
- 引用任何相关问题
- 为 UI 更改包含截图
- 如可能，在 Windows 和 macOS 上测试
- 如需要，更新文档

## 资源

- [VS Code 扩展 API](https://code.visualstudio.com/api)
- [VS Code 扩展指南](https://code.visualstudio.com/api/references/extension-guidelines)
- [Git 文档](https://git-scm.com/doc)
- [Bun 文档](https://bun.sh/docs)

## 许可证

MIT License - 详见 [LICENSE](../LICENSE) 文件。

## 有问题？

随时在 GitHub 上提出问题或疑问！
