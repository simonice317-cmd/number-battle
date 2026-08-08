/**
 * p2p.js — WebRTC P2P 直连模块
 *
 * 无需服务器：一方生成"连接码"（SDP offer），另一方粘贴后生成"确认码"（SDP answer）回传。
 * 连接建立后通过 DataChannel 通信，游戏数据点对点直传。
 *
 * 信令流程（手动复制粘贴，共 2 轮）：
 *   房主 ──连接码──→ 客机    （第 1 轮）
 *   房主 ←──确认码── 客机    （第 2 轮）
 */

// STUN 服务器：用于 NAT 穿透（含国内友好地址）
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.qq.com:3478' },
    { urls: 'stun:stun.miwifi.com:3478' },
  ]
};

let pc = null;           // RTCPeerConnection
let dc = null;           // DataChannel
let msgHandler = null;   // (msg) => void
let statusHandler = null; // (status, data) => void
let iceTimeout = null;

// ============================================================
//  内部函数
// ============================================================

/** 等待 ICE 候选收集完成（超时兜底 8 秒） */
function waitForIceComplete(connection, timeout = 8000) {
  return new Promise((resolve) => {
    const candidates = [];

    const timer = setTimeout(() => {
      resolve(candidates);
    }, timeout);

    connection.onicecandidate = (e) => {
      if (e.candidate) {
        candidates.push({
          candidate: e.candidate.candidate,
          sdpMid: e.candidate.sdpMid,
          sdpMLineIndex: e.candidate.sdpMLineIndex,
        });
      } else {
        clearTimeout(timer);
        resolve(candidates);
      }
    };

    // 双保险：监听 gathering 状态
    connection.onicegatheringstatechange = () => {
      if (connection.iceGatheringState === 'complete') {
        clearTimeout(timer);
        resolve(candidates);
      }
    };
  });
}

/** 编码：SDP + ICE 候选 → 可复制字符串 */
function encodeSession(desc, candidates) {
  return btoa(JSON.stringify({
    v: 1,
    t: desc.type,          // 'offer' | 'answer'
    s: desc.sdp,
    c: candidates,
  }));
}

/** 解码：可复制字符串 → { t, s, c } */
function decodeSession(encoded) {
  try {
    return JSON.parse(atob(encoded.trim()));
  } catch {
    return null;
  }
}

function emitStatus(status, data = {}) {
  if (statusHandler) statusHandler(status, data);
}

function setupDataChannel() {
  dc.onopen = () => {
    emitStatus('connected');
  };

  dc.onclose = () => {
    emitStatus('disconnected');
    if (msgHandler) msgHandler({ type: 'disconnected', payload: {} });
  };

  dc.onmessage = (event) => {
    if (msgHandler) {
      try {
        const msg = JSON.parse(event.data);
        msgHandler(msg);
      } catch { /* ignore malformed */ }
    }
  };

  dc.onerror = () => {
    emitStatus('error');
  };
}

// ============================================================
//  公开 API
// ============================================================

/**
 * 【房主】创建 P2P 连接，生成 offer 连接码
 * @returns {Promise<string>} 连接码（复制发给对方）
 */
export async function hostCreateOffer() {
  cleanup();
  pc = new RTCPeerConnection(RTC_CONFIG);

  // 房主创建数据通道
  dc = pc.createDataChannel('game', {
    ordered: true,
  });
  setupDataChannel();

  // 创建 offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // 等待 ICE 候选
  const candidates = await waitForIceComplete(pc);

  emitStatus('offer_ready');
  return encodeSession(pc.localDescription, candidates);
}

/**
 * 【房主】接收客机的 answer 确认码，完成连接
 * @param {string} encodedAnswer — 客机回传的确认码
 */
export async function hostAcceptAnswer(encodedAnswer) {
  const session = decodeSession(encodedAnswer);
  if (!session || session.t !== 'answer') {
    throw new Error('确认码无效，请检查是否完整复制');
  }

  await pc.setRemoteDescription(
    new RTCSessionDescription({ type: session.t, sdp: session.s })
  );

  if (session.c) {
    for (const c of session.c) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
    }
  }
}

/**
 * 【客机】接收房主 offer，生成 answer 确认码
 * @param {string} encodedOffer — 房主发来的连接码
 * @returns {Promise<string>} 确认码（复制发回给房主）
 */
export async function guestJoin(encodedOffer) {
  cleanup();
  const session = decodeSession(encodedOffer);
  if (!session || session.t !== 'offer') {
    throw new Error('连接码无效，请检查是否完整复制');
  }

  pc = new RTCPeerConnection(RTC_CONFIG);

  // 监听房主创建的数据通道
  pc.ondatachannel = (event) => {
    dc = event.channel;
    setupDataChannel();
  };

  await pc.setRemoteDescription(
    new RTCSessionDescription({ type: session.t, sdp: session.s })
  );

  if (session.c) {
    for (const c of session.c) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
    }
  }

  // 创建 answer
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  const candidates = await waitForIceComplete(pc);

  emitStatus('answer_ready');
  return encodeSession(pc.localDescription, candidates);
}

/** 发送消息到对方 */
export function send(type, payload = {}) {
  if (dc && dc.readyState === 'open') {
    dc.send(JSON.stringify({ type, payload }));
  }
}

/** 注册消息回调 */
export function onMessage(handler) {
  msgHandler = handler;
}

/** 注册状态回调 */
export function onStatus(handler) {
  statusHandler = handler;
}

/** 是否已连接 */
export function isConnected() {
  return dc && dc.readyState === 'open';
}

/** 断开连接并清理 */
export function disconnect() {
  cleanup();
  if (statusHandler) statusHandler('disconnected', {});
}

function cleanup() {
  if (dc) { try { dc.close(); } catch {} dc = null; }
  if (pc) { try { pc.close(); } catch {} pc = null; }
  if (iceTimeout) { clearTimeout(iceTimeout); iceTimeout = null; }
}
