import { loadMeta, saveMeta, addPuzzlePiece, clearMeta } from './storage.js';

const TILE_TYPES = {
  EMPTY: 'empty',
  DIRT: 'dirt',
  STONE: 'stone',
  DIAMOND: 'diamond',
  EVENT: 'event',
  PUZZLE: 'puzzle'
};

// 同一條垂直路線上，兩個事件層之間至少要間隔的「深度差」
// 例如設為 8，表示 rowDepth 10 出現事件後，rowDepth 11~17 都不會再出現事件格
const MIN_EVENT_GAP = 8;

export class Game {
  constructor(onUpdate, onEvent, onGameOver, onMeta) {
    this.onUpdate = onUpdate;
    this.onEvent = onEvent;
    this.onGameOver = onGameOver;
    this.onMeta = onMeta;
    this.meta = loadMeta();
    this.relicEffects = this.computeRelics();
    this.inEvent = false;

    // 最近一次「生成包含事件格的那一層」的深度（用來控制事件間距，不論左右）
    this.lastEventRowDepthGenerated = -999;

    // 最近一次獲得的拼圖資訊（給 UI 顯示是哪一片）
    this.lastPuzzlePiece = null;

    // 本場是否有「鍍金工具」護盾（可抵擋一次石頭或鑽石傷害，不可累積）
    this.goldPlatingActive = false;

    // 最近一次受傷資訊（給 UI 顯示耐久度降低提示）
    this.lastHit = null;

    // 快速挖掘相關狀態
    this.lastSide = 'left';
    this.autoDigActive = false;
    this.autoDigSide = null;
    this.autoDigTimer = null;
    this.autoDigEndAt = 0;
    this.autoStonePunish = false;

    this.startRun();
  }

  computeRelics() {
    // 所有遺物統一改成「增加耐久度」型效果，方便理解
    const relics = { extraTool: 0 };
    if (this.meta.unlockedRelics.includes('extra_tool')) {
      relics.extraTool += 1;
    }
    if (this.meta.unlockedRelics.includes('stone_resist')) {
      // 石頭護符：改為開局額外 +1 耐久
      relics.extraTool += 1;
    }
    return relics;
  }

  startRun() {
    const baseTools = 6;
    this.tools = baseTools + this.relicEffects.extraTool;
    this.maxTools = this.tools;
    this.depth = 0;
    this.alive = true;
    this.biasSoft = 0;
    this.inEvent = false;
    this.lastEventRowDepthGenerated = -999;
    this.lastPuzzlePiece = null;
    this.goldPlatingActive = false;

    // 重置快速挖掘狀態
    this.stopAutoDig();
    this.lastSide = 'left';

    this.previews = this.generatePreviews();
    this.onUpdate(this.getState());
    this.onMeta(this.meta, this.relicEffects, this.lastPuzzlePiece);
  }

  clearProgress() {
    clearMeta();
    this.meta = loadMeta();
    this.relicEffects = this.computeRelics();
    this.startRun();
  }

  generatePreviews() {
    // depth = 0 時，index 0 對應深度 1，以此類推
    const rows = Array.from({ length: 5 }, (_, i) => {
      const rowDepth = this.depth + i + 1;
      return this.randomRow(rowDepth);
    });

    // 開局前 3 層一定是一般格（泥土），避免一開始就遇到事件或石頭
    for (let i = 0; i < 3; i++) {
      if (rows[i]) {
        rows[i].left = TILE_TYPES.DIRT;
        rows[i].right = TILE_TYPES.DIRT;
      }
    }

    return {
      left: rows.map(r => r.left),
      right: rows.map(r => r.right)
    };
  }

  step(side) {
    if (!this.alive || this.inEvent) return;

    this.lastSide = side;

    // 下一步深度
    const nextDepth = this.depth + 1;

    // 一起往下捲動：左、右同時前進一層
    const topLeft = this.previews.left.shift();
    const topRight = this.previews.right.shift();
    const tile = side === 'left' ? topLeft : topRight;

    // 實際深度更新到下一層
    this.depth = nextDepth;

    // 新產生的一層對應的深度（畫面底部）
    const newRowDepth = this.depth + 5;
    const newRow = this.randomRow(newRowDepth);
    this.previews.left.push(newRow.left);
    this.previews.right.push(newRow.right);

    // 根據當前格子類型處理效果
    if (tile === TILE_TYPES.STONE || tile === TILE_TYPES.DIAMOND) {
      const survived = this.handleHazardTile(tile);
      if (!survived) return;
    } else if (tile === TILE_TYPES.EVENT) {
      this.handleEventTile();
      return;
    } else if (tile === TILE_TYPES.PUZZLE) {
      this.handlePuzzleTile();
    }

    this.finishStep();
  }

