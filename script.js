'use strict';

/**
 * Othello / Reversi
 * 玩家：黑(1) 先手；電腦：白(-1) 後手
 * AI：
 *  - basic：貪婪（吃最多）+ 同分隨機
 *  - advanced：Iterative Deepening + Alpha-Beta + TT(Zobrist)
 *              + 強評分：角落/邊、X/C-square 懲罰、機動性、前線子、位置權重、終局子數
 *
 * 介面：
 *  - 立體棋子（CSS）
 *  - 翻棋動畫（rotateY）
 *  - 依序翻棋：逐顆延遲翻轉
 */

const SIZE = 8;
const BLACK = 1;
const WHITE = -1;
const EMPTY = 0;

const DIRS = [
  [-1,-1], [-1,0], [-1,1],
  [0,-1],          [0,1],
  [1,-1],  [1,0],  [1,1],
];

// 位置權重（常見 Othello heuristic）
const POS_W = [
  [120,-20, 20,  5,  5, 20,-20,120],
  [-20,-40, -5, -5, -5, -5,-40,-20],
  [ 20, -5, 15,  3,  3, 15, -5, 20],
  [  5, -5,  3,  3,  3,  3, -5,  5],
  [  5, -5,  3,  3,  3,  3, -5,  5],
  [ 20, -5, 15,  3,  3, 15, -5, 20],
  [-20,-40, -5, -5, -5, -5,-40,-20],
  [120,-20, 20,  5,  5, 20,-20,120],
];

const $ = (sel) => document.querySelector(sel);

const boardEl = $('#board');
const blackScoreEl = $('#blackScore');
const whiteScoreEl = $('#whiteScore');
const turnPill = $('#turnPill');
const statusPill = $('#statusPill');
const difficultyEl = $('#difficulty');
const speedEl = $('#speed');
const restartBtn = $('#restart');
const toggleHintsBtn = $('#toggleHints');

let board = [];
let current = BLACK;         // 黑先手
let inputLocked = false;
let showHints = true;
let lastMoveText = '';
let aiThinking = false;

// ===== 強化進階 AI：Zobrist + Transposition Table =====
let ZOBRIST = null;
let TT = new Map(); // key: BigInt hash -> entry
const TT_FLAG = { EXACT: 0, LOWER: 1, UPPER: 2 };

function rand64(seedObj){
  // xorshift64* (BigInt)
  let x = seedObj.x;
  x ^= (x << 13n);
  x ^= (x >> 7n);
  x ^= (x << 17n);
  seedObj.x = x;
  return x & ((1n<<64n) - 1n);
}
function initZobrist(){
  const seed = { x: 0x1234567890ABCDEFn };
  ZOBRIST = Array.from({length: SIZE}, () =>
    Array.from({length: SIZE}, () => [0n,0n])
  );
  for (let r=0;r<SIZE;r++){
    for (let c=0;c<SIZE;c++){
      ZOBRIST[r][c][0] = rand64(seed); // BLACK
      ZOBRIST[r][c][1] = rand64(seed); // WHITE
    }
  }
}
function hashBoard(b){
  if (!ZOBRIST) initZobrist();
  let h = 0n;
  for (let r=0;r<SIZE;r++){
    for (let c=0;c<SIZE;c++){
      const v = b[r][c];
      if (v === BLACK) h ^= ZOBRIST[r][c][0];
      else if (v === WHITE) h ^= ZOBRIST[r][c][1];
    }
  }
  return h;
}

function speedConfig(){
  const s = speedEl.value;
  if (s === 'fast')   return { flipDelay: 55, aiDelay: 250, animMs: 210 };
  if (s === 'slow')   return { flipDelay: 120, aiDelay: 450, animMs: 320 };
  return              { flipDelay: 85, aiDelay: 320, animMs: 260 };
}

function initBoard(){
  board = Array.from({length: SIZE}, () => Array(SIZE).fill(EMPTY));
  const mid = SIZE/2;
  board[mid-1][mid-1] = WHITE;
  board[mid][mid] = WHITE;
  board[mid-1][mid] = BLACK;
  board[mid][mid-1] = BLACK;

  current = BLACK;
  inputLocked = false;
  aiThinking = false;
  lastMoveText = '';
}

function inBounds(r,c){ return r>=0 && r<SIZE && c>=0 && c<SIZE; }

function cloneBoard(b){ return b.map(row => row.slice()); }

function countPieces(b){
  let black=0, white=0;
  for (let r=0;r<SIZE;r++){
    for (let c=0;c<SIZE;c++){
      if (b[r][c]===BLACK) black++;
      else if (b[r][c]===WHITE) white++;
    }
  }
  return {black, white};
}

