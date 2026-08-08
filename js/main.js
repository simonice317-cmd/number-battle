/**
 * main.js — 应用入口 & 状态管理
 *
 * 支持三种模式:
 *   'local'    — 同屏双人对战
 *   'p2p_host' — P2P 房主（WebRTC 直连）
 *   'p2p_guest'— P2P 客机（WebRTC 直连）
 */

import {
  createPlayer, createGameState,
  doAdd, useSkill, endTurn, surrender, resolveDragAction,
  generateId,
} from './game-core.js';

import {
  initDomRefs, showScreen, renderGameState,
  updateTimer, setRoomCode, showToast, showResult,
  getDom,
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

/** 本地对战 — 直接开始，不需要服务器 */
function onLocalPlay() {
  startLocalGame(getNickname());
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
        // 双方都连接后，房主启动游戏
        if (app.mode === 'p2p_host') {
          startP2PGameAsHost();
        }
        // 客机等待房主发来 game_start
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
    // ---- 客机收到 ----
    case 'game_start':
      if (app.mode === 'p2p_guest') {
        app.myPlayerIndex = payload.yourIndex;
        app.gameState = rebuildGameState(payload.gameState);
        setRoomCode('P2P');
        showScreen('game');
        renderGameState(app.gameState, app.myPlayerIndex);
        app.turnSecondsLeft = 30;
        startLocalTimer();
        showToast('游戏开始！');
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
      result = useSkill(gs, 1, payload.myNumIdx);
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
      numbers: p.numbers.map(n => ({ value: n.value, skillReady: n.skillReady })),
    })),
    currentTurn: s.currentTurn,
    phase: s.phase,
    turnActionsUsed: s.turnActionsUsed,
    additionsUsed: s.additionsUsed || 0,
    winner: s.winner,
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
      numbers: p.numbers.map(n => ({ value: n.value, skillReady: n.skillReady })),
    })),
    currentTurn: gs.currentTurn,
    phase: gs.phase,
    turnActionsUsed: gs.turnActionsUsed,
    additionsUsed: gs.additionsUsed || 0,
    winner: gs.winner,
  };
}

/** 房主：启动 P2P 游戏 */
function startP2PGameAsHost() {
  const p1 = createPlayer(generateId(), app.myPlayerName, 'basic');
  const p2 = createPlayer(generateId(), '对手', 'basic');

  app.gameState = createGameState(p1, p2);
  app.myPlayerIndex = 0;
  app.myPlayerId = p1.id;
  setRoomCode(app.p2pRoomCode || 'P2P');

  showScreen('game');
  renderGameState(app.gameState, 0);
  startLocalTimer();
  showToast(`游戏开始！${p1.name} 先手`, 2000);

  // 发送初始状态给客机
  send('game_start', {
    yourIndex: 1,
    gameState: sanitizeGameState(app.gameState),
    opponentName: p1.name,
  });
}

// ============================================================
//  本地对战
// ============================================================

function startLocalGame(name1, name2 = '玩家2') {
  app.mode = 'local';
  const p1 = createPlayer(generateId(), name1, 'basic');
  const p2 = createPlayer(generateId(), name2, 'basic');

  app.gameState = createGameState(p1, p2);
  app.myPlayerIndex = 0;
  setRoomCode('本地');
  showScreen('game');
  renderGameState(app.gameState, app.myPlayerIndex);
  startLocalTimer();
  showToast(`${p1.name} 先手！拖拽数字开始操作`, 2500);
}

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
    opResult = useSkill(gs, app.myPlayerIndex, result.params.myNumIdx);
  } else { return; }

  if (opResult.error) { showToast(opResult.error); return; }

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
      send('use_skill', { myNumIdx: result.params.myNumIdx });
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
    opResult = useSkill(gs, app.myPlayerIndex, dragResult.params.myNumIdx);
  } else { return; }

  if (opResult.error) { showToast(opResult.error); return; }

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
