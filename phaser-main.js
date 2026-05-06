import { Game, choiceIndexForEventKey } from './game.js?v=20260506-eventkeys';
import { loadMute, saveMute, loadHintDismissed, saveHintDismissed, loadBestScore, saveBestScore, addLeaderboardEntry } from './storage.js';

const Phaser = globalThis.Phaser;
if (!Phaser) {
  throw new Error('Phaser global not found. Ensure phaser.min.js is loaded before phaser-main.js.');
}

const WIDTH  = 480;
const HEIGHT = 800;
const MILESTONES = [5, 10, 20, 30, 50, 75, 100, 150, 200];
const FONT_FAMILY = 'Noto Sans TC, PingFang TC, Microsoft JhengHei, sans-serif';
const PIXEL_FONT = 'monospace';
const TILE_FIT_MODE = 'cover';
const TILE_TYPES_FOR_FX = ['dirt', 'stone', 'diamond', 'event', 'puzzle', 'empty'];

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
    window.dispatchEvent(new CustomEvent('yam:loading-progress', {
      detail: { text: '載入素材中…', progress: 0.36 }
    }));
    this.load.on('progress', progress => {
      window.dispatchEvent(new CustomEvent('yam:loading-progress', {
        detail: { text: `載入素材中… ${Math.round(progress * 100)}%`, progress: 0.36 + progress * 0.52 }
      }));
    });
    this.load.once('complete', () => {
      window.dispatchEvent(new CustomEvent('yam:loading-progress', {
        detail: { text: '準備地底中…', progress: 0.94 }
      }));
    });

    this.load.spritesheet('worker', 'assets/sprite-forge/minipack/worker_front_idle_dig.png?v=20260506-v8-128', {
      frameWidth: 128,
      frameHeight: 128
    });
    this.load.spritesheet('dig_fx_tiles', 'assets/sprite-forge/minipack/dig_fx_tiles.png?v=20260506-v7', {
      frameWidth: 64,
      frameHeight: 64
    });
    this.load.image('ui_panel', 'assets/ui/ui_panel.png');
    this.load.image('bg_gameplay', 'assets/ui/gameplay/bg_gameplay_raw.png');
    this.load.image('tile_dirt',    'assets/ui/gameplay/tile_dirt_v2.png');
    this.load.image('tile_stone',   'assets/ui/gameplay/tile_stone_v2.png');
    this.load.image('tile_diamond', 'assets/ui/gameplay/tile_diamond_v2.png');
    this.load.image('tile_event',   'assets/ui/gameplay/tile_event_v2.png');
    this.load.image('tile_puzzle',  'assets/ui/gameplay/tile_puzzle_v2.png');
    this.load.image('tile_empty',   'assets/ui/gameplay/tile_empty_v2.png');
  }

  create() {
    _muted = loadMute();
    this.bestScore = loadBestScore();
    this._applyNearestFilters();

    // ── Background
    this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x130b04);
    this.add.image(WIDTH / 2, HEIGHT / 2, 'bg_gameplay').setDisplaySize(WIDTH, HEIGHT).setAlpha(0.5);
    // HUD background (120px tall)
    this.add.rectangle(WIDTH / 2, 60, WIDTH, 120, 0x1a1009);
    this.add.rectangle(WIDTH / 2, HEIGHT - 26, WIDTH, 52, 0x1a1009);
    // HUD bottom separator & button bar top separator
    this.add.line(WIDTH / 2, 120, 0, 0, WIDTH, 0, 0x3a2510, 1).setLineWidth(2, 2);
    this.add.line(WIDTH / 2, HEIGHT - 52, 0, 0, WIDTH, 0, 0x3a2510, 1).setLineWidth(2, 2);
    // HUD column separators
    this.add.line(160, 60, 0, -50, 0, 50, 0x3a2510, 1).setLineWidth(1, 1);
    this.add.line(320, 60, 0, -50, 0, 50, 0x3a2510, 1).setLineWidth(1, 1);

    this._createUITextures();

    // ── HUD row 1: depth / tools / best  (centered in each third)
    const hudStyle = { fontFamily: PIXEL_FONT, fontSize: '15px', color: '#f3e5b8' };
    this.depthText = this.add.text(80,  14, '深度 0', hudStyle).setOrigin(0.5, 0);
    this.toolsText = this.add.text(240, 14, '工具 0', hudStyle).setOrigin(0.5, 0);
    this.bestText  = this.add.text(400, 14, '最佳 0', hudStyle).setOrigin(0.5, 0);

    // Tool durability meter (centered under 工具)
    this.toolMeterTrack = this.add.rectangle(240, 40, 120, 8, 0x2a1808).setOrigin(0.5, 0).setStrokeStyle(1, 0x5a4020);
    this.toolMeterFill = this.add.rectangle(181, 41, 118, 6, 0xf6cf4a).setOrigin(0, 0);

    // ── HUD row 2: score + streak
    const subStyle = { fontFamily: PIXEL_FONT, fontSize: '13px', color: '#d9c381' };
    this.scoreText  = this.add.text(80,  58, '', subStyle).setOrigin(0.5, 0);
    this.streakText = this.add.text(240, 58, '', subStyle).setOrigin(0.5, 0);

    // ── Status line
    this.statusText = this.add.text(WIDTH / 2, 78, '', { fontFamily: PIXEL_FONT, fontSize: '12px', color: '#e8d8a0' }).setOrigin(0.5, 0);

    // ── AutoDig bar
    this.autoDigBar   = this.add.rectangle(WIDTH / 2, 99, 0, 7, 0xf6cf4a).setOrigin(0.5, 0);
    this.autoDigLabel = this.add.text(12, 96, '', { fontFamily: PIXEL_FONT, fontSize: '11px', color: '#f6cf4a' });

    // ── Tile grid
    const sidePadding = 18;
    const colGap = 18;
    this.colW = (WIDTH - sidePadding * 2 - colGap) / 2;
    this.leftColX  = sidePadding + this.colW / 2;
    this.rightColX = WIDTH - sidePadding - this.colW / 2;
    this.gridTop   = 220;
    this.tileH     = 105;
    this.leftTiles  = this._createTileColumn(this.leftColX);
    this.rightTiles = this._createTileColumn(this.rightColX);

    this.anims.create({
      key: 'worker-idle',
      frames: this.anims.generateFrameNumbers('worker', { start: 0, end: 3 }),
      frameRate: 4,
      repeat: -1
    });
    this.anims.create({
      key: 'worker-dig',
      frames: this.anims.generateFrameNumbers('worker', { start: 4, end: 7 }),
      frameRate: 10,
      repeat: 0
    });
    this._createDigFxAnimations();

    // ── Worker animation
    this.worker = this.add.sprite(this.leftColX - 36, this._workerStandY(), 'worker', 0)
      .setDisplaySize(96, 96)
      .setOrigin(0.5, 1)
      .play('worker-idle');
    this.worker.on('animationcomplete-worker-dig', () => this.worker.play('worker-idle'));
    // ── Input zones
    const leftZone  = this.add.zone(0,        0, WIDTH / 2, HEIGHT).setOrigin(0).setInteractive();
    const rightZone = this.add.zone(WIDTH / 2, 0, WIDTH / 2, HEIGHT).setOrigin(0).setInteractive();
    leftZone.on('pointerdown',  () => this._dig('left'));
    rightZone.on('pointerdown', () => this._dig('right'));

    const kb = this.input.keyboard;
    kb.on('keydown-LEFT',  () => this._handleDigOrEventKey('ArrowLeft', 'left'));
    kb.on('keydown-A',     () => this._dig('left'));
    kb.on('keydown-RIGHT', () => this._handleDigOrEventKey('ArrowRight', 'right'));
    kb.on('keydown-D',     () => this._dig('right'));
    kb.on('keydown-UP',    () => this._handleEventKey('ArrowUp'));
    kb.on('keydown-DOWN',  () => this._handleEventKey('ArrowDown'));
    kb.on('keydown-W',     () => this._dig(this.lastManualSide));
    kb.on('keydown-S',     () => this._dig(this.lastManualSide));
    kb.on('keydown-SPACE', () => this._dig(this.lastManualSide));
    kb.on('keydown-ONE',   () => this._handleEventKey('1'));
    kb.on('keydown-TWO',   () => this._handleEventKey('2'));
    kb.on('keydown-THREE', () => this._handleEventKey('3'));
    kb.on('keydown-R',     () => { if (this.state && !this.state.alive) this._tryRestartOverlay(); });
    kb.on('keydown-P',     () => { if (this.logic && this.state?.alive && !this.state?.inEvent) this.logic.togglePause(); });
    kb.on('keydown-ESC',   () => { if (this.logic && this.state?.alive && !this.state?.inEvent) this.logic.togglePause(); });
    kb.on('keydown-C',     () => this._showCollectionModal());
    kb.on('keydown-H',     () => this._showHelpModal());

    // ── Bottom button bar (graphical)
    // 6 buttons across WIDTH=480: each ~80px wide
    const btnY  = HEIGHT - 26;
    const btnW  = 76, btnH = 30;
    const btnGap = (WIDTH - 6 * btnW) / 7;  // even spacing with margins
    const mkBtn = (idx, label, accent = false) => {
      const cx = btnGap + btnW / 2 + idx * (btnW + btnGap);
      const g = this.add.graphics();
      const fill = accent ? 0x3c200e : 0x221208;
      const border = accent ? 0xd4920a : 0x7a5520;
      g.fillStyle(fill, 1);
      g.fillRect(cx - btnW / 2, btnY - btnH / 2, btnW, btnH);
      g.lineStyle(1, border, 1);
      g.strokeRect(cx - btnW / 2 + 0.5, btnY - btnH / 2 + 0.5, btnW - 1, btnH - 1);
      // top highlight
      g.lineStyle(1, 0x6a4020, 0.5);
      g.strokeLineShape(new Phaser.Geom.Line(cx - btnW / 2 + 2, btnY - btnH / 2 + 1, cx + btnW / 2 - 3, btnY - btnH / 2 + 1));
      // bottom shadow
      g.lineStyle(1, 0x110800, 0.8);
      g.strokeLineShape(new Phaser.Geom.Line(cx - btnW / 2 + 1, btnY + btnH / 2 - 2, cx + btnW / 2 - 2, btnY + btnH / 2 - 2));
      const col = accent ? '#f6cf4a' : '#d9c381';
      const t = this.add.text(cx, btnY, label, { fontFamily: PIXEL_FONT, fontSize: '12px', color: col })
        .setOrigin(0.5).setInteractive({ useHandCursor: true });
      t.on('pointerover', () => { t.setColor('#ffffff'); g.clear(); g.fillStyle(accent ? 0x5a3010 : 0x3a2010, 1); g.fillRect(cx - btnW / 2, btnY - btnH / 2, btnW, btnH); g.lineStyle(1, 0xf6cf4a, 1); g.strokeRect(cx - btnW / 2 + 0.5, btnY - btnH / 2 + 0.5, btnW - 1, btnH - 1); });
      t.on('pointerout',  () => { t.setColor(col); g.clear(); g.fillStyle(fill, 1); g.fillRect(cx - btnW / 2, btnY - btnH / 2, btnW, btnH); g.lineStyle(1, border, 1); g.strokeRect(cx - btnW / 2 + 0.5, btnY - btnH / 2 + 0.5, btnW - 1, btnH - 1); });
      return t;
    };
    this.pauseBtn      = mkBtn(0, '暫停');
    this.pauseBtn.on('pointerdown', () => { if (this.logic && this.state?.alive && !this.state?.inEvent) this.logic.togglePause(); });
    this.muteBtn       = mkBtn(1, _muted ? '靜音' : '音效');
    this.muteBtn.on('pointerdown', () => { _muted = !_muted; saveMute(_muted); this.muteBtn.setText(_muted ? '靜音' : '音效'); });
    this.helpBtn       = mkBtn(2, '說明');
    this.helpBtn.on('pointerdown', () => this._showHelpModal());
    this.collectionBtn = mkBtn(3, '收藏');
    this.collectionBtn.on('pointerdown', () => this._showCollectionModal());
    this.restartBtn    = mkBtn(4, '重開', true);
    this.restartBtn.on('pointerdown', () => { if (!this.logic) return; this._showDifficultyModal(diff => this.logic.startRun(diff)); });
    this.clearBtn      = mkBtn(5, '清進度');
    this.clearBtn.on('pointerdown', () => this._showClearProgressModal());

    this.relicText = this.add.text(WIDTH / 2, 100, '', {
      fontFamily: PIXEL_FONT, fontSize: '11px', color: '#c8b87e'
    }).setOrigin(0.5, 0).setDepth(5);

    // ── Bottom info bar (sits below buttons)
    this.infoText = this.add.text(12, HEIGHT - 14, '', {
      fontFamily: PIXEL_FONT, fontSize: '10px', color: '#8f7a5a'
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

    // ── Start directly so gameplay visuals are immediately visible.
    this.logic.startRun('normal');
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('yam:game-ready'));
    });
  }

  // ────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────

  _createTileColumn(x) {
    const arr = [];
    for (let i = 0; i < 5; i++) {
      const baseY = this.gridTop + i * this.tileH;
      // Use TileSprite to fill each cell without stretching source pixels.
      const sprite = this.add.tileSprite(x, baseY, this.colW, this.tileH + 1, 'tile_dirt').setOrigin(0.5, 0);
      arr.push({ sprite, baseY });
    }
    return arr;
  }

  _applyNearestFilters() {
    const filter = Phaser.Textures.FilterMode.NEAREST;
    [
      'worker',
      'dig_fx_tiles',
      'tile_dirt',
      'tile_stone',
      'tile_diamond',
      'tile_event',
      'tile_puzzle',
      'tile_empty'
    ].forEach(key => {
      const tex = this.textures.get(key);
      if (tex) tex.setFilter(filter);
    });
  }

  _createDigFxAnimations() {
    for (const [row, type] of TILE_TYPES_FOR_FX.entries()) {
      this.anims.create({
        key: `dig-fx-${type}`,
        frames: this.anims.generateFrameNumbers('dig_fx_tiles', { start: row * 4, end: row * 4 + 3 }),
        frameRate: 14,
        repeat: 0
      });
    }
  }

  _workerStandY() {
    // Feet at top of first tile row; head at gridTop-72 = ~114, just below HUD (ends y=108).
    return this.gridTop;
  }
  
  _refreshTileLayout() {
    for (const col of [this.leftTiles, this.rightTiles]) {
      for (const t of col) {
        t.sprite.width = this.colW;
        t.sprite.height = this.tileH + 1;
      }
    }
  }

  _placeWorker(side) {
    this.worker.x = side === 'left' ? this.leftColX - 34 : this.rightColX - 34;
    this.worker.y = this._workerStandY();
    this.worker.setFlipX(false);
  }

  _dig(side) {
    if (!this.logic || !this.state?.alive || this.state?.inEvent || this.state?.paused || this.uiModalOpen) return;
    if (this.state.autoDigActive) { this.logic.switchAutoSide(side); this._placeWorker(side); return; }
    this.lastManualSide = side;
    this._placeWorker(side);
    this._playWorkerDig();
    sfx.dig();
    this.logic.step(side);
  }

  _handleDigOrEventKey(key, side) {
    if (this.inEvent && this.eventMode === 'choice') {
      this._handleEventKey(key);
      return;
    }
    this._dig(side);
  }

  _handleEventKey(key) {
    const index = choiceIndexForEventKey(key, this.eventOptions.length);
    if (index == null) return;
    this._handleEventChoice(index);
  }

  _playWorkerDig() {
    if (!this.worker) return;
    this.worker.play('worker-dig', true);
  }

  _playDigScroll(side, tileType) {
    const allTiles = [...this.leftTiles, ...this.rightTiles];
    for (const t of allTiles) {
      t.sprite.y = t.baseY + this.tileScrollOffset;
      this.tweens.add({ targets: t.sprite, y: t.baseY, duration: 130, ease: 'Cubic.Out' });
    }
    this._spawnDigFx(side, tileType);
    this._playWorkerDig();
    const workerBaseY = this._workerStandY();
    this.worker.y = workerBaseY + 8;
    this.tweens.add({ targets: this.worker, y: workerBaseY, duration: 140, ease: 'Cubic.Out' });
  }

  _spawnDigFx(side, tileType) {
    const type = TILE_TYPES_FOR_FX.includes(tileType) ? tileType : 'dirt';
    const x = side === 'right' ? this.rightColX : this.leftColX;
    const fx = this.add.sprite(x, this.gridTop + 26, 'dig_fx_tiles', TILE_TYPES_FOR_FX.indexOf(type) * 4)
      .setDisplaySize(96, 96)
      .setOrigin(0.5)
      .setDepth(30)
      .play(`dig-fx-${type}`);
    fx.on('animationcomplete', () => fx.destroy());
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
  this._refreshTileLayout();
    const show = () => {
      this.modalLayer.removeAll(true);
      const panelW = WIDTH - 70;
      const panelH = 200;
      const x = WIDTH / 2;
      const y = HEIGHT / 2;
      const bg = this._makePanel(x, y, panelW, panelH, 'ui_panel_red');
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

  _createUITextures() {
    // Use authored sprite panel texture directly (provided art), not procedural boxes.
    // This keeps corner ornaments intact under 9-slice scaling.
    const srcKey = 'ui_panel';
    const croppedKey = 'ui_panel_9src';
    if (!this.textures.exists(srcKey) || this.textures.exists(croppedKey)) return;

    const src = this.textures.get(srcKey)?.getSourceImage();
    if (!src) return;

    // ui_panel.png contains transparent padding; trim it first so 9-slice borders
    // map to actual ornament corners/edges instead of transparent margins.
    const sx = 9, sy = 9, sw = 62, sh = 63;
    const canvasTex = this.textures.createCanvas(croppedKey, sw, sh);
    const ctx = canvasTex.getContext();
    ctx.clearRect(0, 0, sw, sh);
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
    canvasTex.refresh();
  }

  _makePanel(x, y, w, h, variant = 'ui_panel') {
    const key = this.textures.exists('ui_panel_9src') ? 'ui_panel_9src' : 'ui_panel';
    // Borders tuned for the trimmed source (62x63) to match the provided art's corner size.
    const panel = this.add.nineslice(x, y, key, undefined, w, h, 18, 18, 18, 18);
    if (variant === 'ui_panel_red') {
      panel.setTint(0xffb0b0);
    }
    return panel;
  }

  _drawCard(g, x, y, w, h, hi) {
    g.clear();
    g.fillStyle(hi ? 0x3a2410 : 0x2a1808, 1);
    g.fillRect(x - w / 2, y - h / 2, w, h);
    g.lineStyle(1, hi ? 0xf6cf4a : 0x8c6428, 1);
    g.strokeRect(x - w / 2 + 0.5, y - h / 2 + 0.5, w - 1, h - 1);
    g.lineStyle(1, 0x1a1009, 1);
    g.strokeLineShape(new Phaser.Geom.Line(x - w / 2 + 1, y + h / 2 - 2, x + w / 2 - 2, y + h / 2 - 2));
  }

  _clampTextToBox(textObj, rawText, maxWidth, maxLines) {
    const src = String(rawText || '');
    textObj.setWordWrapWidth(maxWidth, true);
    textObj.setText(src);
    if (textObj.getWrappedText(src).length <= maxLines) return;

    let lo = 0;
    let hi = src.length;
    let best = '…';
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const candidate = `${src.slice(0, mid).trimEnd()}…`;
      if (textObj.getWrappedText(candidate).length <= maxLines) {
        best = candidate;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    textObj.setText(best);
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

      const bg = this._makePanel(panelX, panelY, panelW, panelH);
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

      const bg = this._makePanel(panelX, panelY, panelW, panelH);
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
      add('← / ↑ / → 或 1 / 2 / 3：事件時選擇選項');
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
    if (type === 'empty')   return { color: 0x2d180c, texture: 'tile_empty',   alpha: 0.2 };
    return { color: 0x4c2814, texture: 'tile_dirt', alpha: 1 };
  }

  _applyTileTexture(sprite, texture, mode = 'repeat') {
    sprite.setTexture(texture);
    if (mode === 'cover') {
      const frame = this.textures.get(texture)?.get();
      if (frame && frame.width > 0 && frame.height > 0) {
        const scale = Math.max(sprite.width / frame.width, sprite.height / frame.height);
        sprite.tileScaleX = scale;
        sprite.tileScaleY = scale;
        sprite.tilePositionX = (frame.width * scale - sprite.width) / (2 * scale);
        sprite.tilePositionY = (frame.height * scale - sprite.height) / (2 * scale);
        return;
      }
    }
    sprite.tileScaleX = 1;
    sprite.tileScaleY = 1;
    sprite.tilePositionX = 0;
    sprite.tilePositionY = 0;
  }

  _renderTiles(col, tiles) {
    for (let i = 0; i < 5; i++) {
      const cfg = this._tileStyle(tiles[i]);
      this._applyTileTexture(col[i].sprite, cfg.texture, TILE_FIT_MODE);
      col[i].sprite.setAlpha(cfg.alpha);
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
      if (relics.includes('extra_tool')) tags.push('＋');
      if (relics.includes('stone_resist')) tags.push('岩');
      if (relics.includes('survey_aura')) tags.push('勘');
      if (tags.length) {
        this.relicText.setText(`遺物 ${tags.join(' ')}`).setVisible(true);
      } else {
        this.relicText.setVisible(false);
      }
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
    this.depthText.setText(`深度 ${state.depth}`);
    this.toolsText.setText(`工具 ${state.tools}`);
    this.bestText.setText( `最佳 ${state.bestDepth}`);
    this.scoreText.setText(`分 ${state.score}`);
    if (this.pauseBtn) this.pauseBtn.setText(state.paused ? '繼續' : '暫停');

    const streak = state.safeStreak || 0;
    if (streak >= 5) {
      const tier = streak >= 20 ? '極速' : streak >= 10 ? '高速' : '穩定';
      this.streakText.setText(`${tier} ×${streak}`).setColor('#f6cf4a');
    } else {
      this.streakText.setText('');
    }

    if (!state.alive)             this.statusText.setText('工具壞掉了 ☠');
    else if (state.paused)        this.statusText.setText('⏸ 已暫停');
    else if (state.inEvent)       this.statusText.setText(this.eventMode === 'roulette' ? '● 轉盤旋轉中…' : '▶ 事件中');
    else if (state.autoDigActive) this.statusText.setText(`⚡ 自動（${state.autoDigSide === 'left' ? '左' : '右'}）`);
    else                          this.statusText.setText('');

    const maxTools = state.maxTools || state.tools || 1;
    const toolRatio = Math.max(0, Math.min(1, state.tools / maxTools));
    this.toolMeterFill.width = 118 * toolRatio;
    if (toolRatio > 0.6) this.toolMeterFill.setFillStyle(0x52d48a);
    else if (toolRatio > 0.3) this.toolMeterFill.setFillStyle(0xf6cf4a);
    else this.toolMeterFill.setFillStyle(0xe05050);

    if (state.goldPlatingActive) this.toolsText.setStyle({ color: '#fff4b0' });
    else this.toolsText.setStyle({ color: '#f8f3e6' });

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
        const side = this.prevState.lastSide || state.lastSide || this.lastManualSide;
        const dugTile = this.prevState.previews?.[side]?.[0] || 'dirt';
        this._playDigScroll(side, dugTile);
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
    const panelX = WIDTH / 2;
    const panelY = HEIGHT / 2;
    const topPad = 20;
    const sidePad = 20;
    const headGap = 10;

    const title = this.add.text(0, 0, eventData.title || '地底事件', {
      fontFamily: PIXEL_FONT, fontSize: '24px', color: '#ffe58a'
    }).setOrigin(0.5, 0).setVisible(false);
    const desc = this.add.text(0, 0, eventData.desc || '', {
      fontFamily: PIXEL_FONT, fontSize: '14px', color: '#f8f3e6',
      wordWrap: { width: panelW - sidePad * 2 }
    }).setOrigin(0.5, 0).setVisible(false);
    this._clampTextToBox(desc, eventData.desc || '', panelW - sidePad * 2, 3);

    const headerH = title.height + 8 + desc.height;
    const bodyTop = topPad + headerH + headGap;
    let panelH = 300;

    if (this.eventMode === 'roulette') {
      const cards = [];
      const cardW = panelW - 70;
      const cardH = 56;
      const rowGap = 10;
      const bodyH = this.eventOptions.length * cardH + Math.max(0, this.eventOptions.length - 1) * rowGap;
      const hintH = 18;
      panelH = Math.max(300, bodyTop + bodyH + 10 + hintH + 18);

      const bg = this._makePanel(panelX, panelY, panelW, panelH);
      title.setPosition(panelX, panelY - panelH / 2 + topPad).setVisible(true);
      desc.setPosition(panelX, title.y + title.height + 8).setVisible(true);
      this.modalLayer.add([bg, title, desc]);

      const cardsTop = desc.y + desc.height + headGap;
      for (let i = 0; i < this.eventOptions.length; i++) {
        const opt = this.eventOptions[i];
        const y = cardsTop + i * (cardH + rowGap) + cardH / 2;
        const card = this.add.rectangle(panelX, y, cardW, cardH, 0x3a2510).setStrokeStyle(2, 0x7a5a2a);
        const label = this.add.text(panelX, y, `${opt.title} - ${opt.desc}`, {
          fontFamily: FONT_FAMILY,
          fontSize: '14px',
          color: '#f8f3e6',
          wordWrap: { width: cardW - 22 },
          align: 'center'
        }).setOrigin(0.5);
        this._clampTextToBox(label, `${opt.title} - ${opt.desc}`, cardW - 22, 2);
        cards.push({ card, label });
        this.modalLayer.add([card, label]);
      }
      const hint = this.add.text(panelX, cardsTop + bodyH + 10, '轉盤旋轉中…', {
        fontFamily: PIXEL_FONT, fontSize: '12px', color: '#a09070'
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

    const numCards = Math.min(this.eventOptions.length, 3);
    // Cards: taller, slightly narrower gap to fit 3 comfortably
    const cW = 130, cH = 148, cGap = 6;
    panelH = Math.max(330, bodyTop + cH + 24);
    const bg = this._makePanel(panelX, panelY, panelW, panelH);
    title.setPosition(panelX, panelY - panelH / 2 + topPad).setVisible(true);
    desc.setPosition(panelX, title.y + title.height + 8).setVisible(true);
    this.modalLayer.add([bg, title, desc]);

    const totalCW = numCards * cW + (numCards - 1) * cGap;
    const c0X = panelX - totalCW / 2 + cW / 2;
    const cY = desc.y + desc.height + headGap + cH / 2;
    const numLabels = ['①', '②', '③'];
    for (let i = 0; i < numCards; i++) {
      const opt = this.eventOptions[i];
      const cx = c0X + i * (cW + cGap);
      const cg = this.add.graphics();
      this._drawCard(cg, cx, cY, cW, cH, false);
      const hz = this.add.rectangle(cx, cY, cW, cH, 0x000000, 0).setInteractive({ useHandCursor: true });
      // Option number badge
      const numT = this.add.text(cx, cY - cH / 2 + 8, numLabels[i], {
        fontFamily: PIXEL_FONT, fontSize: '14px', color: '#8a7050'
      }).setOrigin(0.5, 0);
      // Title — centred, wraps
      const ttl = this.add.text(cx, cY - cH / 2 + 28, opt.title, {
        fontFamily: PIXEL_FONT, fontSize: '14px', color: '#ffe58a',
        align: 'center', wordWrap: { width: cW - 16 }
      }).setOrigin(0.5, 0);
      this._clampTextToBox(ttl, opt.title, cW - 16, 2);
      // Divider line
      const div = this.add.graphics();
      div.lineStyle(1, 0x6a4820, 0.7);
      div.strokeLineShape(new Phaser.Geom.Line(cx - cW / 2 + 12, cY - 10, cx + cW / 2 - 12, cY - 10));
      // Description
      const dsc = this.add.text(cx, cY - 6, opt.desc, {
        fontFamily: PIXEL_FONT, fontSize: '11px', color: '#b8a478',
        align: 'center', wordWrap: { width: cW - 16 }
      }).setOrigin(0.5, 0);
      this._clampTextToBox(dsc, opt.desc, cW - 16, 4);
      const ii = i;
      hz.on('pointerover', () => { this._drawCard(cg, cx, cY, cW, cH, true); ttl.setColor('#ffffff'); numT.setColor('#f6cf4a'); });
      hz.on('pointerout',  () => { this._drawCard(cg, cx, cY, cW, cH, false); ttl.setColor('#ffe58a'); numT.setColor('#8a7050'); });
      hz.on('pointerdown', () => this._handleEventChoice(ii));
      this.modalLayer.add([cg, hz, numT, ttl, div, dsc]);
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

    const bg = this._makePanel(panelX, HEIGHT / 2, panelW, 420, 'ui_panel_red');
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

    const bg    = this._makePanel(panelX, panelY, panelW, 260);
    const title = this.add.text(panelX, panelY - 110, '選擇難度', { fontFamily: PIXEL_FONT, fontSize: '26px', color: '#ffe58a' }).setOrigin(0.5, 0);
    const sub   = this.add.text(panelX, panelY - 76, '難度會影響初始耐久與危險格機率', { fontFamily: PIXEL_FONT, fontSize: '12px', color: '#a09070' }).setOrigin(0.5, 0);
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
      const cardG = this.add.graphics();
      this._drawCard(cardG, x, cardY, cardW, cardH, false);
      const hitZone = this.add.rectangle(x, cardY, cardW, cardH, 0x000000, 0).setInteractive({ useHandCursor: true });
      const label = this.add.text(x, cardY - 28, d.label, {
        fontFamily: PIXEL_FONT, fontSize: '21px', color: '#f8f3e6', align: 'center'
      }).setOrigin(0.5);
      const subLabel = this.add.text(x, cardY + 20, d.sub, {
        fontFamily: PIXEL_FONT, fontSize: '12px', color: '#c8b87e', align: 'center',
        wordWrap: { width: cardW - 16 }
      }).setOrigin(0.5);
      this._clampTextToBox(subLabel, d.sub, cardW - 16, 3);
      hitZone.on('pointerover', () => { this._drawCard(cardG, x, cardY, cardW, cardH, true); label.setColor('#ffe58a'); });
      hitZone.on('pointerout',  () => { this._drawCard(cardG, x, cardY, cardW, cardH, false); label.setColor('#f8f3e6'); });
      hitZone.on('pointerdown', () => { this.uiModalOpen = false; this.modalLayer.removeAll(true); onSelect(d.key); });
      this.modalLayer.add([cardG, hitZone, label, subLabel]);
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