function getFlips(b, r, c, color){
  if (b[r][c] !== EMPTY) return [];
  const opp = -color;
  const flipsAll = [];

  for (const [dr,dc] of DIRS){
    let rr=r+dr, cc=c+dc;
    const line = [];
    while (inBounds(rr,cc) && b[rr][cc]===opp){
      line.push([rr,cc]);
      rr+=dr; cc+=dc;
    }
    if (line.length>0 && inBounds(rr,cc) && b[rr][cc]===color){
      flipsAll.push(...line);
    }
  }
  return flipsAll;
}

function getValidMoves(b, color){
  const moves = [];
  for (let r=0;r<SIZE;r++){
    for (let c=0;c<SIZE;c++){
      const flips = getFlips(b,r,c,color);
      if (flips.length>0) moves.push({r,c,flips});
    }
  }
  return moves;
}

function setStatus(){
  const {black, white} = countPieces(board);
  blackScoreEl.textContent = black;
  whiteScoreEl.textContent = white;

  const turnName = current===BLACK ? '黑棋（你）' : '白棋（電腦）';
  turnPill.textContent = `回合：${turnName}`;
  const diffName = difficultyEl.value === 'basic' ? '基本棋力' : '進階棋力';
  const thinking = aiThinking ? '（電腦思考中…）' : '';
  statusPill.textContent = `狀態：${diffName}${thinking} ${lastMoveText ? '｜' + lastMoveText : ''}`.trim();
}

function render(){
  boardEl.innerHTML = '';

  const valid = getValidMoves(board, current);
  const validSet = new Set(valid.map(m => `${m.r},${m.c}`));

  for (let r=0;r<SIZE;r++){
    for (let c=0;c<SIZE;c++){
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);

      if (board[r][c] !== EMPTY){
        const disc = document.createElement('div');
        disc.className = 'disc ' + (board[r][c]===BLACK ? 'black' : 'white');
        cell.appendChild(disc);
      }else{
        if (showHints && validSet.has(`${r},${c}`) && !inputLocked){
          const dot = document.createElement('div');
          dot.className = 'dotHint';
          cell.appendChild(dot);
        }
      }

      cell.addEventListener('click', () => onCellClick(r,c));
      boardEl.appendChild(cell);
    }
  }

  setStatus();
}

function cellEl(r,c){
  return boardEl.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
}

function sleep(ms){ return new Promise(res => setTimeout(res, ms)); }

async function applyMoveAnimated(r,c,color,flips){
  const { flipDelay, animMs } = speedConfig();
  inputLocked = true;

  // 落子
  board[r][c] = color;
  render();
  await sleep(30);

  // 依序翻棋（逐顆翻）
  for (const [fr,fc] of flips){
    const el = cellEl(fr,fc);
    if (el){
      const disc = el.querySelector('.disc');
      if (disc) disc.classList.add('flipping');
    }

    await sleep(Math.max(70, Math.floor(animMs * 0.5)));
    board[fr][fc] = color;
    render();

    await sleep(Math.max(40, Math.floor(animMs * 0.35)));
    await sleep(flipDelay);
  }

  inputLocked = false;
  render();
}

function gameOverIfNeeded(){
  const bMoves = getValidMoves(board, BLACK).length;
  const wMoves = getValidMoves(board, WHITE).length;
  if (bMoves===0 && wMoves===0){
    const {black, white} = countPieces(board);
    let msg = `遊戲結束！黑 ${black} : 白 ${white}。`;
    if (black>white) msg += ' 你贏了！';
    else if (white>black) msg += ' 電腦獲勝。';
    else msg += ' 平手。';
    lastMoveText = msg;
    render();
    return true;
  }
  return false;
}

async function passTurnIfNoMoves(){
  const moves = getValidMoves(board, current);
  if (moves.length===0){
    lastMoveText = (current===BLACK ? '黑棋' : '白棋') + '無合法步，PASS';
    current = -current;
    render();
    await sleep(180);
    return true;
  }
  return false;
}

async function onCellClick(r,c){
  if (inputLocked) return;
  if (current !== BLACK) return; // 玩家只能下黑
  const flips = getFlips(board, r, c, BLACK);
  if (flips.length===0) return;

  lastMoveText = `你下：(${r+1},${c+1})`;
  await applyMoveAnimated(r,c,BLACK,flips);

  if (gameOverIfNeeded()) return;

  current = WHITE;
  render();

  await passTurnIfNoMoves();
  if (gameOverIfNeeded()) return;

  if (current===WHITE){
    await computerMove();
  }
}

