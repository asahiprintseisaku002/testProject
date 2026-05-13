// ── 駒の定義 ──────────────────────────────────────────
const SYM = {
  K:'♔', Q:'♕', R:'♖', B:'♗', N:'♘', P:'♙',
  k:'♚', q:'♛', r:'♜', b:'♝', n:'♞', p:'♟'
};

const VAL = {
  P:1, N:3, B:3, R:5, Q:9, K:100,
  p:-1, n:-3, b:-3, r:-5, q:-9, k:-100
};

// ── 状態変数 ──────────────────────────────────────────
let board, turn, sel, hints, lastMove, hist, over, aiMode, pendingPromo;

// ── 初期化 ────────────────────────────────────────────
function init() {
  board = Array(64).fill(null);
  'RNBQKBNR'.split('').forEach((p, i) => {
    board[i] = p;
    board[56 + i] = p.toLowerCase();
  });
  for (let i = 0; i < 8; i++) {
    board[8 + i] = 'P';
    board[48 + i] = 'p';
  }
  turn = 'w';
  sel = null;
  hints = [];
  lastMove = null;
  hist = [];
  over = false;
  pendingPromo = null;
  document.getElementById('promo').style.display = 'none';
  updateCards();
  render();
  showMsg('');
}

// ── 座標ユーティリティ ───────────────────────────────
const sq  = (r, c) => r * 8 + c;
const rc  = i => [Math.floor(i / 8), i % 8];
const isW = p => p && p === p.toUpperCase();
const col = p => p ? (isW(p) ? 'w' : 'b') : null;
const opp = c => c === 'w' ? 'b' : 'w';
const inB = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

// ── 生の移動候補（王手無視） ─────────────────────────
function raw(b, i) {
  const [r, c] = rc(i), p = b[i];
  if (!p) return [];
  const cl = col(p), tp = p.toUpperCase(), mv = [];

  const slide = (dr, dc) => {
    let nr = r + dr, nc = c + dc;
    while (inB(nr, nc)) {
      const x = b[sq(nr, nc)];
      if (x) { if (col(x) !== cl) mv.push(sq(nr, nc)); break; }
      mv.push(sq(nr, nc));
      nr += dr; nc += dc;
    }
  };
  const step = (dr, dc) => {
    const nr = r + dr, nc = c + dc;
    if (inB(nr, nc)) {
      const x = b[sq(nr, nc)];
      if (!x || col(x) !== cl) mv.push(sq(nr, nc));
    }
  };

  if (tp === 'P') {
    const d = cl === 'w' ? -1 : 1, sr = cl === 'w' ? 6 : 1;
    const fw = sq(r + d, c);
    if (inB(r + d, c) && !b[fw]) mv.push(fw);
    if (r === sr && !b[fw] && !b[sq(r + 2 * d, c)]) mv.push(sq(r + 2 * d, c));
    [-1, 1].forEach(dc => {
      const nr = r + d, nc = c + dc;
      if (inB(nr, nc) && b[sq(nr, nc)] && col(b[sq(nr, nc)]) !== cl) mv.push(sq(nr, nc));
    });
  } else if (tp === 'N') {
    [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]].forEach(([a,bb]) => step(a, bb));
  } else if (tp === 'B') {
    [[-1,-1],[-1,1],[1,-1],[1,1]].forEach(([a,bb]) => slide(a, bb));
  } else if (tp === 'R') {
    [[-1,0],[1,0],[0,-1],[0,1]].forEach(([a,bb]) => slide(a, bb));
  } else if (tp === 'Q') {
    [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]].forEach(([a,bb]) => slide(a, bb));
  } else if (tp === 'K') {
    [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]].forEach(([a,bb]) => step(a, bb));
  }
  return mv;
}

// ── 王の位置・王手判定 ───────────────────────────────
function kingIdx(b, c) {
  return b.findIndex(p => p === (c === 'w' ? 'K' : 'k'));
}
function inCheck(b, c) {
  const k = kingIdx(b, c);
  return k >= 0 && b.some((p, i) => p && col(p) === opp(c) && raw(b, i).includes(k));
}

// ── 盤面適用 ─────────────────────────────────────────
function applyBoard(b, f, t, promo) {
  const nb = [...b];
  nb[t] = promo || nb[f];
  nb[f] = null;
  if (!promo) {
    const [tr] = rc(t);
    if (nb[t] === 'P' && tr === 0) nb[t] = 'Q';
    if (nb[t] === 'p' && tr === 7) nb[t] = 'q';
  }
  return nb;
}

// ── 合法手一覧 ───────────────────────────────────────
function legalAll(b, c) {
  const mv = [];
  b.forEach((p, i) => {
    if (p && col(p) === c) {
      raw(b, i).forEach(t => {
        if (!inCheck(applyBoard(b, i, t, null), c)) mv.push([i, t]);
      });
    }
  });
  return mv;
}

function legalFrom(i) {
  return legalAll(board, turn).filter(([f]) => f === i).map(([, t]) => t);
}

function needsPromo(b, f, t) {
  const p = b[f], [tr] = rc(t);
  return (p === 'P' && tr === 0) || (p === 'p' && tr === 7);
}

