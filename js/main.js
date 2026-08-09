/**
 * main.js — 应用入口 & 状态管理
 *
 * 支持三种模式:
 *   'local'    — 同屏双人对战
 *   'p2p_host' — P2P 房主（WebRTC 直连）
 *   'p2p_guest'— P2P 客机（WebRTC 直连）
 */

import {
  CHARACTERS,
  createPlayer, createGameState,
  doAdd, useSkill, endTurn, surrender, resolveDragAction,
  getComboAvailable, useCombo,
  generateId,
} from './game-core.js';

import {
  initDomRefs, showScreen, renderGameState,
  updateTimer, setRoomCode, showToast, showResult,
  getDom, setupCoinFlipUI, showCoinFlipResult,
  renderCharSelect, showSkillEffect,
  showSkillPopup, hideSkillPopup,
  showLobbyGuide, setCharLocked, showTutorial,
} from './ui-render.js';

import { initDrag } from './drag-handler.js';
import { hostCreate, guestJoin, send, onMessage, onStatus, disconnect as p2pDisconnect, isConnected } from './p2p.js';

// ============================================================
//  应用状态
// ============================================================

const app = {
  mode: 'local',          // 'local' | 'p2p_host' | 'p2p_guest'
  gameState: null,
  myPlayerIndex: 0,
  myPlayerId: null,
  myPlayerName: '',
  turnTimer: null,
  turnSecondsLeft: 30,
  p2pRoomCode: '',        // 当前 P2P 房间号

  // 硬币猜测
  p2pPhase: null,         // 'coin_flip' | 'char_select'
  coinFlipFirstTurn: 0,
  _localName2: '玩家2',   // 本地模式对手名字
  opponentName: '',       // P2P 对手真实名称（通过 char_locked 传递）

  // 角色选择
  myCharacterId: null,
  myCharacterLocked: false,
  opponentCharacterId: null,
  opponentCharacterLocked: false,
  _localChar1: null,       // 本地模式玩家1的角色ID
};

// ============================================================
//  初始化
// ============================================================

function init() {
  initDomRefs();
  initDrag({
    onDrop:   handleDragDrop,
    onCancel: () => {},
  });
  bindEvents();
  showScreen('lobby');

  // 首次访问自动弹出新手教程
  try {
    if (!localStorage.getItem('nb_tutorial_seen')) {
      setTimeout(() => showTutorial(), 500);
    }
  } catch (_) {}
}

function bindEvents() {
  const dom = getDom();

  // 大厅
  dom.btnLocal    .addEventListener('click', onLocalPlay);
  document.getElementById('btn-lobby-guide')?.addEventListener('click', () => {
    showLobbyGuide();
  });
  document.getElementById('btn-lobby-tutorial')?.addEventListener('click', () => {
    showTutorial();
  });
  dom.btnCreate   .addEventListener('click', () => {
    setupP2PHandlers();
    onCreateRoom();
  });
  dom.btnJoinShow .addEventListener('click', () => {
    showScreen('waiting');
    const waitDom = getDom();
    waitDom.p2pHostView.classList.add('hidden');
    waitDom.p2pGuestView.classList.remove('hidden');
    document.getElementById('guest-status').textContent = '';
    document.getElementById('input-room-code').value = '';
    setupP2PHandlers();
  });

  // P2P 等待页 — 客机加入
  document.getElementById('btn-join-room').addEventListener('click', () => {
    setupP2PHandlers();
    onJoinRoom();
  });

  // 等待页退出
  dom.btnLeaveRoom?.addEventListener('click', onLeaveRoom);
  document.getElementById('btn-leave-room-guest')?.addEventListener('click', onLeaveRoom);

  // 猜硬币按钮
  document.getElementById('coinflip-buttons')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.coinflip-btn');
    if (!btn) return;
    onCoinGuess(btn.dataset.guess);
  });

  // 角色选择确认
  document.getElementById('btn-confirm-char')?.addEventListener('click', onConfirmCharSelect);

  // 组合技按钮
  document.getElementById('btn-combo')?.addEventListener('click', handleCombo);

  // 技能查看按钮
  document.getElementById('btn-skills')?.addEventListener('click', () => {
    const gs = app.gameState;
    if (!gs || !gs.players) return;
    const me = gs.players[app.myPlayerIndex];
    const opp = gs.players[app.myPlayerIndex === 0 ? 1 : 0];
    if (me && opp) showSkillPopup(me, opp);
  });

  // 技能弹窗关闭
  document.getElementById('skill-popup-close')?.addEventListener('click', hideSkillPopup);
  document.querySelector('.skill-popup-bg')?.addEventListener('click', hideSkillPopup);

  // 游戏内
  dom.btnEndTurn  .addEventListener('click', handleEndTurn);
  dom.btnSurrender.addEventListener('click', handleSurrender);

  // 结算
  dom.btnRematch.addEventListener('click', onRematch);
  dom.btnLobby .addEventListener('click', backToLobby);
}

