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
    avatar: '基',
    color: '#D59A3C',          // 角色主题色
    skills: {
      // 数字 → { type, target, value, desc }
      // target: 'opponent_number' → 加法（这是默认操作，无需在 skills 中定义）
      // target: 'opponent_body'  → 拖到对方头像
      // target: 'self_body'      → 拖到自己头像
      4: { type: 'damage', target: 'opponent_body', value: 1, desc: '冲拳：造成 1 点伤害' },
      5: { type: 'shield', target: 'self_body', value: 1, desc: '护盾：获得 1 点护盾' },
      8: { type: 'damage', target: 'opponent_body', value: 1, desc: '冲拳：造成 1 点伤害' },
      9: { type: 'heal',   target: 'self_body', value: 1, desc: '圣泉：回复 1 点 HP' },
    }
  },
  paladin: {
    id: 'paladin',
    name: '圣骑士',
    maxHp: 5,
    avatar: '圣',
    color: '#E0655A',
    skills: {
      4: { type: 'damage',        target: 'opponent_body', value: 1, desc: '冲拳：造成 1 点伤害' },
      5: { type: 'shield_strike', target: 'opponent_body', value: 1, desc: '盾击：自身+1护盾并造成1点伤害' },
      6: { type: 'buff',          target: 'self_body',     value: 1, desc: '神圣号角：下次攻击伤害+1（上限1）' },
      8: { type: 'damage',        target: 'opponent_body', value: 1, desc: '冲拳：造成 1 点伤害' },
      9: { type: 'heal',          target: 'self_body',     value: 1, desc: '圣泉：回复 1 点 HP' },
    },
    combo: {
      name: '圣光复苏',
      required: [5, 5],
      effects: [
        { type: 'restore_max_hp', target: 'self_body' },
      ],
      desc: '圣光复苏：将自身生命上限恢复至初始值 5',
    }
  },
  archer: {
    id: 'archer',
    name: '弓箭手',
    maxHp: 3,
    avatar: '弓',
    color: '#7FB069',
    skills: {
      3: { type: 'damage', target: 'opponent_body', value: 1, desc: '快速射击：造成 1 点伤害' },
      4: { type: 'damage', target: 'opponent_body', value: 1, desc: '速射：造成 1 点伤害' },
      5: { type: 'shield', target: 'self_body',     value: 1, desc: '轻甲：获得 1 点护盾' },
      8: { type: 'damage', target: 'opponent_body', value: 1, desc: '速射：造成 1 点伤害' },
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
    maxHp: 2,
    avatar: '盗',
    color: '#6FA8C9',
    skills: {
      4: { type: 'damage',         target: 'opponent_body',   value: 1,   desc: '刺击：造成 1 点伤害' },
      6: { type: 'steal_resource', target: 'opponent_body',   value: 1,   desc: '妙手：偷取对手1点护盾或血量（优先护盾）' },
      7: { type: 'pierce_damage',  target: 'opponent_body',   value: 1,   desc: '重击：无视护盾直接造成1点伤害' },
      8: { type: 'damage',         target: 'opponent_body',   value: 1,   desc: '刺击：造成 1 点伤害' },
      9: { type: 'shield_temp',    target: 'self_body',       value: 1,   desc: '暗影斗篷：获得 1 点临时护盾' },
    },
    combo: {
      name: '暗影突袭',
      required: [8, 7],
      effects: [
        { type: 'break_shield', target: 'opponent_body', value: 1 },
        { type: 'damage',       target: 'opponent_body', value: 1 },
      ],
      desc: '暗影突袭：破除对方1点护盾并造成1点伤害',
    }
  }
};

// ============================================================
//  天赋注册表
// ============================================================

