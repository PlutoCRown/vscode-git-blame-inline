# Git Blame Inline

[![Version](https://img.shields.io/visual-studio-marketplace/v/PlutoCRown.git-blame-lite?style=flat-square&label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=PlutoCRown.git-blame-lite)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/PlutoCRown.git-blame-lite?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=PlutoCRown.git-blame-lite)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/PlutoCRown.git-blame-lite?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=PlutoCRown.git-blame-lite)
[![License](https://img.shields.io/github/license/PlutoCRown/vscode-git-blame-inline?style=flat-square)](https://github.com/PlutoCRown/vscode-git-blame-inline/blob/main/LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/PlutoCRown/vscode-git-blame-inline?style=flat-square&logo=github)](https://github.com/PlutoCRown/vscode-git-blame-inline)

**English** | [中文](./README.zh.md)

---

A lightweight VSCode extension that displays Git Blame information inline at the end of each code line, with rich hover details.

## ✨ Features

- 🎯 **Inline Git Blame** - Display author, time, and commit message at the end of each line
- 🔍 **Rich Hover Details** - View complete commit information with clickable links
- 🔗 **GitHub/GitLab Integration** - Quick access to commits and author profiles on remote repositories
- 📝 **View Commit Changes** - Open full commit diff with one click
- 💾 **Smart Stash** - Separate stash controls for staged and unstaged changes
- 🎨 **Theme Adaptive** - Automatically adapts to your editor theme (dark/light)
- ⚡ **High Performance** - Intelligent caching, only processes visible areas
- 🌐 **Multi-language** - Supports English and Simplified Chinese
- ⚙️ **Customizable Format** - Configure how blame information is displayed
- 📝 **Multi-line Commit Messages** - Full support for displaying multi-line commit messages

## 📸 Screenshots

### Inline Blame Display
Shows Git blame information at the end of each line with author, time, and commit message.

![Inline Blame Display](./docs/img/readme-usage-blame.jpeg)

### Multi-line Commit Message Support
Full support for viewing and displaying multi-line commit messages.

![Multi-line Commit Messages](./docs/img/readme-usage-multiline.jpeg)

### Smart Stash Feature
Easily stash staged or unstaged changes with custom messages from the Source Control panel.

![Stash Feature](./docs/img/readme-usage-stash.jpeg)

**Hover for Details:**
- View complete commit information
- Click to view commit on GitHub/GitLab
- View file changes in that commit
- Direct links to author profiles

## 🚀 Quick Start

1. Install the extension from VS Code Marketplace
2. Open a file in a Git repository
3. Git blame information will automatically appear at the end of each line
4. Hover over any line to see detailed commit information

## 📋 Commands

- **Git Blame Lite: Toggle Inline Blame** - Toggle the display of inline blame annotations
- **Git Blame Lite: Show Commit Diff** - View the changes made in a specific commit
- **Stash Changes...** - Stash your staged or unstaged changes with a custom message

## ⚙️ Configuration

Configure the extension in your VS Code settings:

| Setting                          | Type    | Default                          | Description                         |
| -------------------------------- | ------- | -------------------------------- | ----------------------------------- |
| `gitBlameInline.enabled`         | boolean | `true`                           | Enable/disable inline blame display |
| `gitBlameInline.format`          | string  | `"{author}, {time} • {message}"` | Customize the inline blame format   |
| `gitBlameInline.messageLength`   | number  | `50`                             | Maximum length for commit messages  |
| `gitBlameInline.showStashButton` | boolean | `true`                           | Show stash button in source control |

### Format Variables

You can use the following variables in `gitBlameInline.format`:
- `{author}` - Commit author name
- `{time}` - Relative time (e.g., "2 days ago")
- `{message}` - Commit message
- `{hash}` - Short commit hash

**Example formats:**
- `"{author}, {time} • {message}"` (default)
- `"{author} ({time}): {message}"`
- `"{hash} - {author}: {message}"`

## 🔧 Usage Tips

### Stash Feature
Right-click on "Changes" or "Staged Changes" in the Source Control panel to find the stash button. You can:
- Stash only staged changes while keeping working tree changes
- Stash only unstaged changes while keeping staged changes
- Add custom messages to identify your stashes

### Keyboard Shortcuts
You can set custom keyboard shortcuts for commands:
1. Open Keyboard Shortcuts (`Cmd+K Cmd+S` / `Ctrl+K Ctrl+S`)
2. Search for "Git Blame Lite"
3. Assign your preferred shortcuts

## ❓ FAQ

### Why not use GitLens?

While GitLens is a powerful tool, this extension offers a lightweight alternative focused specifically on inline blame display:

- **Lightweight & Fast** - GitLens can consume significant memory (up to 1.2GB+ after startup), while Git Blame Lite is designed to be minimal and efficient
- **No Commercial Features** - This extension is completely free and open-source without any commercial/premium feature prompts or paywalls
- **Focused Functionality** - Provides core blame features without the complexity of a full Git suite
- **Better Performance** - Optimized specifically for inline blame display with smart caching and minimal resource usage

If you only need blame information and prefer a lightweight solution, Git Blame Lite is the perfect choice. If you need comprehensive Git features and don't mind the resource usage, GitLens might be better for you.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

See [Development Guide](./docs/DEVELOPMENT.en.md) for development instructions.

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

Inspired by GitLens and other Git tools, designed to be lightweight and focused on inline blame display.
