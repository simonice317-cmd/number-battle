# Design System: 数字对战 · 夜墨竞技（Premium Off-Black Dark）

> 唯一设计源（source of truth）。任何新屏幕/新组件都必须与本文件一致，实现有冲突时以本文件为准。
> 依据：taste-skill · redesign-skill · minimalist-skill · soft-skill · stitch-skill · emil-design-eng · apple-design

## 1. Visual Theme & Atmosphere

一款回合制中文双人对战游戏。克制的主机级深色语言：**墨夜底 + 暖白文字 + 单一琥珀强调色**。数字是本体，用等宽晶片呈现，有"屏幕上发着微光的筹码"的物性。深色但绝不霓虹：无外发光、无 AI 紫渐变，层次靠 1px 发丝描边 + 暖调深影 + 内顶高光实现。

- **Density**: Daily App Balanced（4-5）
- **Variance**: Offset Asymmetric（5-6）—— 游戏棋盘可居中，外围菜单/标题用非对称左对齐与大留白
- **Motion**: Fluid CSS（4-5）—— 有动机的微交互，全部 `transform/opacity`，尊重 `prefers-reduced-motion`
- **Theme**: 单一深色主题，锁死全页，不做区块反转

## 2. Color Palette & Roles

| 名称 | 值 | 用途 |
|------|-----|------|
| 墨底 Ink Base | `#0E0F12` | 页面背景（非纯黑）|
| 墨底深 Deep Ink | `#0B0C0F` | 更深的氛围层 |
| 面板 Panel | `#17181D` | 卡片/输入框/棋盘 |
| 面板高 Panel Raised | `#1E2026` | 抬高元素、晶片受光面 |
| 发丝 Hairline | `rgba(255,255,255,.08)` | 结构描边 1px |
| 发丝强 Hairline Strong | `rgba(255,255,255,.16)` | 更强分隔/焦点框 |
| 墨字 Ink Text | `#F2EFEA` | 主文字（非纯白）|
| 次级墨 Secondary | `#A6A29B` | 副文字 |
| 三级墨 Tertiary | `#6E6B66` | 说明/占位 |
| **琥珀 Amber（唯一强调色）** | `#D59A3C` | 我方数字、主按钮、选中态、技能标记（饱和度 72%）|
| 琥珀亮 Amber Strong | `#F0B455` | hover 提亮 |
| 琥珀软 Amber Soft | `rgba(213,154,60,.12)` | 选中底色 |
| 琥珀线 Amber Line | `rgba(213,154,60,.32)` | 强调描边 |
| 危险 Danger | `#E0655A` | 敌方 HP、伤害、失败 |
| 成功 Success | `#7FB069` | 治疗、胜、教程完成 |
| 警示 Warning | `#D59A3C` | 组合技/天赋（同琥珀家族）|
| 信息 Info | `#6FA8C9` | 护盾、己方落点提示 |

规则：
- 永远不用纯 `#000` / `#FFF`。纯色杀层次。
- 阴影统一暖黑 `rgba(0,0,0,.35-.45)` + 内顶高光 `inset 0 1px 0 rgba(255,255,255,.05)`。禁止 `drop-shadow` 外发光。
- 强调色锁死：琥珀是全局唯一的"可交互/己方/强调"，其它语义色（红绿蓝）只表达状态。

## 3. Typography Rules

- **Display/标题**：系统无衬线 800 字重，`letter-spacing: -0.03em`，`line-height: 1.05`。字号 `clamp()`。不用通用衬线（Georgia/Times 被封），不用 Inter。
- **Body/正文**：系统无衬线，`line-height: 1.6`，次级墨色。
- **Mono/数字**：`--font-mono`（SF Mono / Cascadia / Consolas），所有数字——HP、计时、房间码、操作计数——强制 `font-variant-numeric: tabular-nums` 等宽对齐。
- **角色/天赋单字**：`--font-mono` 700，放进描边方块 = "印章/活字"物性。
- **Banned**：`Inter`、`Georgia`、`Times New Roman`、`SimSun`（通用衬线家族）、任何 emoji。

