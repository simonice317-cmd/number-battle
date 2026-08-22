# CLAUDE.md — 数字对战 (Number Battle)

> 回合制双人策略对战游戏 · 纯前端 · P2P 联机 · GitHub Pages 部署

## 项目概览

- **技术栈**：原生 JS (ES Modules) + CSS 纸张博弈浅色印刷主题 + PeerJS WebRTC
- **部署**：GitHub Pages → https://simonice317-cmd.github.io/number-battle/
- **运行**：双击 `index.html` 或 `npx serve .`
- **无构建步骤**：零依赖框架，所有库本地打包

## 文件结构 & 职责

```
youxi/
├── index.html          # 6 个全屏页面：大厅/等待/猜硬币/选角/对局/结算
├── css/style.css       # 纸张博弈浅色印刷主题（Paper Minimal），CSS 自定义属性驱动
├── js/
│   ├── game-core.js    # 🔒 纯逻辑层：角色注册表、加法、技能、组合技、重伤、胜负判定
│   ├── main.js         # 应用入口：状态管理、P2P 消息路由、本地/联机流程控制
│   ├── ui-render.js    # 渲染层：DOM 同步、特效动画、Toast、弹窗、粒子雨、故障屏
│   ├── drag-handler.js # 拖拽系统：touch/mouse、抛物线 SVG 箭头、落点检测
│   ├── p2p.js          # WebRTC P2P：PeerJS 信令（0.peerjs.com）、4 位房间码、国内 STUN
│   └── peerjs.min.js   # PeerJS 库本地打包（93KB）
└── 需求分析.md          # 完整需求文档 v1.0
```

## 架构原则

- **game-core.js 是纯函数**，不碰 DOM，所有操作返回 `{ newState, log }` 或 `{ error }`
- **CHARACTERS 注册表驱动**：新增角色只需在 `CHARACTERS` 对象加一条配置
- **数据流**：用户操作 → `resolveDragAction()` → `doAdd()`/`useSkill()`/`useCombo()` → `applyActionResult()` → 渲染 + Toast + 检查胜利
- **P2P 模式**：房主 (host) 是权威端，客机 (guest) 发操作请求，房主执行并广播 `state_update`

## 四种游戏模式

| 模式 | app.myPlayerIndex | 流程 |
|------|-------------------|------|
| `local` | 切换 0↔1 | 同屏轮流，中间弹遮罩切换玩家 |
| `p2p_host` | 0 | 创建房间→等待客机→猜硬币→选角→开战 |
| `p2p_guest` | 1 | 输入房间码→连接→猜硬币→选角→等 game_start |

## 四个角色

| ID | 名 | HP | 特色技能 | 组合技 |
|----|-----|----|----------|--------|
| basic | 基础使者 | 4 | 冲拳(4,8→伤1)、护盾(5→+1🛡)、回血(9→+1❤) | 无 |
| paladin | 圣骑士 | 5 | 冲拳(4,8)、盾击(5→盾+伤)、号角(6→攻+1)、回血(9) | 5+5→圣光复苏(恢复上限) |
| archer | 弓箭手 | 3 | 速射(3,4,8→伤1)、轻甲(5→+1🛡)、灵药(9→回1) | 3+6→万箭齐发(伤2+回1) |
| thief | 盗贼 | 2 | 刺击(4,8→伤1)、妙手(6→偷资源)、重击(7→穿甲)、暗影斗篷(9→+1🛡) | 8+7→暗影突袭(破盾+伤1) |

## 核心机制速查

- **加法**：拖数字到对方数字 → `(A+B)%10`，每回合限 1 次
- **技能**：数字值匹配技能表 → ✨标记 → 拖到对方头像(攻击)/己方头像(防御)/数字(偷取)
- **组合技**：场上数字匹配 combo.required → 💥按钮 → 使用后 `comboUsed=true` 锁定 → 做加法解锁
- **重伤**：受到实际 HP 伤害 → `maxHp -= 伤害×0.5`（0.5 步进），治疗无法恢复上限
- **护盾过期**：新回合开始时清零
- **回合**：每回合最多 2 次操作，加法最多 1 次，30 秒超时判负
- **伤害 Buff**：圣骑士号角 → `damageBuff` 上限 1，下次攻击消耗

## 关键函数路径

```
game-core.js:
  createPlayer(id, name, characterId) → 新玩家对象
  createGameState(p1, p2) → 初始游戏状态
  doAdd(state, playerIdx, myNumIdx, targetNumIdx) → 加法
  useSkill(state, playerIdx, myNumIdx, targetNumIdx?) → 技能
  useCombo(state, playerIdx) → 组合技
  resolveDragAction(player, numIdx, dropType, targetIdx) → 判断操作类型
  endTurn(state, playerIdx) / surrender(state, playerIdx)

ui-render.js:
  showScreen(name) / renderGameState(state, myIdx) / showToast(msg, dur)
  showResult(won, reason) — 含粒子雨/故障屏
  showSkillEffect(el, text, color, flashClass) — 头像闪烁+浮动文字
  showSkillPopup(myPlayer, oppPlayer) / showLobbyGuide() / showTutorial()

main.js:
  app = { mode, gameState, myPlayerIndex, ... } — 全局状态
  applyActionResult(result, opts) — 统一：更新状态→渲染→Toast→胜利检查→广播
  handleGuestAction(type, payload) — 房主处理客机操作
```

## P2P 消息协议

| 方向 | 消息 type | 携带 payload |
|------|-----------|-------------|
| Host→Guest | `game_start` | `{ yourIndex, gameState, opponentName }` |
| Host→Guest | `state_update` | `{ gameState }` |
| Host→Guest | `coin_result` | `{ result, guestGuess, correct, firstTurn }` |
| Guest→Host | `coin_guess` / `do_add` / `use_skill` / `use_combo` / `use_talent` / `end_turn` / `surrender` |
| 双向 | `char_locked` | `{ characterId, playerName }` |
| 双向 | `talent_locked` | `{ talentId }` |
| 双向 | `rematch_request` / `rematch_accept` / `rematch_decline` / `player_left` |

## 天赋系统

三个天赋，局外选择（角色选定后），局内一次性使用，不占行动次数：

| ID | 名称 | 图标 | 效果 |
|----|------|------|------|
| `heal_2` | 生命恢复 | 💚 | 恢复 2 点 HP（不超过上限） |
| `restore_max` | 上限修复 | 💪 | 恢复 2 点 maxHp（不超过 baseMaxHp） |
| `hp_lock` | 绝地求生 | 🛡️ | HP/maxHp 不低于 1，持续到己方下回合开始 |

**Player 新增字段**: `talentId`, `talentUsed`, `hpLocked`
**相关函数**: `useTalent(state, playerIdx)` in game-core.js
**流程**: 角色选择 → 天赋选择 (`screen-talentselect`) → 开战

## 注意事项

- `rebuildGameState()` 做 JSON→游戏状态的反序列化，新增字段要加向后兼容默认值
- `sanitizeGameState()` 序列化前清除 `winReason`（客机不需要）
- 本地模式玩家切换用 `showSwitchOverlay()` 弹遮罩
- 拖拽落点：`data-drop-target` 属性标记（`opponent_number`/`opponent_body`/`self_body`）
- PeerJS 信令走 `0.peerjs.com:443`，STUN 优先 QQ+小米（国内可达）
