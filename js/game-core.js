/**
 * game-core.js — 数字对战游戏纯逻辑层
 *
 * 所有函数都是纯函数（不修改输入，返回新状态），方便测试和复用。
 * 客户端和服务端共享同一份逻辑。
 */

// ============================================================
//  角色注册表（扩展新角色只需在这里添加）
// ============================================================

export const CHARACTERS = {
  basic: {
    id: 'basic',
    name: '基础使者',
    maxHp: 4,
    avatar: '🧙',
    color: '#6C5CE7',          // 角色主题色
    skills: {
      // 数字 → { type, target, value, desc }
      // target: 'opponent_number' → 加法（这是默认操作，无需在 skills 中定义）
      // target: 'opponent_body'  → 拖到对方头像
      // target: 'self_body'      → 拖到自己头像
      4: { type: 'damage', target: 'opponent_body', value: 1, desc: '冲拳：造成 1 点伤害' },
      5: { type: 'shield', target: 'self_body', value: 1, desc: '护盾：获得 1 点护盾' },
      9: { type: 'heal',   target: 'self_body', value: 1, desc: '圣泉：回复 1 点 HP' },
    }
  },
  paladin: {
    id: 'paladin',
    name: '圣骑士',
    maxHp: 5,
    avatar: '🛡️',
    color: '#E17055',
    skills: {
      4: { type: 'damage',        target: 'opponent_body', value: 1, desc: '冲拳：造成 1 点伤害' },
      5: { type: 'shield_strike', target: 'opponent_body', value: 1, desc: '盾击：自身+1护盾并造成1点伤害' },
      6: { type: 'buff',          target: 'self_body',     value: 1, desc: '神圣号角：下次攻击伤害+1（上限1）' },
      9: { type: 'heal',          target: 'self_body',     value: 1, desc: '圣泉：回复 1 点 HP' },
    }
  },
  archer: {
    id: 'archer',
    name: '弓箭手',
    maxHp: 3,
    avatar: '🏹',
    color: '#10B981',
    skills: {
      3: { type: 'damage', target: 'opponent_body', value: 1, desc: '快速射击：造成 1 点伤害' },
      5: { type: 'shield', target: 'self_body',     value: 1, desc: '轻甲：获得 1 点护盾' },
      9: { type: 'heal',   target: 'self_body',     value: 1, desc: '灵药：回复 1 点 HP' },
    },
    combo: {
      name: '万箭齐发',
      required: [3, 6],
      effects: [
        { type: 'damage', target: 'opponent_body', value: 2 },
        { type: 'heal',   target: 'self_body',     value: 1 },
      ],
      desc: '万箭齐发：造成2点伤害并恢复1点血量',
    }
  },
  thief: {
    id: 'thief',
    name: '盗贼',
    maxHp: 4,
    avatar: '🗡️',
    color: '#8B5CF6',
    skills: {
      1: { type: 'steal_number',   target: 'opponent_number', value: null, desc: '偷取：复制对手一个数字的值' },
      4: { type: 'damage',         target: 'opponent_body',   value: 1,   desc: '刺击：造成 1 点伤害' },
      6: { type: 'steal_resource', target: 'opponent_body',   value: 1,   desc: '妙手：偷取对手1点护盾或血量（优先护盾）' },
      7: { type: 'pierce_damage',  target: 'opponent_body',   value: 1,   desc: '重击：无视护盾直接造成1点伤害' },
    }
  }
};

// ============================================================
//  创建初始状态
// ============================================================

export function createPlayer(id, name, characterId = 'basic') {
  const char = CHARACTERS[characterId];
  if (!char) throw new Error(`Unknown character: ${characterId}`);
  return {
    id,
    name,
    characterId,
    hp: char.maxHp,
    maxHp: char.maxHp,
    shield: 0,
    damageBuff: 0,  // 攻击强化层数（神圣号角等），上限1，下次攻击消耗
    numbers: [
      { value: 1, skillReady: false },
      { value: 1, skillReady: false }
    ]
  };
}

