/* ============================================================
   HOTLINE — H5 版
   俯视角一击必杀：一击死、武器即资源、声音即情报。
   纯 Canvas 2D + WebAudio，无任何依赖，双击 index.html 即可玩。
   ============================================================ */
(function () {
  'use strict';

  // ---------------------------------------------------------------- 常量
  const VIEW_W = 640, VIEW_H = 360, ZOOM = 2;
  const TILE = 24;
  const PLAYER_SPEED = 134;
  const ACTOR_R = 8;

  // ---------------------------------------------------------------- 瞄准（ADS）
  // 按住右键抬枪：散射收紧、准心收拢、**画面拉远**（视野反而比腰射大）+ 相机顺着
  // 瞄准方向前探一大截 —— 三件事叠起来才能"站着不动看到很远"。
  // 腰射故意做得很散 —— 不瞄准时基本只能近距离泼水，逼玩家按右键。
  const AIM_ZOOM_MUL = 0.75;   // 瞄准时画面缩放倍数（2 → 1.5）：视野比腰射宽 33%（320 → 427 世界像素）
  const AIM_IN = 0.09;         // 抬枪到位时长（秒）
  const AIM_OUT = 0.12;        // 收枪时长（比抬枪略慢，松手不会"啪"一下弹回去）
  const HIP_SPREAD_MUL = 2.2;  // 腰射散射放大（相对武器基础 spread）
  const AIM_SPREAD_MUL = 0.30; // 瞄准散射收紧
  const AIM_MOVE_MUL = 0.35;   // 瞄准时移速倍率（端枪就是慢：134 → 47 px/s，几乎只能挪）
  // 前探：瞄准时相机朝准心方向让出去多少。数值给得偏大，最后会被下面的
  // AIM_EDGE_X / AIM_EDGE_Y 卡到"玩家刚好还留在画面里"的那个极限位置。
  const AIM_PAN_MUL = 3.0;
  const AIM_EDGE_X = 76;       // 瞄准满前探时，玩家中心距画面左右边至少留的 canvas 像素
  const AIM_EDGE_Y = 76;       // 纵向同理（底部有 HUD，别让玩家钻到血条底下）

  // ---- 触屏辅助瞄准（自瞄）参数：只在玩家摇杆指向的扇形内轻微修正，绝不反向吸 ----
  const AIM_SNAP_RANGE = 260;     // 吸附搜索半径（世界像素），超出不吸
  const AIM_SNAP_ANGLE = 0.45;    // 吸附半角（弧度，约 26°）：敌人在摇杆方向 ±26° 内才考虑
  const AIM_SNAP_STRENGTH = 0.55; // 修正强度：敌人方向占比（0..1），越大吸越狠。0.55 保留玩家主导

  // ---------------------------------------------------------------- 血量与护甲
  // 单血量 + 可升级护甲（升级站里买，跟着这一局走，死了重开归 1 级）。
  //   血量上限 100。护甲分 4 级：1 级单格 50 → 2 级三格 50 → 3 级两格紫甲 75 → 4 级金甲单格 150。
  //   受击时护甲先扣，护甲扣完才掉血。护甲板可以一格一格地补充。
  const HP_MAX = 100;
  const ARMOR_PLATE_CAP = 3;  // 背包里最多背几块护甲板（和"护甲格数"无关，是携带上限）
  // 护甲 4 个等级：每级决定格数(slots) + 每格护甲值(per) + 外观颜色 + 满甲值。
  // 满甲值 50 → 150 → 150 → 150 递增，格数 1→3→2→1，越高级甲越"整块"、颜色越金。
  const ARMOR_TIERS = [
    { slots: 1, per: 50,  name: '基础甲', color: '#8a8a90', desc: '单格 50' },
    { slots: 2, per: 50,  name: '进阶甲', color: '#8a8a90', desc: '两格 · 每格 50' },
    { slots: 3, per: 50,  name: '强化甲', color: '#8a8a90', desc: '三格 · 每格 50' },
    { slots: 2, per: 75,  name: '精英甲', color: '#c8c8d0', desc: '两格灰甲 · 每格 75' },
    { slots: 1, per: 150, name: '黄金甲', color: '#f2f2f4', desc: '白甲 · 单格 150' }
  ];
  const ARMOR_UP_PRICE = [400, 600, 900, 1200];   // 护甲升级到 2/3/4/5 级的价格（1 级初始免费）

  // 手持消耗品的读条时长（秒）：按住左键读满才生效
  const HEAL_TIME = 2.0;      // 血包：2 秒回 50
  const PLATE_TIME = 1.0;     // 护甲板：1 秒装一格

  // 波次之间整备时间（秒）：清完一波后给玩家 30 秒补装备，可按空格/回车跳过
  const INTERMISSION_TIME = 30;
  // 开局准备时间（秒）：第一波之前先给 30 秒，熟悉地图、去补给点买家伙
  const PREP_TIME = 30;

  // 老虎机保底：连着空转 SLOT_PITY 次之后，下一次必定出三同（不再无限连亏）
  const SLOT_PITY = 5;
  // 摇出两个相同时退回的安慰金（不至于 200 全打水漂）
  const SLOT_CONSOLE = 40;

  // ---------------------------------------------------------------- 资源
  const SPRITE_DIR = 'assets/sprites/';
  // 活人造型不用贴图（一个头 + 两只圆手，实时画），这里只留场景、血、尸体和武器
  const SPRITE_NAMES = [
    'wall', 'floor', 'floor2', 'door', 'cover', 'shadow', 'spark', 'dot',
    'blood_1', 'blood_2', 'blood_3', 'blood_4', 'blood_5', 'blood_6',
    'blood_streak_1', 'blood_streak_2', 'blood_streak_3',
    'corpse_player', 'corpse_enemy_melee', 'corpse_enemy_gun', 'corpse_enemy_shotgun',
    'w_pistol', 'w_shotgun', 'w_smg', 'w_bat', 'w_knife'
  ];
  const IMG = {};

  // ---------------------------------------------------------------- 武器表
  //
  // blood 一栏决定"打死了能溅出多少"，越往下越血腥：
  //   pools 血泊滩数 / spurts 血雾团数 / streaks 拖拽血痕条数
  //   scale 整体尺寸 / spray 空中血珠数量 / speckles 地面碎血点
  //
  // 备弹（reserve 上限）与弹匣（mag）分开：
  //   手枪 mag 12 / 备弹 90    霰弹枪 mag 5 / 备弹 30    冲锋枪 mag 20 / 备弹 120
  // 枪械基础属性刻意压得很低：伤害、弹匣、射程都要靠升级站补回来。
  // 这里写的是"出厂状态"，`gunStat()` 会再叠上玩家在该枪种上的升级等级。
  const WEAPONS = {
    pistol: {
      name: '手枪', melee: false, fireRate: 0.15, mag: 8, reserveMax: 64, pellets: 1,
      spread: 1.6, range: 380, auto: false, shake: 2.2, kick: 6, reload: 0.9, noise: 520,
      sound: 'shoot', icon: 'w_pistol', dmg: 20, price: 0, drawTime: 0.22,
      blood: { pools: 1, spurts: 2, streaks: 1, scale: 0.7, spray: 10, speckles: 12 }
    },
    smg: {
      name: '冲锋枪', melee: false, fireRate: 0.07, mag: 14, reserveMax: 84, pellets: 1,
      spread: 8.0, range: 220, auto: true, shake: 3.4, kick: 9, reload: 1.3, noise: 560,
      sound: 'smg', icon: 'w_smg', dmg: 12, price: 400, drawTime: 0.34,
      blood: { pools: 2, spurts: 3, streaks: 2, scale: 0.8, spray: 16, speckles: 20 }
    },
    shotgun: {
      name: '霰弹枪', melee: false, fireRate: 0.75, mag: 4, reserveMax: 24, pellets: 7,
      spread: 9.0, range: 170, auto: false, shake: 6.0, kick: 6, reload: 1.4, noise: 520,
      sound: 'shotgun', icon: 'w_shotgun', dmg: 9, price: 300, drawTime: 0.46,
      blood: { pools: 7, spurts: 6, streaks: 5, scale: 1.15, spray: 34, speckles: 46 },
      // 断肢：霰弹枪贴脸轰就是一个大洞，越近越容易把人打散（见 gibChance）；
      // gibHead 表示还可能把头整个打飞（这时就不画完整尸体了）
      gib: 0.38, gibHead: true
    },
    bat: {
      name: '棒球棍', melee: true, fireRate: 0.32, mag: Infinity,
      reach: 34, arc: 130, shake: 3.0, sound: 'swing', icon: 'w_bat', dmg: 52, price: 100,
      drawTime: 0.26,
      blood: { pools: 3, spurts: 3, streaks: 2, scale: 0.95, spray: 18, speckles: 24 }
    },
    knife: {
      name: '武士刀', melee: true, fireRate: 0.24, mag: Infinity,
      reach: 42, arc: 95, shake: 2.4, sound: 'swing', icon: 'w_knife', dmg: 48, price: 50,
      drawTime: 0.16,
      blood: { pools: 2, spurts: 2, streaks: 2, scale: 0.85, spray: 14, speckles: 18 },
      // 断肢：砍中打死时有这么高的概率把对方的手/头削下来（剧情模式一击必杀，最直观的"刀快"）
      gib: 0.5
    }
  };
  // 空手拳头：把枪扔出去后也不至于没辙 —— 贴脸才够得着（reach 24），但一拳能放倒一个人。
  // 故意不进 WEAPONS 表，这样商店/升级站/拾取逻辑里都不会冒出"拳头"这件装备。
  const FIST = {
    name: '拳头', melee: true, fireRate: 0.34, mag: Infinity, hidden: true,
    reach: 24, arc: 80, shake: 1.6, sound: 'swing', icon: null, dmg: 30,
    blood: { pools: 2, spurts: 2, streaks: 2, scale: 0.9, spray: 16, speckles: 20 }
  };
  const PUNCH_TIME = 0.2;   // 出拳的前伸动画时长（纯视觉）
  // 近战挥砍动画：刀/棍整把武器从一侧扫到另一侧（纯视觉，判定仍是 fireRate 那一瞬间的扇形）。
  // 比出手间隔（fireRate）短一截，武器才像"唰"地一下划过去；但也不能短到只剩三四帧，
  // 那样整把刀是"瞬移"过去的，看不出挥砍路线（0.11s 就是这个毛病，放到 0.15/0.19）。
  const SWING_TIME = { knife: 0.15, bat: 0.19 };
  const SWING_DEFAULT = 0.16;
  // 剧情模式玩家移速倍率：没有血量、一击必杀的关卡里，走位就是唯一的容错手段，
  // 默认 134 在"一堆小房间 + 密集敌人"的新地图里太憋屈，放到 1.22 倍（≈163）才能边跑边突入。
  const STORY_MOVE_MUL = 1.22;
  // ---------------------------------------------------------------- 武器升级
  //
  // 地图上的升级站（字符 U）在**第 5 波清完之后**解锁。四条线各 3 级，越升越贵；
  // 四条线全满以后开放"进化"，把枪整个换成另一个形态（双枪 / 半自动 / 双持）。
  //
  // 升级按**枪械种类**记账（G.upg.pistol / smg / shotgun），不跟着某一把枪走：
  // 主武器和背上的副武器只要是同型号，共用同一份加成，捡枪也不会把升级弄丢。
  const UPGRADE_LINES = [
    { id: 'dmg',   name: '伤害',     max: 3, price: [380, 660, 1050], short: '+22%' },
    { id: 'mag',   name: '弹匣',     max: 3, price: [300, 520, 830],  short: '+30%' },
    { id: 'range', name: '射程',     max: 3, price: [280, 480, 760],  short: '+22%' },
    { id: 'laser', name: '红外激光', max: 3, price: [340, 600, 960],  short: '-14% 散布' }
  ];
  const UP_GUNS = ['pistol', 'smg', 'shotgun'];
  const UP_PRICE_MUL = { pistol: 1.0, smg: 1.15, shotgun: 1.1 };
  const UP_UNLOCK_WAVE = 5;        // 第 5 波清完解锁
  const UP_DMG_PER = 0.22;         // 每级伤害 +22%
  const UP_MAG_PER = 0.30;         // 每级弹匣 +30%
  const UP_RANGE_PER = 0.22;       // 每级射程 +22%
  const UP_LASER_SPREAD = [1, 0.86, 0.72, 0.60];   // 激光等级 → 散布倍率
  const UP_EVO_PRICE = 1800;       // 进化价（还要四条线全满才开放）
  const UP_ARMOR_LINE = UPGRADE_LINES.length + 1;   // 升级站里「护甲」升级行的索引（进化=length，护甲=length+1）
  const UP_EVO_SHOT_RATE = 0.30;   // 半自动霰弹枪的射击间隔
  const DUAL_GUNS = { pistol: true, smg: true };   // 进化成"双持"的两种枪
  const UP_EVO_NAME = { pistol: '双枪', smg: '双持', shotgun: '半自动' };
  const UP_EVO_DESC = {
    pistol: '左右开弓 · 一次两发 · 弹匣翻倍',
    smg: '两把一起泼 · 一次两发 · 弹匣翻倍',
    shotgun: '改为半自动 · 射速 0.75s → 0.30s'
  };

  /** 空升级表：每局开局重建。 */
  function makeUpgrades() {
    const t = {};
    for (const id of UP_GUNS) t[id] = { dmg: 0, mag: 0, range: 0, laser: 0, evo: false };
    return t;
  }

  function gunUp(id) {
    return (G && G.upg && G.upg[id]) || null;
  }

  function gunEvolved(id) {
    const u = gunUp(id);
    return !!(u && u.evo);
  }

  /**
   * 取某个枪种叠完升级后的属性。所有"读武器数值"的地方都必须走这里，
   * 直接摸 WEAPONS[id].dmg 只会拿到出厂值 —— 升级就白买了。
   */
  function gunStat(id, key) {
    const def = WEAPONS[id];
    if (!def) return 0;
    const u = gunUp(id);
    if (!u) return def[key];
    switch (key) {
      case 'dmg':
        return Math.round(def.dmg * (1 + u.dmg * UP_DMG_PER));
      case 'range':
        return Math.round(def.range * (1 + u.range * UP_RANGE_PER));
      case 'mag': {
        let m = Math.max(1, Math.round(def.mag * (1 + u.mag * UP_MAG_PER)));
        if (u.evo && DUAL_GUNS[id]) m *= 2;     // 双持 = 两个弹匣
        return m;
      }
      case 'spread': {
        // 红外激光压的是**散布**，不是伤害：腰射也能收得住
        const k = u.laser > 0 ? UP_LASER_SPREAD[Math.min(u.laser, 3)] : 1;
        return def.spread * k;
      }
      case 'fireRate':
        return (u.evo && id === 'shotgun') ? UP_EVO_SHOT_RATE : def.fireRate;
      case 'auto':
        return (u.evo && id === 'shotgun') ? true : def.auto;
      case 'pellets':
        // 双持：每次扣扳机左右各出一发
        return def.pellets + (u.evo && DUAL_GUNS[id] ? 1 : 0);
      default:
        return def[key];
    }
  }

  /** 升级到下一级要多少钱；已满级返回 0。 */
  function upCost(gunId, lineId) {
    const line = UPGRADE_LINES.find(l => l.id === lineId);
    const u = gunUp(gunId);
    if (!line || !u) return 0;
    const lv = u[lineId] || 0;
    if (lv >= line.max) return 0;
    const raw = line.price[lv] * (UP_PRICE_MUL[gunId] || 1);
    return Math.round(raw / 10) * 10;
  }

  /** 四条线是否都满（进化前置）。 */
  function upAllMaxed(gunId) {
    const u = gunUp(gunId);
    if (!u) return false;
    return UPGRADE_LINES.every(l => (u[l.id] || 0) >= l.max);
  }

  // 空手 / 环境伤害的兜底血量
  const BLOOD_PLAIN = { pools: 1, spurts: 2, streaks: 1, scale: 0.7, spray: 8, speckles: 10 };
  const BLOOD_CAP = 420;   // 每层血迹贴花的上限，超了就不再留痕（防掉帧）

  // 散弹枪逐发装填：每塞一发的时间。换弹总时长 = 每发 × 缺的发数，塞满或被打断就停。
  const SHELL_RELOAD_TIME = 0.42;

  // ---------------------------------------------------------------- 关卡
  //
  // 单张波次防守地图（类似 COD 僵尸/PvE 生存）。玩家出生在中央，敌人从四角
  // 和四边的刷怪点一波波涌来，越往后越多、越硬、越快。清完一波自动进下一波。
  // 击杀攒积分，到地图上的补给点按 E 买武器/弹药/护甲/血包，或玩老虎机摇技能。
  //
  // 图例：# 墙  . 地板  o 掩体（木箱，挡人挡子弹也挡视线）  X 油桶（可打爆）
  //       P 玩家出生点  D 门  M 刷怪点  S 补给点（走近按 E 开商店）
  //       U 武器升级站（第 5 波清完后解锁，走近按 E）
  //       E 近战  G 枪手  S 霰弹兵（敌人由 spawnEnemies 按刷怪点动态生成）
  const ARENA = {
    title: '防守据点',
    rows: [
      '##############################',
      '#....M..................M....#',
      '#............................#',
      '#..o......o.X....o......o....#',
      '#....o......X.......o........#',
      '#........o...o...o...........#',
      '#..S......................S..#',
      '#...........U................#',
      '#....o........o........o.....#',
      '#..............P.............#',
      '#....o........o........o.....#',
      '#............................#',
      '#..S......................S..#',
      '#.....X..o...o...o...........#',
      '#....o..............o........#',
      '#..o......o......o......o....#',
      '#...................X........#',
      '#....M..................M....#',
      '##############################'
    ]
  };
  // 刷怪点：地图四个角 + 四条边中段（从地图里 M 字符读出来）
  const SPAWN_CHAR = 'M';
  // 补给点字符（走近按 E 打开商店）
  const SUPPLY_CHAR = 'S';
  // 武器升级站字符（走近按 E 打开升级界面，第 5 波清完解锁）
  const UPGRADE_CHAR = 'U';
  // 油桶字符：炸开前挡人挡子弹，被子弹打中或被爆炸波及就引爆
  const BARREL_CHAR = 'X';
  const BARREL_HP = 18;          // 打几枪才炸（手枪 30 伤害一枪就够，霰弹散布更容易误伤）
  const BARREL_RADIUS = 68;      // 爆炸半径
  const BARREL_DMG = 110;        // 中心伤害（按距离衰减到 30%）
  const BARREL_DELAY = 0.16;     // 中弹到炸开的引信时间：留一帧让人看见"我打中了"
  // 地图 24×16（比原来 30×18 小一圈，房间多、隔得碎，室内更贴脸）：
  // 12 行是楼体正面（只留一扇入口门 D），13/14 行是楼外街道，玩家出生在街道上（P），
  // 从门口打进去，杀完人再原路走回出生点即结算。
  // enemy：kind 用 ENEMY_KIND 键（melee/gun/shotgun），pos 为 [列, 行]（地图格坐标）。
  const STORY_LEVELS = [
    {
      title: '序章 · 破门',
      rows: [
        '########################',
        '#...o.#......o#.......o#',
        '#.....#.......#........#',
        '#.....#.......#........#',
        '#o....#o......#o.......#',
        '###D######D#######D#####',
        '#......................#',
        '##D######D########D#####',
        '#....#......o#o........#',
        '#....#.......#.........#',
        '#....#.......#.........#',
        '#...o#o......#........o#',
        '###########D############',
        '#rrrrrrrrrrrrrrrrrrrrrr#',
        '#rPrrrrrrrrrrrrrrrrrrrr#',
        '########################',
      ],
      enemies: [
        { kind: 'melee', pos: [2, 2] },
        { kind: 'melee', pos: [4, 3] },
        { kind: 'melee', pos: [9, 2] },
        { kind: 'melee', pos: [12, 3] },
        { kind: 'melee', pos: [17, 2] },
        { kind: 'melee', pos: [21, 3] },
        { kind: 'melee', pos: [2, 9] },
        { kind: 'melee', pos: [10, 9] },
      ]
    },
    {
      title: '第二章 · 猎犬',
      rows: [
        '########################',
        '#...o#...o#...o#.......#',
        '#....#....#....#......o#',
        '#....#....#....#.......#',
        '#o...#o...#o...#o......#',
        '##D####D####D######D####',
        '#......................#',
        '#......................#',
        '###D#######D#######D####',
        '#......#.......#.......#',
        '#.....o#......o#......o#',
        '#o.....#o......#o......#',
        '###########D############',
        '#rrrrrrrrrrrrrrrrrrrrrr#',
        '#rPrrrrrrrrrrrrrrrrrrrr#',
        '########################',
      ],
      enemies: [
        { kind: 'melee', pos: [2, 2] },
        { kind: 'gun', pos: [4, 3] },
        { kind: 'melee', pos: [7, 2] },
        { kind: 'gun', pos: [9, 3] },
        { kind: 'gun', pos: [12, 2] },
        { kind: 'melee', pos: [14, 3] },
        { kind: 'gun', pos: [17, 2] },
        { kind: 'gun', pos: [21, 3] },
        { kind: 'melee', pos: [5, 6] },
        { kind: 'gun', pos: [17, 7] },
        { kind: 'gun', pos: [2, 10] },
        { kind: 'melee', pos: [5, 11] },
        { kind: 'gun', pos: [9, 10] },
        { kind: 'melee', pos: [13, 11] },
      ]
    },
    {
      title: '第三章 · 破晓',
      rows: [
        '########################',
        '#......o#......#o......#',
        '#.......D......D.......#',
        '#o......#......#......o#',
        '#########......#########',
        '#.......#......#.......#',
        '#......oD......Do......#',
        '#o......#......#......o#',
        '#########......#########',
        '#.......#......#.......#',
        '#......oD......Do......#',
        '#o......#......#......o#',
        '###########D############',
        '#rrrrrrrrrrrrrrrrrrrrrr#',
        '#rPrrrrrrrrrrrrrrrrrrrr#',
        '########################',
      ],
      enemies: [
        { kind: 'melee', pos: [2, 2] },
        { kind: 'gun', pos: [6, 2] },
        { kind: 'gun', pos: [2, 6] },
        { kind: 'melee', pos: [6, 6] },
        { kind: 'gun', pos: [2, 10] },
        { kind: 'shotgun', pos: [6, 10] },
        { kind: 'gun', pos: [17, 2] },
        { kind: 'melee', pos: [21, 2] },
        { kind: 'shotgun', pos: [17, 6] },
        { kind: 'gun', pos: [21, 6] },
        { kind: 'gun', pos: [17, 10] },
        { kind: 'melee', pos: [21, 10] },
        { kind: 'gun', pos: [11, 2] },
        { kind: 'melee', pos: [12, 5] },
        { kind: 'gun', pos: [10, 7] },
        { kind: 'gun', pos: [12, 10] },
      ]
    },
    {
      title: '终章 · 炽线',
      rows: [
        '########################',
        '#......................#',
        '#.o..................o.#',
        '#....###D######D###....#',
        '#....#o..........o#....#',
        '#....#....o..o....#....#',
        '#....D...X........D....#',
        '#....#........X...#....#',
        '#....#o..........o#....#',
        '#....###D######D###....#',
        '#.o..................o.#',
        '#......................#',
        '###########D############',
        '#rrrrrrrrrrrrrrrrrrrrrr#',
        '#rPrrrrrrrrrrrrrrrrrrrr#',
        '########################',
      ],
      enemies: [
        { kind: 'shotgun', pos: [7, 5] },
        { kind: 'melee', pos: [11, 4] },
        { kind: 'gun', pos: [16, 5] },
        { kind: 'gun', pos: [9, 5] },
        { kind: 'gun', pos: [13, 8] },
        { kind: 'melee', pos: [15, 7] },
        { kind: 'gun', pos: [7, 7] },
        { kind: 'gun', pos: [11, 6] },
        { kind: 'melee', pos: [3, 1] },
        { kind: 'gun', pos: [10, 1] },
        { kind: 'shotgun', pos: [20, 1] },
        { kind: 'gun', pos: [2, 4] },
        { kind: 'melee', pos: [3, 6] },
        { kind: 'gun', pos: [20, 4] },
        { kind: 'gun', pos: [21, 6] },
        { kind: 'melee', pos: [4, 10] },
        { kind: 'gun', pos: [9, 11] },
        { kind: 'shotgun', pos: [19, 10] },
      ]
    }

  ];

  // 警觉范围的两道闸：
  //   ALERT_CONE  视野半角（原 60° → 现在 44°，总视野 120° → 88°）
  //   ALERT_NOISE 噪声半径总倍率（枪声 520 → 286），让"在另一头开一枪半张图的人都醒"消失
  // 视距本身也一起收短了：原来 190~215px 差不多是两三个房间的距离，玩家刚进门就被远处的人盯上。
  const ALERT_CONE = 44;
  const ALERT_NOISE = 0.55;
  const ALERT_NEAR = 0.30;        // 噪声半径内这一比例算"贴脸"，直接惊动追击

  const ENEMY_KIND = {
    melee: {
      tex: 'enemy_melee', corpse: 'corpse_enemy_melee',
      speed: 76, view: 132, attackRange: 26,
      keep: 0, interval: 0.62, aimErr: 0, weapon: 'knife', reaction: 0.34,
      windup: 0.28,
      hp: 24, dmg: 10, score: 50
    },
    gun: {
      tex: 'enemy_gun', corpse: 'corpse_enemy_gun',
      speed: 62, view: 156, attackRange: 150,
      keep: 118, interval: 0.62, aimErr: 13, weapon: 'pistol', reaction: 0.38,
      windup: 0.55,
      hp: 20, dmg: 9, score: 75
    },
    shotgun: {
      tex: 'enemy_shotgun', corpse: 'corpse_enemy_shotgun',
      speed: 68, view: 140, attackRange: 92,
      keep: 78, interval: 1.1, aimErr: 17, weapon: 'shotgun', reaction: 0.36,
      windup: 0.7,
      hp: 26, dmg: 8, score: 100
    }
  };

  // 爆头（参考塔科夫"瞄哪打哪"）：准心落在敌人头部范围里就算爆头
  const HEADSHOT_R = 7.0;      // 爆头判定半径（世界像素）
  const HEADSHOT_MULT = 2.6;   // 爆头伤害倍率
  const HEADSHOT_SCORE = 1.8;  // 爆头积分倍率

  // ---------------------------------------------------------------- 画布
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  function fitCanvas() {
    // 安全边距：手机上浏览器的地址栏/刘海/手势条会占用屏幕边缘，
    // 留一点余量避免 HUD（血条/护甲/弹药/按钮）被裁掉。
    const pad = inputMode === 'touch' ? 18 : 0;
    const availW = window.innerWidth - pad, availH = window.innerHeight - pad;
    // 统一用 min：保证整幅画面（含上下 HUD）完整可见，不裁边。
    // 横版游戏在更宽的屏幕上（如手机横屏 2.17:1）会左右留少量黑边，但 HUD 不再被切掉。
    let scale = Math.min(availW / VIEW_W, availH / VIEW_H);
    if (scale > 3) scale = Math.floor(scale * 2) / 2;
    // 兜底：极端小屏也保证至少能显示
    scale = Math.max(scale, 0.5);
    canvas.style.width = Math.round(VIEW_W * scale) + 'px';
    canvas.style.height = Math.round(VIEW_H * scale) + 'px';
  }

  // ---------------------------------------------------------------- 输入
  const keys = Object.create(null);
  const mouse = { x: VIEW_W / 2, y: VIEW_H / 2, down: false, right: false };
  let pressed = Object.create(null);   // 本帧刚按下

  // ---- 触控（手机）输入：双摇杆 + 虚拟按钮 ----
  // inputMode: 'pc' | 'touch'。touch 模式下所有键盘/鼠标输入都来自虚拟控件映射。
  let inputMode = 'pc';
  // fireMode: 'button'（点击开火按钮射击）| 'stick'（拖动摇杆持续射击）。二者二选一，持久化。
  let fireMode = 'button';
  const touch = {
    // 左摇杆：移动方向（单位向量），active 表示正在拖动
    moveActive: false, moveId: -1, moveOrigin: null, moveX: 0, moveY: 0,
    // 右摇杆：瞄准方向（单位向量）。推到边缘（超过 fireDead）才触发开火
    aimActive: false, aimId: -1, aimOrigin: null, aimX: 0, aimY: 0,
    firing: false,
    // 开火上升沿记录（用于给半自动武器补"单击"语义）
    firePrev: false,
    // 独立开火按钮（右摇杆区域左上角）：按住连发
    fireBtnActive: false, fireId: -1,
    // 独立瞄准按钮（按住抬枪 ADS）：按住 = 右键瞄准，松开收回
    aimBtnActive: false, aimBtnId: -1
  };
  // 虚拟按钮点击态（本帧刚按下），由按钮 hit 检测填充，注入到 pressed 表
  let touchPressed = Object.create(null);

  // ---- 触控控件几何布局（逻辑坐标 VIEW_W×VIEW_H）----
  const TOUCH_LAYOUT = {
    // 左摇杆：左下角
    moveBase: { x: 96, y: VIEW_H - 84, r: 46 },
    // 右摇杆：右下角（瞄准）
    aimBase: { x: VIEW_W - 96, y: VIEW_H - 84, r: 46 },
    // 独立开火键：右摇杆左上
    fireBtn: { x: VIEW_W - 176, y: VIEW_H - 150, r: 30 },
    // 独立瞄准键：右摇杆右上（按住抬枪 ADS）
    aimBtn: { x: VIEW_W - 176, y: VIEW_H - 210, r: 30 },
    // 动作按钮（右侧竖排）：换弹 / 换枪 / 手雷 / 医疗包 / 护甲板 / 交互 / 扔枪（仅剧情）
    buttons: [
      { key: 'r', label: '换弹', x: VIEW_W - 30, y: VIEW_H - 236 },
      { key: 'q', label: '换枪', x: VIEW_W - 30, y: VIEW_H - 198 },
      { key: 'g', label: '手雷', x: VIEW_W - 30, y: VIEW_H - 160 },
      { key: '3', label: '医疗包', x: VIEW_W - 30, y: VIEW_H - 122 },
      { key: '4', label: '护甲板', x: VIEW_W - 30, y: VIEW_H - 84 },
      { key: 'e', label: '交互', x: VIEW_W - 30, y: VIEW_H - 46 },
      { key: 'f', label: '扔枪', x: VIEW_W - 30, y: VIEW_H - 274 }
    ],
    btnR: 22
  };
  // 暂停按钮（左上角，菜单态也显示）
  const TOUCH_PAUSE = { x: 30, y: 30, r: 20 };
  // 跳过按钮（整备倒计时期间显示，屏幕中下方）
  const TOUCH_SKIP = { x: VIEW_W / 2, y: VIEW_H / 2 + 96, w: 96, h: 34 };

  // ---- 触控按键自定义布局 ----
  // 每个可拖控件的描述：id 用于持久化，ref 指向 TOUCH_LAYOUT/TOUCH_PAUSE/TOUCH_SKIP 里的对象，kind 决定绘制与命中形态。
  const LAYOUT_ITEMS = [
    { id: 'move',  label: '移动',  ref: TOUCH_LAYOUT.moveBase, kind: 'stick' },
    { id: 'aim',   label: '瞄准',  ref: TOUCH_LAYOUT.aimBase,  kind: 'stick' },
    { id: 'fire',  label: '开火',  ref: TOUCH_LAYOUT.fireBtn,  kind: 'circle' },
    { id: 'aimbtn', label: '瞄准键', ref: TOUCH_LAYOUT.aimBtn,  kind: 'circle' },
    { id: 'r',     label: '换弹',  ref: TOUCH_LAYOUT.buttons[0], kind: 'small' },
    { id: 'q',     label: '换枪',  ref: TOUCH_LAYOUT.buttons[1], kind: 'small' },
    { id: 'g',     label: '手雷',  ref: TOUCH_LAYOUT.buttons[2], kind: 'small' },
    { id: '3',     label: '医疗包', ref: TOUCH_LAYOUT.buttons[3], kind: 'small' },
    { id: '4',     label: '护甲板', ref: TOUCH_LAYOUT.buttons[4], kind: 'small' },
    { id: 'e',     label: '交互',  ref: TOUCH_LAYOUT.buttons[5], kind: 'small' },
    { id: 'f',     label: '扔枪',  ref: TOUCH_LAYOUT.buttons[6], kind: 'small' },
    { id: 'pause', label: '暂停',  ref: TOUCH_PAUSE, kind: 'small' },
    { id: 'skip',  label: '跳过',  ref: TOUCH_SKIP,  kind: 'rect' }
  ];
  const LAYOUT_DEFAULTS = LAYOUT_ITEMS.map(it => ({ id: it.id, x: it.ref.x, y: it.ref.y }));
  const LAYOUT_KEY = 'hotline.touchLayout';

  // ---- HUD 元素自定义布局（手机模式下可拖动 HUD 元素位置）----
  // 每个 HUD 元素一个锚点（默认位置）+ 可持久化的偏移 dx/dy。绘制时坐标 += 偏移。
  const HUD_ITEMS = [
    { id: 'wave',    label: '波次',   x: 10,            y: 10 },
    { id: 'cash',    label: '现金',   x: VIEW_W - 10,   y: 10 },
    { id: 'combo',   label: '连击',   x: VIEW_W - 10,   y: 28 },
    { id: 'body',    label: '血/甲',  x: 16,            y: VIEW_H - 40 },
    { id: 'loadout', label: '装备栏', x: VIEW_W - 12,   y: VIEW_H - 10 },
    { id: 'reload',  label: '换弹',   x: VIEW_W / 2,    y: VIEW_H - 26 }
  ];
  const HUD_KEY = 'hotline.hudLayout';
  // 每个 HUD 元素的偏移（运行时读写，persist 时落盘）
  const HUD_OFF = {};
  for (const it of HUD_ITEMS) HUD_OFF[it.id] = { x: 0, y: 0 };

  /** 读取持久化的 HUD 偏移。 */
  function loadHudLayout() {
    try {
      const s = localStorage.getItem(HUD_KEY);
      if (!s) return;
      const saved = JSON.parse(s);
      for (const it of HUD_ITEMS) {
        const sv = saved[it.id];
        if (sv && typeof sv.x === 'number' && typeof sv.y === 'number') {
          HUD_OFF[it.id].x = sv.x; HUD_OFF[it.id].y = sv.y;
        }
      }
    } catch (err) { /* 忽略损坏数据 */ }
  }
  /** 持久化 HUD 偏移。 */
  function saveHudLayout() {
    const out = {};
    for (const it of HUD_ITEMS) out[it.id] = { x: HUD_OFF[it.id].x, y: HUD_OFF[it.id].y };
    try { localStorage.setItem(HUD_KEY, JSON.stringify(out)); } catch (err) { /* 忽略 */ }
  }
  /** 恢复默认 HUD 偏移（清零）。 */
  function resetHudLayout() {
    for (const it of HUD_ITEMS) { HUD_OFF[it.id].x = 0; HUD_OFF[it.id].y = 0; }
    saveHudLayout();
  }


  /** 读取持久化的自定义布局，覆盖 TOUCH_LAYOUT 里的坐标。 */
  function loadTouchLayout() {
    try {
      const s = localStorage.getItem(LAYOUT_KEY);
      if (!s) return;
      const saved = JSON.parse(s);
      for (const it of LAYOUT_ITEMS) {
        const sv = saved[it.id];
        if (sv && typeof sv.x === 'number' && typeof sv.y === 'number') {
          it.ref.x = sv.x; it.ref.y = sv.y;
        }
      }
    } catch (err) { /* 忽略损坏数据 */ }
  }
  /** 把当前 TOUCH_LAYOUT 坐标持久化。 */
  function saveTouchLayout() {
    const out = {};
    for (const it of LAYOUT_ITEMS) out[it.id] = { x: it.ref.x, y: it.ref.y };
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(out)); } catch (err) { /* 忽略 */ }
  }
  /** 恢复默认布局。 */
  function resetTouchLayout() {
    for (const d of LAYOUT_DEFAULTS) {
      const it = LAYOUT_ITEMS.find(i => i.id === d.id);
      if (it) { it.ref.x = d.x; it.ref.y = d.y; }
    }
    saveTouchLayout();
  }

  // ---- 触控按键自定义编辑界面 ----
  // layoutDrag：正在拖拽的控件 id（null=没在拖）。ui 模式下带 'hud:' 前缀。
  let layoutDrag = null;
  // layoutMode：编辑界面当前调节对象 'buttons'（按键）| 'ui'（HUD 元素）
  let layoutMode = 'buttons';
  // 编辑界面按钮区域（屏幕空间）
  const LAYOUT_BTN = {
    toggle: { x: VIEW_W / 2 - 120, y: 74, w: 240, h: 32 },
    reset: { x: VIEW_W / 2 - 160, y: VIEW_H - 44, w: 150, h: 34 },
    done: { x: VIEW_W / 2 + 10, y: VIEW_H - 44, w: 150, h: 34 }
  };

  /** 进入按键自定义编辑界面。 */
  function openTouchLayout() {
    layoutDrag = null;
    layoutMode = 'buttons';
    G.state = 'layout';
  }

  /** 编辑界面：判定点击落在哪个控件/按钮上，处理拖拽开始与按钮点击。 */
  function handleLayoutClick() {
    // 底部按钮优先
    const hit = (b) => mouse.x >= b.x && mouse.x <= b.x + b.w && mouse.y >= b.y && mouse.y <= b.y + b.h;
    if (hit(LAYOUT_BTN.toggle)) {
      // 切换调节对象：按键 <-> UI
      layoutMode = layoutMode === 'buttons' ? 'ui' : 'buttons';
      layoutDrag = null;
      Sfx.play('hit');
      return;
    }
    if (hit(LAYOUT_BTN.reset)) {
      if (layoutMode === 'ui') resetHudLayout(); else resetTouchLayout();
      Sfx.play('hit');
      return;
    }
    if (hit(LAYOUT_BTN.done)) {
      if (layoutMode === 'ui') saveHudLayout(); else saveTouchLayout();
      closeSettings();
      return;
    }
    beginLayoutDrag();
  }

  /** 只做"命中可拖控件并开始拖拽"（不处理底部按钮），供桌面 mousedown 复用。 */
  function beginLayoutDrag() {
    if (layoutMode === 'ui') {
      for (const it of HUD_ITEMS) {
        if (Math.hypot(mouse.x - (it.x + HUD_OFF[it.id].x), mouse.y - (it.y + HUD_OFF[it.id].y)) <= 16) {
          layoutDrag = 'hud:' + it.id;
          return;
        }
      }
    } else {
      for (const it of LAYOUT_ITEMS) {
        const r = it.kind === 'rect' ? Math.max(it.ref.w, it.ref.h) / 2 + 8 : (it.ref.r || TOUCH_LAYOUT.btnR) + 10;
        if (Math.hypot(mouse.x - it.ref.x, mouse.y - it.ref.y) <= r) {
          layoutDrag = it.id;
          return;
        }
      }
    }
  }

  /** 编辑界面：拖拽中持续更新控件坐标（clamp 到屏幕内）。 */
  function handleLayoutMove() {
    if (layoutDrag === null) return;
    const m = 8; // 边距
    if (layoutDrag.startsWith('hud:')) {
      const id = layoutDrag.slice(4);
      const it = HUD_ITEMS.find(i => i.id === id);
      if (!it) return;
      // HUD 偏移 = 当前位置 - 默认锚点
      HUD_OFF[id].x = clamp(mouse.x - it.x, -VIEW_W, VIEW_W);
      HUD_OFF[id].y = clamp(mouse.y - it.y, -VIEW_H, VIEW_H);
    } else {
      const it = LAYOUT_ITEMS.find(i => i.id === layoutDrag);
      if (!it) return;
      it.ref.x = clamp(mouse.x, m, VIEW_W - m);
      it.ref.y = clamp(mouse.y, m, VIEW_H - m);
    }
  }

  /** 编辑界面：结束拖拽。 */
  function handleLayoutUp() { layoutDrag = null; }

  /** UI 调节模式下：用一份演示数据渲染真实 HUD 原样，让用户看清元素本来长什么样。 */
  function drawDemoHUD() {
    // 备份并临时替换 G 里 drawHUD 依赖的字段，渲染完再恢复，不污染真实游戏状态。
    const saved = { player: G.player, wave: G.wave, cash: G.cash, combo: G.combo, comboTimer: G.comboTimer, state: G.state, W: W };
    // 演示玩家：有血有甲、手上拿枪有弹药、背包有消耗品，让血条/装备栏/换弹提示都画得出来。
    G.player = makePlayer(VIEW_W / 2, VIEW_H / 2);
    G.player.weapon = 'w_smg';
    G.player.ammo = 6;            // 低弹药 → 触发"按 R 换弹"提示
    G.player.reserve = 120;
    G.player.armor = 100; G.player.armorSlots = 2;
    G.player.medkits = 1; G.player.armorPlates = 2; G.player.grenades = 3;
    G.player.side = { weapon: 'w_pistol', ammo: 8, reserve: 32 };
    G.wave = 3;
    G.cash = 1750;
    G.combo = 5; G.comboTimer = 1;
    G.state = 'play';             // 让 drawReloadHint 的换弹提示能显示
    if (!W) W = { cleared: false };   // 防止 drawHUD 里 W.cleared 对 null 取值报错
    drawHUD();
    W = saved.W;
    G.state = saved.state;
    G.player = saved.player;
    G.wave = saved.wave; G.cash = saved.cash;
    G.combo = saved.combo; G.comboTimer = saved.comboTimer;
  }

  /** 编辑界面绘制。 */
  function drawLayout() {
    ctx.save();
    ctx.fillStyle = 'rgba(6,6,8,0.92)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';
    ctx.font = 'bold 20px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#f2f2f4';
    ctx.fillText(layoutMode === 'ui' ? '自定义 HUD 位置' : '自定义按键位置', VIEW_W / 2, 40);
    ctx.font = '12px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#9c90a8';
    ctx.fillText('按住元素拖动到想要的位置 · 完成后点「完成」', VIEW_W / 2, 106);

    // 顶部切换按钮
    const hit = (b) => mouse.x >= b.x && mouse.x <= b.x + b.w && mouse.y >= b.y && mouse.y <= b.y + b.h;
    {
      const b = LAYOUT_BTN.toggle;
      const hov = hit(b);
      ctx.fillStyle = hov ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
      ctx.strokeStyle = hov ? '#c8c8d0' : 'rgba(255,255,255,0.25)';
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 6); }
      else { ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); }
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = hov ? '#fff' : '#c8c8d0';
      ctx.font = 'bold 14px "Microsoft YaHei", monospace';
      ctx.fillText('当前：' + (layoutMode === 'ui' ? '调节 UI（点击切换按键）' : '调节按键（点击切换 UI）'), b.x + b.w / 2, b.y + b.h / 2 + 1);
    }

    if (layoutMode === 'ui') {
      // ---- UI 模式：先渲染真实 HUD 原样（用演示数据），再叠加可拖锚点 ----
      drawDemoHUD();
      for (const it of HUD_ITEMS) {
        const cx = it.x + HUD_OFF[it.id].x, cy = it.y + HUD_OFF[it.id].y;
        const dragging = layoutDrag === 'hud:' + it.id;
        ctx.globalAlpha = dragging ? 0.95 : 0.55;
        ctx.fillStyle = dragging ? '#e02929' : '#c8c8d0';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(cx, cy, 14, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#1a1620';
        ctx.font = 'bold 11px "Microsoft YaHei", monospace';
        ctx.fillText(it.label, cx, cy + 1);
      }
    } else {
      // ---- 按键模式：绘制每个可拖控件（高亮正在拖拽的那个）----
      for (const it of LAYOUT_ITEMS) {
        const dragging = layoutDrag === it.id;
        const col = dragging ? '#e02929' : (it.kind === 'stick' ? '#c8c8d0' : '#c8c8d0');
        ctx.globalAlpha = dragging ? 0.95 : 0.55;
        ctx.fillStyle = col;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        if (it.kind === 'rect') {
          const w = it.ref.w, h = it.ref.h;
          if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(it.ref.x - w / 2, it.ref.y - h / 2, w, h, 8); }
          else { ctx.beginPath(); ctx.rect(it.ref.x - w / 2, it.ref.y - h / 2, w, h); }
          ctx.fill(); ctx.stroke();
        } else {
          const r = it.ref.r || TOUCH_LAYOUT.btnR;
          ctx.beginPath(); ctx.arc(it.ref.x, it.ref.y, r, 0, Math.PI * 2);
          ctx.fill(); ctx.stroke();
        }
        // 标签
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#1a1620';
        ctx.font = 'bold 11px "Microsoft YaHei", monospace';
        ctx.fillText(it.label, it.ref.x, it.ref.y + 1);
      }
    }

    // 底部按钮：恢复默认 / 完成
    for (const [key, b] of [['reset', LAYOUT_BTN.reset], ['done', LAYOUT_BTN.done]]) {
      const hov = hit(b);
      ctx.fillStyle = hov ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
      ctx.strokeStyle = hov ? (key === 'done' ? '#c8c8d0' : '#e02929') : 'rgba(255,255,255,0.25)';
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 6); }
      else { ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); }
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = hov ? '#fff' : '#c8c8d0';
      ctx.font = 'bold 15px "Microsoft YaHei", monospace';
      ctx.fillText(key === 'reset' ? '恢复默认' : '完成', b.x + b.w / 2, b.y + b.h / 2 + 1);
    }
    ctx.restore();
  }

  /** 判断一个触控点落在哪个控件：'move' | 'aim' | 'fire' | 'btn:r' | 'btn:q' ... | 'pause' | null */
  function classifyTouch(x, y) {
    const L = TOUCH_LAYOUT;
    const near = (c, r) => Math.hypot(x - c.x, y - c.y) <= r;
    // 左摇杆（仅在未激活时，或按距离就近归因）
    if (near(L.moveBase, L.moveBase.r * 1.4)) return 'move';
    // 独立开火键优先于右摇杆判定（它在右摇杆边缘外）。
    // 摇杆开火模式下开火键已隐藏，此区域不归为 'fire'，交给右摇杆（aimBase）判定。
    if (fireMode !== 'stick' && near(L.fireBtn, L.fireBtn.r * 1.2)) return 'fire';
    // 独立瞄准键（按住抬枪），也在右摇杆边缘外
    if (near(L.aimBtn, L.aimBtn.r * 1.2)) return 'aimbtn';
    if (near(L.aimBase, L.aimBase.r * 1.4)) return 'aim';
    // 动作按钮
    for (const b of L.buttons) {
      // 剧情模式没有换弹（没有备弹），挑战模式没有扔枪：不放按了没反应的键
      if (b.key === 'r' && G.mode === 'story') continue;
      if (b.key === 'f' && G.mode !== 'story') continue;
      if (near(b, L.btnR * 1.2)) return 'btn:' + b.key;
    }
    if (near(TOUCH_PAUSE, TOUCH_PAUSE.r * 1.4)) return 'pause';
    // 跳过按钮（矩形判定，仅整备倒计时期间有效）
    if (G && G.state === 'play' && W && W.cleared && G.intermission > 0) {
      const s = TOUCH_SKIP;
      if (x >= s.x - s.w / 2 && x <= s.x + s.w / 2 && y >= s.y - s.h / 2 && y <= s.y + s.h / 2) return 'skip';
    }
    return null;
  }

  /** 虚拟按钮 → 键盘按键：只触发"本帧按下"（pressed），按钮都是瞬时动作，不需要按住语义。 */
  function onVirtualKey(key) {
    pressed[key] = true;
  }

  /** 每帧把触控摇杆状态折算成 keys / mouse 输入。在 updatePlayer 之前调用。 */
  function applyTouchInput() {
    if (inputMode !== 'touch') return;
    // 左摇杆 → 移动方向
    let ix = 0, iy = 0;
    if (touch.moveActive && touch.moveOrigin) {
      const dx = touch.moveOrigin.x - TOUCH_LAYOUT.moveBase.x;
      const dy = touch.moveOrigin.y - TOUCH_LAYOUT.moveBase.y;
      const len = Math.hypot(dx, dy);
      if (len > 6) {
        const cl = Math.min(len, TOUCH_LAYOUT.moveBase.r);
        const nx = dx / len, ny = dy / len;
        touch.moveX = nx * cl; touch.moveY = ny * cl;
        // 死区：超过阈值才给移动
        if (cl > 10) { ix = nx; iy = ny; }
      }
    }
    keys['a'] = ix < -0.3; keys['d'] = ix > 0.3;
    keys['w'] = iy < -0.3; keys['s'] = iy > 0.3;

    // 右摇杆 → 瞄准方向（喂给 mouse，驱动准心/朝向/相机前探）
    if (touch.aimActive && touch.aimOrigin) {
      const dx = touch.aimOrigin.x - TOUCH_LAYOUT.aimBase.x;
      const dy = touch.aimOrigin.y - TOUCH_LAYOUT.aimBase.y;
      const len = Math.hypot(dx, dy);
      if (len > 6) {
        const nx = dx / len, ny = dy / len;
        touch.aimX = nx; touch.aimY = ny;
        // 把方向换算成屏幕边缘的准心位置：准心 = 屏幕中心 + 方向 × 半径
        const R = Math.min(VIEW_W, VIEW_H) * 0.42;
        feedTouchMouse(VIEW_W / 2 + nx * R, VIEW_H / 2 + ny * R);
      } else {
        // 摇杆回中 → 准心回屏幕中心（保持原朝向，靠 aimDir 的 len<1 判定）；方向也清零，自瞄不吸附
        touch.aimX = 0; touch.aimY = 0;
        feedTouchMouse(VIEW_W / 2, VIEW_H / 2);
      }
    }
    // 开火方式二选一：
    //   fireMode='button'：只由独立「开火」按钮触发，右摇杆仅瞄准（此时开火按钮显示）。
    //   fireMode='stick' ：右摇杆拖到边缘（约 80% 半径）持续射击（此时开火按钮隐藏）。
    let fireByAim = false;
    if (fireMode === 'stick' && touch.aimActive && touch.aimOrigin) {
      const dx = touch.aimOrigin.x - TOUCH_LAYOUT.aimBase.x;
      const dy = touch.aimOrigin.y - TOUCH_LAYOUT.aimBase.y;
      // 拖到边缘（80% 半径）才持续射击，回中即停
      fireByAim = Math.hypot(dx, dy) > TOUCH_LAYOUT.aimBase.r * 0.80;
    }
    // 摇杆开火模式下，独立开火按钮应被隐藏/忽略（fireMode==='stick' 时不认 fireBtnActive/firing）
    const nextDown = fireMode === 'stick'
      ? fireByAim
      : (touch.fireBtnActive || touch.firing);
    // 上升沿 → 记一次"单击"：半自动武器（手枪/霰弹枪/狙击）需要 fireTap 才开枪，
    // 而按住 mouse.down 只能驱动自动武器连发。触控没有 mousedown 事件，这里手动补上单击语义。
    if (nextDown && !touch.firePrev) G.fireTap = true;
    touch.firePrev = nextDown;
    mouse.down = nextDown;
    // 触屏右键 = 按住「瞄准键」抬枪 ADS；否则不瞄准（辅助瞄准 applyTouchAim 会吸附准心）
    mouse.right = touch.aimBtnActive;
  }

  /** 触屏下的辅助瞄准：只在玩家摇杆指向的扇形内找敌人，轻微修正，绝不反向吸附。 */
  function applyTouchAim() {
    if (inputMode !== 'touch' || !G || !G.player || !W) return;
    if (!touch.aimActive) return;

    // 玩家摇杆当前指向（单位向量）。这是"玩家想要的方向"，吸附必须围绕它、不能违背它。
    const wantX = touch.aimX, wantY = touch.aimY;
    const wantLen = Math.hypot(wantX, wantY);
    if (wantLen < 0.1) return;   // 摇杆基本回中：不吸附，保持中心

    const ox = G.player.x, oy = G.player.y;
    // 在摇杆方向 ±AIM_SNAP_ANGLE 的锥形内，找夹角最小（最靠近准心）的敌人
    let best = null, bestAngle = AIM_SNAP_ANGLE + 0.01;
    for (const e of W.enemies) {
      if (!e.alive) continue;
      const dx = e.x - ox, dy = e.y - oy;
      const d = Math.hypot(dx, dy);
      if (d < 1 || d > AIM_SNAP_RANGE) continue;   // 太近/太远不吸附
      const nx = dx / d, ny = dy / d;
      // 敌人方向与摇杆方向的夹角（点积越小夹角越大）
      const dot = nx * wantX + ny * wantY;
      if (dot <= 0) continue;   // 在背后/侧面 90° 外：完全不吸，避免"往左摇却往右吸"
      const ang = Math.acos(Math.min(1, dot));
      if (ang < bestAngle) { bestAngle = ang; best = e; }
    }
    if (!best) return;

    // 轻微修正：把摇杆方向向敌人方向拉一点点（AIM_SNAP_STRENGTH），保留玩家主导权
    const dx = best.x - ox, dy = best.y - oy;
    const d = Math.hypot(dx, dy) || 1;
    const ex = dx / d, ey = dy / d;
    const mix = AIM_SNAP_STRENGTH;   // 敌人方向占比（0..1，越大吸越狠）
    let mx = wantX * (1 - mix) + ex * mix;
    let my = wantY * (1 - mix) + ey * mix;
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml; my /= ml;
    const R = Math.min(VIEW_W, VIEW_H) * 0.42;
    feedTouchMouse(VIEW_W / 2 + mx * R, VIEW_H / 2 + my * R);
  }

  /** 切换操作方式，并持久化到 localStorage。 */
  function setInputMode(mode) {
    inputMode = mode;
    try { localStorage.setItem('hotline.inputMode', mode); } catch (err) { /* 隐私模式下忽略 */ }
    fitCanvas();
    // 切换到手机触控：请求横屏（全屏 + 方向锁），铺满手机宽度
    if (mode === 'touch') {
      requestLandscape();
      // 清掉电脑键鼠残留
      keys['a'] = keys['d'] = keys['w'] = keys['s'] = false;
      mouse.down = false; mouse.right = false;
    } else {
      // 切换到电脑键鼠时，清掉触控残留状态，避免卡住
      touch.moveActive = false; touch.moveId = -1; touch.moveX = 0; touch.moveY = 0;
      touch.aimActive = false; touch.aimId = -1; touch.aimX = 0; touch.aimY = 0;
      touch.firing = false; touch.fireBtnActive = false; touch.fireId = -1;
      touch.aimBtnActive = false; touch.aimBtnId = -1;
      keys['a'] = keys['d'] = keys['w'] = keys['s'] = false;
    }
  }

  /** 切换开火方式：'button'（按键开火）| 'stick'（摇杆开火），持久化。 */
  function setFireMode(mode) {
    fireMode = (mode === 'stick') ? 'stick' : 'button';
    try { localStorage.setItem('hotline.fireMode', fireMode); } catch (err) { /* 忽略 */ }
    // 切换后清掉开火上升沿，避免残留单击
    touch.firePrev = false;
  }

  /** 手机触控模式：请求全屏 + 屏幕方向锁（横屏）。失败时静默降级。 */
  function requestLandscape() {
    try {
      const el = document.documentElement;
      const p = el.requestFullscreen && el.requestFullscreen();
      if (p && p.catch) p.catch(() => {});
    } catch (err) { /* 忽略 */ }
    try {
      if (screen.orientation && screen.orientation.lock) {
        const p = screen.orientation.lock('landscape');
        if (p && p.catch) p.catch(() => {});
      }
    } catch (err) { /* 忽略 */ }
  }

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (!keys[k]) pressed[k] = true;
    keys[k] = true;
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    if (k === 'f11') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
  window.addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
    mouse.down = false;
    mouse.right = false;      // 切走窗口时别让"瞄准"卡在按下状态
  });

  function updateMouse(e) {
    const r = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) / r.width * VIEW_W;
    mouse.y = (e.clientY - r.top) / r.height * VIEW_H;
  }
  canvas.addEventListener('mousemove', (e) => {
    updateMouse(e);
    // 桌面端：按键自定义编辑界面拖拽中
    if (G && G.state === 'layout' && layoutDrag !== null) handleLayoutMove();
  });
  canvas.addEventListener('mousedown', (e) => {
    updateMouse(e);
    // 桌面端：编辑界面左键开始拖拽控件/元素（底部按钮与切换按钮走 click → handleLayoutClick）
    if (G && G.state === 'layout' && e.button === 0) {
      beginLayoutDrag();
      return;
    }
    if (e.button === 0) mouse.down = true;
    if (e.button === 2) { mouse.right = true; e.preventDefault(); }   // 右键 = 抬枪瞄准
    // 菜单按钮统一走 click 事件（桌面鼠标与移动 tap 都可靠触发），这里不再调 onPointerDown。
  });
  window.addEventListener('mouseup', (e) => {
    if (G && G.state === 'layout') handleLayoutUp();
    if (e.button === 0) mouse.down = false;
    if (e.button === 2) mouse.right = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // 菜单按钮（标题/设置/暂停/结算）统一用 click 处理：桌面鼠标点击、移动端 tap 都可靠触发，
  // 避免 pointer/touch 事件的兼容性坑。战斗态下的 click 落到 onPointerDown 里什么都不做。
  canvas.addEventListener('click', (e) => {
    if (e.button !== 0) return;
    const r = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) / r.width * VIEW_W;
    mouse.y = (e.clientY - r.top) / r.height * VIEW_H;
    onPointerDown({ button: 0 });
  });

  // ---- 触控输入：用 Pointer Events 统一处理（移动端最兼容的标准方案）。
  // 只处理 pointerType !== 'mouse'（触摸/笔），桌面鼠标仍走上面的 mousedown/mousemove。
  function pointerPos(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width * VIEW_W,
      y: (e.clientY - r.top) / r.height * VIEW_H
    };
  }
  // 把触控坐标（逻辑坐标）换算成鼠标屏幕坐标，直接喂给 mouse，复用准心/朝向逻辑
  function feedTouchMouse(x, y) {
    mouse.x = x; mouse.y = y;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;   // 桌面鼠标走 mousedown，这里只处理触摸/笔
    // 按键自定义编辑界面：pointerdown 只负责「开始拖拽」，按钮（切换/恢复/完成）统一走 click 事件，
    // 这样单击就能触发切换，不依赖长按。这里不能 preventDefault，否则会吞掉 click 导致按钮失灵。
    if (G && G.state === 'layout') {
      const pt = pointerPos(e);
      mouse.x = pt.x; mouse.y = pt.y;
      beginLayoutDrag();
      return;
    }
    // 菜单按钮统一走 click 事件（见上），这里只处理战斗态摇杆/按钮。
    // 注意：菜单态下不能 preventDefault，否则会阻止后续的 click 事件，导致按钮点不了。
    if (!G || G.state !== 'play') return;
    if (inputMode !== 'touch') return;
    e.preventDefault();
    Sfx.init();
    const pt = pointerPos(e);
    const ctl = classifyTouch(pt.x, pt.y);   // 见下：命中摇杆/按钮区域
    if (ctl === 'move') {
      if (touch.moveActive) return;
      touch.moveActive = true; touch.moveId = e.pointerId;
      touch.moveOrigin = pt; touch.moveX = 0; touch.moveY = 0;
    } else if (ctl === 'aim') {
      if (touch.aimActive) return;
      touch.aimActive = true; touch.aimId = e.pointerId;
      touch.aimOrigin = pt; touch.aimX = 0; touch.aimY = 0;
    } else if (ctl === 'fire') {
      if (touch.fireBtnActive) return;
      touch.fireBtnActive = true; touch.fireId = e.pointerId;
      touch.firing = true;
    } else if (ctl === 'aimbtn') {
      if (touch.aimBtnActive) return;
      touch.aimBtnActive = true; touch.aimBtnId = e.pointerId;
    } else if (ctl === 'pause') {
      // 暂停按钮：切换暂停（和 ESC 同效果）
      onVirtualKey('escape');
    } else if (ctl === 'skip') {
      skipIntermission();
    } else if (ctl && ctl.startsWith('btn:')) {
      const key = ctl.slice(4);
      touchPressed[key] = true;
      onVirtualKey(key);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') return;
    // 按键自定义编辑界面：拖拽中持续更新坐标
    if (G && G.state === 'layout' && layoutDrag !== null) {
      e.preventDefault();
      const pt = pointerPos(e);
      mouse.x = pt.x; mouse.y = pt.y;
      handleLayoutMove();
      return;
    }
    e.preventDefault();
    if (inputMode !== 'touch') return;
    const pt = pointerPos(e);
    if (e.pointerId === touch.moveId) {
      touch.moveOrigin = pt;
    } else if (e.pointerId === touch.aimId) {
      touch.aimOrigin = pt;
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse') return;
    // 按键自定义编辑界面：结束拖拽
    if (G && G.state === 'layout') {
      handleLayoutUp();
      return;
    }
    e.preventDefault();
    if (inputMode !== 'touch') return;
    if (e.pointerId === touch.moveId) {
      touch.moveActive = false; touch.moveId = -1; touch.moveX = 0; touch.moveY = 0;
    } else if (e.pointerId === touch.aimId) {
      touch.aimActive = false; touch.aimId = -1; touch.aimX = 0; touch.aimY = 0;
      touch.firing = false;
    } else if (e.pointerId === touch.fireId) {
      touch.fireBtnActive = false; touch.fireId = -1; touch.firing = false;
    } else if (e.pointerId === touch.aimBtnId) {
      touch.aimBtnActive = false; touch.aimBtnId = -1;
    }
    // 释放所有虚拟按钮按下态（简单起见，结束时全清）
    touchPressed = Object.create(null);
  });

  canvas.addEventListener('pointercancel', (e) => {
    if (e.pointerType === 'mouse') return;
    touch.moveActive = false; touch.moveId = -1; touch.moveX = 0; touch.moveY = 0;
    touch.aimActive = false; touch.aimId = -1; touch.aimX = 0; touch.aimY = 0;
    touch.firing = false; touch.fireBtnActive = false; touch.fireId = -1;
    touch.aimBtnActive = false; touch.aimBtnId = -1;
    touchPressed = Object.create(null);
  });

  // ---------------------------------------------------------------- 音效
  // 换弹声用真实录音（`js/sfx_samples.js` 里内嵌的 base64 MP3，用户提供），其余仍是程序合成。
  // 每个采样单独描述"跳过开头多少静音 / 放多长 / 放大多少"，这些数都是按录音实测出来的
  // （tools/make_sfx.py 会打印时长和静音段），换录音要重新对一遍。
  const SAMPLES = {
    // 手枪枪声：**目前停用**（用户 2026-11-08 决定"先不用枪声，先存着"）。
    // 采样本体还在 sfx_samples.js / tools/sfx_src/pistol.mp3 里，参数也照旧留着；
    // 想启用就把 disabled 删掉（或改成 false），play('shoot') 会自动切回采样。
    // 参数来历：1.70s，前 0.30s 纯静音，峰值在 0.47s（原始峰值 0.294，录音偏小），尾巴到 1.28s。
    // 0.15s 的射速下最多叠 4 个声部，再往上就糊成一团。
    pistol: { trim: 0.30, len: 0.50, gain: 1.20, maxVoices: 4, disabled: true },
    // 换弹：1.23s，前 0.19s 静音，0.19~0.55 是一串拔弹匣/摸弹匣的机械小响，
    // 0.71s 弹匣拍到位（最响，样本峰值 0.663），尾巴到 1.0s。整段放完正好盖住手枪 0.9s 的换弹时间。
    // steal：换弹声必须响（玩家按了 R 没声音会以为卡了），声部占满就抢掉最早那个，而不是哑火。
    // gain 只给 0.38：这段录音峰值 0.663（比枪声的 0.294 响一倍多），不压的话换弹比开枪还吵。
    reload: { trim: 0.18, len: 0.85, gain: 0.38, maxVoices: 2, steal: true }
  };
  const Sfx = {
    ac: null,
    noiseBuf: null,
    muted: false,
    samples: null,     // 名字 -> AudioBuffer
    sampleState: 0,    // 0 未开始 / 1 解码中 / 2 就绪 / 3 失败（失败就一直用合成音）
    voices: {},        // 名字 -> 各声部的结束时刻
    init() {
      if (this.ac) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ac = new AC();
        const len = Math.floor(this.ac.sampleRate * 0.5);
        const buf = this.ac.createBuffer(1, len, this.ac.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noiseBuf = buf;
        this.loadSamples();
      } catch (err) {
        this.ac = null;
      }
    },
    // 解码内嵌采样。Context 处于 suspended 也能解码，所以页面一加载就准备好，
    // 第一枪/第一次换弹就是真录音，不会先听到合成的再切过去。
    loadSamples() {
      if (this.sampleState || !this.ac) return;
      const all = window.SFX_SAMPLES;
      if (!all) { this.sampleState = 3; return; }
      const self = this;
      const names = Object.keys(all).filter(function (n) { return !!SAMPLES[n]; });
      if (!names.length) { this.sampleState = 3; return; }
      this.sampleState = 1;
      const out = {};
      let left = names.length;
      const finishAll = function () {
        self.samples = out;
        self.sampleState = Object.keys(out).length ? 2 : 3;
      };
      names.forEach(function (n) {
        let settled = false;
        const finish = function (buf, ok) {
          if (settled) return;               // 回调和 Promise 会各来一次，只认第一个
          settled = true;
          if (ok && buf) out[n] = buf;
          if (--left === 0) finishAll();
        };
        try {
          const bin = atob(all[n]);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const p = self.ac.decodeAudioData(bytes.buffer,
            function (buf) { finish(buf, true); },
            function () { finish(null, false); });
          if (p && typeof p.catch === 'function') p.catch(function () { finish(null, false); });
        } catch (err) { finish(null, false); }
      });
    },
    /** 有没有这个采样的声部在响 / 采样是否可用（测试与降级判断用） */
    sampleReady(name) { return !!(this.samples && this.samples[name]); },
    /**
     * 播一个采样：跳过开头静音、末尾淡出、限制同时声部数。
     * 返回 true 表示"这一声真的用采样放了"，调用方据此决定要不要补合成音兜底。
     * 声部占用按"结束时刻"记账而不是 onended 回调：万一音频上下文被浏览器挂起，
     * currentTime 不前进，计数也就不会漏放；靠 onended 则会永远卡在上限导致哑火。
     */
    sample(name, gain, rate) {
      const cfg = SAMPLES[name];
      const ac = this.ac;
      if (!ac || !cfg || cfg.disabled || !this.sampleReady(name)) return false;
      const t = ac.currentTime;
      const ends = this.voices[name] || (this.voices[name] = []);
      while (ends.length && ends[0] <= t) ends.shift();
      if (ends.length >= cfg.maxVoices) {
        // 枪声连打时宁可少一声（不糊），换弹声则宁可抢掉最早那个声部（不能哑火）
        if (!cfg.steal) return false;
        ends.shift();
      }
      const src = ac.createBufferSource();
      src.buffer = this.samples[name];
      src.playbackRate.value = rate || 1;
      const g = ac.createGain();
      const peak = gain * cfg.gain;
      // 只做"掐头去尾"：6ms 起手保护 → 中间整段保持原样 → 最后 0.10s 线性淡出。
      // 中间千万别用指数衰减——录音最响的那一下往往在片段靠后（换弹声里"弹匣拍进去"
      // 在 0.72s 处），一衰减就把最该有劲的那一拍压没了。
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
      g.gain.setValueAtTime(peak, t + Math.max(0.02, cfg.len - 0.10));
      g.gain.linearRampToValueAtTime(0.0001, t + cfg.len);
      src.connect(g).connect(ac.destination);
      src.start(t, cfg.trim, cfg.len / src.playbackRate.value + 0.02);
      ends.push(t + cfg.len);
      return true;
    },
    noise(dur, freq, q, gain, decay, type) {
      const ac = this.ac; if (!ac) return;
      const src = ac.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const bp = ac.createBiquadFilter();
      bp.type = type || 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = q;
      const g = ac.createGain();
      const t = ac.currentTime;
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      bp.frequency.exponentialRampToValueAtTime(Math.max(120, freq * 0.35), t + dur * 0.9);
      src.connect(bp).connect(g).connect(ac.destination);
      src.start(t);
      src.stop(t + dur + 0.02);
      void decay;
    },
    tone(f0, f1, dur, gain, type) {
      const ac = this.ac; if (!ac) return;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type || 'square';
      const t = ac.currentTime;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ac.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    },
    play(name) {
      if (this.muted) return false;
      this.init();
      if (!this.ac) return false;
      if (this.ac.state === 'suspended') this.ac.resume();
      switch (name) {
        case 'shoot':
          // 现在是纯合成枪声（采样停用，见 SAMPLES.pistol.disabled）。
          // 采样一旦启用就走上面那条：真录音 + 极短合成爆点补起手。
          if (this.sample('pistol', 0.9, 0.96 + Math.random() * 0.08)) {
            this.noise(0.035, 3400, 0.9, 0.18, 0.05);
            this.tone(190, 62, 0.05, 0.08, 'square');
            return true;
          }
          this.noise(0.10, 2200, 1.2, 0.32, 0.2);
          this.tone(320, 90, 0.07, 0.10, 'square');
          return false;
        // 换弹：整段录音（拔弹匣 → 拍上新弹匣）一次性放完，比拆成两声合成的更像真的。
        // 返回 false 表示采样不可用，调用方用 'magout'/'magin' 两声兜底。
        case 'reload': return this.sample('reload', 1.0, 1.0);
        case 'smg': this.noise(0.07, 1800, 1.0, 0.26, 0.15); this.tone(280, 80, 0.05, 0.08, 'square'); break;
        case 'shotgun': this.noise(0.30, 1200, 0.8, 0.45, 0.3); this.tone(160, 45, 0.18, 0.16, 'sawtooth'); break;
        case 'swing': this.noise(0.14, 900, 2.5, 0.14, 0.15, 'bandpass'); break;
        case 'hit': this.noise(0.12, 420, 1.0, 0.28, 0.2); this.tone(120, 50, 0.10, 0.14, 'square'); break;
        // 击中敌人护甲：金属"铛"一声，和打肉体的闷响区分开
        case 'armorhit': this.noise(0.08, 2400, 2.0, 0.22, 0.1); this.tone(680, 420, 0.06, 0.10, 'triangle'); break;
        // 击碎敌人护甲：清脆的碎裂"噼啪"
        case 'armorbreak': this.noise(0.28, 1800, 1.4, 0.32, 0.22); this.tone(920, 240, 0.16, 0.12, 'square'); this.tone(420, 180, 0.10, 0.08, 'sawtooth'); break;
        case 'die': this.noise(0.34, 520, 0.9, 0.30, 0.3); this.tone(150, 40, 0.28, 0.12, 'sawtooth'); break;
        case 'empty': this.tone(900, 700, 0.04, 0.07, 'square'); break;
        // 换弹：拔弹匣是干涩的"哐"，拍上弹匣是闷一点的"咔"
        case 'magout': this.noise(0.06, 760, 2.2, 0.10, 0.05); this.tone(300, 190, 0.05, 0.05, 'square'); break;
        case 'magin': this.noise(0.09, 520, 1.6, 0.15, 0.07); this.tone(210, 120, 0.06, 0.09, 'square'); break;
        // 散弹枪逐发塞弹：清脆一点，跟弹匣的"哐"区分开
        case 'shellin': this.noise(0.04, 900, 2.4, 0.08, 0.05); this.tone(340, 260, 0.04, 0.05, 'square'); break;
        // 散弹枪开火退壳：弹壳落地，短促的金属"叮"声
        case 'shellout': this.noise(0.05, 1200, 2.6, 0.06, 0.04); this.tone(620, 480, 0.03, 0.04, 'triangle'); break;
        case 'pickup': this.tone(660, 990, 0.07, 0.10, 'triangle'); break;
        case 'throw': this.noise(0.18, 1400, 2.0, 0.12, 0.2); break;
        case 'door': this.noise(0.22, 380, 3.0, 0.18, 0.2); this.tone(220, 180, 0.16, 0.06, 'triangle'); break;
        case 'clear': this.tone(523, 784, 0.30, 0.12, 'triangle'); this.tone(659, 988, 0.44, 0.09, 'triangle'); break;
        case 'step': this.noise(0.05, 260, 1.5, 0.05, 0.05); break;
        // 爆炸：一团低频轰响 + 一点烧裂声，比枪声长得多才有分量
        case 'boom': this.noise(0.58, 320, 0.7, 0.55, 0.5); this.tone(88, 26, 0.46, 0.30, 'sawtooth'); break;
        default: break;
      }
    }
  };

  // 先建好 AudioContext 并把枪声采样解码出来（此时处于 suspended 也不影响解码），
  // 这样玩家按下"开始游戏"后的第一枪就是真枪声。
  Sfx.init();

  // ---------------------------------------------------------------- 几何工具
  function rayRect(ox, oy, dx, dy, rc) {
    let tmin = 0, tmax = Infinity;
    if (Math.abs(dx) < 1e-9) {
      if (ox < rc.x || ox > rc.x + rc.w) return null;
    } else {
      let t1 = (rc.x - ox) / dx, t2 = (rc.x + rc.w - ox) / dx;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
    if (Math.abs(dy) < 1e-9) {
      if (oy < rc.y || oy > rc.y + rc.h) return null;
    } else {
      let t1 = (rc.y - oy) / dy, t2 = (rc.y + rc.h - oy) / dy;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
    return tmin;
  }

  function rayCircle(ox, oy, dx, dy, cx, cy, r) {
    const ex = ox - cx, ey = oy - cy;
    const b = ex * dx + ey * dy;
    const c = ex * ex + ey * ey - r * r;
    const disc = b * b - c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    const t = -b - sq;
    if (t >= 0) return t;
    const t2 = -b + sq;
    return t2 >= 0 ? 0 : null;
  }

  function angDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

  // ---------------------------------------------------------------- 世界
  let W = null;          // 当前关卡运行时
  let G = null;          // 全局游戏状态

  function buildLevel(index, data) {
    const src = data || ARENA;
    const rows = src.rows;
    const h = rows.length, w = rows[0].length;

    const world = {
      index: index || 0, title: src.title, rows, w, h,
      pxW: w * TILE, pxH: h * TILE,
      walls: [],        // 合并后的墙矩形
      covers: [],       // 掩体（木箱），碰撞上算墙，渲染单独一层
      barrels: [],      // 油桶：同样算墙，但能被子弹打爆
      doors: [],
      pickups: [],
      thrown: [],       // 飞行中的投掷武器（剧情模式把枪扔出去砸人）
      enemies: [],
      spawnPoints: [],  // 刷怪点（M 字符）
      supplies: [],     // 补给点（S 字符）
      supply: null,     // 默认补给点
      stations: [],     // 武器升级站（U 字符）
      spawn: { x: TILE * 1.5, y: TILE * 1.5 },
      exit: null,
      cleared: false,
      decals: document.createElement('canvas'),
      bloodCount: 0,
      bloodPending: [],  // 排队等着"落地"的血泊/血痕（血是喷出来的，不是瞬间贴上去的）
      _solidDirty: true,
      _solid: null
    };
    world.decals.width = world.pxW;
    world.decals.height = world.pxH;

    // 墙：按行合并连续格子
    for (let y = 0; y < h; y++) {
      let start = -1;
      for (let x = 0; x <= w; x++) {
        const isWall = x < w && rows[y][x] === '#';
        if (isWall && start < 0) start = x;
        if (!isWall && start >= 0) {
          world.walls.push({ x: start * TILE, y: y * TILE, w: (x - start) * TILE, h: TILE });
          start = -1;
        }
      }
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = rows[y][x];
        const cx = x * TILE + TILE / 2, cy = y * TILE + TILE / 2;
        if (ch === 'P') { world.spawn.x = cx; world.spawn.y = cy; }
        else if (ch === 'D') world.doors.push({ x: cx, y: cy, open: false, t: 0 });
        else if (ch === 'o') {
          // 掩体：挡人、挡子弹、挡视线，但是木箱不是墙，渲染另画
          const rc = { x: x * TILE, y: y * TILE, w: TILE, h: TILE };
          world.covers.push(rc);
          world.walls.push(rc);
        }
        else if (ch === BARREL_CHAR) {
          // 油桶：占满一格，碰撞上和掩体一样挡人挡子弹，
          // 矩形上挂 barrel 引用，子弹打中时 castShot 能认出打的是桶而不是墙
          const rc = { x: x * TILE, y: y * TILE, w: TILE, h: TILE };
          const barrel = { x: cx, y: cy, hp: BARREL_HP, alive: true, fuse: 0, rect: rc, shake: 0 };
          rc.barrel = barrel;
          world.barrels.push(barrel);
          world.walls.push(rc);
        }
        else if (ch === SPAWN_CHAR) world.spawnPoints.push({ x: cx, y: cy });
        else if (ch === SUPPLY_CHAR) world.supplies.push({ x: cx, y: cy });
        else if (ch === UPGRADE_CHAR) world.stations.push({ x: cx, y: cy });
        else if (ch === '1') world.pickups.push(makePickup('pistol', cx, cy));
        else if (ch === '2') world.pickups.push(makePickup('shotgun', cx, cy));
        else if (ch === 'B') world.pickups.push(makePickup('bat', cx, cy));
        else if (ch === 'K') world.pickups.push(makePickup('knife', cx, cy));
        else if (ch === 'E') world.exit = { x: cx, y: cy };
      }
    }
    // 默认补给点：取第一个 S，没有则用出生点附近
    if (!world.supply) world.supply = world.supplies[0] || { x: world.spawn.x, y: world.spawn.y + 48 };
    buildNav(world);
    return world;
  }

  function makeEnemy(kind, x, y) {
    const K = ENEMY_KIND[kind];
    return {
      kind, x, y, hx: x, hy: y,
      vx: 0, vy: 0,
      alive: true,
      hp: K.hp, maxHp: K.hp,
      facing: Math.PI,
      speed: K.speed,
      state: 'idle',
      seeTimer: 0,
      lostTimer: 0,
      lastSeen: { x, y },
      target: { x, y },
      thinkTimer: Math.random() * 1.5,
      investigateTimer: 0,
      path: null, pathI: 0, pathTimer: 0,
      attackCd: Math.random() * 0.4,
      // 开枪前摇：wind 攒到 K.windup 才真正开火；aimX/aimY 是"举枪时瞄着的点"，
      // 只以有限速度追玩家 —— 玩家横移能把它甩开，子弹就打在身后。
      wind: 0,
      aimX: x, aimY: y,
      stun: 0,
      weapon: K.weapon,
      ammo: WEAPONS[K.weapon].mag,
      bob: Math.random() * 6.28,
      deadT: 0,
      deathDir: 0,
      // 断肢标记：gibbed = 头被打飞（尸体连头都不画），dismember = 胳膊被砍飞
      gibbed: false,
      dismember: false,
      // 侧移包抄：方向保持一段时间再翻，避免原地左右抖
      strafeDir: Math.random() < 0.5 ? -1 : 1,
      strafeTimer: 0.7 + Math.random() * 1.3
    };
  }

  function makePickup(w, x, y) {
    return {
      def: w, x, y, bob: Math.random() * 6.28,
      vx: 0, vy: 0, rot: Math.random() * 6.28
    };
  }

  /** 换枪时旧枪掉哪儿：身后一点，别跟地上刚捡的那把叠在一起（叠住就只能靠 E 猜）。 */
  function dropSpot(p) {
    for (const s of [15, 24, 0]) {
      const x = p.x - p.facing.x * s, y = p.y - p.facing.y * s;
      if (!W || !pointSolid(W, x, y, 7)) return { x, y };
    }
    return { x: p.x, y: p.y };
  }

  // ---------------------------------------------------------------- 碰撞
  function solidRects(world, includeDoors) {
    if (!includeDoors) return world.walls;
    // 门开关会改变可通行性，缓存一下，避免每帧给每个角色重新分配
    if (!world._solidDirty) return world._solid;
    const out = world.walls.slice();
    for (const d of world.doors) {
      if (!d.open) out.push({ x: d.x - TILE / 2, y: d.y - TILE / 2, w: TILE, h: TILE, door: d });
    }
    world._solid = out;
    world._solidDirty = false;
    return out;
  }

  function resolveCircle(world, p, r, rects) {
    for (let i = 0; i < rects.length; i++) {
      const rc = rects[i];
      const cx = clamp(p.x, rc.x, rc.x + rc.w);
      const cy = clamp(p.y, rc.y, rc.y + rc.h);
      let dx = p.x - cx, dy = p.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r) {
        let d = Math.sqrt(d2);
        if (d < 0.001) {
          // 圆心正好在矩形内部：沿最近的边推出去
          const left = p.x - rc.x, right = rc.x + rc.w - p.x;
          const top = p.y - rc.y, bottom = rc.y + rc.h - p.y;
          const m = Math.min(left, right, top, bottom);
          if (m === left) p.x = rc.x - r;
          else if (m === right) p.x = rc.x + rc.w + r;
          else if (m === top) p.y = rc.y - r;
          else p.y = rc.y + rc.h + r;
        } else {
          const push = r - d;
          p.x += dx / d * push;
          p.y += dy / d * push;
        }
      }
    }
  }

  function pointSolid(world, x, y, pad) {
    pad = pad || 0;
    for (const rc of world.walls) {
      if (x > rc.x - pad && x < rc.x + rc.w + pad && y > rc.y - pad && y < rc.y + rc.h + pad) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- 寻路
  //
  // TILE 网格上的 A*。地图只有 25×15 = 375 格，open 表用线性扫描选最小 f
  // 已经足够快（一次展开最多几十个节点），不必上二叉堆。
  // 门算"可通行但贵一点"，敌人真走近了会把门推开。
  const NAV_DIRS = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1]
  ];

  function buildNav(world) {
    const n = world.w * world.h;
    const blocked = new Uint8Array(n);
    const cost = new Uint8Array(n);
    for (let y = 0; y < world.h; y++) {
      for (let x = 0; x < world.w; x++) {
        const ch = world.rows[y][x];
        const i = y * world.w + x;
        blocked[i] = (ch === '#' || ch === 'o' || ch === BARREL_CHAR) ? 1 : 0;
        cost[i] = ch === 'D' ? 7 : 1;
      }
    }
    world.nav = { blocked, cost };
  }

  /** 目标格被占时，找离它最近的一格可走地（免得敌人对着墙里的点发呆）。 */
  function nearestOpen(world, ti, from) {
    const w = world.w, h = world.h, n = w * h;
    const blocked = world.nav.blocked;
    const tx = ti % w, ty = (ti / w) | 0;
    let best = -1, bd = Infinity;
    for (let r = 1; r <= 4 && best < 0; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = tx + dx, y = ty + dy;
          if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
          const i = y * w + x;
          if (blocked[i]) continue;
          const d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = i; }
        }
      }
    }
    void from; void n;
    return best;
  }

  /** A*：返回世界坐标路径点数组（不含起点），走不通返回 null。 */
  function findPath(world, sx, sy, tx, ty) {
    const nav = world.nav;
    if (!nav) return null;
    const w = world.w, h = world.h, n = w * h;
    const blocked = nav.blocked, cost = nav.cost;
    const si = clamp(Math.floor(sy / TILE), 0, h - 1) * w + clamp(Math.floor(sx / TILE), 0, w - 1);
    let ti = clamp(Math.floor(ty / TILE), 0, h - 1) * w + clamp(Math.floor(tx / TILE), 0, w - 1);
    if (blocked[si]) return null;
    if (blocked[ti]) {
      ti = nearestOpen(world, ti, si);
      if (ti < 0) return null;
    }
    if (si === ti) return [{ x: tx, y: ty }];

    const g = new Float32Array(n);
    for (let i = 0; i < n; i++) g[i] = Infinity;
    const f = new Float32Array(n);
    const came = new Int32Array(n);
    for (let i = 0; i < n; i++) came[i] = -1;
    const closed = new Uint8Array(n);
    const tX = ti % w, tY = (ti / w) | 0;
    const heur = (i) => {
      const dx = Math.abs(i % w - tX), dy = Math.abs(((i / w) | 0) - tY);
      return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
    };

    const open = [si];
    g[si] = 0;
    f[si] = heur(si);
    let guard = 0;

    while (open.length && guard++ < n * 4) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const cur = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (cur === ti) {
        const pts = [];
        let c = cur;
        while (c !== -1 && c !== si) {
          pts.push({ x: (c % w) * TILE + TILE / 2, y: ((c / w) | 0) * TILE + TILE / 2 });
          c = came[c];
        }
        pts.reverse();
        if (!blocked[ti]) pts.push({ x: tx, y: ty });
        return pts;
      }
      closed[cur] = 1;
      const cx = cur % w, cy = (cur / w) | 0;
      for (let k = 0; k < NAV_DIRS.length; k++) {
        const dx = NAV_DIRS[k][0], dy = NAV_DIRS[k][1];
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (blocked[ni] || closed[ni]) continue;
        // 斜着走不能切墙角
        if (dx && dy && (blocked[cy * w + nx] || blocked[ny * w + cx])) continue;
        const step = (dx && dy ? Math.SQRT2 : 1) * cost[ni];
        const ng = g[cur] + step;
        if (ng < g[ni]) {
          g[ni] = ng;
          f[ni] = ng + heur(ni);
          came[ni] = cur;
          if (open.indexOf(ni) < 0) open.push(ni);
        }
      }
    }
    return null;
  }

  /**
   * 拉直：格子路径走出来是直角台阶，这里从当前点开始，每一步直接跳到
   * 视线可达的最远路点，走起来就是贴着墙的斜线。
   */
  function smoothPath(pts, sx, sy) {
    if (!pts || !pts.length) return pts;
    const out = [];
    let cx = sx, cy = sy, i = 0;
    while (i < pts.length) {
      let far = i;
      for (let j = pts.length - 1; j > i; j--) {
        if (lineClear(cx, cy, pts[j].x, pts[j].y)) { far = j; break; }
      }
      out.push(pts[far]);
      cx = pts[far].x; cy = pts[far].y;
      i = far + 1;
    }
    return out;
  }

  /**
   * 朝 (tx,ty) 的方向向量：有路径就沿路径，没有就直线。
   * 路径每 0.35~0.6 秒重算一次，目标挪远了也重算。
   */
  function steerTo(e, tx, ty, dt) {
    e.pathTimer -= dt;
    const tail = e.path && e.path.length ? e.path[e.path.length - 1] : null;
    const stale = !e.path || !tail || dist2(tail.x, tail.y, tx, ty) > 44 * 44;
    if (stale || e.pathTimer <= 0) {
      e.pathTimer = 0.35 + Math.random() * 0.25;
      const raw = findPath(W, e.x, e.y, tx, ty);
      e.path = raw ? smoothPath(raw, e.x, e.y) : null;
      e.pathI = 0;
    }
    if (!e.path || !e.path.length) return null;
    let guard = 0;
    while (e.pathI < e.path.length && guard++ < 32) {
      const p = e.path[e.pathI];
      if (dist2(e.x, e.y, p.x, p.y) < 11 * 11) e.pathI++;
      else break;
    }
    if (e.pathI >= e.path.length) return null;
    const p = e.path[e.pathI];
    const d = Math.hypot(p.x - e.x, p.y - e.y);
    if (d < 0.001) return null;
    return { x: (p.x - e.x) / d, y: (p.y - e.y) / d };
  }

  /** 追击时把挡路的门推开——不然敌人会一直对着门撞。 */
  function pushDoor(e) {
    for (const d of W.doors) {
      if (d.open) continue;
      if (dist2(e.x, e.y, d.x, d.y) < 34 * 34) {
        d.open = true;
        d.t = 0;
        W._solidDirty = true;
        Sfx.play('door');
      }
    }
  }

  /** 玩家射击破门：迈阿密式突入。门瞬间弹开（带一个摆动的开门动画）、飞出木屑、
   *  并发出噪音惊动门后房间里的敌人——破门后敌人会涌向门口。 */
  function breakDoor(d, hitPos) {
    if (!d || d.open) return;
    d.open = true;
    d.t = 0;
    W._solidDirty = true;
    Sfx.play('door');
    // 门后敌人被惊动：破门那一瞬间，门后房间里的敌人都知道玩家来了
    emitNoise(d.x, d.y, 320);
    // 木屑/碎门粒子
    FX.addParticles(hitPos.x, hitPos.y, 10, '#a8a4a0', 180, 0.32);
    FX.addParticles(hitPos.x, hitPos.y, 6, '#c8c8d0', 130, 0.26);
    // 轻微镜头抖动，强化"破门"的冲击感
    FX.kick(2.5, 0.12);
  }

  // ---------------------------------------------------------------- 特效
  const FX = {
    tracers: [],
    parts: [],
    texts: [],
    clips: [],       // 换弹时甩出去的旧弹匣（要旋转，粒子那套圆点表达不了）
    shards: [],      // 护甲被打碎时飞出的甲片（旋转的方形碎片）
    sprays: [],      // 血液喷溅：空中的血珠/血雾，**落地那一刻**才在地上留下血点
    gibs: [],        // 被砍飞/打散的肢体（飞一段后落到地上贴进贴花层，永久留着）
    shake: 0,
    shakeT: 0,
    hitstop: 0,
    flash: 0,

    /** 换弹动画：从枪的握把位置甩出一个旧弹匣（手枪/冲锋枪），侧向飞出、旋转、淡出。 */
    addClip(x, y, ang) {
      const side = ang + Math.PI / 2;          // 甩向枪身右侧（角色右手边）
      const sp = 52 + Math.random() * 26;
      this.clips.push({
        type: 'mag',
        x, y,
        vx: Math.cos(side) * sp + Math.cos(ang) * 10,
        vy: Math.sin(side) * sp + Math.sin(ang) * 10,
        rot: side + (Math.random() - 0.5) * 0.6,
        rotV: 10 + Math.random() * 6,
        life: 0.75, max: 0.75
      });
    },

    /** 散弹枪逐发装填：甩出一颗打过的空弹壳（红色小壳，比弹匣小得多）。 */
    addShell(x, y, ang) {
      const side = ang + Math.PI / 2;
      const sp = 34 + Math.random() * 16;
      this.clips.push({
        type: 'shell',
        x, y,
        vx: Math.cos(side) * sp + Math.cos(ang) * 6,
        vy: Math.sin(side) * sp + Math.sin(ang) * 6,
        rot: side + (Math.random() - 0.5) * 1.2,
        rotV: 14 + Math.random() * 8,
        life: 0.55, max: 0.55
      });
    },

    addTracer(x1, y1, x2, y2, color) {
      this.tracers.push({ x1, y1, x2, y2, t: 0.07, color: color || 'rgba(255,238,190,0.9)' });
    },
    addParticles(x, y, n, color, spd, life) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = spd * (0.4 + Math.random() * 0.9);
        this.parts.push({
          x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          life: life * (0.6 + Math.random() * 0.8), max: life, color,
          size: 1 + Math.random() * 1.6
        });
      }
    },
    /**
     * 血液喷洒：从创口朝受力方向喷出一股血珠 + 一层薄雾。
     *
     * 这里是"不许直接出现血"的关键：空中飞的只是**液滴**，地上什么都没有；
     * 每颗血珠飞到速度耗尽 / 寿命到了的那一刻，才在自己的落点上点一小滴血痕。
     * 所以打死人时先看到一条血线甩出去，0.2~0.5s 后地面才一点点脏起来，
     * 而不是"砰"地贴上一大滩红图。
     */
    addBlood(x, y, dir, n, scale) {
      const a = Math.atan2(dir.y, dir.x);
      const count = n || 10;
      const sc = scale || 1;
      // 血雾：几团扩散开的半透明红雾，压在血珠下面，给"喷"一个体积感
      const mists = Math.max(1, Math.round(count * 0.22));
      for (let i = 0; i < mists; i++) {
        const ma = a + (Math.random() - 0.5) * 1.1 * sc;
        const ms = (26 + Math.random() * 40) * (0.7 + sc * 0.5);
        this.sprays.push({
          mist: true,
          x, y,
          vx: Math.cos(ma) * ms, vy: Math.sin(ma) * ms,
          life: 0.34 + Math.random() * 0.24, max: 0.58,
          size: (3.2 + Math.random() * 3.4) * (0.75 + sc * 0.5),
          color: Math.random() < 0.5 ? 'rgba(126,14,26,' : 'rgba(168,22,38,'
        });
      }
      // 血珠：带速度甩出去，会飞、会减速、落地留痕
      for (let i = 0; i < count; i++) {
        const aa = a + (Math.random() - 0.5) * 1.9 * sc;
        const s = (55 + Math.random() * 175) * (0.55 + sc * 0.55);
        this.sprays.push({
          x, y,
          vx: Math.cos(aa) * s, vy: Math.sin(aa) * s,
          life: 0.22 + Math.random() * 0.34, max: 0.56,
          size: (0.9 + Math.random() * 1.9) * (0.8 + sc * 0.35),
          color: Math.random() < 0.3 ? '#7d0e1c' : (Math.random() < 0.25 ? '#e0243a' : '#bf1527')
        });
      }
    },
    /**
     * 断肢：从尸体位置甩出几截"胳膊（袖子 + 圆手）"，霰弹枪贴脸时可以把头也打飞。
     * 部件会转着飞一段、一路甩血，落地那一刻才贴进贴花层（跟血滴一样"先飞后落"）。
     */
    addGibs(x, y, ang, n, style, head) {
      const st = style || {};
      const sc = st.scale || 1;
      for (let i = 0; i < n; i++) {
        const isHead = head && i === 0;
        const a = ang + (Math.random() - 0.5) * (isHead ? 0.7 : 1.6);
        const sp = (110 + Math.random() * 150) * sc;
        this.gibs.push({
          type: isHead ? 'head' : 'arm',
          x: x + (Math.random() - 0.5) * 5,
          y: y + (Math.random() - 0.5) * 5,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          rot: Math.random() * 6.283,
          rotV: (Math.random() < 0.5 ? -1 : 1) * (7 + Math.random() * 10),
          len: (9 + Math.random() * 5) * sc,
          w: (3.1 + Math.random() * 1.1) * sc,
          hand: (2.5 + Math.random() * 0.7) * sc,
          cloth: st.cloth || '#6e6e74',
          skin: st.skin || '#8a857e',
          life: 0.36 + Math.random() * 0.24, max: 0.6,
          drip: 0.02
        });
      }
    },
    addText(x, y, txt, color) {
      this.texts.push({ x, y, txt, color: color || '#fff', life: 0.9, max: 0.9 });
    },
    /** 护甲破碎：飞出几片旋转的灰蓝甲片，边转边淡出。 */
    addShards(x, y, dir, n) {
      const a = Math.atan2(dir.y, dir.x);
      for (let i = 0; i < (n || 8); i++) {
        const aa = a + (Math.random() - 0.5) * 2.4;
        const s = 50 + Math.random() * 120;
        this.shards.push({
          x, y, vx: Math.cos(aa) * s, vy: Math.sin(aa) * s,
          rot: Math.random() * 6.28, rotV: (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 10),
          life: 0.4 + Math.random() * 0.35, max: 0.75,
          size: 1.6 + Math.random() * 1.8,
          color: Math.random() < 0.5 ? '#7fa8c8' : '#b8d4e4'
        });
      }
    },
    kick(amount, dur) {
      this.shake = Math.max(this.shake, amount);
      this.shakeT = Math.max(this.shakeT, dur || 0.14);
    },
    update(dt) {
      for (let i = this.tracers.length - 1; i >= 0; i--) {
        this.tracers[i].t -= dt;
        if (this.tracers[i].t <= 0) this.tracers.splice(i, 1);
      }
      for (let i = this.parts.length - 1; i >= 0; i--) {
        const p = this.parts[i];
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= 0.90; p.vy *= 0.90;
        p.life -= dt;
        if (p.life <= 0) this.parts.splice(i, 1);
      }
      // 血珠：飞到落点（寿命耗尽/速度停下来）才在地上点一滴 —— 血不是"直接出现"的
      for (let i = this.sprays.length - 1; i >= 0; i--) {
        const s = this.sprays[i];
        s.x += s.vx * dt; s.y += s.vy * dt;
        s.vx *= Math.pow(0.06, dt); s.vy *= Math.pow(0.06, dt);
        s.life -= dt;
        if (s.life > 0) continue;
        if (!s.mist) bloodDot(s.x, s.y, s.size * (0.85 + Math.random() * 0.7));
        this.sprays.splice(i, 1);
      }
      for (let i = this.clips.length - 1; i >= 0; i--) {
        const c = this.clips[i];
        c.x += c.vx * dt; c.y += c.vy * dt;
        // 阻尼按秒算：写成每帧乘常数的话，60fps 下 0.86^60 ≈ 0.0001，弹匣刚出手就钉住了
        const damp = Math.pow(0.16, dt);
        c.vx *= damp; c.vy *= damp;
        c.rot += c.rotV * dt;
        c.rotV *= Math.pow(0.3, dt);
        c.life -= dt;
        if (c.life <= 0) this.clips.splice(i, 1);
      }
      for (let i = this.texts.length - 1; i >= 0; i--) {
        const t = this.texts[i];
        t.y -= 24 * dt; t.life -= dt;
        if (t.life <= 0) this.texts.splice(i, 1);
      }
      for (let i = this.shards.length - 1; i >= 0; i--) {
        const s = this.shards[i];
        s.x += s.vx * dt; s.y += s.vy * dt;
        s.vx *= 0.88; s.vy *= 0.88;
        s.rot += s.rotV * dt;
        s.rotV *= Math.pow(0.3, dt);
        s.life -= dt;
        if (s.life <= 0) this.shards.splice(i, 1);
      }
      for (let i = this.gibs.length - 1; i >= 0; i--) {
        const g = this.gibs[i];
        g.x += g.vx * dt; g.y += g.vy * dt;
        // 阻尼按秒算，不然 60fps 下刚离体就钉住（同弹匣那条坑）
        const damp = Math.pow(0.06, dt);
        g.vx *= damp; g.vy *= damp;
        g.rot += g.rotV * dt;
        g.rotV *= Math.pow(0.35, dt);
        g.life -= dt;
        // 飞的时候一路滴血：这些血珠自己落地才留痕，正好给肢体拖出一条血线
        g.drip -= dt;
        if (g.drip <= 0 && g.life > 0) {
          g.drip = 0.03 + Math.random() * 0.05;
          const da = Math.atan2(g.vy, g.vx) + (Math.random() - 0.5) * 1.5;
          const ds = 26 + Math.random() * 64;
          this.sprays.push({
            x: g.x, y: g.y,
            vx: Math.cos(da) * ds, vy: Math.sin(da) * ds,
            life: 0.16 + Math.random() * 0.22, max: 0.38,
            size: 1.0 + Math.random() * 1.2,
            color: Math.random() < 0.4 ? '#7d0e1c' : '#c2172a'
          });
        }
        if (g.life > 0) continue;
        bakeGib(g);
        this.gibs.splice(i, 1);
      }
      if (this.shakeT > 0) {
        this.shakeT -= dt;
        if (this.shakeT <= 0) this.shake = 0;
      }
      if (this.flash > 0) this.flash -= dt * 4;
    },
    reset() {
      this.tracers.length = 0;
      this.parts.length = 0;
      this.texts.length = 0;
      this.clips.length = 0;
      this.shards.length = 0;
      this.sprays.length = 0;
      this.gibs.length = 0;
      this.shake = 0; this.shakeT = 0; this.hitstop = 0; this.flash = 0;
    }
  };

  // ---------------------------------------------------------------- 声音事件
  function emitNoise(x, y, radius) {
    if (!W) return;
    // 噪声实际传播半径统一收一档（ALERT_NOISE），不然一把手枪就能叫醒整层楼
    const R = radius * ALERT_NOISE;
    for (const e of W.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(x - e.x, y - e.y);
      if (d <= R) {
        if (e.state === 'chase') continue;
        // 警觉系统：噪声越近，反应越强。近距离（< 半径 30%）直接惊动追击，
        // 中远距离则先怀疑、走向声源查看（investigate），途中看到玩家才转追击。
        const near = d <= R * ALERT_NEAR;
        if (near) {
          e.state = 'chase';
          e.lastSeen.x = x; e.lastSeen.y = y;
          e.seeTimer = 0;
          FX.addText(e.x, e.y - 14, '!', '#ff5a5a');
        } else if (e.state !== 'investigate') {
          e.state = 'investigate';
          e.target.x = x; e.target.y = y;
          e.investigateTimer = 2.4;
          FX.addText(e.x, e.y - 14, '?', '#ffd76e');
        }
      }
    }
  }

  // ---------------------------------------------------------------- 玩家
  function makePlayer(x, y) {
    return {
      x, y, vx: 0, vy: 0,
      alive: true,
      facing: { x: 1, y: 0 },
      weapon: null, ammo: 0, cooldown: 0,
      reserve: 0,            // 备弹（当前武器，换弹从这里取）
      reload: 0,             // 换弹计时（R 手动换弹）
      reloadTotal: 0,        // 这次换弹的总时长（准心进度环用）
      // 副武器槽：背上背着的第二把家伙（2 键 / Q 切换）。结构 { weapon, ammo, reserve }
      // 手上最多一把、背上最多一把，再捡同型号的会并成备弹。
      side: null,
      stun: 0,
      stepTimer: 0,
      kick: 0,
      deathT: 0,
      hp: HP_MAX,            // 单血量（上限 100）
      armor: 0,              // 当前护甲值（扣除优先于血量）
      armorSlots: 0,         // 已装备的护甲板格数（跟随护甲等级走，0~当前等级格数）
      armorTier: 0,          // 护甲等级 0..4（ARMOR_TIERS）：1 级单格 50 → 5 级金甲单格 150
      armorPlates: 0,        // 背包里的护甲板数量（补给点买/掉落，按 4 取出长按左键装一块）
      medkits: 0,            // 背包里的血包数量（自动拾取，按 3 取出长按左键使用）
      grenades: 2,           // 手雷（按 G 切换手持，左键投掷）
      throwCd: 0,            // 投掷冷却，防止一通乱按连丢
      grenadeHeld: false,    // 手持手雷状态：按 G 进入，左键丢出，右键瞄准
      // 血包治疗：按 3 切换到血包后，长按左键读条
      healing: false,
      healCharge: 0,
      // 护甲板装载：按 4 取出一块，长按左键 1 秒装入（此时准心变空心圆）
      plating: false,
      plateCharge: 0,
      // 当前手上是哪个槽的枪：'main' 主武器 / 'side' 副武器（1、2 键直达）
      curSlot: 'main',
      // 瞄准：aimT 是 0→1 的平滑过渡（准心、视野、散射都按它插值），aiming 是过阈值后的布尔
      aimT: 0,
      aiming: false,
      // 技能层数（只有老虎机能发）。这里存的是"拿了几层"，不是加成比例，
      // 参与计算必须走 speedMul / fireRateMul / reloadMul 换算。
      perks: { speed: 0, firerate: 0, reload: 0 },
      // 换枪动画：swapT > 0 表示正在掏枪/收枪（按新枪的 drawTime 走），期间锁扳机
      swapT: 0,
      swapTotal: 0,
      // 手持物切换动画：切医疗包/护甲板、用完切回枪时触发，让手持物/枪有"掏出→收起"的过渡
      equipT: 0,
      equipTotal: 0,
      // 扳机就绪标记：用完护甲板/医疗包切回枪后置 false，要求重新按一下开火键才恢复开火，
      // 避免"手指还按着"就误开火浪费子弹。
      armed: true,
      // 空手出拳的前伸动画计时（>0 时拳头往前探）
      punchT: 0,
      // 近战挥砍动画：swingT 倒数到 0，swingDir 决定这一刀从左往右还是反向（左右交替）
      swingT: 0,
      swingTotal: 0,
      swingDir: 1,
      // 散弹枪逐发装填：shellReload > 0 表示正在塞当前这一发
      shellReload: 0,
      shellTotal: 0,
      // 这次换弹有没有用真录音放（用了就不再补合成的"弹匣拍进去"声）
      reloadSampled: false
    };
  }

  // ---------------- 技能层数 → 实际加成 ----------------
  // 每个值都是"每层"的效果，叠加上限见 SKILL_CAP。
  const SKILL_STEP = { speed: 0.12, firerate: 0.10, reload: 0.15 };
  const SKILL_CAP = { speed: 0.60, firerate: 0.55, reload: 0.60 };

  /** 某技能的层数（没这技能就是 0）。 */
  function skillLevel(p, id) {
    return (p && p.perks && p.perks[id]) || 0;
  }

  /**
   * 层数 × 每层效果，夹在上限内。
   * 注意：层数**不能**直接当比例用 —— 曾经 reload 写成 `1 - perks.reload`，
   * 拿到第 1 层快手就变成 `1 - 1 = 0`，换弹时长为 0，
   * 于是 `p.reload > 0` 永远不成立，弹匣再也填不上，按 R 看着像没反应。
   */
  function skillBonus(p, id) {
    const step = SKILL_STEP[id] || 0;
    return Math.min(skillLevel(p, id) * step, SKILL_CAP[id] || 0);
  }

  /** 移速倍率（1 起，往上加）。 */
  function speedMul(p) { return 1 + skillBonus(p, 'speed'); }
  /** 射击间隔倍率（1 起，往下减，但不会到 0）。 */
  function fireRateMul(p) { return 1 - skillBonus(p, 'firerate'); }
  /** 换弹时长倍率（1 起，往下减，最快也要花 40% 时间）。 */
  function reloadMul(p) { return 1 - skillBonus(p, 'reload'); }

  // 护甲等级体系：armorTier 是 0..4（对应 ARMOR_TIERS），每级决定格数/每格值/颜色。
  // 满甲值 = slots × per，逐级升高。补甲、受击、HUD 都从当前等级取数，不再用固定常量。
  function armorTier(p) {
    return ARMOR_TIERS[clamp(p.armorTier || 0, 0, ARMOR_TIERS.length - 1)];
  }
  function armorMax(p) {
    const t = armorTier(p);
    return t.slots * t.per;
  }
  function armorSlotCount(p) { return armorTier(p).slots; }
  function armorPerSlot(p) { return armorTier(p).per; }

  // 补甲：按当前护甲等级打满（armorSlots 跟随等级、armor 补到满甲值）。
  function refillArmor(p) {
    const t = armorTier(p);
    p.armorSlots = t.slots;
    p.armor = t.slots * t.per;
  }

  /**
   * 护甲满了没有 —— 只看**护甲值**，别看格数。
   * armorSlots 只在被打穿（armor<=0）时才清零，所以"插了 3 格板、被打掉一半"
   * 这种状态格数仍是 3；按格数判满就会出现"甲只剩 60，却说护甲已满，装不上板"。
   */
  function armorFull(p) { return p.armor >= armorMax(p) - 0.001; }

  /** 格数跟着护甲值走（按当前等级每格值向上取整）：半格也算一格，方便 HUD 和拾取逻辑对齐。 */
  function syncArmorSlots(p) {
    p.armorSlots = Math.ceil(clamp(p.armor, 0, armorMax(p)) / armorPerSlot(p));
  }

  // ---------------------------------------------------------------- 战斗
  // ---------------------------------------------------------------- 爆炸
  //
  // 手雷和油桶共用同一套：在某个点炸开，伤害按距离衰减。
  // 油桶之间会互相引爆，但走的是"引信延迟"而不是递归调用 ——
  // 一排桶挨在一起时递归会瞬间爆栈，而且看不到连锁的画面感。
  const BLASTS = [];   // 冲击波（视觉）：{x,y,t,r}

  /** 检查 (x,y) 附近有没有还没烧起来的油桶贴片，有就点燃。 */
  function barrelAt(x, y, pad) {
    pad = pad || 0;
    for (const b of W.barrels) {
      if (!b.alive) continue;
      if (Math.abs(x - b.x) <= TILE / 2 + pad && Math.abs(y - b.y) <= TILE / 2 + pad) return b;
    }
    return null;
  }

  /** 点燃一个油桶：只点一次，引信走完由 updateBarrels 引爆。 */
  function igniteBarrel(b) {
    if (!b || !b.alive || b.fuse > 0) return false;
    b.fuse = BARREL_DELAY;
    return true;
  }

  /** 在 (x,y) 炸开：伤害、特效、连锁引爆范围内的其它油桶。 */
  function explodeAt(x, y, radius, dmg, byPlayer) {
    FX.kick(9, 0.34);
    FX.flash = 0.8;
    FX.addParticles(x, y, 24, '#ffc266', 250, 0.5);
    FX.addParticles(x, y, 16, '#ff6a2a', 175, 0.62);
    FX.addParticles(x, y, 10, '#4a4038', 95, 0.85);
    BLASTS.push({ x, y, t: 0, r: radius });
    Sfx.play('boom');
    // 爆炸是最响的动静，传得最远，惊动一大片敌人
    emitNoise(x, y, 700);

    // 敌人：范围内按距离衰减，边缘只剩三成
    for (const e of W.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d > radius) continue;
      const fall = 1 - (d / radius) * 0.7;
      damageEnemy(e, Math.round(dmg * fall), Math.atan2(e.y - y, e.x - x), byPlayer, false);
      if (e.alive) e.stun = Math.max(e.stun || 0, 0.45);
    }

    // 玩家：自己扔的雷也炸自己，但只吃一半，免得手滑即死
    const p = G.player;
    if (p && p.alive) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= radius) {
        const fall = 1 - (d / radius) * 0.7;
        damagePlayer(Math.round(dmg * fall * 0.5), Math.atan2(p.y - y, p.x - x));
      }
    }

    // 连锁：范围内的油桶接着烧
    for (const b of W.barrels) {
      if (!b.alive) continue;
      if (Math.hypot(b.x - x, b.y - y) <= radius) igniteBarrel(b);
    }
  }

  /** 炸掉一个油桶：先从碰撞里摘掉，再引爆。 */
  function blowBarrel(b) {
    if (!b || !b.alive) return;
    b.alive = false;
    b.fuse = 0;
    const i = W.walls.indexOf(b.rect);
    if (i >= 0) W.walls.splice(i, 1);
    W._solidDirty = true;                       // 门/墙缓存要重算，不然子弹还会被空气挡住
    W.nav.blocked[Math.floor(b.y / TILE) * W.w + Math.floor(b.x / TILE)] = 0;
    explodeAt(b.x, b.y, BARREL_RADIUS, BARREL_DMG, true);
  }

  function updateBarrels(dt) {
    if (!W || !W.barrels) return;
    for (const b of W.barrels) {
      if (!b.alive) continue;
      if (b.shake > 0) b.shake = Math.max(0, b.shake - dt * 6);
      if (b.fuse > 0) {
        b.fuse -= dt;
        // 引信火花：让人看见"这个桶要炸了"，别只是静静站着
        if (Math.random() < 0.75) {
          FX.parts.push({
            x: b.x + (Math.random() - 0.5) * 10, y: b.y + (Math.random() - 0.5) * 10,
            vx: (Math.random() - 0.5) * 60, vy: -40 - Math.random() * 60,
            life: 0.25, max: 0.25, color: '#e02929', size: 1.3
          });
        }
        if (b.fuse <= 0) blowBarrel(b);
      }
    }
  }

  // ---------------------------------------------------------------- 手雷
  const GRENADE_SPEED = 300;
  const GRENADE_FUSE = 3.0;     // 没砸到目标就 3 秒后炸；撞墙/撞桶/撞敌人立即炸
  const GRENADE_RADIUS = 76;
  const GRENADE_DMG = 135;
  const GRENADE_MAX = 5;        // 背包上限
  const GRENADE_BLINK = 0.7;    // 最后 0.7 秒开始红闪（"准备爆炸"警告）

  /** 切换手持手雷：按 G 在手雷和武器之间来回切。没雷时提示，不进入手持。 */
  function toggleGrenade() {
    const p = G.player;
    if (!p || !p.alive) return false;
    if (p.grenadeHeld) {
      // 已经拿着手雷 → 放下，回到武器
      p.grenadeHeld = false;
      Sfx.play('pickup');
      return true;
    }
    if (p.grenades <= 0) {
      G.toast = '没有手雷';
      G.toastTimer = 1.2;
      return false;
    }
    // 收起血包/护甲板，切出手雷
    p.healing = false; p.healCharge = 0;
    p.plating = false; p.plateCharge = 0;
    p.grenadeHeld = true;
    Sfx.play('pickup');
    return true;
  }

  /** 扔一颗手雷：手持手雷（按 G 切出）后左键丢出，朝准心方向。 */
  function throwGrenade() {
    const p = G.player;
    if (!p || !p.alive) return false;
    if (p.grenades <= 0) {
      G.toast = '没有手雷';
      G.toastTimer = 1.2;
      p.grenadeHeld = false;      // 没雷了自动放下，回到武器
      return false;
    }
    if (p.throwCd > 0) return false;
    p.grenades--;
    p.throwCd = 0.5;
    p.grenadeHeld = false;        // 丢出去了，回到武器
    const aim = aimDir() || p.facing;
    G.grenades.push({
      x: p.x + aim.x * 11, y: p.y + aim.y * 11,
      vx: aim.x * GRENADE_SPEED, vy: aim.y * GRENADE_SPEED,
      t: GRENADE_FUSE, spin: 0
    });
    Sfx.play('throw');
    emitNoise(p.x, p.y, 90);
    return true;
  }

  function updateGrenades(dt) {
    if (!G.grenades) return;
    for (let i = G.grenades.length - 1; i >= 0; i--) {
      const g = G.grenades[i];
      g.t -= dt;
      g.spin += dt * 16;
      // 分两小步推进：速度 300px/s，一帧走 5px，单步可能直接穿进墙里
      let boom = g.t <= 0;
      for (let s = 0; s < 2 && !boom; s++) {
        g.x += g.vx * dt * 0.5;
        g.y += g.vy * dt * 0.5;
        if (pointSolid(W, g.x, g.y, 0)) {
          // 撞墙或油桶：就地炸（撞桶会顺带引爆它，连锁）
          g.x -= g.vx * dt * 0.5;
          g.y -= g.vy * dt * 0.5;
          boom = true;
        } else {
          // 砸到敌人身上：立即爆炸（手雷直接糊脸）
          for (const e of W.enemies) {
            if (!e.alive) continue;
            const r = ACTOR_R + 5 + (e.scale ? e.scale * 2 : 0);
            if (Math.hypot(g.x - e.x, g.y - e.y) <= r) { boom = true; break; }
          }
        }
      }
      if (!boom) {
        // 拖尾火星
        if (Math.random() < 0.55) {
          FX.parts.push({
            x: g.x, y: g.y, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30,
            life: 0.24, max: 0.24, color: 'rgba(255,190,120,0.85)', size: 1.2
          });
        }
        continue;
      }
      G.grenades.splice(i, 1);
      explodeAt(g.x, g.y, GRENADE_RADIUS, GRENADE_DMG, true);
    }
  }

  /**
   * 把手上这把家伙扔出去（F / 触屏"扔枪"）。
   * 迈阿密热线式操作：子弹打光就把空枪砸出去 —— 砸中人当场放倒，枪落地还能再捡。
   * 扔出去后手上空了：背上有枪就自动掏出来，没有就空手（去捡敌人的枪）。
   *
   * 两种模式都能扔：挑战模式扔的是花钱买的枪，但落地还能捡回来，
   * 只有真扔进墙缝里才会丢（跟"打光了砸出去"相比，这个风险玩家自己权衡）。
   */
  const THROW_SPEED = 560;
  const THROW_DMG = 55;      // 挑战模式的钝击伤害（剧情模式仍然是一击必杀）

  function throwWeapon() {
    const p = G.player;
    if (!p || !p.alive || !W) return false;
    if (!p.weapon) return false;
    if (p.reload > 0) return false;
    const def = WEAPONS[p.weapon];
    const a = Math.atan2(p.facing.y, p.facing.x);
    W.thrown.push({
      def: p.weapon,
      ammo: def.melee ? 0 : p.ammo,     // 枪里剩多少子弹就带着飞
      reserve: def.melee ? 0 : (p.reserve || 0),
      x: p.x + p.facing.x * 10,
      y: p.y + p.facing.y * 10,
      vx: Math.cos(a) * THROW_SPEED,
      vy: Math.sin(a) * THROW_SPEED,
      rot: a,
      spin: 26 * (Math.random() < 0.5 ? -1 : 1),
      life: 1.1
    });
    // 甩手：空手时用出拳那套前伸动画替一下（枪已经飞出去了，手要跟出去）
    p.punchT = PUNCH_TIME * 0.9;
    p.swingDir = 1;
    // 手上清空：先看背上有没有，有就顺手掏出来
    p.weapon = null;
    p.ammo = 0;
    p.reserve = 0;
    p.reload = 0;
    p.reloadTotal = 0;
    p.cooldown = Math.max(p.cooldown, 0.18);
    if (p.side) {
      p.weapon = p.side.weapon;
      p.ammo = p.side.ammo;
      p.reserve = G.mode === 'story' ? 0 : (p.side.reserve || 0);
      p.side = null;
      p.curSlot = 'main';
    }
    Sfx.play('swing');
    emitNoise(p.x, p.y, 150);           // 扔东西有点动静，但不至于惊动整层楼
    return true;
  }

  /** 投掷物飞行：撞墙/撞人就落地变成可捡的枪。 */
  function updateThrown(dt) {
    if (!W || !W.thrown) return;
    const list = W.thrown;
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i];
      t.life -= dt;
      t.rot += t.spin * dt;
      // 分两小步推进，避免一帧穿过薄墙
      let landed = false;
      let hitActor = false;
      for (let s = 0; s < 2 && !landed; s++) {
        const nx = t.x + t.vx * dt * 0.5;
        const ny = t.y + t.vy * dt * 0.5;
        // 砸到敌人：剧情一击必杀；挑战模式按钝击伤害算（砸头还有加成）
        for (const e of W.enemies) {
          if (!e.alive) continue;
          const r = ACTOR_R + 6 + (e.scale ? e.scale * 2 : 0);
          if (Math.hypot(nx - e.x, ny - e.y) <= r) {
            const dmg = G.mode === 'story' ? 9999 : THROW_DMG;
            // 撞击点血雾：朝飞行方向喷一股，砸中的感觉才"实"
            FX.addBlood(nx, ny, { x: Math.cos(t.rot) * 0.9, y: Math.sin(t.rot) * 0.9 }, 14, 1.0);
            FX.kick(2.8, 0.12);
            damageEnemy(e, dmg, t.rot, true, false);
            Sfx.play('hit');
            emitNoise(nx, ny, 260);
            // 被砸中的敌人往受力方向倒
            e.deathDir = t.rot;
            landed = true;
            hitActor = true;
            break;
          }
        }
        if (landed) break;
        // 撞墙/门/掩体：崩一层灰
        if (pointSolid(W, nx, ny, 2)) {
          FX.addParticles(nx, ny, 7, '#b9b2a6', 90, 0.22);
          FX.kick(1.6, 0.08);
          landed = true;
          break;
        }
        t.x = nx; t.y = ny;
      }
      if (!landed && t.life > 0) continue;
      // 落地：变成地上的枪（带着剩下的子弹）
      const pk = makePickup(t.def, t.x, t.y);
      pk.ammo = t.ammo;
      pk.reserve = t.reserve || 0;
      W.pickups.push(pk);
      if (!hitActor) Sfx.play('step');
      list.splice(i, 1);
    }
  }

  /** 飞行中的投掷武器：旋转的枪影 + 地面小影子。 */
  function drawThrown() {
    if (!W || !W.thrown) return;
    for (const t of W.thrown) {
      const img = IMG[WEAPONS[t.def].icon];
      if (!img) continue;
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.globalAlpha = 0.30;
      ctx.drawImage(IMG.shadow, -14, -12, 28, 28);
      ctx.globalAlpha = 1;
      ctx.rotate(t.rot);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();
    }
  }

  function castShot(origin, angle, range, shooter) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let best = range, hitActor = null, hitBarrel = null, hitDoor = null;
    const rects = solidRects(W, true);
    for (let i = 0; i < rects.length; i++) {
      const t = rayRect(origin.x, origin.y, dx, dy, rects[i]);
      if (t !== null && t < best) {
        best = t; hitActor = null;
        // 挡路的如果是油桶/门，记下来：墙是打不动的，桶会炸、门会破
        hitBarrel = rects[i].barrel || null;
        hitDoor = rects[i].door || null;
      }
    }
    const targets = [];
    if (shooter === G.player) {
      for (const e of W.enemies) if (e.alive) targets.push(e);
    } else {
      if (G.player.alive) targets.push(G.player);
      for (const e of W.enemies) if (e.alive && e !== shooter) targets.push(e);
    }
    for (const a of targets) {
      const t = rayCircle(origin.x, origin.y, dx, dy, a.x, a.y, ACTOR_R);
      if (t !== null && t < best) { best = t; hitActor = a; hitBarrel = null; }
    }
    const end = { x: origin.x + dx * best, y: origin.y + dy * best };
    FX.addTracer(origin.x, origin.y, end.x, end.y);
    if (hitActor) {
      const dirAngle = Math.atan2(dy, dx);
      const isPlayerHit = hitActor === G.player;
      const isPlayerShot = shooter === G.player;
      // 玩家打敌人用武器伤害；敌人打玩家用敌人种类的 dmg（精细控制难度）
      let dmg;
      if (isPlayerHit) {
        dmg = shooter && shooter.kind ? (ENEMY_KIND[shooter.kind].dmg || 15) : 15;
        if (shooter && (shooter.elite || shooter.boss)) dmg = Math.round(dmg * 1.5);   // 精英/BOSS 枪更疼
      } else {
        // 玩家开枪要算上升级：直接读 WEAPONS 只会拿到出厂伤害
        dmg = (shooter && shooter.weapon)
          ? (shooter === G.player ? gunStat(shooter.weapon, 'dmg') : (WEAPONS[shooter.weapon].dmg || 30))
          : 30;
      }
      // 爆头（参考塔科夫"瞄哪打哪"）：玩家开枪时，准心落在敌人头部范围里就爆头
      let headshot = false;
      if (isPlayerShot && !isPlayerHit) {
        const aim = screenToWorld(mouse.x, mouse.y);
        if (Math.hypot(aim.x - hitActor.x, aim.y - hitActor.y) <= HEADSHOT_R) {
          headshot = true;
          dmg = Math.round(dmg * HEADSHOT_MULT);
        }
      }
      if (isPlayerHit) {
        damagePlayer(dmg, dirAngle);
      } else {
        damageEnemy(hitActor, dmg, dirAngle, isPlayerShot, headshot);
      }
      FX.hitstop = headshot ? 0.08 : 0.05;
      FX.kick(headshot ? 5.5 : 3.5, 0.14);
    } else if (hitDoor) {
      // 打在门上：玩家射击可破门突入（迈阿密式），敌人不主动破门（他们撞门会自动推开）
      if (shooter === G.player) {
        breakDoor(hitDoor, end);
      } else {
        FX.addParticles(end.x, end.y, 4, '#8a8a90', 90, 0.18);
      }
    } else if (hitBarrel) {
      // 打在桶上：先扣耐久，打烂了走引信（不立刻炸，让玩家看见"我打中了"）
      const bdmg = shooter && shooter.weapon ? (WEAPONS[shooter.weapon].dmg || 30) : 25;
      hitBarrel.hp -= bdmg;
      hitBarrel.shake = 1;
      FX.addParticles(end.x, end.y, 5, '#c8c8d0', 130, 0.22);
      if (hitBarrel.hp <= 0) igniteBarrel(hitBarrel);
    } else {
      FX.addParticles(end.x, end.y, 4, '#ff5a5a', 90, 0.18);
      const dctx = W.decals.getContext('2d');
      dctx.fillStyle = 'rgba(20,16,20,0.75)';
      dctx.beginPath();
      dctx.arc(end.x, end.y, 1.2 + Math.random() * 0.9, 0, 6.283);
      dctx.fill();
    }
    return end;
  }

  function meleeSwing(actor, def, isPlayer) {
    const origin = { x: actor.x, y: actor.y };
    const facing = isPlayer ? Math.atan2(actor.facing.y, actor.facing.x) : actor.facing;
    const reach = def.reach, halfArc = def.arc * Math.PI / 180 / 2;
    const targets = [];
    if (isPlayer) { for (const e of W.enemies) if (e.alive) targets.push(e); }
    else { if (G.player.alive) targets.push(G.player); }
    let hitAny = false;
    for (const t of targets) {
      const d = Math.hypot(t.x - actor.x, t.y - actor.y);
      if (d > reach + 10) continue;
      const a = Math.atan2(t.y - actor.y, t.x - actor.x);
      if (Math.abs(angDiff(a, facing)) > halfArc) continue;
      if (!lineClear(origin.x, origin.y, t.x, t.y)) continue;
      const dirAngle = a;
      // 玩家挥击用武器伤害；敌人挥击用敌人种类 dmg
      let dmg;
      if (isPlayer) dmg = Math.round(def.dmg || 30);
      else {
        dmg = actor.kind ? (ENEMY_KIND[actor.kind].dmg || 15) : 15;
        if (actor.elite || actor.boss) dmg = Math.round(dmg * 1.5);
      }
      // 近战也能爆头：挥击时准心压在对方头上
      let headshot = false;
      if (isPlayer) {
        const aim = screenToWorld(mouse.x, mouse.y);
        if (Math.hypot(aim.x - t.x, aim.y - t.y) <= HEADSHOT_R) {
          headshot = true;
          dmg = Math.round(dmg * 1.6);   // 近战爆头倍率比枪低
        }
      }
      if (t === G.player) {
        damagePlayer(dmg, dirAngle);
      } else {
        damageEnemy(t, dmg, dirAngle, isPlayer, headshot);
      }
      hitAny = true;
    }
    FX.kick(def.shake + (hitAny ? 2 : 0), 0.16);
    emitNoise(actor.x, actor.y, 130);
  }

  function lineClear(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) return true;
    const nx = dx / len, ny = dy / len;
    const rects = solidRects(W, true);
    for (let i = 0; i < rects.length; i++) {
      const t = rayRect(x1, y1, nx, ny, rects[i]);
      if (t !== null && t < len) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- 伤害
  // 护甲机制：受击时护甲先扣（护甲能全额吸收，但会损失一点"穿透"掉血）。
  // 护甲耗尽后，剩余伤害直接扣血。
  function damagePlayer(dmg, dirAngle) {
    const p = G.player;
    if (!p.alive) return true;
    // 剧情模式：迈阿密式一击必杀 —— 不设血量，挨一下就死（护甲/血包都不参与）
    if (G.mode === 'story') {
      G.storyHits = (G.storyHits || 0) + 1;
      FX.addBlood(p.x, p.y, { x: Math.cos(dirAngle), y: Math.sin(dirAngle) }, 4, 0.7);
      p.hp = 0;
      p.alive = false;
      p.deathDir = dirAngle;
      p.grenadeHeld = false;
      FX.flash = 0.6;
      FX.kick(4, 0.15);
      Sfx.play('hit');
      return true;
    }
    let remaining = dmg;
    // 剧情模式评分统计：每次受击（掉了护甲或血）都记一次
    if (G.mode === 'story' && remaining > 0) G.storyHits = (G.storyHits || 0) + 1;
    // 护甲先扣：每点护甲吸收对应伤害，护甲归零后再掉血
    if (p.armor > 0) {
      const absorbed = Math.min(p.armor, remaining);
      p.armor -= absorbed;
      remaining -= absorbed;
      // 护甲被打掉时同步反映到"格数"上（视觉上格子会碎）
      syncArmorSlots(p);
    }
    if (remaining > 0) {
      p.hp -= remaining;
      FX.flash = 0.6;
      FX.kick(4, 0.15);
      Sfx.play('hit');
    }
    FX.addBlood(p.x, p.y, { x: Math.cos(dirAngle), y: Math.sin(dirAngle) }, 4, 0.7);
    if (p.hp <= 0) {
      p.hp = 0;
      p.alive = false;
      p.deathDir = dirAngle;
      p.grenadeHeld = false;   // 死了放下手雷
      return true;
    }
    return false;
  }

  /** 对敌人造成伤害，返回是否死亡。精英先扣护甲：护甲打光前只碎甲不掉血。 */
  function damageEnemy(e, dmg, dirAngle, byPlayer, headshot) {
    if (!e.alive) return true;
    // 剧情模式：迈阿密式一击必杀 —— 不管什么枪、打中哪，一下就死（护甲也不顶）
    if (G.mode === 'story') { dmg = 9999; }
    // 护甲先扣（仅精英有）。击中护甲时给准心护甲反馈，护甲被打空那一下给破碎反馈。
    if (e.armor > 0) {
      const absorbed = Math.min(e.armor, dmg);
      e.armor -= absorbed;
      dmg -= absorbed;
      if (byPlayer) {
        if (e.armor <= 0) {
          // 这一击打碎护甲：破碎图案 + 破碎音效 + 碎甲粒子
          G.armorBreakT = 0.5;
          G.armorHitT = 0;
          Sfx.play('armorbreak');
          FX.addShards(e.x, e.y, { x: Math.cos(dirAngle), y: Math.sin(dirAngle) }, 10);
        } else {
          // 只是击中护甲（还没碎）：护甲标志 + 命中音效
          G.armorHitT = 0.18;
          Sfx.play('armorhit');
        }
      }
      // 护甲还在，这一击没掉血，直接返回
      if (e.armor > 0) return false;
    }
    e.hp -= dmg;
    FX.addBlood(e.x, e.y, { x: Math.cos(dirAngle), y: Math.sin(dirAngle) }, 4, 0.7);
    if (headshot) {
      // 爆头：额外一团血雾 + 字
      FX.addBlood(e.x, e.y, { x: Math.cos(dirAngle), y: Math.sin(dirAngle) }, 12, 1.15);
      FX.addText(e.x, e.y - 18, '爆头', '#e02929');
    }
    if (e.hp <= 0) {
      e.alive = false;
      e.deathDir = dirAngle;
      onEnemyKilled(e, byPlayer, headshot);
      return true;
    }
    return false;
  }

  /** 敌人被打死后的结算：积分、掉落、连击、血迹。 */
  function onEnemyKilled(e, byPlayer, headshot) {
    const dir = { x: Math.cos(e.deathDir), y: Math.sin(e.deathDir) };
    const killer = G.player;
    const wdef = killer && killer.weapon ? WEAPONS[killer.weapon] : null;
    spillBlood(e.x, e.y, dir, (wdef && wdef.blood) || BLOOD_PLAIN, false);
    if (headshot) {
      // 爆头多喷一轮，画面更狠
      spillBlood(e.x, e.y, dir, { pools: 3, spurts: 4, streaks: 3, scale: 1.05, spray: 16, speckles: 18 }, false);
    }
    // 断肢：霰弹枪 / 武士刀打死人时有概率把胳膊（霰弹还会连头）削下来。
    // 只在玩家打死的场合做 —— 敌人互殴、油桶炸死都不该掉一地手脚。
    if (byPlayer && wdef && wdef.gib && rollGib(wdef, e)) gibEnemy(e, wdef);
    Sfx.play('die');
    e.deadT = 0;
    // 掉枪：挑战模式近战武器不掉（匕首/球棍满地都是没意义，还会盖住血包和子弹）；
    // 剧情模式没有备弹，近战也得掉 —— 子弹打光只能靠捡刀接着打
    if (e.weapon && (!WEAPONS[e.weapon].melee || G.mode === 'story')) {
      const pk = makePickup(e.weapon, e.x, e.y);
      pk.ammo = WEAPONS[e.weapon].melee ? 0 : e.ammo;
      // 挑战模式：掉落的枪自带一份备弹；剧情模式没有备弹，就枪里剩的那几发
      pk.reserve = G.mode === 'story' ? 0 : Math.max(6, Math.round(WEAPONS[e.weapon].reserveMax * 0.35));
      W.pickups.push(pk);
    }
    e.weapon = null;
    if (byPlayer) {
      // 积分：基础分 + 波次加成，连击翻倍，爆头额外加成
      const K = ENEMY_KIND[e.kind];
      const waveBonus = 1 + (G.wave || 0) * 0.15;
      const base = Math.round(K.score * waveBonus * ((e.elite || e.boss) ? 3 : 1));
      G.combo++;
      G.comboTimer = 2.5;
      if (G.combo > G.bestCombo) G.bestCombo = G.combo;
      // 剧情模式评分统计：击杀数 + 最佳连击
      if (G.mode === 'story') {
        G.storyKills = (G.storyKills || 0) + 1;
        if (G.combo > (G.storyComboBest || 0)) G.storyComboBest = G.combo;
      }
      let gained = Math.round((base + Math.round(base * (G.combo - 1) * 0.25)) * (G.doubleScore > 0 ? 2 : 1));
      if (headshot) gained = Math.round(gained * HEADSHOT_SCORE);
      G.score += gained;
      // 积分即货币，但剧情模式没有商店/金钱系统，不累加现金
      if (G.mode !== 'story') G.cash += gained;
      FX.addText(e.x, e.y - 12,
        G.mode === 'story' ? '+' + gained
          : (headshot ? '爆头 ' : '') + '+' + gained + (G.combo > 1 ? ' x' + G.combo : ''),
        headshot ? '#e02929' : (G.combo > 1 ? '#e02929' : '#ffffff'));
      // 概率掉落：血包 / 子弹（剧情模式用不上，掉了反而是干扰）
      if (G.mode !== 'story') rollDrop(e);
      // 精英/BOSS：直接给稀有资源，掉在地上反而容易漏捡
      if (e.elite || e.boss) {
        killer.grenades = Math.min(GRENADE_MAX, killer.grenades + 1);
        killer.armorPlates = Math.min(ARMOR_PLATE_CAP, killer.armorPlates + 1);
        FX.addText(e.x, e.y - 26, (e.boss ? 'BOSS' : '精英') + ' · +1 手雷 +1 护甲板', '#e02929');
        G.toast = (e.boss ? 'BOSS' : '精英') + '击杀';
        G.toastTimer = 2;
      }
    }
  }

  /**
   * 这一次打死人要不要断肢。
   * 基础概率写在武器表的 gib 上；霰弹枪额外按距离加权 —— 贴脸 1.7 倍、中距 1.15 倍、
   * 远处只有 0.5 倍（隔着半个房间还能把腿打飞就不真实了）。
   */
  function rollGib(wdef, e) {
    let chance = wdef.gib || 0;
    if (wdef.pellets > 1) {
      // 霰弹：越近越容易把人整个打散（隔着半个房间还能把腿打飞就不真实了）
      const p = G.player;
      const d = p ? Math.hypot(e.x - p.x, e.y - p.y) : 999;
      chance *= d < 46 ? 1.7 : (d < 90 ? 1.15 : 0.5);
    }
    return Math.random() < Math.min(0.9, chance);
  }

  /** 把敌人的胳膊（霰弹还有可能带头）甩出去。 */
  function gibEnemy(e, wdef) {
    const pal = PALETTE['enemy_' + e.kind] || PALETTE.enemy_gun;
    const style = { cloth: shade(pal.head, 0.78), skin: pal.skin, scale: e.scale || 1 };
    const takeHead = !!wdef.gibHead && Math.random() < 0.55;
    FX.addGibs(e.x, e.y, e.deathDir, takeHead ? 3 : 2, style, takeHead);
    if (takeHead) {
      // 头没了就别画整具尸体，留一地的肢体和血更像"轰碎"
      e.gibbed = true;
      FX.addBlood(e.x, e.y, { x: Math.cos(e.deathDir), y: Math.sin(e.deathDir) }, 14, 1.15);
    } else {
      // 只砍飞胳膊：尸体改成"无手的躯干"，不然地上那只手和身上的手对不上
      e.dismember = true;
      FX.addBlood(e.x, e.y, { x: Math.cos(e.deathDir), y: Math.sin(e.deathDir) }, 8, 1.0);
    }
    Sfx.play('hit');
    FX.kick(2.8, 0.16);
  }

  /** 敌人死亡时概率掉落补给：血包（15%）/ 子弹（25%）。 */
  function rollDrop(e) {
    const r = Math.random();
    if (r < 0.15) {
      // 血包掉落
      const pk = { def: 'medkit', x: e.x, y: e.y, bob: Math.random() * 6.28, vx: 0, vy: 0, rot: 0 };
      W.pickups.push(pk);
    } else if (r < 0.40) {
      // 子弹掉落（当前武器的备弹，按比例补）
      const pk = { def: 'ammo', x: e.x, y: e.y, bob: Math.random() * 6.28, vx: 0, vy: 0, rot: 0 };
      W.pickups.push(pk);
    }
  }

  // 血泊：贴一张随机血迹图（贴花 canvas 上是永久的）
  function bloodPool(x, y, scale) {
    if (W.bloodCount > BLOOD_CAP) return;
    W.bloodCount++;
    const dctx = W.decals.getContext('2d');
    const img = IMG['blood_' + (1 + Math.floor(Math.random() * 6))];
    const s = (img.width || 48) * (scale || 1) * (0.85 + Math.random() * 0.3);
    dctx.save();
    // alpha 压低：地板纹理要透出来，多滩叠在一起才会自然变深，而不是糊成一片死红
    dctx.globalAlpha = 0.58 + Math.random() * 0.22;
    dctx.translate(x, y);
    dctx.rotate(Math.random() * Math.PI * 2);
    // 随机拉扁一点，不然每滩都是正圆，看着像贴纸
    dctx.scale(0.8 + Math.random() * 0.5, 0.8 + Math.random() * 0.5);
    dctx.drawImage(img, -s / 2, -s / 2, s, s);
    dctx.restore();
  }

  // -------------------------------------------------------------- 断肢
  /**
   * 画一截断肢（局部坐标：原点在肢体中心，x 轴沿肢体长边）。
   * 角色本来就是"一个头 + 两只圆手"，所以"胳膊"就是一截袖子加一只圆手，
   * "头"就是那颗圆脑袋 —— 掉在地上的东西和站着的人形状对得上，才不像随机贴图。
   */
  function paintGib(c, g) {
    c.save();
    c.translate(g.x, g.y);
    c.rotate(g.rot);
    if (g.type === 'head') {
      const r = 5.5 * (g.w / 3.4);
      c.fillStyle = 'rgba(0,0,0,0.5)';
      c.beginPath(); c.arc(0, 0, r + 0.9, 0, 6.283); c.fill();
      c.fillStyle = g.cloth;                                     // 头发/帽
      c.beginPath(); c.arc(0, 0, r, 0, 6.283); c.fill();
      c.fillStyle = g.skin;                                      // 脸
      c.beginPath(); c.arc(0, r * 0.26, r * 0.74, 0, 6.283); c.fill();
      c.fillStyle = '#1a141e';                                   // 两只眼睛：一眼就认出这是"头"
      c.beginPath(); c.arc(-r * 0.33, r * 0.2, 0.95, 0, 6.283); c.fill();
      c.beginPath(); c.arc(r * 0.33, r * 0.2, 0.95, 0, 6.283); c.fill();
      c.fillStyle = 'rgba(150,18,32,0.92)';                      // 脖子断口
      c.beginPath(); c.ellipse(0, -r * 0.74, r * 0.6, r * 0.38, 0, 0, 6.283); c.fill();
    } else {
      // 袖子：先画粗一圈黑描边再压上布色，地板暗的时候才看得出轮廓
      c.lineCap = 'round';
      c.strokeStyle = 'rgba(0,0,0,0.5)';
      c.lineWidth = g.w + 1.4;
      c.beginPath();
      c.moveTo(-g.len * 0.44, 0); c.lineTo(g.len * 0.3, 0);
      c.stroke();
      c.strokeStyle = g.cloth;
      c.lineWidth = g.w;
      c.beginPath();
      c.moveTo(-g.len * 0.44, 0); c.lineTo(g.len * 0.3, 0);
      c.stroke();
      // 断口一圈暗红
      c.fillStyle = 'rgba(150,18,32,0.9)';
      c.beginPath(); c.ellipse(-g.len * 0.44, 0, 1.2, g.w * 0.5, 0, 0, 6.283); c.fill();
      // 圆手
      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.beginPath(); c.arc(g.len * 0.5, 0, g.hand + 0.7, 0, 6.283); c.fill();
      c.fillStyle = g.skin;
      c.beginPath(); c.arc(g.len * 0.5, 0, g.hand, 0, 6.283); c.fill();
    }
    c.restore();
  }

  /**
   * 肢体落地：垫一小滩血，再把肢体本身画进贴花层（永久留着）。
   * 和血滴一样走"先飞后落"—— 打死的瞬间地上是干净的，飞了 0.3~0.6s 才砸出痕迹。
   */
  function bakeGib(g) {
    if (!W || !W.decals) return;
    // 血泊受贴花总额度限制（满地都是的时候就不再铺），但肢体本身一定要落到地上，
    // 否则飞到一半凭空消失，看着像 bug。
    if (W.bloodCount <= BLOOD_CAP) {
      W.bloodCount += 0.7;
      bloodPool(g.x + (Math.random() - 0.5) * 4, g.y + (Math.random() - 0.5) * 4,
        0.3 + Math.random() * 0.18);
    }
    const dctx = W.decals.getContext('2d');
    dctx.save();
    dctx.globalAlpha = 0.96;
    paintGib(dctx, g);
    dctx.restore();
  }

  /**
   * 单颗血珠落地留下的小血点。比血泊小得多，靠数量堆出"溅开"的感觉。
   * 每颗血珠只算 0.2 个额度：一枪打死大约 40 颗，按 1:1 记账的话十来个人就到顶了。
   */
  function bloodDot(x, y, r) {
    if (!W || !W.decals) return;
    if (W.bloodCount > BLOOD_CAP) return;
    W.bloodCount += 0.2;
    const dctx = W.decals.getContext('2d');
    dctx.save();
    dctx.globalAlpha = 0.5 + Math.random() * 0.38;
    dctx.fillStyle = Math.random() < 0.4 ? '#7c0c18' : '#a8121f';
    dctx.beginPath();
    dctx.ellipse(x, y, r * (0.7 + Math.random() * 0.8), r * (0.55 + Math.random() * 0.7),
      Math.random() * 3.14, 0, 6.283);
    dctx.fill();
    dctx.restore();
  }

  // 甩出去的血痕
  function bloodStreak(x, y, ang, scale) {
    if (W.bloodCount > BLOOD_CAP) return;
    W.bloodCount++;
    const dctx = W.decals.getContext('2d');
    const img = IMG['blood_streak_' + (1 + Math.floor(Math.random() * 3))];
    const s = (img.width || 48) * (scale || 1.1);
    dctx.save();
    dctx.globalAlpha = 0.85 + Math.random() * 0.12;
    dctx.translate(x, y);
    dctx.rotate(ang + (Math.random() - 0.5) * 0.35);
    dctx.drawImage(img, -s / 2, -s / 2, s, s);
    dctx.restore();
  }

  // 细碎飞沫：几像素的小血点，撒在尸体周围，让地面"脏"起来
  function bloodSpeckle(x, y, ang, n) {
    if (W.bloodCount > BLOOD_CAP) return;
    const dctx = W.decals.getContext('2d');
    for (let i = 0; i < n; i++) {
      const a = ang + (Math.random() - 0.5) * 2.8;
      const r = 8 + Math.random() * 52;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      dctx.fillStyle = Math.random() < 0.35 ? 'rgba(74,8,16,0.85)' : 'rgba(146,18,32,0.8)';
      dctx.beginPath();
      dctx.ellipse(px, py, 0.8 + Math.random() * 2.2, 0.6 + Math.random() * 1.6,
        Math.random() * 3.14, 0, 6.283);
      dctx.fill();
    }
  }

  /**
   * 血迹的"延后落地"队列。
   * 死亡那一帧只喷血（空中的珠子），血泊/血痕按 delay 排队，
   * 0.1~0.5s 后才在地上出现 —— 看起来是"血慢慢淌开"，而不是"砰一下贴个红图"。
   */
  function queueBlood(kind, delay, x, y, a, s, n) {
    if (!W) return;
    if (!W.bloodPending) W.bloodPending = [];
    if (W.bloodPending.length > 320) return;
    W.bloodPending.push({ kind, t: delay, x, y, a: a || 0, s: s || 1, n: n || 0 });
  }

  function updateBloodDecals(dt) {
    const q = W && W.bloodPending;
    if (!q || !q.length) return;
    for (let i = q.length - 1; i >= 0; i--) {
      const b = q[i];
      b.t -= dt;
      if (b.t > 0) continue;
      q.splice(i, 1);
      if (b.kind === 'pool') bloodPool(b.x, b.y, b.s);
      else if (b.kind === 'streak') bloodStreak(b.x, b.y, b.a, b.s);
      else bloodSpeckle(b.x, b.y, b.a, b.n);
    }
  }

  /** 一次死亡的全部血迹：先喷血雾/血珠，落地与血泊按节奏延后出现。 */
  function spillBlood(x, y, dir, B, isPlayer) {
    const ang = Math.atan2(dir.y, dir.x);
    const sc = B.scale * (isPlayer ? 1.25 : 1);
    // 1) 喷：朝子弹方向一股主血线，背后再溅一层反冲的细雾
    FX.addBlood(x, y, dir, B.spray, sc);
    FX.addBlood(x, y, { x: -dir.x * 0.6, y: -dir.y * 0.6 }, Math.round(B.spray * 0.4), sc * 0.7);
    // 2) 落地：脚下一滩最早出现（人倒下先积血），溅开的血泊再晚一点
    queueBlood('pool', 0.10 + Math.random() * 0.08,
      x + (Math.random() - 0.5) * 5, y + (Math.random() - 0.5) * 5, 0, 0.92 * sc);
    for (let i = 0; i < B.pools; i++) {
      const a = ang + (Math.random() - 0.5) * 2.6;
      const r = (6 + Math.random() * 34) * sc;
      queueBlood('pool', 0.20 + Math.random() * 0.34,
        x + Math.cos(a) * r, y + Math.sin(a) * r, 0, (0.16 + Math.random() * 0.26) * sc);
    }
    // 3) 拖拽血痕：顺着受力方向甩出去，比血泊再晚一拍
    for (let i = 0; i < B.streaks; i++) {
      const a = ang + (Math.random() - 0.5) * 1.3;
      const r = (8 + Math.random() * 22) * sc;
      queueBlood('streak', 0.16 + Math.random() * 0.3,
        x + Math.cos(a) * r, y + Math.sin(a) * r, a, 0.85 + Math.random() * 0.7 * sc, 0);
    }
    // 4) 碎血点最后落（飞得最远、最晚着地）
    queueBlood('speckle', 0.34 + Math.random() * 0.26, x, y, ang, 0, Math.round(B.speckles * sc));
  }

  // ---------------------------------------------------------------- 玩家更新
  function updatePlayer(dt) {
    const p = G.player;
    if (!p.alive) {
      p.deathT += dt;
      // 死了自然收回瞄准：否则躺着的时候画面还卡在放大状态
      p.aimT = Math.max(0, p.aimT - dt * 4);
      p.aiming = p.aimT > 0.5;
      return;
    }

    // 朝向鼠标：现在鼠标只给方向（准心固定在屏幕正中），所以直接读屏幕偏移
    const ad = aimDir();
    if (ad) { p.facing.x = ad.x; p.facing.y = ad.y; }

    // 瞄准（ADS）：按住右键抬枪。手上是近战 / 正在用血包护甲板时不算；手持手雷也可以瞄
    const gunDef = p.weapon ? WEAPONS[p.weapon] : null;
    const canAim = !!(gunDef && !gunDef.melee && !p.healing && !p.plating) || p.grenadeHeld;
    const wantAim = canAim && mouse.right;
    const aimRate = wantAim ? (1 / AIM_IN) : -(1 / AIM_OUT);
    p.aimT = clamp(p.aimT + aimRate * dt, 0, 1);
    p.aiming = p.aimT > 0.5;

    // 移动
    let ix = 0, iy = 0;
    if (keys['a'] || keys['arrowleft']) ix -= 1;
    if (keys['d'] || keys['arrowright']) ix += 1;
    if (keys['w'] || keys['arrowup']) iy -= 1;
    if (keys['s'] || keys['arrowdown']) iy += 1;
    const il = Math.hypot(ix, iy);
    if (il > 0) { ix /= il; iy /= il; }

    if (p.stun > 0) {
      p.stun -= dt;
      p.vx *= 0.90; p.vy *= 0.90;
    } else {
      // 移速 = 基础 × 疾跑倍率 × 瞄准减速（端枪时按 aimT 平滑压下来）× 剧情模式加成
      const spd = PLAYER_SPEED * speedMul(p) * (1 - p.aimT * (1 - AIM_MOVE_MUL))
        * (G.mode === 'story' ? STORY_MOVE_MUL : 1);
      p.vx = ix * spd;
      p.vy = iy * spd;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    resolveCircle(W, p, ACTOR_R, solidRects(W, true));

    // 撞门：走到门口自动把门撞开（迈阿密式突入）。不这么做的话，子弹打光就
    // 连楼门都进不去了 —— 玩家必须永远能用身体推门，而不是只能开枪打门。
    for (const d of W.doors) {
      if (d.open) continue;
      if (dist2(p.x, p.y, d.x, d.y) < 26 * 26) {
        breakDoor(d, { x: d.x, y: d.y });
        break;
      }
    }

    // 脚步
    if (il > 0 && p.stun <= 0) {
      p.stepTimer -= dt;
      if (p.stepTimer <= 0) { p.stepTimer = 0.31; Sfx.play('step'); }
    }

    // 冷却
    if (p.cooldown > 0) p.cooldown -= dt;
    if (p.throwCd > 0) p.throwCd -= dt;
    if (p.punchT > 0) p.punchT -= dt;   // 空手出拳的前伸动画
    if (p.swingT > 0) p.swingT -= dt;   // 近战挥砍动画（刀/棍）
    // 换枪动画：倒计时，走完才恢复持枪状态
    if (p.swapT > 0) {
      p.swapT -= dt;
      if (p.swapT <= 0) { p.swapT = 0; p.swapTotal = 0; }
    }
    // 手持物切换动画：倒计时（医疗包/护甲板/切回枪）
    if (p.equipT > 0) {
      p.equipT -= dt;
      if (p.equipT <= 0) { p.equipT = 0; p.equipTotal = 0; }
    }
    if (p.reload > 0) {
      p.reload -= dt;
      if (p.weapon === 'shotgun' && p.shellReload > 0) {
        // 逐发装填：当前这一发塞完了就 +1 发，继续塞下一发，直到弹匣满 / 备弹耗尽
        p.shellReload -= dt;
        if (p.shellReload <= 0) {
          p.ammo += 1;
          p.reserve -= 1;
          const mag = gunStat('shotgun', 'mag');
          if (p.ammo < mag && p.reserve > 0) {
            p.shellReload += SHELL_RELOAD_TIME;   // 还有下一发
            reloadFx(p);
          } else {
            p.shellReload = 0;
            // 装填结束那一拍
            Sfx.play('magin');
            FX.kick(1.1, 0.06);
            FX.addParticles(p.x + p.facing.x * 12, p.y + p.facing.y * 12, 3, '#cfd6e2', 26, 0.16);
          }
        }
      }
      if (p.reload <= 0) {
        p.reload = 0;
        p.reloadTotal = 0;
        p.shellReload = 0;
        p.shellTotal = 0;
        // 换弹完成：从备弹补满弹匣（散弹枪已经逐发塞过了，这里只对弹匣枪生效）
        if (p.weapon && !WEAPONS[p.weapon].melee && p.weapon !== 'shotgun') {
          const need = gunStat(p.weapon, 'mag') - p.ammo;
          const take = Math.min(need, p.reserve);
          p.ammo += take;
          p.reserve -= take;
          // 弹匣拍到位那一拍：闷响 + 机匣位置崩出两点火星。
          // 真录音里本来就含"拍进去"这一下，用录音时就不再叠合成的"咔"。
          if (!p.reloadSampled) Sfx.play('magin');
          FX.kick(1.1, 0.06);
          FX.addParticles(p.x + p.facing.x * 12, p.y + p.facing.y * 12, 3, '#cfd6e2', 26, 0.16);
        }
      }
    }
    p.kick = Math.max(0, p.kick - dt * 55);

    // 数字键直达：1 主武器 / 2 副武器 / 3 血包 / 4 护甲板（一次到位，不再 toggle）
    if (pressed['1']) selectHeld('main');
    if (pressed['2']) selectHeld('side');
    if (pressed['3']) selectHeld('medkit');
    if (pressed['4']) selectHeld('plate');

    // Q 也可以切主/副武器（老习惯）
    if (pressed['q']) swapWeapon();

    // 手雷（G）：切换手持手雷，切出后左键丢、右键瞄准
    if (pressed['g']) toggleGrenade();

    // 扔枪（F）：把手上这把砸出去（砸中人当场放倒，落地还能捡回来）
    if (pressed['f']) throwWeapon();

    // 攻击（按住/单击）
    const fireHeld = mouse.down || keys['j'];
    const fireTap = pressed['j'] || G.fireTap;
    G.fireTap = false;

    // 血包治疗：按 3 切到血包后，长按左键 2 秒读条回血
    if (p.healing) {
      if (fireHeld) {
        p.healCharge += dt;
        if (p.healCharge >= HEAL_TIME) {
          p.healing = false;
          p.healCharge = 0;
          if (p.hp >= HP_MAX) {                 // 读条读满了但血已经满：血包不浪费
            G.toast = '血量已满';
            G.toastTimer = 1.2;
          } else {
            p.medkits--;                        // 消耗一个血包
            p.hp = Math.min(HP_MAX, p.hp + 50);
            FX.addText(p.x, p.y - 14, '+50 HP', '#7fdca0');
            Sfx.play('pickup');
          }
          startEquip(0.18, true);               // 用完切回枪：过渡动画 + 重置扳机
        }
      } else if (p.healCharge > 0) {
        // 松开：读条暂停但不清零（点几下也能慢慢攒满，不用一次按住 2 秒）
        p.healCharge = Math.max(0, p.healCharge - dt * 1.0);
      }
    }
    // 护甲板装配：按 4 取出后，长按左键 1 秒装一块
    else if (p.plating) {
      if (fireHeld) {
        p.plateCharge += dt;
        if (p.plateCharge >= PLATE_TIME) {
          p.plating = false;
          p.plateCharge = 0;
          if (armorFull(p)) {                    // 甲已经满了：不浪费护甲板
            G.toast = '护甲已满';
            G.toastTimer = 1.2;
          } else {
            p.armorPlates--;                     // 消耗一块护甲板
            p.armor = Math.min(armorMax(p), p.armor + armorPerSlot(p));
            syncArmorSlots(p);
            FX.addText(p.x, p.y - 14, '+护甲', '#c8c8d0');
            Sfx.play('pickup');
          }
          startEquip(0.18, true);               // 用完切回枪：过渡动画 + 重置扳机
        }
      } else if (p.plateCharge > 0) {
        // 松开：读条缓慢回退，但保持持板状态（可重新长按接着装）
        p.plateCharge = Math.max(0, p.plateCharge - dt * 1.2);
      }
    } else if (p.grenadeHeld) {
      // 手持手雷：左键单击（fireTap）丢出，朝准心方向
      if (fireTap) throwGrenade();
    } else {
      // 有枪就开枪，空手就出拳：按住（fireHeld）或单击（fireTap）都触发。
      // 所有枪械（含手枪/霰弹枪这类半自动）长按都会按各自 fireRate 持续射击 ——
      // 手机上"一直推着摇杆"就应持续开火，射速仍由 p.cooldown（= fireRate）限制。
      //
      // 扳机就绪（armed）：用完护甲板/医疗包切回枪后 armed=false，此时"手指还按着"
      // （fireHeld 恒真）不该再开枪；必须重新按一下（fireTap 上升沿）才重新武装并开火，
      // 避免误开火浪费子弹。
      if (fireTap) p.armed = true;
      if ((fireHeld || fireTap) && p.armed) {
        // 换弹动画期间扣不动扳机（p.cooldown 也压着，这里是显式的一道锁）
        if (p.cooldown <= 0 && p.reload <= 0 && p.swapT <= 0) playerAttack();
      }
    }

    // 拾取：血包/弹药走近就自动捡（与是否持枪无关）；武器才需要按 E 或空手。
    // 按 E 且靠近交互物（补给点/升级站）时，E 让给"开 UI"，不抢拾取。
    autoPickupConsumables();
    if (pressed['e'] && !interactTarget()) tryPickup(true);
    else if (!pressed['e']) tryPickup(false);

    // 门
    updateDoors(dt);
  }

  /**
   * 换弹动画的"拔弹匣"那一拍（上单装填不涉及退壳，散弹枪这里不甩任何东西）。
   * 手枪/冲锋枪甩一整个旧弹匣；散弹枪逐发塞弹时只播"咔"塞弹声，空壳在开火那一下已经退掉了。
   * 手动换弹和打空自动换弹共用，不然两条路只有一条有动画。
   *
   * 声音：能用真录音就整段放完（拔弹匣 + 拍上新弹匣一次到位，`p.reloadSampled` 记下来，
   * 换弹结束那一拍就不再补合成的"咔"）；采样没准备好才退回两声合成的。
   */
  function reloadFx(p) {
    const ang = Math.atan2(p.facing.y, p.facing.x);
    if (p.weapon === 'shotgun') {
      Sfx.play('shellin');   // 塞弹的"咔"一声，不退壳（壳在开火时已退）
      p.reloadSampled = false;
    } else {
      FX.addClip(p.x + p.facing.x * 9 + Math.cos(ang + Math.PI / 2) * 4,
                 p.y + p.facing.y * 9 + Math.sin(ang + Math.PI / 2) * 4, ang);
      p.reloadSampled = Sfx.play('reload') === true;
      if (!p.reloadSampled) Sfx.play('magout');
    }
  }

  /**
   * 手动换弹（R）。弹匣没满、备弹还有才能换；治疗/装护甲时不让换。
   * 打空弹匣时 playerAttack 里也会自动走一遍同样的流程。
   * 散弹枪是逐发装填：每塞一发一个间隔，塞满即止（可塞到一半停）。
   */
  function startReload() {
    const p = G.player;
    if (!p || !p.alive || !p.weapon) return false;
    const def = WEAPONS[p.weapon];
    if (def.melee) return false;
    if (p.reload > 0) return false;
    if (p.healing || p.plating) {
      G.toast = '放下血包/护甲板才能换弹';
      G.toastTimer = 1.2;
      return false;
    }
    const mag = gunStat(p.weapon, 'mag');
    if (p.ammo >= mag) { Sfx.play('empty'); return false; }
    if (p.reserve <= 0) {
      Sfx.play('empty');
      G.toast = '没有备弹了';
      G.toastTimer = 1.2;
      return false;
    }
    if (p.weapon === 'shotgun') {
      // 逐发装填：当前这一发开始计时，塞完一发 +1，直到弹匣满或备弹耗尽
      p.shellTotal = p.shellReload = SHELL_RELOAD_TIME;
      p.reloadTotal = SHELL_RELOAD_TIME * Math.min(mag - p.ammo, p.reserve);
      p.reload = p.reloadTotal;
      p.cooldown = Math.max(p.cooldown, SHELL_RELOAD_TIME);
      reloadFx(p);
      return true;
    }
    p.reload = Math.max(0.15, def.reload * reloadMul(p));
    p.reloadTotal = p.reload;              // 准心进度环按这个算百分比
    p.cooldown = Math.max(p.cooldown, p.reload);
    reloadFx(p);
    return true;
  }

  /**
   * 触发一次"切换手持物"动画：医疗包/护甲板/切回枪都用它。
   * 让手上的家伙有个短暂的"收起→掏出"过渡，而不是瞬切。期间锁扳机。
   */
  function startEquip(dur, resetTrigger) {
    const p = G.player;
    if (!p) return;
    p.equipTotal = p.equipT = (dur == null ? 0.18 : dur);
    p.cooldown = Math.max(p.cooldown, p.equipT);   // 切换期间扣不动扳机
    // 切回枪的场景：要求玩家重新按一下开火键才恢复开火，避免"手指还按着"就误开火。
    if (resetTrigger) p.armed = false;
  }

  /**
   * 数字键直达手持物：1 主武器 / 2 副武器 / 3 血包 / 4 护甲板。
   * 不做 toggle —— 按一下就到位，想收起来按 1 回枪。
   * 也不拦"血满/甲满"：满血满甲一样能切出来，真用不掉时再提示。
   */
  function selectHeld(kind) {
    const p = G.player;
    if (!p || !p.alive) return false;

    if (kind === 'main') {
      const wasUtility = p.healing || p.plating || p.grenadeHeld;
      p.healing = false; p.healCharge = 0;
      p.plating = false; p.plateCharge = 0;
      p.grenadeHeld = false;
      if (p.curSlot === 'side' && p.side) swapWeapon();   // 手上是副武器 → 换回主武器
      if (wasUtility) { Sfx.play('pickup'); startEquip(0.18, true); }   // 从消耗品切回枪：补个过渡 + 重置扳机
      return true;
    }

    if (kind === 'side') {
      if (p.curSlot === 'side') {                    // 已经在副武器上，只需放下消耗品
        if (p.healing || p.plating || p.grenadeHeld) {
          p.healing = false; p.healCharge = 0;
          p.plating = false; p.plateCharge = 0;
          p.grenadeHeld = false;
          Sfx.play('pickup');
          startEquip(0.18, true);
        }
        return true;
      }
      if (!p.side) {
        G.toast = '没有副武器';
        G.toastTimer = 1.2;
        return false;
      }
      const wasUtility = p.healing || p.plating || p.grenadeHeld;
      p.healing = false; p.healCharge = 0;
      p.plating = false; p.plateCharge = 0;
      p.grenadeHeld = false;
      swapWeapon();
      if (wasUtility) startEquip(0.18, true);        // 从消耗品切到副武器：补个过渡 + 重置扳机
      return true;
    }

    if (kind === 'medkit') {
      if (p.medkits <= 0) {
        G.toast = '没有血包';
        G.toastTimer = 1.2;
        return false;
      }
      const wasAlready = p.healing;
      p.plating = false; p.plateCharge = 0;
      p.grenadeHeld = false;
      p.healing = true;
      if (!wasAlready) { Sfx.play('pickup'); startEquip(0.18); }   // 掏出医疗包：过渡
      return true;
    }

    if (kind === 'plate') {
      if (p.armorPlates <= 0) {
        G.toast = '没有护甲板';
        G.toastTimer = 1.2;
        return false;
      }
      const wasAlready = p.plating;
      p.healing = false; p.healCharge = 0;
      p.grenadeHeld = false;
      p.plating = true;
      if (!wasAlready) { Sfx.play('pickup'); startEquip(0.18); }   // 掏出护甲板：过渡
      return true;
    }
    return false;
  }

  /** 主武器 ⇄ 副武器（Q）。换弹中切枪会取消换弹，治疗/装护甲时切枪即取消。 */
  function swapWeapon() {
    const p = G.player;
    if (!p || !p.alive) return false;
    if (!p.side && !p.weapon) return false;
    if (p.swapT > 0) return false;            // 正在换枪，别连按
    if (p.healing || p.plating) {
      p.healing = false; p.healCharge = 0;
      p.plating = false; p.plateCharge = 0;
    }
    p.grenadeHeld = false;                    // 切枪顺手放下手雷
    const cur = { weapon: p.weapon, ammo: p.ammo, reserve: p.reserve };
    let next = null;
    if (p.side) {
      p.weapon = p.side.weapon;
      p.ammo = p.side.ammo;
      p.reserve = p.side.reserve || 0;
      p.side = cur.weapon ? cur : null;
      p.curSlot = (p.curSlot === 'side') ? 'main' : 'side';
      next = p.weapon;
    } else {
      // 背上空的：把手上的背过去（空手状态，还能再按 Q 拿回来）
      p.weapon = null; p.ammo = 0; p.reserve = 0;
      p.side = cur;
      p.curSlot = 'main';
      next = null;
    }
    p.reload = 0;
    p.reloadTotal = 0;
    p.shellReload = 0;      // 切枪取消散弹枪的逐发装填
    p.shellTotal = 0;
    // 换枪动画：掏出下一把的时长随枪而定（重枪更慢），期间扣不动扳机
    const def = next ? WEAPONS[next] : (cur.weapon ? WEAPONS[cur.weapon] : null);
    p.swapTotal = p.swapT = def ? (def.drawTime || 0.2) : 0.2;
    p.cooldown = Math.max(p.cooldown, p.swapT);
    Sfx.play('pickup');
    return true;
  }

  /**
   * 把地上这把枪里的子弹并进对应槽位的备弹（同型号拾取 → 变备弹，不占槽位）。
   * 返回是否真的吸掉了（备弹满了就留在地上）。
   */
  function absorbAmmo(p, pk, toSide) {
    const def = WEAPONS[pk.def];
    if (!def || def.melee) return false;
    const slot = toSide ? p.side : p;
    if (!slot) return false;
    // 剧情模式没有备弹：同型号的枪只能"把子弹并进弹匣"，捡完这枪就空了
    if (G.mode === 'story') {
      const mag = gunStat(pk.def, 'mag');
      const clip = pk.ammo !== undefined ? pk.ammo : mag;
      const cur = slot.ammo || 0;
      if (cur >= mag) return false;
      const add = Math.min(mag - cur, clip);
      if (add <= 0) return false;
      slot.ammo = cur + add;
      W.pickups.splice(W.pickups.indexOf(pk), 1);
      FX.addText(p.x, p.y - 12, '+' + add, '#e02929');
      Sfx.play('pickup');
      return true;
    }
    const have = slot.reserve || 0;
    if (have >= def.reserveMax) return false;
    // 枪里剩多少给多少，再加它自带的那份备弹（敌人掉的枪已在掉落时带上备弹）
    const mag = gunStat(pk.def, 'mag');
    const clip = pk.ammo !== undefined ? pk.ammo : mag;
    const spare = pk.reserve !== undefined ? pk.reserve : 0;
    let add = clip + spare;
    if (add <= 0) add = mag;
    slot.reserve = Math.min(def.reserveMax, have + add);
    const got = slot.reserve - have;
    W.pickups.splice(W.pickups.indexOf(pk), 1);
    FX.addText(p.x, p.y - 12, '+' + got + ' 备弹', '#e02929');
    Sfx.play('pickup');
    return true;
  }

  /**
   * 拾取地上的武器。
   * 规则（塔科夫式）：
   *   - 跟手上那把同型号 → 并成备弹，不占槽位
   *   - 跟背上那把同型号 → 并成副武器备弹
   *   - 空手 → 直接上手
   *   - 手上有、背上空 → 进副武器槽（"多捡一把"）
   *   - 两个槽都满 → 走近不自动抢，按 E 才换掉背上的
   */
  function tryPickup(explicit) {
    const p = G.player;
    let best = null, bd = 26 * 26;
    for (const pk of W.pickups) {
      if (pk.def === 'medkit' || pk.def === 'ammo') continue;  // 消耗品走 autoPickupConsumables
      const d = dist2(p.x, p.y, pk.x, pk.y);
      if (d < bd) { bd = d; best = pk; }
    }
    if (!best) return;
    const def = WEAPONS[best.def];
    if (!def) return;

    // 剧情模式只有"手上这一把"：走过去不会自动抢（免得踩过一把空枪就把满弹的换掉），
    // 同型号自动把子弹并进弹匣；换别的枪要按 E。
    if (G.mode === 'story') {
      if (p.weapon === best.def) { absorbAmmo(p, best, false); return; }
      if (p.weapon && !explicit) return;
      const magS = gunStat(best.def, 'mag');
      const ammoS = best.ammo !== undefined ? best.ammo : magS;
      const spot = dropSpot(p);          // 旧枪掉在身后一点，别和新捡的那把叠成一堆
      if (p.weapon) {
        const oldPk = makePickup(p.weapon, spot.x, spot.y);
        oldPk.ammo = p.ammo;
        oldPk.reserve = 0;
        W.pickups.push(oldPk);
      }
      // 背上那把（按 Q 背起来的）也要掉回地上 —— 剧情模式捡起新枪时 p.side 会被清空，
      // 不在这儿补一把，背着的枪就凭空消失了（空手捡枪 = 白丢一把枪）。
      if (p.side) {
        const sidePk = makePickup(p.side.weapon, spot.x, spot.y);
        sidePk.ammo = p.side.ammo;
        sidePk.reserve = 0;
        W.pickups.push(sidePk);
      }
      p.weapon = best.def;
      p.ammo = ammoS;
      p.reserve = 0;
      p.side = null;
      p.curSlot = 'main';
      p.reload = 0;
      p.reloadTotal = 0;
      p.cooldown = 0;
      W.pickups.splice(W.pickups.indexOf(best), 1);
      Sfx.play('pickup');
      return;
    }

    // 同型号：优先并成备弹；备弹已经满了就让它进空槽位（两把同款也能背一把）
    if (p.weapon === best.def && absorbAmmo(p, best, false)) return;
    if (p.side && p.side.weapon === best.def && absorbAmmo(p, best, true)) return;

    // 两个槽都占着：自动走过去不抢，必须按 E 才换背上的
    if (p.weapon && p.side && !explicit) return;

    // 枪里剩多少 + 它自带的那份备弹（敌人掉的枪已在掉落时带上备弹）
    const mag = gunStat(best.def, 'mag');
    const ammo = best.ammo !== undefined ? best.ammo : mag;
    const spare = best.reserve !== undefined ? best.reserve : 0;
    // 剧情模式没有备弹（枪里剩多少就是多少），挑战模式照旧带走那份备弹
    const reserve = G.mode === 'story' ? 0 : Math.min(def.reserveMax, spare);
    if (!p.weapon) {
      p.weapon = best.def;
      p.ammo = ammo;
      p.reserve = reserve;
      p.cooldown = 0;
      p.reload = 0;
      p.reloadTotal = 0;
      FX.addText(p.x, p.y - 12, def.name, '#e02929');
    } else if (!p.side) {
      p.side = { weapon: best.def, ammo: ammo, reserve: reserve };
      FX.addText(p.x, p.y - 12, '副武器 ' + def.name, '#e02929');
    } else {
      // 换掉背上的：旧枪原地掉回地上（子弹一起带走，不凭空消失）
      const oldPk = makePickup(p.side.weapon, p.x, p.y);
      oldPk.ammo = p.side.ammo;
      oldPk.reserve = p.side.reserve;
      W.pickups.push(oldPk);
      p.side = { weapon: best.def, ammo: ammo, reserve: reserve };
      FX.addText(p.x, p.y - 12, '换上副武器 ' + def.name, '#e02929');
    }
    W.pickups.splice(W.pickups.indexOf(best), 1);
    Sfx.play('pickup');
  }

  /** 当前散射（度）：腰射散得离谱，瞄准收得很紧，中间按 aimT 平滑过渡。 */
  function spreadDeg(p) {
    const pp = p || (G && G.player);
    const base = (pp && pp.weapon) ? gunStat(pp.weapon, 'spread') : 0;
    const hip = base * HIP_SPREAD_MUL;
    const aim = base * AIM_SPREAD_MUL;
    const t = pp ? clamp(pp.aimT, 0, 1) : 0;
    return hip + (aim - hip) * t;
  }

  function playerAttack() {
    const p = G.player;
    if (p.reload > 0) return;         // 换弹动画没走完，扳机扣不动
    if (p.swapT > 0) return;          // 换枪动画没走完，同样扣不动
    // 空手 = 拳头（FIST），枪扔了也能贴脸打
    const def = p.weapon ? WEAPONS[p.weapon] : FIST;
    if (def.melee) {
      p.cooldown = def.fireRate;
      Sfx.play(def.sound);
      // 挥砍动画：每一刀左右交替，避免连续挥击像在"抖"
      p.swingTotal = p.swingT = (SWING_TIME[p.weapon] || SWING_DEFAULT);
      p.swingDir = -(p.swingDir || 1);
      if (!p.weapon) p.punchT = PUNCH_TIME;   // 空手：拳头走另一套前伸动作
      meleeSwing(p, def, true);
      return;
    }
    if (p.ammo <= 0) {
      // 自动换弹（从备弹取；备弹耗尽则空仓）
      if (p.reload <= 0) {
        if (p.reserve > 0) {
          if (p.weapon === 'shotgun') {
            // 逐发装填：自动换弹也走这一套
            p.shellTotal = p.shellReload = SHELL_RELOAD_TIME;
            p.reloadTotal = SHELL_RELOAD_TIME * Math.min(gunStat('shotgun', 'mag'), p.reserve);
            p.reload = p.reloadTotal;
            p.cooldown = Math.max(p.cooldown, SHELL_RELOAD_TIME);
          } else {
            p.reload = Math.max(0.15, def.reload * reloadMul(p));
            p.reloadTotal = p.reload;
            p.cooldown = Math.max(p.cooldown, p.reload);   // 换弹期间锁死扳机
          }
          reloadFx(p);
        } else {
          Sfx.play('empty');
          p.cooldown = 0.3;
        }
      }
      return;
    }
    p.ammo--;
    // 射击间隔：射速技能加成；进化后的霰弹枪是半自动（更快）
    const rate = gunStat(p.weapon, 'fireRate') * fireRateMul(p);
    p.cooldown = Math.max(0.04, rate);
    Sfx.play(def.sound);
    // 后坐力：冲锋枪后坐力大，画面震动 + 枪口 kick 更猛
    FX.kick(def.shake, 0.16);
    FX.flash = 0.5;
    p.kick = def.kick || 6;
    emitNoise(p.x, p.y, def.noise || 520);
    const base = Math.atan2(p.facing.y, p.facing.x);
    // 散射：按"腰射 / 瞄准"决定，冲锋枪腰射散得最夸张；红外激光会整体收紧
    const deg = spreadDeg(p);
    const pellets = gunStat(p.weapon, 'pellets');
    const range = gunStat(p.weapon, 'range');
    // 双持：左右手各出一发，枪口在面向法线上左右错开
    const dual = gunEvolved(p.weapon) && DUAL_GUNS[p.weapon];
    const nx = -Math.sin(base), ny = Math.cos(base);
    for (let i = 0; i < pellets; i++) {
      const off = dual ? (i === 0 ? -3.2 : 3.2) : 0;
      const a = base + (Math.random() - 0.5) * 2 * deg * Math.PI / 180;
      castShot({
        x: p.x + p.facing.x * 12 + nx * off,
        y: p.y + p.facing.y * 12 + ny * off
      }, a, range, p);
    }
    // 冲锋枪：后坐力让准心持续上抬（视觉上 kick 更大）
    if (gunStat(p.weapon, 'auto')) p.kick = (def.kick || 6) * 1.4;

    // 散弹枪：打一发退一颗空弹壳（泵动/半自动都是打完才退壳，换弹时不再退）
    if (p.weapon === 'shotgun') {
      const side = base + Math.PI / 2;
      FX.addShell(p.x + p.facing.x * 8 + Math.cos(side) * 4,
                  p.y + p.facing.y * 8 + Math.sin(side) * 4, base);
      Sfx.play('shellout');
    }
  }

  /**
   * 走近自动拾取消耗品（血包 / 弹药）。
   * 单独一轮扫描，而不是复用 tryPickup 的"最近那个"——
   * 敌人死时会在原地同时掉下枪 + 血包，枪往往更近，一旦拿"最近那个"去处理，
   * 手里有枪就直接 return，血包永远捡不起来（这就是"按4拿不出血包"的真凶）。
   */
  function autoPickupConsumables() {
    const p = G.player;
    if (!p || !p.alive || !W) return;
    const R2 = 26 * 26;
    for (let i = W.pickups.length - 1; i >= 0; i--) {
      const pk = W.pickups[i];
      if (pk.def !== 'medkit' && pk.def !== 'ammo') continue;
      if (dist2(p.x, p.y, pk.x, pk.y) > R2) continue;
      if (pk.def === 'medkit') {
        p.medkits++;
        W.pickups.splice(i, 1);
        FX.addText(p.x, p.y - 12, '+血包', '#7fdca0');
        Sfx.play('pickup');
      } else if (applyPickup(p, 'ammo')) {
        W.pickups.splice(i, 1);
        Sfx.play('pickup');
      }
    }

    // 地上有跟自己同型号的枪 → 直接并成备弹（这句是"捡起已装备的武器变备弹"）
    for (let i = W.pickups.length - 1; i >= 0; i--) {
      const pk = W.pickups[i];
      if (pk.def === 'medkit' || pk.def === 'ammo') continue;
      if (dist2(p.x, p.y, pk.x, pk.y) > R2) continue;
      if (p.weapon === pk.def) absorbAmmo(p, pk, false);
      else if (p.side && p.side.weapon === pk.def) absorbAmmo(p, pk, true);
    }
  }

  /**
   * 应用消耗品掉落：弹药补备弹。
   * 手上是近战/空手时，弹药补给背上的枪；两个都没有就吃不下（留在地上）。
   * 返回 true 表示吃下了。
   */
  function applyPickup(p, kind) {
    if (kind !== 'ammo') return false;
    let slot = null;
    if (p.weapon && !WEAPONS[p.weapon].melee) slot = p;
    else if (p.side && !WEAPONS[p.side.weapon].melee) slot = p.side;
    if (!slot) return false;
    const def = WEAPONS[slot.weapon];
    const add = Math.round(def.reserveMax * 0.3);
    const have = slot.reserve || 0;
    if (have >= def.reserveMax) return false;
    slot.reserve = Math.min(def.reserveMax, have + add);
    FX.addText(p.x, p.y - 12, '+弹', '#e02929');
    return true;
  }

  function updateDoors(dt) {
    const p = G.player;
    for (const d of W.doors) {
      if (d.open) { d.t += dt; continue; }
      const dx = d.x - p.x, dy = d.y - p.y;
      const dd = Math.hypot(dx, dy);
      if (dd > 34) continue;
      const spd = Math.hypot(p.vx, p.vy);
      if (spd < 20) continue;
      const dot = (p.vx / spd) * (dx / dd) + (p.vy / spd) * (dy / dd);
      if (dot < 0.55) continue;
      d.open = true;
      d.t = 0;
      W._solidDirty = true;
      Sfx.play('door');
      emitNoise(d.x, d.y, 210);
    }
  }

  // ---------------------------------------------------------------- 敌人更新
  function updateEnemy(e, dt) {
    if (!e.alive) { e.deadT += dt; return; }
    const K = ENEMY_KIND[e.kind];
    const p = G.player;
    if (e.stun > 0) {
      e.stun -= dt;
      e.vx *= 0.9; e.vy *= 0.9;
      e.x += e.vx * dt; e.y += e.vy * dt;
      resolveCircle(W, e, ACTOR_R, solidRects(W, true));
      return;
    }
    if (e.attackCd > 0) e.attackCd -= dt;
    if (e.swingT > 0) e.swingT -= dt;      // 近战挥砍动画

    const dToP = Math.hypot(p.x - e.x, p.y - e.y);
    const angToP = Math.atan2(p.y - e.y, p.x - e.x);
    let sees = false;
    if (p.alive && dToP <= K.view) {
      const facingAngle = e.kind === 'melee' ? e.facing : e.facing;
      if (Math.abs(angDiff(angToP, facingAngle)) <= ALERT_CONE * Math.PI / 180) {
        if (lineClear(e.x, e.y, p.x, p.y)) sees = true;
      }
    }

    if (sees) {
      e.seeTimer += dt;
      e.lostTimer = 0;
      e.lastSeen.x = p.x; e.lastSeen.y = p.y;
      if (e.seeTimer >= K.reaction && e.state !== 'chase') {
        e.state = 'chase';
        FX.addText(e.x, e.y - 14, '!', '#ff5a5a');
      }
    } else {
      e.seeTimer = 0;
      if (e.state === 'chase') {
        e.lostTimer += dt;
        // 波次猎杀敌人：永远追踪玩家当前位置，不放弃
        if (e.hunt) {
          e.lastSeen.x = p.x; e.lastSeen.y = p.y;
        } else if (e.lostTimer > 1.6) {
          e.state = 'investigate';
          e.target.x = e.lastSeen.x; e.target.y = e.lastSeen.y;
          e.investigateTimer = 2.2;
        }
      }
    }

    let mx = 0, my = 0;
    switch (e.state) {
      case 'idle': {
        e.thinkTimer -= dt;
        if (e.thinkTimer <= 0) {
          e.thinkTimer = 1.6 + Math.random() * 2.2;
          if (Math.random() < 0.7) {
            pickPatrol(e);
            e.state = 'patrol';
          }
        }
        break;
      }
      case 'patrol': {
        const d = Math.hypot(e.target.x - e.x, e.target.y - e.y);
        if (d < 8) {
          e.state = 'idle';
          e.thinkTimer = 1.2 + Math.random() * 2.0;
        } else {
          mx = (e.target.x - e.x) / d;
          my = (e.target.y - e.y) / d;
        }
        break;
      }
      case 'investigate': {
        const d = Math.hypot(e.target.x - e.x, e.target.y - e.y);
        e.investigateTimer -= dt;
        if (d < 12 || e.investigateTimer <= 0) {
          e.state = 'idle';
          e.thinkTimer = 1.0 + Math.random() * 1.6;
          e.path = null;
        } else {
          // 声源/最后目击点可能隔着墙，走 A*
          pushDoor(e);              // 路被门挡住时自己推开（会发出声音，但不会惊动同伴之外的东西）
          const st = steerTo(e, e.target.x, e.target.y, dt);
          if (st) { mx = st.x; my = st.y; }
          else { mx = (e.target.x - e.x) / d; my = (e.target.y - e.y) / d; }
        }
        break;
      }
      case 'chase': {
        if (sees) {
          e.path = null;                 // 看得见就直接扑，别绕远路
          if (e.kind === 'melee') {
            // 近战：逼近时加一点侧移，不做直线靶子
            if (dToP > K.attackRange) {
              const wob = Math.sin((e.bob += dt * 2.2)) * 0.32;
              mx = Math.cos(angToP) - Math.sin(angToP) * wob;
              my = Math.sin(angToP) + Math.cos(angToP) * wob;
            }
          } else {
            // 枪手：保持"甜点距离"（keep），太近后退、太远压上
            if (dToP > K.keep * 1.06) { mx = Math.cos(angToP); my = Math.sin(angToP); }
            else if (dToP < K.keep * 0.66) { mx = -Math.cos(angToP); my = -Math.sin(angToP); }
            // 侧移绕圈：方向保持 0.7~2 秒再翻，看起来像在找射击角度
            e.strafeTimer -= dt;
            if (e.strafeTimer <= 0) {
              e.strafeTimer = 0.7 + Math.random() * 1.3;
              e.strafeDir = -e.strafeDir;
            }
            mx += Math.cos(angToP + Math.PI / 2) * 0.62 * e.strafeDir;
            my += Math.sin(angToP + Math.PI / 2) * 0.62 * e.strafeDir;
          }
        } else if (e.lostTimer < 0.4) {
          // 刚脱离视线，先沿原方向扑一小段
          mx = Math.cos(angToP); my = Math.sin(angToP);
        } else {
          // 绕着墙去最后看到玩家的地方，路上顺手把门推开
          const st = steerTo(e, e.lastSeen.x, e.lastSeen.y, dt);
          if (st) { mx = st.x; my = st.y; }
        }
        // 追人的时候贴着门就推开（不再只有 hunt 型会推）：门后听到动静的敌人能自己开门出来，
        // 不会一直对着门撞、更不会全都堵在门后等玩家推门进来。
        pushDoor(e);
        // 攻击：先举枪（windup 前摇），攒满才真的开火。前摇期间瞄点只以有限速度追玩家，
        // 玩家横移/后撤能把枪口甩在身后；中途丢了视线则前摇回落，不开这一枪。
        if (sees && dToP <= K.attackRange && e.attackCd <= 0) {
          if (e.wind <= 0) { e.aimX = p.x; e.aimY = p.y; }
          else {
            const track = Math.min(1, dt * 5.5);
            e.aimX += (p.x - e.aimX) * track;
            e.aimY += (p.y - e.aimY) * track;
          }
          e.wind += dt;
          if (e.wind >= enemyWindup(K)) {
            const aimAng = Math.atan2(e.aimY - e.y, e.aimX - e.x);
            e.wind = 0;
            enemyAttack(e, K, aimAng);
          }
        } else if (e.wind > 0) {
          e.wind = Math.max(0, e.wind - dt * 2.5);
        }
        break;
      }
      default: break;
    }

    const ml = Math.hypot(mx, my);
    if (ml > 0.001) {
      mx /= ml; my /= ml;
      // 同伴分离：离得太近就互相推开，一窝蜂叠在同一个点会像"一个人"
      let sepX = 0, sepY = 0;
      for (const o of W.enemies) {
        if (o === e || !o.alive) continue;
        const ddx = e.x - o.x, ddy = e.y - o.y;
        const dd2 = ddx * ddx + ddy * ddy;
        const R = 30;
        if (dd2 > R * R || dd2 < 0.0001) continue;
        const dd = Math.sqrt(dd2);
        const w = 1 - dd / R;
        sepX += (ddx / dd) * w;
        sepY += (ddy / dd) * w;
      }
      if (sepX || sepY) {
        mx += sepX * 1.25;
        my += sepY * 1.25;
        const nl = Math.hypot(mx, my) || 1;
        mx /= nl; my /= nl;
      }
      e.vx = mx * e.speed;
      e.vy = my * e.speed;
      e.facing = Math.atan2(my, mx);
    } else {
      e.vx *= 0.82; e.vy *= 0.82;
    }
    if (e.state === 'chase' && sees && e.kind !== 'melee') e.facing = angToP;

    const ox = e.x, oy = e.y;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    resolveCircle(W, e, ACTOR_R, solidRects(W, true));
    const moved = Math.hypot(e.x - ox, e.y - oy);
    if (ml > 0.5 && moved < Math.abs(K.speed) * dt * 0.3) {
      // 卡住了，换目标
      if (e.state === 'patrol') pickPatrol(e);
      else if (e.state === 'investigate') e.investigateTimer = Math.min(e.investigateTimer, 0.4);
    }
  }

  /** 举枪前摇时长（秒）：剧情模式是一击必杀，再放宽一档，给玩家看清并抢先手的窗口。 */
  function enemyWindup(K) {
    return (K.windup || 0) * (G.mode === 'story' ? 1.25 : 1);
  }

  /** 敌人射击误差（度）：基础值 × 剧情放宽 × 距离系数 —— 越远越飘，近身也别指望百发百中。 */
  function enemyAimErr(K, d) {
    const rr = K.attackRange > 1 ? clamp(d / K.attackRange, 0, 1) : 1;
    return (K.aimErr || 0) * (G.mode === 'story' ? 1.35 : 1) * (0.75 + 0.55 * rr);
  }

  function enemyAttack(e, K, angToP) {
    const def = WEAPONS[e.weapon];
    if (def.melee) {
      e.attackCd = K.interval;
      Sfx.play(def.sound);
      // 敌人挥刀也有挥砍动画（跟玩家同一套），不然近战兵看起来是"贴着人不动却掉血"
      e.swingTotal = e.swingT = SWING_TIME[e.weapon] || SWING_DEFAULT;
      e.swingDir = -(e.swingDir || 1);
      meleeSwing(e, def, false);
      return;
    }
    // 别打到同伴：枪线上有自己人就先不开枪，压一下冷却换个位置再打
    for (const o of W.enemies) {
      if (o === e || !o.alive) continue;
      const od = Math.hypot(o.x - e.x, o.y - e.y);
      if (od > 110) continue;
      const oa = Math.atan2(o.y - e.y, o.x - e.x);
      if (Math.abs(angDiff(oa, angToP)) < 0.3) {
        e.attackCd = 0.28;
        return;
      }
    }
    e.attackCd = K.interval;
    if (e.ammo <= 0) { e.ammo = def.mag; }
    e.ammo--;
    Sfx.play(def.sound);
    emitNoise(e.x, e.y, 480);
    const errDeg = enemyAimErr(K, Math.hypot(G.player.x - e.x, G.player.y - e.y));
    const err = (Math.random() - 0.5) * 2 * errDeg * Math.PI / 180;
    const base = angToP + err;
    for (let i = 0; i < def.pellets; i++) {
      const a = base + (Math.random() - 0.5) * 2 * def.spread * Math.PI / 180;
      castShot({ x: e.x + Math.cos(base) * 11, y: e.y + Math.sin(base) * 11 }, a, def.range, e);
    }
  }

  function pickPatrol(e) {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 12 + Math.random() * 46;
      const x = e.hx + Math.cos(a) * r, y = e.hy + Math.sin(a) * r;
      if (pointSolid(W, x, y, 6)) continue;
      // 巡逻点别贴着门：几个人一起在门口站岗，玩家一开门就被贴脸齐射
      if (nearClosedDoor(x, y, 40)) continue;
      e.target.x = x; e.target.y = y; return;
    }
    e.target.x = e.hx; e.target.y = e.hy;
  }

  /** 附近有没有关着的门（半径 r 内）。巡逻选点用：别在门口站岗。 */
  function nearClosedDoor(x, y, r) {
    if (!W.doors) return false;
    const r2 = r * r;
    for (const d of W.doors) {
      if (d.open) continue;
      if (dist2(x, y, d.x, d.y) < r2) return true;
    }
    return false;
  }

  /** 剧情敌人别贴着门站岗：开局往远离最近那扇门的方向挪一点，避免一开门就被贴脸齐射。 */
  function nudgeFromDoor(e) {
    if (!W.doors || !W.doors.length) return;
    let near = null, best = 48 * 48;
    for (const d of W.doors) {
      if (d.open) continue;
      const dd = dist2(e.x, e.y, d.x, d.y);
      if (dd < best) { best = dd; near = d; }
    }
    if (!near) return;
    let ang = Math.atan2(e.y - near.y, e.x - near.x);
    if (!isFinite(ang) || best < 1) ang = Math.random() * Math.PI * 2;
    // 从远到近试几个落点，找得到空位就走，都不行就原地不动
    for (const step of [44, 34, 24]) {
      const nx = e.x + Math.cos(ang) * step, ny = e.y + Math.sin(ang) * step;
      if (pointSolid(W, nx, ny, 9)) continue;
      e.x = nx; e.y = ny; e.hx = nx; e.hy = ny;
      return;
    }
  }

  // ---------------------------------------------------------------- 拾取物更新
  function updatePickups(dt) {
    for (const pk of W.pickups) {
      pk.bob += dt * 3;
    }
  }

  // ---------------------------------------------------------------- 补给点商店
  // 补给点：地图上的固定点，走近后按 E 打开商店 UI。
  // 商品只有：武器 / 弹药 / 护甲板 / 血包。技能不再出售，只能靠老虎机摇出来。
  const SHOP = [
    { id: 'pistol', kind: 'weapon', label: '手枪', price: 0, desc: '' },
    { id: 'smg', kind: 'weapon', label: '冲锋枪', price: 400, desc: '全自动' },
    { id: 'shotgun', kind: 'weapon', label: '霰弹枪', price: 300, desc: '近距离' },
    { id: 'ammo', kind: 'ammo', label: '弹药', price: 120, desc: '补满备弹' },
    { id: 'armor', kind: 'armor', label: '护甲板', price: 250, desc: '一格（长按左键装）' },
    { id: 'grenade', kind: 'grenade', label: '手雷', price: 120, desc: '+2 颗' },
    { id: 'medkit', kind: 'heal', label: '血包', price: 150, desc: '回满血' },
    { id: 'slot', kind: 'slot', label: '老虎机', price: 200, desc: '' }
  ];
  const SHOP_COLS = 5;   // 商店每列商品数（左列 5 项，右列不足则收尾）

  /** 商店底部的「购买」「退出」按钮布局，供绘制与点击复用（老虎机子界面时不显示）。 */
  function shopButtons() {
    const bw = 140, bh = 38, gap = 32;
    const y = VIEW_H - 58;
    const cx = VIEW_W / 2;
    return {
      buy:  { x: cx - gap / 2 - bw, y, w: bw, h: bh },
      exit: { x: cx + gap / 2, y, w: bw, h: bh },
    };
  }

  /** 命中检测：返回点击落在哪一行商品上（-1 = 没点中）。整列宽都可点，方便手机点价格区域。 */
  function shopItemAt(x, y) {
    const colW = VIEW_W / 2;
    for (let i = 0; i < SHOP.length; i++) {
      const col = Math.floor(i / SHOP_COLS);
      const row = i % SHOP_COLS;
      const ix = col * colW;
      const iy = 112 + row * 46 - 16;
      if (x >= ix && x < ix + colW && y >= iy && y < iy + 40) return i;
    }
    return -1;
  }

  function openShop() {
    G.state = 'shop';
    G.shopSel = 0;
    G.slotState = null;   // 老虎机状态（null = 未开始）
    Sfx.play('clear');
    // 把触发这次切换的按键吃掉：高刷屏上按下那一帧可能没跑到 update，
    // pressed 会活到下一帧，然后被 shop 分支读成"再按一次 B"直接把商店关掉。
    pressed = Object.create(null);
  }

  function buyShopItem() {
    const item = SHOP[G.shopSel];
    if (!item) return;
    const p = G.player;
    if (G.cash < item.price) { Sfx.play('empty'); return; }

    if (item.kind === 'weapon') {
      if (p.weapon === item.id) { Sfx.play('empty'); return; }
      if (p.side && p.side.weapon === item.id) { Sfx.play('empty'); return; }  // 已经背着一把了
      // 旧武器：背上空就顺手背起来，否则掉地上
      if (p.weapon) {
        if (!p.side) {
          p.side = { weapon: p.weapon, ammo: p.ammo, reserve: p.reserve };
        } else {
          const old = makePickup(p.weapon, p.x, p.y);
          old.ammo = p.ammo;
          old.reserve = p.reserve;
          W.pickups.push(old);
        }
      }
      p.weapon = item.id;
      p.ammo = gunStat(item.id, 'mag');
      p.reserve = WEAPONS[item.id].reserveMax || 0;
      p.cooldown = 0;
      p.reload = 0;
      p.reloadTotal = 0;
      G.cash -= item.price;
      Sfx.play('pickup');
    } else if (item.kind === 'ammo') {
      // 手上是近战/空手时，补给背上的枪
      let slot = null;
      if (p.weapon && !WEAPONS[p.weapon].melee) slot = p;
      else if (p.side && !WEAPONS[p.side.weapon].melee) slot = p.side;
      if (!slot) { Sfx.play('empty'); return; }
      slot.reserve = WEAPONS[slot.weapon].reserveMax;
      G.cash -= item.price;
      Sfx.play('pickup');
    } else if (item.kind === 'armor') {
      // 护甲板进背包，按 4 取出长按左键 1 秒装入（一块一格）
      if (p.armorPlates >= ARMOR_PLATE_CAP) { Sfx.play('empty'); return; }
      p.armorPlates++;
      G.cash -= item.price;
      Sfx.play('pickup');
    } else if (item.kind === 'heal') {
      if (p.hp >= HP_MAX) { Sfx.play('empty'); return; }
      p.hp = HP_MAX;
      G.cash -= item.price;
      Sfx.play('pickup');
    } else if (item.kind === 'grenade') {
      if (p.grenades >= GRENADE_MAX) { Sfx.play('empty'); return; }
      p.grenades = Math.min(GRENADE_MAX, p.grenades + 2);
      G.cash -= item.price;
      Sfx.play('pickup');
    } else if (item.kind === 'slot') {
      // 老虎机：付钱后开始摇
      if (G.slotState && G.slotState.spinning) { Sfx.play('empty'); return; }
      G.cash -= item.price;
      G.slotState = startSlot();
      Sfx.play('pickup');
    }
  }

  // ---------------------------------------------------------------- 武器升级站
  // 第 5 波清完之后才开。四条线（伤害/弹匣/射程/红外激光）各 3 级，越升越贵；
  // 四条全满以后才开放"进化"，把枪换成另一个形态。
  function openUpgrade() {
    if (!G.upgUnlocked) {
      G.toast = '升级站 第 ' + UP_UNLOCK_WAVE + ' 波后开放';
      G.toastTimer = 1.8;
      Sfx.play('empty');
      return false;
    }
    G.state = 'upgrade';
    if (!G.upgSel) G.upgSel = { gun: 0, line: 0 };
    // 光标默认落在手上这把枪上，省得每次进来都要先按两下 A/D
    const wi = UP_GUNS.indexOf(G.player && G.player.weapon);
    if (wi >= 0) G.upgSel.gun = wi;
    G.upgSel.line = clamp(G.upgSel.line, 0, UP_ARMOR_LINE);
    Sfx.play('clear');
    pressed = Object.create(null);
    return true;
  }

  function closeUpgrade() {
    G.state = 'play';
    pressed = Object.create(null);
  }

  /** 升级站底部「购买」「退出」按钮布局，供绘制与点击复用。 */
  function upgradeButtons() {
    const bw = 140, bh = 38, gap = 32;
    const y = VIEW_H - 58;
    const cx = VIEW_W / 2;
    return {
      buy:  { x: cx - gap / 2 - bw, y, w: bw, h: bh },
      exit: { x: cx + gap / 2, y, w: bw, h: bh },
    };
  }

  /** 升级站命中检测：返回点击落在哪一格。{ gun } = 标签页换枪，{ line } = 升级行，null = 没点中。 */
  function upgradeHitAt(x, y) {
    // 标签页（三把枪）
    const tabW = 168, tabGap = 10;
    const tabX0 = VIEW_W / 2 - (3 * tabW + 2 * tabGap) / 2;
    for (let i = 0; i < UP_GUNS.length; i++) {
      const ux = tabX0 + i * (tabW + tabGap);
      if (x >= ux && x < ux + tabW && y >= 88 && y < 88 + 30) return { gun: i };
    }
    // 升级行（4 条线 + 进化 + 护甲）
    const rowY = 128, rowH = 30;
    for (let li = 0; li <= UP_ARMOR_LINE; li++) {
      const yy = rowY + li * rowH;
      if (x >= 40 && x <= VIEW_W - 40 && y >= yy - 14 && y < yy - 14 + 30) return { line: li };
    }
    return null;
  }

  /** 光标所指的一格：line 0..3 是四条升级线，4 是进化，5 是护甲升级。 */
  function upSelEntry() {
    const sel = G.upgSel || { gun: 0, line: 0 };
    const gunId = UP_GUNS[clamp(sel.gun, 0, UP_GUNS.length - 1)];
    const line = clamp(sel.line, 0, UP_ARMOR_LINE);
    return {
      gunId, line,
      def: line < UPGRADE_LINES.length ? UPGRADE_LINES[line] : null,
      u: gunUp(gunId)
    };
  }

  /** 买一格：升级，或者四条线全满时的进化，或者护甲等级升级。返回是否真的买到。 */
  function buyUpgrade() {
    const { gunId, line, def, u } = upSelEntry();
    const p = G.player;
    const owned = !!(p && (p.weapon === gunId || (p.side && p.side.weapon === gunId)));

    // ---------------- 护甲等级升级（独立于枪，跟这一局走）
    if (line === UP_ARMOR_LINE) {
      if (!p) return false;
      const tier = p.armorTier || 0;
      if (tier >= ARMOR_TIERS.length - 1) { Sfx.play('empty'); return false; }   // 已满级（金甲）
      const price = ARMOR_UP_PRICE[tier];
      if (G.cash < price) { Sfx.play('empty'); return false; }
      G.cash -= price;
      p.armorTier = tier + 1;
      refillArmor(p);                                  // 升级当场补满到新等级
      FX.addText(p.x, p.y - 18, '护甲升级 · ' + ARMOR_TIERS[p.armorTier].name, '#e02929');
      G.toast = '护甲升级：' + ARMOR_TIERS[p.armorTier].name;
      G.toastTimer = 1.8;
      Sfx.play('clear');
      return true;
    }

    if (!u) return false;

    if (line >= UPGRADE_LINES.length) {
      // ---------------- 进化
      if (u.evo) { Sfx.play('empty'); return false; }
      if (!upAllMaxed(gunId)) {
        G.toast = '四条线全满才能进化';
        G.toastTimer = 1.6;
        Sfx.play('empty');
        return false;
      }
      const price = Math.round(UP_EVO_PRICE * (UP_PRICE_MUL[gunId] || 1));
      if (G.cash < price) { Sfx.play('empty'); return false; }
      const before = gunStat(gunId, 'mag');
      G.cash -= price;
      u.evo = true;
      Sfx.play('clear');
      // 双持多出来的那个弹匣直接送上，不用再按一次 R
      if (p && p.weapon === gunId) {
        const after = gunStat(gunId, 'mag');
        p.ammo = Math.min(after, p.ammo + Math.max(0, after - before));
        p.reload = 0; p.reloadTotal = 0; p.cooldown = 0;
        FX.addText(p.x, p.y - 18, '进化 · ' + (UP_EVO_NAME[gunId] || ''), '#e02929');
      }
      G.toast = WEAPONS[gunId].name + ' 进化：' + UP_EVO_NAME[gunId];
      G.toastTimer = 2;
      return true;
    }

    // ---------------- 普通升级
    const price = upCost(gunId, def.id);
    if (!price) { Sfx.play('empty'); return false; }          // 已满级
    if (G.cash < price) { Sfx.play('empty'); return false; }
    const beforeShell = gunStat(gunId, 'mag');
    G.cash -= price;
    u[def.id] = (u[def.id] || 0) + 1;
    Sfx.play('pickup');
    // 弹匣扩容当场把差值补进弹匣，不然买完还得自己按一次 R
    if (def.id === 'mag' && p && p.weapon === gunId) {
      const afterShell = gunStat(gunId, 'mag');
      p.ammo = Math.min(afterShell, p.ammo + Math.max(0, afterShell - beforeShell));
    }
    if (def.id === 'dmg' && p && owned) {
      FX.addText(p.x, p.y - 18, '伤害 ' + gunStat(gunId, 'dmg'), '#e02929');
    }
    return true;
  }

  /** 某一格的"当前值 → 下一级值"，升级界面上的小字用它。 */
  function upPreview(gunId, lineId) {
    const def = WEAPONS[gunId];
    const u = gunUp(gunId) || { dmg: 0, mag: 0, range: 0, laser: 0, evo: false };
    const lv = u[lineId] || 0;
    const evoMul = (u.evo && DUAL_GUNS[gunId]) ? 2 : 1;
    const at = (extra) => {
      if (lineId === 'dmg') return Math.round(def.dmg * (1 + (lv + extra) * UP_DMG_PER));
      if (lineId === 'mag') {
        return Math.max(1, Math.round(def.mag * (1 + (lv + extra) * UP_MAG_PER))) * evoMul;
      }
      if (lineId === 'range') return Math.round(def.range * (1 + (lv + extra) * UP_RANGE_PER));
      return lv + extra;
    };
    const line = UPGRADE_LINES.find(l => l.id === lineId);
    const max = line ? line.max : 3;
    return { cur: at(0), next: lv < max ? at(1) : null, lv, max };
  }

  // ---------------------------------------------------------------- 老虎机
  // 技能的唯一来源。三个转轮，只有摇出三个相同图案才发奖励。
  // 图案：疾跑 / 快枪手 / 快手 / 铁甲 / 双倍分。
  const SLOT_SYMBOLS = ['speed', 'firerate', 'reload', 'armor', 'double'];
  const SLOT_NAMES = {
    speed: '疾跑', firerate: '快枪手', reload: '快手', armor: '铁甲', double: '双倍分'
  };
  const SLOT_ICONS = {
    speed: '⚡', firerate: '🎯', reload: '🔄', armor: '🛡', double: '×2'
  };

  function startSlot() {
    return { spinning: true, t: 0, stops: [0, 0, 0], result: null };
  }

  /** 推进老虎机动画，返回 true 表示这一帧有结算。dt 为物理步长。 */
  function updateSlot(dt) {
    const s = G.slotState;
    if (!s || !s.spinning) return false;
    s.t += dt;
    // 三个轮子依次停（每个停的时机略有错开）
    const stopAt = [0.9, 1.3, 1.7];
    let allStopped = true;
    for (let i = 0; i < 3; i++) {
      if (s.t < stopAt[i]) { allStopped = false; }
      else if (!s.stops[i] && s.stops[i] !== 0) { s.stops[i] = 0; }
      // 滚动中每帧随机图案
      if (s.t < stopAt[i]) s.stops[i] = Math.floor(Math.random() * SLOT_SYMBOLS.length);
    }
    if (allStopped && s.t >= 1.7) {
      s.spinning = false;
      G.slotSpins = (G.slotSpins || 0) + 1;
      let a = s.stops[0], b = s.stops[1], c = s.stops[2];
      let win = (a === b && b === c);

      // 保底：已经连亏 SLOT_PITY 次了，这次无论摇出什么，直接把轮子统一成一个符号
      if (!win && (G.slotPity || 0) >= SLOT_PITY) {
        const pick = Math.floor(Math.random() * SLOT_SYMBOLS.length);
        a = pick; b = pick; c = pick;
        s.stops[0] = s.stops[1] = s.stops[2] = pick;
        s.pity = true;
        win = true;
      }

      if (win) {
        G.slotPity = 0;
        s.result = SLOT_SYMBOLS[a];
        grantSkill(G.player, s.result);
      } else {
        G.slotPity = (G.slotPity || 0) + 1;
        s.result = null;
        // 两个相同（差一点）→ 退一点安慰金，不至于两百块全打水漂
        if (a === b || b === c || a === c) {
          s.console = SLOT_CONSOLE;
          G.cash += SLOT_CONSOLE;
          Sfx.play('pickup');
        }
      }
      return true;
    }
    return false;
  }

  /** 发放技能：老虎机摇出三同图案时的奖励。技能只有这一个来源。 */
  function grantSkill(p, skillId) {
    if (skillId === 'double') {
      // 双倍分：一次性 buff，持续 3 波
      G.doubleScore = Math.max(G.doubleScore || 0, 3);
      FX.addText(p.x, p.y - 14, '双倍积分 ×' + G.doubleScore + ' 波', '#e02929');
    } else if (skillId === 'armor') {
      // 铁甲：立即补满护甲
      refillArmor(p);
      FX.addText(p.x, p.y - 14, '获得 铁甲 · 护甲补满', '#8fd8ff');
    } else {
      p.perks[skillId] = (p.perks[skillId] || 0) + 1;
      FX.addText(p.x, p.y - 14, '获得 ' + SLOT_NAMES[skillId], '#e02929');
    }
    Sfx.play('clear');
  }

  // ---------------------------------------------------------------- 波次
  /** 生成一波敌人：数量/种类/血量/速度随波次递增。 */
  function startWave() {
    G.wave++;
    W.cleared = false;   // 关键：重置清场标记，否则第 2 波清空后不再触发下一波
    const n = Math.min(12, 2 + Math.ceil(G.wave * 0.9));   // 第 1 波 3 只，往后放缓增长，封顶 12
    const hpScale = 1 + (G.wave - 1) * 0.15;
    const spdScale = 1 + Math.min(0.2, (G.wave - 1) * 0.022);
    const pts = W.spawnPoints.length ? W.spawnPoints : [{ x: W.pxW / 2, y: W.pxH / 2 }];

    // 清空上一波（尸体留在 decals 血迹里，但敌人数组要清掉，否则会重复累加）
    W.enemies = [];

    for (let i = 0; i < n; i++) {
      // 波次越高，枪手/霰弹兵比例越高
      let kind = 'melee';
      const r = Math.random();
      if (G.wave >= 2 && r < 0.28) kind = 'gun';
      else if (G.wave >= 3 && r < 0.5) kind = 'gun';
      if (G.wave >= 4 && r < 0.16) kind = 'shotgun';
      if (G.wave >= 6 && r < 0.3) kind = 'shotgun';

      const pt = pts[Math.floor(Math.random() * pts.length)];
      const e = makeEnemy(kind, pt.x + (Math.random() - 0.5) * 24, pt.y + (Math.random() - 0.5) * 24);
      e.maxHp = e.hp = Math.round(ENEMY_KIND[kind].hp * hpScale);
      e.speed = ENEMY_KIND[kind].speed * spdScale;
      // 波次敌人主动猎杀：一出生就知道玩家方位，直接进入追击状态；
      // hunt 标记让它看不到玩家时也持续追踪，不会停下闲逛。
      e.hunt = true;
      e.state = 'chase';
      e.lastSeen.x = G.player.x;
      e.lastSeen.y = G.player.y;
      e.facing = Math.atan2(G.player.y - e.y, G.player.x - e.x);
      W.enemies.push(e);
    }
    G.toast = '第 ' + G.wave + ' 波 · ' + n + ' 个敌人';
    G.toastTimer = 2.5;
    FX.addText(G.player.x, G.player.y - 20, '第 ' + G.wave + ' 波', '#e02929');

    // 每 5 波来一个 BOSS：血厚、体型大、头顶独立血条、掉手雷和护甲板，
    // 让"第几波"这件事有记忆点，而不是只有数字在涨
    if (G.wave % 5 === 0) spawnBoss(pts, hpScale, spdScale);
    // 第 7 波起每波另加一个精英：血偏厚 + 一层小护甲，体型略大，没有独立血条。
    // 精英是"每波固定上一点强度"，BOSS 是"每 5 波一个大高潮"，两者并存不冲突。
    if (G.wave >= 7) spawnElite(pts, hpScale, spdScale);
  }

  /** BOSS：普通敌人的重装版，头顶独立血条，击杀给稀有资源。 */
  function spawnBoss(pts, hpScale, spdScale) {
    const kind = G.wave >= 10 ? 'shotgun' : 'gun';
    const K = ENEMY_KIND[kind];
    const pt = pts[Math.floor(Math.random() * pts.length)];
    const e = makeEnemy(kind, pt.x, pt.y);
    e.boss = true;
    e.scale = 1.45;
    e.maxHp = e.hp = Math.round(K.hp * hpScale * 6);
    e.speed = K.speed * spdScale * 0.92;
    e.keep = Math.round(K.keep * 0.8);       // 比普通枪手压得更近，逼玩家动起来
    e.hunt = true;
    e.state = 'chase';
    e.lastSeen.x = G.player.x;
    e.lastSeen.y = G.player.y;
    e.facing = Math.atan2(G.player.y - e.y, G.player.x - e.x);
    W.enemies.push(e);
    G.toast = '第 ' + G.wave + ' 波 · BOSS';
    G.toastTimer = 2.8;
    return e;
  }

  /** 精英：普通敌人的强化版（血偏厚 + 一层小护甲），击杀给稀有资源。不是 BOSS，没有独立血条。 */
  function spawnElite(pts, hpScale, spdScale) {
    const kind = G.wave >= 10 ? 'shotgun' : 'gun';
    const K = ENEMY_KIND[kind];
    const pt = pts[Math.floor(Math.random() * pts.length)];
    const e = makeEnemy(kind, pt.x, pt.y);
    e.elite = true;
    e.scale = 1.3;
    e.maxHp = e.hp = Math.round(K.hp * hpScale * 4);
    e.speed = K.speed * spdScale * 0.95;
    e.keep = Math.round(K.keep * 0.85);       // 比普通枪手压得更近，逼玩家动起来
    e.armor = 40;                              // 一小层护甲：打掉前子弹只碎甲不掉血
    e.maxArmor = 40;
    e.hunt = true;
    e.state = 'chase';
    e.lastSeen.x = G.player.x;
    e.lastSeen.y = G.player.y;
    e.facing = Math.atan2(G.player.y - e.y, G.player.x - e.x);
    W.enemies.push(e);
    G.toast = '第 ' + G.wave + ' 波 · 精英';
    G.toastTimer = 2.8;
    return e;
  }

  /** BOSS 头顶的血条（世界坐标，跟着相机走）。 */
  function drawBossBars() {
    for (const e of W.enemies) {
      if (!e.alive || !e.boss) continue;
      const bw = 36, bh = 4;
      const y = e.y - 15 * (e.scale || 1);
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(e.x - bw / 2, y, bw, bh);
      ctx.fillStyle = '#e0402c';
      ctx.fillRect(e.x - bw / 2 + 0.7, y + 0.7,
        (bw - 1.4) * clamp(e.hp / e.maxHp, 0, 1), bh - 1.4);
    }
  }

  function startGame(opts) {
    // opts.mode: 'challenge'（默认，无限波次生存）| 'story'（剧情模式，逐关推进）
    // opts.prep: false 时跳过开局准备期（测试/调试用）
    const mode = (opts && opts.mode) || 'challenge';
    const withPrep = !(opts && opts.prep === false);
    // 剧情关序号（调试/测试用，默认第 0 关）
    const lvl = (mode === 'story' && opts && opts.storyLevel)
      ? clamp(opts.storyLevel | 0, 0, STORY_LEVELS.length - 1) : 0;
    G.mode = mode;
    G.storyLevel = lvl;
    G.storyKills = 0;
    G.storyComboBest = 0;
    G.storyHits = 0;        // 受击次数（评分用）
    G.storyStartT = performance.now();

    if (mode === 'story') {
      const lv = STORY_LEVELS[lvl];
      W = buildLevel(lvl, lv);
      G.levelIndex = lvl;
      G.player = makePlayer(W.spawn.x, W.spawn.y);
      G.wave = 0;
      G.cash = 0;
      G.score = 0;
      G.combo = 0;
      G.bestCombo = 0;
      G.shopSel = 0;
      G.slotState = null;
      G.slotPity = 0;
      G.slotSpins = 0;
      G.doubleScore = 0;
      G.intermission = 0;
      G.state = 'play';
      G.centerText = '';
      G.centerColor = '#fff';
      G.deadTimer = 0;
      G.upg = makeUpgrades();
      G.upgUnlocked = false;
      G.upgSel = { gun: 0, line: 0 };
      G.toast = '';
      G.toastTimer = 0;
      G.timeScale = 1;
      FX.reset();
      G.grenades = [];
      BLASTS.length = 0;
      G.player.weapon = 'pistol';
      G.player.ammo = WEAPONS.pistol.mag;
      G.player.reserve = 0;          // 剧情模式没有备弹
      G.cam.x = clamp(G.player.x - VIEW_W / ZOOM / 2, 0, Math.max(0, W.pxW - VIEW_W / ZOOM));
      G.cam.y = clamp(G.player.y - VIEW_H / ZOOM / 2, 0, Math.max(0, W.pxH - VIEW_H / ZOOM));
      G.camV.x = 0;
      G.camV.y = 0;
      // 预设敌人：按关卡数据摆好，清空即过关
      spawnStoryEnemies(lvl);
      // 开场提示
      G.centerText = lv.title;
      G.centerColor = MIAMI.pink;
      G.centerTimer = 2.2;
      return;
    }

    // ---- 挑战模式（原波次生存）----
    W = buildLevel(0);
    G.player = makePlayer(W.spawn.x, W.spawn.y);
    G.levelIndex = 0;
    G.wave = 0;
    G.cash = 0;
    G.score = 0;
    G.combo = 0;
    G.bestCombo = 0;
    G.shopSel = 0;
    G.slotState = null;
    G.slotPity = 0;      // 老虎机保底计数：连亏这么多次，下一次必中
    G.slotSpins = 0;
    G.doubleScore = 0;
    G.intermission = 0;
    G.state = 'play';
    G.centerText = '';
    G.deadTimer = 0;
    // 武器升级：每局从零开始（升级跟着枪种走，死了重开也清零）
    G.upg = makeUpgrades();
    G.upgUnlocked = false;
    G.upgSel = { gun: 0, line: 0 };
    // 开局不再甩一串键位教学：键位印在标题页一行就够
    G.toast = '';
    G.toastTimer = 0;
    G.timeScale = 1;
    FX.reset();
    G.grenades = [];
    BLASTS.length = 0;
    // 开局给一把手枪（商店手枪免费，直接发）+ 满备弹
    G.player.weapon = 'pistol';
    G.player.ammo = WEAPONS.pistol.mag;
    G.player.reserve = WEAPONS.pistol.reserveMax;
    G.cam.x = clamp(G.player.x - VIEW_W / ZOOM / 2, 0, Math.max(0, W.pxW - VIEW_W / ZOOM));
    G.cam.y = clamp(G.player.y - VIEW_H / ZOOM / 2, 0, Math.max(0, W.pxH - VIEW_H / ZOOM));
    G.camV.x = 0;
    G.camV.y = 0;
    if (withPrep) {
      // 第一波开打之前：场上没有敌人，复用"整备倒计时"这套机制等 30 秒。
      // 准备期玩家可以自由走动、去补给点买家伙，按空格直接开打。
      W.enemies = [];
      W.cleared = true;
      G.intermission = PREP_TIME;
    } else {
      startWave();
    }
  }

  /** 剧情模式：按关卡数据把预设敌人摆进世界（固定布局，不是随机刷）。 */
  function spawnStoryEnemies(levelIdx) {
    const lv = STORY_LEVELS[levelIdx];
    W.enemies = [];
    for (const en of lv.enemies) {
      const cx = (en.pos[0] + 0.5) * TILE;
      const cy = (en.pos[1] + 0.5) * TILE;
      const e = makeEnemy(en.kind, cx, cy);
      const K = ENEMY_KIND[en.kind];
      e.maxHp = e.hp = K.hp;
      e.speed = K.speed;
      // 警觉系统：敌人开局处于放松站岗状态，不主动猎杀。只有当
      // ①玩家进入其视线范围，或 ②玩家制造动静（开枪/破门/爆炸等）才会警觉。
      // 初始朝向随机，背对/面对门都有可能，玩家破门突入能拿到"先手"或撞个正着。
      e.state = 'idle';
      e.facing = Math.random() * Math.PI * 2;
      e.thinkTimer = 0.6 + Math.random() * 2.0;
      nudgeFromDoor(e);   // 别让他贴着门站岗（玩家一开门就被贴脸）
      W.enemies.push(e);
    }
    W.cleared = false;
    // 迈阿密规则：从哪里进来就从哪里出去 —— 终点就是出生点（门外街道上的那格）
    W.exit = { x: W.spawn.x, y: W.spawn.y };
  }

  /** 剧情模式评分：迈阿密式等级（A+ 最高，D 最低），综合连击、受伤、用时。 */
  function storyGrade() {
    const kills = G.storyKills || 0;
    const best = G.storyComboBest || 0;
    const hits = G.storyHits || 0;
    const t = (performance.now() - (G.storyStartT || 0)) / 1000;
    // 评分维度：连击（权重高）、无伤、速度
    let score = 0;
    if (best >= 6) score += 3; else if (best >= 4) score += 2; else if (best >= 2) score += 1;
    if (hits === 0) score += 2; else if (hits <= 2) score += 1;
    if (kills > 0 && t < kills * 8 + 10) score += 1;
    // 映射到等级
    const grades = ['D', 'C', 'B', 'A', 'A', 'A+', 'A+', 'A+'];
    return grades[Math.min(score, grades.length - 1)];
  }

  /** 剧情模式：进入下一关；最后一关通关则回到标题。 */
  function nextStoryLevel() {
    const next = G.storyLevel + 1;
    if (next >= STORY_LEVELS.length) {
      // 通关全部关卡：回标题
      goTitle();
      return;
    }
    G.storyLevel = next;
    G.storyKills = 0;
    G.storyComboBest = 0;
    G.storyHits = 0;
    G.storyStartT = performance.now();
    const lv = STORY_LEVELS[next];
    W = buildLevel(next, lv);
    G.levelIndex = next;
    G.player.x = W.spawn.x;
    G.player.y = W.spawn.y;
    G.player.alive = true;
    G.player.hp = HP_MAX;
    G.player.deadT = 0;
    // 每关重新发一把满匣手枪（没有备弹，子弹打光就去捡地上的）
    G.player.weapon = 'pistol';
    G.player.ammo = WEAPONS.pistol.mag;
    G.player.reserve = 0;
    G.player.side = null;
    G.player.reload = 0;
    G.player.reloadTotal = 0;
    G.combo = 0;
    G.comboTimer = 0;
    G.state = 'play';
    G.cam.x = clamp(G.player.x - VIEW_W / ZOOM / 2, 0, Math.max(0, W.pxW - VIEW_W / ZOOM));
    G.cam.y = clamp(G.player.y - VIEW_H / ZOOM / 2, 0, Math.max(0, W.pxH - VIEW_H / ZOOM));
    G.camV.x = 0;
    G.camV.y = 0;
    G.centerText = lv.title;
    G.centerColor = MIAMI.pink;
    G.centerTimer = 2.2;
    spawnStoryEnemies(next);
  }

  /** 剧情模式：重开当前关（死亡或结算重试）。 */
  function retryStoryLevel() {
    const idx = G.storyLevel;
    G.storyKills = 0;
    G.storyComboBest = 0;
    G.storyHits = 0;
    G.storyStartT = performance.now();
    const lv = STORY_LEVELS[idx];
    W = buildLevel(idx, lv);
    G.player.x = W.spawn.x;
    G.player.y = W.spawn.y;
    G.player.alive = true;
    G.player.hp = HP_MAX;
    G.player.deadT = 0;
    G.player.weapon = 'pistol';
    G.player.ammo = WEAPONS.pistol.mag;
    G.player.reserve = 0;
    G.player.side = null;
    G.combo = 0;
    G.comboTimer = 0;
    G.state = 'play';
    G.cam.x = clamp(G.player.x - VIEW_W / ZOOM / 2, 0, Math.max(0, W.pxW - VIEW_W / ZOOM));
    G.cam.y = clamp(G.player.y - VIEW_H / ZOOM / 2, 0, Math.max(0, W.pxH - VIEW_H / ZOOM));
    G.camV.x = 0;
    G.camV.y = 0;
    G.centerText = lv.title;
    G.centerColor = MIAMI.pink;
    G.centerTimer = 2.2;
    spawnStoryEnemies(idx);
  }

  function onPointerDown(e) {
    Sfx.init();
    // 右键只负责瞄准，不拿来开局（免得抬手瞄一下就顺手把标题点掉了）
    if (e && e.button === 2) return;
    // 命中检测：判断点击落在哪个按钮上
    const hit = (b) => b && mouse.x >= b.x && mouse.x <= b.x + b.w && mouse.y >= b.y && mouse.y <= b.y + b.h;
    if (G.state === 'title') {
      if (hit(TITLE_BTN.story)) startGame({ mode: 'story' });
      else if (hit(TITLE_BTN.challenge)) startGame({ mode: 'challenge' });
      else if (hit(TITLE_BTN.settings)) openSettings('title');
      return;
    }
    if (G.state === 'storyclear') {
      if (hit(CLEAR_BTN.next)) { nextStoryLevel(); Sfx.play('hit'); }
      else if (hit(CLEAR_BTN.retry)) { retryStoryLevel(); Sfx.play('hit'); }
      else if (hit(CLEAR_BTN.menu)) { goTitle(); Sfx.play('hit'); }
      return;
    }
    if (G.state === 'settings') {
      if (hit(SETTINGS_BTN.sound)) { Sfx.muted = !Sfx.muted; Sfx.play('hit'); }
      else if (hit(SETTINGS_BTN.control)) { setInputMode(inputMode === 'touch' ? 'pc' : 'touch'); Sfx.play('hit'); }
      else if (hit(SETTINGS_BTN.fire)) { setFireMode(fireMode === 'stick' ? 'button' : 'stick'); Sfx.play('hit'); }
      else if (hit(SETTINGS_BTN.layout)) { if (inputMode === 'touch') openTouchLayout(); }
      else if (hit(SETTINGS_BTN.back)) { closeSettings(); }
      return;
    }
    if (G.state === 'shop') {
      // 老虎机子界面：底部「再摇一次」「返回」两个按钮
      if (G.slotState) {
        const btns = shopButtons();
        if (hit(btns.exit)) { G.slotState = null; Sfx.play('empty'); return; }
        if (hit(btns.buy)) {
          const price = (SHOP.find(it => it.kind === 'slot') || { price: 9999 }).price;
          if (!G.slotState.spinning && G.cash >= price) {
            G.cash -= price;
            G.slotState = startSlot();
            Sfx.play('pickup');
          } else {
            Sfx.play('empty');
          }
          return;
        }
        return;
      }
      // 底部「购买」「退出」按钮
      const btns = shopButtons();
      if (hit(btns.exit)) { closeShop(); return; }
      if (hit(btns.buy)) { buyShopItem(); return; }
      // 点商品行：选中该行
      const idx = shopItemAt(mouse.x, mouse.y);
      if (idx >= 0) { G.shopSel = idx; Sfx.play('hit'); return; }
      return;
    }
    if (G.state === 'upgrade') {
      // 底部「购买」「退出」按钮
      const btns = upgradeButtons();
      if (hit(btns.exit)) { closeUpgrade(); return; }
      if (hit(btns.buy)) { buyUpgrade(); return; }
      // 点标签换枪 / 点升级行选中
      const t = upgradeHitAt(mouse.x, mouse.y);
      if (t) {
        if (t.gun !== undefined) {
          G.upgSel.gun = t.gun;
          G.upgSel.line = Math.min(G.upgSel.line, UP_ARMOR_LINE);
        } else if (t.line !== undefined) {
          G.upgSel.line = t.line;
        }
        Sfx.play('hit');
        return;
      }
      return;
    }
    if (G.state === 'layout') {
      handleLayoutClick();
      return;
    }
    // 暂停菜单：点击「继续游戏」/「设置」/「返回主菜单」
    if (G.paused) {
      const cy = VIEW_H / 2 - 34;  // 继续游戏按钮中心
      const sy = VIEW_H / 2;      // 设置按钮中心
      const ry = VIEW_H / 2 + 34; // 返回主菜单按钮中心
      const bx = VIEW_W / 2 - 80, bw = 160, bh = 28;
      const inBox = (y) => mouse.x >= bx && mouse.x <= bx + bw && mouse.y >= y - 14 && mouse.y <= y - 14 + bh;
      if (inBox(cy)) G.paused = false;
      else if (inBox(sy)) openSettings('pause');
      else if (inBox(ry)) goTitle();
      return;
    }
    if (G.state === 'done') startGame();
  }

  // ---------------------------------------------------------------- 补给点
  // 地图上的固定补给点。走近后按 E 打开商店 UI；老虎机也在里面。
  // 补给点位置从地图字符 'S'（商店）读出。
  function nearSupply() {
    if (!W || !G.player) return null;
    const pts = W.supplies && W.supplies.length ? W.supplies : (W.supply ? [W.supply] : []);
    for (const s of pts) {
      const d = Math.hypot(G.player.x - s.x, G.player.y - s.y);
      if (d <= 40) return s;
    }
    return null;
  }

  /** 武器升级站：走近 40 像素内按 E。 */
  function nearStation() {
    if (!W || !G.player) return null;
    for (const s of (W.stations || [])) {
      if (Math.hypot(G.player.x - s.x, G.player.y - s.y) <= 40) return s;
    }
    return null;
  }

  /**
   * 统一的"交互目标"判定：走近后按 E 打开对应的 UI。
   * 优先级：补给点商店 > 武器升级站（两者空间上不会重叠）。
   * 返回 { type, obj } 或 null（null 表示 E 走拾取武器逻辑）。
   */
  function interactTarget() {
    if (!W || !G.player) return null;
    const s = nearSupply();
    if (s) return { type: 'shop', obj: s };
    const st = nearStation();
    if (st) return { type: 'upgrade', obj: st };   // 未解锁也在 openUpgrade 里提示
    return null;
  }

  // ---------------------------------------------------------------- 相机与坐标
  //
  // 相机 = 玩家 + 准心前探，再走一次弹簧。
  //
  // 关键：前探量由**屏幕上的准心位置**算，不是"鼠标世界坐标 - 玩家"。
  // 后者是个正反馈环——相机一动，鼠标的世界坐标跟着动，前探量又被推大，
  // 于是鼠标停着不动画面也一直朝准心方向漂。屏幕比例是相机无关量，天然无环。
  //
  // 准心推到屏幕边 → 相机朝那边让出 56 × 38 世界像素（视野 320×180 的约 1/6），
  // 玩家被顶到画面另一侧，等于"看远处"，但永远留在画面里。
  // 抬枪后前探乘 AIM_PAN_MUL，最多让到 AIM_EDGE 卡住的位置（约 3 倍腰射），
  // 配合瞄准时 zoom 降到 1.5，玩家到画面边缘能拉到 370 多世界像素（腰射只有 216）。
  const CAM_PAN_X = 56;    // 满前探时的横向让位（世界像素）
  const CAM_PAN_Y = 38;    // 纵向让位
  const CAM_PAD   = 120;   // 相机可越出地图的余量：贴边站时前探也不被 clamp 吃掉（地图 720×456，给太多会露大片图外墙）
  const CAM_DEAD  = 0.14;  // 屏幕中心死区，微调准心时画面不动
  const CAM_OMEGA = 18;    // 弹簧角频率，越大跟得越紧（18 ≈ 0.2s 到位）
  const CAM_ZETA  = 1.0;   // 阻尼比，1.0 = 临界阻尼，不过冲不抖

  /** 屏幕偏移比 -1..1 → 前探比例，死区内为 0，死区外 smoothstep 起停。 */
  function panCurve(n) {
    const a = Math.min(1, Math.abs(n));
    if (a <= CAM_DEAD) return 0;
    const t = (a - CAM_DEAD) / (1 - CAM_DEAD);
    const e = t * t * (3 - 2 * t);
    return n < 0 ? -e : e;
  }

  function screenToWorld(sx, sy) {
    if (!G) return { x: 0, y: 0 };
    const z = camZoom();
    return { x: G.cam.x + sx / z, y: G.cam.y + sy / z };
  }

  /** 当前画面缩放：基础 ZOOM + 瞄准抬枪的插值。所有"屏幕 ↔ 世界"换算都走它。 */
  function camZoom() {
    return (G && G.zoom) || ZOOM;
  }

  /** 朝向单位向量；鼠标正好压在角色身上时返回 null（保持原朝向）。 */
  function aimDir() {
    const p = G && G.player;
    if (!p) return null;
    const mw = screenToWorld(mouse.x, mouse.y);
    const ax = mw.x - p.x, ay = mw.y - p.y;
    const len = Math.hypot(ax, ay);
    if (len < 1.0) return null;
    return { x: ax / len, y: ay / len };
  }

  /** 相机目标 = 玩家 + 准心前探，用临界阻尼弹簧跟过去（有惯性、停得稳）。 */
  function updateCamera(dt) {
    if (!G || !G.player || !W) return;
    const p = G.player;
    // 瞄准：画面拉远（视野变宽、能看很远），同时前探加长
    const aimT = clamp(p.aimT || 0, 0, 1);
    G.zoom = ZOOM * (1 + (AIM_ZOOM_MUL - 1) * aimT);
    const z = camZoom();
    const viewW = VIEW_W / z, viewH = VIEW_H / z;
    // 前探只看准心在屏幕上的比例位置，与相机自身无关 → 不会自我放大
    const nx = (mouse.x - VIEW_W / 2) / (VIEW_W / 2);
    const ny = (mouse.y - VIEW_H / 2) / (VIEW_H / 2);
    const panMul = 1 + (AIM_PAN_MUL - 1) * aimT;
    // 前探上限按 **canvas 像素** 算（除以 zoom 换回世界单位）：
    // 前探一走，玩家在屏幕上就往反方向偏，偏到画面外就"人不见了"。
    // 这里保证玩家中心至少还离边 AIM_EDGE_X / AIM_EDGE_Y 个 canvas 像素。
    const panCapX = Math.max(CAM_PAN_X, (VIEW_W / 2 - AIM_EDGE_X) / z);
    const panCapY = Math.max(CAM_PAN_Y, (VIEW_H / 2 - AIM_EDGE_Y) / z);
    const ox = clamp(panCurve(nx) * CAM_PAN_X * panMul, -panCapX, panCapX);
    const oy = clamp(panCurve(ny) * CAM_PAN_Y * panMul, -panCapY, panCapY);
    const xMax = Math.max(0, W.pxW - viewW);
    const yMax = Math.max(0, W.pxH - viewH);
    // 允许越界 CAM_PAD：地图外圈本来就是墙，外面继续铺墙体就是"更厚的墙"，
    // 这样玩家贴着地图边站也照样能让位，不会出现"前探被 clamp 吃掉"的死区。
    const tx = clamp(p.x + ox - viewW / 2, -CAM_PAD, xMax + CAM_PAD);
    const ty = clamp(p.y + oy - viewH / 2, -CAM_PAD, yMax + CAM_PAD);

    if (!(dt > 0)) {            // 直接吸附（开局 / 调试跳转）
      G.cam.x = tx; G.cam.y = ty;
      G.camV.x = 0; G.camV.y = 0;
      return;
    }
    const h = Math.min(dt, 1 / 30);   // 卡帧时步长封顶，弹簧不发散
    const k = CAM_OMEGA * CAM_OMEGA;
    const c = 2 * CAM_ZETA * CAM_OMEGA;
    G.camV.x += ((tx - G.cam.x) * k - G.camV.x * c) * h;
    G.camV.y += ((ty - G.cam.y) * k - G.camV.y * c) * h;
    G.cam.x += G.camV.x * h;
    G.cam.y += G.camV.y * h;
  }

  // ---------------------------------------------------------------- 更新
  function update(dt) {
    if (!W) return;
    if (G.state === 'play') {
      // 触屏模式：先把摇杆/按钮折算成 keys/mouse，再跑玩家逻辑（复用全部键鼠逻辑）
      applyTouchInput();
      applyTouchAim();
      updatePlayer(dt);
      updateBarrels(dt);
      updateGrenades(dt);
      updateThrown(dt);
      updateBloodDecals(dt);
      for (const e of W.enemies) updateEnemy(e, dt);
      updatePickups(dt);
      // 清场判定
      if (!W.cleared) {
        let alive = 0;
        for (const e of W.enemies) if (e.alive) alive++;
        if (alive === 0) {
          W.cleared = true;
          if (G.mode === 'story') {
            // 剧情模式：清空敌人后门口亮起（终点 = 出生点），走回去才结算。
            // 中央弹出 GO BACK，从 0 开始计时（弹入动画 → 常驻呼吸，直到走进终点）。
            G.centerText = '';
            G.goBack = 0.0001;
            Sfx.play('clear');
          } else {
            G.intermission = INTERMISSION_TIME;
            G.centerText = '第 ' + G.wave + ' 波清空';
            G.centerColor = '#f2f2f4';
            G.centerTimer = 1.6;
            // 第 5 波清完 → 武器升级站解锁（只解锁一次）
            if (G.wave >= UP_UNLOCK_WAVE && !G.upgUnlocked) {
              G.upgUnlocked = true;
              G.toast = '武器升级站已开放（按 E）';
              G.toastTimer = 2.6;
              Sfx.play('clear');
            }
          }
        }
      } else if (G.intermission > 0) {
        // 整备期间玩家仍可自由走动、去补给点买装备
        G.intermission -= dt;
        if (G.intermission <= 0) {
          // 双倍分 buff 逐波递减
          if (G.doubleScore > 0) G.doubleScore--;
          startWave();
        }
      }
      // 剧情模式：清场后走到终点才过关结算
      if (G.mode === 'story' && W.cleared && W.exit) {
        if (G.goBack > 0) G.goBack += dt;   // GO BACK 提示的存活时间（只用于动画相位）
        const dx = G.player.x - W.exit.x, dy = G.player.y - W.exit.y;
        if (dx * dx + dy * dy < TILE * TILE * 1.5) {
          G.state = 'storyclear';
          G.storyClearT = 0;
          Sfx.play('clear');
        }
      }
      if (!G.player.alive) {
        G.state = 'dead';
        G.deadTimer = 0;
        G.timeScale = 0.35;
        G.slowTimer = 0.8;
        if (G.mode === 'story') {
          G.centerText = '你死了\n' + (STORY_LEVELS[G.storyLevel] ? STORY_LEVELS[G.storyLevel].title : '');
          G.centerColor = '#ff5f8a';
        } else {
          G.centerText = '你死了\n撑到第 ' + G.wave + ' 波';
          G.centerColor = '#ff7a7a';
        }
        G.centerTimer = 0;
        Sfx.play('die');
      }
    } else if (G.state === 'dead') {
      G.deadTimer += dt;
      if (G.deadTimer >= 3.2) {
        // 剧情模式死亡：重开当前关；挑战模式：重开整局
        if (G.mode === 'story') startGame({ mode: 'story', prep: false });
        else startGame({ prep: false });
      }
    } else if (G.state === 'storyclear') {
      // 评分结算：等玩家点击/按键进入下一关或重开
      G.storyClearT += dt;
    }
    FX.update(dt);
    // 冲击波：0.42 秒扩到半径再消失
    for (let i = BLASTS.length - 1; i >= 0; i--) {
      const b = BLASTS[i];
      b.t += dt;
      if (b.t >= 0.42) BLASTS.splice(i, 1);
    }
    if (dt > 0) updateCamera(dt);
  }

  // ---------------------------------------------------------------- 绘制
  function drawGround() {
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    void cw; void ch;
    // 地板：相邻格子交替两张贴图，制造脏感
    for (let y = 0; y < W.h; y++) {
      for (let x = 0; x < W.w; x++) {
        const ch2 = W.rows[y][x];
        if (ch2 === '#') continue;
        const img = ((x * 7 + y * 13) % 5 === 0) ? IMG.floor2 : IMG.floor;
        ctx.drawImage(img, x * TILE, y * TILE, TILE, TILE);
        // 'r' = 楼外街道：压暗成柏油路面，一眼看出"这是门外"
        if (ch2 === 'r') {
          ctx.fillStyle = 'rgba(4,4,6,0.66)';
          ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
        }
      }
    }
  }

  /** 视野覆盖的格子范围（含相机越界部分），用于只画看得见的墙。 */
  function visibleTileRange() {
    const z = camZoom();
    const viewW = VIEW_W / z, viewH = VIEW_H / z;
    return {
      x0: Math.floor(G.cam.x / TILE) - 1,
      y0: Math.floor(G.cam.y / TILE) - 1,
      x1: Math.ceil((G.cam.x + viewW) / TILE) + 1,
      y1: Math.ceil((G.cam.y + viewH) / TILE) + 1
    };
  }

  function drawWalls() {
    const r = visibleTileRange();
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        // 地图外一律当墙：外圈本来就是 '#',继续铺出去视觉上就是更厚的楼体
        const solid = (x < 0 || y < 0 || x >= W.w || y >= W.h) || W.rows[y][x] === '#';
        if (!solid) continue;
        ctx.drawImage(IMG.wall, x * TILE, y * TILE, TILE, TILE);
      }
    }
  }

  function drawCovers() {
    for (const c of W.covers) {
      ctx.drawImage(IMG.cover, c.x, c.y, TILE, TILE);
      // 落地阴影：往右下压一点，木箱才是"立"在地上的
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(c.x + 2, c.y + TILE - 3, TILE - 2, 3);
    }
  }

  /** 油桶：俯视只能看到桶顶，靠"红橙色 + 两道加强筋 + 高光"认出来。 */
  function drawBarrels() {
    const t = performance.now() / 1000;
    for (const b of W.barrels) {
      if (!b.alive) continue;
      // 中弹/引信燃烧时抖一抖，视觉上告诉玩家"这个要炸了"
      const jx = b.shake > 0 ? (Math.random() - 0.5) * b.shake * 2.2 : 0;
      const jy = b.shake > 0 ? (Math.random() - 0.5) * b.shake * 2.2 : 0;
      const lit = b.fuse > 0;
      ctx.save();
      ctx.translate(b.x + jx, b.y + jy);
      // 落地阴影
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.beginPath();
      ctx.ellipse(1.5, 4, 9.4, 6.4, 0, 0, 6.283);
      ctx.fill();
      // 桶身：外圈暗红（桶壁厚度）+ 内圈亮红（桶面）
      ctx.fillStyle = lit ? (Math.sin(t * 42) > 0 ? '#ff6a3a' : '#b8361e') : '#8c2e20';
      ctx.beginPath();
      ctx.arc(0, 0, 8.6, 0, 6.283);
      ctx.fill();
      ctx.fillStyle = lit ? '#ff8f5a' : '#b83c28';
      ctx.beginPath();
      ctx.arc(0, 0, 7.2, 0, 6.283);
      ctx.fill();
      ctx.strokeStyle = '#2a1210';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(0, 0, 8.6, 0, 6.283);
      ctx.stroke();
      // 顶盖：偏一点心 + 一个小桶口，读起来才是"斜看一个圆柱"，不是靶心
      ctx.fillStyle = lit ? '#ffc49a' : '#d8664a';
      ctx.beginPath();
      ctx.arc(0.7, -0.6, 4.7, 0, 6.283);
      ctx.fill();
      ctx.fillStyle = 'rgba(56,18,14,0.72)';
      ctx.beginPath();
      ctx.arc(-1.7, 1.3, 1.5, 0, 6.283);
      ctx.fill();
      // 左上沿壁高光（金属反光）
      ctx.strokeStyle = 'rgba(255,220,190,0.55)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, 7.6, -2.5, -1.15);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** 飞行中的手雷：弹体 + 引信火花，最后 0.7 秒整颗红闪（准备爆炸警告）。 */
  function drawGrenades() {
    for (const g of G.grenades) {
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(1, 3, 4, 2.6, 0, 0, 6.283);
      ctx.fill();
      const urgent = g.t < GRENADE_BLINK;
      // 红闪：接近爆炸时整颗弹体在灰绿色和红色之间交替
      const blinkOn = Math.sin(g.spin * 14) > 0;
      if (urgent && blinkOn) {
        ctx.fillStyle = '#e23a2a';
      } else {
        ctx.fillStyle = '#4a5a3a';
      }
      ctx.beginPath(); ctx.arc(0, 0, 3.4, 0, 6.283); ctx.fill();
      ctx.strokeStyle = urgent && blinkOn ? '#7a1410' : '#1a2015';
      ctx.lineWidth = 1;
      ctx.stroke();
      // 引信火花：普通时橙黄，危急时鲜红
      ctx.fillStyle = urgent ? '#ff3a2a' : '#e02929';
      ctx.beginPath(); ctx.arc(0, -3.1, 1.4, 0, 6.283); ctx.fill();
      ctx.restore();
    }
  }

  /** 冲击波：一圈扩张的白环 + 一层橙色余晖。 */
  function drawBlasts() {
    for (const b of BLASTS) {
      const k = clamp(b.t / 0.42, 0, 1);
      const r = b.r * (0.32 + k * 0.78);
      ctx.save();
      ctx.globalAlpha = (1 - k) * 0.85;
      ctx.strokeStyle = '#ffd090';
      ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, 6.283); ctx.stroke();
      ctx.globalAlpha = (1 - k) * 0.18;
      ctx.fillStyle = '#ff8a3a';
      ctx.beginPath(); ctx.arc(b.x, b.y, r * 0.7, 0, 6.283); ctx.fill();
      ctx.restore();
    }
  }

  function drawDoors() {
    for (const d of W.doors) {
      ctx.save();
      ctx.translate(d.x, d.y);
      if (d.open) {
        const a = clamp(d.t * 3, 0, 1);
        ctx.globalAlpha = 1 - a * 0.75;
        ctx.rotate(a * 1.1);
        ctx.translate(-a * 8, 0);
      }
      ctx.drawImage(IMG.door, -TILE / 2, -TILE / 2, TILE, TILE);
      ctx.restore();
    }
  }

  function drawSupplies() {
    for (const s of (W.supplies || [])) {
      const t = performance.now() / 1000;
      const pulse = 0.5 + 0.3 * Math.sin(t * 3);
      ctx.save();
      ctx.translate(s.x, s.y);
      // 地面光圈
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#5ad0ff';
      ctx.beginPath();
      ctx.arc(0, 0, 14 + Math.sin(t * 2) * 1.5, 0, 6.283);
      ctx.fill();
      ctx.globalAlpha = 1;
      // 补给箱图标
      ctx.fillStyle = '#2a4a5a';
      ctx.fillRect(-7, -7, 14, 14);
      ctx.fillStyle = '#4a9ac0';
      ctx.fillRect(-7, -7, 14, 3);
      ctx.fillStyle = '#cfe8f2';
      ctx.fillRect(-2, -5, 4, 10);
      ctx.fillRect(-5, -2, 10, 4);
      // 提示
      if (nearSupply() === s) {
        ctx.font = 'bold 9px "Microsoft YaHei", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#8fd8ff';
        ctx.fillText(inputMode === 'touch' ? '按 交互' : '按 E 补给', 0, -20);
      }
      ctx.restore();
    }
  }

  // 武器升级站：一挺橙红色的军械台，第 5 波前灰着
  function drawStations() {
    for (const s of (W.stations || [])) {
      const t = performance.now() / 1000;
      const unlocked = G.upgUnlocked;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = unlocked ? '#e02929' : '#3a3a40';
      ctx.beginPath();
      ctx.arc(0, 0, 14 + Math.sin(t * 2) * 1.5, 0, 6.283);
      ctx.fill();
      ctx.globalAlpha = 1;
      // 工作台
      ctx.fillStyle = unlocked ? '#6a4a1a' : '#3a3440';
      ctx.fillRect(-8, -7, 16, 14);
      ctx.fillStyle = unlocked ? '#e02929' : '#3a3a40';
      ctx.fillRect(-8, -7, 16, 3);
      // 台面上的枪托 + 枪管（一个向上的扳手/枪形图标）
      ctx.fillStyle = unlocked ? '#ffe1a0' : '#7a7088';
      ctx.fillRect(-1, -6, 3, 11);
      ctx.fillRect(-3, -6, 7, 2.5);
      if (nearStation() === s) {
        ctx.font = 'bold 9px "Microsoft YaHei", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = unlocked ? '#ffcf7a' : '#8d7f9c';
        ctx.fillText(unlocked
          ? (inputMode === 'touch' ? '按 交互' : '按 E 升级')
          : '第 ' + UP_UNLOCK_WAVE + ' 波后开放', 0, -20);
      }
      ctx.restore();
    }
  }

  // 剧情模式终点：清场前灰暗未激活，清场后红色脉动，走进即过关
  function drawExit() {
    if (!W.exit) return;
    const t = performance.now() / 1000;
    const active = (G.mode === 'story' && W.cleared);
    ctx.save();
    ctx.translate(W.exit.x, W.exit.y);
    // 地面光圈
    ctx.globalAlpha = active ? 0.32 + 0.2 * Math.sin(t * 3) : 0.22;
    ctx.fillStyle = active ? MIAMI.red : '#6a6a72';
    ctx.beginPath();
    ctx.arc(0, 0, 14 + Math.sin(t * 2) * 1.5, 0, 6.283);
    ctx.fill();
    ctx.globalAlpha = 1;
    // 出口门形图标：一个门框（不放文字，HUD/画面里都只用图形和数字）
    ctx.strokeStyle = active ? MIAMI.white : '#9a9aa2';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-8, 8); ctx.lineTo(-8, -4); ctx.lineTo(0, -10); ctx.lineTo(8, -4); ctx.lineTo(8, 8);
    ctx.stroke();
    // 清场后：往外扩的红色脉冲圈，远处也能一眼看到门口亮了
    if (active) {
      for (let i = 0; i < 2; i++) {
        const ph = ((t * 0.8 + i * 0.5) % 1);
        ctx.globalAlpha = (1 - ph) * 0.5;
        ctx.strokeStyle = MIAMI.red;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, 14 + ph * 26, 0, 6.283);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /** 红外激光：手里这把枪装了激光（laser > 0）就照一条红线，从枪口到准星。 */
  function drawLaser() {
    const p = G && G.player;
    if (!p || !p.alive) return;
    const def = p.weapon ? WEAPONS[p.weapon] : null;
    if (!def || def.melee) return;
    const u = gunUp(p.weapon);
    if (!u || !(u.laser > 0)) return;
    // 治疗/装护甲时枪收起来了，不照
    if (p.healing || p.plating) return;
    const lv = Math.min(u.laser, 3);
    const aim = aimDir();
    const dir = aim || p.facing;
    const base = Math.atan2(dir.y, dir.x);
    // 枪口（跟开火用同一个点）
    const mx = p.x + dir.x * 11 + Math.cos(base + Math.PI / 2) * 4;
    const my = p.y + dir.y * 11 + Math.sin(base + Math.PI / 2) * 4;
    // 终点：朝准星，最远照到射程 + 一截（激光视觉上略超出弹道射程，更"照得远"）
    const range = gunStat(p.weapon, 'range') + 60;
    const ex = p.x + dir.x * range;
    const ey = p.y + dir.y * range;
    // 被墙挡住就截断到墙跟前（激光穿不过墙）
    let wx = ex, wy = ey;
    const d = Math.hypot(ex - mx, ey - my);
    const step = d > 0 ? 8 / d : 0;
    for (let t = 0; t <= 1; t += step) {
      const sx = mx + (ex - mx) * t, sy = my + (ey - my) * t;
      if (pointSolid(W, sx, sy, 0)) { wx = sx; wy = sy; break; }
    }
    const alpha = 0.30 + 0.45 * (lv / 3);   // 等级越高越亮
    ctx.save();
    ctx.lineCap = 'round';
    // 外圈淡红光晕
    ctx.strokeStyle = 'rgba(255,50,50,' + (alpha * 0.35) + ')';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(wx, wy);
    ctx.stroke();
    // 中心亮红线
    ctx.strokeStyle = 'rgba(255,64,64,' + alpha + ')';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(wx, wy);
    ctx.stroke();
    // 枪口一个小红点（发光源头）
    ctx.fillStyle = 'rgba(255,120,120,' + alpha + ')';
    ctx.beginPath();
    ctx.arc(mx, my, 1.5, 0, 6.283);
    ctx.fill();
    ctx.restore();
  }

  function drawPickups() {
    for (const pk of W.pickups) {
      const bob = Math.sin(pk.bob) * 1.6;
      ctx.save();
      ctx.translate(pk.x, pk.y + bob);
      ctx.rotate(Math.sin(pk.bob * 0.5) * 0.12);
      ctx.globalAlpha = 0.35;
      ctx.drawImage(IMG.shadow, -16, -15, 32, 32);
      ctx.globalAlpha = 1;
      if (pk.def === 'medkit') {
        // 血包：白色医疗箱 + 红十字
        drawMedkitIcon();
      } else if (pk.def === 'ammo') {
        // 弹药：黄铜子弹盒
        drawAmmoIcon();
      } else {
        const img = IMG[WEAPONS[pk.def].icon];
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
      }
      ctx.restore();
    }
  }

  function drawMedkitIcon() {
    ctx.fillStyle = '#d8d4dc';
    ctx.fillRect(-6, -5, 12, 10);
    ctx.fillStyle = '#e8e6ec';
    ctx.fillRect(-6, -5, 12, 3);
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(-1.5, -4, 3, 8);
    ctx.fillRect(-4, -1.5, 8, 3);
  }

  function drawAmmoIcon() {
    ctx.fillStyle = '#c8a24a';
    ctx.fillRect(-5, -3, 10, 6);
    ctx.fillStyle = '#e8c86a';
    ctx.fillRect(-5, -3, 10, 2);
    ctx.fillStyle = '#8a6a28';
    ctx.fillRect(-5, 2, 10, 1);
  }

  // ---------------------------------------------------------------- 角色造型
  // 只有三样东西：一个头、两只圆手。手绕着头转、眼睛看向朝向。
  // 俯视角下这三样就是全部信息量，多画躯干、肩膀、腿只会糊成一团色块；
  // 而且手能连续跟着鼠标走，不必为 8 个方向各画一张贴图。
  // 红灰白黑主题：玩家 = 白（唯一的亮色，一眼认出）；敌人 = 不同深浅的灰；血 = 红（由血液贴图/特效承担）。
  const PALETTE = {
    player:        { head: '#f2f0ec', skin: '#d8d2c8' },
    enemy_melee:   { head: '#8a8a90', skin: '#9a9690' },
    enemy_gun:     { head: '#6e6e74', skin: '#8a857e' },
    enemy_shotgun: { head: '#55555c', skin: '#77726c' }
  };
  const HEAD_R = 5.8, HAND_R = 2.15, HAND_REACH = 12.0, HAND_ARC = 0.58;

  /**
   * 持枪手势：两只手在"枪身坐标系"里的位置（x 向前、y 沿枪身向下，原点在角色中心）。
   *
   * 枪是侧视贴图，所以 y 轴其实是"枪的上下"：握把/护木都在枪管下方，
   * 手必须落在那个高度才像"握着"。y 值的取法是"枪身下沿往下一点点"，
   * 这样手只压住握把/护木，枪管（贴图上方那 2px）完整露出来。
   *   - 手枪 / 冲锋枪：双手合握在握把（扳机）处，左手包在右手后侧一点
   *   - 霰弹枪：右手贴着头扣扳机（枪托夹在头右侧，几乎看不出托），左手前伸托住泵动护木；
   *     两只手离得越开、大小差得越多，"一手后一手前"才读得出来 —— 所以单独给了更小的
   *     `rs`/`ls` 半径系数（默认 0.92 / 0.8），否则 4px 的拳头会把枪托和护木全糊掉。
   * 近战/空手不在表里，走默认的"绕头对称"摆法。
   */
  const GRIP = {
    pistol:  { r: [10.8, 4.9], l: [9.2, 5.8] },
    smg:     { r: [11.0, 5.0], l: [9.4, 5.9] },
    shotgun: { r: [8.2, 4.0], l: [15.0, 4.4], rs: 0.8, ls: 0.66 },
    // 武士刀：单手握柄，右手握在刀镡后方的刀柄上（贴图里刀柄 x=1..5，约在角色前方 6~9px），
    // 左手靠后虚扶柄末。手落点偏后，让长刀身完全露出来，别让手糊在刀刃上。
    knife:   { r: [7.6, 1.6], l: [4.6, 2.6], rs: 0.72, ls: 0.68 }
  };

  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.round(((n >> 16) & 255) * k));
    const g = Math.min(255, Math.round(((n >> 8) & 255) * k));
    const b = Math.min(255, Math.round((n & 255) * k));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function dot(x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /** 手里端着的消耗品：血包（白盒红十字）/ 护甲板（钢板）。原点在捧着的中心。 */
  function drawHeldItem(kind) {
    if (kind === 'medkit') {
      ctx.fillStyle = '#12101a';
      ctx.fillRect(-7.2, -5.8, 14.4, 11.6);
      ctx.fillStyle = '#eae5db';
      ctx.fillRect(-6.2, -4.8, 12.4, 9.6);
      ctx.fillStyle = '#cf3a30';
      ctx.fillRect(-1.35, -3.6, 2.7, 7.2);    // 红十字
      ctx.fillRect(-3.7, -1.35, 7.4, 2.7);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(-6.2, -4.8, 12.4, 1.4);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(-6.2, 3.4, 12.4, 1.4);
      return;
    }
    if (kind === 'grenade') {
      // 手持手雷：绿壳圆弹 + 顶部引信环，蓄势待投
      ctx.fillStyle = '#12100e';
      ctx.beginPath(); ctx.arc(0, 0, 5.2, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#4a5a3a';
      ctx.beginPath(); ctx.arc(0, 0, 4.4, 0, 6.283); ctx.fill();
      ctx.strokeStyle = '#1a2015';
      ctx.lineWidth = 0.9;
      ctx.stroke();
      ctx.fillStyle = '#2a3a22';
      ctx.fillRect(-1.2, -7.4, 2.4, 2.6);        // 引信座
      ctx.strokeStyle = '#c9b877';
      ctx.beginPath(); ctx.arc(0, -6.4, 1.8, -0.6, 3.7); ctx.stroke();   // 拉环
      ctx.fillStyle = '#e02929';
      ctx.beginPath(); ctx.arc(0, -4.6, 1.0, 0, 6.283); ctx.fill();       // 引信火花
      return;
    }
    // 护甲板：带斜切下角的钢板
    const platePath = (dx, dy, w, h, cut) => {
      ctx.beginPath();
      ctx.moveTo(dx, dy);
      ctx.lineTo(dx + w, dy);
      ctx.lineTo(dx + w, dy + h - cut);
      ctx.lineTo(dx + w - cut, dy + h);
      ctx.lineTo(dx + cut, dy + h);
      ctx.lineTo(dx, dy + h - cut);
      ctx.closePath();
    };
    ctx.fillStyle = '#0b1018';
    platePath(-7.0, -6.0, 14.0, 12.0, 3.2);
    ctx.fill();
    ctx.fillStyle = '#5d88b0';
    platePath(-5.8, -4.9, 11.6, 9.8, 2.6);
    ctx.fill();
    ctx.fillStyle = '#a8cae5';
    ctx.fillRect(-5.8, -4.9, 11.6, 1.6);        // 顶部高光
    ctx.fillStyle = '#31506e';
    ctx.fillRect(-4.0, 0.8, 8.0, 1.3);          // 底部压暗
    ctx.fillStyle = '#d3e7f8';
    ctx.fillRect(-4.6, -2.9, 1.3, 1.3);         // 铆钉
    ctx.fillRect(3.3, -2.9, 1.3, 1.3);
  }

  /**
   * 断肢之后躺在地上的"剩下的那一坨"：一截压扁的布 + （头还在的话）脑袋 + 两处暗红断口。
   * 贴图版尸体（32px 面朝下）里手和头是长在身上的，胳膊被砍飞以后再原样贴回去，
   * 就成了"地上躺着一只手、身上还长着一只手"。所以断过肢的尸体不用贴图，改画这套残骸。
   * 局部坐标和尸体贴图一致：原点在身体中心，长边沿 x（调用前已经按 deathDir 转过）。
   */
  function drawRemains(pal, headless) {
    const cloth = shade(pal.head, 0.58);
    const dark = shade(pal.head, 0.4);
    const rim = 'rgba(0,0,0,0.62)';
    const blood = 'rgba(150,18,32,0.9)';
    ctx.lineCap = 'round';
    // 腿：先从躯干后面拖出去一小截（先画，被躯干盖住根部），轮廓才不是个圆饼
    ctx.strokeStyle = rim;
    ctx.lineWidth = 7.4;
    ctx.beginPath(); ctx.moveTo(-6.6, 0); ctx.lineTo(-9.6, 0); ctx.stroke();
    ctx.strokeStyle = dark;
    ctx.lineWidth = 5.6;
    ctx.beginPath(); ctx.moveTo(-6.6, 0); ctx.lineTo(-9.6, 0); ctx.stroke();
    // 躯干：一段压扁的圆头胶囊（长边沿 x），先黑描边再压布色
    ctx.strokeStyle = rim;
    ctx.lineWidth = 10.6;
    ctx.beginPath(); ctx.moveTo(-5.4, 0); ctx.lineTo(2.0, 0); ctx.stroke();
    ctx.strokeStyle = cloth;
    ctx.lineWidth = 8.6;
    ctx.beginPath(); ctx.moveTo(-5.4, 0); ctx.lineTo(2.0, 0); ctx.stroke();
    // 头：还在就画在 +x 那头（面朝下，露后脑 + 一点侧脸）
    if (!headless) {
      ctx.fillStyle = rim;
      ctx.beginPath(); ctx.arc(6.4, 0, 5.0, 0, 6.283); ctx.fill();
      ctx.fillStyle = pal.head;
      ctx.beginPath(); ctx.arc(6.4, 0, 4.4, 0, 6.283); ctx.fill();
      ctx.fillStyle = pal.skin;
      ctx.beginPath(); ctx.arc(7.9, 0.5, 2.7, 0, 6.283); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.55)';            // 一只闭着的眼：读成"侧着躺"而不是一张正脸
      ctx.beginPath(); ctx.ellipse(7.6, -1.6, 1.5, 0.5, 0.5, 0, 6.283); ctx.fill();
      ctx.fillStyle = blood;                          // 脖子一圈血
      ctx.beginPath(); ctx.ellipse(2.9, 0, 1.3, 2.1, 0, 0, 6.283); ctx.fill();
    } else {
      ctx.fillStyle = blood;                          // 头没了：只剩脖子断口
      ctx.beginPath(); ctx.ellipse(3.4, 0, 2.0, 2.4, 0, 0, 6.283); ctx.fill();
    }
    // 肩两侧的断口（两条胳膊被砍飞的地方）
    ctx.fillStyle = blood;
    ctx.beginPath(); ctx.ellipse(-1.4, -3.8, 1.7, 1.1, 0.4, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-1.0, 3.8, 1.6, 1.0, -0.4, 0, 6.283); ctx.fill();
  }

  function drawActor(a, tex, isPlayer, corpse) {
    // 精英整体放大：头、手、枪、阴影一起缩放，不用单独做一套贴图
    const sc = a.scale || 1;
    ctx.save();
    ctx.translate(a.x, a.y);
    if (sc !== 1) ctx.scale(sc, sc);
    ctx.globalAlpha = a.alive ? 0.55 : 0.22;
    ctx.drawImage(IMG.shadow, -8, -8, 16, 16);
    ctx.globalAlpha = 1;

    // 精英/BOSS：脚下一圈脉动的环。光靠体型区分不够，混战时一眼要能认出来
    if ((a.elite || a.boss) && a.alive) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
      ctx.globalAlpha = 0.3 + pulse * 0.25;
      ctx.strokeStyle = a.boss ? '#f2f2f4' : '#c8c8d0';   // BOSS 亮白环、精英浅灰环（红留给血）
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, 6.283);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (!a.alive) {
      // 尸体是单独画的贴图（面朝下摊开），不是把活人转个角度
      ctx.rotate(a.deathDir + 0.18);
      ctx.globalAlpha = 0.92;
      if (a.gibbed || a.dismember) {
        // 断肢之后：贴图里那两只手/那颗头已经飞出去了，不能再原样贴一遍
        drawRemains(PALETTE[tex] || PALETTE.player, a.gibbed);
      } else {
        ctx.drawImage(IMG[corpse] || IMG.corpse_player, -16, -16, 32, 32);
      }
      ctx.restore();
      return;
    }

    const ang = isPlayer ? Math.atan2(a.facing.y, a.facing.x) : a.facing;
    const pal = PALETTE[tex] || PALETTE.player;
    const rim = shade(pal.head, 0.4);

    // 手里拿什么：治疗时端血包、装护甲时捧护甲板、持雷时抓手雷（这时枪收起来了）
    const holding = (isPlayer && (a.healing || a.plating || a.grenadeHeld))
      ? (a.healing ? 'medkit' : (a.plating ? 'plate' : 'grenade')) : null;
    const held = holding || a.weapon;

    // 武器：枪口永远朝向 facing。长枪（22px 的霰弹枪）按多出来的宽度整体前移，
    // 枪托位置不变、枪管多伸一截。
    const wimg = (held && !holding) ? IMG[WEAPONS[held].icon] : null;
    const gunShift = wimg ? (wimg.width - 18) * 0.36 : 0;
    const kick = isPlayer ? a.kick : 0;

    // 换弹动画：整把枪（连带两只手）往回收、往右手边侧倾一点，期间小幅发抖，
    // 进度过半再推回去。位移走 sin(π·prog)，起手和收尾都是 0 —— 和"拔弹匣→塞弹匣→拍上"的节奏对得上。
    // 俯视视角下光靠平移很难看出来，所以加了侧倾（tilt），一眼能认出"枪被端到身前了"。
    let pull = 0, pullY = 0, tilt = 0;
    if (isPlayer && a.reload > 0 && a.reloadTotal > 0) {
      const prog = clamp(1 - a.reload / a.reloadTotal, 0, 1);
      const e = Math.sin(Math.PI * prog);
      pull = e * 5.2;                                // 枪往回收（局部 x 负方向）
      pullY = e * 1.5;                               // 往右手边压
      pullY += Math.sin(prog * 52) * e * 0.7;        // 手上动作的细抖
      tilt = e * 0.17;                               // 侧倾约 10°
    } else if (isPlayer && a.swapT > 0 && a.swapTotal > 0) {
      // 换枪动画：枪往回收、随进度转一个角，模拟"收起→掏出"。前 40% 收进去，后 60% 再端出来。
      const prog = clamp(1 - a.swapT / a.swapTotal, 0, 1);
      const e = Math.sin(Math.PI * Math.min(1, prog * 1.6));   // 起手收、末尾回，中间最深
      pull = e * 7.5;                                // 比换弹收得更深，一眼看出"在换家伙"
      tilt = -e * 0.22;                              // 反方向侧倾，跟换弹区分开
    } else if (isPlayer && a.equipT > 0 && a.equipTotal > 0 && !holding) {
      // 切回枪 / 切消耗品的过渡：枪做一个"收起→端出"的小动作，和掏消耗品的节奏对上
      const prog = clamp(1 - a.equipT / a.equipTotal, 0, 1);
      const e = Math.sin(Math.PI * Math.min(1, prog * 1.6));
      pull = e * 6.0;
      tilt = e * 0.10;
    }
    const angG = ang + tilt;                         // 枪和手用这个角度

    // 近战挥舞：整把武器绕身侧扫过一段角度（swingA），同时往前送一点（swingR）。
    // 角度用 (2·prog-1)·sin(π·prog)：起手/收势都是 0，中段扫到最大 —— 动画收尾不会"跳一下"。
    let swingA = 0, swingR = 0;
    const meleeDef = (!holding && held && WEAPONS[held] && WEAPONS[held].melee)
      ? WEAPONS[held] : null;
    if (meleeDef && a.swingT > 0 && a.swingTotal > 0) {
      const prog = clamp(1 - a.swingT / a.swingTotal, 0, 1);
      const wave = Math.sin(prog * Math.PI);
      swingA = (a.swingDir || 1) * (2 * prog - 1) * wave * 2.4;
      swingR = wave * 5.5;
    }

    // 双持（手枪/冲锋枪进化后）：左右手各一把，**镜像对称、枪口都对准心**。
    // 两把枪沿枪身法线方向左右错开（dualOff），但都不偏转角度 —— 枪口平行地朝 facing（准心）。
    // 左手枪沿枪管轴上下翻转（scale 1,-1），握把从「枪身下方」翻到「枪身上方」，
    // 于是左手枪是右手枪关于枪管中线的「镜中倒影」，左右手对称各握一把。
    const isDual = isPlayer && !holding && held && gunEvolved(held) && DUAL_GUNS[held];
    const dualOff = isDual ? 3.6 : 0;       // 每把枪起点离中线的法向偏移（px），左右对称

    if (wimg) {
      for (const s of (isDual ? [1, -1] : [0])) {
        // s=+1 右手枪：起点偏右、正常画（握把在下）；s=-1 左手枪：起点偏左、沿枪管轴上下翻转（握把在上）。
        // 两把枪都朝 facing（准心），不偏角度；左右只差一个法向错位 + 一面上下镜像。
        // 注意：rotate 之后 translate 的 y 轴已经是「垂直于枪管」的法向，所以错位直接
        // 加到 translate 的 y 上（±dualOff）即可 —— 绝不能再用世界坐标系法向量 (nxG,nyG)
        // 混进局部坐标，否则一转身错位方向就歪，枪会从手上「滑出去」。
        ctx.save();
        ctx.rotate(angG + (isDual ? 0 : swingA));
        ctx.translate(11.6 + gunShift - kick - pull + (isDual ? 0 : swingR),
                      2 + pullY + s * dualOff);
        ctx.scale(0.72, 0.72 * (isDual && s < 0 ? -1 : 1));   // 左手枪沿枪管轴上下镜像
        ctx.drawImage(wimg, -wimg.width / 2, -wimg.height / 2);
        ctx.restore();
      }
    }

    // 手：两条路径 —— 持枪走 GRIP 里的手势位，其余（近战/空手/捧东西）绕朝向对称摆。
    // 画在枪**之上**（手得压住枪身下沿才像握着），但位置都落在枪身下沿往下一点点：
    // 只盖住握把/护木，不糊住枪管 —— 手一旦扣在枪管上，整把枪就看不见了。
    const hands = [];
    const grip = (!holding && held) ? GRIP[held] : null;
    if (grip) {
      // 后坐时手跟着枪一起往回缩，不然会看到"枪缩了、手还伸着"；换弹内收同理
      const back = gunShift - kick * 0.5 - pull;
      if (isDual) {
        // 双持：右手握右枪（握把在下，y 正）、左手握左枪（握把在上，y 负 —— 镜像）。
        // 两把枪角度相同、都朝准心，所以手不叠偏转角（da=0）；左手枪上下翻转后，
        // 左手握点也沿枪管轴镜像（y 变负），落在翻转后握把的「上方」，形成「镜中倒影」持枪。
        hands.push({ x: grip.r[0] + back, y: grip.r[1] + pullY + dualOff, r: HAND_R * (grip.rs || 0.92), da: 0 });   // 右手握右枪（握把在下）
        hands.push({ x: grip.r[0] + back, y: -(grip.r[1]) + pullY - dualOff, r: HAND_R * (grip.rs || 0.92), da: 0 }); // 左手握左枪（握把在上，镜像）
      } else {
        hands.push({ x: grip.r[0] + back, y: grip.r[1] + pullY, r: HAND_R * (grip.rs || 0.92), da: 0 });   // 右手扣扳机
        hands.push({ x: grip.l[0] + back, y: grip.l[1] + pullY, r: HAND_R * (grip.ls || 0.8), da: 0 });    // 左手托护木/包握把
      }
    } else {
      const arc = holding ? HAND_ARC * 0.62 : HAND_ARC;
      const reach = (holding ? HAND_REACH * 1.12 : HAND_REACH) + swingR;
      const hr = holding ? HAND_R * 0.9 : HAND_R;
      // 空手勾拳：右拳从身侧扫到身前（角度扫过约 2.4rad、半径中段最长），
      // 左拳同时往回收半格 —— 两只手一进一退才像出拳，两只手一起往前伸像"推门"。
      let punchP = -1;
      if (isPlayer && !held && !holding && a.punchT > 0) {
        punchP = clamp(1 - a.punchT / PUNCH_TIME, 0, 1);
      }
      if (punchP >= 0) {
        const out = Math.sin(punchP * Math.PI);
        const dir = a.swingDir || 1;
        const ra = dir * (arc * 1.7 - 2.4 * punchP);
        hands.push({ x: Math.cos(ra) * (reach + out * 10), y: Math.sin(ra) * (reach + out * 10), r: hr, da: 0 });
        const la = -dir * arc * 1.05;
        const lr = reach - out * 2.6;
        hands.push({ x: Math.cos(la) * lr, y: Math.sin(la) * lr, r: hr * 0.92, da: 0 });
      } else {
        for (const s of [-1, 1]) {
          hands.push({ x: Math.cos(s * arc) * reach, y: Math.sin(s * arc) * reach, r: hr, da: 0 });
        }
      }
    }
    // 近战挥舞时，握持的手要跟着武器一起扫（否则会出现"刀飞出去、手留在原地"）
    if (meleeDef) for (const h of hands) h.x += swingR;
    for (const h of hands) {
      // 局部（枪身坐标系）→ 世界：跟着朝向旋转（双持时每只手再叠自己那把枪的偏转角，
      // 换弹时再叠一点侧倾，手才不会留在枪外面；近战挥砍时叠挥砍角）
      const ha = angG + (h.da || 0) + (meleeDef ? swingA : 0);
      const hx = Math.cos(ha) * h.x - Math.sin(ha) * h.y;
      const hy = Math.sin(ha) * h.x + Math.cos(ha) * h.y;
      dot(hx, hy, h.r + 0.9, rim);
      dot(hx, hy, h.r, pal.skin);
      dot(hx - 0.6, hy - 0.7, h.r * 0.38, shade(pal.skin, 1.22));
    }

    // 捧着的消耗品：压在手上面，才像"手里正拿着它"，不被手挡住。
    // 切换时从怀里掏出：前段缩在胸前（小、靠后），后段伸到手上（正常大小、前伸）。
    if (holding) {
      let eq = 1, eqReach = 0;
      if (isPlayer && a.equipT > 0 && a.equipTotal > 0) {
        const prog = clamp(1 - a.equipT / a.equipTotal, 0, 1);   // 0→1 掏出过程
        eq = 0.55 + 0.45 * Math.sin(Math.PI * prog * 0.5 + Math.PI * 0.5);   // 小 → 正常
        eqReach = (1 - Math.sin(Math.PI * Math.min(1, prog * 1.4))) * 4.5;     // 后 → 前
      }
      ctx.save();
      ctx.rotate(ang);
      ctx.translate(14.6 - eqReach, 0);
      ctx.scale(0.9 * eq, 0.9 * eq);
      drawHeldItem(holding);
      ctx.restore();
    }

    // 头
    dot(0, 0, HEAD_R + 0.9, rim);
    dot(0, 0, HEAD_R, pal.head);
    dot(-1.2, -1.5, 1.5, shade(pal.head, 1.08));

    // 眼睛：贴着朝向，瞳孔再往朝向偏一点
    for (const s of [-1, 1]) {
      const ea = ang + s * 0.42;
      const ex = Math.cos(ea) * HEAD_R * 0.6;
      const ey = Math.sin(ea) * HEAD_R * 0.6;
      dot(ex + Math.cos(ang) * 0.3, ey + Math.sin(ang) * 0.3, 1.05, '#1a141e');
      dot(ex - Math.cos(ang) * 0.7, ey - Math.sin(ang) * 0.7 - 0.4, 0.36, '#fcfaf4');
    }

    // 警觉标记：敌人头顶常驻图标，一眼看出状态。
    //   ?（黄）= 听到动静、正在怀疑/查看   !（红）= 已发现玩家、追击中
    if (!isPlayer && a.alive && a.state === 'investigate') {
      ctx.font = 'bold 11px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd76e';
      ctx.fillText('?', 0, -17);
    } else if (!isPlayer && a.alive && a.state === 'chase') {
      ctx.font = 'bold 11px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff5a5a';
      ctx.fillText('!', 0, -17);
    }

    ctx.restore();
  }

  function drawEffects() {
    for (const t of FX.tracers) {
      ctx.save();
      ctx.globalAlpha = clamp(t.t / 0.07, 0, 1);
      ctx.strokeStyle = t.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(t.x1, t.y1);
      ctx.lineTo(t.x2, t.y2);
      ctx.stroke();
      ctx.restore();
    }
    // 飞在空中的断肢：转着飞、带一圈投影，落地那一刻贴进贴花层
    for (const g of FX.gibs) {
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(g.x + 1.5, g.y + 2.5, g.len * 0.42, g.w * 0.7, g.rot, 0, 6.283);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
      paintGib(ctx, g);
    }
    for (const p of FX.parts) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    // 血液喷溅：血雾先铺一层半透明的红，血珠沿速度方向拉成短条（看得出在飞）
    for (const s of FX.sprays) {
      const k = clamp(s.life / s.max, 0, 1);
      if (s.mist) {
        const r = s.size * (1.1 + (1 - k) * 2.8);
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
        g.addColorStop(0, s.color + '0.9)');
        g.addColorStop(0.55, s.color + '0.35)');
        g.addColorStop(1, s.color + '0)');
        ctx.globalAlpha = k * 0.55;
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, 6.283); ctx.fill();
        continue;
      }
      ctx.globalAlpha = clamp(k * 1.35, 0, 1);
      ctx.fillStyle = s.color;
      const sp = Math.hypot(s.vx, s.vy);
      if (sp > 46) {
        const len = Math.min(7.5, s.size + sp * 0.024);
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(Math.atan2(s.vy, s.vx));
        ctx.beginPath();
        ctx.ellipse(0, 0, len, s.size * 0.66, 0, 0, 6.283);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(s.x, s.y, s.size * 0.72, 0, 6.283); ctx.fill();
      }
    }
    // 碎甲片：旋转的方形，边转边淡出
    for (const s of FX.shards) {
      ctx.save();
      ctx.globalAlpha = clamp(s.life / s.max, 0, 1);
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.fillStyle = s.color;
      ctx.fillRect(-s.size / 2, -s.size / 2, s.size, s.size);
      ctx.restore();
    }
    // 换弹甩出去的旧弹匣 / 空弹壳。弹匣是小方块、弹壳是更小的红壳，都边转边淡出。
    // 地板本身偏暗，先勾一圈黑描边才看得出是"地上的东西"，不然像块脏点。
    for (const c of FX.clips) {
      const k = clamp(c.life / c.max, 0, 1);
      ctx.save();
      ctx.globalAlpha = k;
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      if (c.type === 'shell') {
        // 空弹壳：红铜色小壳，比弹匣小一截
        ctx.fillStyle = '#0d0a11';
        ctx.fillRect(-1.7, -2.7, 3.4, 5.4);
        ctx.fillStyle = '#8a3a28';
        ctx.fillRect(-1.4, -2.4, 2.8, 4.8);
        ctx.fillStyle = '#c9684a';
        ctx.fillRect(-1.4, -2.4, 2.8, 1.3);
        ctx.fillStyle = '#5a2418';
        ctx.fillRect(-1.1, 1.1, 2.2, 1.3);
      } else {
        // 旧弹匣：收窄成长条，别再像块方砖占半个身子
        ctx.fillStyle = '#0d0a11';
        ctx.fillRect(-1.7, -3.0, 3.4, 6.0);
        ctx.fillStyle = '#4a4157';
        ctx.fillRect(-1.3, -2.5, 2.6, 5.0);
        ctx.fillStyle = '#8a7d96';
        ctx.fillRect(-1.3, -2.5, 2.6, 1.2);
        ctx.fillStyle = '#1a1524';
        ctx.fillRect(-0.85, 1.0, 1.7, 1.5);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawWorldTexts() {
    ctx.save();
    ctx.font = 'bold 8px "Microsoft YaHei", monospace';
    ctx.textAlign = 'center';
    for (const t of FX.texts) {
      ctx.globalAlpha = clamp(t.life / t.max, 0, 1);
      ctx.fillStyle = t.color;
      ctx.fillText(t.txt, t.x, t.y);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** 绘制触屏虚拟控件：双摇杆 + 动作按钮 + 暂停键（屏幕空间，不随世界缩放）。 */
  function drawTouchUI() {
    if (inputMode !== 'touch') return;
    const L = TOUCH_LAYOUT;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // ---- 左摇杆（移动）----
    ctx.globalAlpha = 0.30;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(L.moveBase.x, L.moveBase.y, L.moveBase.r, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(L.moveBase.x, L.moveBase.y, L.moveBase.r, 0, Math.PI * 2); ctx.fill();
    // 摇杆头
    const mhx = L.moveBase.x + touch.moveX, mhy = L.moveBase.y + touch.moveY;
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = touch.moveActive ? '#c8c8d0' : '#aeb6c2';
    ctx.beginPath(); ctx.arc(mhx, mhy, L.moveBase.r * 0.42, 0, Math.PI * 2); ctx.fill();

    // ---- 右摇杆（瞄准/开火）----
    ctx.globalAlpha = 0.30;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(L.aimBase.x, L.aimBase.y, L.aimBase.r, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(L.aimBase.x, L.aimBase.y, L.aimBase.r, 0, Math.PI * 2); ctx.fill();
    const ahx = L.aimBase.x + touch.aimX, ahy = L.aimBase.y + touch.aimY;
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = touch.aimActive ? '#ffe0c0' : '#c2b2a0';
    ctx.beginPath(); ctx.arc(ahx, ahy, L.aimBase.r * 0.42, 0, Math.PI * 2); ctx.fill();

    // ---- 独立开火键（仅"按键开火"模式显示；"摇杆开火"模式下隐藏，右摇杆拖到边缘即射击）----
    if (fireMode !== 'stick') {
      const fb = L.fireBtn;
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = touch.fireBtnActive ? '#ff6a5a' : '#e05040';
      ctx.beginPath(); ctx.arc(fb.x, fb.y, fb.r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px "Microsoft YaHei", monospace';
      ctx.fillText('开火', fb.x, fb.y + 1);
    }

    // ---- 独立瞄准键（按住抬枪 ADS；两种开火模式都显示）----
    {
      const ab = L.aimBtn;
      ctx.globalAlpha = touch.aimBtnActive ? 0.55 : 0.35;
      ctx.fillStyle = touch.aimBtnActive ? '#7fdca0' : '#3f6b54';
      ctx.beginPath(); ctx.arc(ab.x, ab.y, ab.r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px "Microsoft YaHei", monospace';
      ctx.fillText('瞄准', ab.x, ab.y + 1);
    }

    // ---- 动作按钮 ----
    for (const b of L.buttons) {
      // 「换弹」只有挑战模式有（剧情没有备弹）；「扔枪」两种模式都能用
      if (b.key === 'r' && G.mode === 'story') continue;
      const act = !!touchPressed[b.key];
      ctx.globalAlpha = act ? 0.55 : 0.30;
      ctx.fillStyle = act ? '#c8c8d0' : '#3a3a40';
      ctx.beginPath(); ctx.arc(b.x, b.y, L.btnR, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px "Microsoft YaHei", monospace';
      ctx.fillText(b.label, b.x, b.y + 1);
    }

    // ---- 暂停键（左上角）----
    const pp = TOUCH_PAUSE;
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#5a5f6a';
    ctx.beginPath(); ctx.arc(pp.x, pp.y, pp.r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.fillStyle = '#fff';
    ctx.fillRect(pp.x - 4, pp.y - 7, 3, 14);
    ctx.fillRect(pp.x + 1, pp.y - 7, 3, 14);

    // ---- 跳过按钮（整备倒计时期间显示）----
    if (G.state === 'play' && W.cleared && G.intermission > 0) {
      const s = TOUCH_SKIP;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#e02929';
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(s.x - s.w / 2, s.y - s.h / 2, s.w, s.h, 8); ctx.fill(); }
      else ctx.fillRect(s.x - s.w / 2, s.y - s.h / 2, s.w, s.h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#2a2010';
      ctx.font = 'bold 13px "Microsoft YaHei", monospace';
      ctx.fillText('跳过', s.x, s.y + 1);
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawVignette() {
    if (!G.vignette) {
      const g = ctx.createRadialGradient(
        VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.22,
        VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.80
      );
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.62)');
      G.vignette = g;
    }
    ctx.fillStyle = G.vignette;
    // 抬枪时把边缘暗角压淡一档：视野一宽，四角那圈黑会正好盖在"想看远"的地方
    const vt = clamp((G.player && G.player.aimT) || 0, 0, 1);
    ctx.save();
    ctx.globalAlpha = 1 - 0.45 * vt;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.restore();
  }

  function drawHUD() {
    ctx.save();
    ctx.textBaseline = 'top';

    // 剧情模式：极简 HUD —— 只有数字（右上剩余人数/分数、左下武器+子弹）
    if (G.mode === 'story') {
      drawStoryHUD();
    } else {
      // 左上：模式标签（挑战模式显示波次）
      ctx.font = 'bold 12px "Microsoft YaHei", monospace';
      ctx.textAlign = 'left';
      const waveLabel = G.wave > 0 ? '第 ' + G.wave + ' 波' : '准备中';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(waveLabel, 11 + HUD_OFF.wave.x, 11 + HUD_OFF.wave.y);
      ctx.fillStyle = '#c8c8d0';
      ctx.fillText(waveLabel, 10 + HUD_OFF.wave.x, 10 + HUD_OFF.wave.y);

      // 右上：现金（击杀所得，商店货币）
      ctx.textAlign = 'right';
      ctx.font = 'bold 13px "Microsoft YaHei", monospace';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText('$' + G.cash, VIEW_W - 9 + HUD_OFF.cash.x, 11 + HUD_OFF.cash.y);
      ctx.fillStyle = '#e02929';
      ctx.fillText('$' + G.cash, VIEW_W - 10 + HUD_OFF.cash.x, 10 + HUD_OFF.cash.y);

      // 左下：血量 + 护甲（只给条和格，不标数值）
      drawBodyHUD();

      // 右下：主副武器 / 消耗品，每行挂上对应按键
      drawLoadoutHUD();

      // 正下方：只剩小半匣时提示按 R
      drawReloadHint();
    }

    // 连击（挑战模式才显示；剧情模式 HUD 只允许数字）
    if (G.mode !== 'story' && G.combo > 1 && G.comboTimer > 0) {
      ctx.textAlign = 'right';
      ctx.font = 'bold 14px "Microsoft YaHei", monospace';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText('x' + G.combo, VIEW_W - 9 + HUD_OFF.combo.x, 29 + HUD_OFF.combo.y);
      ctx.fillStyle = '#e02929';
      ctx.fillText('x' + G.combo, VIEW_W - 10 + HUD_OFF.combo.x, 28 + HUD_OFF.combo.y);
    }

    // 中下：提示（剧情模式不放文字提示）
    if (G.mode !== 'story' && G.toastTimer > 0 && G.toast) {
      ctx.globalAlpha = clamp(G.toastTimer, 0, 1);
      ctx.textAlign = 'center';
      ctx.font = 'bold 11px "Microsoft YaHei", monospace';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      // 顶部中间留给提示：底部两侧已经被血量/装备栏占住了
      ctx.fillText(G.toast, VIEW_W / 2 + 1, 45);
      ctx.fillStyle = '#c9bfd4';
      ctx.fillText(G.toast, VIEW_W / 2, 44);
      ctx.globalAlpha = 1;
    }

    // 中央大字
    if (G.centerText) {
      const lines = G.centerText.split('\n');
      ctx.textAlign = 'center';
      ctx.font = 'bold 26px Consolas, "Microsoft YaHei", monospace';
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], VIEW_W / 2 + 1, VIEW_H / 2 - 20 + i * 28 + 1);
      }
      ctx.fillStyle = G.centerColor;
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], VIEW_W / 2, VIEW_H / 2 - 20 + i * 28);
      }
      if (G.state === 'dead' && G.deadTimer > 0.5) {
        const left = Math.max(1, Math.ceil(3.2 - G.deadTimer));
        ctx.font = 'bold 12px "Microsoft YaHei", monospace';
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillText(left + ' 秒后自动重来', VIEW_W / 2 + 1, VIEW_H / 2 + 41);
        ctx.fillStyle = '#f2f2f4';
        ctx.fillText(left + ' 秒后自动重来', VIEW_W / 2, VIEW_H / 2 + 40);
      }
    }

    // 倒计时：开局准备 / 波次清空后整备，附空格跳过提示
    if (G.state === 'play' && W.cleared && G.intermission > 0) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 13px "Microsoft YaHei", monospace';
      const secs = Math.ceil(G.intermission);
      const txt = (G.wave === 0 ? '准备 ' : '下一波 ') + secs + ' 秒';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(txt, VIEW_W / 2 + 1, VIEW_H / 2 + 61);
      ctx.fillStyle = '#e02929';
      ctx.fillText(txt, VIEW_W / 2, VIEW_H / 2 + 60);
      // 提示按空格跳过等待（触控模式有独立"跳过"按钮，不显示键盘提示）
      if (inputMode !== 'touch') {
        ctx.font = '10px "Microsoft YaHei", monospace';
        const hint = '按 SPACE 跳过';
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillText(hint, VIEW_W / 2 + 1, VIEW_H / 2 + 78);
        ctx.fillStyle = '#cfd6e6';
        ctx.fillText(hint, VIEW_W / 2, VIEW_H / 2 + 77);
      }
    }

    // 正下方小灰字：版本号（剧情模式 HUD 不放文字，只在挑战模式显示）
    if (G.mode !== 'story') {
      ctx.textAlign = 'center';
      ctx.font = '9px Consolas, "Microsoft YaHei", monospace';
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillText('v0.01', VIEW_W / 2 + 1, VIEW_H - 10);
      ctx.fillStyle = 'rgba(185, 178, 194, 0.8)';
      ctx.fillText('v0.01', VIEW_W / 2, VIEW_H - 11);
    }

    ctx.restore();
  }

  // 左下：血量条 + 护甲（格数/颜色随护甲等级走）。只给条和格，不写任何数字
  function drawBodyHUD() {
    const p = G.player;
    if (!p) return;
    const x0 = 16 + HUD_OFF.body.x, barW = 150;
    const hpY = VIEW_H - 40 + HUD_OFF.body.y, hpH = 12;
    const gap = 5;
    const apY = VIEW_H - 22 + HUD_OFF.body.y, apH = 8;
    const slots = armorSlotCount(p);
    const per = armorPerSlot(p);
    const tier = armorTier(p);
    const slotW = (barW - gap * (slots - 1)) / slots;

    // 读条（治疗 / 装护甲板）压在血条上方
    if (p.healing || p.plating) {
      const healing = p.healing;
      const prog = healing
        ? clamp(p.healCharge / HEAL_TIME, 0, 1)
        : clamp(p.plateCharge / PLATE_TIME, 0, 1);
      ctx.fillStyle = 'rgba(6,4,8,0.75)';
      ctx.fillRect(x0 - 1, hpY - 11, barW + 2, 7);
      ctx.fillStyle = healing ? '#e02929' : '#c8c8d0';
      ctx.fillRect(x0, hpY - 10, Math.round(barW * prog), 5);
    }

    // 血量条
    ctx.fillStyle = 'rgba(6,4,8,0.75)';
    ctx.fillRect(x0 - 2, hpY - 2, barW + 4, hpH + 4);
    const hpRatio = clamp(p.hp / HP_MAX, 0, 1);
    // 红灰白黑主题：血条用红色（血的颜色），血量越少越暗红，低血闪动警示
    let hpCol = '#e02929';
    if (hpRatio < 0.35) hpCol = '#a01212';
    else if (hpRatio < 0.7) hpCol = '#c41f1f';
    if (hpRatio > 0) {
      ctx.fillStyle = hpCol;
      ctx.fillRect(x0, hpY, Math.round(barW * hpRatio), hpH);
    }
    // 低血时描边闪白，看不见数字也知道该找血包了
    if (hpRatio < 0.35) {
      const pulse = 0.45 + 0.35 * Math.sin(performance.now() * 0.009);
      ctx.strokeStyle = 'rgba(242,242,244,' + pulse.toFixed(3) + ')';
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 - 1.5, hpY - 1.5, barW + 3, hpH + 3);
    }

    // 护甲格：格数和颜色随护甲等级走（1 级单格蓝 → 2 级两格蓝 → 3 级三格蓝 → 4 级两格紫 → 5 级单格金）。
    // 没装的格子留一圈暗色边框，空甲也看得出有几个位。
    for (let i = 0; i < slots; i++) {
      const sx = x0 + i * (slotW + gap);
      ctx.fillStyle = 'rgba(6,4,8,0.75)';
      ctx.fillRect(sx - 1, apY - 1, slotW + 2, apH + 2);
      const slotFill = clamp((p.armor - i * per) / per, 0, 1);
      if (slotFill > 0) {
        ctx.fillStyle = tier.color;
        ctx.fillRect(sx, apY, Math.round(slotW * slotFill), apH);
      } else {
        // 空槽边框用等级色的低透明度，颜色一致
        ctx.strokeStyle = rgbaHex(tier.color, 0.30);
        ctx.lineWidth = 1;
        ctx.strokeRect(sx + 0.5, apY + 0.5, slotW - 1, apH - 1);
      }
    }
  }

  // ------------------------------------------------------------ 右下角装备栏
  //
  // 参考使命召唤的排布：不写武器名，全靠剪影 + 数字。
  //   最上一行：副武器（压暗），只在有副武器时出现
  //   中间一行：血包 / 手雷 / 护甲板，图标 + 右下角数量
  //   最下一行：当前武器剪影 + 大号弹药数 / 备弹
  // 键位压在图标正下方 7px 暗字：找得到，但不跟数字抢注意力。

  // ---------------- 武器剪影：直接拿游戏里的武器贴图染色 ----------------
  // 手画的剪影怎么调都像"凳子/锤子"，干脆用角色手上那把枪的贴图（w_pistol 等），
  // 把非透明像素整片涂成一种颜色当剪影 —— 轮廓是原资产，比例天然对得上。
  // 包围盒是每张贴图里枪身的实际范围（由 tools/gen_assets.py 生成，尺寸固定）：
  // 18×18 的画布上下留白很多，不裁掉的话放大后枪会缩在中间一小条。
  const WEAPON_BOX = {
    w_pistol: [2, 5, 15, 13],
    w_smg: [0, 6, 18, 11],
    w_shotgun: [0, 6, 22, 7],
    w_bat: [0, 6, 18, 6],
    w_knife: [1, 5, 23, 7]
  };
  const TINT_CACHE = new Map();

  /**
   * 把贴图"白化"成 HUD 用的单色图标，返回离屏 canvas（每张图只处理一次）。
   *
   * 不是简单地把不透明像素刷成白色 —— 那样会丢掉所有内部结构，实测霰弹枪/匕首
   * 会退化成一根实心白条，完全认不出。这里走滤镜：
   *   grayscale 先去色 → brightness 把枪身推到纯白 → contrast 把原来的深色描边压回来。
   * 结果是"白枪身 + 深描边"，部件边界还在，读起来还是那把枪。
   */
  function whiteSprite(name) {
    if (TINT_CACHE.has(name)) return TINT_CACHE.get(name);
    const src = IMG[name];
    if (!src || !src.width) return null;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.filter = 'grayscale(1) brightness(3.1) contrast(1.45)';
    g.drawImage(src, 0, 0);
    g.filter = 'none';
    TINT_CACHE.set(name, c);
    return c;
  }

  /**
   * 画武器图标：(cx, cy) 是中心，塞进 maxW×maxH 的框里按原比例缩放。
   * alpha 控制存在感 —— 手上那把 1，背上的 0.45。枪口朝右，和角色手里那把一致。
   */
  function drawWeaponSprite(name, cx, cy, maxW, maxH, alpha, g) {
    const c2d = g || ctx;
    if (!name) return;
    const img = whiteSprite(name);
    if (!img) return;
    const box = WEAPON_BOX[name] || [0, 0, img.width, img.height];
    const s = Math.min(maxW / box[2], maxH / box[3]);
    const w = box[2] * s, h = box[3] * s;
    c2d.save();
    c2d.imageSmoothingEnabled = false;          // 像素风：放大不糊边
    if (alpha != null) c2d.globalAlpha *= alpha;
    c2d.drawImage(img, box[0], box[1], box[2], box[3],
      Math.round(cx - w / 2), Math.round(cy - h / 2), Math.round(w), Math.round(h));
    c2d.restore();
  }

  /** 消耗品图标：medkit 血包 / grenade 手雷 / plate 护甲板。(cx,cy) 是中心。 */
  function drawItemIcon(kind, cx, cy, s, col, g) {
    const c2d = g || ctx;
    c2d.save();
    c2d.strokeStyle = col;
    c2d.fillStyle = col;
    c2d.lineWidth = 1.2;
    c2d.lineJoin = 'miter';
    if (kind === 'medkit') {
      c2d.lineWidth = 1.1;
      c2d.strokeRect(cx - s * 0.45, cy - s * 0.24, s * 0.90, s * 0.66);   // 箱体（扁一点，别像公文包）
      c2d.fillRect(cx - s * 0.08, cy - s * 0.12, s * 0.16, s * 0.46);     // 十字竖
      c2d.fillRect(cx - s * 0.24, cy + s * 0.02, s * 0.48, s * 0.18);     // 十字横
      c2d.fillRect(cx - s * 0.16, cy - s * 0.40, s * 0.32, s * 0.14);     // 提手（要露在箱体外）
    } else if (kind === 'grenade') {
      c2d.beginPath();
      c2d.ellipse(cx, cy + s * 0.12, s * 0.28, s * 0.34, 0, 0, Math.PI * 2);   // 弹体
      c2d.stroke();
      c2d.fillRect(cx - s * 0.10, cy - s * 0.40, s * 0.20, s * 0.16);           // 引信座
      c2d.lineWidth = 1;
      c2d.beginPath();                                                          // 拉环
      c2d.arc(cx + s * 0.24, cy - s * 0.44, s * 0.10, 0, Math.PI * 2);
      c2d.stroke();
      c2d.beginPath();
      c2d.moveTo(cx + s * 0.08, cy - s * 0.42);
      c2d.lineTo(cx + s * 0.16, cy - s * 0.42);
      c2d.stroke();
    } else if (kind === 'plate') {
      c2d.beginPath();
      c2d.moveTo(cx - s * 0.34, cy - s * 0.40);
      c2d.lineTo(cx + s * 0.34, cy - s * 0.40);
      c2d.lineTo(cx + s * 0.28, cy + s * 0.14);
      c2d.quadraticCurveTo(cx, cy + s * 0.48, cx - s * 0.28, cy + s * 0.14);
      c2d.closePath();
      c2d.stroke();
      c2d.lineWidth = 1.5;
      c2d.beginPath();                                                    // 中缝：别读成一颗心
      c2d.moveTo(cx - s * 0.27, cy - s * 0.08);
      c2d.lineTo(cx + s * 0.27, cy - s * 0.08);
      c2d.stroke();
    }
    c2d.restore();
  }

  /** #rrggbb → rgba()，只给 HUD 里几处需要半透明的描边用。 */
  function rgbaHex(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a.toFixed(2) + ')';
  }

  /** 键位小字：压在图标正下方，7px，不抢视线。 */
  function drawSlotKey(cx, y, label, col) {
    ctx.font = 'bold 7px "Microsoft YaHei", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillText(label, cx + 0.5, y + 0.5);
    ctx.fillStyle = col;
    ctx.fillText(label, cx, y);
    ctx.textAlign = 'left';
  }

  /** 换弹提示的两档水位（占弹匣容量的比例）：>半数不提示，≤半数黄，≤三分之一红。 */
  const RELOAD_HINT_WARN = 0.5;
  const RELOAD_HINT_CRIT = 1 / 3;

  /**
   * 屏幕正下方的"按 R 换弹"。
   * 之前是在右下角备弹左边贴一个 [R] 小方框：那块地方被弹药数字、图标和键位标
   * 挤满，11px 的小框既看不清、又让人以为是 UI 错位，所以整条挪到画面正中偏下。
   */
  /**
   * 剧情模式 HUD：只允许数字，不出现任何文字。
   *   右上：上排 = 场上剩余人数（红），下排 = 分数（白）
   *   左下：手上那把枪的剪影 + 弹匣剩弹
   * 不显示血量（一击必杀）、备弹（剧情没有备弹）、关卡名、连击、现金。
   */
  function drawStoryHUD() {
    const p = G.player;
    let alive = 0;
    for (const e of W.enemies) if (e.alive) alive++;

    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    // 剩余人数
    ctx.font = 'bold 22px Consolas, monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillText('' + alive, VIEW_W - 9, 9);
    ctx.fillStyle = alive > 0 ? '#e02929' : '#5a5a60';
    ctx.fillText('' + alive, VIEW_W - 10, 8);
    // 分数
    ctx.font = 'bold 13px Consolas, monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillText('' + (G.score || 0), VIEW_W - 9, 33);
    ctx.fillStyle = '#c8c8d0';
    ctx.fillText('' + (G.score || 0), VIEW_W - 10, 32);

    if (!p) return;
    // 左下：武器剪影 + 弹匣内子弹（近战没子弹，就只画枪）
    const def = p.weapon ? WEAPONS[p.weapon] : null;
    const bx = 8, by = VIEW_H - 34;
    if (def) {
      drawWeaponSprite(def.icon, bx + 28, by - 12, 54, 26, 0.95);
      if (!def.melee) {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.font = 'bold 22px Consolas, monospace';
        const txt = '' + p.ammo;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillText(txt, bx + 61, by + 1);
        ctx.fillStyle = p.ammo <= 0 ? '#e05a4a' : '#f6f0e4';
        ctx.fillText(txt, bx + 60, by);
      }
    } else {
      // 空手：画一个拳头 —— 还能打，只是得贴脸
      const fx = bx + 28, fy = by - 12;
      ctx.save();
      ctx.strokeStyle = 'rgba(214,214,222,0.8)';
      ctx.fillStyle = 'rgba(214,214,222,0.12)';
      ctx.lineWidth = 1.5;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(fx - 9, fy - 7, 18, 14, 4); }
      else { ctx.beginPath(); ctx.rect(fx - 9, fy - 7, 18, 14); }
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      for (let i = -1; i <= 1; i++) { ctx.moveTo(fx + i * 5, fy - 7); ctx.lineTo(fx + i * 5, fy - 2); }
      ctx.stroke();
      ctx.restore();
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  // 清场提示：人杀完了就该往回走了（终点就是进门那个出生点）。
  // 弹入 0.22s 从大砸到原尺寸，之后常驻轻微呼吸，走进终点（state 变 storyclear）才消失。
  function drawGoBackPrompt() {
    if (G.mode !== 'story' || !W || !W.cleared) return;
    if (G.state !== 'play' || !G.goBack) return;

    const t = G.goBack;
    const k = Math.min(1, t / 0.22);
    const ease = 1 - Math.pow(1 - k, 3);
    const alpha = ease * (0.82 + 0.18 * Math.sin(t * 5.5));
    const scale = 1 + (1 - ease) * 0.45;                  // 1.45 → 1.0 砸落
    const cy = VIEW_H * 0.29 + Math.sin(t * 2.6) * 1.2;   // 一点浮动，别像贴图

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(VIEW_W / 2, cy);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;

    // 逐字画：Consolas 没有原生字距，自己累加宽度
    const txt = 'GO BACK';
    ctx.font = 'bold 34px Consolas, monospace';
    const sp = 6;
    let total = -sp;
    for (const ch of txt) total += ctx.measureText(ch).width + sp;
    let x = -total / 2;
    ctx.lineJoin = 'round';
    for (const ch of txt) {
      const w = ctx.measureText(ch).width;
      const gx = x + w / 2;
      // 黑描边压住背景，红字在上面
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.88)';
      ctx.strokeText(ch, gx, 0);
      ctx.fillStyle = MIAMI.redHot;
      ctx.fillText(ch, gx, 0);
      x += w + sp;
    }

    // 上下两条细红线：警示条味道
    ctx.globalAlpha = alpha * 0.55;
    ctx.strokeStyle = MIAMI.red;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-total / 2 - 12, -21); ctx.lineTo(total / 2 + 12, -21);
    ctx.moveTo(-total / 2 - 12, 21); ctx.lineTo(total / 2 + 12, 21);
    ctx.stroke();

    ctx.restore();
  }

  function drawReloadHint() {
    if (G.state !== 'play') return;             // 死了 / 结算 / 商店里别催
    const p = G.player;
    if (!p || !p.weapon) return;
    const def = WEAPONS[p.weapon];
    if (!def || def.melee) return;              // 近战没有换弹这回事
    if (p.reload > 0 || p.reserve <= 0) return; // 正在换 / 没备弹就别催了
    const mag = gunStat(p.weapon, 'mag');
    if (mag <= 0 || p.ammo >= mag) return;
    const frac = p.ammo / mag;
    if (frac > RELOAD_HINT_WARN) return;        // 还够用，不显示

    const crit = frac <= RELOAD_HINT_CRIT;
    const txt = inputMode === 'touch' ? '按 换弹' : '按 R 换弹';
    const y = VIEW_H - 26 + HUD_OFF.reload.y;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 13px "Microsoft YaHei", monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillText(txt, VIEW_W / 2 + 1 + HUD_OFF.reload.x, y + 1);
    ctx.fillStyle = crit
      ? 'rgba(255,92,76,' + (0.80 + 0.20 * Math.sin(performance.now() * 0.009)).toFixed(2) + ')'
      : '#f0c05a';
    ctx.fillText(txt, VIEW_W / 2 + HUD_OFF.reload.x, y);
    ctx.textAlign = 'left';
  }

  function drawLoadoutHUD() {
    const p = G.player;
    if (!p) return;
    const RX = VIEW_W - 12 + HUD_OFF.loadout.x;   // 右对齐基准
    const BOT = VIEW_H - 10 + HUD_OFF.loadout.y;  // 底边基准

    const mainDef = p.weapon ? WEAPONS[p.weapon] : null;
    const mainGun = mainDef && !mainDef.melee;
    const sideDef = p.side ? WEAPONS[p.side.weapon] : null;
    const reloading = mainGun && p.reload > 0 && p.reloadTotal > 0;
    const empty = mainGun && p.ammo <= 0;
    const onSide = p.curSlot === 'side';

    ctx.textBaseline = 'top';

    // ---------------- 上排：消耗品（血包 / 手雷 / 护甲板）
    const cy2 = BOT - 62;
    const colStep = 46;
    const items = [
      { kind: 'medkit', x: RX - colStep * 2 - 14, n: p.medkits, key: '3', col: '#7fdca0', busy: !!p.healing },
      { kind: 'grenade', x: RX - colStep - 14, n: p.grenades, key: 'G', col: '#e02929', busy: false },
      { kind: 'plate', x: RX - 14, n: p.armorPlates, key: '4', col: '#c8c8d0', busy: !!p.plating }
    ];
    for (const it of items) {
      const has = it.n > 0;
      if (it.busy) {
        // 正在用 / 正在装：图标外面套一圈脉冲，不用写字也知道"在走"
        const pulse = 0.30 + 0.28 * Math.sin(performance.now() * 0.012);
        ctx.beginPath();
        ctx.arc(it.x, cy2, 13, 0, Math.PI * 2);
        ctx.strokeStyle = rgbaHex(it.col, pulse);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      // 平时统一暖白（三个图标一起上色会花），只有正在使用时才染成本色
      drawItemIcon(it.kind, it.x, cy2, 20,
        !has ? 'rgba(118,110,130,0.5)' : (it.busy ? it.col : 'rgba(242,236,226,0.88)'));
      // 数量贴图标右下角：0 也照写，空着反而让人以为是没这个功能
      ctx.font = 'bold 10px "Microsoft YaHei", monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillText('' + it.n, it.x + 9.5, cy2 + 6.5);
      ctx.fillStyle = has ? 'rgba(255,250,242,0.95)' : 'rgba(118,110,130,0.65)';
      ctx.fillText('' + it.n, it.x + 10, cy2 + 6);
      drawSlotKey(it.x, cy2 + 14, it.key, has ? 'rgba(150,142,166,0.6)' : 'rgba(110,104,124,0.45)');
    }

    // ---------------- 下排：手上这把（大、亮）+ 背上那把（小、暗）+ 弹药
    // 大剪影永远画**手上拿着的那把**，因此永远亮着 —— 之前是位置固定、只按 curSlot
    // 调亮暗，按下 2 换枪后手上那把被画成灰的，看着像"认错枪"。
    // 键位：手上这把原本在槽 1 就标 1、在槽 2 就标 2；备枪标它对应的那个键。
    const gy = BOT - 38;
    const bigW = 62, bigH = 30;
    const bigCx = RX - 46 - bigW / 2;
    const bigCy = gy + bigH / 2;

    if (mainDef) {
      // 空弹不压暗图标的亮度：数字已经变红了，图标再暗下去就看不清手上是什么枪
      drawWeaponSprite(mainDef.icon, bigCx, bigCy, bigW, bigH, 1);
      drawSlotKey(bigCx, BOT - 5, onSide ? '2' : '1', 'rgba(226,218,236,0.72)');
    }

    if (sideDef) {
      const smallW = 46, smallH = 22;
      const smallCx = bigCx - bigW / 2 - 10 - smallW / 2;
      drawWeaponSprite(sideDef.icon, smallCx, bigCy, smallW, smallH, 0.55);
      drawSlotKey(smallCx, BOT - 5, onSide ? '1' : '2', 'rgba(150,142,162,0.5)');
    }

    // 大号弹匣内子弹
    ctx.textAlign = 'right';
    ctx.font = 'bold 22px "Microsoft YaHei", monospace';
    const bigTxt = mainGun ? '' + p.ammo : (mainDef ? '∞' : '—');
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillText(bigTxt, RX + 1, gy + 1);
    ctx.fillStyle = mainGun ? (empty ? '#e05a4a' : '#f6f0e4') : '#9a90a6';
    ctx.fillText(bigTxt, RX, gy);

    // 备弹：换弹中让位给进度条
    if (mainGun) {
      if (reloading) {
        const prog = clamp(1 - p.reload / p.reloadTotal, 0, 1);
        ctx.font = 'bold 10px "Microsoft YaHei", monospace';
        ctx.fillStyle = '#f0c05a';
        ctx.fillText(Math.round(prog * 100) + '%', RX, BOT - 15);
        const bw = 56;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(RX - bw, BOT - 3, bw, 3);
        ctx.fillStyle = '#f0c05a';
        ctx.fillRect(RX - bw, BOT - 3, Math.round(bw * prog), 3);
      } else {
        const resTxt = '/' + p.reserve;
        ctx.font = 'bold 11px Consolas, "Microsoft YaHei", monospace';
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillText(resTxt, RX + 0.5, BOT - 11.5);
        ctx.fillStyle = p.reserve > 0 ? 'rgba(198,188,210,0.9)' : 'rgba(224,120,110,0.9)';
        ctx.fillText(resTxt, RX, BOT - 12);
      }
    }
    ctx.textAlign = 'left';
  }

  // 补给点商店
  function drawShop() {
    ctx.save();
    // 补给点商店（底板用纯色：0.94 会透出底下的波次/HUD 文字，看着比商品还乱）
    ctx.fillStyle = '#08060a';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';

    ctx.font = 'bold 24px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#e02929';
    ctx.fillText('补给点', VIEW_W / 2, 46);

    ctx.font = 'bold 14px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#e8dcc8';
    ctx.fillText('$' + G.cash, VIEW_W / 2, 74);

    // 列表
    const itemsPerCol = SHOP_COLS;
    const colW = VIEW_W / 2;
    ctx.textAlign = 'left';
    for (let i = 0; i < SHOP.length; i++) {
      const item = SHOP[i];
      const col = Math.floor(i / itemsPerCol);
      const row = i % itemsPerCol;
      const x = col * colW + 40;
      const y = 112 + row * 46;
      const sel = i === G.shopSel;
      // 高亮
      if (sel) {
        ctx.fillStyle = 'rgba(255,215,110,0.14)';
        ctx.fillRect(x - 12, y - 16, colW - 32, 40);
        ctx.strokeStyle = 'rgba(255,215,110,0.6)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 12, y - 16, colW - 32, 40);
      }
      // 买不起灰掉
      const afford = G.cash >= item.price;
      const alreadyHave = item.kind === 'weapon' && G.player.weapon === item.id;
      ctx.fillStyle = sel ? '#e02929' : (afford && !alreadyHave ? '#c8c8d0' : '#6f6f76');
      ctx.font = 'bold 13px "Microsoft YaHei", monospace';
      ctx.fillText(item.label + (alreadyHave ? '（已持有）' : ''), x, y);
      ctx.font = '11px "Microsoft YaHei", monospace';
      ctx.fillStyle = '#9c90a8';
      ctx.fillText(item.desc, x, y + 16);
      ctx.textAlign = 'right';
      ctx.fillStyle = afford ? '#e02929' : '#3a3a40';
      ctx.fillText('$' + item.price, x + colW - 44, y);
      ctx.textAlign = 'left';
    }

    // 底部「购买」「退出」按钮（老虎机子界面不显示，避免和摇杆/返回提示冲突）
    if (!G.slotState) {
      const btns = shopButtons();
      const drawBtn = (b, label, kind) => {
        const hov = mouse.x >= b.x && mouse.x <= b.x + b.w && mouse.y >= b.y && mouse.y <= b.y + b.h;
        ctx.fillStyle = hov ? 'rgba(255,215,110,0.20)' : 'rgba(255,255,255,0.06)';
        ctx.strokeStyle = hov ? '#e02929' : 'rgba(255,255,255,0.28)';
        ctx.lineWidth = 1;
        if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 8); }
        else { ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); }
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = kind === 'buy' ? '#e02929' : '#c8c8d0';
        ctx.font = 'bold 15px "Microsoft YaHei", monospace';
        ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 1);
      };
      drawBtn(btns.buy, '购买', 'buy');
      drawBtn(btns.exit, '退出', 'exit');
    }

    ctx.textAlign = 'center';
    ctx.font = '10px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#5f5668';
    ctx.fillText(inputMode === 'touch'
      ? '点商品选中 · 点「购买」/「退出」'
      : 'W/S 选行 · A/D 换列 · 回车购买 · ESC 退出', VIEW_W / 2, VIEW_H - 24);

    // 老虎机结果展示（在底部中间偏上）
    if (G.slotState) {
      drawSlotMachine();
    }

    ctx.restore();
  }

  // 老虎机：三个转轮 + 结果
  function drawSlotMachine() {
    const s = G.slotState;
    const cy = VIEW_H / 2 + 40;
    const wheelW = 48, wheelH = 48, gap = 12;
    const x0 = VIEW_W / 2 - (3 * wheelW + 2 * gap) / 2;
    ctx.textAlign = 'center';
    // 老虎机是叠在商店列表上的：先铺一层全屏暗底，摇的时候不跟商品文字糊在一起
    ctx.fillStyle = '#08060a';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // 面板边框
    const panelW = 232, panelH = 146;
    const px0 = VIEW_W / 2 - panelW / 2, py0 = cy - 70;
    ctx.fillStyle = 'rgba(10,8,14,0.97)';
    ctx.fillRect(px0, py0, panelW, panelH);
    ctx.strokeStyle = 'rgba(255,215,110,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px0 + 0.5, py0 + 0.5, panelW - 1, panelH - 1);
    // 子页面标题 + 余额（全屏暗底盖掉了商店的抬头，这里补一份）
    ctx.font = 'bold 24px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#e02929';
    ctx.fillText('老虎机', VIEW_W / 2, 92);
    ctx.font = 'bold 14px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#e8dcc8';
    ctx.fillText('$' + G.cash, VIEW_W / 2, 118);
    // 副标题省了：三个轮子 + 图标下的名字已经说明了玩法
    // 保底进度：连亏到 SLOT_PITY 次，下一把直接把轮子统一
    const pity = Math.min(SLOT_PITY, G.slotPity || 0);
    const pityFull = pity >= SLOT_PITY;
    ctx.font = 'bold 10px "Microsoft YaHei", monospace';
    ctx.fillStyle = pityFull ? '#7fdca0' : '#8d7f9c';
    ctx.fillText(pityFull ? '保底满 · 必中' : '保底 ' + pity + '/' + SLOT_PITY, VIEW_W / 2, cy - 52);
    for (let i = 0; i < 3; i++) {
      const wx = x0 + i * (wheelW + gap);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(wx, cy - wheelH / 2, wheelW, wheelH);
      ctx.strokeStyle = 'rgba(255,215,110,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(wx, cy - wheelH / 2, wheelW, wheelH);
      const sym = SLOT_SYMBOLS[s.stops[i] || 0];
      ctx.font = 'bold 24px monospace';
      ctx.fillStyle = '#fff';
      ctx.fillText(SLOT_ICONS[sym], wx + wheelW / 2, cy + 8);
      ctx.font = 'bold 9px "Microsoft YaHei", monospace';
      ctx.fillStyle = '#c8c8d0';
      ctx.fillText(SLOT_NAMES[sym], wx + wheelW / 2, cy + wheelH / 2 + 12);
    }
    // 结果
    if (!s.spinning && s.result !== undefined) {
      let line, col;
      if (s.result === null) {
        if (s.console) { line = '退回 $' + s.console; col = '#e8c84a'; }
        else { line = '未中奖'; col = '#9c90a8'; }
      } else {
        line = '中奖！' + SLOT_NAMES[s.result] + (s.pity ? '（保底）' : '');
        col = '#7fdca0';
      }
      ctx.font = 'bold 13px "Microsoft YaHei", monospace';
      ctx.fillStyle = col;
      ctx.fillText(line, VIEW_W / 2, cy + wheelH / 2 + 30);
    }
    // 底部操作提示
    const slotPrice = (SHOP.find(it => it.kind === 'slot') || { price: 0 }).price;
    ctx.font = '10px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#5f5668';
    ctx.fillText(inputMode === 'touch'
      ? '点「购买」$' + slotPrice + '  ·  点「退出」返回'
      : '回车 $' + slotPrice + '  ·  ESC 返回', VIEW_W / 2, VIEW_H - 40);
  }

  // ---------------------------------------------------------------- 武器升级站 UI
  function drawUpgrade() {
    ctx.save();
    ctx.fillStyle = '#08060a';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';
    ctx.font = 'bold 24px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#e02929';
    ctx.fillText('武器升级站', VIEW_W / 2, 44);
    ctx.font = 'bold 14px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#e8dcc8';
    ctx.fillText('$' + G.cash, VIEW_W / 2, 70);

    const sel = G.upgSel || { gun: 0, line: 0 };
    const gunId = UP_GUNS[clamp(sel.gun, 0, UP_GUNS.length - 1)];
    const line = clamp(sel.line, 0, UP_ARMOR_LINE);
    const u = gunUp(gunId) || { dmg: 0, mag: 0, range: 0, laser: 0, evo: false };
    const owned = !!(G.player && (G.player.weapon === gunId || (G.player.side && G.player.side.weapon === gunId)));

    // 三把枪的标签页（A/D 切换）
    const tabW = 168, tabGap = 10;
    const tabX0 = VIEW_W / 2 - (3 * tabW + 2 * tabGap) / 2;
    for (let i = 0; i < UP_GUNS.length; i++) {
      const id = UP_GUNS[i];
      const ux = tabX0 + i * (tabW + tabGap);
      const isSel = i === sel.gun;
      const have = !!(G.player && (G.player.weapon === id || (G.player.side && G.player.side.weapon === id)));
      ctx.fillStyle = isSel ? 'rgba(255,179,71,0.16)' : 'rgba(255,255,255,0.04)';
      ctx.fillRect(ux, 88, tabW, 30);
      if (isSel) { ctx.strokeStyle = 'rgba(255,179,71,0.7)'; ctx.lineWidth = 1; ctx.strokeRect(ux + 0.5, 88.5, tabW - 1, 29); }
      ctx.font = 'bold 13px "Microsoft YaHei", monospace';
      ctx.fillStyle = isSel ? '#e02929' : (have ? '#c8c8d0' : '#6f6f76');
      const evoTag = u.evo ? ' ★' : '';
      ctx.fillText(WEAPONS[id].name + (have ? '' : '（未持有）') + evoTag, ux + tabW / 2, 107);
    }

    // 四条升级线 + 进化行 + 护甲升级行
    const rowY = 128, rowH = 30;
    for (let li = 0; li <= UP_ARMOR_LINE; li++) {
      const y = rowY + li * rowH;
      const isSel = line === li;
      const def = li < UPGRADE_LINES.length ? UPGRADE_LINES[li] : null;
      // 护甲升级行：独立于枪，跟着这一局走
      if (li === UP_ARMOR_LINE) {
        const pt = G.player || { armorTier: 0 };
        const tier = pt.armorTier || 0;
        const maxed = tier >= ARMOR_TIERS.length - 1;
        const curTier = ARMOR_TIERS[tier];
        const nextTier = maxed ? null : ARMOR_TIERS[tier + 1];
        const cost = maxed ? 0 : ARMOR_UP_PRICE[tier];
        const afford = !maxed && G.cash >= cost;
        ctx.fillStyle = isSel ? 'rgba(120,180,255,0.16)' : 'rgba(255,255,255,0.03)';
        ctx.fillRect(40, y - 14, VIEW_W - 80, 30);
        if (isSel) { ctx.strokeStyle = 'rgba(120,180,255,0.7)'; ctx.strokeRect(40.5, y - 13.5, VIEW_W - 81, 29); }
        ctx.textAlign = 'left';
        ctx.font = 'bold 13px "Microsoft YaHei", monospace';
        ctx.fillStyle = isSel ? '#c8c8d0' : (maxed ? '#e02929' : '#c8c8d0');
        ctx.fillText('护甲等级', 54, y);
        // 等级点（5 级）
        for (let d = 0; d < ARMOR_TIERS.length; d++) {
          ctx.fillStyle = d <= tier ? (d === ARMOR_TIERS.length - 1 ? '#e02929' : '#c8c8d0') : '#3a3a40';
          ctx.beginPath(); ctx.arc(150 + d * 16, y - 4, 3.5, 0, 6.283); ctx.fill();
        }
        // 当前 → 下一级描述
        ctx.font = '10px "Microsoft YaHei", monospace';
        ctx.fillStyle = '#9c90a8';
        const sub = maxed
          ? curTier.name + '（满级 · ' + curTier.desc + '）'
          : curTier.name + ' ' + curTier.desc + ' → ' + nextTier.name + ' ' + nextTier.desc;
        ctx.fillText(sub, 54, y + 15);
        // 价格
        ctx.textAlign = 'right';
        ctx.font = 'bold 12px "Microsoft YaHei", monospace';
        ctx.fillStyle = maxed ? '#3a3a40' : (afford ? '#e02929' : '#3a3a40');
        ctx.fillText(maxed ? '满' : '$' + cost, VIEW_W - 54, y);
        ctx.textAlign = 'left';
        continue;
      }
      // 进化行：四条全满才亮
      if (li >= UPGRADE_LINES.length) {
        const ready = upAllMaxed(gunId);
        const evolved = u.evo;
        ctx.fillStyle = isSel ? 'rgba(255,120,80,0.16)' : 'rgba(255,255,255,0.03)';
        ctx.fillRect(40, y - 14, VIEW_W - 80, 30);
        if (isSel) { ctx.strokeStyle = 'rgba(255,120,80,0.7)'; ctx.strokeRect(40.5, y - 13.5, VIEW_W - 81, 29); }
        ctx.textAlign = 'left';
        ctx.font = 'bold 13px "Microsoft YaHei", monospace';
        ctx.fillStyle = evolved ? '#f2f2f4' : (ready ? '#e02929' : '#3a3a40');
        ctx.fillText('进化 · ' + (UP_EVO_NAME[gunId] || '—') + (evolved ? '（已进化）' : ''), 54, y);
        ctx.font = '10px "Microsoft YaHei", monospace';
        ctx.fillStyle = '#9c90a8';
        ctx.fillText(UP_EVO_DESC[gunId] || '', 54, y + 15);
        ctx.textAlign = 'right';
        if (!evolved) {
          const price = Math.round(UP_EVO_PRICE * (UP_PRICE_MUL[gunId] || 1));
          ctx.font = 'bold 12px "Microsoft YaHei", monospace';
          ctx.fillStyle = ready ? (G.cash >= price ? '#e02929' : '#3a3a40') : '#3a3a40';
          ctx.fillText(ready ? '$' + price : '锁', VIEW_W - 54, y);
        }
        ctx.textAlign = 'left';
        continue;
      }
      const lv = u[def.id] || 0;
      const maxed = lv >= def.max;
      const cost = upCost(gunId, def.id);
      const afford = cost > 0 && G.cash >= cost;
      // 高亮
      ctx.fillStyle = isSel ? 'rgba(255,179,71,0.14)' : 'rgba(255,255,255,0.03)';
      ctx.fillRect(40, y - 14, VIEW_W - 80, 30);
      if (isSel) { ctx.strokeStyle = 'rgba(255,179,71,0.6)'; ctx.strokeRect(40.5, y - 13.5, VIEW_W - 81, 29); }
      // 名称 + 等级点
      ctx.textAlign = 'left';
      ctx.font = 'bold 13px "Microsoft YaHei", monospace';
      ctx.fillStyle = isSel ? '#e02929' : '#c8c8d0';
      ctx.fillText(def.name, 54, y);
      for (let d = 0; d < def.max; d++) {
        ctx.fillStyle = d < lv ? '#e02929' : '#3a3a40';
        ctx.beginPath(); ctx.arc(120 + d * 16, y - 4, 3.5, 0, 6.283); ctx.fill();
      }
      // 当前 → 下一级
      const pv = upPreview(gunId, def.id);
      let sub;
      if (def.id === 'laser') {
        sub = lv >= def.max ? '散布已最小' : ('散布 ×' + UP_LASER_SPREAD[lv].toFixed(2) + ' → ×' + UP_LASER_SPREAD[Math.min(lv + 1, 3)].toFixed(2));
      } else if (def.id === 'dmg') {
        sub = pv.cur + (pv.next != null ? ' → ' + pv.next : '（满）');
      } else if (def.id === 'mag') {
        sub = pv.cur + (pv.next != null ? ' → ' + pv.next : '（满）');
      } else {
        sub = pv.cur + (pv.next != null ? ' → ' + pv.next : '（满）');
      }
      ctx.font = '10px "Microsoft YaHei", monospace';
      ctx.fillStyle = '#9c90a8';
      ctx.fillText(sub, 54, y + 15);
      // 价格
      ctx.textAlign = 'right';
      ctx.font = 'bold 12px "Microsoft YaHei", monospace';
      ctx.fillStyle = maxed ? '#3a3a40' : (afford ? '#e02929' : '#3a3a40');
      ctx.fillText(maxed ? '满' : '$' + cost, VIEW_W - 54, y);
      ctx.textAlign = 'left';
    }

    // 底部「购买」「退出」按钮（触屏可点，桌面鼠标也能点）
    {
      const btns = upgradeButtons();
      const drawBtn = (b, label, kind) => {
        const hov = mouse.x >= b.x && mouse.x <= b.x + b.w && mouse.y >= b.y && mouse.y <= b.y + b.h;
        ctx.fillStyle = hov ? 'rgba(255,179,71,0.20)' : 'rgba(255,255,255,0.06)';
        ctx.strokeStyle = hov ? '#e02929' : 'rgba(255,255,255,0.28)';
        ctx.lineWidth = 1;
        if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 8); }
        else { ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); }
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = kind === 'buy' ? '#e02929' : '#c8c8d0';
        ctx.font = 'bold 15px "Microsoft YaHei", monospace';
        ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 1);
      };
      drawBtn(btns.buy, '购买', 'buy');
      drawBtn(btns.exit, '退出', 'exit');
    }

    ctx.textAlign = 'center';
    ctx.font = '10px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#5f5668';
    ctx.fillText(inputMode === 'touch'
      ? '点标签换枪 · 点行选中 · 点「购买」/「退出」'
      : 'A/D 换枪  ·  W/S 换项  ·  回车购买  ·  V/ESC 返回', VIEW_W / 2, VIEW_H - 24);

    // 未持有的枪提示
    if (!owned) {
      ctx.font = 'bold 11px "Microsoft YaHei", monospace';
      ctx.fillStyle = '#9c90a8';
      ctx.fillText('未持有的枪也能先升级，捡到后直接生效', VIEW_W / 2, VIEW_H - 44);
    }
    ctx.restore();
  }

  // 标题页按钮的命中区域（逻辑坐标，供 drawTitle 与 onPointerDown 共用）
  const TITLE_BTN = {
    story: { x: VIEW_W / 2 - 90, y: 168, w: 180, h: 40 },
    challenge: { x: VIEW_W / 2 - 90, y: 216, w: 180, h: 40 },
    settings: { x: VIEW_W / 2 - 90, y: 264, w: 180, h: 40 }
  };

  // 红灰白黑配色（Hotline Miami 经典：黑底 + 红高亮 + 灰白文字，红留给血与危险/强调）
  const MIAMI = {
    bg: '#0a0a0c', bg2: '#141416',
    red: '#e02929', redHot: '#ff3b3b',    // 红：强调/危险/评分高亮（血也同属红色系）
    gray: '#8a8a90', grayLight: '#c8c8d0', // 灰：次要元素/敌人
    white: '#f2f2f4', dim: '#6f6f76'
  };
  // 兼容旧字段名（避免到处改引用），把它们映射到红灰白黑
  const _MIAMI_ALIAS = { pink: MIAMI.red, pinkHot: MIAMI.redHot, purple: MIAMI.gray, cyan: MIAMI.grayLight, cyanHot: MIAMI.white, yellow: MIAMI.red, white: MIAMI.white, dim: MIAMI.dim };
  for (const k in _MIAMI_ALIAS) { if (!(k in MIAMI)) MIAMI[k] = _MIAMI_ALIAS[k]; }

  // ---------------------------------------------------------------- CRT 电视效果
  // 主页（标题 / 设置）用离屏缓冲做一次后处理：把已经画好的画面塞进一台老式显像管电视里，
  // 加圆角管面、球面暗角、扫描线、荧光晕、缓慢上滚的亮带、电子束色散和轻微闪烁。
  // 画面按 1:1 绘制、不缩放，按钮命中区和视觉严格对齐，不会点歪。
  const crtBuf = document.createElement('canvas');
  crtBuf.width = VIEW_W; crtBuf.height = VIEW_H;
  const crtBufCtx = crtBuf.getContext('2d');

  /** 圆角矩形路径（老浏览器没有 roundRect 时手绘）。 */
  function crtRoundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** 把当前画布内容套上 CRT 电视效果后重绘回画布。t 为秒，用来驱动滚动亮带和闪烁。 */
  function applyCRT(t) {
    // 1) 先把刚画好的画面存进缓冲
    crtBufCtx.setTransform(1, 0, 0, 1, 0, 0);
    crtBufCtx.clearRect(0, 0, VIEW_W, VIEW_H);
    crtBufCtx.drawImage(canvas, 0, 0);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // 2) 铺机身底色（管面之外是黑色机身）
    ctx.fillStyle = '#050506';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // 3) 裁成圆角管面：四角被切黑，就是老显像管的味道
    const R = 20;
    ctx.save();
    crtRoundRect(0, 0, VIEW_W, VIEW_H, R);
    ctx.clip();

    // 4) 画面本体（1:1，不缩放）
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.drawImage(crtBuf, 0, 0);

    // 5) 荧光晕：模糊画面叠加，模拟显像管余辉
    if ('filter' in ctx) {
      ctx.save();
      try { ctx.filter = 'blur(2.2px)'; } catch (err) { /* 老浏览器直接跳过 */ }
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.20;
      ctx.drawImage(crtBuf, 0, 0);
      ctx.restore();
    }

    // 6) 电子束色散：左右各一次极轻偏移叠加，边缘出现细微彩边
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.07;
    ctx.drawImage(crtBuf, -1.5, 0);
    ctx.drawImage(crtBuf, 1.5, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // 7) 扫描线
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    for (let y = 0; y < VIEW_H; y += 3) ctx.fillRect(0, y, VIEW_W, 1);

    // 8) 缓慢上滚的荧光亮带（老电视的场同步漂移感）
    const rollY = ((t * 0.11) % 1.25 - 0.12) * VIEW_H;
    const rg = ctx.createLinearGradient(0, rollY - 30, 0, rollY + 30);
    rg.addColorStop(0, 'rgba(255,255,255,0)');
    rg.addColorStop(0.5, 'rgba(255,255,255,0.05)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, rollY - 30, VIEW_W, 60);

    // 9) 球面暗角：越靠边越暗，读起来像凸起的玻璃管面
    const vg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.30, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.68);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(0.70, 'rgba(0,0,0,0.13)');
    vg.addColorStop(1, 'rgba(0,0,0,0.62)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // 10) 管面曲率：左右两侧再加一层竖向暗边
    for (const side of [-1, 1]) {
      const gx0 = side < 0 ? 0 : VIEW_W;
      const gx1 = side < 0 ? 34 : VIEW_W - 34;
      const eg = ctx.createLinearGradient(gx0, 0, gx1, 0);
      eg.addColorStop(0, 'rgba(0,0,0,0.38)');
      eg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = eg;
      ctx.fillRect(Math.min(gx0, gx1), 0, 34, VIEW_H);
    }

    // 11) 玻璃反光：左上角一道柔和高光
    const hl = ctx.createLinearGradient(0, 0, VIEW_W * 0.55, VIEW_H * 0.85);
    hl.addColorStop(0, 'rgba(255,255,255,0.065)');
    hl.addColorStop(0.30, 'rgba(255,255,255,0.014)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // 12) 亮度闪烁：极轻，别看着像在抽搐
    const flick = 0.018 + 0.016 * (0.5 + 0.5 * Math.sin(t * 23.0)) + 0.008 * Math.sin(t * 61.0);
    ctx.fillStyle = 'rgba(0,0,0,' + flick.toFixed(3) + ')';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.restore();   // 退出管面裁剪

    // 13) 管面描边 + 右下角红色电源指示灯（呼吸起伏）
    crtRoundRect(0.5, 0.5, VIEW_W - 1, VIEW_H - 1, R);
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();

    const led = 0.55 + 0.45 * Math.sin(t * 2.0);
    ctx.beginPath();
    ctx.arc(VIEW_W - 13, VIEW_H - 10, 4.2, 0, 6.283);
    ctx.fillStyle = 'rgba(224,41,41,' + (0.14 * led).toFixed(2) + ')';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(VIEW_W - 13, VIEW_H - 10, 1.9, 0, 6.283);
    ctx.fillStyle = 'rgba(224,41,41,' + led.toFixed(2) + ')';
    ctx.fill();

    ctx.restore();
  }

  function drawTitle() {
    const t = performance.now() / 1000;
    ctx.save();
    // 红灰白黑背景：纯黑底 + 红色斜向光带
    const bg = ctx.createLinearGradient(0, 0, VIEW_W, VIEW_H);
    bg.addColorStop(0, '#120a0a');
    bg.addColorStop(0.5, '#0a0a0c');
    bg.addColorStop(1, '#160a0a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // 斜向红色光带
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = MIAMI.red;
    ctx.beginPath();
    ctx.moveTo(-40, VIEW_H + 40); ctx.lineTo(VIEW_W * 0.55, -40); ctx.lineTo(VIEW_W * 0.72, -40); ctx.lineTo(VIEW_W * 0.15, VIEW_H + 40);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3a3a40';
    ctx.beginPath();
    ctx.moveTo(VIEW_W * 0.35, VIEW_H + 40); ctx.lineTo(VIEW_W + 40, VIEW_H + 40); ctx.lineTo(VIEW_W + 40, VIEW_H + 8); ctx.lineTo(VIEW_W * 0.55, VIEW_H + 8);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    // 扫描线不在这里画：统一交给 applyCRT() 后处理，避免叠两层

    ctx.textAlign = 'center';
    // 主标题：红黑像素感（双层发光 + 荧光辉光，像电子束打出来的）
    ctx.save();
    ctx.font = 'bold 52px Consolas, "Microsoft YaHei", monospace';
    ctx.shadowColor = 'rgba(224,41,41,0.9)';
    ctx.shadowBlur = 26;
    ctx.fillStyle = 'rgba(224,41,41,0.35)';
    ctx.fillText('HOTLINE', VIEW_W / 2 + 3, 115);
    ctx.fillStyle = MIAMI.red;
    ctx.fillText('HOTLINE', VIEW_W / 2, 112);
    ctx.shadowBlur = 12;
    ctx.fillStyle = 'rgba(255,120,120,0.45)';
    ctx.fillText('HOTLINE', VIEW_W / 2, 112);
    ctx.restore();
    ctx.shadowBlur = 0;

    // 三个按钮：剧情模式（红）/ 挑战模式（白）/ 设置（灰）
    drawMenuButton(TITLE_BTN.story, '剧情模式', MIAMI.red);
    drawMenuButton(TITLE_BTN.challenge, '挑战模式', MIAMI.white);
    drawMenuButton(TITLE_BTN.settings, '设置', MIAMI.gray);

    // 只留一行最必要的键位提示
    ctx.fillStyle = MIAMI.dim;
    ctx.font = '11px "Microsoft YaHei", monospace';
    ctx.fillText(inputMode === 'touch'
      ? '左摇杆移动 · 右摇杆瞄准 · 瞄准键抬枪 · 交互键交互'
      : 'WASD 移动 · 左键开火 · 右键瞄准 · G 手雷 · E 交互/拾取 · F 扔枪', VIEW_W / 2, 326);
    ctx.restore();

    // 整页套一层 CRT 电视效果（圆角管面 / 暗角 / 扫描线 / 荧光 / 闪烁）
    applyCRT(t);
  }

  /** 绘制一个菜单按钮（霓虹描边 + 文字），hover 发光高亮。 */
  function drawMenuButton(b, label, color) {
    const hover = mouse.x >= b.x && mouse.x <= b.x + b.w && mouse.y >= b.y && mouse.y <= b.y + b.h;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 底板：hover 时亮色填充，否则半透明深底
    ctx.fillStyle = hover ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.42)';
    ctx.strokeStyle = color;
    ctx.lineWidth = hover ? 2.5 : 1.5;
    ctx.shadowColor = color;
    ctx.shadowBlur = hover ? 18 : 6;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.w, b.h, 4);
    } else {
      ctx.beginPath();
      ctx.rect(b.x, b.y, b.w, b.h);
    }
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    // 文字
    ctx.font = 'bold 16px "Microsoft YaHei", monospace';
    ctx.fillStyle = hover ? '#ffffff' : color;
    ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 1);
    ctx.textBaseline = 'alphabetic';
  }

  // 剧情结算按钮区域
  const CLEAR_BTN = {
    next: { x: VIEW_W / 2 - 90, y: 238, w: 180, h: 36 },
    retry: { x: VIEW_W / 2 - 90, y: 280, w: 180, h: 36 },
    menu: { x: VIEW_W / 2 - 90, y: 322, w: 180, h: 36 }
  };

  /** 剧情模式通关结算（红灰白黑评分卡片）。 */
  function drawStoryClear() {
    ctx.save();
    ctx.fillStyle = 'rgba(6,6,8,0.9)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';

    const grade = storyGrade();
    const last = G.storyLevel >= STORY_LEVELS.length - 1;

    // 关卡名
    ctx.font = 'bold 18px Consolas, "Microsoft YaHei", monospace';
    ctx.fillStyle = MIAMI.grayLight;
    ctx.fillText(STORY_LEVELS[G.storyLevel].title, VIEW_W / 2, 60);
    // "清空" 标语
    ctx.font = 'bold 30px Consolas, "Microsoft YaHei", monospace';
    ctx.fillStyle = MIAMI.red;
    ctx.fillText('STAGE CLEAR', VIEW_W / 2, 102);

    // 评分大字（红灰白黑：A+ 亮红发光，A 白，B 灰，C/D 暗灰）
    const gradeColor = grade === 'A+' ? '#ff3b3b' : (grade.startsWith('A') ? '#f2f2f4' : (grade === 'B' ? '#c8c8d0' : '#8a8a90'));
    ctx.font = 'bold 56px Consolas, monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(grade, VIEW_W / 2 + 2, 172);
    ctx.fillStyle = gradeColor;
    ctx.shadowColor = gradeColor;
    ctx.shadowBlur = 22;
    ctx.fillText(grade, VIEW_W / 2, 170);
    ctx.shadowBlur = 0;

    // 统计明细
    ctx.font = '13px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#c8c8d0';
    ctx.fillText('击杀 ' + (G.storyKills || 0) + ' · 最佳连击 x' + (G.storyComboBest || 0) +
      ' · 受击 ' + (G.storyHits || 0), VIEW_W / 2, 200);

    // 按钮
    if (last) {
      drawMenuButton(CLEAR_BTN.next, '通关！返回标题', MIAMI.red);
    } else {
      drawMenuButton(CLEAR_BTN.next, '下一关', MIAMI.white);
    }
    drawMenuButton(CLEAR_BTN.retry, '重玩本关', MIAMI.gray);
    drawMenuButton(CLEAR_BTN.menu, '返回主菜单', MIAMI.gray);

    ctx.restore();
  }

  // 设置页按钮区域
  const SETTINGS_BTN = {
    sound: { x: VIEW_W / 2 - 120, y: 120, w: 240, h: 34 },
    control: { x: VIEW_W / 2 - 120, y: 162, w: 240, h: 34 },
    fire: { x: VIEW_W / 2 - 120, y: 204, w: 240, h: 34 },
    layout: { x: VIEW_W / 2 - 120, y: 246, w: 240, h: 34 },
    back: { x: VIEW_W / 2 - 80, y: 292, w: 160, h: 40 }
  };

  function drawSettings() {
    ctx.save();
    ctx.fillStyle = 'rgba(6,6,8,0.88)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';
    ctx.font = 'bold 26px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#f2f2f4';
    ctx.fillText('设置', VIEW_W / 2, 96);
    // 音效开关
    const sb = SETTINGS_BTN.sound;
    const sHover = mouse.x >= sb.x && mouse.x <= sb.x + sb.w && mouse.y >= sb.y && mouse.y <= sb.y + sb.h;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = sHover ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
    ctx.strokeStyle = sHover ? '#c8c8d0' : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1.5;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(sb.x, sb.y, sb.w, sb.h, 6); }
    else { ctx.beginPath(); ctx.rect(sb.x, sb.y, sb.w, sb.h); }
    ctx.fill();
    ctx.stroke();
    ctx.font = 'bold 15px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#c8c8d0';
    ctx.fillText('音效：' + (Sfx.muted ? '关' : '开'), sb.x + sb.w / 2, sb.y + sb.h / 2 + 1);
    ctx.textBaseline = 'alphabetic';
    // 操作方式：手机触控 / 电脑键鼠
    const cb = SETTINGS_BTN.control;
    const cHover = mouse.x >= cb.x && mouse.x <= cb.x + cb.w && mouse.y >= cb.y && mouse.y <= cb.y + cb.h;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = cHover ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
    ctx.strokeStyle = cHover ? '#e02929' : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1.5;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(cb.x, cb.y, cb.w, cb.h, 6); }
    else { ctx.beginPath(); ctx.rect(cb.x, cb.y, cb.w, cb.h); }
    ctx.fill();
    ctx.stroke();
    ctx.font = 'bold 15px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#f2f2f4';
    ctx.fillText('操作方式：' + (inputMode === 'touch' ? '手机触控' : '电脑键鼠'), cb.x + cb.w / 2, cb.y + cb.h / 2 + 1);
    ctx.textBaseline = 'alphabetic';
    // 开火方式 + 自定义按键（仅手机触控模式显示）
    if (inputMode === 'touch') {
      // 开火方式：按键开火 / 摇杆开火（二选一）
      const fb = SETTINGS_BTN.fire;
      const fHover = mouse.x >= fb.x && mouse.x <= fb.x + fb.w && mouse.y >= fb.y && mouse.y <= fb.y + fb.h;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = fHover ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
      ctx.strokeStyle = fHover ? '#e02929' : 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1.5;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(fb.x, fb.y, fb.w, fb.h, 6); }
      else { ctx.beginPath(); ctx.rect(fb.x, fb.y, fb.w, fb.h); }
      ctx.fill();
      ctx.stroke();
      ctx.font = 'bold 15px "Microsoft YaHei", monospace';
      ctx.fillStyle = '#f2f2f4';
      ctx.fillText('开火方式：' + (fireMode === 'stick' ? '摇杆开火' : '按键开火'), fb.x + fb.w / 2, fb.y + fb.h / 2 + 1);
      ctx.textBaseline = 'alphabetic';

      const lb = SETTINGS_BTN.layout;
      const lHover = mouse.x >= lb.x && mouse.x <= lb.x + lb.w && mouse.y >= lb.y && mouse.y <= lb.y + lb.h;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = lHover ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
      ctx.strokeStyle = lHover ? '#7fdca0' : 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1.5;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(lb.x, lb.y, lb.w, lb.h, 6); }
      else { ctx.beginPath(); ctx.rect(lb.x, lb.y, lb.w, lb.h); }
      ctx.fill();
      ctx.stroke();
      ctx.font = 'bold 15px "Microsoft YaHei", monospace';
      ctx.fillStyle = '#a8e8c0';
      ctx.fillText('自定义按键位置', lb.x + lb.w / 2, lb.y + lb.h / 2 + 1);
      ctx.textBaseline = 'alphabetic';
    }
    // 返回按钮
    drawMenuButton(SETTINGS_BTN.back, '返回', '#c8c8d0');
    ctx.restore();
    // 设置页同属"主页面"，一起套 CRT 效果，切换时不跳味
    applyCRT(performance.now() / 1000);
  }

  /**
   * 读条准心：空心圆底 + 一圈按进度填满的弧（治疗 / 装护甲 / 换弹共用）。
   * prog 0→1 从正上方顺时针长满。画在屏幕空间，尺寸不随画面缩放变。
   */
  function drawRingCrosshair(x, y, prog, col) {
    // 空心圆底
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.stroke();
    // 进度弧
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(prog, 0, 1));
    ctx.stroke();
    // 圆心小孔
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(x, y, 1.8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** 四道刻线：gap 是离中心的距离，len 是刻线长度（屏幕像素）。 */
  function strokeTickMark(x, y, gap, len) {
    ctx.beginPath();
    ctx.moveTo(x - gap - len, y); ctx.lineTo(x - gap, y);
    ctx.moveTo(x + gap, y); ctx.lineTo(x + gap + len, y);
    ctx.moveTo(x, y - gap - len); ctx.lineTo(x, y - gap);
    ctx.moveTo(x, y + gap); ctx.lineTo(x, y + gap + len);
    ctx.stroke();
  }

  /**
   * 准心：固定画在屏幕空间（鼠标位置），不跟着世界缩放走 ——
   * 否则抬枪放大时准心跟着变大，跟"瞄准要收紧"完全反着。
   * 四道刻线的间距由当前散射决定：腰射张得很开，抬枪收到中心。
   */
  function drawCrosshair() {
    const p = G.player;
    const x = mouse.x, y = mouse.y;
    ctx.save();
    // 治疗 / 装护甲 / 换弹：准心变空心圆，并按读条进度慢慢填满一圈
    if (p && (p.healing || p.plating || p.reload > 0)) {
      if (p.healing) {
        drawRingCrosshair(x, y, p.healCharge / HEAL_TIME, '#e02929');
      } else if (p.plating) {
        drawRingCrosshair(x, y, p.plateCharge / PLATE_TIME, '#c8c8d0');
      } else {
        // 换弹：进度按"还剩多少时间"反着算，打满即装好
        const total = p.reloadTotal > 0 ? p.reloadTotal : 1;
        drawRingCrosshair(x, y, 1 - p.reload / total, '#f0c05a');
      }
      ctx.restore();
      return;
    }

    const def = p && p.weapon ? WEAPONS[p.weapon] : null;
    const gun = !!def && !def.melee;
    const aimT = p ? clamp(p.aimT, 0, 1) : 0;
    // 度数 → 屏幕像素：腰射最开 26px，瞄准收到 4px 左右
    const gap = gun ? clamp(3.5 + spreadDeg(p, def) * 1.15, 3.5, 26) : 5;
    const len = 4.5 - 1.0 * aimT;
    // 准心压在敌人头上 → 变色提示"这一枪是爆头"
    const hs = headshotTarget();
    const col = hs ? '#e02929' : 'rgba(255,74,74,0.98)';

    ctx.lineCap = 'round';
    // 黑底描边：地面花色多，单色细线在浅色地板上会看不见
    ctx.lineWidth = 3.8;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    strokeTickMark(x, y, gap, len);
    ctx.lineWidth = 2;
    ctx.strokeStyle = col;
    strokeTickMark(x, y, gap, len);

    if (aimT > 0.55) {           // 抬枪到位：中间补一颗点，方便压枪
      ctx.fillStyle = col;
      ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
    }
    if (hs) {
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = '#ffcf7a';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(x, y, gap * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // 击中敌人护甲：准心旁弹一个盾牌标志（蓝灰），提示"这枪只打掉了甲"
    if (G.armorHitT > 0) {
      const a = clamp(G.armorHitT / 0.18, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#8fd0ff';
      ctx.lineWidth = 2;
      ctx.fillStyle = 'rgba(90,170,224,0.25)';
      // 盾牌：上边一个小圆顶 + 下方收窄
      ctx.beginPath();
      ctx.moveTo(x + 16, y - 8);
      ctx.quadraticCurveTo(x + 16, y - 14, x + 10, y - 14);
      ctx.quadraticCurveTo(x + 7, y - 14, x + 7, y - 8);
      ctx.lineTo(x + 7, y + 2);
      ctx.lineTo(x + 4, y + 4);
      ctx.lineTo(x + 4, y + 7);
      ctx.lineTo(x + 19, y + 7);
      ctx.lineTo(x + 19, y + 4);
      ctx.lineTo(x + 16, y + 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    // 护甲被打碎：准心旁散开的破碎裂纹图案
    if (G.armorBreakT > 0) {
      const a = clamp(G.armorBreakT / 0.5, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#cfe8ff';
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      const cx = x + 16, cy = y - 4;
      // 一圈向外放射的短裂纹，模拟甲片崩裂
      for (let i = 0; i < 7; i++) {
        const ang = (i / 7) * Math.PI * 2 + 0.3;
        const r0 = 5, r1 = 9 + (1 - a) * 3;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
        ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  /** 准心是否压在某个敌人的头上（HUD 提示用）。 */
  function headshotTarget() {
    if (!G.player || G.state !== 'play') return null;
    const aim = screenToWorld(mouse.x, mouse.y);
    for (const e of W.enemies) {
      if (!e.alive) continue;
      if (Math.hypot(aim.x - e.x, aim.y - e.y) <= HEADSHOT_R) return e;
    }
    return null;
  }

  function render() {
    // 菜单界面显示系统光标，战斗时隐藏系统光标（改用准心）。
    canvas.style.cursor = (G.state !== 'play' || G.paused) ? 'default' : 'none';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0f0c12';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    if (G.state === 'settings') { drawSettings(); return; }
    if (G.state === 'layout') { drawLayout(); return; }
    if (G.state === 'title' || !W) { drawTitle(); return; }
    if (G.state === 'storyclear') { drawStoryClear(); return; }

    // 相机 + 抖动
    let sx = 0, sy = 0;
    if (FX.shakeT > 0) {
      const k = FX.shake * (FX.shakeT / 0.16);
      sx = (Math.random() - 0.5) * k * 2;
      sy = (Math.random() - 0.5) * k * 2;
    }
    // 低血量：画面边缘持续轻微泛红
    if (G.player && G.player.hp < HP_MAX * 0.3) {
      const dk = (1 - G.player.hp / (HP_MAX * 0.3)) * 0.6;
      sx += (Math.random() - 0.5) * dk;
      sy += (Math.random() - 0.5) * dk;
      G.lowHp = 1;
    } else {
      G.lowHp = 0;
    }
    ctx.save();
    const z = camZoom();
    ctx.scale(z, z);
    // 取整要按 canvas 像素而不是世界像素：世界 1px = z 个 canvas 像素，
    // 按世界取整等于每次跨 z px，相机平滑时就成了"一顿一顿"地跳。
    ctx.translate(-Math.round(G.cam.x * z) / z + sx,
                  -Math.round(G.cam.y * z) / z + sy);

    drawGround();
    // 地面压暗一档，让墙和角色更跳出来
    ctx.fillStyle = 'rgba(9,7,11,0.14)';
    ctx.fillRect(0, 0, W.pxW, W.pxH);
    // 血迹贴花
    ctx.drawImage(W.decals, 0, 0);
    drawWalls();
    drawCovers();
    drawBarrels();
    drawDoors();
    drawSupplies();
    drawStations();
    drawExit();

    // 先画尸体（最底层活物）。被砍飞胳膊/打掉头的，画"剩下的躯干"而不是整张尸体图，
    // 否则地上躺着一只手、身上还长着一只手（之前就是只把肢体甩出去、尸体原样留着）。
    for (const e of W.enemies) {
      if (!e.alive) drawActor(e, ENEMY_KIND[e.kind].tex, false, ENEMY_KIND[e.kind].corpse);
    }
    // 拾取物压在尸体上面，避免血包/弹药被尸体盖住捡不到
    drawPickups();
    // 活人压在最上面
    for (const e of W.enemies) {
      if (e.alive) drawActor(e, ENEMY_KIND[e.kind].tex, false, ENEMY_KIND[e.kind].corpse);
    }
    drawActor(G.player, 'player', true, 'corpse_player');
    drawLaser();

    drawGrenades();
    drawThrown();
    drawEffects();
    drawBlasts();
    drawWorldTexts();
    drawBossBars();
    ctx.restore();

    // 受击闪白
    if (FX.flash > 0) {
      ctx.fillStyle = 'rgba(255,240,200,' + (FX.flash * 0.10) + ')';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    // 低血泛红
    if (G.lowHp) {
      const g2 = ctx.createRadialGradient(
        VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.25,
        VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.75
      );
      g2.addColorStop(0, 'rgba(180,20,20,0)');
      g2.addColorStop(1, 'rgba(180,20,20,0.35)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    drawVignette();
    // 准心画在屏幕空间、且压在暗角之后：不跟着世界缩放变大变小，
    // 也不会被边缘暗角/受击闪白糊掉（之前被压暗成一坨暗红，看着像没画）
    drawCrosshair();
    drawHUD();
    drawGoBackPrompt();
    drawTouchUI();
    if (G.state === 'shop') drawShop();
    if (G.state === 'upgrade') drawUpgrade();
  }

  // ---------------------------------------------------------------- 主循环
  let last = 0;
  let acc = 0;
  const STEP = 1 / 60;

  function loop(now) {
    if (!last) last = now;
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;

    // 本帧有没有真正推进过一帧逻辑。高刷新率显示器上（或者顿帧/暂停时）
    // 有些帧 acc 还没攒够 STEP，一帧 update 都不跑 —— 这时如果照样清空 pressed，
    // 这一下按键就被吞了，表现就是"按 4 要按好多下才切出护甲板"。
    // 所以只在跑到过 update 的帧末尾清空，没跑到的帧把按键留到下一帧。
    let advanced = false;
    if (G && (G.state === 'title' || G.state === 'settings' || G.state === 'layout')) advanced = true;   // 标题/设置/编辑画面不跑逻辑，按键当帧作废

    if (G && G.state !== 'title' && G.state !== 'settings' && G.state !== 'layout') {
      if (G.paused || G.freeze) {
        // 暂停时主循环提前返回，所以这里的按键得自己处理，否则暂停后恢复不了
        if (G.paused) handlePauseKeys();
        pressed = Object.create(null);
        render();
        if (G.paused) drawPause();
        requestAnimationFrame(loop);
        return;
      }
      // 顿帧
      if (FX.hitstop > 0) {
        FX.hitstop -= dt;
      } else {
        // 慢动作恢复
        if (G.slowTimer > 0) {
          G.slowTimer -= dt;
          if (G.slowTimer <= 0) G.timeScale = 1;
        }
        acc += dt * (G.timeScale || 1);
        let guard = 0;
        while (acc >= STEP && guard < 5) {
          if (G.state === 'shop') {
            // 商店状态：只推进老虎机动画
            if (G.slotState) updateSlot(STEP);
          } else if (G.state === 'upgrade') {
            // 升级站：纯 UI，不推进世界逻辑（敌人/玩家都冻结）
          } else {
            update(STEP);
          }
          advanced = true;
          acc -= STEP;
          guard++;
        }
        if (G.comboTimer > 0) { G.comboTimer -= dt; if (G.comboTimer <= 0) G.combo = 0; }
        if (G.toastTimer > 0) G.toastTimer -= dt;
        if (G.armorHitT > 0) G.armorHitT -= dt;
        if (G.armorBreakT > 0) G.armorBreakT -= dt;
        if (G.centerTimer > 0) { G.centerTimer -= dt; if (G.centerTimer <= 0 && (G.state === 'clear' || G.state === 'play')) G.centerText = ''; }
      }
    }

    handleGlobalKeys(advanced);
    render();
    if (G && G.paused) drawPause();
    requestAnimationFrame(loop);
  }

  function drawPause() {
    ctx.save();
    ctx.fillStyle = 'rgba(6,6,8,0.7)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';
    ctx.font = 'bold 20px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#f2f2f4';
    ctx.fillText('暂停', VIEW_W / 2, VIEW_H / 2 - 34);
    // 三个选项：继续 / 设置 / 返回主菜单（鼠标悬停或键盘选中高亮）
    const sel = G.pauseSel || 0;
    const items = [
      { label: '继续游戏', y: VIEW_H / 2 - 34 },
      { label: '设置', y: VIEW_H / 2 },
      { label: '返回主菜单', y: VIEW_H / 2 + 34 }
    ];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const b = { x: VIEW_W / 2 - 80, y: it.y - 14, w: 160, h: 28 };
      const hover = mouse.x >= b.x && mouse.x <= b.x + b.w && mouse.y >= b.y && mouse.y <= b.y + b.h;
      const active = sel === i || hover;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = active ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.03)';
      ctx.strokeStyle = active ? (i === 2 ? '#e53935' : '#c8c8d0') : 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1.5;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 5); }
      else { ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); }
      ctx.fill();
      ctx.stroke();
      ctx.font = 'bold 15px "Microsoft YaHei", monospace';
      ctx.fillStyle = active ? '#ffffff' : '#c8c8d0';
      ctx.fillText(it.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
      ctx.textBaseline = 'alphabetic';
    }
    ctx.font = '11px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#9c90a8';
    ctx.fillText(inputMode === 'touch'
      ? '点选项确认 · 点「继续游戏」返回'
      : 'W/S 选择 · 回车/左键确认 · ESC 继续', VIEW_W / 2, VIEW_H / 2 + 78);
    ctx.restore();
  }

  /** 返回主菜单：清空世界和玩家，state 回 title（标题页纯 UI，不跑游戏逻辑）。 */
  function goTitle() {
    G.state = 'title';
    G.paused = false;
    G.pauseSel = 0;
    G.settingsFrom = 'title';
    G.centerText = '';
    G.centerTimer = 0;
    W = null;
    G.player = null;
    G.grenades = [];
    BLASTS.length = 0;
  }

  /** 打开设置页，记录来源（标题 or 暂停），返回时据此决定去向。 */
  function openSettings(from) {
    G.settingsFrom = from === 'pause' ? 'pause' : 'title';
    G.state = 'settings';
    if (from === 'pause') G.paused = false;
  }

  /** 关闭设置页：从暂停进入则回到暂停菜单，否则回标题。 */
  function closeSettings() {
    if (G.settingsFrom === 'pause') {
      G.state = 'play';
      G.paused = true;
    } else {
      G.state = 'title';
    }
  }

  /** 暂停菜单的按键处理（仅在 paused 时由 loop 调用）。 */
  function handlePauseKeys() {
    if (pressed['escape']) { G.paused = false; return; }
    if (pressed['w'] || pressed['arrowup']) G.pauseSel = (G.pauseSel + 2) % 3;
    if (pressed['s'] || pressed['arrowdown']) G.pauseSel = (G.pauseSel + 1) % 3;
    if (pressed['enter'] || pressed[' ']) {
      if (G.pauseSel === 0) G.paused = false;
      else if (G.pauseSel === 1) openSettings('pause');
      else goTitle();
    }
  }

  /** 立即跳过整备倒计时，进入下一波（键盘空格/回车 与 触控跳过按钮共用）。 */
  function skipIntermission() {
    if (!(G.state === 'play' && W.cleared && G.intermission > 0)) return;
    G.intermission = 0;
    if (G.doubleScore > 0) G.doubleScore--;
    startWave();
  }

  function handleGlobalKeys(advanced) {
    if (advanced === undefined) advanced = true;
    if (pressed['escape']) {
      if (G.state === 'play' || G.state === 'dead') {
        G.paused = !G.paused;
        // 当场吃掉这个 ESC：否则下一帧 loop 的暂停分支会看到残留的 escape，
        // 把刚打开的暂停界面立刻又关掉（144Hz 下按下那一帧经常没跑 update）。
        pressed = Object.create(null);
        return;
      }
    }
    // 剧情结算：回车/空格进入下一关（或重开）
    if (G.state === 'storyclear') {
      if (pressed['enter'] || pressed[' ']) {
        nextStoryLevel();
        pressed = Object.create(null);
        return;
      }
    }
    // 补给点商店操作：上下选，回车/左键买，E 或 ESC 关闭
    if (G.state === 'shop') {
      // 老虎机是商店里的一个子界面：回车再摇一次，ESC / E 退回商品列表
      if (G.slotState) {
        if (pressed['escape'] || pressed['e']) {
          G.slotState = null;
          Sfx.play('empty');
        } else if (pressed['enter'] || pressed[' ']) {
          const price = (SHOP.find(it => it.kind === 'slot') || { price: 9999 }).price;
          if (!G.slotState.spinning && G.cash >= price) {
            G.cash -= price;
            G.slotState = startSlot();
            Sfx.play('pickup');
          } else {
            Sfx.play('empty');
          }
        }
        pressed = Object.create(null);
        return;
      }
      // 网格导航：W/S 在列内上下移动，A/D 左右换列（同行对齐，右列项不足时 clamp 到末项）
      const nCols = Math.ceil(SHOP.length / SHOP_COLS);   // 列数（当前 2 列）
      const shopCol = Math.floor(G.shopSel / SHOP_COLS);  // 当前列 0=左 1=右
      const shopRow = G.shopSel % SHOP_COLS;              // 当前行（列内偏移）
      if (pressed['w'] || pressed['arrowup']) {
        G.shopSel = (shopRow + SHOP_COLS - 1) % SHOP_COLS + shopCol * SHOP_COLS;
      }
      if (pressed['s'] || pressed['arrowdown']) {
        G.shopSel = (shopRow + 1) % SHOP_COLS + shopCol * SHOP_COLS;
      }
      if (pressed['a'] || pressed['arrowleft']) {
        if (shopCol > 0) G.shopSel = shopRow;             // 左移：回左列同行
      }
      if (pressed['d'] || pressed['arrowright']) {
        if (shopCol < nCols - 1) {
          const rightLen = SHOP.length - SHOP_COLS;       // 右列实际项数
          G.shopSel = SHOP_COLS + Math.min(shopRow, rightLen - 1);   // 右移：同行对齐，不足则贴末项
        }
      }
      if (pressed['enter'] || pressed[' '] || pressed['j']) buyShopItem();
      if (pressed['e'] || pressed['escape']) closeShop();
      pressed = Object.create(null);
      return;
    }
    // 武器升级站：A/D 换枪、W/S 换线、回车买、E/ESC 关闭
    if (G.state === 'upgrade') {
      if (pressed['a'] || pressed['arrowleft']) G.upgSel.gun = (G.upgSel.gun + UP_GUNS.length - 1) % UP_GUNS.length;
      if (pressed['d'] || pressed['arrowright']) G.upgSel.gun = (G.upgSel.gun + 1) % UP_GUNS.length;
      if (pressed['w'] || pressed['arrowup']) G.upgSel.line = Math.max(0, G.upgSel.line - 1);
      if (pressed['s'] || pressed['arrowdown']) G.upgSel.line = Math.min(UP_ARMOR_LINE, G.upgSel.line + 1);
      if (pressed['enter'] || pressed[' '] || pressed['j']) buyUpgrade();
      if (pressed['e'] || pressed['escape']) closeUpgrade();
      pressed = Object.create(null);
      return;
    }
    // 设置页：ESC 返回（来源是暂停则回暂停，否则回标题）
    if (G.state === 'settings') {
      if (pressed['escape']) { closeSettings(); pressed = Object.create(null); return; }
    }
    // 按键/HUD 自定义编辑页：ESC 保存并返回
    if (G.state === 'layout') {
      if (pressed['escape']) {
        if (layoutMode === 'ui') saveHudLayout(); else saveTouchLayout();
        closeSettings(); pressed = Object.create(null); return;
      }
    }
    // R：手动换弹（重置关卡功能已去掉，死了会自动重来）
    if (pressed['r'] && G.state === 'play' && G.mode !== 'story') startReload();
    // 整备期间：空格/回车跳过，立即进下一波
    if (G.state === 'play' && W.cleared && G.intermission > 0 &&
        (pressed[' '] || pressed['enter'])) {
      skipIntermission();
    }
    // E 键：走近补给点开商店，走近升级站开升级界面（第 5 波后解锁）。
    // 都没靠近时，E 交给拾取武器逻辑（updatePlayer 里已用 interactTarget 区分）。
    if (pressed['e'] && G.state === 'play') {
      const t = interactTarget();
      if (t && t.type === 'shop') {
        openShop();
        pressed = Object.create(null);
      } else if (t && t.type === 'upgrade') {
        if (G.upgUnlocked) openUpgrade();
        else {
          G.toast = '升级站 第 ' + UP_UNLOCK_WAVE + ' 波后开放';
          G.toastTimer = 1.8;
        }
        pressed = Object.create(null);
      }
    }
    if (pressed['m']) { Sfx.muted = !Sfx.muted; }
    // 清空本帧按下状态：只有真跑过 update 的帧才清（否则这一下按键会被吞掉）
    if (advanced) pressed = Object.create(null);
  }

  function closeShop() {
    G.state = 'play';
    G.slotState = null;
    // 同上：关店的按键不能留到下一帧，否则下一帧又把它当成"开商店"
    pressed = Object.create(null);
  }

  // ---------------------------------------------------------------- 启动
  function loadImages() {
    return new Promise((resolve) => {
      let left = SPRITE_NAMES.length;
      for (const name of SPRITE_NAMES) {
        const img = new Image();
        img.onload = () => { if (--left === 0) resolve(); };
        img.onerror = () => {
          console.error('贴图加载失败: ' + name);
          if (--left === 0) resolve();
        };
        img.src = SPRITE_DIR + name + '.png';
        IMG[name] = img;
      }
    });
  }

  function boot() {
    // 读取上次的操作方式（手机触控 / 电脑键鼠），默认电脑
    try {
      const saved = localStorage.getItem('hotline.inputMode');
      if (saved === 'touch' || saved === 'pc') inputMode = saved;
    } catch (err) { /* 忽略 */ }

    // 读取上次的开火方式（按键开火 / 摇杆开火），默认按键
    try {
      const fm = localStorage.getItem('hotline.fireMode');
      if (fm === 'button' || fm === 'stick') fireMode = fm;
    } catch (err) { /* 忽略 */ }

    // 读取自定义触控按键布局（覆盖 TOUCH_LAYOUT 坐标）
    loadTouchLayout();
    // 读取自定义 HUD 元素偏移
    loadHudLayout();

    fitCanvas();
    window.addEventListener('resize', fitCanvas);
    window.addEventListener('orientationchange', () => setTimeout(fitCanvas, 100));
    // 上次是手机触控 → 重新铺满宽度（横屏）
    if (inputMode === 'touch') requestLandscape();

    G = {
      state: 'title',
      mode: 'challenge',    // 'challenge'（波次生存）| 'story'（剧情逐关）
      levelIndex: 0,
      storyLevel: 0,
      storyKills: 0,
      storyComboBest: 0,
      storyHits: 0,
      storyClearT: 0,
      storyStartT: 0,
      goBack: 0,           // 剧情清场后 GO BACK 提示的计时（0 = 未触发）
      score: 0,
      cash: 0,
      wave: 0,
      combo: 0,
      comboTimer: 0,
      bestCombo: 0,
      shopSel: 0,
      intermission: 0,
      player: null,
      cam: { x: 0, y: 0 },
      camV: { x: 0, y: 0 },
      zoom: ZOOM,          // 当前画面缩放（瞄准时升高 → 视野变窄、看得更远）
      toast: '',
      toastTimer: 0,
      centerText: '',
      centerColor: '#fff',
      centerTimer: 0,
      timeScale: 1,
      slowTimer: 0,
      paused: false,
      pauseSel: 0,          // 暂停菜单选中项：0=继续，1=设置，2=返回主菜单
      settingsFrom: 'title', // 设置页来源：'title'（标题进入）| 'pause'（暂停进入），决定返回去向
      deadTimer: 0,
      clearTimer: 0,
      fireTap: false,
      grenades: [],        // 飞行中的手雷
      blasts: [],          // 冲击波（视觉层，和 BLASTS 互为引用）
      // 命中反馈：击中敌人护甲 / 击碎敌人护甲时的准心旁提示（计时器，>0 时显示）
      armorHitT: 0,
      armorBreakT: 0,
      // 武器升级：按枪种记账（pistol/smg/shotgun），第 5 波清完解锁
      upg: makeUpgrades(),
      upgUnlocked: false,
      upgSel: { gun: 0, line: 0 }
    };
    G.blasts = BLASTS;

    loadImages().then(() => {
      const bootEl = document.getElementById('boot');
      if (bootEl) bootEl.remove();
      // 鼠标按下时记录单击（用于半自动武器）。只在战斗态设置，
      // 否则标题/结算页点「开始游戏/下一关」按钮的 mousedown 会残留 fireTap，
      // 进战斗后第一帧被消费而误开一枪。
      canvas.addEventListener('mousedown', (e) => {
        if (e.button === 0 && G.state === 'play') G.fireTap = true;
      });
      // ?autostart=1 直接进第一波，方便截图和自动化测试；?prep=1 保留开局 30 秒准备期
      // ?story=1 直接进剧情模式第一关（截图/调试用）
      if (/[?&]story=1/.test(location.search)) {
        startGame({ mode: 'story', prep: false });
        // ?storylevel=N 直接跳到剧情第 N 关（0-based，截图/调试用）
        const slM = /[?&]storylevel=(\d)/.exec(location.search);
        if (slM && G.mode === 'story') {
          const idx = clamp(parseInt(slM[1], 10), 0, STORY_LEVELS.length - 1);
          if (idx > 0) {
            G.storyLevel = idx;
            G.storyKills = 0; G.storyComboBest = 0; G.storyHits = 0;
            G.storyStartT = performance.now();
            W = buildLevel(idx, STORY_LEVELS[idx]);
            G.levelIndex = idx;
            G.player.x = W.spawn.x; G.player.y = W.spawn.y;
            spawnStoryEnemies(idx);
            G.centerText = STORY_LEVELS[idx].title;
            G.centerColor = MIAMI.pink;
            G.centerTimer = 2.2;
            updateCamera(0);
          }
        }
      } else if (/[?&]autostart=1/.test(location.search)) {
        startGame({ prep: /[?&]prep=1/.test(location.search) });
      }
      // ?storyclear=1 直接进入剧情结算界面（截图核对评分卡片用）
      if (/[?&]storyclear=1/.test(location.search) && G.mode === 'story') {
        G.storyKills = G.storyKills || 3;
        G.storyComboBest = G.storyComboBest || 4;
        G.storyHits = 1;
        G.state = 'storyclear';
        G.storyClearT = 0;
      }
      // ?settings=1 直接进设置页，用于截图核对（调试用）
      if (/[?&]settings=1/.test(location.search)) {
        G.state = 'settings';
      }
      // ?layout=1 直接进按键自定义编辑页，用于截图核对（调试用）
      if (/[?&]layout=1/.test(location.search)) {
        openTouchLayout();
        if (/[?&]layoutui=1/.test(location.search)) layoutMode = 'ui';
      }
      // ?touch=1 切到手机触控模式（截图核对摇杆/按钮 UI 用）
      if (/[?&]touch=1/.test(location.search)) {
        setInputMode('touch');
      }
      // ?firemode=stick 切到摇杆开火模式（截图核对开火按钮隐藏/摇杆 UI 用）
      if (/[?&]firemode=stick/.test(location.search)) {
        setFireMode('stick');
      }
      // ?peek=1 出生点挪到第一个敌人旁边，用于看战斗区域（调试用）
      if (/[?&]peek=1/.test(location.search) && W && W.enemies.length) {
        const e = W.enemies[0];
        G.player.x = e.x - 46;
        G.player.y = e.y;
        updateCamera(0);
      }
      // ?at=x,y 把玩家直接摆到世界坐标 (x,y)，用于截图核对相机（调试用）
      const atM = /[?&]at=(-?[\d.]+),(-?[\d.]+)/.exec(location.search);
      if (atM && G.player) {
        G.player.x = parseFloat(atM[1]);
        G.player.y = parseFloat(atM[2]);
        updateCamera(0);
      }
      // ?gun=shotgun 直接塞一把武器（截图/调试用）
      const gunM = /[?&]gun=(\w+)/.exec(location.search);
      if (gunM && G.player && WEAPONS[gunM[1]]) {
        G.player.weapon = gunM[1];
        G.player.ammo = WEAPONS[gunM[1]].mag;
        G.player.reserve = WEAPONS[gunM[1]].reserveMax || 0;
      }
      // ?ammo=6 把弹匣压到指定发数（截图核对"按 R 换弹"提示用）
      const ammoM = /[?&]ammo=(\d+)/.exec(location.search);
      if (ammoM && G.player) G.player.ammo = parseInt(ammoM[1], 10);
      // ?ads=1 直接摆出"抬枪到位"的状态（冻结逻辑，截图核对准心与视野用）
      const adsM = /[?&]ads=([\d.]+)/.exec(location.search);
      if (adsM && G.player) {
        const t = clamp(parseFloat(adsM[1]), 0, 1);
        G.player.aimT = t;
        G.player.aiming = t > 0.5;
        G.zoom = ZOOM * (1 + (AIM_ZOOM_MUL - 1) * t);
        updateCamera(0);          // 相机直接吸到抬枪后的位置（前探也一并生效）
        G.freeze = true;
      }
      // ?side=shotgun 给玩家背上塞一把副武器（截图/调试用）
      const sideM = /[?&]side=(\w+)/.exec(location.search);
      if (sideM && G.player && WEAPONS[sideM[1]]) {
        const sd = WEAPONS[sideM[1]];
        G.player.side = { weapon: sideM[1], ammo: sd.mag, reserve: sd.reserveMax || 0 };
      }
      // ?dual=1 把当前武器进化成"双持"状态（截图核对双枪视觉用）
      if (/[?&]dual=1/.test(location.search) && G.player && G.upg) {
        const dw = G.player.weapon;
        if (dw && DUAL_GUNS[dw]) G.upg[dw].evo = true;
      }
      // ?upgrade=1 直接打开升级站（截图核对 UI 用），顺便给点钱和几把枪
      if (/[?&]upgrade=1/.test(location.search) && G.player) {
        G.upgUnlocked = true;
        G.cash = 5000;
        G.player.side = { weapon: 'smg', ammo: gunStat('smg', 'mag'), reserve: WEAPONS.smg.reserveMax };
        openUpgrade();
      }
      // ?heal=0.6 / ?plate=0.4 摆出"正在治疗 / 正在装护甲 + 读条进度"的状态（截图调试用）
      // ?reload=0.5 摆出"换弹到一半"的状态，用来核对准心进度环
      const healM = /[?&]heal=([\d.]+)/.exec(location.search);
      if (healM && G.player) {
        G.player.medkits = 2;
        G.player.healing = true;
        G.player.healCharge = HEAL_TIME * parseFloat(healM[1]);
        G.freeze = true;          // 冻结逻辑，读条进度才不会被下一帧清掉
      }
      const plateM = /[?&]plate=([\d.]+)/.exec(location.search);
      if (plateM && G.player) {
        G.player.armorPlates = 2;
        G.player.plating = true;
        G.player.plateCharge = PLATE_TIME * parseFloat(plateM[1]);
        G.freeze = true;
      }
      // ?reload=0.5 冻结在"换弹进行到 50%"，看准心进度环
      const rlM = /[?&]reload=([\d.]+)/.exec(location.search);
      if (rlM && G.player && G.player.weapon && !WEAPONS[G.player.weapon].melee) {
        const def = WEAPONS[G.player.weapon];
        G.player.reloadTotal = def.reload;
        G.player.reload = def.reload * (1 - parseFloat(rlM[1]));
        G.freeze = true;
        // 顺带把旧弹匣甩到半空并冻住，截图才能核对换弹特效的姿势
        const pa = G.player, rang = Math.atan2(pa.facing.y, pa.facing.x);
        FX.addClip(pa.x + pa.facing.x * 10, pa.y + pa.facing.y * 10, rang);
        for (let i = 0; i < 10; i++) FX.update(1 / 60);
      }
      // ?corpses=1 把敌人摆成一圈打死，用于截图核对尸体/血迹（调试用）
      if (/[?&]corpses=1/.test(location.search) && W) {
        const offs = [[70, -44], [96, 6], [66, 46], [24, -70]];
        W.enemies.forEach((e, i) => {
          const o = offs[i % offs.length];
          e.x = G.player.x + o[0];
          e.y = G.player.y + o[1];
          damageEnemy(e, 9999, i * 1.5, true);
        });
        updateCamera(0);
      }
      // ?shop=1 直接打开商店界面（截图用）
      if (/[?&]shop=1/.test(location.search) && G.player) {
        G.cash = 2500;
        openShop();
      }
      // ?pause=1 直接打开暂停菜单（截图核对 UI 用）
      if (/[?&]pause=1/.test(location.search) && G.player) {
        G.paused = true;
      }
      // ?grenade=1 切出手雷手持状态（截图核对手持手雷视觉用）
      if (/[?&]grenade=1/.test(location.search) && G.player) {
        G.player.grenadeHeld = true;
        G.player.grenades = 3;
      }
      // ?aim=dx,dy 把鼠标固定在画面中心偏移 (dx,dy) 的位置，用于截图核对相机前探（调试用）
      const aimM = /[?&]aim=(-?[\d.]+),(-?[\d.]+)/.exec(location.search);
      if (aimM) {
        mouse.x = VIEW_W / 2 + parseFloat(aimM[1]);
        mouse.y = VIEW_H / 2 + parseFloat(aimM[2]);
        updateCamera(0);
      }
      // ?laser=3 给当前手持枪种直接升到指定激光等级（截图核对红外激光红线用）
      const laserM = /[?&]laser=(\d)/.exec(location.search);
      if (laserM && G.player && G.player.weapon && G.upg) {
        const gu = G.upg[G.player.weapon];
        if (gu) gu.laser = parseInt(laserM[1], 10);
      }
      window.__ready = true;
      requestAnimationFrame(loop);
    });
  }

  // 暴露给调试 / 自动化测试
  window.HOTLINE = {
    get world() { return W; },
    get g() { return G; },
    /** 换弹甩出的旧弹匣（测试断言"动画有没有真的触发"用） */
    get fxClips() { return FX.clips; },
    /** 空中血珠 / 飞出去的断肢（测试"喷溅、断肢有没有真的触发"用） */
    get fxSprays() { return FX.sprays; },
    get fxGibs() { return FX.gibs; },
    /** 排队等着落地的血泊/血痕 */
    get bloodPending() { return (W && W.bloodPending) || []; },
    get arena() { return ARENA; },
    get shop() { return SHOP; },
    get slotSymbols() { return SLOT_SYMBOLS; },
    /** 音效系统（测试"枪声采样有没有解码成功"用） */
    get sfx() { return Sfx; },
    /** 敌人数值表（前摇 / 精度等难度参数的测试断言用） */
    get enemyKind() { return ENEMY_KIND; },
    enemyWindup, enemyAimErr,
    /** 敌人推门 / 门口净空判断（测试用） */
    pushDoor, nearClosedDoor, nudgeFromDoor,
    /** 测试默认跳过开局准备期，直接进第一波；想测准备期传 { prep: true } */
    startGame(opts) { return startGame(Object.assign({ prep: false }, opts || {})); },
    /** 结束当前倒计时（准备期 / 整备期都适用），立即开下一波 */
    beginWaveNow() {
      if (G.intermission > 0) G.intermission = 0;
      if (W.cleared) startWave();
    },
    startWave,
    openShop,
    buyShopItem,
    closeShop,
    /** 商店底部按钮布局 / 商品行命中检测（测试点击购买、退出用） */
    shopButtons,
    shopItemAt,
    /** 模拟一次鼠标/触屏点击（会走 onPointerDown 的按钮分发） */
    tap(x, y) {
      mouse.x = x; mouse.y = y;
      onPointerDown({ button: 0 });
    },
    goTitle,
    handlePauseKeys,
    startSlot,
    updateSlot,
    grantSkill,
    nearSupply,
    nearStation,
    interactTarget,
    /** 触控（手机）模式相关：切换操作方式 / 摇杆归类 / 触控输入折算 */
    setInputMode,
    get inputMode() { return inputMode; },
    applyTouchAim,
    setFireMode,
    get fireMode() { return fireMode; },
    classifyTouch,
    applyTouchInput,
    skipIntermission,
    /** 按键自定义：保存 / 恢复默认 / 读取，以及读取某个控件坐标（测试用） */
    saveTouchLayout,
    resetTouchLayout,
    loadTouchLayout,
    getLayoutPos(id) {
      const it = LAYOUT_ITEMS.find(i => i.id === id);
      return it ? { x: it.ref.x, y: it.ref.y } : null;
    },
    setLayoutPos(id, x, y) {
      const it = LAYOUT_ITEMS.find(i => i.id === id);
      if (it) { it.ref.x = x; it.ref.y = y; }
    },
    /** HUD 元素自定义：保存 / 恢复 / 读取偏移，以及 layoutMode（测试用） */
    saveHudLayout,
    resetHudLayout,
    loadHudLayout,
    getHudOff(id) { return HUD_OFF[id] ? { x: HUD_OFF[id].x, y: HUD_OFF[id].y } : null; },
    setHudOff(id, x, y) { if (HUD_OFF[id]) { HUD_OFF[id].x = x; HUD_OFF[id].y = y; } },
    get layoutMode() { return layoutMode; },
    openTouchLayout,
    refillArmor,
    /** 护甲等级辅助（测试护甲升级用） */
    armorMax,
    armorTier,
    openUpgrade,
    closeUpgrade,
    buyUpgrade,
    /** 升级站底部按钮布局 / 命中检测（测试点击购买、退出、换枪、选行用） */
    upgradeButtons,
    upgradeHitAt,
    gunStat,
    gunUp,
    gunEvolved,
    upAllMaxed,
    upCost,
    get upgrades() { return G ? G.upg : null; },
    get upgUnlocked() { return G ? G.upgUnlocked : false; },
    get UP_ARMOR_LINE() { return UP_ARMOR_LINE; },
    get ARMOR_TIERS() { return ARMOR_TIERS; },
    get upgLines() { return UPGRADE_LINES; },
    get upGuns() { return UP_GUNS; },
    /** 图标调试：把武器剪影 / 消耗品图标画到外部 context 上（对比形状用） */
    drawWeaponSprite, drawItemIcon, whiteSprite,
    freeze(on) { if (G) G.freeze = !!on; },
    /** 手动推进 n 个物理步（不渲染），用于无头测试 */
    step(n) { for (let i = 0; i < (n || 1); i++) update(STEP); },
    /** 测试辅助：模拟按下/松开一个键（设置 keys 与 pressed） */
    key(k, down) {
      const kk = String(k).toLowerCase();
      keys[kk] = !!down;
      if (down) pressed[kk] = true;
    },
    /** 测试辅助：清空本帧刚按下状态（模拟 handleGlobalKeys 的收尾清空） */
    clearPressed() { pressed = Object.create(null); },
    /** 测试辅助：模拟一帧的收尾。advanced=false 表示这一帧没跑到 update（高刷新率常见） */
    frameEnd(advanced) { handleGlobalKeys(advanced === undefined ? true : advanced); },
    /** 测试辅助：还没被消费的按键 */
    get pendingKeys() { return Object.keys(pressed); },
    /** 测试辅助：模拟按住/松开左键（fireHeld） */
    holdFire(down) { mouse.down = !!down; },
    /** 测试辅助：模拟按住/松开右键（瞄准） */
    holdAim(down) { mouse.right = !!down; },
    /** 测试辅助：模拟按住/松开手机「瞄准键」（走 applyTouchInput 折算成 mouse.right） */
    holdAimBtn(down) { touch.aimBtnActive = !!down; applyTouchInput(); },
    /** 测试辅助：手机瞄准键当前是否折算成右键瞄准 */
    get touchAiming() { return mouse.right; },
    /** 测试辅助：模拟右摇杆拖动到 aimBase + (dx,dy)（用于验证推到边缘开火），dx/dy 传 0 表示回中 */
    setAimDrag(dx, dy) {
      touch.aimActive = true;
      touch.aimOrigin = { x: TOUCH_LAYOUT.aimBase.x + dx, y: TOUCH_LAYOUT.aimBase.y + dy };
      applyTouchInput();
    },
    /** 测试辅助：当前是否在开火（由右摇杆边缘/开火键推导） */
    get touchFiring() { return mouse.down; },
    /** 测试辅助：本帧是否产生了单击（半自动武器开火依据） */
    get fireTap() { return G ? G.fireTap : false; },
    /** 测试辅助：消耗掉本帧的单击标记（模拟 updatePlayer 已消费） */
    consumeFireTap() { if (G) G.fireTap = false; },
    /** 当前散射（度）：腰射 / 瞄准差多少，测试直接断言这个 */
    spreadDeg() {
      const p = G && G.player;
      return (p && p.weapon) ? spreadDeg(p, WEAPONS[p.weapon]) : 0;
    },
    /** 当前画面缩放（瞄准会升高） */
    get zoom() { return camZoom(); },
    attack() { if (G.player) playerAttack(); },
    pickup() { tryPickup(true); },
    reload() { return startReload(); },
    swap() { return swapWeapon(); },
    /** 手雷：投掷 / 直接炸开（测试用） */
    grenade() { return throwGrenade(); },
    explode(x, y, r, dmg) { explodeAt(x, y, r || GRENADE_RADIUS, dmg || GRENADE_DMG, true); },
    ignite(b) { return igniteBarrel(b); },
    /** 直接对敌人造成伤害（测试用） */
    hitEnemy(e, dmg) { return damageEnemy(e, dmg || 999, 0, true, false); },
    /** 破门（测试用） */
    breakDoor(d, hitPos) { return breakDoor(d, hitPos || { x: d.x, y: d.y }); },
    /** 剧情模式：把手上的枪扔出去（测试用） */
    throwWeapon() { return throwWeapon(); },
    get thrown() { return W ? W.thrown : []; },
    /** 剧情模式：评分 / 下一关 / 重开（测试用） */
    storyGrade,
    nextStoryLevel,
    retryStoryLevel,
    get storyLevels() { return STORY_LEVELS; },
    get barrels() { return W ? W.barrels : []; },
    get grenades() { return G ? G.grenades : []; },
    /** 数字键直达手持物：'main' | 'side' | 'medkit' | 'plate' */
    select(kind) { return selectHeld(kind); },
    /** 造一把枪扔到指定位置（不给玩家，用来测拾取规则） */
    dropGun(id, x, y) {
      const pk = makePickup(id, x === undefined ? G.player.x : x, y === undefined ? G.player.y : y);
      W.pickups.push(pk);
      return pk;
    },
    /** 设置鼠标相对画面中心的偏移（准心位置由它决定） */
    aim(dx, dy) {
      mouse.x = VIEW_W / 2 + (dx || 0);
      mouse.y = VIEW_H / 2 + (dy || 0);
      if (G && G.state === 'play') updateCamera(0);
    },
    /** 求一条世界坐标路径，测试用 */
    path(fx, fy, tx, ty) { return W ? findPath(W, fx, fy, tx, ty) : null; },
    /** 发一个声音事件，把附近的敌人引过去，测试用 */
    noise(x, y, r) { emitNoise(x, y, r); },
    /** 直接对玩家造成伤害（测试用），返回是否死亡 */
    hurt(dmg, dirAngle) { return damagePlayer(dmg, dirAngle || 0); },
    get bloodCount() { return W ? W.bloodCount : 0; },
    get aimPoint() { return G && G.state === 'play' ? screenToWorld(mouse.x, mouse.y) : null; }
  };

  boot();
})();