/** 根据 winReason 生成结算文案 */
function getWinMessage(gs, myIdx) {
  if (!gs || !gs.winReason) return '';
  if (gs.winReason === 'surrender') {
    return gs.winner === myIdx ? '对方投降' : '你投降了';
  }
  return gs.winner === myIdx ? '对方血量归零' : '你的血量归零';
}

// ---- 共享工具函数 ----

/** 统一 apply → render → toast → win-check → 尾部逻辑 */
function applyActionResult(result, opts = {}) {
  app.gameState = result.newState;
  renderGameState(app.gameState, app.myPlayerIndex);
  if (result.log) showToast(result.log, 2000);

  if (app.gameState.phase === 'finished') {
    stopLocalTimer();
    const won = app.gameState.winner === app.myPlayerIndex;
    if (opts.broadcast) send('state_update', { gameState: sanitizeGameState(app.gameState) });
    setTimeout(() => showResult(won, getWinMessage(app.gameState, app.myPlayerIndex)), 800);
    return false; // 游戏结束
  }

  if (opts.broadcast) send('state_update', { gameState: sanitizeGameState(app.gameState) });
  if (opts.tail === 'checkTurn') checkLocalTurnSwitch();
  else if (opts.tail === 'resetTimer' && app.gameState.currentTurn !== app.myPlayerIndex) resetLocalTimerDisplay();
  return true; // 游戏继续
}

/** 组合技特效（根据 combo 类型显示不同效果） */
function showComboEffect(combo, opponentAvatar, myAvatar) {
  const hasDamage = combo.effects.some(e => e.type === 'damage');
  const hasHeal = combo.effects.some(e => e.type === 'heal');
  const hasBreakShield = combo.effects.some(e => e.type === 'break_shield');
  const hasRestore = combo.effects.some(e => e.type === 'restore_max_hp');

  if (hasDamage || hasBreakShield) {
    showSkillEffect(opponentAvatar, '-2', '#F87171', 'avatar-flash-hit');
  }
  if (hasHeal) {
    setTimeout(() => showSkillEffect(myAvatar, '+1❤️', '#34D399', 'avatar-flash-heal'), 300);
  }
  if (hasRestore) {
    setTimeout(() => showSkillEffect(myAvatar, '✨恢复', '#FBBF24', 'avatar-flash-heal'), 300);
  }
}

/** 拖拽技能特效（local / host / guest 共用） */
function showDragSkillEffect(gs, params, playerIdx = 0) {
  const num = gs.players[playerIdx]?.numbers[params.myNumIdx];
  if (!num) return;
  const char = CHARACTERS[gs.players[playerIdx].characterId];
  const skill = char?.skills[num.value];
  if (!skill) return;
  const dom = getDom();
  if (skill.target === 'opponent_number') {
    const oppPrefix = playerIdx === 0 ? 'oppNum' : 'myNum';
    const targetCard = dom[`${oppPrefix}${params.targetNumIdx}`];
    if (targetCard) showSkillEffect(targetCard, '✋复制', '#8B5CF6', null);
  } else {
    const targetEl = skill.target === 'opponent_body' ? dom.opponentAvatar : dom.myAvatar;
    triggerSkillEffect(skill.type, skill.value, targetEl);
  }
}

// 技能特效映射表（模块级常量，避免每次重新创建）
const SKILL_EFFECTS = {
  damage:         { text: (v) => `-${v}`,   color: '#F87171', flash: 'avatar-flash-hit' },
  shield_strike:  { text: (v) => `🛡-${v}`, color: '#F87171', flash: 'avatar-flash-hit' },
  shield:         { text: (v) => `+${v}🛡`, color: '#22D3EE', flash: 'avatar-flash-shield' },
  shield_temp:    { text: (v) => `+${v}🛡`, color: '#22D3EE', flash: 'avatar-flash-shield' },
  heal:           { text: (v) => `+${v}❤`,  color: '#34D399', flash: 'avatar-flash-heal' },
  buff:           { text: (v) => `⚔+${v}`,  color: '#FBBF24', flash: 'avatar-flash-buff' },
  pierce_damage:  { text: (v) => `💀-${v}`, color: '#EF4444', flash: 'avatar-flash-pierce' },
  steal_number:   { text: () => '✋复制',    color: '#8B5CF6', flash: 'avatar-flash-steal' },
  steal_resource: { text: () => '✋偷取',    color: '#8B5CF6', flash: 'avatar-flash-steal' },
  restore_max_hp: { text: () => '✨恢复',   color: '#FBBF24', flash: 'avatar-flash-heal' },
  break_shield:   { text: () => '💔破盾',   color: '#EF4444', flash: 'avatar-flash-hit' },
};