// ── 指し手を実行 ─────────────────────────────────────
function doMove(f, t) {
  if (needsPromo(board, f, t)) {
    pendingPromo = { f, t };
    const c = col(board[f]);
    const ps = c === 'w' ? ['Q','R','B','N'] : ['q','r','b','n'];
    const row = document.getElementById('promo-row');
    row.innerHTML = '';
    ps.forEach(pc => {
      const s = document.createElement('span');
      s.textContent = SYM[pc];
      addTap(s, () => commitMove(f, t, pc));
      row.appendChild(s);
    });
    document.getElementById('promo').style.display = 'block';
    sel = null; hints = [];
    render();
    return;
  }
  commitMove(f, t, null);
}

function commitMove(f, t, promo) {
  pendingPromo = null;
  document.getElementById('promo').style.display = 'none';
  hist.push({ board: [...board], turn, lastMove });
  board = applyBoard(board, f, t, promo);
  lastMove = { f, t };
  turn = opp(turn);
  sel = null; hints = [];

  const mv = legalAll(board, turn);
  const ck = inCheck(board, turn);

  if (mv.length === 0) {
    over = true;
    updateCards(); render();
    showMsg(ck ? (opp(turn) === 'w' ? '白' : '黒') + 'の勝ち！チェックメイト' : '引き分け（ステイルメイト）');
    return;
  }
  showMsg(ck ? (turn === 'w' ? '白にチェック！' : '黒にチェック！') : '');
  updateCards(); render();
  if (aiMode && turn === 'b' && !over) setTimeout(aiMove, 350);
}

// ── AI（簡易評価） ────────────────────────────────────
function aiMove() {
  if (over) return;
  const mv = legalAll(board, 'b');
  if (!mv.length) return;
  let best = null, bs = -Infinity;
  mv.forEach(([f, t]) => {
    const s = applyBoard(board, f, t, null).reduce((a, p) => p ? a + (VAL[p] || 0) : a, 0) * -1;
    if (s > bs) { bs = s; best = [f, t]; }
  });
  if (best) commitMove(best[0], best[1], null);
}

// ── タップ処理 ───────────────────────────────────────
function tap(i) {
  if (over || pendingPromo) return;
  if (sel !== null && hints.includes(i)) { doMove(sel, i); return; }
  const p = board[i];
  if (p && col(p) === turn && !(aiMode && turn === 'b')) {
    sel = i; hints = legalFrom(i); render(); return;
  }
  sel = null; hints = []; render();
}

// タッチ・クリック両対応のイベント登録
function addTap(el, fn) {
  let touched = false;
  el.addEventListener('touchstart', e => { e.stopPropagation(); touched = true; }, { passive: true });
  el.addEventListener('touchend',   e => { e.stopPropagation(); if (touched) { touched = false; fn(); } }, { passive: true });
  el.addEventListener('click',      e => { e.stopPropagation(); if (!touched) fn(); touched = false; });
}

// ── 描画 ─────────────────────────────────────────────
function render() {
  const bd = document.getElementById('board');
  const ki = kingIdx(board, turn);
  const ck = !over && inCheck(board, turn);
  const cells = bd.querySelectorAll('.sq');

  const updateCell = (d, i) => {
    const r = Math.floor(i / 8), c = i % 8;
    d.className = 'sq ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
    if (sel === i) d.classList.add('sel');
    if (hints.includes(i)) { d.classList.add('hint'); if (board[i]) d.classList.add('occ'); }
    if (lastMove && lastMove.f === i) d.classList.add('lf');
    if (lastMove && lastMove.t === i) d.classList.add('lt');
    if (ck && i === ki) d.classList.add('ck');
    const p = board[i];
    let sp = d.querySelector('.piece');
    if (p) {
      if (!sp) { sp = document.createElement('span'); d.appendChild(sp); }
      sp.className = 'piece ' + (isW(p) ? 'wp' : 'bp');
      sp.textContent = SYM[p];
    } else if (sp) { sp.remove(); }
  };

  if (cells.length === 64) {
    cells.forEach((d, i) => updateCell(d, i));
  } else {
    bd.innerHTML = '';
    for (let i = 0; i < 64; i++) {
      const d = document.createElement('div');
      updateCell(d, i);
      addTap(d, () => tap(i));
      bd.appendChild(d);
    }
  }
}

// ── UI更新 ───────────────────────────────────────────
function updateCards() {
  document.getElementById('cw').className = 'pcard' + (turn === 'w' && !over ? ' on' : '');
  document.getElementById('cb').className = 'pcard' + (turn === 'b' && !over ? ' on' : '');
}
function showMsg(m) { document.getElementById('msg').textContent = m; }

// ── ボタン・モード ────────────────────────────────────
aiMode = true;

addTap(document.getElementById('mode-btn'), () => {
  aiMode = !aiMode;
  document.getElementById('mode-btn').textContent = aiMode ? 'AI対戦中' : '2人対戦中';
  document.getElementById('nb').textContent = aiMode ? 'AI' : 'プレイヤー2';
  init();
});

addTap(document.getElementById('btn-new'), init);

addTap(document.getElementById('btn-undo'), () => {
  if (!hist.length || pendingPromo) return;
  const steps = aiMode && hist.length >= 2 ? 2 : 1;
  const h = hist.splice(-steps);
  ({ board, turn, lastMove } = h[0]);
  over = false; sel = null; hints = []; pendingPromo = null;
  document.getElementById('promo').style.display = 'none';
  updateCards(); render(); showMsg('');
});

// ── 起動 ─────────────────────────────────────────────
init();
