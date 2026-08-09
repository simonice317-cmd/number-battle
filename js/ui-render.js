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
  dom.btnSkills      = document.getElementById('btn-skills');
  dom.skillPopup     = document.getElementById('skill-popup');
  dom.skillPopupTitle = document.getElementById('skill-popup-title');
  dom.skillPopupList  = document.getElementById('skill-popup-list');
  dom.skillPopupClose = document.getElementById('skill-popup-close');
  dom.skillPopupBg    = document.querySelector('.skill-popup-bg');
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
  if (hpText) {
    const maxHpStr = Number.isInteger(player.maxHp) ? player.maxHp.toString() : player.maxHp.toFixed(1);
    if (player.baseMaxHp && player.maxHp < player.baseMaxHp) {
      hpText.textContent = `${player.hp}/${maxHpStr}（原${player.baseMaxHp}）`;
      hpText.style.color = '#F87171';
    } else {
      hpText.textContent = `${player.hp}/${maxHpStr}`;
      hpText.style.color = '';
    }
  }

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
    if (dom.btnSkills) dom.btnSkills.classList.remove('hidden');
  } else {
    dom.btnEndTurn.classList.add('hidden');
    dom.btnSurrender.classList.add('hidden');
    if (dom.btnSkills) dom.btnSkills.classList.add('hidden');
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
    dom.btnCoinflipNext.addEventListener('click', () => { if (onDone) onDone(); }, { once: true });
  }
}

// ============================================================
//  角色选择
// ============================================================

/** 生成技能+组合技 HTML（角色选择和弹窗共用） */
function buildSkillAndComboHtml(char) {
  let html = '';
  Object.entries(char.skills).forEach(([num, skill]) => {
    html += `<div class="skill-line"><span class="skill-num">${num}</span>${skill.desc}</div>`;
  });
  if (char.combo) {
    const comboNums = char.combo.required.join(' + ');
    html += `<div class="skill-combo-info">💥 <span class="skill-num combo-num">${comboNums}</span>${char.combo.desc}</div>`;
  }
  return html;
}

/** 生成带锁定状态的技能+组合技 HTML（局内弹窗用） */
function buildSkillAndComboHtmlWithStatus(char, player) {
  let html = '';
  Object.entries(char.skills).forEach(([num, skill]) => {
    html += `<div class="skill-line"><span class="skill-num">${num}</span>${skill.desc}</div>`;
  });
  if (char.combo) {
    const comboNums = char.combo.required.join(' + ');
    const comboAvail = player ? getComboAvailable(player) : null;
    const locked = player && player.comboUsed;
    const statusClass = locked ? 'combo-locked' : 'combo-ready';
    const statusText = locked ? '（已锁定，需加法解锁）' : '（可用）';
    html += `<div class="skill-combo-info ${statusClass}">💥 <span class="skill-num combo-num">${comboNums}</span>${char.combo.desc} ${statusText}</div>`;
  }
  return html;
}

