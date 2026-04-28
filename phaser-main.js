import { Game } from './game.js';
import { loadMute, saveMute, loadBestScore, saveBestScore, addLeaderboardEntry } from './storage.js';

const WIDTH  = 480;
const HEIGHT = 800;
const MILESTONES = [5, 10, 20, 30, 50, 75, 100, 150, 200];

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
    this.lastMilestone = 0;
    this.bestScore  = 0;
    this.toasts     = [];
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
    this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x2b1b11);

    // ── HUD row 1: depth / tools / best
    const hudStyle = { fontFamily: 'Arial', fontSize: '19px', color: '#f8f3e6', backgroundColor: '#00000044', padding: { x: 8, y: 4 } };
    this.depthText = this.add.text(12,  12, '深度: 0', hudStyle);
    this.toolsText = this.add.text(160, 12, '工具: 0', hudStyle);
    this.bestText  = this.add.text(318, 12, '最佳: 0', hudStyle);

    // ── HUD row 2: score + streak
    const subStyle = { fontFamily: 'Arial', fontSize: '15px', color: '#c8b87e', backgroundColor: '#00000033', padding: { x: 6, y: 2 } };
    this.scoreText  = this.add.text(12,  44, '', subStyle);
    this.streakText = this.add.text(210, 44, '', subStyle);

    // ── Status line
    this.statusText = this.add.text(12, 68, '', { fontFamily: 'Arial', fontSize: '14px', color: '#f1ddba' });

    // ── AutoDig bar
    this.autoDigBar   = this.add.rectangle(WIDTH / 2, 94, 0, 6, 0xf6cf4a).setOrigin(0.5, 0);
    this.autoDigLabel = this.add.text(12, 90, '', { fontFamily: 'Arial', fontSize: '12px', color: '#f6cf4a' });

    // ── Tile grid
    this.leftColX  = 140;
    this.rightColX = 340;
    this.gridTop   = 120;
    this.tileH     = 90;
    this.leftTiles  = this._createTileColumn(this.leftColX);
    this.rightTiles = this._createTileColumn(this.rightColX);

    // ── Worker animation
    if (!this.anims.exists('worker-walk')) {
      this.anims.create({ key: 'worker-walk', frames: this.anims.generateFrameNumbers('worker', { start: 0, end: 3 }), frameRate: 8, repeat: -1 });
    }
    this.worker = this.add.sprite(this.leftColX - 28, this.gridTop - 20, 'worker', 0).setDisplaySize(64, 64).setFlipX(true);
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
    kb.on('keydown-ONE',   () => this._handleEventChoice(0));
    kb.on('keydown-TWO',   () => this._handleEventChoice(1));
    kb.on('keydown-THREE', () => this._handleEventChoice(2));
    kb.on('keydown-R',     () => { if (this.state && !this.state.alive) this._tryRestartOverlay(); });
    kb.on('keydown-P',     () => { if (this.logic && this.state?.alive && !this.state?.inEvent) this.logic.togglePause(); });
    kb.on('keydown-ESC',   () => { if (this.logic && this.state?.alive && !this.state?.inEvent) this.logic.togglePause(); });

    // ── Mute button
    this.muteBtn = this.add.text(WIDTH - 48, HEIGHT - 38, _muted ? '🔇' : '🔊', {
      fontFamily: 'Arial', fontSize: '22px', backgroundColor: '#00000055'
    }).setInteractive({ useHandCursor: true });
    this.muteBtn.on('pointerdown', () => {
      _muted = !_muted;
      saveMute(_muted);
      this.muteBtn.setText(_muted ? '🔇' : '🔊');
    });

    // ── Modal layer (drawn last = on top)
    this.modalLayer = this.add.container(0, 0).setDepth(100);

    // ── Init game logic
    this.logic = new Game(
      s   => this._onUpdate(s),
      (e, done) => this._onEvent(e, done),
      r   => this._onGameOver(r),
      (m) => { this.meta = m; }
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
      const y = this.gridTop + i * this.tileH;
      const bg     = this.add.rectangle(x, y, 116, 80, 0x4c2814).setStrokeStyle(2, 0x221309);
      const sprite = this.add.image(x, y, 'tile_dirt').setDisplaySize(48, 48);
      arr.push({ bg, sprite });
    }
    return arr;
  }

  _placeWorker(side) {
    this.worker.x = side === 'left' ? this.leftColX - 28 : this.rightColX - 28;
    this.worker.setFlipX(side === 'left');
  }

  _dig(side) {
    if (!this.logic || !this.state?.alive || this.state?.inEvent || this.state?.paused) return;
    if (this.state.autoDigActive) { this.logic.switchAutoSide(side); this._placeWorker(side); return; }
    this._placeWorker(side);
    sfx.dig();
    this.logic.step(side);
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
      fontFamily: 'Arial', fontSize: '16px', color,
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

  _onUpdate(state) {
    this.prevState = this.state;
    this.state = state;

    // ── HUD
    this.depthText.setText(`深度: ${state.depth}`);
    this.toolsText.setText(`工具: ${state.tools}`);
    this.bestText.setText( `最佳: ${state.bestDepth}`);
    this.scoreText.setText(state.score > 0 ? `分 ${state.score}` : '');

    const streak = state.safeStreak || 0;
    if (streak >= 5) {
      const fire = streak >= 20 ? '🔥🔥' : streak >= 10 ? '🔥' : '✨';
      this.streakText.setText(`${fire} ×${streak}`);
    } else {
      this.streakText.setText('');
    }

    if (!state.alive)        this.statusText.setText('工具壞掉了');
    else if (state.paused)   this.statusText.setText('⏸ 已暫停');
    else if (state.inEvent)  this.statusText.setText('事件中，按 1/2/3 選擇');
    else                     this.statusText.setText('');

    // ── Tiles
    this._renderTiles(this.leftTiles,  state.previews.left);
    this._renderTiles(this.rightTiles, state.previews.right);

    // ── Worker position for auto-dig
    if (state.autoDigSide) this._placeWorker(state.autoDigSide);

    // ── AutoDig bar
    if (state.autoDigActive && state.autoDigEndAt) {
      const remaining = Math.max(0, state.autoDigEndAt - Date.now());
      const total = 4000; // roughly same as game.js
      const ratio = Math.min(1, remaining / total);
      this.autoDigBar.width = WIDTH * ratio;
      this.autoDigLabel.setText(`⚡ 自動挖 ${(remaining / 1000).toFixed(1)}s`);
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

    // ── SFX on state changes
    if (this.prevState) {
      if (state.tools < this.prevState.tools) sfx.hit();
      if (state.stats?.diamondsHit > (this.prevState.stats?.diamondsHit || 0)) sfx.diamond();
    }

    // ── Depth bonus toast
    if (state.depthBonus && (!this.prevState?.depthBonus || state.depthBonus.time !== this.prevState.depthBonus.time)) {
      const m = state.depthBonus.depth / 50;
      const bonus = m % 2 === 0 ? '+1 工具耐久！' : '鍍金護盾！';
      this._showToast(`🎁 深度 ${state.depthBonus.depth} 獎勵：${bonus}`, '#f6cf4a', 1800);
      sfx.milestone();
    }

    // ── Streak bonus toast
    if (state.streakBonus && (!this.prevState?.streakBonus || state.streakBonus.time !== this.prevState.streakBonus.time)) {
      this._showToast(`🔥 ${state.streakBonus.streak} 連挖！+1 耐久`, '#f6cf4a', 1400);
      sfx.milestone();
    }

    // ── Milestone toasts
    if (state.alive && state.depth > this.lastMilestone) {
      for (const m of MILESTONES) {
        if (state.depth >= m && this.lastMilestone < m) {
          const emojis = m >= 100 ? '🎆' : m >= 50 ? '✨' : '🎉';
          this._showToast(`${emojis} 深度 ${m}！`, '#ffe58a', 1200);
          sfx.milestone();
          this.lastMilestone = m;
          break;
        }
      }
    }
    if (!state.alive) this.lastMilestone = 0;
  }

  _onEvent(eventData, done) {
    this.inEvent    = true;
    this.eventDone  = done;
    this.eventOptions = eventData.options.slice(0, 3);
    sfx.event();

    this.modalLayer.removeAll(true);

    const panelW = WIDTH - 40;
    const panelH = 300;
    const panelX = WIDTH / 2;
    const panelY = HEIGHT / 2;

    const bg    = this.add.rectangle(panelX, panelY, panelW, panelH, 0x000000, 0.92).setStrokeStyle(2, 0xf6cf4a);
    const title = this.add.text(panelX, panelY - 120, eventData.title || '地底事件', { fontFamily: 'Arial', fontSize: '24px', color: '#ffe58a' }).setOrigin(0.5, 0);
    const desc  = this.add.text(panelX, panelY - 84,  eventData.desc  || '', { fontFamily: 'Arial', fontSize: '15px', color: '#f8f3e6', wordWrap: { width: panelW - 40 } }).setOrigin(0.5, 0);

    this.modalLayer.add([bg, title, desc]);

    for (let i = 0; i < this.eventOptions.length; i++) {
      const opt = this.eventOptions[i];
      const y   = panelY - 10 + i * 60;
      const btn = this.add.text(panelX, y, `${i + 1}. ${opt.title} - ${opt.desc}`, {
        fontFamily: 'Arial', fontSize: '15px', color: '#f8f3e6',
        backgroundColor: '#3a2510', padding: { x: 12, y: 8 },
        wordWrap: { width: panelW - 60 }
      }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
      btn.on('pointerover',  () => btn.setStyle({ color: '#ffe58a' }));
      btn.on('pointerout',   () => btn.setStyle({ color: '#f8f3e6' }));
      btn.on('pointerdown',  () => this._handleEventChoice(i));
      this.modalLayer.add(btn);
    }
  }

  _handleEventChoice(index) {
    if (!this.inEvent || !this.eventDone) return;
    const choice = this.eventOptions[index];
    if (!choice) return;
    this.inEvent = false;
    const done = this.eventDone;
    this.eventDone = null;
    this.modalLayer.removeAll(true);
    done(choice);
  }

  _onGameOver(restart) {
    sfx.gameOver();
    this._restartFn = restart;

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
        fontFamily: 'Arial', fontSize: '18px', color: '#f8f3e6', ...style
      }).setOrigin(0.5, 0);
      this.modalLayer.add(t);
      curY += (t.height || 26) + 6;
      return t;
    };

    const isRecord = this.state.depth > 0 && this.state.depth >= (this.state.bestDepth || 0);
    addLine(isRecord ? '🏆 新紀錄！' : '工具全壞了', { fontSize: '28px', color: isRecord ? '#d89b31' : '#ffe58a' });
    curY += 4;
    addLine(`本次深度：${this.state.depth}`);
    addLine(isNewScore ? `⭐ 最高分：${score}` : `分數：${score}`, { color: isNewScore ? '#d89b31' : '#a09070', fontSize: '15px' });
    if (this.state.maxSafeStreak >= 3) {
      addLine(`🔥 最長安全連挖：${this.state.maxSafeStreak} 格`, { fontSize: '13px', color: '#c8b87e' });
    }
    if (this.state.stats) {
      const { stonesHit, diamondsHit, eventsTriggered } = this.state.stats;
      addLine(`🪨 ${stonesHit}　💎 ${diamondsHit}　❓ ${eventsTriggered}`, { fontSize: '13px', color: '#c8b87e' });
    }

    // Leaderboard
    if (leaderboard.length > 0) {
      curY += 4;
      addLine('🏅 本機排行 Top 5', { fontSize: '13px', color: '#f6cf4a' });
      for (let i = 0; i < leaderboard.length; i++) {
        const e = leaderboard[i];
        const diffLabel = e.difficulty === 'easy' ? '簡' : e.difficulty === 'hard' ? '難' : '普';
        addLine(`${i + 1}. 分${e.score}　深${e.depth}　${diffLabel}　${e.date || ''}`, { fontSize: '12px', color: '#a09070' });
      }
    }

    curY += 8;
    const restartBtn = this.add.text(panelX, curY, '[ 回到地面 ]', {
      fontFamily: 'Arial', fontSize: '20px', color: '#ffe58a',
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
    this.modalLayer.removeAll(true);

    const panelW = WIDTH - 60;
    const panelX = WIDTH / 2;
    const panelY = HEIGHT / 2 - 60;

    const bg    = this.add.rectangle(panelX, panelY, panelW, 260, 0x000000, 0.92).setStrokeStyle(2, 0xf6cf4a);
    const title = this.add.text(panelX, panelY - 110, '選擇難度', { fontFamily: 'Arial', fontSize: '26px', color: '#ffe58a' }).setOrigin(0.5, 0);
    const sub   = this.add.text(panelX, panelY - 76, '難度影響初始工具耐久與石頭機率', { fontFamily: 'Arial', fontSize: '13px', color: '#a09070' }).setOrigin(0.5, 0);
    this.modalLayer.add([bg, title, sub]);

    const diffs = [
      { key: 'easy',   label: '😌 簡單', sub: '初始 9 耐久，石頭少' },
      { key: 'normal', label: '⛏ 普通', sub: '初始 6 耐久，標準石頭' },
      { key: 'hard',   label: '💀 困難', sub: '初始 4 耐久，石頭更多' },
    ];
    for (let i = 0; i < diffs.length; i++) {
      const d = diffs[i];
      const y = panelY - 38 + i * 68;
      const btn = this.add.text(panelX, y, `${d.label}\n${d.sub}`, {
        fontFamily: 'Arial', fontSize: '16px', color: '#f8f3e6',
        backgroundColor: '#3a2510', padding: { x: 14, y: 8 }, align: 'center'
      }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
      btn.on('pointerover',  () => btn.setStyle({ color: '#ffe58a' }));
      btn.on('pointerout',   () => btn.setStyle({ color: '#f8f3e6' }));
      btn.on('pointerdown',  () => { this.modalLayer.removeAll(true); onSelect(d.key); });
      this.modalLayer.add(btn);
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


const WIDTH = 480;
const HEIGHT = 800;

class DiggerScene extends Phaser.Scene {
  constructor() {
    super('DiggerScene');
    this.logic = null;
    this.state = null;
    this.meta = null;
    this.muted = loadMute();
    this.inEvent = false;
    this.eventOptions = [];
  }

  preload() {
    this.load.spritesheet('worker', 'assets/sprite-forge/minipack/worker.png', {
      frameWidth: 64,
      frameHeight: 64
    });
    this.load.image('tile_dirt', 'assets/sprite-forge/minipack/tile_dirt.png');
    this.load.image('tile_stone', 'assets/sprite-forge/minipack/tile_stone.png');
    this.load.image('tile_diamond', 'assets/sprite-forge/minipack/tile_diamond.png');
    this.load.image('tile_event', 'assets/sprite-forge/minipack/tile_event.png');
    this.load.image('tile_puzzle', 'assets/sprite-forge/minipack/tile_puzzle.png');
    this.load.image('tile_empty', 'assets/sprite-forge/minipack/tile_empty.png');
  }

  create() {
    this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x2b1b11);

    this.depthText = this.add.text(16, 12, '深度: 0', this.uiStyle());
    this.toolsText = this.add.text(170, 12, '工具: 0', this.uiStyle());
    this.bestText = this.add.text(320, 12, '最佳: 0', this.uiStyle());

    this.statusText = this.add.text(16, 44, '', {
      fontFamily: 'Arial',
      fontSize: '16px',
      color: '#f1ddba'
    });

    this.leftColX = 140;
    this.rightColX = 340;
    this.gridTop = 110;
    this.tileH = 95;

    this.leftTiles = this.createTileColumn(this.leftColX);
    this.rightTiles = this.createTileColumn(this.rightColX);

    if (!this.anims.exists('worker-walk')) {
      this.anims.create({
        key: 'worker-walk',
        frames: this.anims.generateFrameNumbers('worker', { start: 0, end: 3 }),
        frameRate: 8,
        repeat: -1
      });
    }

    this.worker = this.add.sprite(this.leftColX - 24, this.gridTop - 18, 'worker', 0);
    this.worker.setDisplaySize(64, 64);
    this.worker.setFlipX(true);
    this.worker.play('worker-walk');

    const leftZone = this.add.zone(0, 0, WIDTH / 2, HEIGHT).setOrigin(0).setInteractive();
    const rightZone = this.add.zone(WIDTH / 2, 0, WIDTH / 2, HEIGHT).setOrigin(0).setInteractive();
    leftZone.on('pointerdown', () => this.dig('left'));
    rightZone.on('pointerdown', () => this.dig('right'));

    this.input.keyboard.on('keydown-LEFT', () => this.dig('left'));
    this.input.keyboard.on('keydown-A', () => this.dig('left'));
    this.input.keyboard.on('keydown-RIGHT', () => this.dig('right'));
    this.input.keyboard.on('keydown-D', () => this.dig('right'));
    this.input.keyboard.on('keydown-ONE', () => this.handleEventChoice(0));
    this.input.keyboard.on('keydown-TWO', () => this.handleEventChoice(1));
    this.input.keyboard.on('keydown-THREE', () => this.handleEventChoice(2));
    this.input.keyboard.on('keydown-P', () => {
      if (this.logic && this.state && this.state.alive && !this.state.inEvent) this.logic.togglePause();
    });

    this.muteBtn = this.add.text(WIDTH - 72, HEIGHT - 36, this.muted ? '🔇' : '🔊', {
      fontFamily: 'Arial',
      fontSize: '22px',
      backgroundColor: '#00000055'
    }).setInteractive({ useHandCursor: true });
    this.muteBtn.on('pointerdown', () => {
      this.muted = !this.muted;
      saveMute(this.muted);
      this.muteBtn.setText(this.muted ? '🔇' : '🔊');
    });

    this.logic = new Game(
      (state) => this.onUpdate(state),
      (eventData, done) => this.onEvent(eventData, done),
      (restart) => this.onGameOver(restart),
      (meta) => { this.meta = meta; }
    );
  }

  uiStyle() {
    return {
      fontFamily: 'Arial',
      fontSize: '20px',
      color: '#f8f3e6',
      backgroundColor: '#00000044',
      padding: { x: 8, y: 4 }
    };
  }

  createTileColumn(x) {
    const arr = [];
    for (let i = 0; i < 5; i++) {
      const y = this.gridTop + i * this.tileH;
      const bg = this.add.rectangle(x, y, 120, 82, 0x4c2814).setStrokeStyle(2, 0x221309);
      const sprite = this.add.image(x, y, 'tile_dirt').setDisplaySize(48, 48);
      arr.push({ bg, sprite });
    }
    return arr;
  }

  placeWorker(side) {
    this.worker.x = side === 'left' ? this.leftColX - 24 : this.rightColX - 24;
    this.worker.setFlipX(side === 'left');
  }

  dig(side) {
    if (!this.logic || !this.state || !this.state.alive || this.state.inEvent || this.state.paused) return;
    if (this.state.autoDigActive) {
      this.logic.switchAutoSide(side);
      this.placeWorker(side);
      return;
    }
    this.placeWorker(side);
    this.logic.step(side);
  }

  onUpdate(state) {
    this.state = state;
    this.depthText.setText(`深度: ${state.depth}`);
    this.toolsText.setText(`工具: ${state.tools}`);
    this.bestText.setText(`最佳: ${state.bestDepth}`);

    if (!state.alive) this.statusText.setText('工具壞掉了');
    else if (state.paused) this.statusText.setText('已暫停');
    else if (state.inEvent) this.statusText.setText('事件中，按 1/2/3 選擇');
    else this.statusText.setText('');

    this.renderTiles(this.leftTiles, state.previews.left);
    this.renderTiles(this.rightTiles, state.previews.right);

    if (state.autoDigSide === 'left' || state.autoDigSide === 'right') {
      this.placeWorker(state.autoDigSide);
    }

    const depthRatio = Math.min(1, state.depth / 150);
    const shade = Phaser.Math.Linear(0x2b1b11, 0x0f0906, depthRatio);
    this.cameras.main.setBackgroundColor(shade);
  }

  renderTiles(col, tiles) {
    for (let i = 0; i < 5; i++) {
      const t = tiles[i];
      const tile = col[i];
      const cfg = this.tileStyle(t);
      tile.bg.setFillStyle(cfg.color);
      tile.sprite.setTexture(cfg.texture);
      tile.sprite.setAlpha(cfg.alpha);
    }
  }

  tileStyle(type) {
    if (type === 'stone') return { color: 0x5c5450, texture: 'tile_stone', alpha: 1 };
    if (type === 'diamond') return { color: 0x7fb3d1, texture: 'tile_diamond', alpha: 1 };
    if (type === 'event') return { color: 0xa4572f, texture: 'tile_event', alpha: 1 };
    if (type === 'puzzle') return { color: 0xc79532, texture: 'tile_puzzle', alpha: 1 };
    if (type === 'empty') return { color: 0x2d180c, texture: 'tile_empty', alpha: 0.45 };
    return { color: 0x4c2814, texture: 'tile_dirt', alpha: 1 };
  }

  onEvent(eventData, done) {
    this.inEvent = true;
    this.eventDone = done;
    this.eventOptions = eventData.options.slice(0, 3);

    if (this.eventContainer) this.eventContainer.destroy(true);
    this.eventContainer = this.add.container(0, 0);

    const bg = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH - 40, 300, 0x000000, 0.9).setStrokeStyle(2, 0xf6cf4a);
    const title = this.add.text(44, 268, eventData.title || '地底事件', {
      fontFamily: 'Arial',
      fontSize: '26px',
      color: '#ffe58a'
    });
    const desc = this.add.text(44, 304, eventData.desc || '', {
      fontFamily: 'Arial',
      fontSize: '16px',
      color: '#f8f3e6',
      wordWrap: { width: WIDTH - 84 }
    });

    this.eventContainer.add([bg, title, desc]);

    this.eventOptionTexts = [];
    for (let i = 0; i < this.eventOptions.length; i++) {
      const y = 368 + i * 64;
      const option = this.eventOptions[i];
      const txt = this.add.text(56, y, `${i + 1}. ${option.title} - ${option.desc}`, {
        fontFamily: 'Arial',
        fontSize: '16px',
        color: '#f8f3e6',
        backgroundColor: '#2b1b11'
      }).setInteractive({ useHandCursor: true });
      txt.on('pointerdown', () => this.handleEventChoice(i));
      this.eventContainer.add(txt);
      this.eventOptionTexts.push(txt);
    }
  }

  handleEventChoice(index) {
    if (!this.inEvent || !this.eventDone) return;
    const choice = this.eventOptions[index];
    if (!choice) return;
    this.inEvent = false;
    if (this.eventContainer) this.eventContainer.destroy(true);
    const done = this.eventDone;
    this.eventDone = null;
    done(choice);
  }

  onGameOver(restart) {
    const overlay = this.add.container(0, 0);
    const bg = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH - 40, 220, 0x000000, 0.9).setStrokeStyle(2, 0xe05050);
    const title = this.add.text(88, 300, '工具全壞了', {
      fontFamily: 'Arial',
      fontSize: '34px',
      color: '#ffe58a'
    });
    const info = this.add.text(96, 350, `本次深度: ${this.state.depth}\n按 R 重新開始`, {
      fontFamily: 'Arial',
      fontSize: '20px',
      color: '#f8f3e6'
    });
    overlay.add([bg, title, info]);

    const handler = () => {
      this.input.keyboard.off('keydown-R', handler);
      overlay.destroy(true);
      restart('normal');
    };
    this.input.keyboard.on('keydown-R', handler);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: WIDTH,
  height: HEIGHT,
  parent: 'app',
  backgroundColor: '#2b1b11',
  scene: [DiggerScene],
  render: {
    antialias: false,
    pixelArt: true,
    roundPixels: true
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  }
});