export const TALENTS = {
  heal_2: {
    id: 'heal_2',
    name: '生命恢复',
    icon: '疗',
    desc: '恢复 2 点 HP（不超过当前上限）',
    effect: 'heal_2',
  },
  restore_max: {
    id: 'restore_max',
    name: '上限修复',
    icon: '复',
    desc: '恢复 2 点生命上限（不超过初始上限）',
    effect: 'restore_max',
  },
  hp_lock: {
    id: 'hp_lock',
    name: '绝地求生',
    icon: '锁',
    desc: '一回合内 HP 和上限不会降到 1 以下',
    effect: 'hp_lock',
  },
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
    baseMaxHp: char.maxHp, // 初始生命上限（重伤不可逆减少，圣骑士 combo 可恢复）
    shield: 0,
    damageBuff: 0,  // 攻击强化层数（神圣号角等），上限1，下次攻击消耗
    comboUsed: false, // 组合技使用后锁定，需做加法才能解锁
    talentId: null,   // 本局选择的天赋 ID
    talentUsed: false, // 天赋本局是否已使用
    hpLocked: false,  // hp_lock 天赋效果：HP 不低于 1
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

// ---- 内部工具函数 ----

/** 校验玩家行动合法性（doAdd / useSkill / useCombo 共用） */
function validatePlayerAction(state, playerIndex, opts = {}) {
  if (state.phase !== 'playing') return { error: '游戏未在进行中' };
  if (state.currentTurn !== playerIndex) return { error: '不是你的回合' };
  if (state.turnActionsUsed >= 2) return { error: '本回合操作次数已用完（最多2次）' };
  if (opts.checkAdditions && state.additionsUsed >= 1) return { error: '本回合已经进行过加法' };
  return null;
}

/** deepClone + 提取 player/opponent（doAdd / useSkill / useCombo 共用） */
function prepareActionState(state, playerIndex) {
  const newState = deepClone(state);
  return { newState, player: newState.players[playerIndex], opponent: newState.players[opponentIndex(playerIndex)] };
}

/** 数字值变更后：解锁 combo + 重算 skillReady */
function updateNumberValue(player, numObj, newValue) {
  numObj.value = newValue;
  player.comboUsed = false;
  const char = getCharacter(player);
  numObj.skillReady = char.skills[newValue] !== undefined || char.combo?.required?.includes(newValue);
}

/** 胜利检查并更新状态 */
function applyWinCheck(newState) {
  const winResult = checkWin(newState);
  if (winResult !== null) {
    newState.phase = 'finished';
    newState.winner = winResult;
    newState.winReason = 'hp_depleted';
  }
}

/** 回复 HP（useSkill heal / useCombo heal 共用） */
function applyHeal(target, amount) {
  const healed = Math.min(amount, target.maxHp - target.hp);
  target.hp += healed;
  return healed;
}

/** 消费攻击强化 buff，返回加成值 */
function consumeDamageBuff(source) {
  const bonus = source.damageBuff || 0;
  source.damageBuff = 0;
  return bonus;
}

/** 重伤系统：受到实际 HP 伤害后，永久降低最大生命值（支持0.5步进） */
function applyGrievousWounds(target, actualHpLoss) {
  if (actualHpLoss <= 0) return 0;
  const maxHpLoss = actualHpLoss * 0.5;
  if (maxHpLoss <= 0) return 0;
  target.maxHp = Math.max(0.5, target.maxHp - maxHpLoss);
  target.hp = Math.min(target.hp, target.maxHp);
  return maxHpLoss;
}

/** 行动后：操作数+1，若用满则自动结束回合 */
function finalizeAction(newState) {
  newState.turnActionsUsed += 1;
  if (newState.turnActionsUsed >= 2) switchTurn(newState);
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
  const err = validatePlayerAction(state, playerIndex, { checkAdditions: true });
  if (err) return err;
  const { newState, player, opponent } = prepareActionState(state, playerIndex);

  if (myNumIdx < 0 || myNumIdx >= player.numbers.length) return { error: '无效的数字索引' };
  if (targetNumIdx < 0 || targetNumIdx >= opponent.numbers.length) return { error: '无效的目标数字索引' };

  const myNum = player.numbers[myNumIdx];
  const targetNum = opponent.numbers[targetNumIdx];
  const oldValue = myNum.value;
  const newValue = mod10(oldValue + targetNum.value);

  updateNumberValue(player, myNum, newValue);
  newState.additionsUsed += 1;
  finalizeAction(newState);

  const log = `${player.name} 用数字 ${oldValue} + ${targetNum.value} → ${oldValue} 变为 ${newValue}`;
  return { newState, log };
}

/**
 * 使用技能
 * @param {number} [targetNumIdx] — 可选，偷取数字时需要指定目标数字索引
 */
export function useSkill(state, playerIndex, myNumIdx, targetNumIdx) {
  const err = validatePlayerAction(state, playerIndex);
  if (err) return err;
  const { newState, player, opponent } = prepareActionState(state, playerIndex);

  if (myNumIdx < 0 || myNumIdx >= player.numbers.length) return { error: '无效的数字索引' };

  const num = player.numbers[myNumIdx];
  if (!num.skillReady) return { error: '该数字没有可用技能' };

  const skill = getSkillForNumber(player, num.value);
  if (!skill) return { error: `数字 ${num.value} 没有对应技能` };

  let log = '';

  switch (skill.type) {
    case 'damage':
      log = applyDamage(player, opponent, skill.value, player.name, opponent.name);
      break;
    case 'shield':
    case 'shield_temp':
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
      const healed = applyHeal(player, skill.value);
      log = `${player.name} 回复 ${healed} 点 HP（当前: ${player.hp}/${player.maxHp}）`;
      break;
    }
    case 'pierce_damage': {
      const bonus = consumeDamageBuff(player);
      const totalDmg = skill.value + bonus;
      opponent.hp = Math.max(0, opponent.hp - totalDmg);
      const parts = [];
      if (bonus > 0) parts.push(`强化攻击 +${bonus}`);
      parts.push(`无视护盾造成 ${totalDmg} 点伤害`);
      const gwLost = applyGrievousWounds(opponent, totalDmg);
      if (gwLost > 0) parts.push(`上限-${gwLost}`);
      log = `${player.name} 发动重击！${parts.join('，')}（${opponent.name} HP: ${opponent.hp}/${opponent.maxHp}）`;
      break;
    }
    case 'steal_number': {
      if (targetNumIdx === undefined || targetNumIdx === null) {
        return { error: '偷取需要指定目标数字' };
      }
      if (targetNumIdx < 0 || targetNumIdx >= opponent.numbers.length) {
        return { error: '无效的目标数字索引' };
      }
      const stolenValue = opponent.numbers[targetNumIdx].value;
      const oldValue = num.value;
      updateNumberValue(player, num, stolenValue);
      log = `${player.name} 发动偷取！数字 ${oldValue} → ${stolenValue}（复制对手的 ${stolenValue}）`;
      break;
    }
    case 'steal_resource': {
      if (opponent.shield > 0) {
        opponent.shield -= 1;
        player.shield += 1;
        log = `${player.name} 发动妙手！偷取对手 1 点护盾（自身护盾: ${player.shield}）`;
      } else if (opponent.hp > 0) {
        opponent.hp -= 1;
        applyGrievousWounds(opponent, 1);
        const healed = applyHeal(player, 1);
        log = `${player.name} 发动妙手！偷取对手 1 点血量（自身 HP: ${player.hp}/${player.maxHp}）`;
      } else {
        log = `${player.name} 发动妙手！但对手没有可偷取的资源`;
      }
      break;
    }
    default:
      return { error: `未知技能类型: ${skill.type}` };
  }

  num.skillReady = false;
  finalizeAction(newState);
  applyWinCheck(newState);

  return { newState, log };
}

