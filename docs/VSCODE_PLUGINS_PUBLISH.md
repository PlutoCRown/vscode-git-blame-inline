1. **创建 Azure DevOps 账号**
   - 访问：https://dev.azure.com
   - 创建组织

2. **创建个人访问令牌（PAT）**
   - 访问：https://dev.azure.com/[你的组织]/_usersSettings/tokens
   - 权限：选择 **Marketplace (Manage)**

3. **安装 vsce**（如果还没有）
   ```bash
   bun add -D @vscode/vsce
   ```

4. **登录并发布**
   ```bash
   # 登录
   vsce login PlutoCRown

   # 测试打包
   bun run package

   # 本地测试安装
   code --install-extension git-blame-inline-0.1.0.vsix

   # 发布！
   vsce publish