  /**
   * 處理石頭／鑽石等會造成傷害的格子
   * @param {string} tile
   * @returns {boolean} 是否仍然存活
   */
  handleHazardTile(tile) {
    // 若有鍍金護盾，抵擋這次傷害並消耗護盾
    if (this.goldPlatingActive) {
      this.goldPlatingActive = false;
      return true;
    }

    // 基礎傷害：鑽石比石頭更痛
    let dmg = tile === TILE_TYPES.DIAMOND ? 2 : 1;

    // 快速挖掘的危險：自動挖時提高傷害
    if (this.autoDigActive && this.autoStonePunish) {
      dmg = Math.max(dmg + 1, 1);
    }

    if (dmg <= 0) return true;

    // 記錄這次受傷（給前端顯示耐久度降低提示）
    this.lastHit = {
      dmg,
      time: performance.now()
    };

    this.tools -= dmg;
    if (this.tools <= 0) {
      this.tools = 0;
      this.endRun();
      return false;
    }
    return true;
  }

  /**
   * 處理事件格（彈出事件 UI）
   */
  handleEventTile() {
    // 進入事件時先清除舊的自動挖狀態，避免效果疊加出問題
    this.stopAutoDig();
    this.inEvent = true;
    const eventData = this.makeEvent();
    this.onEvent(eventData, choice => {
      this.applyEvent(choice);
      this.finishStep();
    });
    this.onUpdate(this.getState());
  }

  /**
   * 處理拼圖格：在特定深度實際給予拼圖碎片
   */
  handlePuzzleTile() {
    // 只有在深度為 20 的倍數時，才會真正獲得拼圖
    if (!(this.depth > 0 && this.depth % 20 === 0)) {
      // 有「圖」但這一層不是 20 的倍數時，僅作為提示，不實際給拼圖
      this.lastPuzzlePiece = null;
      return;
    }

    const size = Math.random() < 0.6 ? 2 : 3;
    const id = size === 2 ? 'A' : 'B';
    const maxIndex = size * size;

    // 優先給「尚未拿過的位置」，避免重複拿到同一片
    const ownedIndexes = new Set(
      this.meta.puzzlePieces
        .filter(p => p.id === id && p.size === size)
        .map(p => p.index)
    );

    let index;
    if (ownedIndexes.size < maxIndex) {
      // 還有沒拿過的位置，從剩下的位置中隨機選一片
      const candidates = [];
      for (let i = 0; i < maxIndex; i++) {
        if (!ownedIndexes.has(i)) candidates.push(i);
      }
      index = candidates[Math.floor(Math.random() * candidates.length)];
    } else {
      // 理論上不會發生（集滿後會被換成遺物並清空），保險起見保留舊邏輯
      index = Math.floor(Math.random() * maxIndex);
    }

    const piece = { id, size, index };
    this.lastPuzzlePiece = piece;
    addPuzzlePiece(this.meta, piece);
    this.relicEffects = this.computeRelics();
    // 把這次拿到的拼圖一併傳給前端，讓提示可以顯示正確片段
    this.onMeta(this.meta, this.relicEffects, this.lastPuzzlePiece);
  }

  finishStep() {
    if (this.depth > this.meta.bestDepth) {
      this.meta.bestDepth = this.depth;
      saveMeta(this.meta);
    }
    this.onUpdate(this.getState());
  }

  endRun() {
    this.alive = false;
    this.meta.runs += 1;
    saveMeta(this.meta);

    // 結束時停止自動挖
    this.stopAutoDig();

    this.onUpdate(this.getState());
    this.onGameOver(() => {
      this.startRun();
    });
  }

  randomRow(rowDepth) {
    // 每 20 層都是拼圖格（左右合併成一塊）
    if (rowDepth > 0 && rowDepth % 20 === 0) {
      return { left: TILE_TYPES.PUZZLE, right: TILE_TYPES.PUZZLE };
    }

    const useSoft = this.biasSoft > 0;

    const randomTileBase = () => {
      const r = Math.random();
      if (useSoft) {
        // 軟一點的分佈：石頭與鑽石機率稍微降低
        if (r < 0.58) return TILE_TYPES.DIRT;
        if (r < 0.78) return TILE_TYPES.STONE;
        if (r < 0.83) return TILE_TYPES.DIAMOND;
        return TILE_TYPES.EVENT;
      } else {
        if (r < 0.50) return TILE_TYPES.DIRT;
        if (r < 0.75) return TILE_TYPES.STONE;
        if (r < 0.82) return TILE_TYPES.DIAMOND;
        return TILE_TYPES.EVENT;
      }
    };

    let left = randomTileBase();
    let right = randomTileBase();

    // 依照「生成事件格的深度」控制事件間距：
    // rowDepth 本身就代表這一層的實際深度，因此直接與最後一次事件層比較
    const tooCloseToLastEvent =
      rowDepth - this.lastEventRowDepthGenerated < MIN_EVENT_GAP;

    if (tooCloseToLastEvent) {
      if (left === TILE_TYPES.EVENT) left = TILE_TYPES.DIRT;
      if (right === TILE_TYPES.EVENT) right = TILE_TYPES.DIRT;
    }

    // 保證同一層不會左右同時是「硬物」（石頭或鑽石）
    const isHard = t => t === TILE_TYPES.STONE || t === TILE_TYPES.DIAMOND;
    if (isHard(left) && isHard(right)) {
      const candidates = [TILE_TYPES.DIRT, TILE_TYPES.EVENT];
      right = candidates[Math.floor(Math.random() * candidates.length)];
    }

    // 保證同一層事件格最多只會出現在單邊
    if (left === TILE_TYPES.EVENT && right === TILE_TYPES.EVENT) {
      if (Math.random() < 0.5) {
        left = TILE_TYPES.DIRT;
      } else {
        right = TILE_TYPES.DIRT;
      }
    }

    // 若這一層仍然包含事件格，記錄下這一層的深度，避免之後太接近再出現
    if (left === TILE_TYPES.EVENT || right === TILE_TYPES.EVENT) {
      this.lastEventRowDepthGenerated = rowDepth;
    }

    if (this.biasSoft > 0) this.biasSoft--;

    return { left, right };
  }