// ============================================================
//  组合技
// ============================================================

/** 检查玩家是否有可用组合技 */
export function getComboAvailable(player) {
  const char = getCharacter(player);
  if (!char || !char.combo) return null;
  // 用过组合技后锁定，需做一次加法才能再次使用
  if (player.comboUsed) return null;
  const { required } = char.combo;
  // 使用副本逐一匹配，支持重复值（如 [5,5] 需要两个数字都是 5）
  const remaining = [...player.numbers];
  const allPresent = required.every(val => {
    const idx = remaining.findIndex(n => n.value === val);
    if (idx === -1) return false;
    remaining.splice(idx, 1);
    return true;
  });
  if (!allPresent) return null;
  return char.combo;
}

/** 使用组合技 */
export function useCombo(state, playerIndex) {
  const err = validatePlayerAction(state, playerIndex);
  if (err) return err;
  const { newState, player, opponent } = prepareActionState(state, playerIndex);

  const combo = getComboAvailable(player);
  if (!combo) return { error: '组合技条件不满足' };

  const logParts = [`${player.name} 发动 ${combo.name}！`];
  player.comboUsed = true;
  for (const val of combo.required) {
    const num = player.numbers.find(n => n.value === val);
    if (num) num.skillReady = false;
  }

  for (const eff of combo.effects) {
    switch (eff.type) {
      case 'damage':
        logParts.push(applyDamage(player, opponent, eff.value, player.name, opponent.name));
        break;
      case 'heal': {
        const healed = applyHeal(player, eff.value);
        logParts.push(`回复 ${healed} 点 HP（当前: ${player.hp}/${player.maxHp}）`);
        break;
      }
      case 'shield':
        player.shield += eff.value;
        logParts.push(`获得 ${eff.value} 点护盾（当前: ${player.shield}）`);
        break;
      case 'restore_max_hp': {
        const oldMax = player.maxHp;
        player.maxHp = player.baseMaxHp;
        player.hp = Math.min(player.hp, player.maxHp);
        logParts.push(`生命上限恢复 ${oldMax}→${player.maxHp}（当前 HP: ${player.hp}/${player.maxHp}）`);
        break;
      }
      case 'break_shield': {
        if (opponent.shield > 0) {
          const broken = Math.min(opponent.shield, eff.value);
          opponent.shield -= broken;
          logParts.push(`破除对手 ${broken} 点护盾`);
        }
        break;
      }
    }
  }

  finalizeAction(newState);
  applyWinCheck(newState);

  return { newState, log: logParts.join(' ') };
}

