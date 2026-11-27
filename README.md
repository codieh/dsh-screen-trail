# 屏幕纪事 · Screen Trail

**把屏幕上的工作过程，整理成按天回看的个人纪事。**

屏幕纪事是 DeepSeek Harness 的 macOS 插件。开始记录后，它定期观察屏幕，由模型整理出你正在做的事情；回看时，可以切换日期、阅读事件摘要，或打开截图查看当时的画面。

![从屏幕画面整理活动记录的示意图](docs/preview.svg)

*上图为功能示意。*

## 能做什么

- **按天回看**：用日期 Tab 或日期选择器找到某一天的活动。
- **整理连续的事情**：由模型判断哪些步骤属于同一事件，继续更新已有记录，或略过无价值的画面，而不是每切换一次窗口就生成一张卡片。
- **查看截图依据**：每条事件附有封面和相关截图，展开详情即可查看。
- **在聊天中查询和编辑**：通过 Harness 中的纪事工具查找、更新、合并或删除事件，分析过程也保留在原生会话中。
- **调整记录节奏**：在面板选择采样间隔、分析周期、模型和思考强度。

## 安装

需要 macOS、DeepSeek Harness 和本机 Swift 编译器；宿主需运行在 Node.js 24 或更新版本，并配置支持图片输入的模型。Swift 编译器用于首次使用时编译采集辅助程序，无需另装 Screenpipe、FFmpeg 或数据库服务。

### 从 GitHub 安装（推荐）

无需先下载或 clone 仓库。

1. 打开桌面端 Harness 的插件管理页，选择 **添加插件（Add plugin）**。
2. 输入以下仓库地址并安装：

```text
https://github.com/codieh/dsh-screen-trail
```

3. 如果出现 **需要允许安装脚本**，确认列表中的 `@local/dsh-screen-trail` 属于本项目后，点击 **允许这些脚本并重试**。
4. 等待下载与 TypeScript 构建完成，按宿主提示重新加载或重启，打开侧栏的 **屏幕纪事**。

GitHub 安装会在安装过程中生成 `dist/`，无需手动运行 `npm ci` 或构建。构建脚本以当前用户权限执行，只允许你信任的包；不要全局关闭脚本审批。这里使用仓库地址，不是从 npm 注册表安装 `@local/dsh-screen-trail`。

### dsh web 从 GitHub 安装

```sh
dsh plugin --profile web add github:codieh/dsh-screen-trail
```

使用自定义 profile 时，将 `web` 替换为对应名称。若终端报告 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`，在报错指向的 profile 的 `pnpm-workspace.yaml` 中，为**报错列出的具体包**添加 `allowBuilds`，保留文件内已有配置，然后重新执行安装命令。例如：

```yaml
allowBuilds:
  '@local/dsh-screen-trail': true
```

安装后重启 `dsh web` 并刷新页面。桌面端请通过应用内的插件管理器安装，避免装进另一个 profile。

### 本地源码安装（开发用）

```sh
git clone https://github.com/codieh/dsh-screen-trail.git
cd dsh-screen-trail
npm ci
npm run build
```

然后在桌面端 **添加插件** 中输入仓库目录的绝对路径；`dsh web` 可执行 `dsh plugin --profile web add /absolute/path/dsh-screen-trail`。安装后按宿主提示重新加载，本地目录需保留。修改 `src/` 后重新运行 `npm run build`。

### 安装已构建的压缩包

也可从本仓库 [GitHub Actions](https://github.com/codieh/dsh-screen-trail/actions/workflows/ci.yml) 的成功运行中下载 `screen-trail-package` 产物，解开下载的外层 ZIP，得到 `.tgz` 文件。在 **添加插件** 中输入该 `.tgz` 的绝对路径即可，无需本地编译 TypeScript。GitHub 下载 Actions 产物可能要求登录；不要把仓库的 Source code ZIP 当作插件安装包。

## 开始使用

1. 打开 **屏幕纪事**，按需选择模型、思考强度和采样间隔。
2. 点击 **开始记录**，按系统提示授予“屏幕录制”权限，然后切换到实际工作的窗口。
3. 等待一批分析完成，或点击 **立即分析**，提前整理已有画面。
4. 切换日期回看事件，点击封面查看截图，展开详情查看相关依据。
5. 不需要继续记录时，点击 **暂停**。

默认每 **5 秒**采样一次，每 **5 分钟**选取最多 **20 张**代表图分析。采样间隔与分析周期可以分别调整，页面保存的选择在重启后保留。选定的模型需要支持对应的思考档位。

插件默认不会自动开始记录。纪事面板自身会被排除，普通 Harness 聊天窗口仍可采集。

## 数据与隐私

记录保存在本机的 `~/.dsh/screen-trail/`：

| 位置 | 内容 |
| --- | --- |
| `journal.sqlite` | 事件、观察记录、截图关联和插件设置 |
| `shots/` | 按内容哈希共享的 JPEG 截图 |
| `diagnostics/` | 最近分析的输入、回复与错误诊断 |

**选中的代表图及应用、窗口信息会发送给你配置的模型服务。** 分析会话和附件由 Harness 另行保存。诊断文件可能包含窗口标题和画面分析内容，分享前请检查敏感信息。

正式事件长期保留，临时观察默认保留 80 条，待分析观察另有容量控制。点击 **清空** 会删除插件的记录、截图和诊断，保留用户设置与分析会话关联；不会删除 Harness 的聊天或附件副本。

插件不录制音频或全天视频，不做 OCR，不读取辅助功能正文，也不监听按键或剪贴板。

## 文档与开发

- [中文详细说明](docs/DETAIL.zh.md)：采集与选图规则、完整配置、上下文管理和错误诊断。
- [English Details](docs/DETAIL.md)

本分支沿用 TypeScript 结构，源码位于 `src/`，宿主加载 `dist/` 中编译后的 JavaScript。构建同时生成类型声明与源码映射；运行插件不需要 TypeScript 依赖，源码开发与构建需要安装开发依赖。

运行类型检查与本地测试：

```sh
npm ci
npm run typecheck
npm test
```

测试使用模拟屏幕和模型，不调用真实云端模型或实际录屏。`npm test` 会先构建再测试编译产物；需要分发时运行 `npm pack`，同样会自动构建。使用 `npm pack --ignore-scripts` 时请先执行 `npm run build`。