// ============================================================
//  大厅逻辑
// ============================================================

function getNickname() {
  const name = getDom().inputNickname.value.trim();
  return name || '玩家' + (Math.floor(Math.random() * 90) + 10);
}

/** 本地对战 — 先猜硬币，再选角色，然后开始 */
function onLocalPlay() {
  const rawInput = getDom().inputNickname.value.trim();
  const name = rawInput || '玩家' + (Math.floor(Math.random() * 90) + 10);
  app.mode = 'local';
  app.myPlayerName = name;
  app.myPlayerIndex = 0;
  app._localName2 = rawInput ? '玩家2' : '玩家' + (Math.floor(Math.random() * 90) + 10);
  showScreen('coinflip');
  setupCoinFlipUI('guesser');
}

/** P2P 房主：创建房间，自动信令连接 */
async function onCreateRoom() {
  const name = getNickname();
  try {
    showScreen('waiting');
    const dom = getDom();
    dom.p2pHostView.classList.remove('hidden');
    dom.p2pGuestView.classList.add('hidden');
    document.getElementById('host-status').textContent = '正在连接信令服务…';

    setupP2PHandlers();
    app.mode = 'p2p_host';
    app.myPlayerName = name;
    app.myPlayerIndex = 0;

    const roomCode = await hostCreate();
    app.p2pRoomCode = roomCode;

    document.getElementById('p2p-room-code-big').textContent = roomCode;
    document.getElementById('host-status').textContent = '等待朋友加入…';
    document.getElementById('host-waiting-dots').classList.remove('hidden');
  } catch (err) {
    showToast('创建失败: ' + err.message);
    showScreen('lobby');
  }
}

/** P2P 客机：输入房间号加入 */
async function onJoinRoom() {
  const name = getNickname();
  const code = document.getElementById('input-room-code').value.trim();
  if (!code || code.length !== 4) {
    showToast('请输入 4 位房间号');
    return;
  }

  try {
    document.getElementById('guest-status').textContent = '正在连接信令服务…';

    app.mode = 'p2p_guest';
    app.myPlayerName = name;
    app.myPlayerIndex = 1;

    await guestJoin(code);
    app.p2pRoomCode = code;
    document.getElementById('guest-status').textContent = '已加入房间，等待房主确认…';
  } catch (err) {
    showToast('加入失败: ' + err.message);
    app.mode = 'local';
  }
}

/** 退出 P2P 等待房间 */
function onLeaveRoom() {
  p2pDisconnect();
  app.myPlayerId = null;
  app.myPlayerName = '';
  app.p2pRoomCode = '';
  showScreen('lobby');
}

// ============================================================
//  P2P 消息处理
// ============================================================

function setupP2PHandlers() {
  onMessage(handleP2PMessage);

  onStatus((status, data) => {
    switch (status) {
      case 'connected':
        // 双方连接后进入猜硬币环节
        if (app.mode === 'p2p_host') {
          app.p2pPhase = 'coin_flip';
          showScreen('coinflip');
          setupCoinFlipUI('flipper');
          send('coin_flip_start', {});
        }
        // 客机等待房主发来 coin_flip_start
        break;
      case 'disconnected':
        if (app.gameState) {
          if (app.gameState.phase === 'playing') {
            showToast('连接断开，游戏终止');
            stopLocalTimer();
            setTimeout(backToLobby, 1500);
          } else if (app.gameState.phase === 'finished') {
            showToast('对手已断开连接');
            const resultDom = getDom();
            if (resultDom.btnRematch) resultDom.btnRematch.disabled = true;
          }
        }
        break;
    }
  });
}

