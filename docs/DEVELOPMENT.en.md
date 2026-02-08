# Development Guide

This guide will help you set up the development environment and contribute to Git Blame Inline.

## Prerequisites

- **Node.js** (>= 16.x)
- **Bun** (>= 1.0.0) - Fast JavaScript runtime and package manager
- **Visual Studio Code** (>= 1.80.0)
- **Git**

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/PlutoCRown/vscode-git-blame-inline
cd git-blame-inline
```

### 2. Install Dependencies

We use Bun for package management:

```bash
bun install
```

### 3. Build the Extension

```bash
# Development build (with source maps and watch mode)
bun run dev

# Production build (minified)
bun run build
```

### 4. Run and Debug

1. Open the project in VS Code
2. Press `F5` or go to Run > Start Debugging
3. A new VS Code window (Extension Development Host) will open with the extension loaded
4. Open a Git repository and test the extension features

## Project Structure

```
git-blame-inline/
├── src/
│   ├── extension.ts          # Extension entry point
│   ├── blameController.ts    # Main controller coordinating all components
│   ├── gitService.ts         # Git operations (blame, remote info)
│   ├── decorationProvider.ts # Inline decoration rendering
│   ├── hoverProvider.ts      # Hover tooltip with commit details
│   ├── diffDocProvider.ts    # Virtual document provider for diffs
│   ├── i18n.ts               # Internationalization support
│   ├── types.ts              # TypeScript type definitions
│   └── utils.ts              # Utility functions
├── dist/                     # Compiled output
├── package.json              # Extension manifest
├── package.nls.json          # English localization
├── package.nls.zh-cn.json    # Chinese localization
├── tsconfig.json             # TypeScript configuration
└── README.md                 # Main documentation
```

## Key Components

### BlameController

The main controller that coordinates all components:
- Manages blame cache and remote repository cache
- Listens to editor events (document changes, cursor movements, etc.)
- Updates decorations and hover providers

### GitService

Handles all Git operations:
- Executes `git blame` commands
- Parses blame output into structured data
- Retrieves remote repository information
- Caches results for performance

### DecorationProvider

Renders inline blame annotations:
- Creates text decorations at the end of each line
- Adapts colors based on editor theme
- Optimized to only render visible lines

### HoverProvider

Shows detailed commit information on hover:
- Formats commit details in Markdown
- Generates links to GitHub/GitLab
- Provides action buttons for viewing diffs

### DiffDocProvider

Virtual document provider for displaying commit diffs:
- Fetches file content at specific commits
- Integrates with VS Code's diff viewer

## Development Workflow

### Making Changes

1. Create a new branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes in the `src/` directory

3. Test your changes:
   - Press `F5` to launch the Extension Development Host
   - Test all affected functionality
   - Check both light and dark themes

4. Build for production:
   ```bash
   bun run build
   ```

### Adding New Features

1. **New Commands**: Add to `contributes.commands` in `package.json`
2. **New Settings**: Add to `contributes.configuration` in `package.json`
3. **Localization**: Update both `package.nls.json` and `package.nls.zh-cn.json`
4. **Types**: Add type definitions to `types.ts` if needed

### Debugging Tips

- Use `console.log()` for debugging - output appears in Debug Console
- Check the Output panel > "Git Blame Inline" channel for extension logs
- Use VS Code's built-in debugger with breakpoints
- Test with different Git repositories and file sizes

## Internationalization (i18n)

The extension supports multiple languages:

1. **Package Metadata**: 
   - English: `package.nls.json`
   - Chinese: `package.nls.zh-cn.json`

2. **Runtime Messages**:
   - Defined in `src/i18n.ts`
   - Automatically selects language based on VS Code settings

To add a new language:
1. Create `package.nls.<locale>.json`
2. Add translations to `src/i18n.ts`

## Testing

### Manual Testing Checklist

- [ ] Open a file in a Git repository
- [ ] Verify blame annotations appear at line ends
- [ ] Hover over lines to see commit details
- [ ] Click "View Changes" link in hover
- [ ] Toggle blame display with command
- [ ] Test with staged/unstaged changes
- [ ] Try stash functionality
- [ ] Switch between light/dark themes
- [ ] Test with large files (performance)
- [ ] Test with non-Git files (should not show)

### Edge Cases to Test

- [ ] Files with uncommitted changes
- [ ] Files with merge conflicts
- [ ] Very long commit messages
- [ ] Files without Git history
- [ ] Repositories without remote URLs
- [ ] First commit (no parent)

## Building for Release

### 1. Update Version

Update the version in `package.json`:

```json
{
  "version": "0.1.0"
}
```

### 2. Package the Extension

```bash
bun run package
```

This creates a `.vsix` file in the project root.

### 3. Test the Package

Install the `.vsix` file locally:

```bash
code --install-extension git-blame-inline-0.1.0.vsix
```

### 4. Publish to Marketplace

```bash
# First time: create a personal access token on Azure DevOps
# Visit: https://dev.azure.com/<org>/_usersSettings/tokens

# Login
vsce login PlutoCRown

# Publish
vsce publish
```

## Code Style

- Use TypeScript for type safety
- Follow existing code formatting
- Add comments for complex logic
- Use meaningful variable names
- Keep functions focused and small

## Performance Considerations

- **Caching**: Cache blame results to avoid repeated Git operations
- **Debouncing**: Debounce cursor movement events to reduce updates
- **Lazy Loading**: Only process visible editor ranges
- **Disposal**: Properly dispose of resources to prevent memory leaks

## Common Issues

### Issue: Decorations not showing

**Solution**: Check if:
- File is in a Git repository
- `gitBlameInline.enabled` is true
- Git is installed and accessible
- File has been committed to Git

### Issue: Hover not working

**Solution**: 
- Check blame cache is populated
- Verify hover provider is registered
- Check for errors in Debug Console

### Issue: Performance problems with large files

**Solution**:
- Decorations only render visible lines
- Check cache hit rate in console logs
- Consider increasing debounce timeout

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes with clear messages
4. Push to your fork
5. Open a Pull Request

### Pull Request Guidelines

- Describe what your PR does
- Reference any related issues
- Include screenshots for UI changes
- Test on both Windows and macOS if possible
- Update documentation if needed

## Resources

- [VS Code Extension API](https://code.visualstudio.com/api)
- [VS Code Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)
- [Git Documentation](https://git-scm.com/doc)
- [Bun Documentation](https://bun.sh/docs)

## License

MIT License - see [LICENSE](../LICENSE) file for details.

## Questions?

Feel free to open an issue on GitHub for any questions or problems!
