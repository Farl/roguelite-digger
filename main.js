import { Game } from './game.js';
import { loadMute, saveMute, loadHintDismissed, saveHintDismissed, loadBestScore, saveBestScore, loadLeaderboard, addLeaderboardEntry } from './storage.js';

const app = document.getElementById('app');

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

// ─── Web Audio Synthesizer ───────────────────────────────────────
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playTone({ freq = 440, type = 'sine', duration = 0.08, gainPeak = 0.18, detune = 0 } = {}) {
  if (muted) return;
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.detune.setValueAtTime(detune, ctx.currentTime);
    gain.gain.setValueAtTime(gainPeak, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (_) {}
}

function sfxDig() {
  playTone({ freq: 220, type: 'triangle', duration: 0.06, gainPeak: 0.12 });
}
function sfxHit() {
  playTone({ freq: 110, type: 'sawtooth', duration: 0.12, gainPeak: 0.22 });
  setTimeout(() => playTone({ freq: 80, type: 'sawtooth', duration: 0.08, gainPeak: 0.12 }), 60);
}
function sfxDiamond() {
  playTone({ freq: 880, type: 'sine', duration: 0.15, gainPeak: 0.18 });
  setTimeout(() => playTone({ freq: 1100, type: 'sine', duration: 0.10, gainPeak: 0.10 }), 80);
}
function sfxEvent() {
  playTone({ freq: 660, type: 'triangle', duration: 0.12, gainPeak: 0.15 });
  setTimeout(() => playTone({ freq: 880, type: 'triangle', duration: 0.10, gainPeak: 0.12 }), 100);
}
function sfxGameOver() {
  playTone({ freq: 220, type: 'sawtooth', duration: 0.18, gainPeak: 0.25 });
  setTimeout(() => playTone({ freq: 165, type: 'sawtooth', duration: 0.20, gainPeak: 0.20 }), 150);
  setTimeout(() => playTone({ freq: 110, type: 'sawtooth', duration: 0.35, gainPeak: 0.18 }), 300);
}
function sfxMilestone() {
  playTone({ freq: 523, type: 'sine', duration: 0.10, gainPeak: 0.20 });
  setTimeout(() => playTone({ freq: 659, type: 'sine', duration: 0.10, gainPeak: 0.18 }), 80);
  setTimeout(() => playTone({ freq: 784, type: 'sine', duration: 0.18, gainPeak: 0.22 }), 160);
}
// ─────────────────────────────────────────────────────────────────

let game;
let state = null;
let prevState = null;
let meta = null;
let relicEffects = null;
let modalRoot = null;
let toolIndicatorTimer = null;
let durabilityPopupTimer = null;
let lastPuzzleCount = null;
let muted = false;
let bestScore = 0;
const MILESTONES = [5, 10, 20, 30, 50, 75, 100, 150, 200];
let lastMilestone = 0;

function showMilestoneToast(depth) {
  if (!modalRoot) return;
  const emojis = depth >= 100 ? '🎆' : depth >= 50 ? '✨' : '🎉';
  const toast = el('div', 'milestone-toast', `${emojis} 深度 ${depth}！`);
  modalRoot.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 250);
  }, 1200);
}

function triggerScrollAnimation() {
  // 動畫移除：保留函式但不做任何事
}

function moveWorkerToSide(side) {
  const worker = document.getElementById('worker');
  if (!worker) return;
  worker.classList.remove('worker-left', 'worker-right');
  if (side === 'left') worker.classList.add('worker-left');
  if (side === 'right') worker.classList.add('worker-right');
}

function dig(side) {
  if (!game || !state || !state.alive || state.inEvent || state.paused) return;

  // 自動挖掘期間，點擊只會改變方向，不會額外手動挖
  if (state.autoDigActive) {
    game.switchAutoSide(side);
    // 自動挖時立即移動小工人
    moveWorkerToSide(side);
    return;
  }

  moveWorkerToSide(side);
  triggerScrollAnimation();
  sfxDig();
  game.step(side);

  // digBounce animation on worker-tool
  const wt = document.querySelector('.worker-tool');
  if (wt) {
    wt.classList.remove('bouncing');
    void wt.offsetWidth; // reflow to restart
    wt.classList.add('bouncing');
    wt.addEventListener('animationend', () => wt.classList.remove('bouncing'), { once: true });
  }

  // 手動挖時，短暫顯示工具位置（已整合到小工人移動，保留函式以避免錯誤）
  showToolIndicatorOnce(side);
}

function showPuzzleGainAnimation(piece, meta) {
  if (!modalRoot) return;

  let text = '獲得拼圖！';
  if (piece && meta && Array.isArray(meta.puzzlePieces)) {
    const { id, size, index } = piece;
    const needed = size === 2 ? 4 : 9;
    const key = `${id}_${size}`;
    const groups = {};
    for (const p of meta.puzzlePieces) {
      const k = `${p.id}_${p.size}`;
      if (!groups[k]) groups[k] = new Set();
      groups[k].add(p.index);
    }
    const uniqueCount = groups[key] ? groups[key].size : 0;
    const humanIndex = (index ?? 0) + 1;
    text = `獲得 拼圖${id}（${size}×${size}）第 ${humanIndex} 片（${uniqueCount}/${needed}）`;
  }

  const toast = el('div', 'puzzle-toast', text);
  modalRoot.appendChild(toast);

  // 先插入再觸發 transition
  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });

  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 200);
  }, 900);
}

