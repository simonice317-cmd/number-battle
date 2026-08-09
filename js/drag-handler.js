/**
 * drag-handler.js — 拖拽交互处理器
 *
 * 处理触摸/鼠标拖拽数字卡片，绘制抛物线 SVG 箭头，检测落点目标。
 * 不包含游戏逻辑验证，所有验证由 main.js 的 callbacks 完成。
 */

import { getDom } from './ui-render.js';

let dom = null;

// 拖拽运行时状态
let drag = null;
// { numIndex, startX, startY, curX, curY, path: SVGElement, card: Element, lastTarget: Element|null }

// 外部回调
let onDropCb   = null;  // (numIndex, dropTargetType, targetNumIdx) => void
let onCancelCb = null;  // () => void

/**
 * @param {object} opts
 * @param {function} opts.onDrop   — 拖到有效目标时调用
 * @param {function} opts.onCancel — 松手在空白区时调用
 */
export function initDrag(opts = {}) {
  dom = getDom();
  onDropCb   = opts.onDrop || null;
  onCancelCb = opts.onCancel || null;
  bindEvents();
}

// ---- 事件绑定 ----
function bindEvents() {
  document.addEventListener('touchstart', handleStart, { passive: false });
  document.addEventListener('touchmove',  handleMove,  { passive: false });
  document.addEventListener('touchend',   handleEnd);
  document.addEventListener('mousedown',  handleStart);
  document.addEventListener('mousemove',  handleMove);
  document.addEventListener('mouseup',    handleEnd);
}