export function createGameState(player1, player2) {
  return {
    players: [player1, player2],
    currentTurn: 0,                    // 0 或 1
    phase: 'playing',                  // 'waiting' | 'playing' | 'finished'
    turnActionsUsed: 0,                // 本回合已用操作总数 (0-2)
    additionsUsed: 0,                  // 本回合已用加法次数 (0-1)
    winner: null,                      // null | 0 | 1
    winReason: null,                   // 'hp_depleted' | 'surrender' | 'timeout'
    turnEndsAt: null,                  // 服务器时间戳（联机用）
  };
}

// ============================================================
//  辅助函数
// ============================================================

export function getCharacter(player) {
  return CHARACTERS[player.characterId];
}

export function getSkillForNumber(player, value) {
  const char = getCharacter(player);
  return char.skills[value] || null;
}

/** 对手 index */
export function opponentIndex(playerIndex) {
  return playerIndex === 0 ? 1 : 0;
}

/** 取个位数 */
function mod10(n) {
  return ((n % 10) + 10) % 10;
}

/** 检查数字是否有可用技能 */
export function hasUsableSkill(player, numIndex) {
  const num = player.numbers[numIndex];
  if (!num || !num.skillReady) return false;
  const skill = getSkillForNumber(player, num.value);
  return skill !== null;
}

/** 获取玩家所有可用操作（用于 UI 判断） */
export function getAvailableActions(player) {
  const actions = [];
  // 加法始终可用（只要有数字）
  player.numbers.forEach((num, i) => {
    actions.push({ type: 'add', numIndex: i, value: num.value });
  });
  // 技能
  player.numbers.forEach((num, i) => {
    if (num.skillReady) {
      const skill = getSkillForNumber(player, num.value);
      if (skill) {
        actions.push({ type: 'skill', numIndex: i, value: num.value, skill });
      }
    }
  });
  return actions;
}

// ============================================================
//  核心操作
// ============================================================

/**
 * 执行加法：自己数字 A + 对方数字 B → 自己 A 变成 (A+B)%10
 * @returns {{ newState, log }} 新游戏状态和操作描述
 */
export function doAdd(state, playerIndex, myNumIdx, targetNumIdx) {
  if (state.phase !== 'playing') {
    return { error: '游戏未在进行中' };
  }
  if (state.currentTurn !== playerIndex) {
    return { error: '不是你的回合' };
  }
  if (state.additionsUsed >= 1) {
    return { error: '本回合已经进行过加法' };
  }
  if (state.turnActionsUsed >= 2) {
    return { error: '本回合操作次数已用完（最多2次）' };
  }

  const newState = deepClone(state);
  const player = newState.players[playerIndex];
  const opponent = newState.players[opponentIndex(playerIndex)];

  // 校验数字索引
  if (myNumIdx < 0 || myNumIdx >= player.numbers.length) {
    return { error: '无效的数字索引' };
  }
  if (targetNumIdx < 0 || targetNumIdx >= opponent.numbers.length) {
    return { error: '无效的目标数字索引' };
  }

  const myNum = player.numbers[myNumIdx];
  const targetNum = opponent.numbers[targetNumIdx];

  const oldValue = myNum.value;
  const newValue = mod10(oldValue + targetNum.value);

  // 更新自己的数字
  myNum.value = newValue;

  // 检查新值是否有对应技能 → 设置 skillReady
  // combo.required 中的数字也需要亮（如弓箭手的6），即使没有独立技能
  const char = getCharacter(player);
  const isComboValue = char.combo?.required?.includes(newValue);
  if (char.skills[newValue] !== undefined || isComboValue) {
    myNum.skillReady = true;
  } else {
    myNum.skillReady = false;
  }

  newState.turnActionsUsed += 1;
  newState.additionsUsed += 1;

  const log = `${player.name} 用数字 ${oldValue} + ${targetNum.value} → ${oldValue} 变为 ${newValue}`;

  // 操作总数用满则自动结束回合
  if (newState.turnActionsUsed >= 2) switchTurn(newState);

  return { newState, log };
}

/**
 * 使用技能
 * @param {number} [targetNumIdx] — 可选，偷取数字时需要指定目标数字索引
 */
