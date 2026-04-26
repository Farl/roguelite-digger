import { Game } from './game.js';

const app = document.getElementById('app');

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

let game;
let state = null;
let prevState = null;
let meta = null;
let relicEffects = null;
let modalRoot = null;
let toolIndicatorTimer = null;
let durabilityPopupTimer = null;
let lastPuzzleCount = null;

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
  game.step(side);

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
      const relicName = size === 2
        ? '額外工具（開局 +1 工具耐久）'
        : '石頭護符（開局 +1 工具耐久）';

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
  surfaceRight.appendChild(pauseBtn);
  surfaceRight.appendChild(puzzleBtn);
  surfaceRight.appendChild(resetBtn);
  surfaceRight.appendChild(clearBtn);
  surface.appendChild(surfaceLeft);
  surface.appendChild(surfaceRight);

  const digArea = el('div', 'dig-area');
  digArea.id = 'dig-area';

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
  }

  updateToolIndicator();
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
}

function updateSurface() {
  const elInfo = document.getElementById('surface-info');
  if (!elInfo || !meta) return;
  elInfo.textContent = `地面 · 遊戲數 ${meta.runs} · 收穫拼圖 ${meta.puzzlePieces.length}`;
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
  const renderCol = (slots, tiles) => {
    for (let i = 0; i < 5; i++) {
      const s = slots[i];
      const t = tiles[i];
      s.className = 'tile-slot';
      s.title = '';
      let label = '';
      if (t === 'dirt') { label = ''; }
      if (t === 'stone') { s.classList.add('stone'); label = '石'; }
      if (t === 'diamond') { s.classList.add('diamond'); label = '鑽'; }
      if (t === 'event') { s.classList.add('event'); label = '？'; }
      if (t === 'puzzle') {
        s.classList.add('puzzle');
        label = '圖';
        s.title = '拼圖碎片';
      }
      if (t === 'empty') { s.classList.add('empty'); }
      if (i === 0) s.classList.add('current');
      s.textContent = label;
    }
  };
  renderCol(slotsL, state.previews.left);
  renderCol(slotsR, state.previews.right);
}

function showEventModal(eventData, done) {
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
  const cards = options.map(o => {
    const c = el('div', cardClass);
    const name = el('span', null, o.title);
    const d = el('span', null, o.desc);
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
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        select(0);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        select(cards.length - 1);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
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

function showGameOverModal(onRestart) {
  modalRoot.innerHTML = '';
  const backdrop = el('div', 'modal-backdrop');
  backdrop.style.pointerEvents = 'auto';
  const modal = el('div', 'modal');
  const title = el('div', 'modal-title', '工具全壞了');
  const txt = el('div', 'center-text', `本次深度：${state.depth}`);
  const row = el('div', 'modal-footer');
  const btn = el('button', 'btn-primary', '回到地面');
  btn.onclick = () => {
    modalRoot.innerHTML = '';
    onRestart();
  };
  row.appendChild(btn);
  modal.appendChild(title);
  modal.appendChild(txt);
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
  renderBase();
  game = new Game(
    s => {
      prevState = state;
      state = s;
      updateHUD();
      renderTiles();
    },
    (eventData, done) => {
      showEventModal(eventData, done);
    },
    onRestart => {
      showGameOverModal(onRestart);
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
}

init();