function showCollectionModal() {
  if (!modalRoot) return;

  modalRoot.innerHTML = '';
  const backdrop = el('div', 'modal-backdrop');
  backdrop.style.pointerEvents = 'auto';

  const modal = el('div', 'modal');

  const title = el('div', 'modal-title', '收藏一覽');
  const info = el('div', 'center-text');

  const runsText = meta ? `遊戲數：${meta.runs}` : '';
  const bestText = state ? `最佳深度：${state.bestDepth || 0}` : '';
  info.textContent = `${runsText}　${bestText}`;

  const relicSection = el('div');
  relicSection.style.fontSize = '12px';
  relicSection.style.display = 'flex';
  relicSection.style.flexDirection = 'column';
  relicSection.style.gap = '4px';

  const relicTitle = el('div', null, '遺物');
  relicTitle.style.fontWeight = '600';

  const relicList = el('div');
  relicList.style.display = 'flex';
  relicList.style.flexDirection = 'column';
  relicList.style.gap = '2px';

  if (meta && meta.unlockedRelics && meta.unlockedRelics.length > 0) {
    if (meta.unlockedRelics.includes('extra_tool')) {
      relicList.appendChild(el('div', null, '・額外工具：每場開始時 +1 工具耐久'));
    }
    if (meta.unlockedRelics.includes('stone_resist')) {
      relicList.appendChild(el('div', null, '・石頭護符：每場開始時 +1 工具耐久'));
    }
    if (meta.unlockedRelics.includes('survey_aura')) {
      relicList.appendChild(el('div', null, '・探勘磁力：每場開始時，最底兩層危險格自動變泥土'));
    }
  } else {
    relicList.appendChild(el('div', null, '目前還沒有解鎖任何遺物'));
  }

  relicSection.appendChild(relicTitle);
  relicSection.appendChild(relicList);

  const puzzleSection = el('div');
  puzzleSection.style.fontSize = '12px';
  puzzleSection.style.display = 'flex';
  puzzleSection.style.flexDirection = 'column';
  puzzleSection.style.gap = '4px';
  puzzleSection.style.marginTop = '4px';

  const puzzleTitle = el('div', null, '拼圖');
  puzzleTitle.style.fontWeight = '600';

  const puzzleInfo = el('div');

  if (meta && meta.puzzlePieces && meta.puzzlePieces.length > 0) {
    // 依照「同一張拼圖」分組，讓玩家知道自己正在收集哪一張
    const groups = {};
    for (const p of meta.puzzlePieces) {
      const key = `${p.id}_${p.size}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(p.index);
    }

    // 清空文字，用結構化的方式顯示
    puzzleInfo.innerHTML = '';

    const hint = document.createElement('div');
    hint.textContent = '每到 20 層、40 層、60 層… 有機會挖到拼圖。可能會拿到重複的同一片，但只有「不同位置」會計入進度；集滿同一張拼圖就會變成遺物，提供永久效果。';
    hint.style.marginBottom = '4px';
    puzzleInfo.appendChild(hint);

    Object.keys(groups).forEach(key => {
      const [id, sizeStr] = key.split('_');
      const size = Number(sizeStr);
      const uniqueIndexes = new Set(groups[key]);
      const totalNeeded = size === 2 ? 4 : 9;
      const relicName = size === 3
        ? '石頭護符（開局 +1 工具耐久）'
        : id === 'C'
          ? '探勘磁力（最底兩層危險格→泥土）'
          : '額外工具（開局 +1 工具耐久）';

      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.flexDirection = 'column';
      row.style.gap = '2px';
      row.style.marginBottom = '4px';

      const label = document.createElement('div');
      label.textContent = `拼圖 ${id}（${size}×${size}）：${uniqueIndexes.size}/${totalNeeded} 片 → ${relicName}`;
      row.appendChild(label);

      // 視覺化拼圖位置的網格
      const grid = document.createElement('div');
      grid.style.display = 'grid';
      grid.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
      grid.style.gap = '2px';
      grid.style.marginTop = '2px';
      grid.style.maxWidth = '120px';

      for (let i = 0; i < totalNeeded; i++) {
        const cell = document.createElement('div');
        cell.style.borderRadius = '3px';
        cell.style.border = '1px solid rgba(0,0,0,0.2)';
        cell.style.height = '16px';
        cell.style.fontSize = '10px';
        cell.style.display = 'flex';
        cell.style.alignItems = 'center';
        cell.style.justifyContent = 'center';

        const hasPiece = uniqueIndexes.has(i);
        if (hasPiece) {
          cell.style.background = '#b58429';
          cell.style.color = '#fffbe6';
          cell.textContent = (i + 1).toString();
        } else {
          cell.style.background = '#f0e4c4';
          cell.style.color = '#b0a07a';
          cell.textContent = (i + 1).toString();
        }

        grid.appendChild(cell);
      }

      row.appendChild(grid);
      puzzleInfo.appendChild(row);
    });
  } else {
    puzzleInfo.textContent = '目前還沒有拼圖碎片。\n提示：每到 20 層、40 層、60 層… 有機會挖到拼圖；集滿同一張拼圖就會變成遺物，提供永久效果。';
  }

  puzzleSection.appendChild(puzzleTitle);
  puzzleSection.appendChild(puzzleInfo);

  const footer = el('div', 'modal-footer');
  const closeBtn = el('button', 'btn-primary', '關閉');
  closeBtn.onclick = () => {
    modalRoot.innerHTML = '';
  };
  footer.appendChild(closeBtn);

  modal.appendChild(title);
  modal.appendChild(info);
  modal.appendChild(relicSection);
  modal.appendChild(puzzleSection);
  modal.appendChild(footer);

  backdrop.appendChild(modal);
  modalRoot.appendChild(backdrop);
}

function showHelpModal() {
  if (!modalRoot) return;
  modalRoot.innerHTML = '';
  const backdrop = el('div', 'modal-backdrop');
  backdrop.style.pointerEvents = 'auto';
  const modal = el('div', 'modal');
  const title = el('div', 'modal-title', '鍵盤操作');
  const list = el('div', 'shortcut-list');
  const shortcuts = [
    ['A / ←', '挖左側'],
    ['D / →', '挖右側'],
    ['W/S/空格', '沿上次方向挖'],
    ['1 / 2 / 3', '事件時選擇選項（1=左，2=中，3=右）'],
    ['P / Esc', '暫停 / 繼續'],
  ];
  for (const [k, v] of shortcuts) {
    const row = el('div', 'shortcut-row');
    row.appendChild(el('span', 'shortcut-key', k));
    row.appendChild(el('span', null, v));
    list.appendChild(row);
  }
  const footer = el('div', 'modal-footer');
  const closeBtn = el('button', 'btn-primary', '關閉');
  closeBtn.onclick = () => { modalRoot.innerHTML = ''; };
  footer.appendChild(closeBtn);
  modal.appendChild(title);
  modal.appendChild(list);
  modal.appendChild(footer);
  backdrop.appendChild(modal);
  modalRoot.appendChild(backdrop);
}

function renderBase() {
  app.innerHTML = '';
  app.style.position = 'relative';

  const hud = el('div', 'hud');
  const leftSection = el('div', 'hud-section');
  const rightSection = el('div', 'hud-section');
  const centerSection = el('div', 'hud-section');

  const depthBadge = el('div', 'badge');
  depthBadge.innerHTML = `
    <div class="badge-label">深度</div>
    <div class="badge-value" id="depth-val">0</div>
    <div class="badge-meter"><div class="badge-meter-fill" id="depth-meter"></div></div>
  `;
  const toolBadge = el('div', 'badge');
  toolBadge.innerHTML = `
    <div class="badge-label">工具</div>
    <div class="badge-value" id="tool-val">0</div>
    <div class="badge-meter"><div class="badge-meter-fill" id="tool-meter"></div></div>
  `;
  const bestBadge = el('div', 'badge');
  bestBadge.innerHTML = `
    <div class="badge-label">最佳</div>
    <div class="badge-value" id="best-val">0</div>
    <div class="badge-meter"><div class="badge-meter-fill" id="best-meter"></div></div>
  `;

  const relicsWrap = el('div', 'relics');
  relicsWrap.id = 'relics-wrap';

  leftSection.appendChild(depthBadge);
  centerSection.appendChild(toolBadge);
  rightSection.appendChild(bestBadge);
  rightSection.appendChild(relicsWrap);

  hud.appendChild(leftSection);
  hud.appendChild(centerSection);
  hud.appendChild(rightSection);

  const main = el('div', 'main');
  const surface = el('div', 'surface');
  const surfaceLeft = el('div', null, '地面');
  surfaceLeft.id = 'surface-info';
  const surfaceRight = el('div');
  const pauseBtn = el('button', null, '暫停');
  pauseBtn.id = 'pause-btn';
  pauseBtn.onclick = () => {
    if (!game || !state || !state.alive || state.inEvent) return;
    game.togglePause();
  };
  const muteBtn = el('button', null, muted ? '🔇' : '🔊');
  muteBtn.id = 'mute-btn';
  if (muted) muteBtn.classList.add('muted');
  muteBtn.onclick = () => {
    muted = !muted;
    saveMute(muted);
    muteBtn.textContent = muted ? '🔇' : '🔊';
    muteBtn.classList.toggle('muted', muted);
  };
  const resetBtn = el('button', null, '重新開始');
  resetBtn.onclick = () => game.startRun();
  const puzzleBtn = el('button', null, '拼圖');
  puzzleBtn.onclick = () => {
    showCollectionModal();
  };
  const clearBtn = el('button', null, '清除進度');
  clearBtn.onclick = () => {
    if (game && typeof game.clearProgress === 'function') {
      game.clearProgress();
      lastPuzzleCount = null;
    }
  };
  const helpBtn = el('button', null, '？');
  helpBtn.id = 'help-btn';
  helpBtn.onclick = () => showHelpModal();

  surfaceRight.appendChild(pauseBtn);
  surfaceRight.appendChild(muteBtn);
  surfaceRight.appendChild(helpBtn);
  surfaceRight.appendChild(puzzleBtn);
  surfaceRight.appendChild(resetBtn);
  surfaceRight.appendChild(clearBtn);
  surface.appendChild(surfaceLeft);
  surface.appendChild(surfaceRight);

  const digArea = el('div', 'dig-area');
  digArea.id = 'dig-area';
  const hitFlash = el('div', 'hit-flash');
  hitFlash.id = 'hit-flash';
  digArea.appendChild(hitFlash);

  const scene = el('div', 'scene');
  const worker = el('div', 'worker worker-left');
  worker.id = 'worker';
  const workerBody = el('div', 'worker-body');
  const workerTool = el('div', 'worker-tool', '⛏');
  worker.appendChild(workerBody);
  worker.appendChild(workerTool);
  const ground = el('div', 'scene-ground');
  const duraPopup = el('div', 'durability-popup');
  duraPopup.id = 'durability-popup';
  scene.appendChild(worker);
  scene.appendChild(ground);
  scene.appendChild(duraPopup);

  const depthRow = el('div', 'depth-row');
  depthRow.innerHTML = `<span>往下挖地瓜</span><span id="status-text"></span>`;

  const autoDigWrap = el('div', 'autodig-wrap');
  autoDigWrap.innerHTML = `
    <div class="autodig-label" id="autodig-label">自動挖</div>
    <div class="autodig-track"><div class="autodig-fill" id="autodig-fill"></div></div>
    <div class="autodig-time" id="autodig-time">0.0s</div>
  `;

  const tiles = el('div', 'tiles');
  const colL = el('div', 'tile-column');
  const colR = el('div', 'tile-column');
  colL.id = 'col-left';
  colR.id = 'col-right';
  const lblL = el('div', 'column-label', '左');
  const lblR = el('div', 'column-label', '右');
  colL.appendChild(lblL);
  colR.appendChild(lblR);

  const toolL = el('div', 'tool-indicator');
  toolL.id = 'tool-indicator-left';
  toolL.textContent = '⛏';
  const toolR = el('div', 'tool-indicator');
  toolR.id = 'tool-indicator-right';
  toolR.textContent = '⛏';
  colL.appendChild(toolL);
  colR.appendChild(toolR);

  for (let i = 0; i < 5; i++) {
    colL.appendChild(el('div', 'tile-slot empty'));
    colR.appendChild(el('div', 'tile-slot empty'));
  }

  tiles.appendChild(colL);
  tiles.appendChild(colR);

  digArea.appendChild(scene);
  digArea.appendChild(depthRow);
  digArea.appendChild(autoDigWrap);
  digArea.appendChild(tiles);

  const inputOverlay = el('div', 'input-overlay');
  const halfL = el('div', 'input-half input-half-left');
  const halfR = el('div', 'input-half input-half-right');
  const hintL = el('div', 'touch-hint', '左側挖掘');
  const hintR = el('div', 'touch-hint', '右側挖掘');
  halfL.appendChild(hintL);
  halfR.appendChild(hintR);
  halfL.addEventListener('click', () => dig('left'));
  halfR.addEventListener('click', () => dig('right'));
  inputOverlay.appendChild(halfL);
  inputOverlay.appendChild(halfR);
  digArea.appendChild(inputOverlay);

  // first-run hint bar
  if (!loadHintDismissed()) {
    const hintBar = el('div', 'hint-bar');
    hintBar.id = 'hint-bar';
    const hintText = el('div', 'hint-bar-text', '點左半邊挖左、右半邊挖右。鍵盤：A/←挖左，D/→挖右，P暫停。');
    const hintClose = el('button', 'hint-bar-close', '知道了');
    hintClose.onclick = () => {
      saveHintDismissed();
      hintBar.remove();
    };
    hintBar.appendChild(hintText);
    hintBar.appendChild(hintClose);
    digArea.appendChild(hintBar);
  }

  main.appendChild(surface);
  main.appendChild(digArea);

  modalRoot = el('div');
  modalRoot.style.position = 'absolute';
  modalRoot.style.inset = '0';
  modalRoot.style.pointerEvents = 'none';

  app.appendChild(hud);
  app.appendChild(main);
  app.appendChild(modalRoot);
}

function showDurabilityPopup(dmg) {
  const elPopup = document.getElementById('durability-popup');
  if (!elPopup) return;
  elPopup.textContent = `-${dmg}`;
  elPopup.classList.add('visible');
  if (durabilityPopupTimer) {
    clearTimeout(durabilityPopupTimer);
  }
  durabilityPopupTimer = setTimeout(() => {
    elPopup.classList.remove('visible');
    durabilityPopupTimer = null;
  }, 550);
}

function updateHUD() {
  if (!state) return;
  const depthEl = document.getElementById('depth-val');
  const toolEl = document.getElementById('tool-val');
  const bestEl = document.getElementById('best-val');
  const statusEl = document.getElementById('status-text');

  const depthMeter = document.getElementById('depth-meter');
  const toolMeter = document.getElementById('tool-meter');
  const bestMeter = document.getElementById('best-meter');

  if (depthEl) depthEl.textContent = state.depth;
  if (toolEl) toolEl.textContent = state.tools;
  if (bestEl) bestEl.textContent = state.bestDepth;
  if (statusEl) {
    if (!state.alive) {
      statusEl.textContent = '工具壞掉了';
    } else if (state.paused) {
      statusEl.textContent = '已暫停';
    } else if (state.autoDigActive) {
      statusEl.textContent = `自動挖掘（${state.autoDigSide === 'left' ? '左' : '右'}）`;
    } else {
      statusEl.textContent = '';
    }
  }

  // 視覺化數值
  if (depthMeter) {
    const pct = state.bestDepth > 0 ? Math.min(state.depth / state.bestDepth, 1) * 100 : 0;
    depthMeter.style.width = `${pct}%`;
  }
  if (bestMeter) {
    const pct = state.bestDepth > 0 ? 100 : 0;
    bestMeter.style.width = `${pct}%`;
  }
  if (toolMeter) {
    const maxTools = state.maxTools || state.tools || 1;
    const pct = Math.min(state.tools / maxTools, 1) * 100;
    toolMeter.style.width = `${pct}%`;
    // color: green > 60%, yellow 30-60%, red < 30%
    const ratio = state.tools / maxTools;
    if (ratio > 0.6) {
      toolMeter.style.background = 'linear-gradient(90deg,#52d48a,#7eedb5)';
    } else if (ratio > 0.3) {
      toolMeter.style.background = 'linear-gradient(90deg,#f6cf4a,#ffe58a)';
    } else {
      toolMeter.style.background = 'linear-gradient(90deg,#e05050,#ff8080)';
    }
  }

  const pauseBtn = document.getElementById('pause-btn');
  if (pauseBtn) {
    pauseBtn.textContent = state.paused ? '繼續' : '暫停';
  }

  const autoDigLabel = document.getElementById('autodig-label');
  const autoDigFill = document.getElementById('autodig-fill');
  const autoDigTime = document.getElementById('autodig-time');
  if (autoDigLabel && autoDigFill && autoDigTime) {
    if (state.autoDigActive) {
      const totalMs = 5000;
      const remain = Math.max(0, state.autoDigRemainingMs || 0);
      const ratio = Math.max(0, Math.min(1, remain / totalMs));
      autoDigLabel.textContent = '自動挖';
      autoDigFill.style.width = `${ratio * 100}%`;
      autoDigTime.textContent = `${(remain / 1000).toFixed(1)}s`;
      autoDigFill.classList.add('active');
    } else {
      autoDigLabel.textContent = state.paused ? '已暫停' : '自動挖';
      autoDigFill.style.width = '0%';
      autoDigTime.textContent = '0.0s';
      autoDigFill.classList.remove('active');
    }
  }

  // 挖到石頭時顯示耐久度降低提示
  if (
    state.lastHit &&
    state.lastHit.dmg > 0 &&
    (!prevState || !prevState.lastHit || state.lastHit.time !== prevState.lastHit.time)
  ) {
    showDurabilityPopup(state.lastHit.dmg);
    // sfx
    if (state.lastHit.dmg >= 2) sfxDiamond(); else sfxHit();
    // hit flash
    const flash = document.getElementById('hit-flash');
    if (flash) {
      flash.classList.remove('active');
      void flash.offsetWidth;
      flash.classList.add('active');
    }
  }

  // danger badge on tools badge
  const toolBadge = document.querySelector('.badge:nth-child(1)');
  // find tool badge by id of inner element
  const toolValEl = document.getElementById('tool-val');
  if (toolValEl) {
    const badge = toolValEl.closest('.badge');
    if (badge) {
      if (state.alive && state.tools <= 2) {
        badge.classList.add('danger');
      } else {
        badge.classList.remove('danger');
      }
    }
  }

  // gold plating indicator
  const toolValEl2 = document.getElementById('tool-val');
  if (toolValEl2) {
    const badge2 = toolValEl2.closest('.badge');
    if (badge2) {
      if (state.goldPlatingActive) {
        badge2.style.boxShadow = '0 0 8px 3px rgba(255,230,80,0.75)';
        badge2.title = '鍍金護盾：下一次石頭/鑽石傷害無效';
      } else {
        badge2.style.boxShadow = '';
        badge2.title = '';
      }
    }
  }

  updateToolIndicator();

  // depth-based background darkening
  if (state.depth !== undefined) {
    const digArea = document.getElementById('dig-area');
    if (digArea) {
      const depthRatio = Math.min(1, state.depth / 150);
      // darken from light brown to deep dark brown
      const lightness = Math.round(22 - depthRatio * 12); // 22% -> 10%
      digArea.style.background = `hsl(30, 28%, ${lightness}%)`;
    }
  }
}

function updateRelics() {
  const wrap = document.getElementById('relics-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!meta) return;

  if (meta.unlockedRelics.includes('extra_tool')) {
    const r = el('div', 'relic-icon', '+');
    r.title = '額外工具：每場開始時 +1 工具耐久';
    wrap.appendChild(r);
  }
  if (meta.unlockedRelics.includes('stone_resist')) {
    const r = el('div', 'relic-icon', '岩');
    r.title = '石頭護符：每場開始時 +1 工具耐久';
    wrap.appendChild(r);
  }
  if (meta.unlockedRelics.includes('survey_aura')) {
    const r = el('div', 'relic-icon', '🧲');
    r.title = '探勘磁力：每場開始時，最底兩層危險格自動變泥土';
    wrap.appendChild(r);
  }
}

function updateSurface() {
  const elInfo = document.getElementById('surface-info');
  if (!elInfo || !meta) return;
  const scoreText = state && state.score > 0 ? `　分 ${state.score}` : '';
  elInfo.textContent = `地面 · 遊戲數 ${meta.runs} · 收穫拼圖 ${meta.puzzlePieces.length}${scoreText}`;
}

function updateStreak() {
  if (!state) return;
  let streakEl = document.getElementById('streak-badge');
  if (!streakEl) {
    // Create streak badge next to depth badge
    const hud = document.querySelector('.hud-section');
    if (!hud) return;
    streakEl = el('div', 'streak-badge');
    streakEl.id = 'streak-badge';
    hud.appendChild(streakEl);
  }
  const streak = state.safeStreak || 0;
  if (streak >= 5) {
    const fire = streak >= 20 ? '🔥🔥' : streak >= 10 ? '🔥' : '✨';
    streakEl.textContent = `${fire} ×${streak}`;
    streakEl.style.display = '';
  } else {
    streakEl.style.display = 'none';
  }
}

function setToolIndicatorVisibility(side, visible) {
  const leftEl = document.getElementById('tool-indicator-left');
  const rightEl = document.getElementById('tool-indicator-right');
  if (!leftEl || !rightEl) return;

  leftEl.classList.remove('visible');
  rightEl.classList.remove('visible');

  if (!visible) return;

  if (side === 'left') {
    leftEl.classList.add('visible');
  } else if (side === 'right') {
    rightEl.classList.add('visible');
  }
}

function showToolIndicatorOnce(side) {
  if (toolIndicatorTimer) {
    clearTimeout(toolIndicatorTimer);
    toolIndicatorTimer = null;
  }
  // 顯示短暫一次
  setToolIndicatorVisibility(side, true);
  toolIndicatorTimer = setTimeout(() => {
    toolIndicatorTimer = null;
    // 只有在沒有自動挖的時候才關掉，避免蓋掉自動挖提示
    if (!state || !state.autoDigActive) {
      setToolIndicatorVisibility(null, false);
    }
  }, 350);
}

function updateToolIndicator() {
  if (!state) return;
  // 自動挖時，小工人固定站在自動挖的一側
  if (state.autoDigActive && state.autoDigSide) {
    moveWorkerToSide(state.autoDigSide);
  }
}

function renderTiles() {
  if (!state) return;
  const colL = document.getElementById('col-left');
  const colR = document.getElementById('col-right');
  if (!colL || !colR) return;
  const slotsL = Array.from(colL.querySelectorAll('.tile-slot'));
  const slotsR = Array.from(colR.querySelectorAll('.tile-slot'));
  const renderCol = (slots, tiles, prevTiles) => {
    for (let i = 0; i < 5; i++) {
      const s = slots[i];
      const t = tiles[i];
      s.className = 'tile-slot';
      s.title = '';
      s.innerHTML = '';
      let icon = '';
      if (t === 'dirt') { icon = ''; }
      if (t === 'stone') { s.classList.add('stone'); icon = '🪨'; }
      if (t === 'diamond') { s.classList.add('diamond'); icon = '💎'; }
      if (t === 'event') { s.classList.add('event'); icon = '❓'; }
      if (t === 'puzzle') {
        s.classList.add('puzzle');
        icon = '🧩';
        s.title = '拼圖碎片';
      }
      if (t === 'empty') { s.classList.add('empty'); }
      if (icon) {
        const span = el('span', 'tile-icon', icon);
        s.appendChild(span);
      }
      if (i === 0) s.classList.add('current');
      // Animate bottom tile if it changed
      if (i === 4 && prevTiles && prevTiles[4] !== t) {
        s.classList.add('tile-enter');
        s.addEventListener('animationend', () => s.classList.remove('tile-enter'), { once: true });
      }
    }
  };
  const prevLeft = prevState && prevState.previews ? prevState.previews.left : null;
  const prevRight = prevState && prevState.previews ? prevState.previews.right : null;
  renderCol(slotsL, state.previews.left, prevLeft);
  renderCol(slotsR, state.previews.right, prevRight);
}

function showEventModal(eventData, done) {
  sfxEvent();
  const { mode, title: eventTitle, desc: eventDesc, options } = eventData;

  modalRoot.innerHTML = '';
  const backdrop = el('div', 'modal-backdrop');
  backdrop.style.pointerEvents = 'auto';
  const modal = el('div', 'modal');
  const title = el('div', 'modal-title', eventTitle || '奇怪的地瓜事件');
  const desc = el('div', null, eventDesc || '');

  const isChoice = mode === 'choice';
  const containerClass = isChoice ? 'choice-options' : 'wheel-options';
  const cardClass = isChoice ? 'choice-option' : 'wheel-option';

  const wheel = el('div', containerClass);
  const cards = options.map((o, idx) => {
    const c = el('div', cardClass);
    const name = el('span', null, o.title);
    const d = el('span', null, o.desc);
    if (mode === 'choice') {
      const keyHint = el('span', 'choice-key-hint', `[${idx + 1}]`);
      c.appendChild(keyHint);
    }
    c.appendChild(name);
    c.appendChild(d);
    wheel.appendChild(c);
    return c;
  });

  const footer = el('div', 'modal-footer');

  if (mode === 'choice') {
    let keyHandler;

    const select = (idx) => {
      if (idx < 0 || idx >= cards.length) return;
      window.removeEventListener('keydown', keyHandler);
      const c = cards[idx];
      cards.forEach(card => card.classList.remove('active'));
      c.classList.add('active');
      const choice = options[idx];
      setTimeout(() => {
        modalRoot.innerHTML = '';
        done(choice);
      }, 150);
    };

    cards.forEach((c, idx) => {
      c.addEventListener('click', () => {
        select(idx);
      });
    });

    keyHandler = (e) => {
      if (e.key === 'ArrowLeft' || e.key === '1') {
        e.preventDefault();
        select(0);
      } else if (e.key === 'ArrowRight' || e.key === '3') {
        e.preventDefault();
        select(cards.length - 1);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === '2') {
        e.preventDefault();
        if (cards.length >= 2) select(1);
      }
    };

    window.addEventListener('keydown', keyHandler);

    modal.appendChild(title);
    modal.appendChild(desc);
    modal.appendChild(wheel);
    modal.appendChild(footer);
    backdrop.appendChild(modal);
    modalRoot.appendChild(backdrop);
    return;
  }

  // roulette 模式：自動轉動並停下
  const hint = el('div', null, '轉盤旋轉中…');
  footer.appendChild(hint);

  modal.appendChild(title);
  modal.appendChild(desc);
  modal.appendChild(wheel);
  modal.appendChild(footer);
  backdrop.appendChild(modal);
  modalRoot.appendChild(backdrop);

  let idx = 0;
  let ticks = 0;
  let resolved = false;
  const maxTicks = 12 + Math.floor(Math.random() * 6);

  const stopAndResolve = () => {
    if (resolved) return;
    resolved = true;
    const finalIndex = (idx + cards.length - 1) % cards.length;
    cards.forEach((c, i) => {
      if (i === finalIndex) {
        c.classList.add('active');
        c.style.opacity = '1';
      } else {
        c.style.opacity = '0';
        c.classList.remove('active');
      }
    });
    const choice = options[finalIndex];
    if (hint) {
      hint.textContent = `獲得：${choice.title}`;
    }
    // 多留一點時間讓玩家看清楚結果
    setTimeout(() => {
      modalRoot.innerHTML = '';
      done(choice);
    }, 1500);
  };

  const timer = setInterval(() => {
    if (resolved) {
      clearInterval(timer);
      return;
    }
    cards.forEach(c => c.classList.remove('active'));
    cards[idx].classList.add('active');
    idx = (idx + 1) % cards.length;
    ticks++;
    if (ticks >= maxTicks) {
      clearInterval(timer);
      stopAndResolve();
    }
  }, 120);
}

function showDifficultyModal(onSelect) {
  if (!modalRoot) return;
  modalRoot.innerHTML = '';
  const backdrop = el('div', 'modal-backdrop');
  backdrop.style.pointerEvents = 'auto';
  const modal = el('div', 'modal');
  const title = el('div', 'modal-title', '選擇難度');
  const desc = el('div', 'center-text', '難度影響初始工具耐久與石頭機率');
  desc.style.fontSize = '11px';
  desc.style.opacity = '0.7';
  desc.style.marginBottom = '8px';

  const choices = el('div', 'choice-options');
  const diffs = [
    { key: 'easy', label: '😌 簡單', sub: '初始 9 耐久，石頭少' },
    { key: 'normal', label: '⛏ 普通', sub: '初始 6 耐久，標準石頭' },
    { key: 'hard', label: '💀 困難', sub: '初始 4 耐久，石頭更多' },
  ];
  for (const d of diffs) {
    const card = el('div', 'choice-option diff-card');
    const lbl = el('div', null, d.label);
    lbl.style.fontWeight = '700';
    const sub = el('div', null, d.sub);
    sub.style.fontSize = '10px';
    sub.style.opacity = '0.7';
    card.appendChild(lbl);
    card.appendChild(sub);
    card.addEventListener('click', () => {
      modalRoot.innerHTML = '';
      onSelect(d.key);
    });
    choices.appendChild(card);
  }

  modal.appendChild(title);
  modal.appendChild(desc);
  modal.appendChild(choices);
  backdrop.appendChild(modal);
  modalRoot.appendChild(backdrop);
}

function showGameOverModal(onRestart) {
  sfxGameOver();
  // screen shake
  const digArea = document.getElementById('dig-area');
  if (digArea) {
    digArea.classList.add('screen-shake');
    digArea.addEventListener('animationend', () => digArea.classList.remove('screen-shake'), { once: true });
  }
  modalRoot.innerHTML = '';
  const backdrop = el('div', 'modal-backdrop');
  backdrop.style.pointerEvents = 'auto';
  const modal = el('div', 'modal');

  const isNewRecord = state.depth > 0 && state.depth >= (state.bestDepth || 0) && meta && state.depth > (meta.bestDepth || 0);
  const titleText = isNewRecord ? '🏆 新紀錄！' : '工具全壞了';
  const title = el('div', 'modal-title', titleText);
  if (isNewRecord) title.style.color = '#d89b31';

  const txt = el('div', 'center-text', `本次深度：${state.depth}`);
  const prev = meta && meta.bestDepth > 0 ? el('div', 'center-text', `上次最佳：${meta.bestDepth}`) : null;
  if (prev) prev.style.opacity = '0.65';

  // score
  const score = state.score || 0;
  const prevBestScore = bestScore;
  const isNewScore = score > bestScore;
  if (isNewScore) {
    bestScore = score;
    saveBestScore(bestScore);
  }
  const scoreEl = el('div', 'center-text');
  scoreEl.style.fontSize = '13px';
  scoreEl.style.fontWeight = '700';
  scoreEl.style.color = isNewScore ? '#d89b31' : '#6a5a3a';
  scoreEl.textContent = isNewScore ? `⭐ 最高分：${score}` : `分數：${score}`;
  const prevScoreEl = el('div', 'center-text');
  prevScoreEl.style.fontSize = '11px';
  prevScoreEl.style.opacity = '0.6';
  prevScoreEl.textContent = isNewScore ? `舊紀錄：${prevBestScore}` : `最高分：${bestScore}`;

  // streak
  const streakEl = el('div', 'center-text');
  streakEl.style.fontSize = '11px';
  streakEl.style.opacity = '0.72';
  streakEl.style.marginTop = '2px';
  if (state.maxSafeStreak >= 3) {
    streakEl.textContent = `🔥 最長安全連挖：${state.maxSafeStreak} 格`;
  }

  // run stats
  const statsEl = el('div', 'center-text');
  statsEl.style.fontSize = '11px';
  statsEl.style.opacity = '0.72';
  statsEl.style.marginTop = '2px';
  if (state.stats) {
    const { stonesHit, diamondsHit, eventsTriggered } = state.stats;
    statsEl.textContent = `🪨 ${stonesHit}　💎 ${diamondsHit}　❓ ${eventsTriggered}`;
  }

  // save leaderboard entry
  const leaderboard = addLeaderboardEntry({
    depth: state.depth,
    score: score,
    difficulty: state.difficulty || 'normal',
    date: new Date().toLocaleDateString('zh-TW')
  });

  // leaderboard display
  const lbEl = el('div');
  lbEl.style.marginTop = '6px';
  lbEl.style.fontSize = '10px';
  lbEl.style.opacity = '0.75';
  if (leaderboard.length > 0) {
    const lbTitle = el('div', null, '🏅 本機排行 Top 5');
    lbTitle.style.fontWeight = '700';
    lbTitle.style.marginBottom = '2px';
    lbEl.appendChild(lbTitle);
    for (let i = 0; i < leaderboard.length; i++) {
      const entry = leaderboard[i];
      const diffLabel = entry.difficulty === 'easy' ? '簡' : entry.difficulty === 'hard' ? '難' : '普';
      const row = el('div', null, `${i + 1}. 分${entry.score}　深${entry.depth}　${diffLabel}　${entry.date || ''}`);
      lbEl.appendChild(row);
    }
  }

  const row = el('div', 'modal-footer');
  const btn = el('button', 'btn-primary', '回到地面');
  btn.onclick = () => {
    modalRoot.innerHTML = '';
    showDifficultyModal(diff => {
      onRestart(diff);
    });
  };
  row.appendChild(btn);
  modal.appendChild(title);
  modal.appendChild(txt);
  if (prev) modal.appendChild(prev);
  modal.appendChild(scoreEl);
  modal.appendChild(prevScoreEl);
  if (state.maxSafeStreak >= 3) modal.appendChild(streakEl);
  modal.appendChild(statsEl);
  modal.appendChild(lbEl);
  modal.appendChild(row);
  backdrop.appendChild(modal);
  modalRoot.appendChild(backdrop);
}

function addKeyboardControls() {
  window.addEventListener('keydown', (e) => {
    if (!state || !state.alive) return;

    const key = e.key.toLowerCase();
    if (key === 'p' || e.key === 'Escape') {
      e.preventDefault();
      if (!state.inEvent && game) game.togglePause();
      return;
    }

    if (state.inEvent || state.paused) return;

    if (e.key === 'ArrowLeft' || key === 'a' || e.key === '1') {
      e.preventDefault();
      dig('left');
    } else if (e.key === 'ArrowRight' || key === 'd' || e.key === '2') {
      e.preventDefault();
      dig('right');
    } else if (key === 'w' || key === 's' || e.key === ' ') {
      e.preventDefault();
      // 讓單鍵玩家可快速沿著上一個方向繼續挖
      const side = state.autoDigSide || 'left';
      dig(side);
    }
  });
}

function init() {
  muted = loadMute();
  bestScore = loadBestScore();
  renderBase();
  game = new Game(
    s => {
      prevState = state;
      state = s;
      updateHUD();
      renderTiles();
      updateStreak();
      updateSurface();
      // depth bonus toast
      if (state.depthBonus && (!prevState || !prevState.depthBonus || state.depthBonus.time !== prevState.depthBonus.time)) {
        const milestone = state.depthBonus.depth / 50;
        const bonusText = milestone % 2 === 0 ? '+1 工具耐久！' : '鍍金護盾！';
        const toast = el('div', 'milestone-toast', `🎁 深度 ${state.depthBonus.depth} 獎勵：${bonusText}`);
        if (modalRoot) {
          modalRoot.appendChild(toast);
          requestAnimationFrame(() => toast.classList.add('visible'));
          setTimeout(() => { toast.classList.remove('visible'); setTimeout(() => toast.parentNode && toast.parentNode.removeChild(toast), 250); }, 1800);
        }
        sfxMilestone();
      }
      // milestone celebrations
      if (state.alive && state.depth > lastMilestone) {
        for (const m of MILESTONES) {
          if (state.depth >= m && lastMilestone < m) {
            showMilestoneToast(m);
            sfxMilestone();
            lastMilestone = m;
            break;
          }
        }
      }
      if (!state.alive) { lastMilestone = 0; }
    },
    (eventData, done) => {
      showEventModal(eventData, done);
    },
    onRestart => {
      showGameOverModal(diff => {
        onRestart(diff);
      });
    },
    (m, relics, lastPuzzlePiece) => {
      meta = m;
      relicEffects = relics;

      const currPieces = meta && meta.puzzlePieces ? meta.puzzlePieces.length : 0;
      if (lastPuzzleCount !== null && currPieces > lastPuzzleCount) {
        // 直接使用遊戲邏輯傳過來的最新拼圖資訊，確保顯示正確片段
        const piece = lastPuzzlePiece || null;
        showPuzzleGainAnimation(piece, meta);
      }
      lastPuzzleCount = currPieces;

      updateRelics();
      updateSurface();
    }
  );
  addKeyboardControls();
  // Show difficulty selection on first run
  showDifficultyModal(diff => {
    game.startRun(diff);
  });
}

init();