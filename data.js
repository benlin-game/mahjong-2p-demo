// data.js — config, tile constants, fan table, UI text (finalver-13MJ)
'use strict';

const CONFIG = {
  BASE: 10,                // default base stake for headless sim (UI picks from the tier's bets[])
  LOSS_CAP_MULT: 16,       // player loss cap in units of base; also the per-game wager
  PASS_MULT_CAP: 64,       // pass-up (guo-shui) multiplier cap = 2^6
  START_CREDITS: 5000000,  // demo starting credits
  RTP_TARGET: 0.95,        // display fallback for the stats readout before any games
  RTP_WINDOW: 400,         // rolling window size (games) for the RTP readout
  ACTION_CAP: 400,         // hard safety cap on actions per game (selfTest)
};

// Tile kinds: 1..9 = suit numbers, 11..17 = honors (E S W N C F P)
const KINDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17];
const SUITS = ['w', 'b', 't'];
const SUIT_NAME = { w: '萬', b: '筒', t: '條' };
const NUM_NAME = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const HONOR_NAME = { 11: '東', 12: '南', 13: '西', 14: '北', 15: '中', 16: '發', 17: '白' };

// Fan patterns. id → { name (zh-TW, user-facing), fan }
const FAN = {
  // 1
  ting:          { name: '聽牌', fan: 1 },
  zimo:          { name: '自摸', fan: 1 },
  dandiao:       { name: '單釣將', fan: 1 },
  kanzhang:      { name: '坎張', fan: 1 },
  bianzhang:     { name: '邊張', fan: 1 },
  minggang:      { name: '明槓', fan: 1 },
  yaojiuke:      { name: '么九刻', fan: 1 },
  laoshaofu:     { name: '老少副', fan: 1 },
  lianliu:       { name: '連六', fan: 1 },
  yibangao:      { name: '一般高', fan: 1 },
  // 2
  duanyao:       { name: '斷么', fan: 2 },
  angang:        { name: '暗槓', fan: 2 },
  shuanganke:    { name: '雙暗刻', fan: 2 },
  siguiyi:       { name: '四歸一', fan: 2 },
  pinghu:        { name: '平胡', fan: 2 },
  menqing:       { name: '門前清', fan: 2 },
  jianke:        { name: '箭刻', fan: 2 },
  // 4
  juezhang:      { name: '胡絕張', fan: 4 },
  shuangminggang:{ name: '雙明槓', fan: 4 },
  buqiuren:      { name: '不求人', fan: 4 },
  hundaiyao:     { name: '混帶么', fan: 4 },
  // 5
  qingdaiyao:    { name: '清帶么', fan: 5 },
  // 6
  shuangjianke:  { name: '雙箭刻', fan: 6 },
  shuangangang:  { name: '雙暗槓', fan: 6 },
  quanqiuren:    { name: '全求人', fan: 6 },
  hunyise:       { name: '混一色', fan: 6 },
  pengpenghu:    { name: '碰碰胡', fan: 6 },
  // 8
  qianggang:     { name: '搶槓胡', fan: 8 },
  gangkai:       { name: '槓上開花', fan: 8 },
  haidi:         { name: '海底撈月', fan: 8 },
  miaoshou:      { name: '妙手回春', fan: 8 },
  // 12
  diting:        { name: '地聽', fan: 12 },
  sanfengke:     { name: '三風刻', fan: 12 },
  // 16
  tianting:      { name: '天聽', fan: 16 },
  sananke:       { name: '三暗刻', fan: 16 },
  sanbugao:      { name: '一色三步高', fan: 16 },
  qinglong:      { name: '清龍', fan: 16 },
  // 24
  sanjiegao:     { name: '一色三節高', fan: 24 },
  santongshun:   { name: '一色三同順', fan: 24 },
  qingyise:      { name: '清一色', fan: 24 },
  qidui:         { name: '七對', fan: 24 },
  // 32
  hunyaojiu:     { name: '混么九', fan: 32 },
  sangang:       { name: '三槓', fan: 32 },
  sibugao:       { name: '一色四步高', fan: 32 },
  // 48
  sijiegao:      { name: '一色四節高', fan: 48 },
  sitongshun:    { name: '一色四同順', fan: 48 },
  // 64
  shuanglonghui: { name: '一色雙龍會', fan: 64 },
  xiaoyuwu:      { name: '小於五', fan: 64 },
  dayuwu:        { name: '大於五', fan: 64 },
  sianke:        { name: '四暗刻', fan: 64 },
  ziyise:        { name: '字一色', fan: 64 },
  xiaosanyuan:   { name: '小三元', fan: 64 },
  xiaosixi:      { name: '小四喜', fan: 64 },
  // 88
  renhu:         { name: '人胡', fan: 88 },
  dihu:          { name: '地胡', fan: 88 },
  tianhu:        { name: '天胡', fan: 88 },
  sigang:        { name: '四槓', fan: 88 },
  jiulian:       { name: '九蓮寶燈', fan: 88 },
  lianqidui:     { name: '連七對', fan: 88 },
  dasanyuan:     { name: '大三元', fan: 88 },
  dasixi:        { name: '大四喜', fan: 88 },
  gangshanggang: { name: '槓上槓', fan: 88 },
  // 128
  qixing:        { name: '七星北斗', fan: 128 },
  // 168
  queshen:       { name: '雀神無雙', fan: 168 },
  // bonus mini-game (not in the rulebook fan table; player-only duihua bonus)
  duihua:        { name: '對花', fan: 1 },
};

