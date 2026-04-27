const STORAGE_KEY = 'yam_roguelite_meta_v1';

const defaultMeta = () => ({
  runs: 0,
  bestDepth: 0,
  puzzlePieces: [], // {id,size,index}
  unlockedRelics: [] // ['extra_tool','stone_resist',...]
});

export function loadMeta() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultMeta();
    const data = JSON.parse(raw);
    return { ...defaultMeta(), ...data };
  } catch {
    return defaultMeta();
  }
}

export function saveMeta(meta) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(meta)); } catch {}
}

export function clearMeta() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function addPuzzlePiece(meta, piece) {
  meta.puzzlePieces.push(piece);
  checkPuzzleCompletion(meta);
  saveMeta(meta);
}

function checkPuzzleCompletion(meta) {
  const groups = {};
  for (const p of meta.puzzlePieces) {
    const key = `${p.id}_${p.size}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(p.index);
  }
  const needed = { 2:4, 3:9 };
  for (const key of Object.keys(groups)) {
    const [id,sizeStr] = key.split('_');
    const size = Number(sizeStr);
    const set = new Set(groups[key]);
    if (set.size === needed[size]) {
      const relic = size === 2 ? 'extra_tool' : 'stone_resist';
      if (!meta.unlockedRelics.includes(relic)) meta.unlockedRelics.push(relic);
      meta.puzzlePieces = meta.puzzlePieces.filter(p => !(p.id === id && p.size === size));
    }
  }
  saveMeta(meta);
}

const MUTE_KEY = 'yam_roguelite_muted_v1';
export function loadMute() {
  return localStorage.getItem(MUTE_KEY) === '1';
}
export function saveMute(muted) {
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch {}
}

const HINT_KEY = 'yam_roguelite_hint_dismissed_v1';
export function loadHintDismissed() {
  return localStorage.getItem(HINT_KEY) === '1';
}
export function saveHintDismissed() {
  try { localStorage.setItem(HINT_KEY, '1'); } catch {}
}