/**
 * ui-render.js — DOM 渲染层
 * 负责将游戏状态同步到界面，不包含交互逻辑。
 */

import { getCharacter, getSkillForNumber } from './game-core.js';

// DOM 引用缓存
const dom = {};

/** 初始化 DOM 引用 */
export function initDomRefs() {
  dom.screens = {
    lobby:   document.getElementById('screen-lobby'),
    waiting: document.getElementById('screen-waiting'),
    game:    document.getElementById('screen-game'),
    result:  document.getElementById('screen-result'),
  };

  // Lobby
  dom.inputNickname = document.getElementById('input-nickname');
  dom.btnLocal      = document.getElementById('btn-local');
  dom.btnCreate     = document.getElementById('btn-create');
  dom.btnJoinShow   = document.getElementById('btn-join-show');
  dom.joinArea      = document.getElementById('join-area');
  dom.inputRoomCode = document.getElementById('input-roomcode');
  dom.btnJoin       = document.getElementById('btn-join');

  // Waiting
  dom.roomCodeBig   = document.getElementById('room-code-big');
  dom.waitingStatus = document.getElementById('waiting-status');
  dom.btnLeaveRoom  = document.getElementById('btn-leave-room');

  // P2P views
  dom.p2pHostView  = document.getElementById('p2p-host-view');
  dom.p2pGuestView = document.getElementById('p2p-guest-view');

  // Game — opponent
  dom.opponentAvatarZone = document.getElementById('opponent-avatar-zone');
  dom.opponentAvatar     = document.getElementById('opponent-avatar');
  dom.opponentName       = document.getElementById('opponent-name');
  dom.opponentHpBar      = document.getElementById('opponent-hp-bar');
  dom.opponentHpText     = document.getElementById('opponent-hp-text');
  dom.opponentShield     = document.getElementById('opponent-shield');
  dom.oppNum0            = document.getElementById('opp-num-0');
  dom.oppNum1            = document.getElementById('opp-num-1');

  // Game — my
  dom.myAvatarZone = document.getElementById('my-avatar-zone');
  dom.myAvatar     = document.getElementById('my-avatar');
  dom.myName       = document.getElementById('my-name');
  dom.myHpBar      = document.getElementById('my-hp-bar');
  dom.myHpText     = document.getElementById('my-hp-text');
  dom.myShield     = document.getElementById('my-shield');
  dom.myNum0       = document.getElementById('my-num-0');
  dom.myNum1       = document.getElementById('my-num-1');

  // Game — center
  dom.timerDisplay   = document.getElementById('timer-display');
  dom.turnLabel      = document.getElementById('turn-label');
  dom.actionCounter  = document.getElementById('action-counter');
  dom.btnEndTurn     = document.getElementById('btn-end-turn');
  dom.btnSurrender   = document.getElementById('btn-surrender');
  dom.roomCodeBadge  = document.getElementById('room-code-display');

  // Game — overlay
  dom.dragSvg = document.getElementById('drag-svg');
  dom.toast   = document.getElementById('toast');

  // Result
  dom.resultEmoji  = document.getElementById('result-emoji');
  dom.resultTitle  = document.getElementById('result-title');
  dom.resultDetail = document.getElementById('result-detail');
  dom.btnRematch   = document.getElementById('btn-rematch');
  dom.btnLobby     = document.getElementById('btn-lobby');
}

/** 切换页面 */
export function showScreen(name) {
  Object.values(dom.screens).forEach(el => el.classList.remove('active'));
  if (dom.screens[name]) {
    dom.screens[name].classList.add('active');
  }
}