  makeEvent() {
    const choiceOptions = [
      {
        id: 'golden_guard',
        title: '鍍金工具',
        desc: '下一次挖到石頭或鑽石時，不會扣耐久（不可累積）',
        apply: () => { this.goldPlatingActive = true; }
      },
      {
        id: 'swap_pick',
        title: '換鋤頭',
        desc: '+1 本場工具耐久',
        apply: () => {
          this.tools += 1;
          this.maxTools = Math.max(this.maxTools, this.tools);
        }
      },
      {
        id: 'crazy_slide',
        title: '瘋狂滑落',
        desc: '自動往同一側挖 5 秒，石頭傷害提高',
        apply: () => {
          const side = this.lastSide || 'left';
          this.startAutoDig(side, 5000, 280, true);
        }
      }
    ];

    const rouletteOptions = [
      {
        id: 'big_tool',
        title: '超級鋤頭',
        desc: '+2 本場工具耐久',
        apply: () => {
          this.tools += 2;
          this.maxTools = Math.max(this.maxTools, this.tools);
        }
      },
      {
        id: 'stone_shield',
        title: '石頭護符',
        desc: '+2 本場工具耐久',
        apply: () => {
          this.tools += 2;
          this.maxTools = Math.max(this.maxTools, this.tools);
        }
      },
      {
        id: 'deep_sense',
        title: '深層直覺',
        desc: '接下來 8 格石頭機率大幅下降',
        apply: () => { this.biasSoft = 8; }
      },
      {
        id: 'auto_tunnel',
        title: '地心衝刺',
        desc: '自動往同一側挖 5 秒，石頭更多也更痛',
        apply: () => {
          // 先從目前方向開始，玩家仍可改變方向
          const side = this.lastSide || 'left';
          this.startAutoDig(side, 5000, 220, true);
        }
      }
    ];

    // 部分事件是 3 選 1，部分是轉盤事件
    const useRoulette = Math.random() < 0.4;

    if (useRoulette) {
      return {
        mode: 'roulette',
        title: '地瓜轉盤',
        desc: '交給轉盤決定你的命運！',
        options: rouletteOptions
      };
    }

    return {
      mode: 'choice',
      title: '地底抉擇',
      desc: '從三個效果中挑選一個。',
      options: choiceOptions
    };
  }

  applyEvent(option) {
    option.apply();
    this.inEvent = false;
  }

  startAutoDig(side, durationMs = 5000, intervalMs = 250, punish = true) {
    this.stopAutoDig();
    if (!this.alive) return;

    this.autoDigActive = true;
    this.autoDigSide = side;
    this.autoStonePunish = punish;
    this.autoDigEndAt = performance.now() + durationMs;

    const tick = () => {
      if (!this.autoDigActive || !this.alive || this.inEvent) return;
      const now = performance.now();
      if (now >= this.autoDigEndAt) {
        this.stopAutoDig();
        return;
      }
      this.step(this.autoDigSide);
    };

    // 立刻挖一次，感覺比較明顯
    tick();
    this.autoDigTimer = setInterval(() => {
      tick();
      if (!this.autoDigActive) {
        clearInterval(this.autoDigTimer);
        this.autoDigTimer = null;
      }
    }, intervalMs);
  }

  stopAutoDig() {
    this.autoDigActive = false;
    this.autoDigSide = null;
    this.autoStonePunish = false;
    if (this.autoDigTimer) {
      clearInterval(this.autoDigTimer);
      this.autoDigTimer = null;
    }
    // 自動挖結束後立即同步狀態，避免前端仍以為在自動挖導致卡住
    // 但要確保 previews 已經存在，避免在初始化流程中觸發 renderTiles 出錯
    if (this.onUpdate && this.previews) {
      this.onUpdate(this.getState());
    }
  }

  switchAutoSide(side) {
    if (!this.autoDigActive) return;
    this.autoDigSide = side;
  }

  getState() {
    return {
      depth: this.depth,
      tools: this.tools,
      alive: this.alive,
      previews: this.previews,
      bestDepth: this.meta.bestDepth,
      inEvent: this.inEvent,
      maxTools: this.maxTools,
      autoDigActive: this.autoDigActive,
      autoDigSide: this.autoDigSide,
      lastHit: this.lastHit,
      lastPuzzlePiece: this.lastPuzzlePiece,
      goldPlatingActive: this.goldPlatingActive
    };
  }
}