// Duihua bonus: P(0/1/2/3 matches) — cumulative thresholds
const DUIHUA_PROBS = [0.5, 0.85, 0.95, 1.0];

// Difficulty tiers — two characters share each tier's skill set.
// skill flags: pass = pass-doubling, reveal = bet-tier hand reveal, handLimit = max draws
// per seat (0 = unlimited). Haidi + base duihua are always on. minBet gates the tier.
// Difficulty tiers — each has its own stake table + per-stake reveal count.
// bets = selectable base stakes (per-game wager / loss cap = bet × LOSS_CAP_MULT).
// reveals = AI tiles shown to the player at the matching stake index (0 = none).
const TIERS = {
  normal: { name: '一般局', bets: [100, 300, 500, 1000, 2000],       reveals: [0, 0, 0, 0, 0],
            skill: { pass: false } },
  expert: { name: '高手局', bets: [500, 1000, 2000, 5000, 10000],    reveals: [1, 3, 5, 7, 9],
            skill: { pass: false, reveal: true } },
  elite:  { name: '菁英局', bets: [2000, 5000, 10000, 50000, 100000], reveals: [1, 3, 5, 7, 9],
            skill: { pass: true, reveal: true, handLimit: 10 } },
};

// Opponent characters (portraits in assets/chars/; names are placeholders — rename freely).
const CHARS = [
  { id: 'B1', name: '老雀聖',   img: 'assets/chars/C_B1.png', tier: 'normal' },
  { id: 'G2', name: '魅影佳人', img: 'assets/chars/C_G2.png', tier: 'normal' },
  { id: 'B3', name: '冷面浪子', img: 'assets/chars/C_B3.png', tier: 'expert' },
  { id: 'B4', name: '暗夜之手', img: 'assets/chars/C_B4.png', tier: 'expert' },
  { id: 'G1', name: '翡翠夫人', img: 'assets/chars/C_G1.png', tier: 'elite' },
  { id: 'B2', name: '金龍賭王', img: 'assets/chars/C_B2.png', tier: 'elite' },
].map(c => {
  const t = TIERS[c.tier];
  return { ...c, tierName: t.name, bets: t.bets, reveals: t.reveals, skill: t.skill };
});

const TEXT = {
  title: '二人麻將機台',
  you: '你', ai: '莊家',
  dealerMark: '莊',
  draw: '流局',
  win: '胡牌', tsumo: '自摸', ron: '胡',
  pass: '過水', pon: '碰', chi: '吃', gang: '槓', ting: '喊聽', skip: '略過',
  huButton: '胡！',
  passHint: '過水加倍 ×',
  wall: '牆', round: '局', mult: '倍',
  credits: '持分', wager: '每局注額',
  next: '下一局',
  autoplay: '自動玩',
  tingLocked: '已聽牌（手牌鎖定）',
  youWin: '你胡了', aiWin: '莊家胡了',
  netWin: '贏', netLose: '輸',
  total: '合計',
  suitOfRound: '本局花色',
  chooseChi: '選擇吃牌組合',
  tingSelect: '選擇打出的牌（維持聽牌）',
  robbed: '搶槓！',
  haidiTitle: '海底遊戲',
  haidiNote: '摸三張，摸中聽的牌即胡（計海底撈月）',
  duihuaTitle: '對花遊戲',
  duihuaNote: '摸三張，中手牌相同的牌每張 +1 台',
  bonusLeft: '還可摸',
  bonusUnit: '張',
  bonusConfirm: '開牌結算',
  betTitle: '二人麻將',
  betRule: '贏分無上限，最多輸 16 倍',
  betChoose: '下方選擇投注金額',
  betReqPrefix: '持有金幣需 ≥ ',
  betAmount: '總投注額',
  betStart: '開局',
  betShort: '金幣不足',
  revealPrefix: '對手亮牌 ',
  revealUnit: ' 張',
  revealNone: '對手不亮牌',
  chooseOpp: '選擇對手',
  betRange: '底注 ',
  perkPass: '＋過水加倍',
  perkHandLimit: '＋限 ', perkHandLimitUnit: ' 手',
};

if (typeof module !== 'undefined') {
  module.exports = { CONFIG, KINDS, SUITS, SUIT_NAME, NUM_NAME, HONOR_NAME, FAN, TEXT, DUIHUA_PROBS, CHARS };
}
