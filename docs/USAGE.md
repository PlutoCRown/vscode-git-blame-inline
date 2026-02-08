# 使用说明

## 🚀 立即开始

### 方法一：开发调试（推荐用于开发）

1. **打开项目**
   ```bash
   cd /Users/plutocrown/Desktop/git-blame-inline
   code .
   ```

2. **按 F5 启动调试**
   - VSCode 会自动编译代码
   - 打开新的扩展开发窗口

3. **测试功能**
   - 在新窗口中打开任意 Git 仓库
   - 打开已提交的文件
   - 查看行尾的 blame 信息 ✨

### 方法二：打包安装（推荐用于日常使用）

1. **构建并打包**
   ```bash
   cd /Users/plutocrown/Desktop/git-blame-inline
   bun run build
   bun run package
   ```

2. **安装扩展**
   ```bash
   code --install-extension git-blame-inline-0.0.1.vsix
   ```

3. **重启 VSCode**
   - 扩展会自动激活
   - 打开任意 Git 仓库中的文件即可看到 blame 信息

## 📖 功能说明

### 行内 Blame 信息

打开 Git 仓库中的文件后，每行代码末尾会显示：

```
作者, 相对时间 • 提交信息
```

例如：
```
Zhang San, 2天前 • 修复登录bug
```

### 悬停查看详情

将鼠标悬停在任意代码行上，会弹出包含以下信息的提示框：

- **Commit**: 提交 hash（前 8 位）
- **作者**: 提交者姓名
- **邮箱**: 提交者邮箱
- **时间**: 完整的提交时间
- **提交信息**: 完整的 commit message

### 切换显示

1. 按 `Cmd+Shift+P`（Mac）或 `Ctrl+Shift+P`（Windows/Linux）
2. 输入 `Git Blame Inline`
3. 选择 `Git Blame Inline: Toggle Inline Blame`
4. Blame 信息会显示/隐藏

## ⚙️ 配置选项

在 VSCode 设置中搜索 `gitBlameInline`：

### gitBlameInline.enabled

- **类型**: Boolean
- **默认值**: `true`
- **说明**: 启用/禁用行内 blame 信息显示

### gitBlameInline.format

- **类型**: String
- **默认值**: `"{author}, {time} • {message}"`
- **说明**: 自定义显示格式
- **可用变量**:
  - `{author}` - 作者名称
  - `{time}` - 相对时间
  - `{message}` - 提交信息
  - `{hash}` - commit hash

**示例**:
```json
{
  "gitBlameInline.format": "👤 {author} | {time} | {message}"
}
```

### gitBlameInline.messageLength

- **类型**: Number
- **默认值**: `50`
- **说明**: 提交信息最大显示长度（超出会截断并添加 `...`）

## 🎨 自定义样式

Blame 信息的颜色会自动适配编辑器主题，使用与行号相同的颜色（`editorLineNumber.foreground`）。

如果你想修改样式，可以：

1. 编辑 `src/decorationProvider.ts`
2. 修改 `createTextEditorDecorationType` 中的配置
3. 重新构建并安装

## 💡 使用技巧

### 1. 快速查看最近修改

行内信息会显示相对时间，一眼就能看出哪些代码是最近修改的。

### 2. 了解代码历史

通过悬停查看完整的 commit 信息，了解为什么做出这个修改。

### 3. 团队协作

快速识别代码的作者，方便沟通和协作。

### 4. 代码审查

在审查代码时，快速了解每行的修改历史。

## 🔧 故障排除

### 问题：没有显示 Blame 信息

**可能原因**:
1. 文件不在 Git 仓库中
2. 文件是新创建的，尚未提交
3. 功能被禁用了

**解决方法**:
1. 确保文件在 Git 仓库中：`git status`
2. 提交文件：`git add . && git commit -m "commit message"`
3. 检查设置：确保 `gitBlameInline.enabled` 为 `true`
4. 使用命令切换：`Git Blame Inline: Toggle Inline Blame`

### 问题：显示的信息不准确

**解决方法**:
1. 保存文件（`Cmd+S` / `Ctrl+S`）
2. 等待缓存刷新（60 秒）
3. 或重新打开文件

### 问题：性能问题

**解决方法**:
1. 扩展已优化，只处理可见区域
2. 如果仍有问题，可以临时禁用：`Git Blame Inline: Toggle Inline Blame`
3. 或调整 `gitBlameInline.messageLength` 减少显示内容

### 问题：与其他扩展冲突

如果与其他 Git 扩展（如 GitLens）冲突：
1. 禁用其中一个的 blame 功能
2. 或使用不同的配置

## 📚 更多文档

- [QUICKSTART.md](QUICKSTART.md) - 5 分钟快速上手
- [DEVELOPMENT.md](DEVELOPMENT.md) - 详细开发文档
- [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md) - 项目技术总结
- [README.md](README.md) - 项目说明

## 🤝 反馈和贡献

如有问题或建议，欢迎：
- 提交 Issue
- 提交 Pull Request
- 联系作者

---

**享受编码！** 🎉