function handleP2PMessage(msg) {
  const { type, payload = {} } = msg;

  switch (type) {
    // ---- 硬币猜测 ----
    case 'coin_flip_start':
      if (app.mode === 'p2p_guest') {
        app.p2pPhase = 'coin_flip';
        showScreen('coinflip');
        setupCoinFlipUI('guesser');
      }
      break;

    case 'coin_guess':
      if (app.mode === 'p2p_host' && app.p2pPhase === 'coin_flip') {
        const guestGuess = payload.guess;
        const result = Math.random() < 0.5 ? 'heads' : 'tails';
        const correct = guestGuess === result;
        // Host = index 0, Guest = index 1
        app.coinFlipFirstTurn = correct ? 1 : 0;
        const firstName = app.coinFlipFirstTurn === 0 ? app.myPlayerName : (app.opponentName || '对手');
        showCoinFlipResult(result, guestGuess, correct, firstName, () => {
          app.p2pPhase = 'char_select';
          startCharSelect();
        });
        send('coin_result', { result, guestGuess, correct, firstTurn: app.coinFlipFirstTurn });
      }
      break;

    case 'coin_result':
      if (app.mode === 'p2p_guest' && app.p2pPhase === 'coin_flip') {
        const { result, guestGuess, correct, firstTurn } = payload;
        app.coinFlipFirstTurn = firstTurn;
        const firstName = firstTurn === 1 ? app.myPlayerName : (app.opponentName || '对手');
        showCoinFlipResult(result, guestGuess, correct, firstName, () => {
          app.p2pPhase = 'char_select';
          startCharSelect();
        });
      }
      break;

    // ---- 角色选择 ----
    case 'char_locked':
      app.opponentCharacterId = payload.characterId;
      app.opponentCharacterLocked = true;
      if (payload.playerName) app.opponentName = payload.playerName;
      if (app.mode === 'p2p_host' && app.p2pPhase === 'char_select') {
        tryStartP2PGame();
      } else if (app.mode === 'p2p_guest' && app.p2pPhase === 'char_select') {
        const dom = getDom();
        if (dom.charselectWaiting) {
          dom.charselectWaiting.textContent = app.myCharacterLocked ? '双方均已锁定，等待房主开始…' : '对方已锁定，请选择并锁定角色';
        }
      }
      break;

    // ---- 客机收到：游戏开始 ----
    case 'game_start':
      if (app.mode === 'p2p_guest') {
        app.myPlayerIndex = payload.yourIndex;
        app.gameState = rebuildGameState(payload.gameState);
        setRoomCode(app.p2pRoomCode || 'P2P');
        showScreen('game');
        renderGameState(app.gameState, app.myPlayerIndex);
        app.turnSecondsLeft = 30;
        startLocalTimer();
        const pName = app.gameState.players[app.coinFlipFirstTurn]?.name || '';
        showToast(`游戏开始！${pName} 先手`, 2000);
      }
      break;

    case 'state_update':
      if (app.gameState && payload.gameState) {
        app.gameState = rebuildGameState(payload.gameState);
        renderGameState(app.gameState, app.myPlayerIndex);
        if (app.gameState.currentTurn !== app.myPlayerIndex) {
          resetLocalTimerDisplay();
        }
        if (app.gameState.phase === 'finished') {
          stopLocalTimer();
          const won = app.gameState.winner === app.myPlayerIndex;
          setTimeout(() => showResult(won, getWinMessage(app.gameState, app.myPlayerIndex)), 800);
        }
      }
      break;

    // ---- 房主收到（客机的操作） ----
    case 'do_add':
    case 'use_skill':
    case 'use_combo':
    case 'end_turn':
    case 'surrender':
      if (app.mode === 'p2p_host') {
        handleGuestAction(type, payload);
      }
      break;

    // ---- 再来一局协议 ----
    case 'rematch_request':
      handleRematchRequest();
      break;
    case 'rematch_accept':
      handleRematchAccept();
      break;
    case 'rematch_decline':
      showToast('对手拒绝了再来一局');
      setTimeout(backToLobby, 1500);
      break;
    case 'player_left': {
      showToast('对手已离开房间');
      const rd = getDom();
      if (rd.btnRematch) rd.btnRematch.disabled = true;
      if (rd.resultDetail) rd.resultDetail.textContent = '对手已离开房间。';
      break;
    }

    case 'disconnected':
      showToast('对方已断开连接');
      break;
  }
}

