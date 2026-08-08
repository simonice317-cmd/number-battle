/**
 * p2p.js — WebRTC P2P 联机（PeerJS 信令）
 *
 * 使用 PeerJS 免费云信令服务器 (0.peerjs.com) 自动交换 SDP/ICE。
 * 你只需把 4 位房间号发给朋友，无需复制粘贴。
 */

// PeerJS 信令 + ICE 配置
// STUN 服务器：优先用国内可访问的（QQ 腾讯 + 小米），Google 作备用
const ICE_SERVERS = [
  { urls: 'stun:stun.qq.com:3478' },
  { urls: 'stun:stun.miwifi.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
];

const PEER_CONFIG = {
  host: '0.peerjs.com',
  port: 443,
  secure: true,
  debug: 0,
  config: { iceServers: ICE_SERVERS },
};

let peer = null;        // PeerJS 实例
let conn = null;        // DataConnection
let msgHandler = null;
let statusHandler = null;

// ============================================================
//  工具
// ============================================================

function genRoomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function emitStatus(s, data = {}) {
  if (statusHandler) statusHandler(s, data);
}

// ============================================================
//  DataConnection 设置
// ============================================================

function setupConnection(c) {
  conn = c;

  conn.on('open', () => {
    emitStatus('connected');
  });

  conn.on('data', (data) => {
    if (msgHandler) {
      try {
        // PeerJS data 可能是字符串或对象
        const msg = typeof data === 'string' ? JSON.parse(data) : data;
        msgHandler(msg);
      } catch {}
    }
  });

  conn.on('close', () => {
    emitStatus('disconnected');
    if (msgHandler) msgHandler({ type: 'disconnected', payload: {} });
  });

  conn.on('error', () => {
    emitStatus('error');
  });
}

// ============================================================
//  公开 API
// ============================================================

/**
 * 【房主】创建房间
 * @returns {Promise<string>} 4 位房间号
 */
export async function hostCreate() {
  cleanup();

  const code = genRoomCode();
  const peerId = 'nb-' + code;

  return new Promise((resolve, reject) => {
    peer = new Peer(peerId, PEER_CONFIG);

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('信令服务器连接超时，请开启梯子'));
    }, 15000);

    peer.on('open', () => {
      clearTimeout(timer);
      emitStatus('room_created');
      resolve(code);
    });

    peer.on('error', (err) => {
      clearTimeout(timer);
      cleanup();
      let msg = '信令服务错误';
      if (err.type === 'unavailable-id') {
        msg = '房间号已被占用，请重试';
      } else if (err.type === 'network') {
        msg = '网络连接失败，请检查梯子';
      } else if (err.type === 'server-error') {
        msg = '信令服务器错误，请稍后重试';
      }
      reject(new Error(msg));
    });

    // 等待客机连接
    peer.on('connection', (c) => {
      setupConnection(c);
    });
  });
}

/**
 * 【客机】加入房间
 * @param {string} code — 4 位房间号
 */
export async function guestJoin(code) {
  cleanup();

  const hostId = 'nb-' + code;
  const myId = 'nb-g-' + code + '-' + Math.random().toString(36).slice(2, 6);

  return new Promise((resolve, reject) => {
    peer = new Peer(myId, PEER_CONFIG);
    let done = false;

    const timer = setTimeout(() => {
      if (!done) {
        cleanup();
        reject(new Error('未找到该房间，请确认房间号'));
      }
    }, 15000);

    peer.on('open', () => {
      if (done) return;

      const c = peer.connect(hostId, { reliable: true });

      c.on('open', () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        setupConnection(c);
        resolve(code);
      });

      c.on('error', () => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          cleanup();
          reject(new Error('连接失败，房间不存在'));
        }
      });
    });

    peer.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      let msg = '信令服务错误';
      if (err.type === 'peer-unavailable') {
        msg = '未找到该房间';
      } else if (err.type === 'network') {
        msg = '网络连接失败，请检查梯子';
      }
      reject(new Error(msg));
    });
  });
}

/**
 * 【客机】加入房间 — 另一种场景：房主连接客机
 * 当客机先创建 peer 后，房主来连接客机
 * 暂不使用，保留备用
 */
export async function guestJoinWaitForHost(code) {
  cleanup();

  const myId = 'nb-' + code + '-guest';

  return new Promise((resolve, reject) => {
    peer = new Peer(myId, PEER_CONFIG);
    let done = false;

    const timer = setTimeout(() => {
      if (!done) {
        cleanup();
        reject(new Error('等待房主连接超时'));
      }
    }, 30000);

    peer.on('open', () => {
      if (done) return;
    });

    peer.on('connection', (c) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      setupConnection(c);
      resolve(code);
    });

    peer.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error('信令服务错误: ' + (err.message || '未知')));
    });
  });
}

/** 发送消息到对方 */
export function send(type, payload = {}) {
  if (conn && conn.open) {
    conn.send(JSON.stringify({ type, payload }));
  }
}

/** 注册消息回调 */
export function onMessage(handler) { msgHandler = handler; }

/** 注册状态回调 */
export function onStatus(handler) { statusHandler = handler; }

/** 是否已连接 */
export function isConnected() { return conn && conn.open; }

/** 断开连接 */
export function disconnect() {
  if (conn) { try { conn.close(); } catch {} conn = null; }
  if (peer) { try { peer.destroy(); } catch {} peer = null; }
  if (statusHandler) statusHandler('disconnected', {});
}

function cleanup() {
  if (conn) { try { conn.close(); } catch {} conn = null; }
  if (peer) { try { peer.destroy(); } catch {} peer = null; }
}