function pickBasicMove(moves){
  // 基本棋力：吃最多（同分隨機）
  let best = -Infinity;
  let pool = [];
  for (const m of moves){
    const score = m.flips.length;
    if (score > best){
      best = score;
      pool = [m];
    }else if (score === best){
      pool.push(m);
    }
  }
  return pool[Math.floor(Math.random()*pool.length)];
}

function applyMoveNoAnim(b, move, color){
  const nb = cloneBoard(b);
  nb[move.r][move.c] = color;
  for (const [fr,fc] of move.flips){
    nb[fr][fc] = color;
  }
  return nb;
}

// ===== 更強的評分函式（白棋有利為正分）=====
function evaluateBoard(b){
  let pos = 0;
  let discDiff = 0; // white - black
  let empty = 0;

  for (let r=0;r<SIZE;r++){
    for (let c=0;c<SIZE;c++){
      const v = b[r][c];
      if (v === EMPTY){ empty++; continue; }
      pos += (v === WHITE ? 1 : -1) * POS_W[r][c];
      discDiff += (v === WHITE ? 1 : -1);
    }
  }

  // 機動性
  const mW = getValidMoves(b, WHITE).length;
  const mB = getValidMoves(b, BLACK).length;
  const mobility = 10 * (mW - mB);

  // 前線子（frontier）
  let fW = 0, fB = 0;
  for (let r=0;r<SIZE;r++){
    for (let c=0;c<SIZE;c++){
      const v = b[r][c];
      if (v === EMPTY) continue;
      let frontier = false;
      for (const [dr,dc] of DIRS){
        const rr=r+dr, cc=c+dc;
        if (inBounds(rr,cc) && b[rr][cc]===EMPTY){ frontier=true; break; }
      }
      if (frontier){
        if (v===WHITE) fW++;
        else fB++;
      }
    }
  }
  const frontierScore = -6 * (fW - fB);

  // 角落
  const corners = [[0,0],[0,7],[7,0],[7,7]];
  let cornerScore = 0;
  for (const [r,c] of corners){
    if (b[r][c]===WHITE) cornerScore += 120;
    else if (b[r][c]===BLACK) cornerScore -= 120;
  }

  // X / C square 懲罰（角落空時）
  const xSquares = [[1,1],[1,6],[6,1],[6,6]];
  const cSquares = [[0,1],[1,0],[0,6],[1,7],[6,0],[7,1],[6,7],[7,6]];
  let xs = 0, cs = 0;

  const cornerEmpty = (cr,cc)=> b[cr][cc]===EMPTY;
  const xToCorner = (r,c)=>{
    if (r===1 && c===1) return [0,0];
    if (r===1 && c===6) return [0,7];
    if (r===6 && c===1) return [7,0];
    return [7,7];
  };
  for (const [r,c] of xSquares){
    const [cr,cc] = xToCorner(r,c);
    if (!cornerEmpty(cr,cc)) continue;
    if (b[r][c]===WHITE) xs -= 80;
    else if (b[r][c]===BLACK) xs += 80;
  }

  const cToCorner = (r,c)=>{
    if (r===0 && c===1) return [0,0];
    if (r===1 && c===0) return [0,0];
    if (r===0 && c===6) return [0,7];
    if (r===1 && c===7) return [0,7];
    if (r===6 && c===0) return [7,0];
    if (r===7 && c===1) return [7,0];
    if (r===6 && c===7) return [7,7];
    return [7,7];
  };
  for (const [r,c] of cSquares){
    const [cr,cc] = cToCorner(r,c);
    if (!cornerEmpty(cr,cc)) continue;
    if (b[r][c]===WHITE) cs -= 30;
    else if (b[r][c]===BLACK) cs += 30;
  }

  // 終局越近：子數差越重要
  const discWeight = (empty <= 16) ? 14 : (empty <= 28 ? 6 : 2);
  const discScore = discWeight * discDiff;

  return pos + mobility + frontierScore + cornerScore + xs + cs + discScore;
}

function terminalScore(b){
  const {black, white} = countPieces(b);
  return (white - black) * 10000;
}

function orderMoves(moves){
  // 角落優先、位置權重高優先、翻子多優先
  return moves.slice().sort((a,b)=>{
    const ac = (a.r===0||a.r===7)&&(a.c===0||a.c===7);
    const bc = (b.r===0||b.r===7)&&(b.c===0||b.c===7);
    if (ac!==bc) return (bc?1:0) - (ac?1:0);
    const aw = POS_W[a.r][a.c] + a.flips.length*2;
    const bw = POS_W[b.r][b.c] + b.flips.length*2;
    return bw - aw;
  });
}

