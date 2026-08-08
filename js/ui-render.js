/**
 * ui-render.js — DOM 渲染层
 * 负责将游戏状态同步到界面，不包含交互逻辑。
 */

import { getCharacter, getSkillForNumber, CHARACTERS, getComboAvailable } from './game-core.js';

// DOM 引用缓存
const dom = {};

/** 初始化 DOM 引用 */
export function initDomRefs() {
  dom.screens = {
    lobby:     document.getElementById('screen-lobby'),
    waiting:   document.getElementById('screen-waiting'),
    coinflip:  document.getElementById('screen-coinflip'),
    charselect:document.getElementById('screen-charselect'),
    game:      document.getElementById('screen-game'),
    result:    document.getElementById('screen-result'),
  };

  // Lobby
  dom.inputNickname = document.getElementById('input-nickname');
  dom.btnLocal      = document.getElementById('btn-local');
  dom.btnCreate     = document.getElementById('btn-create');
  dom.btnJoinShow   = document.getElementById('btn-join-show');

  // Waiting
  dom.btnLeaveRoom  = document.getElementById('btn-leave-room');

  // P2P views
  dom.p2pHostView  = document.getElementById('p2p-host-view');
  dom.p2pGuestView = document.getElementById('p2p-guest-view');

  // Coin flip
  dom.coinflipSubtitle   = document.getElementById('coinflip-subtitle');
  dom.coin               = document.getElementById('coin');
  dom.coinflipButtons    = document.getElementById('coinflip-buttons');
  dom.coinflipWaiting    = document.getElementById('coinflip-waiting');
  dom.coinflipResult     = document.getElementById('coinflip-result');
  dom.coinflipResultText = document.getElementById('coinflip-result-text');
  dom.coinflipTurnText   = document.getElementById('coinflip-turn-text');
  dom.btnCoinflipNext    = document.getElementById('btn-coinflip-next');

  // Character select
  dom.charCards         = document.getElementById('char-cards');
  dom.btnConfirmChar    = document.getElementById('btn-confirm-char');
  dom.charselectWaiting = document.getElementById('charselect-waiting');

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
  dom.btnCombo       = document.getElementById('btn-combo');
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

  // 组合技按钮
  if (dom.btnCombo) {
    if (isMyTurn && state.phase === 'playing') {
      const combo = getComboAvailable(me);
      if (combo) {
        dom.btnCombo.classList.remove('hidden');
        dom.btnCombo.textContent = `💥 ${combo.name}`;
      } else {
        dom.btnCombo.classList.add('hidden');
      }
    } else {
      dom.btnCombo.classList.add('hidden');
    }
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

// ============================================================
//  硬币猜测
// ============================================================

/** 配置硬币猜测界面 */
export function setupCoinFlipUI(role) {
  if (role === 'guesser') {
    dom.coinflipSubtitle.textContent = '选择正面或反面，决定谁先手';
    dom.coinflipButtons.classList.remove('hidden');
    dom.coinflipWaiting.classList.add('hidden');
  } else {
    dom.coinflipSubtitle.textContent = '对方正在猜测硬币…';
    dom.coinflipButtons.classList.add('hidden');
    dom.coinflipWaiting.classList.remove('hidden');
  }
  dom.coinflipResult.classList.add('hidden');
  if (dom.btnCoinflipNext) dom.btnCoinflipNext.classList.add('hidden');
}

/** 显示硬币结果 + 翻转动画 */
export function showCoinFlipResult(result, guestGuess, correct, firstName, onDone) {
  dom.coinflipButtons.classList.add('hidden');
  dom.coinflipWaiting.classList.add('hidden');
  dom.coinflipResult.classList.remove('hidden');

  const faceName = result === 'heads' ? '正面' : '反面';
  dom.coinflipResultText.textContent = correct
    ? `✅ ${guestGuess === 'heads' ? '正面' : '反面'}！猜对了！`
    : `❌ 是${faceName}，猜错了`;
  dom.coinflipTurnText.textContent = `${firstName} 先手`;
  if (dom.btnCoinflipNext) dom.btnCoinflipNext.classList.remove('hidden');

  // 硬币动画
  dom.coin.classList.add('flipping');
  dom.coin.addEventListener('animationend', function handler() {
    dom.coin.classList.remove('flipping');
    dom.coin.removeEventListener('animationend', handler);
  }, { once: true });

  // 点击"继续"按钮
  if (dom.btnCoinflipNext) {
    const nextHandler = () => {
      dom.btnCoinflipNext.removeEventListener('click', nextHandler);
      if (onDone) onDone();
    };
    dom.btnCoinflipNext.addEventListener('click', nextHandler);
  }
}

// ============================================================
//  角色选择
// ============================================================

/** 渲染角色选择卡片 */
export function renderCharSelect() {
  const container = dom.charCards;
  container.innerHTML = '';

  Object.values(CHARACTERS).forEach(char => {
    const card = document.createElement('div');
    card.className = 'char-card';
    card.dataset.charId = char.id;

    let skillsHtml = '';
    Object.entries(char.skills).forEach(([num, skill]) => {
      skillsHtml += `<div class="skill-line"><span class="skill-num">${num}</span>${skill.desc}</div>`;
    });

    card.innerHTML = `
      <div class="char-avatar">${char.avatar}</div>
      <div class="char-name">${char.name}</div>
      <div class="char-hp">❤️ HP: ${char.maxHp}</div>
      <div class="char-skills">${skillsHtml}</div>
    `;

    card.addEventListener('click', () => {
      container.querySelectorAll('.char-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      dom.btnConfirmChar.disabled = false;
    });

    container.appendChild(card);
  });

  dom.btnConfirmChar.disabled = true;
  if (dom.charselectWaiting) dom.charselectWaiting.classList.add('hidden');
}

// ============================================================
//  技能特效
// ============================================================

/**
 * 显示技能特效
 * @param {Element} targetEl — 目标 DOM 元素
 * @param {string} text — 浮动文字
 * @param {string} color — 文字颜色
 * @param {string} flashClass — 闪烁 CSS class
 */
export function showSkillEffect(targetEl, text, color, flashClass) {
  if (!targetEl) return;

  // 1. 头像闪烁
  if (flashClass) {
    targetEl.classList.add(flashClass);
    setTimeout(() => targetEl.classList.remove(flashClass), 600);
  }

  // 2. 浮动文字
  if (text) {
    const rect = targetEl.getBoundingClientRect();
    const floatEl = document.createElement('div');
    floatEl.className = 'float-text';
    floatEl.textContent = text;
    floatEl.style.cssText = `
      left: ${rect.left + rect.width / 2 - 40}px;
      top: ${rect.top - 10}px;
      color: ${color};
    `;
    document.body.appendChild(floatEl);
    setTimeout(() => floatEl.remove(), 1300);
  }
}

/** 获取 DOM 元素（供 drag-handler 使用） */
export function getDom() {
  return dom;
}