export function useSkill(state, playerIndex, myNumIdx, targetNumIdx) {
  if (state.phase !== 'playing') {
    return { error: '游戏未在进行中' };
  }
  if (state.currentTurn !== playerIndex) {
    return { error: '不是你的回合' };
  }
  if (state.turnActionsUsed >= 2) {
    return { error: '本回合操作次数已用完（最多2次）' };
  }

  const newState = deepClone(state);
  const player = newState.players[playerIndex];
  const opponent = newState.players[opponentIndex(playerIndex)];

  if (myNumIdx < 0 || myNumIdx >= player.numbers.length) {
    return { error: '无效的数字索引' };
  }

  const num = player.numbers[myNumIdx];
  if (!num.skillReady) {
    return { error: '该数字没有可用技能' };
  }

  const skill = getSkillForNumber(player, num.value);
  if (!skill) {
    return { error: `数字 ${num.value} 没有对应技能` };
  }

  let log = '';

  switch (skill.type) {
    case 'damage':
      log = applyDamage(player, opponent, skill.value, player.name, opponent.name);
      break;
    case 'shield':
      player.shield += skill.value;
      log = `${player.name} 获得 ${skill.value} 点护盾（当前护盾: ${player.shield}）`;
      break;
    case 'shield_strike':
      player.shield += skill.value;
      log = `${player.name} 发动盾击！获得 ${skill.value} 点护盾（当前: ${player.shield}）。`;
      log += ' ' + applyDamage(player, opponent, skill.value, player.name, opponent.name);
      break;
    case 'buff':
      player.damageBuff = Math.min((player.damageBuff || 0) + skill.value, 1);
      log = `${player.name} 吹响神圣号角，下次攻击伤害 +1（当前加成: ${player.damageBuff}）`;
      break;
    case 'heal': {
      const healed = Math.min(skill.value, player.maxHp - player.hp);
      player.hp += healed;
      log = `${player.name} 回复 ${healed} 点 HP（当前: ${player.hp}/${player.maxHp}）`;
      break;
    }
    case 'pierce_damage': {
      // 无视护盾，直接扣血
      const bonus = player.damageBuff || 0;
      player.damageBuff = 0;
      const totalDmg = skill.value + bonus;
      opponent.hp = Math.max(0, opponent.hp - totalDmg);
      const parts = [];
      if (bonus > 0) parts.push(`强化攻击 +${bonus}`);
      parts.push(`无视护盾造成 ${totalDmg} 点伤害`);
      log = `${player.name} 发动重击！${parts.join('，')}（${opponent.name} HP: ${opponent.hp}/${opponent.maxHp}）`;
      break;
    }
    case 'steal_number': {
      // 复制对手数字的值
      if (targetNumIdx === undefined || targetNumIdx === null) {
        return { error: '偷取需要指定目标数字' };
      }
      if (targetNumIdx < 0 || targetNumIdx >= opponent.numbers.length) {
        return { error: '无效的目标数字索引' };
      }
      const stolenValue = opponent.numbers[targetNumIdx].value;
      const oldValue = num.value;
      num.value = stolenValue;
      // 检查新值是否有对应技能（combo.required 中的数字也需要亮）
      const char = getCharacter(player);
      const isComboValue = char.combo?.required?.includes(num.value);
      if (char.skills[num.value] !== undefined || isComboValue) {
        num.skillReady = true;
      } else {
        num.skillReady = false;
      }
      log = `${player.name} 发动偷取！数字 ${oldValue} → ${stolenValue}（复制对手的 ${stolenValue}）`;
      break;
    }
    case 'steal_resource': {
      // 优先偷护盾，没有护盾偷血
      if (opponent.shield > 0) {
        opponent.shield -= 1;
        player.shield += 1;
        log = `${player.name} 发动妙手！偷取对手 1 点护盾（自身护盾: ${player.shield}）`;
      } else if (opponent.hp > 0) {
        opponent.hp -= 1;
        const healed = Math.min(1, player.maxHp - player.hp);
        player.hp += healed;
        log = `${player.name} 发动妙手！偷取对手 1 点血量（自身 HP: ${player.hp}/${player.maxHp}）`;
      } else {
        log = `${player.name} 发动妙手！但对手没有可偷取的资源`;
      }
      break;
    }
    default:
      return { error: `未知技能类型: ${skill.type}` };
  }

  // 消耗技能
  num.skillReady = false;
  newState.turnActionsUsed += 1;

  // 检查胜负
  const winResult = checkWin(newState);
  if (winResult !== null) {
    newState.phase = 'finished';
    newState.winner = winResult;
    newState.winReason = 'hp_depleted';
  }

  // 操作总数用满则自动结束回合
  if (newState.turnActionsUsed >= 2) switchTurn(newState);

  return { newState, log };
}

