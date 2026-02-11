# Git Blame Inline

[![Version](https://img.shields.io/visual-studio-marketplace/v/PlutoCRown.git-blame-lite?style=flat-square&label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=PlutoCRown.git-blame-lite)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/PlutoCRown.git-blame-lite?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=PlutoCRown.git-blame-lite)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/PlutoCRown.git-blame-lite?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=PlutoCRown.git-blame-lite)
[![License](https://img.shields.io/github/license/PlutoCRown/vscode-git-blame-inline?style=flat-square)](https://github.com/PlutoCRown/vscode-git-blame-inline/blob/main/LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/PlutoCRown/vscode-git-blame-inline?style=flat-square&logo=github)](https://github.com/PlutoCRown/vscode-git-blame-inline)

**English** | [中文](./README.zh.md)

---

A lightweight VSCode extension that displays Git Blame information inline at the end of each code line, with rich hover details.

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

## ❓ FAQ

### Why not use GitLens?

While GitLens is a powerful tool, this extension offers a lightweight alternative focused specifically on inline blame display:

- **Lightweight & Fast** - GitLens can consume significant memory (up to 1.2GB+ after startup), while Git Blame Lite is designed to be minimal and efficient
- **No Commercial Features** - This extension is completely free and open-source without any commercial/premium feature prompts or paywalls
- **Focused Functionality** - Provides core blame features without the complexity of a full Git suite
- **Better Performance** - Optimized specifically for inline blame display with smart caching and minimal resource usage

If you only need blame information and prefer a lightweight solution, Git Blame Lite is the perfect choice. If you need comprehensive Git features and don't mind the resource usage, GitLens might be better for you.

### Why not use other blame extensions like GitBlame or GitBlameInline?

There are other blame extensions available, but Git Blame Lite offers a better experience:

- **GitBlame** - The information display is inconvenient and not intuitive, making it harder to quickly see blame information while coding
- **GitBlameInline** - Limited to showing only a single line of information, which doesn't provide enough context compared to GitLens or Git Blame Lite
Git Blame Lite is designed to be both lightweight and feature-rich, offering a much better user experience than basic blame extensions.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

See [Development Guide](./docs/DEVELOPMENT.en.md) for development instructions.

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

Inspired by GitLens and other Git tools, designed to be lightweight and focused on inline blame display.
