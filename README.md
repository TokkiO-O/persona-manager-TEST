# Persona Manager

> SillyTavern 扩展 · Persona 人设管理 / 对比 / 重复检测

Persona Manager 是一个 SillyTavern 扩展，帮助你浏览、对比、清理 Power User 模块里堆积的 Persona（人设）。

支持以下场景：

- **同名区分**：同一个人设名 + 不同头像时，用备注/标题做次行小字区分
- **重复检测**：自动找出完全重复（名字 + 描述完全一致）的人设
- **高度相似**：用 bigram 相似度找出描述高度重合的人设
- **跨结构对比**：低相似度或结构差异大时，提取共同片段（数字、短语、专名）做高亮
- **删除人设**：列表里直接删除（带二次确认），写回 `power_user.personas`
- **编辑人设**：弹窗编辑显示名和描述，ID 锁定不会写错
- **多对象对比**：选 2~N 个一起对比，切换基准 / 对象，左边章节对齐 / 跨结构高亮两种模式自动切换

---

## 安装

**方式 1 · 扩展管理面板（推荐）**

酒馆主菜单 → Extensions → Install Extension → 粘贴仓库地址：

```
https://github.com/xingx121/persona-manager/archive/refs/heads/main.zip
```

**方式 2 · 手动**

```bash
# 1. 下载最新 zip
curl -L -o persona-manager.zip \
  https://github.com/xingx121/persona-manager/archive/refs/heads/main.zip

# 2. 解压到酒馆第三方扩展目录
unzip persona-manager.zip
mv persona-manager-main \
   <SillyTavern>/data/default-user/extensions/third-party/Persona\ Manager

# 3. 刷新酒馆页面
```

> ⚠️ **重要**：目录里**不要**保留 `.git` 文件夹，否则酒馆扩展面板会显示一个"在 GitHub 查看"的跳转按钮。如果之前是 `git clone` 安装的，把 `<扩展目录>/.git` 删掉。

---

## 使用

进入 **用户设置 → Persona 管理** 区块（扩展会在面板顶部注入入口按钮），或者在浏览器控制台执行 `openPersonaManager()`。

主界面有 4 个 tab：

| Tab | 作用 |
|---|---|
| 全部 | 网格列出所有人设 |
| 同名 | 名字完全相同的人设分组 |
| 完全重复 | 名字 + 描述完全一致的人设分组 |
| 高度相似 | 描述相似度 ≥ 阈值的成对列表 |
| 设置 | 相似度阈值 / 段落匹配敏感度 / 更新检查 |

### 对比

1. 选 2~N 个 Persona（每张卡片左侧复选框）
2. 底部出现"开始对比"按钮
3. 在对比页：
   - **顶部基准栏**：切换基准人设
   - **对象栏**：点击切换当前对比对象
   - **图例**：颜色含义见页面底部
   - **结构差异大**时自动切到"跨结构模式"，只标共同片段
   - **结构相似**时按章节对齐做精确 diff

### 编辑 / 删除

卡片右下角两个按钮：
- **编辑**：弹窗编辑显示名 + 描述，保存时**按 ID 锁定写入**，不会写错人设
- **删除**：确认后从 `power_user.personas` 中移除（不可自动恢复）

---

## 移动端

v1.8.13 起在手机浏览器（非全屏和全屏）做了适配：

- 使用 `100dvh` 解决浏览器地址栏导致窗口塌陷
- 入口按钮 `pointer-events: auto` + 提高 z-index 修复全屏点不动
- 窗口默认铺满，编辑器全屏化
- 对比页改整页滚动、基准/对象按钮缩小、共同片段独立滚动
- 卡片双列 / 单列自适应

---

## 配置

设置存在 `localStorage["pmp18_settings"]`：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `similarityThreshold` | `0.55` | 高度相似阈值 |
| `softMatchThreshold` | `0.35` | 段落匹配敏感度 |
| `includeSameNameInSimilar` | `true` | 同名是否参与"高度相似" |
| `showDiffOnly` | `false` | 对比页只显示差异段 |

清空设置：`localStorage.removeItem('pmp18_settings')`，刷新页面。

---

---

## 更新

扩展设置里有"检查更新"按钮，会拉取 GitHub `main` 分支的 `manifest.json` 和 `CHANGELOG.md`：

- 扩展目录通过 `git clone` 安装时：一键自动 `git pull`
- 扩展目录通过 zip 解压安装时：会提示失败并给出 GitHub 手动下载指引（v1.8.12+）

---

## 兼容性

- SillyTavern ≥ 1.13（需要 `power_user.personas` / `persona_descriptions` 字段）
- 移动浏览器：Safari ≥ 15, Chrome ≥ 108（需要 `100dvh` 和 `:has()` 支持）
- 桌面浏览器：现代浏览器即可

---

## 许可

仅供个人使用，请勿商用。