## 4. Component Stylings

* **按钮 Button**：主操作 = 琥珀底 + 深字（`#1A1205`，满足 WCAG AA），圆角 12px，无外发光。按压 `scale(.97)`。hover 仅 `(hover:hover) and (pointer:fine)`。
* **数字晶片 Number Chip**：`linear-gradient(165deg,#1F2128,#17181D)` 底 + 发丝描边 + 内顶高光 + 暖黑影。我方可拖 = 琥珀描边 + 琥珀等宽数字；敌方 = 中性发丝 + 次级墨字。技能就绪 = 右上角琥珀 `◆` 角标。
* **头像 Avatar（印章）**：56px 描边方块，`--font-mono` 700 单字（基/圣/弓/盗），琥珀字。角色卡/图鉴/教程同构。
* **棋盘 Board（版心）**：中央整块面板，发丝描边 + 内顶高光，HP 槽琥珀（我方）/危险红（敌方），`14px` 槽圆角全圆。
* **输入框 Input**：面板底 + 发丝描边，聚焦 = 琥珀线 + 琥珀焦点环（`0 0 0 4px rgba(213,154,60,.12)`）。label 在上，placeholder 不顶替 label。
* **弹窗 Popup**：深色面板 + 发丝强描边 + 暖黑影 + `popup-in` 入场（opacity+translateY）。
* **加载/空/错误**：等待页用 `waiting-dots` 三点跳动；无空态页面；错误走 toast，不用 `alert`。

## 5. Layout Principles

- 大厅：左对齐编辑体。`logo-mark`（琥珀几何徽记）+ 等宽 `NUMBER BATTLE` 眉字 + 巨型 `数字对战` + 副题 → 发丝双线 → 三个对战入口（面板内竖排行，发丝分隔，每行 = 名称 + 说明 + `›`）→ 署名昵称输入 → 底部文字链接（技能图鉴/新手教程）。
- 棋盘：单列居中，`max-width: 520px`。对手区（上）→ 数字行 → 中间控制区 → 我方数字行 → 我方信息（下）。
- 全屏页一律 `flex` 居中；`overflow-y: auto` 兜底小屏。
- 网格优先，禁止 flex 百分比算数。所有可点元素 touch target ≥ 44px。

## 6. Motion & Interaction

- 缓动：`cubic-bezier(0.23,1,0.32,1)`（出场）/ `cubic-bezier(0.77,0,0.175,1)`（对称）。
- 只动 `transform` + `opacity`。时长 < 300ms。
- 按压 `scale(.97)`；hover 只在精确指针设备。
- 入场 stagger：`animation-delay: calc(var(--index) * 80ms)`，永不整页同时挂载。
- 拖拽箭头：琥珀色墨线曲线（SVG），拖起时晶片 `scale(1.1)` + 高影。
- `prefers-reduced-motion`：全量 `animation-duration:0.001ms !important` 兜底。

## 7. Anti-Patterns（Banned，禁绝清单）

- 零 emoji（代码/文案/alt 全禁）。用 SVG 线条图标 / 单字印章 / 几何符号（`◆ ◈ › ·`）。
- 零 `—`（em-dash）。范围/分隔一律用连字符 `-`。
- 禁 `Inter`；禁通用衬线（Georgia/Times/Palatino）；中文不用宋体。
- 禁 AI 紫 / 蓝渐变；禁霓虹外发光；禁纯黑底 `#000`。
- 禁三张等宽卡横排；禁"居中 Hero + 等宽卡片"的模板感；禁假数据/假精确数字。
- 禁 `h-screen`（用 `100dvh`）；禁 `window.addEventListener('scroll')`；禁 `transition: all`。
- 禁装饰性滚动提示（`Scroll ↓`）、版本徽标（v0.6/BETA）、编号小眉线（01/02/03 之眼）。