/** 房主处理客机的操作 */
function handleGuestAction(type, payload) {
  const gs = app.gameState;
  if (!gs || gs.phase !== 'playing') return;

  let result;
  switch (type) {
    case 'do_add':
      result = doAdd(gs, 1, payload.myNumIdx, payload.targetNumIdx);
      break;
    case 'use_skill':
      result = useSkill(gs, 1, payload.myNumIdx, payload.targetNumIdx);
      break;
    case 'use_combo':
      result = useCombo(gs, 1);
      break;
    case 'end_turn':
      result = endTurn(gs, 1);
      break;
    case 'surrender':
      result = surrender(gs, 1);
      break;
  }

  if (result && result.error) {
    send('error', { message: result.error });
    return;
  }

  if (!result || !result.newState) return;

  // 特效
  if (type === 'use_combo') {
    const guestChar = CHARACTERS[gs.players[1].characterId];
    if (guestChar?.combo) showComboEffect(guestChar.combo, getDom().myAvatar, getDom().opponentAvatar);
  }
  if (type === 'use_skill') showDragSkillEffect(gs, payload, 1); // guest = player index 1

  applyActionResult(result, { broadcast: true, tail: 'resetTimer' });
}

/** 从 JSON 重建游戏状态 */
function rebuildGameState(s) {
  return {
    players: s.players.map(p => ({
      id: p.id,
      name: p.name,
      characterId: p.characterId,
      hp: p.hp,
      maxHp: p.maxHp,
      baseMaxHp: p.baseMaxHp || p.maxHp,  // 向后兼容旧状态
      shield: p.shield,
      damageBuff: p.damageBuff || 0,
      comboUsed: p.comboUsed || false,      // 修复：之前缺失导致P2P同步后组合技锁失效
      numbers: p.numbers.map(n => ({ value: n.value, skillReady: n.skillReady })),
    })),
    currentTurn: s.currentTurn,
    phase: s.phase,
    turnActionsUsed: s.turnActionsUsed,
    additionsUsed: s.additionsUsed || 0,
    winner: s.winner,
    winReason: s.winReason || null,
  };
}

/** 将游戏状态序列化（去掉不能 JSON 的字段） */
function sanitizeGameState(gs) {
  const s = rebuildGameState(gs);
  delete s.winReason;
  return s;
}

// ============================================================
//  硬币猜测
// ============================================================

/** 根据技能类型显示视觉特效 */
function triggerSkillEffect(skillType, skillValue, targetEl) {
  const eff = SKILL_EFFECTS[skillType];
  if (eff) showSkillEffect(targetEl, eff.text(skillValue), eff.color, eff.flash);
}

function onCoinGuess(guess) {
  // 本地模式
  if (app.mode === 'local') {
    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const correct = guess === result;
    const firstTurn = correct ? 0 : 1;
    const firstName = firstTurn === 0 ? app.myPlayerName : app._localName2;
    app.coinFlipFirstTurn = firstTurn;
    showCoinFlipResult(result, guess, correct, firstName, () => {
      startCharSelect();
    });
    return;
  }

  // P2P 客机模式
  if (app.mode === 'p2p_guest') {
    send('coin_guess', { guess });
    const dom = getDom();
    dom.coinflipButtons.classList.add('hidden');
    dom.coinflipWaiting.classList.remove('hidden');
    dom.coinflipSubtitle.textContent = '等待对方抛硬币…';
  }
}

// ============================================================
//  角色选择
// ============================================================

function startCharSelect() {
  showScreen('charselect');
  renderCharSelect();
  app.myCharacterId = null;
  app.myCharacterLocked = false;
  app.opponentCharacterLocked = false;
  app._localChar1 = null;
  if (app.mode === 'p2p_host') app.opponentCharacterId = null;
}

function onConfirmCharSelect() {
  const selectedEl = document.querySelector('.char-card.selected');
  if (!selectedEl) { showToast('请先选择一个角色'); return; }
  app.myCharacterId = selectedEl.dataset.charId;
  app.myCharacterLocked = true;

  // 显示锁定状态
  setCharLocked(app.myCharacterId);
  showToast('角色已锁定，等待对手…', 2000);

  if (app.mode === 'p2p_host') {
    send('char_locked', { characterId: app.myCharacterId, playerName: app.myPlayerName });
    tryStartP2PGame();
  } else if (app.mode === 'p2p_guest') {
    send('char_locked', { characterId: app.myCharacterId, playerName: app.myPlayerName });
    getDom().charselectWaiting.classList.remove('hidden');
    // 如果房主已经锁定，等待 game_start 即可
    if (app.opponentCharacterLocked) {
      getDom().charselectWaiting.textContent = '双方均已锁定，等待房主开始…';
    }
  } else if (app.mode === 'local') {
    if (!app._localChar1) {
      // 玩家1锁定 → 切换给玩家2
      app._localChar1 = app.myCharacterId;
      showSwitchOverlay(app._localName2, () => {
        app.myPlayerIndex = 1;
        app.myCharacterId = null;
        app.myCharacterLocked = false;
        renderCharSelect();
        showToast(`${app._localName2}，请选择并锁定角色`, 2500);
      });
    } else {
      // 玩家2锁定 → 开战
      startLocalGameWithChars(app._localChar1, app.myCharacterId);
    }
  }
}

