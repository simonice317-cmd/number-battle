/**
 * drag-handler.js — 拖拽交互处理器
 *
 * 处理触摸/鼠标拖拽数字卡片，绘制 SVG 箭头，检测落点目标。
 * 不包含游戏逻辑验证，所有验证由 main.js 的 callbacks 完成。
 */

import { getDom } from './ui-render.js';

let dom = null;

// 拖拽运行时状态
let drag = null;
// { numIndex, startX, startY, curX, curY, line: SVGElement, card: Element, lastTarget: Element|null }

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

  // 创建 SVG 线
  const svg = dom.dragSvg;
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', cx);
  line.setAttribute('y1', cy);
  line.setAttribute('x2', pos.x);
  line.setAttribute('y2', pos.y);
  svg.appendChild(line);

  card.classList.add('dragging');

  drag = {
    numIndex,
    startX: cx, startY: cy,
    curX: pos.x, curY: pos.y,
    line,
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

  // 更新箭头
  drag.line.setAttribute('x2', pos.x);
  drag.line.setAttribute('y2', pos.y);

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
    drag.line.classList.remove('invalid');
  } else {
    drag.line.classList.add('invalid');
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
  if (drag.line && drag.line.parentNode) {
    drag.line.parentNode.removeChild(drag.line);
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