// ============================================================
//  组合技
// ============================================================

/** 检查玩家是否有可用组合技 */
export function getComboAvailable(player) {
  const char = getCharacter(player);
  if (!char || !char.combo) return null;
  const { required } = char.combo;
  // 只需要所有 required 数字存在，不要求 skillReady（组合技独立于技能使用状态）
  const allPresent = required.every(val => {
    return player.numbers.some(n => n.value === val);
  });
  if (!allPresent) return null;
  return char.combo;
}

/** 使用组合技 */
export function useCombo(state, playerIndex) {
  if (state.phase !== 'playing') {
    return { error: '游戏未在进行中' };
  }
  if (state.currentTurn !== playerIndex) {
    return { error: '不是你的回合' };
  }
  if (state.turnActionsUsed >= 2) {
    return { error: '本回合操作次数已用完（最多2次）' };
  }

  const newState = deepClone(state);
  const player = newState.players[playerIndex];
  const opponent = newState.players[opponentIndex(playerIndex)];

  const combo = getComboAvailable(player);
  if (!combo) {
    return { error: '组合技条件不满足' };
  }

  // 消耗所有 required 数字：重置为 1（组合技消耗数字，需要重新凑）
  const logParts = [`${player.name} 发动 ${combo.name}！`];
  for (const val of combo.required) {
    const num = player.numbers.find(n => n.value === val);
    if (num) {
      num.value = 1;
      num.skillReady = false;
    }
  }

  // 执行所有效果
  for (const eff of combo.effects) {
    switch (eff.type) {
      case 'damage':
        logParts.push(applyDamage(player, opponent, eff.value, player.name, opponent.name));
        break;
      case 'heal': {
        const healed = Math.min(eff.value, player.maxHp - player.hp);
        player.hp += healed;
        logParts.push(`回复 ${healed} 点 HP（当前: ${player.hp}/${player.maxHp}）`);
        break;
      }
      case 'shield':
        player.shield += eff.value;
        logParts.push(`获得 ${eff.value} 点护盾（当前: ${player.shield}）`);
        break;
    }
  }

  newState.turnActionsUsed += 1;

  const log = logParts.join(' ');

  // 检查胜负
  const winResult = checkWin(newState);
  if (winResult !== null) {
    newState.phase = 'finished';
    newState.winner = winResult;
    newState.winReason = 'hp_depleted';
  }

  // 操作总数用满则自动结束回合
  if (newState.turnActionsUsed >= 2) switchTurn(newState);

  return { newState, log };
}

/**
 * 造成伤害，护盾优先吸收
 */
function applyDamage(source, target, damage, sourceName, targetName) {
  // 消费攻击强化
  const bonus = source.damageBuff || 0;
  source.damageBuff = 0;
  let remaining = damage + bonus;
  let logParts = [];

  if (bonus > 0) {
    logParts.push(`强化攻击 +${bonus}`);
  }

  // 先扣护盾
  if (target.shield > 0) {
    const blocked = Math.min(target.shield, remaining);
    target.shield -= blocked;
    remaining -= blocked;
    logParts.push(`护盾抵消 ${blocked} 点`);
  }

  // 再扣血
  if (remaining > 0) {
    target.hp = Math.max(0, target.hp - remaining);
    logParts.push(`造成 ${remaining} 点伤害`);
  }

  return `${sourceName} 发动攻击！${logParts.join('，')}（${targetName} HP: ${target.hp}/${target.maxHp}）`;
}

// ============================================================
//  胜负判定
// ============================================================

