# 项目结构说明

```
git-blame-inline/
│
├── src/                              # 源代码目录
│   ├── extension.ts                  # 扩展入口点（激活/停用）
│   ├── blameController.ts            # 主控制器（协调所有组件）
│   ├── gitService.ts                 # Git 服务（执行 blame 命令）
│   ├── decorationProvider.ts        # 装饰提供器（行内显示）
│   ├── hoverProvider.ts             # 悬停提示（详细信息）
│   ├── types.ts                      # TypeScript 类型定义
│   └── utils.ts                      # 工具函数
│
├── dist/                             # 编译输出目录（自动生成）
│   └── extension.js                  # 打包后的扩展文件
│
├── .vscode/                          # VSCode 配置
│   ├── launch.json                   # 调试配置（F5 启动）
│   ├── tasks.json                    # 任务配置（构建任务）
│   └── settings.json                 # 工作区设置
│
├── gitlens-reference/                # GitLens 参考仓库（克隆）
│   └── ...                           # GitLens 源码（供参考）
│
├── node_modules/                     # 依赖包（自动生成）
│   └── ...
│
├── package.json                      # 扩展清单和依赖配置
├── tsconfig.json                     # TypeScript 编译配置
├── bun.lock                          # Bun 依赖锁定文件
│
├── .gitignore                        # Git 忽略规则
├── .gitattributes                    # Git 属性配置
├── .vscodeignore                     # VSCode 打包忽略规则
│
├── README.md                         # 项目说明
├── QUICKSTART.md                     # 快速开始指南（5分钟上手）
├── DEVELOPMENT.md                    # 开发文档（详细）
├── USAGE.md                          # 使用说明（完整）
├── PROJECT_SUMMARY.md                # 项目技术总结
├── PROJECT_STRUCTURE.md              # 本文件
├── 项目完成报告.md                    # 项目完成报告
│
└── test-file.ts                      # 测试文件（用于验证功能）
```

## 文件说明

### 核心源代码（src/）

#### extension.ts
- **职责**: 扩展的入口点
- **功能**: 
  - 激活扩展
  - 创建 BlameController
  - 注册切换命令
  - 停用扩展时清理资源

#### blameController.ts
- **职责**: 主控制器，协调所有组件
- **功能**:
  - 监听编辑器事件（切换、可见区域变化）
  - 监听文档事件（变化、保存）
  - 监听配置变化
  - 协调 GitService、DecorationProvider、HoverProvider
  - 管理缓存

#### gitService.ts
- **职责**: Git 命令执行和解析
- **功能**:
  - 执行 `git blame --line-porcelain` 命令
  - 解析 blame 输出
  - 缓存 blame 结果（60秒）
  - 错误处理

#### decorationProvider.ts
- **职责**: 行内装饰显示
- **功能**:
  - 创建装饰类型（灰色、斜体）
  - 为可见行创建装饰
  - 格式化显示文本
  - 相对时间计算

#### hoverProvider.ts
- **职责**: 悬停提示
- **功能**:
  - 实现 VSCode HoverProvider 接口
  - 创建 Markdown 格式的提示内容
  - 显示完整 commit 信息

#### types.ts
- **职责**: TypeScript 类型定义
- **内容**:
  - BlameInfo 接口
  - FileBlameCache 接口

#### utils.ts
- **职责**: 工具函数
- **内容**:
  - formatRelativeTime() - 格式化相对时间
  - truncateText() - 截断文本
  - formatDate() - 格式化日期

### 配置文件

#### package.json
- 扩展元数据（名称、版本、描述）
- 激活事件（onStartupFinished）
- 命令贡献（toggle）
- 配置贡献（enabled、format、messageLength）
- 依赖声明
- 构建脚本

#### tsconfig.json
- TypeScript 编译选项
- 目标版本：ES2022
- 模块系统：CommonJS
- 严格模式：启用

#### .vscode/launch.json
- 调试配置
- 扩展开发主机设置
- 输出文件路径
- 预启动任务

#### .vscode/tasks.json
- 构建任务定义
- Watch 模式配置
- 问题匹配器

### 文档

#### README.md
- 项目基本介绍
- 功能特性
- 使用方法
- 配置选项

#### QUICKSTART.md
- 5分钟快速上手指南
- 测试步骤
- 常见问题
- 快速命令参考

#### DEVELOPMENT.md
- 详细开发文档
- 环境设置
- 开发调试流程
- 项目结构说明
- 核心功能说明
- 性能优化建议
- 发布流程

#### USAGE.md
- 完整使用说明
- 功能详解
- 配置选项说明
- 使用技巧
- 故障排除

#### PROJECT_SUMMARY.md
- 项目技术总结
- 架构说明
- 实现细节
- 性能优化
- 已完成功能
- 可扩展功能

#### 项目完成报告.md
- 完成清单
- 文件清单
- 实现的功能
- 技术亮点
- 学习价值

## 依赖关系

```
extension.ts
    └── blameController.ts
            ├── gitService.ts
            │       └── types.ts
            ├── decorationProvider.ts
            │       ├── types.ts
            │       └── utils.ts
            └── hoverProvider.ts
                    ├── types.ts
                    └── utils.ts
```

## 数据流

```
1. 用户打开文件
    ↓
2. BlameController 监听到事件
    ↓
3. 调用 GitService.getBlameForFile()
    ↓
4. GitService 执行 git blame 命令
    ↓
5. 解析输出，返回 BlameInfo Map
    ↓
6. BlameController 缓存结果
    ↓
7. 调用 DecorationProvider.updateDecorations()
    ↓
8. 为可见行创建装饰
    ↓
9. 显示在编辑器中

用户悬停:
    ↓
HoverProvider.provideHover()
    ↓
从缓存获取 BlameInfo
    ↓
创建 Markdown 内容
    ↓
显示悬停提示
```

## 构建流程

```
1. 源代码（src/*.ts）
    ↓
2. Bun 构建
    ↓
3. TypeScript 编译
    ↓
4. 打包为单文件
    ↓
5. 输出到 dist/extension.js
    ↓
6. VSCode 加载扩展
```

## 开发流程

```
1. 修改源代码
    ↓
2. Bun watch 自动编译
    ↓
3. 在扩展开发窗口按 Cmd+R 重载
    ↓
4. 测试功能
    ↓
5. 重复步骤 1-4
```

## 文件大小估算

- 源代码（src/）: ~20 KB
- 编译输出（dist/）: ~50 KB（未压缩）
- 打包后（.vsix）: ~20 KB（压缩）
- 文档: ~50 KB
- 总计: ~140 KB（不含 node_modules 和 gitlens-reference）

## 代码统计

- TypeScript 文件: 7 个
- 总行数: ~800 行
- 注释覆盖率: ~30%
- 函数数量: ~40 个
- 类数量: 5 个

---

**这个结构设计确保了代码的清晰性、可维护性和可扩展性。** 🎯
