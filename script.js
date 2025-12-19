'use strict';

/**
 * Othello / Reversi
 * 玩家：黑(1) 先手；電腦：白(-1) 後手
 * AI：
 *  - basic：貪婪（吃最多）+ 少量隨機
 *  - advanced：Minimax + alpha-beta（深度依速度/難度設置）+ 位置權重/機動性/角落
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

function speedConfig(){
  const s = speedEl.value;
  if (s === 'fast')   return { flipDelay: 55, aiDelay: 250, animMs: 210, depth: 3 };
  if (s === 'slow')   return { flipDelay: 120, aiDelay: 450, animMs: 320, depth: 4 };
  return              { flipDelay: 85, aiDelay: 320, animMs: 260, depth: 4 };
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

      // piece
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
      // 加動畫 class
      const disc = el.querySelector('.disc');
      if (disc) disc.classList.add('flipping');
    }

    // 翻面在動畫中段時刻切換顏色
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

  // 若白沒步就 PASS，再檢查黑是否也沒步
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

function evaluateBoard(b){
  // 對白棋（電腦）評分：正分有利白
  let pos = 0, disc = 0;
  for (let r=0;r<SIZE;r++){
    for (let c=0;c<SIZE;c++){
      const v = b[r][c];
      if (v === EMPTY) continue;
      disc += v; // 黑=+1 白=-1（所以要反向處理）
      // 位置權重：白(-1)放在高權重應該加分 => -v * w
      pos += (-v) * POS_W[r][c];
    }
  }

  // 機動性（能走的步數差）
  const mWhite = getValidMoves(b, WHITE).length;
  const mBlack = getValidMoves(b, BLACK).length;
  const mobility = 8 * (mWhite - mBlack);

  // 角落（非常重要）
  const corners = [[0,0],[0,7],[7,0],[7,7]];
  let cornerScore = 0;
  for (const [r,c] of corners){
    if (b[r][c]===WHITE) cornerScore += 35;
    else if (b[r][c]===BLACK) cornerScore -= 35;
  }

  // disc 盤面子數（中後期才更重要，這裡權重較小）
  const discScore = -disc * 2; // 白多 => disc 會偏正(黑多)，所以取 -disc

  return pos + mobility + cornerScore + discScore;
}

function applyMoveNoAnim(b, move, color){
  const nb = cloneBoard(b);
  nb[move.r][move.c] = color;
  for (const [fr,fc] of move.flips){
    nb[fr][fc] = color;
  }
  return nb;
}

function minimax(b, color, depth, alpha, beta){
  // 回傳：{score, move}
  const moves = getValidMoves(b, color);

  // 終局或深度到
  const oppMoves = getValidMoves(b, -color);
  const isTerminal = (moves.length===0 && oppMoves.length===0);
  if (depth === 0 || isTerminal){
    return { score: evaluateBoard(b), move: null };
  }

  // 沒步可走：PASS
  if (moves.length === 0){
    return minimax(b, -color, depth-1, alpha, beta);
  }

  // 電腦白：maximize；黑：minimize（因為 evaluateBoard 對白有利是正）
  const maximizing = (color === WHITE);

  let bestMove = null;

  if (maximizing){
    let bestScore = -Infinity;
    for (const m of moves){
      const nb = applyMoveNoAnim(b, m, color);
      const res = minimax(nb, -color, depth-1, alpha, beta);
      if (res.score > bestScore){
        bestScore = res.score;
        bestMove = m;
      }
      alpha = Math.max(alpha, bestScore);
      if (beta <= alpha) break;
    }
    return { score: bestScore, move: bestMove };
  }else{
    let bestScore = Infinity;
    for (const m of moves){
      const nb = applyMoveNoAnim(b, m, color);
      const res = minimax(nb, -color, depth-1, alpha, beta);
      if (res.score < bestScore){
        bestScore = res.score;
        bestMove = m;
      }
      beta = Math.min(beta, bestScore);
      if (beta <= alpha) break;
    }
    return { score: bestScore, move: bestMove };
  }
}

async function computerMove(){
  if (inputLocked) return;
  if (current !== WHITE) return;

  const { aiDelay, depth } = speedConfig();
  aiThinking = true;
  render();
  inputLocked = true;

  await sleep(aiDelay);

  const moves = getValidMoves(board, WHITE);
  if (moves.length === 0){
    // PASS
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
  }else{
    // 進階棋力：minimax
    // 盤面越後期可以略加深，但注意效能
    const pieces = countPieces(board);
    const filled = pieces.black + pieces.white;
    let d = depth;
    if (filled >= 44) d = Math.min(5, depth+1);
    const res = minimax(board, WHITE, d, -Infinity, Infinity);
    chosen = res.move || pickBasicMove(moves);
  }

  lastMoveText = `電腦下：(${chosen.r+1},${chosen.c+1})`;
  aiThinking = false;
  inputLocked = false;

  await applyMoveAnimated(chosen.r, chosen.c, WHITE, chosen.flips);

  if (gameOverIfNeeded()) return;

  current = BLACK;
  render();

  // 若黑無步則PASS並讓白繼續
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
    // 若現在輪到白且玩家剛切難度，讓電腦按新難度走
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