// ============================================================
//  游戏启动
// ============================================================

/** 房主：确认双方都锁定角色后启动 */
function tryStartP2PGame() {
  if (!app.myCharacterLocked || !app.opponentCharacterLocked) return;
  if (!app.myCharacterId || !app.opponentCharacterId) return;

  const p1 = createPlayer(generateId(), app.myPlayerName, app.myCharacterId);
  const p2 = createPlayer(generateId(), app.opponentName || '对手', app.opponentCharacterId);

  app.gameState = createGameState(p1, p2);
  app.gameState.currentTurn = app.coinFlipFirstTurn;
  app.myPlayerIndex = 0;
  app.myPlayerId = p1.id;
  setRoomCode(app.p2pRoomCode || 'P2P');

  showScreen('game');
  renderGameState(app.gameState, 0);
  startLocalTimer();
  const firstName = app.gameState.players[app.coinFlipFirstTurn]?.name || '';
  showToast(`游戏开始！${firstName} 先手`, 2000);

  send('game_start', {
    yourIndex: 1,
    gameState: sanitizeGameState(app.gameState),
    opponentName: p1.name,
  });
}

/** 本地模式：双方选定角色后启动游戏 */
function startLocalGameWithChars(charId1, charId2) {
  const firstTurn = app.coinFlipFirstTurn;
  const p1 = createPlayer(generateId(), app.myPlayerName, charId1);
  const p2 = createPlayer(generateId(), app._localName2, charId2);

  app.gameState = createGameState(p1, p2);
  app.gameState.currentTurn = firstTurn;
  app.myPlayerIndex = firstTurn;
  setRoomCode('本地');
  showScreen('game');
  renderGameState(app.gameState, app.myPlayerIndex);
  startLocalTimer();
  showToast(`${app.gameState.players[firstTurn]?.name} 先手！拖拽数字开始操作`, 2500);
}

// ============================================================
//  拖拽回调
// ============================================================

function handleDragDrop(numIndex, dropTargetType, targetNumIdx) {
  const gs = app.gameState;
  if (!gs || gs.phase !== 'playing') return;

  // 只在轮到自己时响应
  if (gs.currentTurn !== app.myPlayerIndex) {
    showToast('不是你的回合');
    return;
  }

  // P2P 联机模式
  if (app.mode === 'p2p_host' || app.mode === 'p2p_guest') {
    handleDragDropOnline(numIndex, dropTargetType, targetNumIdx);
    return;
  }

  // 本地模式
  handleDragDropLocal(numIndex, dropTargetType, targetNumIdx);
}

function handleDragDropLocal(numIndex, dropTargetType, targetNumIdx) {
  const gs = app.gameState;
  const result = resolveDragAction(gs.players[app.myPlayerIndex], numIndex, dropTargetType, targetNumIdx);
  if (result.error) { showToast(result.error); return; }

  let opResult;
  if (result.action === 'add') {
    opResult = doAdd(gs, app.myPlayerIndex, result.params.myNumIdx, result.params.targetNumIdx);
  } else if (result.action === 'skill') {
    opResult = useSkill(gs, app.myPlayerIndex, result.params.myNumIdx, result.params.targetNumIdx);
  } else { return; }

  if (opResult.error) { showToast(opResult.error); return; }

  if (result.action === 'skill') showDragSkillEffect(gs, result.params);
  applyActionResult(opResult, { tail: 'checkTurn' });
}

function handleDragDropOnline(numIndex, dropTargetType, targetNumIdx) {
  const gs = app.gameState;
  const player = gs.players[app.myPlayerIndex];
  const result = resolveDragAction(player, numIndex, dropTargetType, targetNumIdx);
  if (result.error) { showToast(result.error); return; }

  if (app.mode === 'p2p_host') {
    executeHostAction(result);
  } else if (app.mode === 'p2p_guest') {
    if (result.action === 'add') {
      send('do_add', { myNumIdx: result.params.myNumIdx, targetNumIdx: result.params.targetNumIdx });
    } else if (result.action === 'skill') {
      send('use_skill', { myNumIdx: result.params.myNumIdx, targetNumIdx: result.params.targetNumIdx });
    }
  }
}