// ---- 坐标获取 ----
function eventPos(e) {
  if (e.touches && e.touches.length)    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  if (e.changedTouches && e.changedTouches.length) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

// ---- 查找可拖拽元素 ----
function closestDraggable(el) {
  while (el) {
    if (el.dataset && el.dataset.draggable !== undefined) return el;
    el = el.parentElement;
  }
  return null;
}

// ---- 查找落点目标 ----
function closestDropTarget(el) {
  while (el) {
    if (el.dataset && el.dataset.dropTarget) {
      return {
        type:  el.dataset.dropTarget,
        idx:   el.dataset.idx !== undefined ? parseInt(el.dataset.idx) : null,
        el:    el,
      };
    }
    el = el.parentElement;
  }
  return null;
}

// ---- 抛物线箭头路径构建 ----

/** 构建带粗细变化的抛物线箭头 SVG path d 属性 */
function buildArrowD(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 12) return '';

  // 控制点：中点沿法线偏移形成弧线
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  // 单位法线（"右侧"，确保弧线方向一致）
  const nx = -(dy / dist);
  const ny = dx / dist;
  // 弧高：距离越大弧越高，但不超过 60px
  const arcH = Math.min(dist * 0.22, 55);
  const cx = mx + nx * arcH;
  const cy = my + ny * arcH;

  // 在贝塞尔曲线上采样，构建渐变粗细的多边形
  const N = 28;
  const topEdge = [];
  const botEdge = [];

  for (let i = 0; i <= N; i++) {
    const t = i / N;
    // 二次贝塞尔 B(t) = (1-t)²P₀ + 2(1-t)tP₁ + t²P₂
    const bx = (1 - t) ** 2 * x1 + 2 * (1 - t) * t * cx + t * t * x2;
    const by = (1 - t) ** 2 * y1 + 2 * (1 - t) * t * cy + t * t * y2;

    // 切线方向: B'(t) = 2(1-t)(P₁-P₀) + 2t(P₂-P₁)
    const tx = 2 * (1 - t) * (cx - x1) + 2 * t * (x2 - cx);
    const ty = 2 * (1 - t) * (cy - y1) + 2 * t * (y2 - cy);
    const tLen = Math.hypot(tx, ty) || 1;
    const unx = -ty / tLen; // 法线 x
    const uny = tx / tLen;  // 法线 y

    // 粗细：开始 5px → 末尾 1.5px
    const thick = 5 * (1 - t) + 1.5 * t;

    topEdge.push({ x: bx + unx * thick, y: by + uny * thick });
    botEdge.unshift({ x: bx - unx * thick, y: by - uny * thick }); // 反序插入
  }

  // 箭头（在终点）
  const tipTx = 2 * (x2 - cx);
  const tipTy = 2 * (y2 - cy);
  const tipAngle = Math.atan2(tipTy, tipTx);
  const headLen = 14;
  const headW = 6;
  const axL = x2 + Math.cos(tipAngle + Math.PI * 0.82) * headLen;
  const ayL = y2 + Math.sin(tipAngle + Math.PI * 0.82) * headLen;
  const axR = x2 + Math.cos(tipAngle - Math.PI * 0.82) * headLen;
  const ayR = y2 + Math.sin(tipAngle - Math.PI * 0.82) * headLen;

  // 组装完整路径
  let d = `M ${topEdge[0].x.toFixed(1)} ${topEdge[0].y.toFixed(1)}`;
  for (let i = 1; i < topEdge.length; i++) {
    d += ` L ${topEdge[i].x.toFixed(1)} ${topEdge[i].y.toFixed(1)}`;
  }
  // 箭头尖三角
  d += ` L ${axL.toFixed(1)} ${ayL.toFixed(1)} L ${axR.toFixed(1)} ${ayR.toFixed(1)}`;
  // 下边缘（已反序）
  for (const p of botEdge) {
    d += ` L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }
  d += ' Z';

  return d;
}

// ---- 开始拖拽 ----
function handleStart(e) {
  const gameScreen = document.getElementById('screen-game');
  if (!gameScreen || !gameScreen.classList.contains('active')) return;

  const pos = eventPos(e);
  const el  = document.elementFromPoint(pos.x, pos.y);
  const card = closestDraggable(el);
  if (!card) return;

  e.preventDefault();

  const numIndex = parseInt(card.dataset.idx);
  if (isNaN(numIndex)) return;

  const rect = card.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  // 创建 SVG path（替换原来的 line）
  const svg = dom.dragSvg;
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.classList.add('drag-arrow');
  const d = buildArrowD(cx, cy, pos.x, pos.y);
  path.setAttribute('d', d);
  svg.appendChild(path);

  card.classList.add('dragging');

  drag = {
    numIndex,
    startX: cx, startY: cy,
    curX: pos.x, curY: pos.y,
    path,
    card,
    lastTarget: null,
  };
}

// ---- 拖拽中 ----
function handleMove(e) {
  if (!drag) return;
  e.preventDefault();

  const pos = eventPos(e);
  drag.curX = pos.x;
  drag.curY = pos.y;

  // 更新箭头路径
  const d = buildArrowD(drag.startX, drag.startY, pos.x, pos.y);
  drag.path.setAttribute('d', d);

  // 落点检测
  const elBelow = document.elementFromPoint(pos.x, pos.y);
  const target = closestDropTarget(elBelow);

  // 清除上次高亮
  if (drag.lastTarget && drag.lastTarget.el !== (target ? target.el : null)) {
    drag.lastTarget.el.classList.remove('drop-highlight');
    drag.lastTarget = null;
  }

  if (target) {
    target.el.classList.add('drop-highlight');
    drag.lastTarget = target;
    drag.path.classList.remove('invalid');
  } else {
    drag.path.classList.add('invalid');
  }
}

// ---- 松手 ----
function handleEnd(e) {
  if (!drag) return;

  const pos = eventPos(e);
  const elBelow = document.elementFromPoint(pos.x, pos.y);
  const target = closestDropTarget(elBelow);

  // 清理
  if (drag.lastTarget) {
    drag.lastTarget.el.classList.remove('drop-highlight');
  }
  if (drag.path && drag.path.parentNode) {
    drag.path.parentNode.removeChild(drag.path);
  }
  drag.card.classList.remove('dragging');

  const numIndex = drag.numIndex;
  drag = null;

  if (target && onDropCb) {
    onDropCb(numIndex, target.type, target.idx);
  } else if (!target && onCancelCb) {
    onCancelCb();
  }
}