function minimaxTT(b, color, depth, alpha, beta, deadline){
  if (performance.now() > deadline){
    return { score: evaluateBoard(b), move: null, aborted: true };
  }

  const moves = getValidMoves(b, color);
  const oppMoves = getValidMoves(b, -color);
  const isTerminal = (moves.length===0 && oppMoves.length===0);
  if (isTerminal){
    return { score: terminalScore(b), move: null, aborted: false };
  }
  if (depth === 0){
    return { score: evaluateBoard(b), move: null, aborted: false };
  }

  // PASS
  if (moves.length === 0){
    return minimaxTT(b, -color, depth-1, alpha, beta, deadline);
  }

  const alphaOrig = alpha;
  const betaOrig = beta;

  const h = hashBoard(b);
  const tt = TT.get(h);
  if (tt && tt.depth >= depth){
    if (tt.flag === TT_FLAG.EXACT) return { score: tt.score, move: tt.bestMove, aborted: false };
    if (tt.flag === TT_FLAG.LOWER) alpha = Math.max(alpha, tt.score);
    else if (tt.flag === TT_FLAG.UPPER) beta = Math.min(beta, tt.score);
    if (alpha >= beta) return { score: tt.score, move: tt.bestMove, aborted: false };
  }

  const maximizing = (color === WHITE);
  let bestMove = null;
  let bestScore = maximizing ? -Infinity : Infinity;

  const ordered = orderMoves(moves);

  for (const m of ordered){
    const nb = applyMoveNoAnim(b, m, color);
    const res = minimaxTT(nb, -color, depth-1, alpha, beta, deadline);
    if (res.aborted) return { score: bestScore, move: bestMove, aborted: true };

    const sc = res.score;
    if (maximizing){
      if (sc > bestScore){ bestScore = sc; bestMove = m; }
      alpha = Math.max(alpha, bestScore);
    }else{
      if (sc < bestScore){ bestScore = sc; bestMove = m; }
      beta = Math.min(beta, bestScore);
    }
    if (beta <= alpha) break;
  }

  // TT flag：用原始窗判定
  let flag = TT_FLAG.EXACT;
  if (bestScore <= alphaOrig) flag = TT_FLAG.UPPER;
  else if (bestScore >= betaOrig) flag = TT_FLAG.LOWER;

  TT.set(h, { depth, score: bestScore, flag, bestMove });

  return { score: bestScore, move: bestMove, aborted: false };
}

async function computerMove(){
  if (inputLocked) return;
  if (current !== WHITE) return;

  const { aiDelay } = speedConfig();
  aiThinking = true;
  render();
  inputLocked = true;

  await sleep(aiDelay);

  const moves = getValidMoves(board, WHITE);
  if (moves.length === 0){
    aiThinking = false;
    inputLocked = false;
    lastMoveText = '白棋無合法步，PASS';
    current = BLACK;
    render();
    await passTurnIfNoMoves();
    return;
  }

  let chosen;

  if (difficultyEl.value === 'basic'){
    chosen = pickBasicMove(moves);
  } else {
    // ===== 進階：Iterative deepening + TT + 終局加深 =====
    TT.clear();

    const {black, white} = countPieces(board);
    const filled = black + white;
    const empty = 64 - filled;

    // 時間預算（速度越慢越久，搜尋越深）
    const s = speedEl.value;
    const budget = (s === 'fast') ? 420 : (s === 'slow' ? 1150 : 750);
    const deadline = performance.now() + budget;

    // 最大深度：中盤 7，終局可到 9（更強）
    let maxDepth = 7;
    if (empty <= 18) maxDepth = 8;
    if (empty <= 12) maxDepth = 9;

    let bestSoFar = null;

    for (let d = 2; d <= maxDepth; d++){
      const res = minimaxTT(board, WHITE, d, -Infinity, Infinity, deadline);
      if (res.aborted) break;
      if (res.move) bestSoFar = res.move;
    }

    chosen = bestSoFar || pickBasicMove(moves);
  }

  lastMoveText = `電腦下：(${chosen.r+1},${chosen.c+1})`;
  aiThinking = false;
  inputLocked = false;

  await applyMoveAnimated(chosen.r, chosen.c, WHITE, chosen.flips);

  if (gameOverIfNeeded()) return;

  current = BLACK;
  render();

  await passTurnIfNoMoves();
  if (gameOverIfNeeded()) return;
  if (current === WHITE){
    await computerMove();
  }
}

function wireUI(){
  restartBtn.addEventListener('click', () => {
    initBoard();
    render();
  });

  difficultyEl.addEventListener('change', () => {
    render();
    if (current === WHITE && !inputLocked) computerMove();
  });

  speedEl.addEventListener('change', () => render());

  toggleHintsBtn.addEventListener('click', () => {
    showHints = !showHints;
    render();
  });
}

function start(){
  initBoard();
  wireUI();
  render();
}

start();