/** 房主执行自己的操作并广播 */
function executeHostAction(dragResult) {
  const gs = app.gameState;
  let opResult;
  if (dragResult.action === 'add') {
    opResult = doAdd(gs, app.myPlayerIndex, dragResult.params.myNumIdx, dragResult.params.targetNumIdx);
  } else if (dragResult.action === 'skill') {
    opResult = useSkill(gs, app.myPlayerIndex, dragResult.params.myNumIdx, dragResult.params.targetNumIdx);
  } else { return; }

  if (opResult.error) { showToast(opResult.error); return; }

  if (dragResult.action === 'skill') showDragSkillEffect(gs, dragResult.params);
  applyActionResult(opResult, { broadcast: true, tail: 'resetTimer' });
}

// ============================================================
//  组合技
// ============================================================

function handleCombo() {
  const gs = app.gameState;
  if (!gs || gs.phase !== 'playing') return;
  if (gs.currentTurn !== app.myPlayerIndex) { showToast('不是你的回合'); return; }

  if (app.mode === 'p2p_guest') { send('use_combo', {}); return; }

  const broadcast = app.mode === 'p2p_host';
  const combo = getComboAvailable(gs.players[app.myPlayerIndex]);
  const result = useCombo(gs, app.myPlayerIndex);
  if (result.error) { showToast(result.error); return; }

  if (combo) showComboEffect(combo, getDom().opponentAvatar, getDom().myAvatar);
  applyActionResult(result, { broadcast, tail: broadcast ? 'resetTimer' : 'checkTurn' });
}

// ============================================================
//  回合管理
// ============================================================

function handleEndTurn() {
  const gs = app.gameState;
  if (!gs || gs.phase !== 'playing') return;
  if (gs.currentTurn !== app.myPlayerIndex) { showToast('不是你的回合'); return; }

  if (app.mode === 'p2p_guest') { send('end_turn', {}); return; }

  const broadcast = app.mode === 'p2p_host';
  const result = endTurn(gs, app.myPlayerIndex);
  if (result.error) { showToast(result.error); return; }
  app.gameState = result.newState;
  renderGameState(app.gameState, app.myPlayerIndex);
  showToast('回合结束');
  if (broadcast) send('state_update', { gameState: sanitizeGameState(app.gameState) });
  if (broadcast) resetLocalTimerDisplay();
  else checkLocalTurnSwitch();
}

function handleSurrender() {
  const gs = app.gameState;
  if (!gs || gs.phase !== 'playing') return;
  if (!confirm('确定要投降吗？')) return;

  if (app.mode === 'p2p_guest') { send('surrender', {}); return; }

  const broadcast = app.mode === 'p2p_host';
  const result = surrender(gs, app.myPlayerIndex);
  if (result.error) { showToast(result.error); return; }
  stopLocalTimer();
  applyActionResult(result, { broadcast, tail: null });
}

function checkLocalTurnSwitch() {
  const gs = app.gameState;
  if (gs && gs.currentTurn !== app.myPlayerIndex) {
    handleLocalTurnSwitch();
  }
}

function handleLocalTurnSwitch() {
  stopLocalTimer();
  const nextPlayer = app.gameState.players[app.gameState.currentTurn];

  showSwitchOverlay(nextPlayer.name, () => {
    app.myPlayerIndex = app.gameState.currentTurn;
    renderGameState(app.gameState, app.myPlayerIndex);
    startLocalTimer();
    showToast(`轮到 ${nextPlayer.name}`, 1500);
  });
}

function showSwitchOverlay(playerName, onConfirm) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:500;
    background:rgba(0,0,0,0.65);
    display:flex;align-items:center;justify-content:center;
    backdrop-filter:blur(6px);
  `;
  overlay.innerHTML = `
    <div style="background:#FFF;border-radius:20px;padding:36px 28px;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,0.15);">
      <p style="font-size:15px;color:#636E72;margin:0 0 8px;">请将设备交给</p>
      <p style="font-size:26px;font-weight:800;color:#2D3436;margin:0 0 24px;">${playerName}</p>
      <button class="btn btn-primary" style="width:100%;">👆 准备好了</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('.btn').addEventListener('click', () => {
    document.body.removeChild(overlay);
    onConfirm();
  });
}

// ============================================================
//  计时器（本地模式）
// ============================================================