/** 渲染角色选择卡片 */
export function renderCharSelect() {
  const container = dom.charCards;
  container.innerHTML = '';

  Object.values(CHARACTERS).forEach(char => {
    const card = document.createElement('div');
    card.className = 'char-card';
    card.dataset.charId = char.id;

    card.innerHTML = `
      <div class="char-avatar">${char.avatar}</div>
      <div class="char-name">${char.name}</div>
      <div class="char-hp">❤️ HP: ${char.maxHp}</div>
      <div class="char-skills">${buildSkillAndComboHtml(char)}</div>
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

// ============================================================
//  技能弹窗
// ============================================================

/** 显示技能弹窗（双栏：己方 + 对手） */
export function showSkillPopup(myPlayer, opponentPlayer) {
  if (!dom.skillPopup) return;
  const myChar = getCharacter(myPlayer);
  const oppChar = getCharacter(opponentPlayer);
  if (!myChar || !oppChar) return;

  dom.skillPopupTitle.textContent = '技能详情';
  // 双栏布局
  dom.skillPopupList.classList.add('skill-popup-columns');

  const myCol = document.getElementById('skill-popup-my');
  const oppCol = document.getElementById('skill-popup-opp');
  if (myCol) {
    myCol.innerHTML = `<h4>${myChar.avatar} ${myChar.name}（我方）</h4>${buildSkillAndComboHtmlWithStatus(myChar, myPlayer)}`;
  }
  if (oppCol) {
    oppCol.innerHTML = `<h4>${oppChar.avatar} ${oppChar.name}（对方）</h4>${buildSkillAndComboHtmlWithStatus(oppChar, opponentPlayer)}`;
  }
  dom.skillPopup.classList.remove('hidden');
}

/** 隐藏技能弹窗 */
export function hideSkillPopup() {
  if (dom.skillPopup) {
    dom.skillPopup.classList.add('hidden');
  }
}

// ============================================================
//  大厅技能图鉴
// ============================================================

let guidePopupEl = null;

/** 显示大厅技能图鉴 */
export function showLobbyGuide() {
  if (guidePopupEl) guidePopupEl.remove();

  guidePopupEl = document.createElement('div');
  guidePopupEl.id = 'lobby-guide-popup';
  guidePopupEl.className = 'skill-popup';
  guidePopupEl.innerHTML = `
    <div class="skill-popup-bg"></div>
    <div class="guide-popup-card">
      <h3>📖 技能图鉴</h3>
      <div id="lobby-guide-list">
        ${Object.values(CHARACTERS).map(char => `
          <div class="lobby-guide-char">
            <div class="lobby-guide-header">
              <span class="guide-avatar">${char.avatar}</span>
              <span class="guide-name">${char.name}</span>
              <span class="guide-hp">❤️ HP: ${char.maxHp}</span>
            </div>
            <div class="char-skills">${buildSkillAndComboHtml(char)}</div>
          </div>
        `).join('')}
      </div>
      <button class="btn btn-secondary guide-close-btn">关闭</button>
    </div>
  `;
  document.body.appendChild(guidePopupEl);

  const close = () => { guidePopupEl.remove(); guidePopupEl = null; };
  guidePopupEl.querySelector('.skill-popup-bg').addEventListener('click', close);
  guidePopupEl.querySelector('.guide-close-btn').addEventListener('click', close);
}

// ============================================================
//  角色选择锁定
// ============================================================

/** 标记角色卡片为已锁定 */
export function setCharLocked(charId) {
  const cards = document.querySelectorAll('.char-card');
  cards.forEach(card => {
    if (card.dataset.charId === charId) {
      card.classList.add('locked');
    }
    card.style.pointerEvents = 'none';
  });
  if (dom.btnConfirmChar) {
    dom.btnConfirmChar.textContent = '已锁定 ✓';
    dom.btnConfirmChar.disabled = true;
  }
}

// ============================================================
//  新手教程
// ============================================================

let tutorialEl = null;
let tutorialPage = 0;

const TUTORIAL_PAGES = [
  {
    emoji: '👋',
    title: '欢迎来到数字对战',
    html: `<p>这是一款<strong>回合制策略对战</strong>游戏。</p>
<p>你和对手各自拥有<strong>两个数字</strong>和一个<strong>角色技能组</strong>。</p>
<p>通过拖拽数字发动技能或攻击对手，将对方 <strong>HP 降至 0</strong> 即可获胜。</p>`,
  },
  {
    emoji: '🎮',
    title: '基本操作',
    html: `<p><strong>你的回合可以：</strong></p>
<ol style="text-align:left;line-height:1.8;">
  <li>拖拽数字到<strong>对手身上</strong> → 造成等值伤害</li>
  <li>拖拽数字到<strong>对手数字上</strong> → 加法合成<br><small style="color:#888;">（数字相加，每回合限 1 次）</small></li>
  <li>拖拽数字到<strong>自己身上</strong> → 触发角色技能</li>
  <li>点击 <strong>💥 组合技</strong> 按钮 → 发动强力组合技</li>
</ol>
<p style="color:#888;">每回合最多 <strong>2 次操作</strong></p>`,
  },
  {
    emoji: '🛡️',
    title: '护盾 & 重伤',
    html: `<p><strong>🛡️ 护盾</strong>：临时吸收伤害，<span style="color:#F87171;">回合开始时过期清零</span></p>
<p><strong>💔 重伤</strong>：HP 受到实际伤害时，最大生命上限<span style="color:#F87171;">永久减少</span></p>
<p style="font-size:13px;color:#888;">减少量 = 伤害值 × 50%（0.5步进）<br>例：受 1 点伤害 → 上限 -0.5，受 3 点伤害 → 上限 -1.5</p>
<p style="font-size:13px;color:#888;">治疗技能<strong>无法</strong>恢复已损失的上限<br>只有圣骑士的组合技「圣光复苏」可以恢复</p>`,
  },
  {
    emoji: '⚔️',
    title: '角色 & 组合技',
    html: `<p>四个角色各有<strong>独特技能</strong>。</p>
<p>当场上<strong>两个数字</strong>匹配角色的组合技要求时，可发动强力<strong>组合技</strong>。</p>
<p>点击大厅 <strong>📖 技能图鉴</strong> 查看所有角色详情。</p>
<p style="color:#FBBF24;">⚡ 善用组合技是逆转战局的关键！</p>`,
  },
];

/** 显示新手教程 */
export function showTutorial() {
  if (tutorialEl) tutorialEl.remove();
  tutorialPage = 0;

  tutorialEl = document.createElement('div');
  tutorialEl.id = 'tutorial-popup';
  tutorialEl.className = 'skill-popup';
  tutorialEl.innerHTML = `
    <div class="skill-popup-bg"></div>
    <div class="tutorial-popup-card">
      <div class="tutorial-header">
        <span class="tutorial-emoji" id="tutorial-emoji"></span>
        <h3 id="tutorial-title"></h3>
        <span class="tutorial-counter" id="tutorial-counter"></span>
      </div>
      <div class="tutorial-body" id="tutorial-body"></div>
      <div class="tutorial-footer">
        <button class="btn btn-secondary tutorial-prev" id="tutorial-prev" style="visibility:hidden;">◀ 上一步</button>
        <span class="tutorial-dots" id="tutorial-dots"></span>
        <button class="btn btn-primary tutorial-next" id="tutorial-next">下一步 ▶</button>
      </div>
      <button class="btn btn-secondary tutorial-close-btn" style="margin-top:8px;width:100%;">跳过教程</button>
    </div>
  `;
  document.body.appendChild(tutorialEl);

  const bg = tutorialEl.querySelector('.skill-popup-bg');
  const prevBtn = tutorialEl.querySelector('#tutorial-prev');
  const nextBtn = tutorialEl.querySelector('#tutorial-next');
  const closeBtn = tutorialEl.querySelector('.tutorial-close-btn');

  function renderPage() {
    const page = TUTORIAL_PAGES[tutorialPage];
    tutorialEl.querySelector('#tutorial-emoji').textContent = page.emoji;
    tutorialEl.querySelector('#tutorial-title').textContent = page.title;
    tutorialEl.querySelector('#tutorial-body').innerHTML = page.html;
    tutorialEl.querySelector('#tutorial-counter').textContent = `${tutorialPage + 1}/${TUTORIAL_PAGES.length}`;

    prevBtn.style.visibility = tutorialPage === 0 ? 'hidden' : 'visible';
    if (tutorialPage === TUTORIAL_PAGES.length - 1) {
      nextBtn.textContent = '✓ 开始游戏';
      nextBtn.classList.add('tutorial-done');
    } else {
      nextBtn.textContent = '下一步 ▶';
      nextBtn.classList.remove('tutorial-done');
    }

    // 更新圆点
    const dots = tutorialEl.querySelector('#tutorial-dots');
    dots.innerHTML = TUTORIAL_PAGES.map((_, i) =>
      `<span class="tutorial-dot${i === tutorialPage ? ' active' : ''}"></span>`
    ).join('');
  }

  function close() {
    tutorialEl.remove();
    tutorialEl = null;
    try { localStorage.setItem('nb_tutorial_seen', '1'); } catch (_) {}
  }

  bg.addEventListener('click', close);
  closeBtn.addEventListener('click', close);

  prevBtn.addEventListener('click', () => {
    if (tutorialPage > 0) { tutorialPage--; renderPage(); }
  });
  nextBtn.addEventListener('click', () => {
    if (tutorialPage < TUTORIAL_PAGES.length - 1) {
      tutorialPage++; renderPage();
    } else {
      close();
    }
  });

  renderPage();
}