/**
 * 使用天赋：一次性、不消耗行动次数
 * @returns {{ newState, log }} 或 { error }
 */
export function useTalent(state, playerIndex) {
  if (state.phase !== 'playing') return { error: '游戏未在进行中' };
  if (state.currentTurn !== playerIndex) return { error: '不是你的回合' };

  const newState = deepClone(state);
  const player = newState.players[playerIndex];

  if (!player.talentId) return { error: '未选择天赋' };
  if (player.talentUsed) return { error: '天赋已在本局使用过' };

  const talent = TALENTS[player.talentId];
  if (!talent) return { error: '未知天赋' };

  let log = '';
  player.talentUsed = true;

  switch (talent.effect) {
    case 'heal_2': {
      const healed = applyHeal(player, 2);
      log = `${player.name} 使用天赋「${talent.name}」！回复 ${healed} 点 HP（当前: ${player.hp}/${player.maxHp}）`;
      break;
    }
    case 'restore_max': {
      const oldMax = player.maxHp;
      player.maxHp = Math.min(player.baseMaxHp, player.maxHp + 2);
      player.hp = Math.min(player.hp, player.maxHp);
      const restored = player.maxHp - oldMax;
      log = `${player.name} 使用天赋「${talent.name}」！生命上限恢复 ${restored} 点（${oldMax}→${player.maxHp}，HP: ${player.hp}/${player.maxHp}）`;
      break;
    }
    case 'hp_lock': {
      player.hpLocked = true;
      log = `${player.name} 使用天赋「${talent.name}」！本回合 HP 和上限不会降到 1 以下`;
      break;
    }
    default:
      player.talentUsed = false;
      return { error: `未知天赋效果: ${talent.effect}` };
  }

  // 不调用 finalizeAction — 天赋不消耗行动次数
  // 不自动切换回合 — 玩家还可以继续操作

  return { newState, log };
}

// ============================================================
//  伤害计算
// ============================================================
function applyDamage(source, target, damage, sourceName, targetName) {
  const bonus = consumeDamageBuff(source);
  let remaining = damage + bonus;
  let logParts = [];

  if (bonus > 0) logParts.push(`强化攻击 +${bonus}`);

  if (target.shield > 0) {
    const blocked = Math.min(target.shield, remaining);
    target.shield -= blocked;
    remaining -= blocked;
    logParts.push(`护盾抵消 ${blocked} 点`);
  }

  if (remaining > 0) {
    if (target.hpLocked) {
      // hp_lock 天赋：HP 和上限最低为 1
      target.hp = Math.max(1, target.hp - remaining);
      target.maxHp = Math.max(1, target.maxHp);
      logParts.push(`造成 ${remaining} 点伤害（锁血保护，HP不低于1）`);
    } else {
      target.hp = Math.max(0, target.hp - remaining);
      logParts.push(`造成 ${remaining} 点伤害`);
      // 重伤系统：实际扣血后永久降低上限
      const gwLost = applyGrievousWounds(target, remaining);
      if (gwLost > 0) logParts.push(`上限-${gwLost}`);
    }
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
  // 护盾过期：新回合开始时，清除当前玩家的未消耗护盾
  const incoming = state.players[state.currentTurn];
  if (incoming.shield > 0) {
    incoming.shield = 0;
  }
  // hp_lock 天赋到期：新回合开始时清除锁血效果
  if (incoming.hpLocked) {
    incoming.hpLocked = false;
  }
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