function startLocalTimer() {
  stopLocalTimer();
  app.turnSecondsLeft = 30;
  updateTimer(app.turnSecondsLeft);
  app.turnTimer = setInterval(() => {
    app.turnSecondsLeft--;
    updateTimer(app.turnSecondsLeft);
    if (app.turnSecondsLeft <= 0) {
      stopLocalTimer();
      handleTurnTimeout();
    }
  }, 1000);
}

function stopLocalTimer() {
  if (app.turnTimer) { clearInterval(app.turnTimer); app.turnTimer = null; }
}

function resetLocalTimerDisplay() {
  app.turnSecondsLeft = 30;
  updateTimer(app.turnSecondsLeft);
}

function handleTurnTimeout() {
  showToast('⏰ 时间到！回合自动结束', 2000);
  const gs = app.gameState;
  if (!gs || gs.phase !== 'playing') return;

  if (app.mode === 'p2p_guest') { send('end_turn', {}); return; }

  const broadcast = app.mode === 'p2p_host';
  const result = endTurn(gs, app.myPlayerIndex);
  if (result.newState) {
    app.gameState = result.newState;
    renderGameState(app.gameState, app.myPlayerIndex);
    if (broadcast) send('state_update', { gameState: sanitizeGameState(app.gameState) });
    if (broadcast) resetLocalTimerDisplay();
    else checkLocalTurnSwitch();
  }
}

// ============================================================
//  再来一局 / 大厅
// ============================================================

/** 收到再来一局请求：弹窗询问 */
function handleRematchRequest() {
  const accepted = confirm('对手请求再来一局！是否同意？');
  if (accepted) {
    send('rematch_accept', {});
    if (app.mode === 'p2p_host') {
      startP2PRematchGame();
    }
  } else {
    send('rematch_decline', {});
    backToLobby();
  }
}

/** 收到再来一局同意：房主建新局 */
function handleRematchAccept() {
  showToast('对手同意了！再来一局', 1500);
  if (app.mode === 'p2p_host') {
    startP2PRematchGame();
  }
}

/** 房主：用已锁定的角色信息创建新一局，轮换先手 */
function startP2PRematchGame() {
  const p1 = createPlayer(generateId(), app.myPlayerName, app.myCharacterId);
  const oppName = app.opponentName || '对手';
  const p2 = createPlayer(generateId(), oppName, app.opponentCharacterId);

  app.gameState = createGameState(p1, p2);
  app.coinFlipFirstTurn = app.coinFlipFirstTurn === 0 ? 1 : 0;
  app.gameState.currentTurn = app.coinFlipFirstTurn;
  app.myPlayerIndex = 0;
  app.myPlayerId = p1.id;

  showScreen('game');
  renderGameState(app.gameState, 0);
  startLocalTimer();
  const firstName = app.gameState.players[app.coinFlipFirstTurn]?.name || '';
  showToast(`再来一局！${firstName} 先手`, 2000);

  send('game_start', {
    yourIndex: 1,
    gameState: sanitizeGameState(app.gameState),
    opponentName: p1.name,
  });
}

function onRematch() {
  if (app.mode === 'p2p_host' || app.mode === 'p2p_guest') {
    send('rematch_request', {});
    showToast('已发送再来一局请求，等待对手回应…', 3000);
    const dom = getDom();
    if (dom.btnRematch) dom.btnRematch.disabled = true;
    return;
  }

  const gs = app.gameState;
  if (!gs) return;
  const p1 = createPlayer(gs.players[0].id, gs.players[0].name, gs.players[0].characterId);
  const p2 = createPlayer(gs.players[1].id, gs.players[1].name, gs.players[1].characterId);
  const firstTurn = gs.winner === 1 ? 0 : 1;
  const newState = createGameState(p1, p2);
  newState.currentTurn = firstTurn;
  app.gameState = newState;
  app.myPlayerIndex = firstTurn;
  showScreen('game');
  renderGameState(app.gameState, app.myPlayerIndex);
  startLocalTimer();
  showToast(`${newState.players[firstTurn].name} 先手！`);
}

function backToLobby() {
  stopLocalTimer();
  if ((app.mode === 'p2p_host' || app.mode === 'p2p_guest') && app.gameState) {
    send('player_left', {});
  }
  p2pDisconnect();
  app.gameState = null;
  app.mode = 'local';
  app.myPlayerIndex = 0;
  app.myPlayerId = null;
  app.myPlayerName = '';
  app.p2pRoomCode = '';
  app.myCharacterLocked = false;
  app.opponentCharacterLocked = false;
  app.opponentName = '';
  app._localChar1 = null;
  showScreen('lobby');
}

// ============================================================
//  启动
// ============================================================
init();