/** 渲染玩家信息 */
function renderPlayer(player, prefix) {
  const char = getCharacter(player);
  const isMe = prefix === 'my';

  // 头像 & 名字
  const avatarEl = dom[`${prefix}Avatar`];
  const nameEl   = dom[`${prefix}Name`];
  if (avatarEl) avatarEl.textContent = char?.avatar || '🧙';
  if (nameEl)   nameEl.textContent   = player.name;

  // HP
  const hpBar  = dom[`${prefix}HpBar`];
  const hpText = dom[`${prefix}HpText`];
  const hpPct  = Math.max(0, (player.hp / player.maxHp) * 100);
  if (hpBar)  hpBar.style.width = `${hpPct}%`;
  if (hpText) hpText.textContent = `${player.hp}/${player.maxHp}`;

  // 护盾
  const shieldEl = dom[`${prefix}Shield`];
  if (shieldEl) {
    if (player.shield > 0) {
      shieldEl.classList.remove('hidden');
      shieldEl.textContent = `🛡️ ${player.shield}`;
    } else {
      shieldEl.classList.add('hidden');
    }
  }
}

/** 渲染数字卡片 */
function renderNumberCards(player, prefix) {
  player.numbers.forEach((num, i) => {
    const card = dom[`${prefix}Num${i}`];
    if (!card) return;
    const valueEl = card.querySelector('.num-value');
    if (valueEl) valueEl.textContent = num.value;

    if (prefix === 'my') {
      // 我方卡片：可拖拽状态
      const dot = card.querySelector('.skill-dot');
      if (num.skillReady) {
        card.classList.add('has-skill');
        if (dot) dot.classList.remove('hidden');
      } else {
        card.classList.remove('has-skill');
        if (dot) dot.classList.add('hidden');
      }
    }
  });
}

/** 渲染完整游戏状态 */
export function renderGameState(state, myPlayerIndex) {
  if (!state || !state.players) return;

  const opponent = state.players[myPlayerIndex === 0 ? 1 : 0];
  const me       = state.players[myPlayerIndex];

  renderPlayer(opponent, 'opponent');
  renderPlayer(me, 'my');
  renderNumberCards(opponent, 'opp');
  renderNumberCards(me, 'my');

  // 回合信息
  const isMyTurn = state.currentTurn === myPlayerIndex;
  dom.turnLabel.textContent = isMyTurn ? '你的回合' : '对手回合';
  dom.actionCounter.textContent = `操作 ${state.turnActionsUsed || 0}/2 | 加法 ${state.additionsUsed || 0}/1`;

  if (isMyTurn && state.phase === 'playing') {
    dom.btnEndTurn.classList.remove('hidden');
    dom.btnSurrender.classList.remove('hidden');
  } else {
    dom.btnEndTurn.classList.add('hidden');
    dom.btnSurrender.classList.add('hidden');
  }
}

/** 更新计时器显示 */
export function updateTimer(secondsLeft) {
  dom.timerDisplay.textContent = `⏱ ${secondsLeft}s`;
  if (secondsLeft <= 10) {
    dom.timerDisplay.classList.add('warning');
  } else {
    dom.timerDisplay.classList.remove('warning');
  }
}

/** 设置房间码显示 */
export function setRoomCode(code) {
  if (dom.roomCodeBig)   dom.roomCodeBig.textContent = code;
  if (dom.roomCodeBadge) dom.roomCodeBadge.textContent = `房间: ${code}`;
}

/** 显示 Toast */
let toastTimer;
export function showToast(msg, duration = 2000) {
  dom.toast.textContent = msg;
  dom.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    dom.toast.classList.add('hidden');
  }, duration);
}

/** 显示结算 */
export function showResult(won, reason) {
  if (won) {
    dom.resultEmoji.textContent = '🎉';
    dom.resultTitle.textContent = '你赢了！';
    dom.resultDetail.textContent = reason || '对手血量归零，你获得了胜利！';
  } else {
    dom.resultEmoji.textContent = '💔';
    dom.resultTitle.textContent = '你输了';
    dom.resultDetail.textContent = reason || '你的血量归零，对手获得了胜利。';
  }
  showScreen('result');
}

/** 更新等待页状态 */
export function setWaitingStatus(msg) {
  if (dom.waitingStatus) dom.waitingStatus.textContent = msg;
}

/** 获取 DOM 元素（供 drag-handler 使用） */
export function getDom() {
  return dom;
}
