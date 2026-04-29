import { Game } from './game.js';
import { loadMute, saveMute, loadHintDismissed, saveHintDismissed, loadBestScore, saveBestScore, addLeaderboardEntry } from './storage.js';

const Phaser = globalThis.Phaser;
if (!Phaser) {
  throw new Error('Phaser global not found. Ensure phaser.min.js is loaded before phaser-main.js.');
}

const WIDTH  = 480;
const HEIGHT = 800;
const MILESTONES = [5, 10, 20, 30, 50, 75, 100, 150, 200];
const FONT_FAMILY = 'Noto Sans TC, PingFang TC, Microsoft JhengHei, sans-serif';

// ─── Web Audio (same synth as DOM version) ───────────────────────
let _audioCtx = null;
let _muted = false;
function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}
function playTone({ freq = 440, type = 'sine', duration = 0.08, gainPeak = 0.18, detune = 0 } = {}) {
  if (_muted) return;
  try {
    const ctx = getAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.detune.setValueAtTime(detune, ctx.currentTime);
    gain.gain.setValueAtTime(gainPeak, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (_) {}
}
const sfx = {
  dig:       () => playTone({ freq: 220, type: 'triangle', duration: 0.06, gainPeak: 0.12 }),
  hit:       () => { playTone({ freq: 110, type: 'sawtooth', duration: 0.12, gainPeak: 0.22 }); setTimeout(() => playTone({ freq: 80, type: 'sawtooth', duration: 0.08, gainPeak: 0.12 }), 60); },
  diamond:   () => { playTone({ freq: 880, type: 'sine', duration: 0.15, gainPeak: 0.18 }); setTimeout(() => playTone({ freq: 1100, type: 'sine', duration: 0.10, gainPeak: 0.10 }), 80); },
  event:     () => { playTone({ freq: 660, type: 'triangle', duration: 0.12, gainPeak: 0.15 }); setTimeout(() => playTone({ freq: 880, type: 'triangle', duration: 0.10, gainPeak: 0.12 }), 100); },
  gameOver:  () => { playTone({ freq: 220, type: 'sawtooth', duration: 0.18, gainPeak: 0.25 }); setTimeout(() => playTone({ freq: 165, type: 'sawtooth', duration: 0.20, gainPeak: 0.20 }), 150); setTimeout(() => playTone({ freq: 110, type: 'sawtooth', duration: 0.35, gainPeak: 0.18 }), 300); },
  milestone: () => { playTone({ freq: 523, type: 'sine', duration: 0.10, gainPeak: 0.20 }); setTimeout(() => playTone({ freq: 659, type: 'sine', duration: 0.10, gainPeak: 0.18 }), 80); setTimeout(() => playTone({ freq: 784, type: 'sine', duration: 0.18, gainPeak: 0.22 }), 160); },
};
// ─────────────────────────────────────────────────────────────────

class DiggerScene extends Phaser.Scene {
  constructor() {
    super('DiggerScene');
    this.logic      = null;
    this.state      = null;
    this.prevState  = null;
    this.meta       = null;
    this.inEvent    = false;
    this.eventDone  = null;
    this.eventOptions = [];
    this.lastMilestone  = 0;
    this.bestScore      = 0;
    this.toasts         = [];
    this.lastPuzzleCount = null;
    this.lastManualSide = 'left';
    this._modalPausedByUI = false;
    this.eventMode = 'choice';
    this.rouletteTimer = null;
    this.hintBar = null;
    this.uiModalOpen = false;
    this.tileScrollOffset = 24;
  }

  preload() {
    this.load.spritesheet('worker', 'assets/sprite-forge/minipack/worker.png', { frameWidth: 64, frameHeight: 64 });
    this.load.image('tile_dirt',    'assets/sprite-forge/minipack/tile_dirt.png');
    this.load.image('tile_stone',   'assets/sprite-forge/minipack/tile_stone.png');
    this.load.image('tile_diamond', 'assets/sprite-forge/minipack/tile_diamond.png');
    this.load.image('tile_event',   'assets/sprite-forge/minipack/tile_event.png');
    this.load.image('tile_puzzle',  'assets/sprite-forge/minipack/tile_puzzle.png');
    this.load.image('tile_empty',   'assets/sprite-forge/minipack/tile_empty.png');
  }

  create() {
    _muted = loadMute();
    this.bestScore = loadBestScore();

    // ── Background
    this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x1a1009);

    // ── HUD row 1: depth / tools / best
    const hudStyle = { fontFamily: FONT_FAMILY, fontSize: '20px', color: '#f8f3e6', backgroundColor: '#00000055', padding: { x: 8, y: 4 } };
    this.depthText = this.add.text(12,  12, '深度: 0', hudStyle);
    this.toolsText = this.add.text(160, 12, '工具: 0', hudStyle);
    this.bestText  = this.add.text(318, 12, '最佳: 0', hudStyle);

    // Tool durability meter (same thresholds as DOM)
    this.toolMeterTrack = this.add.rectangle(186, 39, 90, 4, 0x1b120a).setOrigin(0, 0);
    this.toolMeterFill = this.add.rectangle(186, 39, 90, 4, 0x52d48a).setOrigin(0, 0);

    // ── HUD row 2: score + streak
    const subStyle = { fontFamily: FONT_FAMILY, fontSize: '16px', color: '#c8b87e', backgroundColor: '#00000033', padding: { x: 6, y: 2 } };
    this.scoreText  = this.add.text(12,  44, '', subStyle);
    this.streakText = this.add.text(210, 44, '', subStyle);

    // ── Status line
    this.statusText = this.add.text(12, 68, '', { fontFamily: FONT_FAMILY, fontSize: '14px', color: '#f1ddba' });

    // ── AutoDig bar
    this.autoDigBar   = this.add.rectangle(WIDTH / 2, 94, 0, 6, 0xf6cf4a).setOrigin(0.5, 0);
    this.autoDigLabel = this.add.text(12, 90, '', { fontFamily: FONT_FAMILY, fontSize: '12px', color: '#f6cf4a' });

    // ── Tile grid
    const sidePadding = 18;
    const colGap = 18;
    this.colW = (WIDTH - sidePadding * 2 - colGap) / 2;
    this.leftColX  = sidePadding + this.colW / 2;
    this.rightColX = WIDTH - sidePadding - this.colW / 2;
    this.gridTop   = 126;
    this.tileH     = 105;
    this.leftTiles  = this._createTileColumn(this.leftColX);
    this.rightTiles = this._createTileColumn(this.rightColX);

    // ── Worker animation
    if (!this.anims.exists('worker-walk')) {
      this.anims.create({ key: 'worker-walk', frames: this.anims.generateFrameNumbers('worker', { start: 0, end: 3 }), frameRate: 8, repeat: -1 });
    }
    this.worker = this.add.sprite(this.leftColX - 34, this.gridTop - 26, 'worker', 0).setDisplaySize(72, 72).setFlipX(true);
    this.worker.play('worker-walk');

    // ── Input zones
    const leftZone  = this.add.zone(0,        0, WIDTH / 2, HEIGHT).setOrigin(0).setInteractive();
    const rightZone = this.add.zone(WIDTH / 2, 0, WIDTH / 2, HEIGHT).setOrigin(0).setInteractive();
    leftZone.on('pointerdown',  () => this._dig('left'));
    rightZone.on('pointerdown', () => this._dig('right'));

    const kb = this.input.keyboard;
    kb.on('keydown-LEFT',  () => this._dig('left'));
    kb.on('keydown-A',     () => this._dig('left'));
    kb.on('keydown-RIGHT', () => this._dig('right'));
    kb.on('keydown-D',     () => this._dig('right'));
    kb.on('keydown-W',     () => this._dig(this.lastManualSide));
    kb.on('keydown-S',     () => this._dig(this.lastManualSide));
    kb.on('keydown-SPACE', () => this._dig(this.lastManualSide));
    kb.on('keydown-ONE',   () => this._handleEventChoice(0));
    kb.on('keydown-TWO',   () => this._handleEventChoice(1));
    kb.on('keydown-THREE', () => this._handleEventChoice(2));
    kb.on('keydown-R',     () => { if (this.state && !this.state.alive) this._tryRestartOverlay(); });
    kb.on('keydown-P',     () => { if (this.logic && this.state?.alive && !this.state?.inEvent) this.logic.togglePause(); });
    kb.on('keydown-ESC',   () => { if (this.logic && this.state?.alive && !this.state?.inEvent) this.logic.togglePause(); });
    kb.on('keydown-C',     () => this._showCollectionModal());
    kb.on('keydown-H',     () => this._showHelpModal());

    // ── Bottom button bar (improved layout)
    const btnY = HEIGHT - 36;
    const btnSpacing = 58;
    let btnX = 12;

    this.pauseBtn = this.add.text(btnX, btnY, '暫停', {
      fontFamily: FONT_FAMILY, fontSize: '12px', color: '#f8f3e6',
      backgroundColor: '#00000055', padding: { x: 6, y: 3 }
    }).setInteractive({ useHandCursor: true });
    this.pauseBtn.on('pointerdown', () => {
      if (this.logic && this.state?.alive && !this.state?.inEvent) this.logic.togglePause();
    });

    btnX += btnSpacing;
    this.muteBtn = this.add.text(btnX, btnY, _muted ? '音關' : '音開', {
      fontFamily: FONT_FAMILY, fontSize: '12px', color: '#f8f3e6',
      backgroundColor: '#00000055', padding: { x: 6, y: 3 }
    }).setInteractive({ useHandCursor: true });
    this.muteBtn.on('pointerdown', () => {
      _muted = !_muted;
      saveMute(_muted);
      this.muteBtn.setText(_muted ? '音關' : '音開');
    });

    btnX += btnSpacing;
    this.helpBtn = this.add.text(btnX, btnY, '說明', {
      fontFamily: FONT_FAMILY, fontSize: '12px', color: '#f8f3e6',
      backgroundColor: '#00000055', padding: { x: 6, y: 3 }
    }).setInteractive({ useHandCursor: true });
    this.helpBtn.on('pointerdown', () => this._showHelpModal());

    btnX += btnSpacing;
    this.collectionBtn = this.add.text(btnX, btnY, '收藏', {
      fontFamily: FONT_FAMILY, fontSize: '12px', color: '#f8f3e6',
      backgroundColor: '#00000055', padding: { x: 6, y: 3 }
    }).setInteractive({ useHandCursor: true });
    this.collectionBtn.on('pointerdown', () => this._showCollectionModal());

    btnX += btnSpacing;
    this.restartBtn = this.add.text(btnX, btnY, '重開', {
      fontFamily: FONT_FAMILY, fontSize: '12px', color: '#f8f3e6',
      backgroundColor: '#00000055', padding: { x: 6, y: 3 }
    }).setInteractive({ useHandCursor: true });
    this.restartBtn.on('pointerdown', () => {
      if (!this.logic) return;
      this._showDifficultyModal(diff => this.logic.startRun(diff));
    });

    btnX += btnSpacing;
    this.clearBtn = this.add.text(btnX, btnY, '清進度', {
      fontFamily: FONT_FAMILY, fontSize: '12px', color: '#f8f3e6',
      backgroundColor: '#00000055', padding: { x: 6, y: 3 }
    }).setInteractive({ useHandCursor: true });
    this.clearBtn.on('pointerdown', () => this._showClearProgressModal());

    this.relicText = this.add.text(12, 108, '', {
      fontFamily: FONT_FAMILY, fontSize: '12px', color: '#c8b87e'
    }).setDepth(5);

    // ── Bottom info bar
    this.infoText = this.add.text(12, HEIGHT - 22, '', {
      fontFamily: FONT_FAMILY, fontSize: '12px', color: '#8f7a5a'
    }).setDepth(5);

    // ── Modal layer (drawn last = on top)
    this.modalLayer = this.add.container(0, 0).setDepth(100);

    if (!loadHintDismissed()) {
      this.time.delayedCall(300, () => this._showHintBar());
    }

    // ── Init game logic
    this.logic = new Game(
      s   => this._onUpdate(s),
      (e, done) => this._onEvent(e, done),
      r   => this._onGameOver(r),
      (m, _relics, lastPuzzlePiece) => this._onMeta(m, lastPuzzlePiece)
    );

    // ── Start with difficulty modal
    this._showDifficultyModal(diff => this.logic.startRun(diff));
  }

  // ────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────

  _createTileColumn(x) {
    const arr = [];
    for (let i = 0; i < 5; i++) {
      const baseY = this.gridTop + i * this.tileH;
      const bg = this.add.rectangle(x, baseY, this.colW, this.tileH - 4, 0x2a170d, 1);
      const sprite = this.add.image(x, baseY, 'tile_dirt').setDisplaySize(this.colW - 6, this.tileH - 10);
      arr.push({ bg, sprite, baseY });
    }
    return arr;
  }

  _placeWorker(side) {
    this.worker.x = side === 'left' ? this.leftColX - 34 : this.rightColX - 34;
    this.worker.setFlipX(side === 'left');
  }

  _dig(side) {
    if (!this.logic || !this.state?.alive || this.state?.inEvent || this.state?.paused || this.uiModalOpen) return;
    if (this.state.autoDigActive) { this.logic.switchAutoSide(side); this._placeWorker(side); return; }
    this.lastManualSide = side;
    this._placeWorker(side);
    sfx.dig();
    this.logic.step(side);
  }

  _playDigScroll() {
    const allTiles = [...this.leftTiles, ...this.rightTiles];
    for (const t of allTiles) {
      t.bg.y = t.baseY + this.tileScrollOffset;
      t.sprite.y = t.baseY + this.tileScrollOffset;
      this.tweens.add({ targets: [t.bg, t.sprite], y: t.baseY, duration: 130, ease: 'Cubic.Out' });
    }
    const workerBaseY = this.gridTop - 26;
    this.worker.y = workerBaseY + 10;
    this.tweens.add({ targets: this.worker, y: workerBaseY, duration: 140, ease: 'Cubic.Out' });
  }

  _withModalPause(fn) {
    if (!this.logic || !this.state?.alive || this.state?.inEvent) return;
    this._modalPausedByUI = !this.state.paused;
    if (this._modalPausedByUI) this.logic.setPaused(true);
    fn();
  }

  _closeUIModal() {
    this._clearRouletteTimer();
    this.modalLayer.removeAll(true);
    this.uiModalOpen = false;
    if (this._modalPausedByUI && this.logic && this.state?.alive && this.state?.paused) {
      this.logic.setPaused(false);
    }
    this._modalPausedByUI = false;
  }

  _clearRouletteTimer() {
    if (this.rouletteTimer) {
      this.rouletteTimer.remove(false);
      this.rouletteTimer = null;
    }
  }

  _showHintBar() {
    const y = HEIGHT - 74;
    const bar = this.add.container(0, 0).setDepth(40);
    const bg = this.add.rectangle(WIDTH / 2, y, WIDTH - 20, 32, 0x000000, 0.72).setStrokeStyle(1, 0x5a4a32);
    const text = this.add.text(14, y - 10, '點左半邊挖左、右半邊挖右。鍵盤：A/左、D/右、P 暫停。', {
      fontFamily: FONT_FAMILY, fontSize: '11px', color: '#f1ddba'
    });
    const okBtn = this.add.text(WIDTH - 62, y - 10, '知道了', {
      fontFamily: FONT_FAMILY, fontSize: '11px', color: '#f8f3e6',
      backgroundColor: '#3a2510', padding: { x: 6, y: 3 }
    }).setInteractive({ useHandCursor: true });
    okBtn.on('pointerdown', () => {
      saveHintDismissed();
      bar.destroy(true);
      this.hintBar = null;
    });
    bar.add([bg, text, okBtn]);
    this.hintBar = bar;
  }

  _showClearProgressModal() {
    const show = () => {
      this.modalLayer.removeAll(true);
      const panelW = WIDTH - 70;
      const panelH = 200;
      const x = WIDTH / 2;
      const y = HEIGHT / 2;
      const bg = this.add.rectangle(x, y, panelW, panelH, 0x000000, 0.94).setStrokeStyle(2, 0xe05050);
      this.uiModalOpen = true;
      const title = this.add.text(x, y - 74, '清除所有進度？', { fontFamily: FONT_FAMILY, fontSize: '20px', color: '#ffe58a' }).setOrigin(0.5, 0);
      const sub = this.add.text(x, y - 44, '包含拼圖與遺物解鎖。此動作無法復原。', { fontFamily: FONT_FAMILY, fontSize: '12px', color: '#a09070' }).setOrigin(0.5, 0);
      const yes = this.add.text(x - 60, y + 30, '確認', {
        fontFamily: FONT_FAMILY, fontSize: '14px', color: '#f8f3e6', backgroundColor: '#5a2418', padding: { x: 12, y: 5 }
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      const no = this.add.text(x + 60, y + 30, '取消', {
        fontFamily: FONT_FAMILY, fontSize: '14px', color: '#f8f3e6', backgroundColor: '#2b1b11', padding: { x: 12, y: 5 }
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      yes.on('pointerdown', () => {
        if (this.logic?.clearProgress) this.logic.clearProgress();
        this._closeUIModal();
      });
      no.on('pointerdown', () => this._closeUIModal());
      this.modalLayer.add([bg, title, sub, yes, no]);
    };

    if (this.state?.alive && !this.state?.inEvent) this._withModalPause(show);
    else show();
  }

  _relicDescriptions() {
    const unlocked = this.meta?.unlockedRelics || [];
    const list = [];
    if (unlocked.includes('extra_tool')) list.push('額外工具：每場開始時 +1 工具耐久');
    if (unlocked.includes('stone_resist')) list.push('石頭護符：每場開始時 +1 工具耐久');
    if (unlocked.includes('survey_aura')) list.push('探勘磁力：每場開始時最底兩層危險格轉泥土');
    return list;
  }

  _buildPuzzleGroups() {
    const groups = {};
    for (const p of (this.meta?.puzzlePieces || [])) {
      const key = `${p.id}_${p.size}`;
      if (!groups[key]) groups[key] = new Set();
      groups[key].add(p.index);
    }
    return groups;
  }

  _showCollectionModal() {
    this._withModalPause(() => {
      this.uiModalOpen = true;
      this.modalLayer.removeAll(true);

      const panelW = WIDTH - 44;
      const panelH = 560;
      const panelX = WIDTH / 2;
      const panelY = HEIGHT / 2;

      const bg = this.add.rectangle(panelX, panelY, panelW, panelH, 0x000000, 0.94).setStrokeStyle(2, 0xf6cf4a);
      this.modalLayer.add(bg);

      let y = panelY - panelH / 2 + 16;
      const addLine = (text, style = {}, center = false) => {
        const t = this.add.text(center ? panelX : panelX - panelW / 2 + 16, y, text, {
          fontFamily: FONT_FAMILY, fontSize: '14px', color: '#f8f3e6',
          wordWrap: { width: panelW - 32 },
          ...style
        }).setOrigin(center ? 0.5 : 0, 0);
        this.modalLayer.add(t);
        y += (t.height || 18) + 6;
        return t;
      };

      addLine('收藏一覽', { fontSize: '24px', color: '#ffe58a' }, true);
      const runs = this.meta?.runs ?? 0;
      const best = this.state?.bestDepth ?? 0;
      addLine(`遊戲數：${runs}　最佳深度：${best}`, { fontSize: '12px', color: '#c8b87e' }, true);
      y += 2;

      addLine('遺物', { fontSize: '16px', color: '#f6cf4a' });
      const relics = this._relicDescriptions();
      if (relics.length === 0) addLine('目前還沒有解鎖任何遺物', { fontSize: '13px', color: '#a09070' });
      for (const r of relics) addLine(`・${r}`, { fontSize: '13px', color: '#f8f3e6' });

      y += 4;
      addLine('拼圖', { fontSize: '16px', color: '#f6cf4a' });
      addLine('每到 20/40/60... 層有機會拿到拼圖；同張集滿後轉為永久遺物。', { fontSize: '12px', color: '#a09070' });

      const groups = this._buildPuzzleGroups();
      const keys = Object.keys(groups);
      if (keys.length === 0) {
        addLine('目前還沒有拼圖碎片。', { fontSize: '13px', color: '#a09070' });
      } else {
        for (const key of keys) {
          const [id, sizeRaw] = key.split('_');
          const size = Number(sizeRaw);
          const got = groups[key];
          const needed = size === 2 ? 4 : 9;
          const relicName = size === 3
            ? '石頭護符（開局 +1 工具耐久）'
            : id === 'C'
              ? '探勘磁力（最底危險格→泥土）'
              : '額外工具（開局 +1 工具耐久）';
          if (y > panelY + panelH / 2 - 96) {
            addLine('... 其餘內容請在後續局數查看', { fontSize: '12px', color: '#a09070' });
            break;
          }
          addLine(`拼圖 ${id}（${size}×${size}）：${got.size}/${needed} → ${relicName}`, { fontSize: '12px', color: '#f8f3e6' });

          const cellSize = 16;
          const gap = 3;
          const gridW = size * cellSize + (size - 1) * gap;
          const startX = panelX - panelW / 2 + 16;
          for (let i = 0; i < needed; i++) {
            const row = Math.floor(i / size);
            const col = i % size;
            const cx = startX + col * (cellSize + gap);
            const cy = y + row * (cellSize + gap);
            const owned = got.has(i);
            const rect = this.add.rectangle(cx + cellSize / 2, cy + cellSize / 2, cellSize, cellSize, owned ? 0xb58429 : 0x4c2814)
              .setOrigin(0.5)
              .setStrokeStyle(1, owned ? 0xffe58a : 0x7a6644);
            const n = this.add.text(cx + cellSize / 2, cy + cellSize / 2, String(i + 1), {
              fontFamily: FONT_FAMILY, fontSize: '10px', color: owned ? '#fffbe6' : '#a09070'
            }).setOrigin(0.5);
            this.modalLayer.add([rect, n]);
          }
          y += Math.ceil(needed / size) * (cellSize + gap) + 10;
          if (startX + gridW > panelX + panelW / 2) break;
        }
      }

      const closeBtn = this.add.text(panelX, panelY + panelH / 2 - 34, '關閉', {
        fontFamily: FONT_FAMILY, fontSize: '16px', color: '#ffe58a',
        backgroundColor: '#2b1b11', padding: { x: 16, y: 7 }
      }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
      closeBtn.on('pointerdown', () => this._closeUIModal());
      this.modalLayer.add(closeBtn);
    });
  }

  _showHelpModal() {
    this._withModalPause(() => {
      this.uiModalOpen = true;
      this.modalLayer.removeAll(true);

      const panelW = WIDTH - 58;
      const panelH = 330;
      const panelX = WIDTH / 2;
      const panelY = HEIGHT / 2;

      const bg = this.add.rectangle(panelX, panelY, panelW, panelH, 0x000000, 0.94).setStrokeStyle(2, 0xf6cf4a);
      this.modalLayer.add(bg);

      let y = panelY - panelH / 2 + 18;
      const left = panelX - panelW / 2 + 16;
      const add = (text, style = {}) => {
        const t = this.add.text(left, y, text, {
          fontFamily: FONT_FAMILY, fontSize: '14px', color: '#f8f3e6',
          wordWrap: { width: panelW - 32 },
          ...style
        });
        this.modalLayer.add(t);
        y += (t.height || 18) + 8;
      };

      const title = this.add.text(panelX, y, '鍵盤操作', { fontFamily: FONT_FAMILY, fontSize: '24px', color: '#ffe58a' }).setOrigin(0.5, 0);
      this.modalLayer.add(title);
      y += (title.height || 28) + 12;

      add('A / ←：挖左側');
      add('D / →：挖右側');
      add('W / S / 空白：沿上次方向挖');
      add('1 / 2 / 3：事件時選擇選項');
      add('P / Esc：暫停 / 繼續');
      add('C：開啟收藏　H：開啟說明', { color: '#c8b87e' });

      const closeBtn = this.add.text(panelX, panelY + panelH / 2 - 38, '關閉', {
        fontFamily: FONT_FAMILY, fontSize: '16px', color: '#ffe58a',
        backgroundColor: '#2b1b11', padding: { x: 16, y: 7 }
      }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
      closeBtn.on('pointerdown', () => this._closeUIModal());
      this.modalLayer.add(closeBtn);
    });
  }

  _tileStyle(type) {
    if (type === 'stone')   return { color: 0x5c5450, texture: 'tile_stone',   alpha: 1 };
    if (type === 'diamond') return { color: 0x7fb3d1, texture: 'tile_diamond', alpha: 1 };
    if (type === 'event')   return { color: 0xa4572f, texture: 'tile_event',   alpha: 1 };
    if (type === 'puzzle')  return { color: 0xc79532, texture: 'tile_puzzle',  alpha: 1 };
    if (type === 'empty')   return { color: 0x2d180c, texture: 'tile_empty',   alpha: 0.45 };
    return { color: 0x4c2814, texture: 'tile_dirt', alpha: 1 };
  }

  _renderTiles(col, tiles) {
    for (let i = 0; i < 5; i++) {
      const cfg = this._tileStyle(tiles[i]);
      col[i].bg.setFillStyle(cfg.color);
      col[i].sprite.setTexture(cfg.texture).setAlpha(cfg.alpha);
    }
  }

  // ─── Toast system ────────────────────────────────────────────────
  _showToast(text, color = '#ffe58a', duration = 1400) {
    const y0 = HEIGHT - 130 - this.toasts.length * 34;
    const t = this.add.text(WIDTH / 2, y0, text, {
      fontFamily: FONT_FAMILY, fontSize: '16px', color,
      backgroundColor: '#000000aa', padding: { x: 12, y: 6 }
    }).setOrigin(0.5, 1).setDepth(90).setAlpha(0);
    this.toasts.push(t);
    this.tweens.add({ targets: t, alpha: 1, duration: 120, onComplete: () => {
      this.tweens.add({ targets: t, alpha: 0, delay: duration - 200, duration: 200, onComplete: () => {
        t.destroy();
        this.toasts = this.toasts.filter(x => x !== t);
      }});
    }});
  }

  _tryRestartOverlay() {
    // Called from R key — clear modal and show difficulty
    this.modalLayer.removeAll(true);
    this._showDifficultyModal(diff => {
      if (this._restartFn) { this._restartFn(diff); this._restartFn = null; }
      else { this.logic.startRun(diff); }
    });
  }

  // ────────────────────────────────────────────────────────────────
  // Game callbacks
  // ────────────────────────────────────────────────────────────────

  _onMeta(meta, lastPuzzlePiece) {
    const prevCount = this.lastPuzzleCount;
    this.meta = meta;
    const currCount = meta?.puzzlePieces?.length ?? 0;
    if (prevCount !== null && currCount > prevCount && lastPuzzlePiece) {
      const { id, size, index } = lastPuzzlePiece;
      const needed = size === 2 ? 4 : 9;
      const groups = {};
      for (const p of (meta.puzzlePieces || [])) {
        const k = `${p.id}_${p.size}`;
        if (!groups[k]) groups[k] = new Set();
        groups[k].add(p.index);
      }
      const uniqueCount = (groups[`${id}_${size}`]?.size) || 0;
      this._showToast(`獲得 拼圖${id}（${size}×${size}）第 ${(index ?? 0) + 1} 片（${uniqueCount}/${needed}）`, '#c8d87e', 1400);
    }
    this.lastPuzzleCount = currCount;
    // Update bottom info
    if (this.infoText) {
      const runs = meta?.runs ?? 0;
      const pieces = currCount;
      const scoreText = this.state?.score > 0 ? `　分 ${this.state.score}` : '';
      this.infoText.setText(`地面 · 遊戲數 ${runs} · 收穫拼圖 ${pieces}${scoreText}`);
    }
    if (this.relicText) {
      const relics = this.meta?.unlockedRelics || [];
      const tags = [];
      if (relics.includes('extra_tool')) tags.push('+');
      if (relics.includes('stone_resist')) tags.push('岩');
      if (relics.includes('survey_aura')) tags.push('勘');
      this.relicText.setText(tags.length ? `遺物 ${tags.join(' ')}` : '遺物 -');
    }
  }

  _spawnDamagePopup(dmg) {
    const x = this.worker.x + Phaser.Math.Between(-20, 20);
    const y = this.worker.y - 20;
    const t = this.add.text(x, y, `-${dmg}`, {
      fontFamily: FONT_FAMILY, fontSize: '22px', color: '#ff6644',
      stroke: '#000000', strokeThickness: 3
    }).setOrigin(0.5, 1).setDepth(80);
    this.tweens.add({ targets: t, y: y - 50, alpha: 0, duration: 700, ease: 'Power1', onComplete: () => t.destroy() });
  }

  _onUpdate(state) {
    this.prevState = this.state;
    this.state = state;

    // ── HUD
    this.depthText.setText(`深度: ${state.depth}`);
    this.toolsText.setText(`工具: ${state.tools}`);
    this.bestText.setText( `最佳: ${state.bestDepth}`);
    this.scoreText.setText(state.score > 0 ? `分 ${state.score}` : '');
    if (this.pauseBtn) this.pauseBtn.setText(state.paused ? '繼續' : '暫停');

    const streak = state.safeStreak || 0;
    if (streak >= 5) {
      const tier = streak >= 20 ? '極速' : streak >= 10 ? '高速' : '穩定';
      this.streakText.setText(`${tier} 連挖 x${streak}`);
    } else {
      this.streakText.setText('');
    }

    if (!state.alive)        this.statusText.setText('工具壞掉了');
    else if (state.paused)   this.statusText.setText('⏸ 已暫停');
    else if (state.inEvent)  this.statusText.setText(this.eventMode === 'roulette' ? '轉盤旋轉中…' : '事件中，按 1/2/3 選擇');
    else if (state.autoDigActive) this.statusText.setText(`自動挖掘（${state.autoDigSide === 'left' ? '左' : '右'}）`);
    else                     this.statusText.setText('');

    const maxTools = state.maxTools || state.tools || 1;
    const toolRatio = Math.max(0, Math.min(1, state.tools / maxTools));
    this.toolMeterFill.width = 90 * toolRatio;
    if (toolRatio > 0.6) this.toolMeterFill.setFillStyle(0x52d48a);
    else if (toolRatio > 0.3) this.toolMeterFill.setFillStyle(0xf6cf4a);
    else this.toolMeterFill.setFillStyle(0xe05050);

    if (state.goldPlatingActive) this.toolsText.setStyle({ backgroundColor: '#7a6400aa', color: '#fff4b0' });
    else this.toolsText.setStyle({ backgroundColor: '#00000044', color: '#f8f3e6' });

    // ── Tiles
    this._renderTiles(this.leftTiles,  state.previews.left);
    this._renderTiles(this.rightTiles, state.previews.right);

    // ── Worker position for auto-dig
    if (state.autoDigSide) this._placeWorker(state.autoDigSide);

    // ── AutoDig bar
    if (state.autoDigActive) {
      const remaining = Math.max(0, state.autoDigRemainingMs || 0);
      const total = 5000;
      const ratio = Math.min(1, remaining / total);
      this.autoDigBar.width = WIDTH * ratio;
      this.autoDigLabel.setText(`自動挖掘 ${(remaining / 1000).toFixed(1)}s`);
    } else {
      this.autoDigBar.width = 0;
      this.autoDigLabel.setText('');
    }

    // ── Background depth tint
    const depthRatio = Math.min(1, state.depth / 150);
    const shade = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(0x2b1b11),
      Phaser.Display.Color.ValueToColor(0x0f0906),
      100, Math.round(depthRatio * 100)
    );
    this.cameras.main.setBackgroundColor(Phaser.Display.Color.GetColor(shade.r, shade.g, shade.b));

    // ── SFX + damage popup on state changes
    if (this.prevState) {
      if (state.depth > (this.prevState.depth || 0)) {
        this._playDigScroll();
      }
      const dmg = this.prevState.tools - state.tools;
      if (dmg > 0) {
        sfx.hit();
        this._spawnDamagePopup(dmg);
      }
      if (state.stats?.diamondsHit > (this.prevState.stats?.diamondsHit || 0)) sfx.diamond();
    }

    // ── Depth bonus toast
    if (state.depthBonus && (!this.prevState?.depthBonus || state.depthBonus.time !== this.prevState.depthBonus.time)) {
      const m = state.depthBonus.depth / 50;
      const bonus = m % 2 === 0 ? '+1 工具耐久！' : '鍍金護盾！';
      this._showToast(`深度 ${state.depthBonus.depth} 獎勵：${bonus}`, '#f6cf4a', 1800);
      sfx.milestone();
    }

    // ── Streak bonus toast
    if (state.streakBonus && (!this.prevState?.streakBonus || state.streakBonus.time !== this.prevState.streakBonus.time)) {
      this._showToast(`${state.streakBonus.streak} 連挖：耐久 +1`, '#f6cf4a', 1400);
      sfx.milestone();
    }

    // ── Milestone toasts
    if (state.alive && state.depth > this.lastMilestone) {
      for (const m of MILESTONES) {
        if (state.depth >= m && this.lastMilestone < m) {
          this._showToast(`里程碑 深度 ${m}`, '#ffe58a', 1200);
          sfx.milestone();
          this.lastMilestone = m;
          break;
        }
      }
    }
    if (!state.alive) this.lastMilestone = 0;
  }

  _onEvent(eventData, done) {
    this.uiModalOpen = true;
    this.inEvent = true;
    this.eventDone = done;
    this.eventOptions = eventData.options.slice(0, 3);
    this.eventMode = eventData.mode || 'choice';
    sfx.event();

    this._clearRouletteTimer();
    this.modalLayer.removeAll(true);

    const panelW = WIDTH - 40;
    const panelH = 300;
    const panelX = WIDTH / 2;
    const panelY = HEIGHT / 2;

    const bg = this.add.rectangle(panelX, panelY, panelW, panelH, 0x000000, 0.92).setStrokeStyle(2, 0xf6cf4a);
    const title = this.add.text(panelX, panelY - 120, eventData.title || '地底事件', { fontFamily: FONT_FAMILY, fontSize: '24px', color: '#ffe58a' }).setOrigin(0.5, 0);
    const desc = this.add.text(panelX, panelY - 84, eventData.desc || '', {
      fontFamily: FONT_FAMILY, fontSize: '15px', color: '#f8f3e6', wordWrap: { width: panelW - 40 }
    }).setOrigin(0.5, 0);
    this.modalLayer.add([bg, title, desc]);

    if (this.eventMode === 'roulette') {
      const cards = [];
      const cardW = panelW - 70;
      const startY = panelY - 24;
      for (let i = 0; i < this.eventOptions.length; i++) {
        const opt = this.eventOptions[i];
        const y = startY + i * 62;
        const card = this.add.rectangle(panelX, y + 18, cardW, 52, 0x3a2510).setStrokeStyle(2, 0x7a5a2a);
        const label = this.add.text(panelX, y + 4, `${opt.title} - ${opt.desc}`, {
          fontFamily: FONT_FAMILY, fontSize: '14px', color: '#f8f3e6', wordWrap: { width: cardW - 22 }, align: 'center'
        }).setOrigin(0.5, 0);
        cards.push({ card, label });
        this.modalLayer.add([card, label]);
      }
      const hint = this.add.text(panelX, panelY + 108, '轉盤旋轉中…', {
        fontFamily: FONT_FAMILY, fontSize: '13px', color: '#a09070'
      }).setOrigin(0.5, 0);
      this.modalLayer.add(hint);

      let idx = 0;
      let ticks = 0;
      let resolved = false;
      const maxTicks = 12 + Math.floor(Math.random() * 6);

      const setActive = (activeIdx) => {
        for (let i = 0; i < cards.length; i++) {
          const active = i === activeIdx;
          cards[i].card.setFillStyle(active ? 0xb58429 : 0x3a2510);
          cards[i].label.setColor(active ? '#fffbe6' : '#f8f3e6');
          cards[i].card.setAlpha(active ? 1 : 0.85);
          cards[i].label.setAlpha(active ? 1 : 0.9);
        }
      };

      this.rouletteTimer = this.time.addEvent({
        delay: 120,
        loop: true,
        callback: () => {
          if (resolved || !this.inEvent) {
            this._clearRouletteTimer();
            return;
          }
          setActive(idx);
          idx = (idx + 1) % cards.length;
          ticks += 1;
          if (ticks >= maxTicks) {
            resolved = true;
            this._clearRouletteTimer();
            const finalIndex = (idx + cards.length - 1) % cards.length;
            setActive(finalIndex);
            hint.setText(`獲得：${this.eventOptions[finalIndex].title}`);
            this.time.delayedCall(1500, () => {
              if (this.inEvent) this._resolveEventChoice(this.eventOptions[finalIndex]);
            });
          }
        }
      });
      return;
    }

    for (let i = 0; i < this.eventOptions.length; i++) {
      const opt = this.eventOptions[i];
      const y = panelY - 10 + i * 60;
      const btn = this.add.text(panelX, y, `${i + 1}. ${opt.title} - ${opt.desc}`, {
        fontFamily: FONT_FAMILY, fontSize: '15px', color: '#f8f3e6',
        backgroundColor: '#3a2510', padding: { x: 12, y: 8 },
        wordWrap: { width: panelW - 60 }
      }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
      btn.on('pointerover', () => btn.setStyle({ color: '#ffe58a' }));
      btn.on('pointerout', () => btn.setStyle({ color: '#f8f3e6' }));
      btn.on('pointerdown', () => this._handleEventChoice(i));
      this.modalLayer.add(btn);
    }
  }

  _resolveEventChoice(choice) {
    if (!this.inEvent || !this.eventDone || !choice) return;
    this.inEvent = false;
    const done = this.eventDone;
    this.eventDone = null;
    this.eventMode = 'choice';
    this._clearRouletteTimer();
    this.modalLayer.removeAll(true);
    this.uiModalOpen = false;
    done(choice);
  }

  _handleEventChoice(index) {
    if (!this.inEvent || !this.eventDone || this.eventMode !== 'choice') return;
    const choice = this.eventOptions[index];
    if (!choice) return;
    this._resolveEventChoice(choice);
  }

  _onGameOver(restart) {
    this.uiModalOpen = true;
    sfx.gameOver();
    this._restartFn = restart;
    this._clearRouletteTimer();
    this.cameras.main.shake(350, 0.015);

    const score       = this.state.score || 0;
    const isNewScore  = score > this.bestScore;
    if (isNewScore) { this.bestScore = score; saveBestScore(score); }

    const leaderboard = addLeaderboardEntry({
      depth:      this.state.depth,
      score,
      difficulty: this.state.difficulty || 'normal',
      date:       new Date().toLocaleDateString('zh-TW')
    });

    this.modalLayer.removeAll(true);

    const panelW = WIDTH - 40;
    const panelX = WIDTH / 2;
    let   curY   = HEIGHT / 2 - 160;

    const bg = this.add.rectangle(panelX, HEIGHT / 2, panelW, 420, 0x000000, 0.92).setStrokeStyle(2, 0xe05050);
    this.modalLayer.add(bg);

    const addLine = (text, style = {}) => {
      const t = this.add.text(panelX, curY, text, {
        fontFamily: FONT_FAMILY, fontSize: '18px', color: '#f8f3e6', ...style
      }).setOrigin(0.5, 0);
      this.modalLayer.add(t);
      curY += (t.height || 26) + 6;
      return t;
    };

    const isRecord = this.state.depth > 0 && this.state.depth >= (this.state.bestDepth || 0);
    addLine(isRecord ? '新紀錄' : '工具全壞了', { fontSize: '28px', color: isRecord ? '#d89b31' : '#ffe58a' });
    curY += 4;
    addLine(`本次深度：${this.state.depth}`);
    addLine(`上次最佳：${this.state.bestDepth || 0}`, { fontSize: '13px', color: '#a09070' });
    addLine(isNewScore ? `最高分：${score}` : `分數：${score}`, { color: isNewScore ? '#d89b31' : '#a09070', fontSize: '15px' });
    if (this.state.maxSafeStreak >= 3) {
      addLine(`最長安全連挖：${this.state.maxSafeStreak} 格`, { fontSize: '13px', color: '#c8b87e' });
    }
    if (this.state.stats) {
      const { stonesHit, diamondsHit, eventsTriggered } = this.state.stats;
      addLine(`石頭 ${stonesHit}　鑽石 ${diamondsHit}　事件 ${eventsTriggered}`, { fontSize: '13px', color: '#c8b87e' });
    }

    // Leaderboard
    if (leaderboard.length > 0) {
      curY += 4;
      addLine('本機排行 Top 5', { fontSize: '13px', color: '#f6cf4a' });
      for (let i = 0; i < leaderboard.length; i++) {
        const e = leaderboard[i];
        const diffLabel = e.difficulty === 'easy' ? '簡' : e.difficulty === 'hard' ? '難' : '普';
        addLine(`${i + 1}. 分${e.score}　深${e.depth}　${diffLabel}　${e.date || ''}`, { fontSize: '12px', color: '#a09070' });
      }
    }

    curY += 8;
    const restartBtn = this.add.text(panelX, curY, '[ 回到地面 ]', {
      fontFamily: FONT_FAMILY, fontSize: '20px', color: '#ffe58a',
      backgroundColor: '#2b1b11', padding: { x: 16, y: 8 }
    }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
    restartBtn.on('pointerover',  () => restartBtn.setStyle({ color: '#ffffff' }));
    restartBtn.on('pointerout',   () => restartBtn.setStyle({ color: '#ffe58a' }));
    restartBtn.on('pointerdown',  () => this._tryRestartOverlay());
    this.modalLayer.add(restartBtn);
    addLine('（按 R 重新開始）', { fontSize: '12px', color: '#604830' });
  }

  // ── Difficulty selection modal ────────────────────────────────────
  _showDifficultyModal(onSelect) {
    this.uiModalOpen = true;
    this.modalLayer.removeAll(true);

    const panelW = WIDTH - 60;
    const panelX = WIDTH / 2;
    const panelY = HEIGHT / 2 - 60;

    const bg    = this.add.rectangle(panelX, panelY, panelW, 260, 0x000000, 0.92).setStrokeStyle(2, 0xf6cf4a);
    const title = this.add.text(panelX, panelY - 110, '選擇難度', { fontFamily: FONT_FAMILY, fontSize: '26px', color: '#ffe58a' }).setOrigin(0.5, 0);
    const sub   = this.add.text(panelX, panelY - 76, '難度會影響初始耐久與危險格機率', { fontFamily: FONT_FAMILY, fontSize: '13px', color: '#a09070' }).setOrigin(0.5, 0);
    this.modalLayer.add([bg, title, sub]);

    const diffs = [
      { key: 'easy',   label: '簡單', sub: '初始 9 耐久，石頭少' },
      { key: 'normal', label: '普通', sub: '初始 6 耐久，標準石頭' },
      { key: 'hard',   label: '困難', sub: '初始 4 耐久，石頭更多' },
    ];
    const cardW = 118;
    const cardH = 118;
    const gap = 10;
    const startX = panelX - (cardW * 3 + gap * 2) / 2 + cardW / 2;
    const cardY = panelY + 20;
    for (let i = 0; i < diffs.length; i++) {
      const d = diffs[i];
      const x = startX + i * (cardW + gap);
      const card = this.add.rectangle(x, cardY, cardW, cardH, 0x3a2510).setStrokeStyle(2, 0x7a5a2a).setInteractive({ useHandCursor: true });
      const label = this.add.text(x, cardY - 28, d.label, {
        fontFamily: FONT_FAMILY, fontSize: '22px', color: '#f8f3e6', align: 'center'
      }).setOrigin(0.5);
      const subLabel = this.add.text(x, cardY + 20, d.sub, {
        fontFamily: FONT_FAMILY, fontSize: '13px', color: '#c8b87e', align: 'center',
        wordWrap: { width: cardW - 16 }
      }).setOrigin(0.5);
      card.on('pointerover', () => { card.setFillStyle(0x4c3118); label.setColor('#ffe58a'); });
      card.on('pointerout', () => { card.setFillStyle(0x3a2510); label.setColor('#f8f3e6'); });
      card.on('pointerdown', () => {
        this.uiModalOpen = false;
        this.modalLayer.removeAll(true);
        onSelect(d.key);
      });
      this.modalLayer.add([card, label, subLabel]);
    }
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width:  WIDTH,
  height: HEIGHT,
  parent: 'app',
  backgroundColor: '#2b1b11',
  scene: [DiggerScene],
  render: { antialias: false, pixelArt: true, roundPixels: true },
  scale:  { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }
});