function checkWin(state) {
  for (let i = 0; i < state.players.length; i++) {
    if (state.players[i].hp <= 0) {
      return opponentIndex(i);  // 对手获胜
    }
  }
  return null;
}

/** 手动结束回合 */
export function endTurn(state, playerIndex) {
  if (state.currentTurn !== playerIndex) {
    return { error: '不是你的回合' };
  }
  const newState = deepClone(state);
  switchTurn(newState);
  return { newState, log: `${state.players[playerIndex].name} 结束回合` };
}

/** 投降 — 当前玩家认输 */
export function surrender(state, playerIndex) {
  if (state.phase !== 'playing') return { error: '游戏未在进行中' };
  const newState = deepClone(state);
  newState.phase = 'finished';
  newState.winner = opponentIndex(playerIndex);
  newState.winReason = 'surrender';
  return {
    newState,
    log: `${state.players[playerIndex].name} 投降，${state.players[opponentIndex(playerIndex)]?.name || '对方'} 获胜！`
  };
}

function switchTurn(state) {
  state.currentTurn = opponentIndex(state.currentTurn);
  state.turnActionsUsed = 0;
  state.additionsUsed = 0;
}

// ============================================================
//  拖拽目标判定（客户端用）
// ============================================================

/**
 * 根据拖拽落点判断操作类型和参数
 * @param {object} player - 当前玩家
 * @param {number} myNumIdx - 拖出的数字索引
 * @param {string} dropTargetType - 落点类型: 'opponent_number' | 'opponent_body' | 'self_body' | null
 * @param {number} targetNumIdx - 如果落点是对方数字，是哪一个 (0 or 1)
 * @returns {{ action: 'add'|'skill'|null, params, error? }}
 */
export function resolveDragAction(player, myNumIdx, dropTargetType, targetNumIdx) {
  const num = player.numbers[myNumIdx];
  if (!num) return { action: null, error: '无效的数字' };

  switch (dropTargetType) {
    case 'opponent_number': {
      // 优先检查是否有偷取类技能（target = opponent_number）
      if (num.skillReady) {
        const skill = getSkillForNumber(player, num.value);
        if (skill && skill.target === 'opponent_number') {
          if (targetNumIdx === undefined || targetNumIdx === null) {
            return { action: null, error: '未指定目标数字' };
          }
          return { action: 'skill', params: { myNumIdx, targetNumIdx } };
        }
      }
      // 否则是加法
      if (targetNumIdx === undefined || targetNumIdx === null) {
        return { action: null, error: '未指定目标数字' };
      }
      return { action: 'add', params: { myNumIdx, targetNumIdx } };
    }

    case 'opponent_body':
    case 'self_body': {
      // 技能（需要有可用技能且目标匹配）
      if (!num.skillReady) {
        return { action: null, error: '该数字没有可用技能' };
      }
      const skill = getSkillForNumber(player, num.value);
      if (!skill) {
        return { action: null, error: `数字 ${num.value} 没有技能` };
      }
      if (skill.target !== dropTargetType) {
        return { action: null, error: `该技能不能对${dropTargetType === 'opponent_body' ? '自己' : '对方'}使用` };
      }
      return { action: 'skill', params: { myNumIdx } };
    }

    default:
      return { action: null, error: '无效的拖拽目标' };
  }
}

/**
 * 判断一个数字可以被拖到哪些目标
 * @returns {{ canAdd: bool, canSkill: bool, skillTarget: string|null }}
 */
export function getDragTargets(player, myNumIdx) {
  const num = player.numbers[myNumIdx];
  if (!num) return { canAdd: true, canSkill: false, skillTarget: null };

  const result = { canAdd: true, canSkill: false, skillTarget: null };

  if (num.skillReady) {
    const skill = getSkillForNumber(player, num.value);
    if (skill) {
      result.canSkill = true;
      result.skillTarget = skill.target;  // 'opponent_body' | 'self_body' | 'opponent_number'
    }
  }

  return result;
}

// ============================================================
//  工具函数
// ============================================================

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/** 生成简短 ID */
export function generateId() {
  return 'p_' + Math.random().toString(36).slice(2, 10);
}

/** 生成 4 位房间码 */
export function generateRoomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}
