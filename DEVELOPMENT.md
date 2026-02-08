# 开发文档

## 快速开始

### 环境要求

- Node.js >= 18
- Bun >= 1.0（推荐）或 npm
- VSCode >= 1.80.0

### 安装依赖

```bash
# 使用 Bun（推荐）
bun install

# 或使用 npm
npm install
```

## 开发调试流程

### 方式一：VSCode 内置调试（推荐）

1. **启动开发模式**
   
   在 VSCode 中打开项目，按 `F5` 或点击"运行和调试"面板中的"Run Extension"

   这会自动：
   - 启动 Bun watch 模式（自动编译）
   - 打开新的 VSCode 扩展开发窗口

2. **测试插件**
   
   在新打开的 VSCode 窗口中：
   - 打开任意 Git 仓库
   - 打开已提交的代码文件
   - 查看行尾的灰色 blame 信息
   - 鼠标悬停查看完整提交详情

3. **热重载**
   
   修改代码后：
   - 代码会自动编译（watch 模式）
   - 在扩展开发窗口按 `Cmd+R`（Mac）或 `Ctrl+R`（Windows/Linux）重新加载扩展
   - 无需关闭窗口即可看到更改

4. **调试**
   
   - 在源代码中设置断点
   - 触发相应功能，断点会自动命中
   - 使用调试控制台查看变量值

### 方式二：手动构建

```bash
# 开发模式（watch）
bun run dev

# 在另一个终端启动 VSCode 调试
# 然后按 F5
```

### 方式三：测试打包后的扩展

```bash
# 构建生产版本
bun run build

# 打包为 .vsix 文件
bun run package

# 安装到 VSCode
code --install-extension git-blame-inline-0.0.1.vsix
```

## 项目结构

```
git-blame-inline/
├── src/
│   ├── extension.ts          # 扩展入口，注册命令和控制器
│   ├── blameController.ts    # 主控制器，协调所有组件
│   ├── gitService.ts         # Git blame 命令执行和解析
│   ├── decorationProvider.ts # 行内装饰显示
│   ├── hoverProvider.ts      # 悬停提示
│   └── types.ts              # TypeScript 类型定义
├── dist/                     # 编译输出目录
├── .vscode/                  # VSCode 配置
│   ├── launch.json           # 调试配置
│   └── tasks.json            # 任务配置
├── package.json              # 扩展清单
└── tsconfig.json             # TypeScript 配置
```

## 核心功能说明

### Git Service (gitService.ts)

- 执行 `git blame --line-porcelain` 命令
- 解析输出获取每行的 commit 信息
- 实现 60 秒缓存机制
- 处理错误和边缘情况

### Decoration Provider (decorationProvider.ts)

- 使用 VSCode Decoration API 在行尾添加文本
- 只为可见区域创建装饰（性能优化）
- 格式：`作者, 相对时间 • 提交信息`
- 使用主题颜色确保兼容性

### Hover Provider (hoverProvider.ts)

- 实现 VSCode HoverProvider 接口
- 鼠标悬停时显示完整 commit 信息
- 使用 Markdown 格式化输出

### Blame Controller (blameController.ts)

- 监听编辑器切换事件
- 监听文档保存事件（刷新 blame）
- 监听配置变化
- 协调各组件工作

## 常见问题

### Q: 修改代码后没有生效？

A: 确保：
1. Watch 模式正在运行（`bun run dev`）
2. 在扩展开发窗口按 `Cmd+R` / `Ctrl+R` 重新加载
3. 检查调试控制台是否有错误信息

### Q: 为什么有些文件不显示 blame？

A: 可能原因：
1. 文件不在 Git 仓库中
2. 文件是新创建的，尚未提交
3. Git blame 命令执行失败（检查控制台）

### Q: 如何调试 Git 命令执行？

A: 在 `gitService.ts` 的 `getBlameForFile` 方法中设置断点，查看：
- Git 命令参数
- 命令输出
- 解析结果

### Q: 如何修改 blame 信息的显示格式？

A: 编辑 `decorationProvider.ts` 的 `createDecoration` 方法，修改 `text` 变量的格式。

### Q: 如何修改装饰的颜色和样式？

A: 编辑 `decorationProvider.ts` 构造函数中的 `createTextEditorDecorationType` 参数。

## 性能优化建议

1. **只处理可见区域**：已实现，仅为可见行创建装饰
2. **智能缓存**：已实现，60 秒缓存避免重复 Git 查询
3. **文档变化时清除缓存**：已实现，确保数据最新
4. **异步处理**：所有 Git 操作都是异步的，不阻塞 UI

## 发布流程

1. 更新版本号（`package.json`）
2. 构建生产版本：`bun run build`
3. 打包扩展：`bun run package`
4. 测试 `.vsix` 文件
5. 发布到 VSCode Marketplace（需要 Publisher 账号）

```bash
# 发布命令
vsce publish
```

## 技术栈

- **TypeScript**: 类型安全的开发体验
- **Bun**: 快速的打包和运行时
- **VSCode Extension API**: 编辑器集成
- **Git CLI**: 获取 blame 信息

## 参考资源

- [VSCode Extension API](https://code.visualstudio.com/api)
- [Decoration API](https://code.visualstudio.com/api/references/vscode-api#window.createTextEditorDecorationType)
- [Hover Provider](https://code.visualstudio.com/api/references/vscode-api#HoverProvider)
- [Bun Documentation](https://bun.sh/docs)
- GitLens 参考仓库: `gitlens-reference/`
