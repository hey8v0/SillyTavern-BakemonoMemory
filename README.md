# Bakemono Memory 剧情剪辑台

SillyTavern 第三方扩展，用于扫描聊天里的摘要/正文片段，生成阶段总结、史诗简史和长期剧情记忆。

## 功能

- 魔法棒菜单入口，无悬浮球。
- 通用扫描规则：可配置读取标签、排除标签、全文管线。
- 手动/自动总结：自动总结只生成草稿，确认后才保存。
- 草稿箱：支持编辑标题、编辑内容、重新总结、确认保存、丢弃。
- 任务队列：批量旧正文补课按队列顺序生成。
- 摘要树/时间线：查看剧情摘要、阶段总结、史诗简史的覆盖关系。
- 工作流预设：保存提示词、扫描规则、分类规则、美化分段和自动总结设置。
- 注入内容：通过 `setExtensionPrompt` 注入长期剧情记忆。

## 安装

把 `BakemonoMemory` 文件夹放入：

```text
SillyTavern/public/scripts/extensions/third-party/
```

然后刷新 SillyTavern，在左下角魔法棒菜单打开 `剧情剪辑台`。

## 文件

- `manifest.json`：扩展清单
- `index.js`：扩展逻辑
- `settings.html`：工作台界面
- `style.css`：界面样式
