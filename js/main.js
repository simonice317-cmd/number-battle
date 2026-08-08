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
  opponentDisconnected: false,
  p2pRoomCode: '',        // 当前 P2P 房间号

  // 硬币猜测
  p2pPhase: null,         // 'coin_flip' | 'char_select'
  coinFlipFirstTurn: 0,
  _localName2: '玩家2',   // 本地模式对手名字

  // 角色选择
  myCharacterId: null,
  opponentCharacterId: null,
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
}

function bindEvents() {
  const dom = getDom();

  // 大厅
  dom.btnLocal    .addEventListener('click', onLocalPlay);
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

// ============================================================
//  大厅逻辑
// ============================================================

function getNickname() {
  const name = getDom().inputNickname.value.trim();
  return name || '玩家' + (Math.floor(Math.random() * 90) + 10);
}

/** 本地对战 — 先猜硬币，再选角色，然后开始 */
function onLocalPlay() {
  const name = getNickname();
  app.mode = 'local';
  app.myPlayerName = name;
  app.myPlayerIndex = 0;
  app._localName2 = '玩家2';
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
        if (app.gameState && app.gameState.phase === 'playing') {
          showToast('连接断开，游戏终止');
          stopLocalTimer();
          setTimeout(backToLobby, 1500);
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
        const firstName = app.coinFlipFirstTurn === 0 ? app.myPlayerName : '对手';
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
        const firstName = firstTurn === 1 ? app.myPlayerName : '对手';
        showCoinFlipResult(result, guestGuess, correct, firstName, () => {
          app.p2pPhase = 'char_select';
          startCharSelect();
        });
      }
      break;

    // ---- 角色选择 ----
    case 'char_select':
      if (app.mode === 'p2p_host' && app.p2pPhase === 'char_select') {
        app.opponentCharacterId = payload.characterId;
        tryStartP2PGame();
      } else if (app.mode === 'p2p_guest' && app.p2pPhase === 'char_select') {
        app.opponentCharacterId = payload.characterId;
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
          setTimeout(() => showResult(won, getWinMessage(app.gameState, app.myPlayerIndex)), 600);
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

  // 组合技特效（客机使用组合技，房主视角显示）
  if (type === 'use_combo' && gs && result && result.newState) {
    showSkillEffect(getDom().myAvatar, '-2', '#F87171', 'avatar-flash-hit');
    setTimeout(() => showSkillEffect(getDom().opponentAvatar, '+1❤️', '#34D399', 'avatar-flash-heal'), 300);
  }

  // 技能特效（客机使用技能，房主视角显示）
  if (type === 'use_skill' && gs && result && result.newState) {
    const guestNum = gs.players[1].numbers[payload.myNumIdx];
    if (guestNum) {
      const guestChar = CHARACTERS[gs.players[1].characterId];
      const guestSkill = guestChar?.skills[guestNum.value];
      if (guestSkill) {
        if (guestSkill.target === 'opponent_number') {
          // 偷取数字 — 特效目标为房主数字卡片
          const targetCard = getDom()[`myNum${payload.targetNumIdx}`];
          if (targetCard) showSkillEffect(targetCard, '✋被偷', '#8B5CF6', null);
        } else {
          // 客机(index 1)技能 → 'opponent_body'=打房主(host's avatar), 'self_body'=自己(opponent avatar)
          const targetEl = guestSkill.target === 'opponent_body' ? getDom().myAvatar : getDom().opponentAvatar;
          triggerSkillEffect(guestSkill.type, guestSkill.value, targetEl);
        }
      }
    }
  }

  if (result && result.newState) {
    app.gameState = result.newState;
    renderGameState(app.gameState, app.myPlayerIndex);
    if (result.log) showToast(result.log, 2000);

    // 广播新状态给客机
    send('state_update', { gameState: sanitizeGameState(app.gameState) });

    // 检查游戏结束
    if (app.gameState.phase === 'finished') {
      stopLocalTimer();
      const won = app.gameState.winner === app.myPlayerIndex;
      setTimeout(() => showResult(won, getWinMessage(app.gameState, app.myPlayerIndex)), 600);
      return;
    }

    // 检查回合是否切换到房主
    if (app.gameState.currentTurn === app.myPlayerIndex) {
      resetLocalTimerDisplay();
    }
  }
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
      shield: p.shield,
      damageBuff: p.damageBuff || 0,
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
  return {
    players: gs.players.map(p => ({
      id: p.id,
      name: p.name,
      characterId: p.characterId,
      hp: p.hp,
      maxHp: p.maxHp,
      shield: p.shield,
      damageBuff: p.damageBuff || 0,
      numbers: p.numbers.map(n => ({ value: n.value, skillReady: n.skillReady })),
    })),
    currentTurn: gs.currentTurn,
    phase: gs.phase,
    turnActionsUsed: gs.turnActionsUsed,
    additionsUsed: gs.additionsUsed || 0,
    winner: gs.winner,
  };
}

// ============================================================
//  硬币猜测
// ============================================================

/** 根据技能类型显示视觉特效 */
function triggerSkillEffect(skillType, skillValue, targetEl) {
  const effects = {
    damage:         { text: `-${skillValue}`,   color: '#F87171', flash: 'avatar-flash-hit' },
    shield_strike:  { text: `🛡-${skillValue}`, color: '#F87171', flash: 'avatar-flash-hit' },
    shield:         { text: `+${skillValue}🛡`, color: '#22D3EE', flash: 'avatar-flash-shield' },
    heal:           { text: `+${skillValue}❤️`, color: '#34D399', flash: 'avatar-flash-heal' },
    buff:           { text: `⚔+${skillValue}`,  color: '#FBBF24', flash: 'avatar-flash-buff' },
    pierce_damage:  { text: `💀-${skillValue}`, color: '#EF4444', flash: 'avatar-flash-pierce' },
    steal_number:   { text: `✋复制`,           color: '#8B5CF6', flash: 'avatar-flash-steal' },
    steal_resource: { text: `✋偷取`,           color: '#8B5CF6', flash: 'avatar-flash-steal' },
  };
  const eff = effects[skillType];
  if (eff) showSkillEffect(targetEl, eff.text, eff.color, eff.flash);
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
  if (app.mode === 'p2p_host') app.opponentCharacterId = null;
}

function onConfirmCharSelect() {
  const selectedEl = document.querySelector('.char-card.selected');
  if (!selectedEl) { showToast('请先选择一个角色'); return; }
  app.myCharacterId = selectedEl.dataset.charId;

  // 禁用选择
  document.querySelectorAll('.char-card').forEach(c => { c.style.pointerEvents = 'none'; });
  getDom().btnConfirmChar.disabled = true;

  if (app.mode === 'p2p_host') {
    send('char_select', { characterId: app.myCharacterId });
    tryStartP2PGame();
  } else if (app.mode === 'p2p_guest') {
    send('char_select', { characterId: app.myCharacterId });
    getDom().charselectWaiting.classList.remove('hidden');
  } else if (app.mode === 'local') {
    // 本地模式：直接开始游戏
    startLocalGameWithFlip();
  }
}

// ============================================================
//  游戏启动
// ============================================================

/** 房主：确认双方都选了角色后启动 */
function tryStartP2PGame() {
  if (!app.myCharacterId || !app.opponentCharacterId) return;

  const p1 = createPlayer(generateId(), app.myPlayerName, app.myCharacterId);
  const p2 = createPlayer(generateId(), '对手', app.opponentCharacterId);

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

/** 本地模式：猜硬币后启动游戏 */
function startLocalGameWithFlip() {
  const firstTurn = app.coinFlipFirstTurn;
  const charId = app.myCharacterId || 'basic';

  const p1 = createPlayer(generateId(), app.myPlayerName, charId);
  const p2 = createPlayer(generateId(), app._localName2, charId);

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
//  本地对战
// ============================================================

// ============================================================
//  拖拽回调
// ============================================================

function handleDragDrop(numIndex, dropTargetType, targetNumIdx) {
  const gs = app.gameState;
  if (!gs || gs.phase !== 'playing') return;
  if (app.opponentDisconnected) {
    showToast('对手已断线，无法操作');
    return;
  }

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

  // 技能特效
  if (result.action === 'skill') {
    const num = gs.players[app.myPlayerIndex].numbers[result.params.myNumIdx];
    if (num) {
      const char = CHARACTERS[gs.players[app.myPlayerIndex].characterId];
      const skill = char?.skills[num.value];
      if (skill) {
        if (skill.target === 'opponent_number') {
          // 偷取数字 — 特效目标为对手数字卡片
          const targetCard = getDom()[`oppNum${result.params.targetNumIdx}`];
          if (targetCard) showSkillEffect(targetCard, '✋复制', '#8B5CF6', null);
        } else {
          const targetEl = skill.target === 'opponent_body' ? getDom().opponentAvatar : getDom().myAvatar;
          triggerSkillEffect(skill.type, skill.value, targetEl);
        }
      }
    }
  }

  app.gameState = opResult.newState;
  renderGameState(app.gameState, app.myPlayerIndex);
  showToast(opResult.log, 2000);

  if (app.gameState.phase === 'finished') {
    stopLocalTimer();
    const won = app.gameState.winner === app.myPlayerIndex;
    setTimeout(() => showResult(won, getWinMessage(app.gameState, app.myPlayerIndex)), 800);
    return;
  }

  checkLocalTurnSwitch();
}

function handleDragDropOnline(numIndex, dropTargetType, targetNumIdx) {
  const gs = app.gameState;
  if (!gs || gs.phase !== 'playing') return;
  if (gs.currentTurn !== app.myPlayerIndex) {
    showToast('不是你的回合');
    return;
  }

  // 本地快速验证
  const player = gs.players[app.myPlayerIndex];
  const result = resolveDragAction(player, numIndex, dropTargetType, targetNumIdx);
  if (result.error) { showToast(result.error); return; }

  if (app.mode === 'p2p_host') {
    // 房主：本地执行 → 广播状态给客机
    executeHostAction(result);
  } else if (app.mode === 'p2p_guest') {
    // 客机：发送操作给房主验证
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

  // 技能特效（房主执行）
  if (dragResult.action === 'skill') {
    const num = gs.players[app.myPlayerIndex].numbers[dragResult.params.myNumIdx];
    if (num) {
      const char = CHARACTERS[gs.players[app.myPlayerIndex].characterId];
      const skill = char?.skills[num.value];
      if (skill) {
        if (skill.target === 'opponent_number') {
          const targetCard = getDom()[`oppNum${dragResult.params.targetNumIdx}`];
          if (targetCard) showSkillEffect(targetCard, '✋复制', '#8B5CF6', null);
        } else {
          const targetEl = skill.target === 'opponent_body' ? getDom().opponentAvatar : getDom().myAvatar;
          triggerSkillEffect(skill.type, skill.value, targetEl);
        }
      }
    }
  }

  app.gameState = opResult.newState;
  renderGameState(app.gameState, app.myPlayerIndex);
  showToast(opResult.log, 2000);

  if (app.gameState.phase === 'finished') {
    stopLocalTimer();
    const won = app.gameState.winner === app.myPlayerIndex;
    setTimeout(() => showResult(won, getWinMessage(app.gameState, app.myPlayerIndex)), 800);
    send('state_update', { gameState: sanitizeGameState(app.gameState) });
    return;
  }

  // 发送新状态给客机
  send('state_update', { gameState: sanitizeGameState(app.gameState) });

  // 如果回合自动切换了
  if (app.gameState.currentTurn !== app.myPlayerIndex) {
    resetLocalTimerDisplay();
  }
}

// ============================================================
//  组合技
// ============================================================

function handleCombo() {
  const gs = app.gameState;
  if (!gs || gs.phase !== 'playing') return;
  if (gs.currentTurn !== app.myPlayerIndex) {
    showToast('不是你的回合');
    return;
  }

  if (app.mode === 'p2p_guest') {
    send('use_combo', {});
    return;
  }

  if (app.mode === 'p2p_host') {
    executeHostCombo();
    return;
  }

  // 本地模式
  const result = useCombo(gs, app.myPlayerIndex);
  if (result.error) { showToast(result.error); return; }

  // 组合技特效（伤害+治疗双闪）
  showSkillEffect(getDom().opponentAvatar, '-2', '#F87171', 'avatar-flash-hit');
  setTimeout(() => showSkillEffect(getDom().myAvatar, '+1❤️', '#34D399', 'avatar-flash-heal'), 300);

  app.gameState = result.newState;
  renderGameState(app.gameState, app.myPlayerIndex);
  showToast(result.log, 2000);

  if (app.gameState.phase === 'finished') {
    stopLocalTimer();
    const won = app.gameState.winner === app.myPlayerIndex;
    setTimeout(() => showResult(won, getWinMessage(app.gameState, app.myPlayerIndex)), 800);
    return;
  }

  checkLocalTurnSwitch();
}

/** 房主执行组合技并广播 */
function executeHostCombo() {
  const gs = app.gameState;
  const result = useCombo(gs, app.myPlayerIndex);
  if (result.error) { showToast(result.error); return; }

  // 组合技特效
  showSkillEffect(getDom().opponentAvatar, '-2', '#F87171', 'avatar-flash-hit');
  setTimeout(() => showSkillEffect(getDom().myAvatar, '+1❤️', '#34D399', 'avatar-flash-heal'), 300);

  app.gameState = result.newState;
  renderGameState(app.gameState, app.myPlayerIndex);
  showToast(result.log, 2000);

  if (app.gameState.phase === 'finished') {
    stopLocalTimer();
    const won = app.gameState.winner === app.myPlayerIndex;
    setTimeout(() => showResult(won, getWinMessage(app.gameState, app.myPlayerIndex)), 800);
    send('state_update', { gameState: sanitizeGameState(app.gameState) });
    return;
  }

  send('state_update', { gameState: sanitizeGameState(app.gameState) });

  if (app.gameState.currentTurn !== app.myPlayerIndex) {
    resetLocalTimerDisplay();
  }
}

// ============================================================
//  回合管理
// ============================================================

function handleEndTurn() {
  const gs = app.gameState;
  if (!gs || gs.phase !== 'playing') return;
  if (gs.currentTurn !== app.myPlayerIndex) {
    showToast('不是你的回合');
    return;
  }

  if (app.mode === 'p2p_guest') {
    send('end_turn', {});
    return;
  }

  if (app.mode === 'p2p_host') {
    const result = endTurn(gs, app.myPlayerIndex);
    if (result.error) { showToast(result.error); return; }
    app.gameState = result.newState;
    renderGameState(app.gameState, app.myPlayerIndex);
    showToast('回合结束');
    send('state_update', { gameState: sanitizeGameState(app.gameState) });
    resetLocalTimerDisplay();
    return;
  }

  // 本地模式
  const result = endTurn(gs, app.myPlayerIndex);
  if (result.error) { showToast(result.error); return; }
  app.gameState = result.newState;
  renderGameState(app.gameState, app.myPlayerIndex);
  showToast('回合结束');
  checkLocalTurnSwitch();
}

function handleSurrender() {
  const gs = app.gameState;
  if (!gs || gs.phase !== 'playing') return;

  if (!confirm('确定要投降吗？')) return;

  if (app.mode === 'p2p_guest') {
    send('surrender', {});
    return;
  }

  if (app.mode === 'p2p_host') {
    const result = surrender(gs, app.myPlayerIndex);
    if (result.error) { showToast(result.error); return; }
    app.gameState = result.newState;
    stopLocalTimer();
    renderGameState(app.gameState, app.myPlayerIndex);
    showToast(result.log, 2000);
    send('state_update', { gameState: sanitizeGameState(app.gameState) });
    const won = result.newState.winner === app.myPlayerIndex;
    setTimeout(() => showResult(won, getWinMessage(result.newState, app.myPlayerIndex)), 800);
    return;
  }

  // 本地模式
  const result = surrender(gs, app.myPlayerIndex);
  if (result.error) { showToast(result.error); return; }
  app.gameState = result.newState;
  stopLocalTimer();
  renderGameState(app.gameState, app.myPlayerIndex);
  showToast(result.log, 2000);
  const won2 = result.newState.winner === app.myPlayerIndex;
  setTimeout(() => showResult(won2, getWinMessage(result.newState, app.myPlayerIndex)), 800);
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

  if (app.mode === 'p2p_guest') {
    send('end_turn', {});
    return;
  }

  if (app.mode === 'p2p_host') {
    const result = endTurn(gs, app.myPlayerIndex);
    if (result.newState) {
      app.gameState = result.newState;
      renderGameState(app.gameState, app.myPlayerIndex);
      send('state_update', { gameState: sanitizeGameState(app.gameState) });
      resetLocalTimerDisplay();
    }
    return;
  }

  // 本地模式
  const result = endTurn(gs, app.myPlayerIndex);
  if (result.newState) {
    app.gameState = result.newState;
    renderGameState(app.gameState, app.myPlayerIndex);
  }
  checkLocalTurnSwitch();
}

// ============================================================
//  再来一局 / 大厅
// ============================================================

function onRematch() {
  if (app.mode === 'p2p_host' || app.mode === 'p2p_guest') {
    backToLobby();
    return;
  }

  const gs = app.gameState;
  if (!gs) return;
  const p1 = createPlayer(gs.players[0].id, gs.players[0].name, 'basic');
  const p2 = createPlayer(gs.players[1].id, gs.players[1].name, 'basic');
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
  p2pDisconnect();
  app.gameState = null;
  app.mode = 'local';
  app.myPlayerIndex = 0;
  app.myPlayerId = null;
  app.myPlayerName = '';
  app.opponentDisconnected = false;
  app.p2pRoomCode = '';
  showScreen('lobby');
}

// ============================================================
//  启动
// ============================================================
init();
