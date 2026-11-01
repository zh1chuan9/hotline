/* ============================================================
   HOTLINE 2.5D — H5 版
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

  // ---------------------------------------------------------------- 血量与护甲
  // 单血量 + 三格护甲（参考《使命召唤》要塞护甲板）：
  //   血量上限 100；护甲三格，每格 50 点，共 150 点护甲。
  //   受击时护甲先扣，护甲扣完才掉血。护甲板可以一格一格地补充。
  const HP_MAX = 100;
  const ARMOR_SLOTS = 3;      // 护甲格数
  const ARMOR_PER_SLOT = 50;  // 每格护甲值

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
      blood: { pools: 7, spurts: 6, streaks: 5, scale: 1.15, spray: 34, speckles: 46 }
    },
    bat: {
      name: '棒球棍', melee: true, fireRate: 0.42, mag: Infinity,
      reach: 34, arc: 130, shake: 3.0, sound: 'swing', icon: 'w_bat', dmg: 52, price: 100,
      drawTime: 0.26,
      blood: { pools: 3, spurts: 3, streaks: 2, scale: 0.95, spray: 18, speckles: 24 }
    },
    knife: {
      name: '匕首', melee: true, fireRate: 0.26, mag: Infinity,
      reach: 30, arc: 100, shake: 2.0, sound: 'swing', icon: 'w_knife', dmg: 40, price: 50,
      drawTime: 0.16,
      blood: { pools: 2, spurts: 2, streaks: 2, scale: 0.8, spray: 13, speckles: 16 }
    }
  };
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
      '#....o........o..X.....o.....#',
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

  const ENEMY_KIND = {
    melee: {
      tex: 'enemy_melee', corpse: 'corpse_enemy_melee',
      speed: 76, view: 190, attackRange: 26,
      keep: 0, interval: 0.62, aimErr: 0, weapon: 'knife', reaction: 0.3,
      hp: 24, dmg: 10, score: 50
    },
    gun: {
      tex: 'enemy_gun', corpse: 'corpse_enemy_gun',
      speed: 62, view: 215, attackRange: 170,
      keep: 140, interval: 0.62, aimErr: 7, weapon: 'pistol', reaction: 0.34,
      hp: 20, dmg: 9, score: 75
    },
    shotgun: {
      tex: 'enemy_shotgun', corpse: 'corpse_enemy_shotgun',
      speed: 68, view: 195, attackRange: 100,
      keep: 84, interval: 1.1, aimErr: 9, weapon: 'shotgun', reaction: 0.32,
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
    const pad = 24;
    const availW = window.innerWidth - pad, availH = window.innerHeight - pad;
    let scale = Math.min(availW / VIEW_W, availH / VIEW_H);
    if (scale > 3) scale = Math.floor(scale * 2) / 2;
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
  const touch = {
    // 左摇杆：移动方向（单位向量），active 表示正在拖动
    moveActive: false, moveId: -1, moveOrigin: null, moveX: 0, moveY: 0,
    // 右摇杆：瞄准方向（单位向量）。推到边缘（超过 fireDead）才触发开火
    aimActive: false, aimId: -1, aimOrigin: null, aimX: 0, aimY: 0,
    firing: false,
    // 独立开火按钮（右摇杆区域左上角）：按住连发
    fireBtnActive: false, fireId: -1
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
    // 动作按钮（右侧竖排）：换弹 / 换枪 / 手雷 / 交互
    buttons: [
      { key: 'r', label: '换弹', x: VIEW_W - 30, y: VIEW_H - 200 },
      { key: 'q', label: '换枪', x: VIEW_W - 30, y: VIEW_H - 156 },
      { key: 'g', label: '手雷', x: VIEW_W - 30, y: VIEW_H - 112 },
      { key: 'e', label: '交互', x: VIEW_W - 30, y: VIEW_H - 68 }
    ],
    btnR: 22
  };
  // 暂停按钮（左上角，菜单态也显示）
  const TOUCH_PAUSE = { x: 30, y: 30, r: 20 };

  /** 判断一个触控点落在哪个控件：'move' | 'aim' | 'fire' | 'btn:r' | 'btn:q' ... | 'pause' | null */
  function classifyTouch(x, y) {
    const L = TOUCH_LAYOUT;
    const near = (c, r) => Math.hypot(x - c.x, y - c.y) <= r;
    // 左摇杆（仅在未激活时，或按距离就近归因）
    if (near(L.moveBase, L.moveBase.r * 1.4)) return 'move';
    // 独立开火键优先于右摇杆判定（它在右摇杆边缘外）
    if (near(L.fireBtn, L.fireBtn.r * 1.2)) return 'fire';
    if (near(L.aimBase, L.aimBase.r * 1.4)) return 'aim';
    // 动作按钮
    for (const b of L.buttons) {
      if (near(b, L.btnR * 1.2)) return 'btn:' + b.key;
    }
    if (near(TOUCH_PAUSE, TOUCH_PAUSE.r * 1.4)) return 'pause';
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
        // 摇杆回中 → 准心回屏幕中心（保持原朝向，靠 aimDir 的 len<1 判定）
        feedTouchMouse(VIEW_W / 2, VIEW_H / 2);
      }
    }
    // 右摇杆推到边缘 → 自动开火
    const fireByAim = touch.aimActive && (Math.hypot(touch.aimX, touch.aimY) > TOUCH_LAYOUT.aimBase.r * 0.82);
    mouse.down = (fireByAim || touch.fireBtnActive || touch.firing);
    mouse.right = false;   // 触屏不区分右键；瞄准通过"靠近目标"自动完成（见 applyTouchAim）
  }

  /** 触屏下的辅助瞄准：右摇杆朝敌人方向时，把准心轻微吸附到最近的敌人身上。 */
  function applyTouchAim() {
    if (inputMode !== 'touch' || !G || !G.player || !W) return;
    if (!touch.aimActive) return;
    // 找准心方向上的最近敌人
    let best = null, bestD = 1e9;
    const ox = G.player.x, oy = G.player.y;
    for (const e of W.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - ox, e.y - oy);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (!best) return;
    // 只在一定距离内吸附，避免跨屏乱跳
    if (bestD < 220) {
      const ax = best.x - ox, ay = best.y - oy;
      const al = Math.hypot(ax, ay) || 1;
      const R = Math.min(VIEW_W, VIEW_H) * 0.42;
      feedTouchMouse(VIEW_W / 2 + (ax / al) * R, VIEW_H / 2 + (ay / al) * R);
    }
  }

  /** 切换操作方式，并持久化到 localStorage。 */
  function setInputMode(mode) {
    inputMode = mode;
    try { localStorage.setItem('hotline.inputMode', mode); } catch (err) { /* 隐私模式下忽略 */ }
    // 切换到电脑键鼠时，清掉触控残留状态，避免卡住
    if (mode === 'pc') {
      touch.moveActive = false; touch.moveId = -1; touch.moveX = 0; touch.moveY = 0;
      touch.aimActive = false; touch.aimId = -1; touch.aimX = 0; touch.aimY = 0;
      touch.firing = false; touch.fireBtnActive = false; touch.fireId = -1;
      keys['a'] = keys['d'] = keys['w'] = keys['s'] = false;
    }
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
  canvas.addEventListener('mousemove', updateMouse);
  canvas.addEventListener('mousedown', (e) => {
    updateMouse(e);
    if (e.button === 0) mouse.down = true;
    if (e.button === 2) { mouse.right = true; e.preventDefault(); }   // 右键 = 抬枪瞄准
    onPointerDown(e);
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouse.down = false;
    if (e.button === 2) mouse.right = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- 触控输入：多点追踪，左/右摇杆和按钮各绑定一个 touch identifier ----
  function touchPos(t) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (t.clientX - r.left) / r.width * VIEW_W,
      y: (t.clientY - r.top) / r.height * VIEW_H
    };
  }
  // 把触控坐标（逻辑坐标）换算成鼠标屏幕坐标，直接喂给 mouse，复用准心/朝向逻辑
  function feedTouchMouse(x, y) {
    mouse.x = x; mouse.y = y;
  }

  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    Sfx.init();
    if (inputMode !== 'touch') return;
    for (const t of e.changedTouches) {
      const pt = touchPos(t);
      // 菜单界面（标题/设置/暂停/结算）：把触点当鼠标点击，复用按钮命中逻辑
      if (G && (G.state === 'title' || G.state === 'settings' || G.state === 'done' || G.paused)) {
        feedTouchMouse(pt.x, pt.y);
        onPointerDown({ button: 0 });
        continue;
      }
      const ctl = classifyTouch(pt.x, pt.y);   // 见下：命中摇杆/按钮区域
      if (ctl === 'move') {
        if (touch.moveActive) continue;
        touch.moveActive = true; touch.moveId = t.identifier;
        touch.moveOrigin = pt; touch.moveX = 0; touch.moveY = 0;
      } else if (ctl === 'aim') {
        if (touch.aimActive) continue;
        touch.aimActive = true; touch.aimId = t.identifier;
        touch.aimOrigin = pt; touch.aimX = 0; touch.aimY = 0;
      } else if (ctl === 'fire') {
        if (touch.fireBtnActive) continue;
        touch.fireBtnActive = true; touch.fireId = t.identifier;
        touch.firing = true;
      } else if (ctl === 'pause') {
        // 暂停按钮：切换暂停（和 ESC 同效果）
        onVirtualKey('escape');
      } else if (ctl && ctl.startsWith('btn:')) {
        const key = ctl.slice(4);
        touchPressed[key] = true;
        onVirtualKey(key);
      }
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (inputMode !== 'touch') return;
    for (const t of e.changedTouches) {
      const pt = touchPos(t);
      if (t.identifier === touch.moveId) {
        touch.moveOrigin = pt;
      } else if (t.identifier === touch.aimId) {
        touch.aimOrigin = pt;
      }
    }
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (inputMode !== 'touch') return;
    for (const t of e.changedTouches) {
      if (t.identifier === touch.moveId) {
        touch.moveActive = false; touch.moveId = -1; touch.moveX = 0; touch.moveY = 0;
      } else if (t.identifier === touch.aimId) {
        touch.aimActive = false; touch.aimId = -1; touch.aimX = 0; touch.aimY = 0;
        touch.firing = false;
      } else if (t.identifier === touch.fireId) {
        touch.fireBtnActive = false; touch.fireId = -1; touch.firing = false;
      }
    }
    // 释放所有虚拟按钮按下态（简单起见，结束时全清）
    touchPressed = Object.create(null);
  }, { passive: false });

  canvas.addEventListener('touchcancel', (e) => {
    touch.moveActive = false; touch.moveId = -1; touch.moveX = 0; touch.moveY = 0;
    touch.aimActive = false; touch.aimId = -1; touch.aimX = 0; touch.aimY = 0;
    touch.firing = false; touch.fireBtnActive = false; touch.fireId = -1;
    touchPressed = Object.create(null);
  });

  // ---------------------------------------------------------------- 音效（程序合成）
  const Sfx = {
    ac: null,
    noiseBuf: null,
    muted: false,
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
      } catch (err) {
        this.ac = null;
      }
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
      if (this.muted) return;
      this.init();
      if (!this.ac) return;
      if (this.ac.state === 'suspended') this.ac.resume();
      switch (name) {
        case 'shoot': this.noise(0.10, 2200, 1.2, 0.32, 0.2); this.tone(320, 90, 0.07, 0.10, 'square'); break;
        case 'smg': this.noise(0.07, 1800, 1.0, 0.26, 0.15); this.tone(280, 80, 0.05, 0.08, 'square'); break;
        case 'shotgun': this.noise(0.30, 1200, 0.8, 0.45, 0.3); this.tone(160, 45, 0.18, 0.16, 'sawtooth'); break;
        case 'swing': this.noise(0.14, 900, 2.5, 0.14, 0.15, 'bandpass'); break;
        case 'hit': this.noise(0.12, 420, 1.0, 0.28, 0.2); this.tone(120, 50, 0.10, 0.14, 'square'); break;
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

  function buildLevel(index) {
    const data = ARENA;
    const rows = data.rows;
    const h = rows.length, w = rows[0].length;

    const world = {
      index: index || 0, title: data.title, rows, w, h,
      pxW: w * TILE, pxH: h * TILE,
      walls: [],        // 合并后的墙矩形
      covers: [],       // 掩体（木箱），碰撞上算墙，渲染单独一层
      barrels: [],      // 油桶：同样算墙，但能被子弹打爆
      doors: [],
      pickups: [],
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
      stun: 0,
      weapon: K.weapon,
      ammo: WEAPONS[K.weapon].mag,
      bob: Math.random() * 6.28,
      deadT: 0,
      deathDir: 0,
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

  // ---------------------------------------------------------------- 碰撞
  function solidRects(world, includeDoors) {
    if (!includeDoors) return world.walls;
    // 门开关会改变可通行性，缓存一下，避免每帧给每个角色重新分配
    if (!world._solidDirty) return world._solid;
    const out = world.walls.slice();
    for (const d of world.doors) {
      if (!d.open) out.push({ x: d.x - TILE / 2, y: d.y - TILE / 2, w: TILE, h: TILE });
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

  // ---------------------------------------------------------------- 特效
  const FX = {
    tracers: [],
    parts: [],
    texts: [],
    clips: [],       // 换弹时甩出去的旧弹匣（要旋转，粒子那套圆点表达不了）
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
    addBlood(x, y, dir, n, scale) {
      const a = Math.atan2(dir.y, dir.x);
      const count = n || 10;
      const sc = scale || 1;
      for (let i = 0; i < count; i++) {
        const aa = a + (Math.random() - 0.5) * 2.0 * sc;
        const s = (40 + Math.random() * 130) * (0.6 + sc * 0.6);
        this.parts.push({
          x, y, vx: Math.cos(aa) * s, vy: Math.sin(aa) * s,
          life: 0.45 + Math.random() * 0.5, max: 0.95,
          color: Math.random() < 0.35 ? '#8c0f1c' : (Math.random() < 0.2 ? '#e0243a' : '#c2172a'),
          size: (1 + Math.random() * 2) * (0.8 + sc * 0.4)
        });
      }
    },
    addText(x, y, txt, color) {
      this.texts.push({ x, y, txt, color: color || '#fff', life: 0.9, max: 0.9 });
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
      this.shake = 0; this.shakeT = 0; this.hitstop = 0; this.flash = 0;
    }
  };

  // ---------------------------------------------------------------- 声音事件
  function emitNoise(x, y, radius) {
    if (!W) return;
    for (const e of W.enemies) {
      if (!e.alive) continue;
      if (dist2(x, y, e.x, e.y) <= radius * radius) {
        if (e.state !== 'chase') {
          e.state = 'investigate';
          e.target.x = x; e.target.y = y;
          e.investigateTimer = 2.6;
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
      armorSlots: 0,         // 已装备的护甲板格数（0~3，每格 50）
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
      // 散弹枪逐发装填：shellReload > 0 表示正在塞当前这一发
      shellReload: 0,
      shellTotal: 0
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

  // 三格护甲：armorSlots 表示插了几块板，armor 是当前剩余护甲值。
  // 补甲时把 armorSlots 打满，armor = armorSlots * 50。
  function refillArmor(p) {
    p.armorSlots = ARMOR_SLOTS;
    p.armor = ARMOR_SLOTS * ARMOR_PER_SLOT;
  }

  const ARMOR_MAX = ARMOR_SLOTS * ARMOR_PER_SLOT;

  /**
   * 护甲满了没有 —— 只看**护甲值**，别看格数。
   * armorSlots 只在被打穿（armor<=0）时才清零，所以"插了 3 格板、被打掉一半"
   * 这种状态格数仍是 3；按格数判满就会出现"甲只剩 60，却说护甲已满，装不上板"。
   */
  function armorFull(p) { return p.armor >= ARMOR_MAX - 0.001; }

  /** 格数跟着护甲值走（每格 50，向上取整）：半格也算一格，方便 HUD 和拾取逻辑对齐。 */
  function syncArmorSlots(p) {
    p.armorSlots = Math.ceil(clamp(p.armor, 0, ARMOR_MAX) / ARMOR_PER_SLOT);
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
            life: 0.25, max: 0.25, color: '#ffb347', size: 1.3
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

  function castShot(origin, angle, range, shooter) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let best = range, hitActor = null, hitBarrel = null;
    const rects = solidRects(W, true);
    for (let i = 0; i < rects.length; i++) {
      const t = rayRect(origin.x, origin.y, dx, dy, rects[i]);
      if (t !== null && t < best) {
        best = t; hitActor = null;
        // 挡路的如果是油桶，记下来：墙是打不动的，桶是会炸的
        hitBarrel = rects[i].barrel || null;
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
        if (shooter && shooter.elite) dmg = Math.round(dmg * 1.5);   // 精英枪更疼
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
    } else if (hitBarrel) {
      // 打在桶上：先扣耐久，打烂了走引信（不立刻炸，让玩家看见"我打中了"）
      const bdmg = shooter && shooter.weapon ? (WEAPONS[shooter.weapon].dmg || 30) : 25;
      hitBarrel.hp -= bdmg;
      hitBarrel.shake = 1;
      FX.addParticles(end.x, end.y, 5, '#d8c070', 130, 0.22);
      if (hitBarrel.hp <= 0) igniteBarrel(hitBarrel);
    } else {
      FX.addParticles(end.x, end.y, 4, '#ffe6a8', 90, 0.18);
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
        if (actor.elite) dmg = Math.round(dmg * 1.5);
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
    // 挥击弧线
    FX.parts.push({
      x: origin.x + Math.cos(facing) * reach * 0.7,
      y: origin.y + Math.sin(facing) * reach * 0.7,
      vx: 0, vy: 0, life: 0.12, max: 0.12, color: 'rgba(255,255,255,0.35)', size: 3
    });
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
    let remaining = dmg;
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

  /** 对敌人造成伤害，返回是否死亡。 */
  function damageEnemy(e, dmg, dirAngle, byPlayer, headshot) {
    if (!e.alive) return true;
    e.hp -= dmg;
    FX.addBlood(e.x, e.y, { x: Math.cos(dirAngle), y: Math.sin(dirAngle) }, 4, 0.7);
    if (headshot) {
      // 爆头：额外一团血雾 + 字
      FX.addBlood(e.x, e.y, { x: Math.cos(dirAngle), y: Math.sin(dirAngle) }, 12, 1.15);
      FX.addText(e.x, e.y - 18, '爆头', '#ff9a5a');
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
    Sfx.play('die');
    e.deadT = 0;
    // 掉枪：近战武器不掉（匕首/球棍满地都是没意义，还会盖住血包和子弹）
    if (e.weapon && !WEAPONS[e.weapon].melee) {
      const pk = makePickup(e.weapon, e.x, e.y);
      pk.ammo = e.ammo;
      // 掉落的枪自带一份备弹（约 1/3 满额），否则捡起来只有枪里剩的那几发
      pk.reserve = Math.max(6, Math.round(WEAPONS[e.weapon].reserveMax * 0.35));
      W.pickups.push(pk);
    }
    e.weapon = null;
    if (byPlayer) {
      // 积分：基础分 + 波次加成，连击翻倍，爆头额外加成
      const K = ENEMY_KIND[e.kind];
      const waveBonus = 1 + (G.wave || 0) * 0.15;
      const base = Math.round(K.score * waveBonus * (e.elite ? 3 : 1));
      G.combo++;
      G.comboTimer = 2.5;
      if (G.combo > G.bestCombo) G.bestCombo = G.combo;
      let gained = Math.round((base + Math.round(base * (G.combo - 1) * 0.25)) * (G.doubleScore > 0 ? 2 : 1));
      if (headshot) gained = Math.round(gained * HEADSHOT_SCORE);
      G.score += gained;
      G.cash += gained;   // 积分即货币
      FX.addText(e.x, e.y - 12,
        (headshot ? '爆头 ' : '') + '+' + gained + (G.combo > 1 ? ' x' + G.combo : ''),
        headshot ? '#ff9a5a' : (G.combo > 1 ? '#ffd76e' : '#ffffff'));
      // 概率掉落：血包 / 子弹
      rollDrop(e);
      // 精英：直接给稀有资源，掉在地上反而容易漏捡
      if (e.elite) {
        killer.grenades = Math.min(GRENADE_MAX, killer.grenades + 1);
        killer.armorPlates = Math.min(ARMOR_SLOTS, killer.armorPlates + 1);
        FX.addText(e.x, e.y - 26, '精英 · +1 手雷 +1 护甲板', '#ffd76e');
        G.toast = '精英击杀';
        G.toastTimer = 2;
      }
    }
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

  /** 一次死亡的全部血迹：空中血雾 + 血泊 + 拖拽血痕 + 地面飞沫。 */
  function spillBlood(x, y, dir, B, isPlayer) {
    const ang = Math.atan2(dir.y, dir.x);
    const sc = B.scale * (isPlayer ? 1.25 : 1);
    // 空中血雾：朝子弹方向喷一个扇面
    FX.addBlood(x, y, dir, B.spray, sc);
    FX.addBlood(x, y, { x: -dir.x * 0.6, y: -dir.y * 0.6 }, Math.round(B.spray * 0.35), sc * 0.7);
    // 脚下一大滩
    bloodPool(x + (Math.random() - 0.5) * 5, y + (Math.random() - 0.5) * 5, 0.92 * sc);
    // 溅开的血泊，越强的武器飞得越远；单滩小一点，靠数量堆出血腥
    for (let i = 0; i < B.pools; i++) {
      const a = ang + (Math.random() - 0.5) * 2.6;
      const r = (6 + Math.random() * 34) * sc;
      bloodPool(x + Math.cos(a) * r, y + Math.sin(a) * r, (0.16 + Math.random() * 0.26) * sc);
    }
    // 拖拽血痕，顺着受力方向甩出去
    for (let i = 0; i < B.streaks; i++) {
      const a = ang + (Math.random() - 0.5) * 1.3;
      const r = (8 + Math.random() * 22) * sc;
      bloodStreak(x + Math.cos(a) * r, y + Math.sin(a) * r, a, 0.85 + Math.random() * 0.7 * sc);
    }
    bloodSpeckle(x, y, ang, Math.round(B.speckles * sc));
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
      // 移速 = 基础 × 疾跑倍率 × 瞄准减速（端枪时按 aimT 平滑压下来）
      const spd = PLAYER_SPEED * speedMul(p) * (1 - p.aimT * (1 - AIM_MOVE_MUL));
      p.vx = ix * spd;
      p.vy = iy * spd;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    resolveCircle(W, p, ACTOR_R, solidRects(W, true));

    // 脚步
    if (il > 0 && p.stun <= 0) {
      p.stepTimer -= dt;
      if (p.stepTimer <= 0) { p.stepTimer = 0.31; Sfx.play('step'); }
    }

    // 冷却
    if (p.cooldown > 0) p.cooldown -= dt;
    if (p.throwCd > 0) p.throwCd -= dt;
    // 换枪动画：倒计时，走完才恢复持枪状态
    if (p.swapT > 0) {
      p.swapT -= dt;
      if (p.swapT <= 0) { p.swapT = 0; p.swapTotal = 0; }
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
          // 弹匣拍到位那一拍：闷响 + 机匣位置崩出两点火星
          Sfx.play('magin');
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
            p.armor = Math.min(ARMOR_MAX, p.armor + ARMOR_PER_SLOT);
            syncArmorSlots(p);
            FX.addText(p.x, p.y - 14, '+护甲', '#5aa7e0');
            Sfx.play('pickup');
          }
        }
      } else if (p.plateCharge > 0) {
        // 松开：读条缓慢回退，但保持持板状态（可重新长按接着装）
        p.plateCharge = Math.max(0, p.plateCharge - dt * 1.2);
      }
    } else if (p.grenadeHeld) {
      // 手持手雷：左键单击（fireTap）丢出，朝准心方向
      if (fireTap) throwGrenade();
    } else if (p.weapon) {
      // def.auto 换成 gunStat：进化后的霰弹枪会从"点一下打一发"变成按住连发
      if ((gunStat(p.weapon, 'auto') && fireHeld) || fireTap) {
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
   */
  function reloadFx(p) {
    const ang = Math.atan2(p.facing.y, p.facing.x);
    if (p.weapon === 'shotgun') {
      Sfx.play('shellin');   // 塞弹的"咔"一声，不退壳（壳在开火时已退）
    } else {
      FX.addClip(p.x + p.facing.x * 9 + Math.cos(ang + Math.PI / 2) * 4,
                 p.y + p.facing.y * 9 + Math.sin(ang + Math.PI / 2) * 4, ang);
      Sfx.play('magout');
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
      if (wasUtility) Sfx.play('pickup');
      return true;
    }

    if (kind === 'side') {
      if (p.curSlot === 'side') {                    // 已经在副武器上，只需放下消耗品
        if (p.healing || p.plating || p.grenadeHeld) {
          p.healing = false; p.healCharge = 0;
          p.plating = false; p.plateCharge = 0;
          p.grenadeHeld = false;
          Sfx.play('pickup');
        }
        return true;
      }
      if (!p.side) {
        G.toast = '没有副武器';
        G.toastTimer = 1.2;
        return false;
      }
      p.healing = false; p.healCharge = 0;
      p.plating = false; p.plateCharge = 0;
      swapWeapon();
      return true;
    }

    if (kind === 'medkit') {
      if (p.medkits <= 0) {
        G.toast = '没有血包';
        G.toastTimer = 1.2;
        return false;
      }
      p.plating = false; p.plateCharge = 0;
      p.grenadeHeld = false;
      p.healing = true;
      Sfx.play('pickup');
      return true;
    }

    if (kind === 'plate') {
      if (p.armorPlates <= 0) {
        G.toast = '没有护甲板';
        G.toastTimer = 1.2;
        return false;
      }
      p.healing = false; p.healCharge = 0;
      p.grenadeHeld = false;
      p.plating = true;
      Sfx.play('pickup');
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
    FX.addText(p.x, p.y - 12, '+' + got + ' 备弹', '#ffd76e');
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

    // 同型号：优先并成备弹；备弹已经满了就让它进空槽位（两把同款也能背一把）
    if (p.weapon === best.def && absorbAmmo(p, best, false)) return;
    if (p.side && p.side.weapon === best.def && absorbAmmo(p, best, true)) return;

    // 两个槽都占着：自动走过去不抢，必须按 E 才换背上的
    if (p.weapon && p.side && !explicit) return;

    // 枪里剩多少 + 它自带的那份备弹（敌人掉的枪已在掉落时带上备弹）
    const mag = gunStat(best.def, 'mag');
    const ammo = best.ammo !== undefined ? best.ammo : mag;
    const spare = best.reserve !== undefined ? best.reserve : 0;
    const reserve = Math.min(def.reserveMax, spare);
    if (!p.weapon) {
      p.weapon = best.def;
      p.ammo = ammo;
      p.reserve = reserve;
      p.cooldown = 0;
      p.reload = 0;
      p.reloadTotal = 0;
      FX.addText(p.x, p.y - 12, def.name, '#ffd76e');
    } else if (!p.side) {
      p.side = { weapon: best.def, ammo: ammo, reserve: reserve };
      FX.addText(p.x, p.y - 12, '副武器 ' + def.name, '#ffd76e');
    } else {
      // 换掉背上的：旧枪原地掉回地上（子弹一起带走，不凭空消失）
      const oldPk = makePickup(p.side.weapon, p.x, p.y);
      oldPk.ammo = p.side.ammo;
      oldPk.reserve = p.side.reserve;
      W.pickups.push(oldPk);
      p.side = { weapon: best.def, ammo: ammo, reserve: reserve };
      FX.addText(p.x, p.y - 12, '换上副武器 ' + def.name, '#ffd76e');
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
    const def = WEAPONS[p.weapon];
    if (def.melee) {
      p.cooldown = def.fireRate;
      Sfx.play(def.sound);
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
    FX.addText(p.x, p.y - 12, '+弹', '#ffd76e');
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

    const dToP = Math.hypot(p.x - e.x, p.y - e.y);
    const angToP = Math.atan2(p.y - e.y, p.x - e.x);
    let sees = false;
    if (p.alive && dToP <= K.view) {
      const facingAngle = e.kind === 'melee' ? e.facing : e.facing;
      if (Math.abs(angDiff(angToP, facingAngle)) <= 60 * Math.PI / 180) {
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
          e.investigateTimer = 3.0;
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
          pushDoor(e);
        }
        // 攻击
        if (sees && dToP <= K.attackRange && e.attackCd <= 0) {
          enemyAttack(e, K, angToP);
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

  function enemyAttack(e, K, angToP) {
    const def = WEAPONS[e.weapon];
    if (def.melee) {
      e.attackCd = K.interval;
      Sfx.play(def.sound);
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
    const err = (Math.random() - 0.5) * 2 * K.aimErr * Math.PI / 180;
    const base = angToP + err;
    for (let i = 0; i < def.pellets; i++) {
      const a = base + (Math.random() - 0.5) * 2 * def.spread * Math.PI / 180;
      castShot({ x: e.x + Math.cos(base) * 11, y: e.y + Math.sin(base) * 11 }, a, def.range, e);
    }
  }

  function pickPatrol(e) {
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 12 + Math.random() * 46;
      const x = e.hx + Math.cos(a) * r, y = e.hy + Math.sin(a) * r;
      if (!pointSolid(W, x, y, 6)) { e.target.x = x; e.target.y = y; return; }
    }
    e.target.x = e.hx; e.target.y = e.hy;
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
      if (p.armorPlates >= ARMOR_SLOTS) { Sfx.play('empty'); return; }
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
    G.upgSel.line = clamp(G.upgSel.line, 0, UPGRADE_LINES.length);
    Sfx.play('clear');
    pressed = Object.create(null);
    return true;
  }

  function closeUpgrade() {
    G.state = 'play';
    pressed = Object.create(null);
  }

  /** 光标所指的一格：line 0..3 是四条升级线，4 是进化。 */
  function upSelEntry() {
    const sel = G.upgSel || { gun: 0, line: 0 };
    const gunId = UP_GUNS[clamp(sel.gun, 0, UP_GUNS.length - 1)];
    const line = clamp(sel.line, 0, UPGRADE_LINES.length);
    return {
      gunId, line,
      def: line < UPGRADE_LINES.length ? UPGRADE_LINES[line] : null,
      u: gunUp(gunId)
    };
  }

  /** 买一格：升级，或者四条线全满时的进化。返回是否真的买到。 */
  function buyUpgrade() {
    const { gunId, line, def, u } = upSelEntry();
    if (!u) return false;
    const p = G.player;
    const owned = !!(p && (p.weapon === gunId || (p.side && p.side.weapon === gunId)));

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
        FX.addText(p.x, p.y - 18, '进化 · ' + (UP_EVO_NAME[gunId] || ''), '#ffd76e');
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
      FX.addText(p.x, p.y - 18, '伤害 ' + gunStat(gunId, 'dmg'), '#ffd76e');
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
      FX.addText(p.x, p.y - 14, '双倍积分 ×' + G.doubleScore + ' 波', '#ffd76e');
    } else if (skillId === 'armor') {
      // 铁甲：立即补满护甲
      refillArmor(p);
      FX.addText(p.x, p.y - 14, '获得 铁甲 · 护甲补满', '#8fd8ff');
    } else {
      p.perks[skillId] = (p.perks[skillId] || 0) + 1;
      FX.addText(p.x, p.y - 14, '获得 ' + SLOT_NAMES[skillId], '#ffd76e');
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
    FX.addText(G.player.x, G.player.y - 20, '第 ' + G.wave + ' 波', '#ffd76e');

    // 每 5 波来一个精英：血厚、体型大、掉手雷和护甲板，
    // 让"第几波"这件事有记忆点，而不是只有数字在涨
    if (G.wave % 5 === 0) spawnElite(pts, hpScale, spdScale);
  }

  /** 精英：普通敌人的强化版，头顶有血条，击杀给稀有资源。 */
  function spawnElite(pts, hpScale, spdScale) {
    const kind = G.wave >= 10 ? 'shotgun' : 'gun';
    const K = ENEMY_KIND[kind];
    const pt = pts[Math.floor(Math.random() * pts.length)];
    const e = makeEnemy(kind, pt.x, pt.y);
    e.elite = true;
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
    G.toast = '第 ' + G.wave + ' 波 · 精英';
    G.toastTimer = 2.8;
    return e;
  }

  /** 精英头顶的血条（世界坐标，跟着相机走）。 */
  function drawEliteBars() {
    for (const e of W.enemies) {
      if (!e.alive || !e.elite) continue;
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
    // prep !== false 时先走 30 秒开局准备；测试/调试传 { prep: false } 直接开打
    const withPrep = !(opts && opts.prep === false);
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

  function onPointerDown(e) {
    Sfx.init();
    // 右键只负责瞄准，不拿来开局（免得抬手瞄一下就顺手把标题点掉了）
    if (e && e.button === 2) return;
    // 命中检测：判断点击落在哪个按钮上
    const hit = (b) => b && mouse.x >= b.x && mouse.x <= b.x + b.w && mouse.y >= b.y && mouse.y <= b.y + b.h;
    if (G.state === 'title') {
      if (hit(TITLE_BTN.start)) startGame();
      else if (hit(TITLE_BTN.settings)) G.state = 'settings';
      return;
    }
    if (G.state === 'settings') {
      if (hit(SETTINGS_BTN.sound)) { Sfx.muted = !Sfx.muted; Sfx.play('hit'); }
      else if (hit(SETTINGS_BTN.control)) { setInputMode(inputMode === 'touch' ? 'pc' : 'touch'); Sfx.play('hit'); }
      else if (hit(SETTINGS_BTN.back)) G.state = 'title';
      return;
    }
    // 暂停菜单：点击「继续游戏」或「返回主菜单」
    if (G.paused) {
      const cy = VIEW_H / 2 - 4;   // 继续游戏按钮中心
      const ry = VIEW_H / 2 + 30;  // 返回主菜单按钮中心
      const bx = VIEW_W / 2 - 80, bw = 160, bh = 28;
      const inBox = (y) => mouse.x >= bx && mouse.x <= bx + bw && mouse.y >= y - 14 && mouse.y <= y - 14 + bh;
      if (inBox(cy)) G.paused = false;
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
      for (const e of W.enemies) updateEnemy(e, dt);
      updatePickups(dt);
      // 波次清场判定：所有敌人都死了 → 进入 30 秒整备时间，可跳过
      if (!W.cleared) {
        let alive = 0;
        for (const e of W.enemies) if (e.alive) alive++;
        if (alive === 0) {
          W.cleared = true;
          G.intermission = INTERMISSION_TIME;
          G.centerText = '第 ' + G.wave + ' 波清空';
          G.centerColor = '#a8f0b8';
          G.centerTimer = 1.6;
          // 第 5 波清完 → 武器升级站解锁（只解锁一次）
          if (G.wave >= UP_UNLOCK_WAVE && !G.upgUnlocked) {
            G.upgUnlocked = true;
            G.toast = '武器升级站已开放（按 E）';
            G.toastTimer = 2.6;
            Sfx.play('clear');
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
      if (!G.player.alive) {
        G.state = 'dead';
        G.deadTimer = 0;
        G.timeScale = 0.35;
        G.slowTimer = 0.8;
        G.centerText = '你死了\n撑到第 ' + G.wave + ' 波';
        G.centerColor = '#ff7a7a';
        G.centerTimer = 0;
        Sfx.play('die');
      }
    } else if (G.state === 'dead') {
      G.deadTimer += dt;
      // 没有手动重开了：躺 3 秒自动开下一局。
      // 重开不再走 30 秒准备期 —— 那是给"第一次开局、要熟悉地图"用的，
      // 而且重开时身上没钱，准备期也没东西可买。
      if (G.deadTimer >= 3.2) startGame({ prep: false });
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
      ctx.fillStyle = urgent ? '#ff3a2a' : '#ffb347';
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
        ctx.fillText('按 E 补给', 0, -20);
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
      ctx.fillStyle = unlocked ? '#ffb347' : '#5a5064';
      ctx.beginPath();
      ctx.arc(0, 0, 14 + Math.sin(t * 2) * 1.5, 0, 6.283);
      ctx.fill();
      ctx.globalAlpha = 1;
      // 工作台
      ctx.fillStyle = unlocked ? '#6a4a1a' : '#3a3440';
      ctx.fillRect(-8, -7, 16, 14);
      ctx.fillStyle = unlocked ? '#c98a30' : '#5a5064';
      ctx.fillRect(-8, -7, 16, 3);
      // 台面上的枪托 + 枪管（一个向上的扳手/枪形图标）
      ctx.fillStyle = unlocked ? '#ffe1a0' : '#7a7088';
      ctx.fillRect(-1, -6, 3, 11);
      ctx.fillRect(-3, -6, 7, 2.5);
      if (nearStation() === s) {
        ctx.font = 'bold 9px "Microsoft YaHei", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = unlocked ? '#ffcf7a' : '#8d7f9c';
        ctx.fillText(unlocked ? '按 E 升级' : '第 ' + UP_UNLOCK_WAVE + ' 波后开放', 0, -20);
      }
      ctx.restore();
    }
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
  const PALETTE = {
    player:        { head: '#eae4d8', skin: '#e2b28e' },
    enemy_melee:   { head: '#b09aca', skin: '#cea684' },
    enemy_gun:     { head: '#acb2c0', skin: '#d6ac8a' },
    enemy_shotgun: { head: '#c6a06a', skin: '#e0b490' }
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
    // 匕首：横向握持、刀尖朝前，双手一前一后都压在刀柄上（右手靠护手、左手靠柄末）。
    // 手半径收小、前后错开，才能在 32px 小人上看出是"两只手握同一段柄"而不是"一只手"。
    knife:   { r: [9.4, 1.9], l: [5.9, 3.1], rs: 0.72, ls: 0.68 }
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
      ctx.fillStyle = '#ffb347';
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

  function drawActor(a, tex, isPlayer, corpse) {
    // 精英整体放大：头、手、枪、阴影一起缩放，不用单独做一套贴图
    const sc = a.scale || 1;
    ctx.save();
    ctx.translate(a.x, a.y);
    if (sc !== 1) ctx.scale(sc, sc);
    ctx.globalAlpha = a.alive ? 0.55 : 0.22;
    ctx.drawImage(IMG.shadow, -8, -8, 16, 16);
    ctx.globalAlpha = 1;

    // 精英：脚下一圈脉动的红环。光靠体型区分不够，混战时一眼要能认出来
    if (a.elite && a.alive) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
      ctx.globalAlpha = 0.3 + pulse * 0.25;
      ctx.strokeStyle = '#e0402c';
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
      ctx.drawImage(IMG[corpse] || IMG.corpse_player, -16, -16, 32, 32);
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
    }
    const angG = ang + tilt;                         // 枪和手用这个角度

    if (wimg) {
      ctx.save();
      ctx.rotate(angG);
      ctx.translate(11.6 + gunShift - kick - pull, 2 + pullY);
      ctx.scale(0.72, 0.72);
      ctx.drawImage(wimg, -wimg.width / 2, -wimg.height / 2);
      ctx.restore();
    }

    // 手：两条路径 —— 持枪走 GRIP 里的手势位，其余（近战/空手/捧东西）绕朝向对称摆。
    // 画在枪**之上**（手得压住枪身下沿才像握着），但位置都落在枪身下沿往下一点点：
    // 只盖住握把/护木，不糊住枪管 —— 手一旦扣在枪管上，整把枪就看不见了。
    const hands = [];
    const grip = (!holding && held) ? GRIP[held] : null;
    if (grip) {
      // 后坐时手跟着枪一起往回缩，不然会看到"枪缩了、手还伸着"；换弹内收同理
      const back = gunShift - kick * 0.5 - pull;
      hands.push({ x: grip.r[0] + back, y: grip.r[1] + pullY, r: HAND_R * (grip.rs || 0.92) });   // 右手扣扳机
      hands.push({ x: grip.l[0] + back, y: grip.l[1] + pullY, r: HAND_R * (grip.ls || 0.8) });    // 左手托护木/包握把
    } else {
      const arc = holding ? HAND_ARC * 0.62 : HAND_ARC;
      const reach = holding ? HAND_REACH * 1.12 : HAND_REACH;
      const hr = holding ? HAND_R * 0.9 : HAND_R;
      for (const s of [-1, 1]) {
        hands.push({ x: Math.cos(s * arc) * reach, y: Math.sin(s * arc) * reach, r: hr });
      }
    }
    for (const h of hands) {
      // 局部（枪身坐标系）→ 世界：跟着朝向旋转（换弹时再叠一点侧倾，手才不会留在枪外面）
      const hx = Math.cos(angG) * h.x - Math.sin(angG) * h.y;
      const hy = Math.sin(angG) * h.x + Math.cos(angG) * h.y;
      dot(hx, hy, h.r + 0.9, rim);
      dot(hx, hy, h.r, pal.skin);
      dot(hx - 0.6, hy - 0.7, h.r * 0.38, shade(pal.skin, 1.22));
    }

    // 捧着的消耗品：压在手上面，才像"手里正拿着它"，不被手挡住
    if (holding) {
      ctx.save();
      ctx.rotate(ang);
      ctx.translate(14.6, 0);
      ctx.scale(0.9, 0.9);
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
    for (const p of FX.parts) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
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
    ctx.fillStyle = touch.moveActive ? '#dfe6f0' : '#aeb6c2';
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

    // ---- 独立开火键 ----
    const fb = L.fireBtn;
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = touch.fireBtnActive ? '#ff6a5a' : '#e05040';
    ctx.beginPath(); ctx.arc(fb.x, fb.y, fb.r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px "Microsoft YaHei", monospace';
    ctx.fillText('开火', fb.x, fb.y + 1);

    // ---- 动作按钮 ----
    for (const b of L.buttons) {
      const act = !!touchPressed[b.key];
      ctx.globalAlpha = act ? 0.55 : 0.30;
      ctx.fillStyle = act ? '#8ab4e8' : '#3a4a5e';
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

    // 左上：波次（准备期为 0 波，显示"准备中"）
    ctx.font = 'bold 12px "Microsoft YaHei", monospace';
    ctx.textAlign = 'left';
    const waveLabel = G.wave > 0 ? '第 ' + G.wave + ' 波' : '准备中';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(waveLabel, 11, 11);
    ctx.fillStyle = '#cfc4d4';
    ctx.fillText(waveLabel, 10, 10);

    // 右上：现金（击杀所得，商店货币）
    ctx.textAlign = 'right';
    ctx.font = 'bold 13px "Microsoft YaHei", monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText('$' + G.cash, VIEW_W - 9, 11);
    ctx.fillStyle = '#ffd76e';
    ctx.fillText('$' + G.cash, VIEW_W - 10, 10);

    // 左下：血量 + 护甲（只给条和格，不标数值）
    drawBodyHUD();

    // 右下：主副武器 / 消耗品，每行挂上对应按键
    drawLoadoutHUD();

    // 正下方：只剩小半匣（≤1/2 黄、≤1/3 红）时提示按 R
    drawReloadHint();

    // 连击（挪到现金下面，把底部整排让给装备栏）
    if (G.combo > 1 && G.comboTimer > 0) {
      ctx.textAlign = 'right';
      ctx.font = 'bold 14px "Microsoft YaHei", monospace';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText('x' + G.combo, VIEW_W - 9, 29);
      ctx.fillStyle = '#ffd76e';
      ctx.fillText('x' + G.combo, VIEW_W - 10, 28);
    }

    // 中下：提示
    if (G.toastTimer > 0 && G.toast) {
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
        ctx.fillStyle = '#e8e0f0';
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
      ctx.fillStyle = '#ffd76e';
      ctx.fillText(txt, VIEW_W / 2, VIEW_H / 2 + 60);
      // 提示按空格跳过等待
      ctx.font = '10px "Microsoft YaHei", monospace';
      const hint = '按 SPACE 跳过';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(hint, VIEW_W / 2 + 1, VIEW_H / 2 + 78);
      ctx.fillStyle = '#cfd6e6';
      ctx.fillText(hint, VIEW_W / 2, VIEW_H / 2 + 77);
    }

    ctx.restore();
  }

  // 左下：血量条 + 三格护甲。只给条和格，不写任何数字
  function drawBodyHUD() {
    const p = G.player;
    if (!p) return;
    const x0 = 16, barW = 150;
    const hpY = VIEW_H - 40, hpH = 12;
    const gap = 5;
    const apY = VIEW_H - 22, apH = 8;
    const slotW = (barW - gap * (ARMOR_SLOTS - 1)) / ARMOR_SLOTS;

    // 读条（治疗 / 装护甲板）压在血条上方
    if (p.healing || p.plating) {
      const healing = p.healing;
      const prog = healing
        ? clamp(p.healCharge / HEAL_TIME, 0, 1)
        : clamp(p.plateCharge / PLATE_TIME, 0, 1);
      ctx.fillStyle = 'rgba(6,4,8,0.75)';
      ctx.fillRect(x0 - 1, hpY - 11, barW + 2, 7);
      ctx.fillStyle = healing ? '#5ad08a' : '#5aa7e0';
      ctx.fillRect(x0, hpY - 10, Math.round(barW * prog), 5);
    }

    // 血量条
    ctx.fillStyle = 'rgba(6,4,8,0.75)';
    ctx.fillRect(x0 - 2, hpY - 2, barW + 4, hpH + 4);
    const hpRatio = clamp(p.hp / HP_MAX, 0, 1);
    let hpCol = '#6fd68a';
    if (hpRatio < 0.35) hpCol = '#e05a4a';
    else if (hpRatio < 0.7) hpCol = '#e8c84a';
    if (hpRatio > 0) {
      ctx.fillStyle = hpCol;
      ctx.fillRect(x0, hpY, Math.round(barW * hpRatio), hpH);
    }
    // 低血时描边闪红，看不见数字也知道该找血包了
    if (hpRatio < 0.35) {
      const pulse = 0.45 + 0.35 * Math.sin(performance.now() * 0.009);
      ctx.strokeStyle = 'rgba(224,90,74,' + pulse.toFixed(3) + ')';
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 - 1.5, hpY - 1.5, barW + 3, hpH + 3);
    }

    // 护甲三格：每格 = 一块甲板，没装的格子留一圈暗蓝边框，空甲也看得出有三个位
    for (let i = 0; i < ARMOR_SLOTS; i++) {
      const sx = x0 + i * (slotW + gap);
      ctx.fillStyle = 'rgba(6,4,8,0.75)';
      ctx.fillRect(sx - 1, apY - 1, slotW + 2, apH + 2);
      const slotFill = clamp((p.armor - i * ARMOR_PER_SLOT) / ARMOR_PER_SLOT, 0, 1);
      if (slotFill > 0) {
        ctx.fillStyle = '#5aa7e0';
        ctx.fillRect(sx, apY, Math.round(slotW * slotFill), apH);
      } else {
        ctx.strokeStyle = 'rgba(90,167,224,0.30)';
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
    w_knife: [1, 6, 16, 8]
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
    const txt = '按 R 换弹';
    const y = VIEW_H - 26;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 13px "Microsoft YaHei", monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillText(txt, VIEW_W / 2 + 1, y + 1);
    ctx.fillStyle = crit
      ? 'rgba(255,92,76,' + (0.80 + 0.20 * Math.sin(performance.now() * 0.009)).toFixed(2) + ')'
      : '#f0c05a';
    ctx.fillText(txt, VIEW_W / 2, y);
    ctx.textAlign = 'left';
  }

  function drawLoadoutHUD() {
    const p = G.player;
    if (!p) return;
    const RX = VIEW_W - 12;       // 右对齐基准
    const BOT = VIEW_H - 10;      // 底边基准

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
      { kind: 'grenade', x: RX - colStep - 14, n: p.grenades, key: 'G', col: '#ffb347', busy: false },
      { kind: 'plate', x: RX - 14, n: p.armorPlates, key: '4', col: '#5aa7e0', busy: !!p.plating }
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
    ctx.fillStyle = '#ffd76e';
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
      ctx.fillStyle = sel ? '#fff3d0' : (afford && !alreadyHave ? '#cfc4d4' : '#6f6678');
      ctx.font = 'bold 13px "Microsoft YaHei", monospace';
      ctx.fillText(item.label + (alreadyHave ? '（已持有）' : ''), x, y);
      ctx.font = '11px "Microsoft YaHei", monospace';
      ctx.fillStyle = '#9c90a8';
      ctx.fillText(item.desc, x, y + 16);
      ctx.textAlign = 'right';
      ctx.fillStyle = afford ? '#ffd76e' : '#8a5a4a';
      ctx.fillText('$' + item.price, x + colW - 44, y);
      ctx.textAlign = 'left';
    }

    ctx.textAlign = 'center';
    ctx.font = '10px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#5f5668';
    ctx.fillText('W/S 选行 · A/D 换列 · 回车 · ESC', VIEW_W / 2, VIEW_H - 24);

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
    ctx.fillStyle = '#ffd76e';
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
      ctx.fillStyle = '#cfc4d4';
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
    ctx.fillText('回车 $' + slotPrice + '  ·  ESC 返回', VIEW_W / 2, VIEW_H - 40);
  }

  // ---------------------------------------------------------------- 武器升级站 UI
  function drawUpgrade() {
    ctx.save();
    ctx.fillStyle = '#08060a';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';
    ctx.font = 'bold 24px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#ffb347';
    ctx.fillText('武器升级站', VIEW_W / 2, 44);
    ctx.font = 'bold 14px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#e8dcc8';
    ctx.fillText('$' + G.cash, VIEW_W / 2, 70);

    const sel = G.upgSel || { gun: 0, line: 0 };
    const gunId = UP_GUNS[clamp(sel.gun, 0, UP_GUNS.length - 1)];
    const line = clamp(sel.line, 0, UPGRADE_LINES.length);
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
      ctx.fillStyle = isSel ? '#ffdca0' : (have ? '#cfc4d4' : '#6f6678');
      const evoTag = u.evo ? ' ★' : '';
      ctx.fillText(WEAPONS[id].name + (have ? '' : '（未持有）') + evoTag, ux + tabW / 2, 107);
    }

    // 四条升级线 + 进化行
    const rowY = 142, rowH = 34;
    for (let li = 0; li <= UPGRADE_LINES.length; li++) {
      const y = rowY + li * rowH;
      const isSel = line === li;
      const def = li < UPGRADE_LINES.length ? UPGRADE_LINES[li] : null;
      // 进化行：四条全满才亮
      if (li >= UPGRADE_LINES.length) {
        const ready = upAllMaxed(gunId);
        const evolved = u.evo;
        ctx.fillStyle = isSel ? 'rgba(255,120,80,0.16)' : 'rgba(255,255,255,0.03)';
        ctx.fillRect(40, y - 14, VIEW_W - 80, 30);
        if (isSel) { ctx.strokeStyle = 'rgba(255,120,80,0.7)'; ctx.strokeRect(40.5, y - 13.5, VIEW_W - 81, 29); }
        ctx.textAlign = 'left';
        ctx.font = 'bold 13px "Microsoft YaHei", monospace';
        ctx.fillStyle = evolved ? '#8f8' : (ready ? '#ff9a6a' : '#5a5064');
        ctx.fillText('进化 · ' + (UP_EVO_NAME[gunId] || '—') + (evolved ? '（已进化）' : ''), 54, y);
        ctx.font = '10px "Microsoft YaHei", monospace';
        ctx.fillStyle = '#9c90a8';
        ctx.fillText(UP_EVO_DESC[gunId] || '', 54, y + 15);
        ctx.textAlign = 'right';
        if (!evolved) {
          const price = Math.round(UP_EVO_PRICE * (UP_PRICE_MUL[gunId] || 1));
          ctx.font = 'bold 12px "Microsoft YaHei", monospace';
          ctx.fillStyle = ready ? (G.cash >= price ? '#ffd76e' : '#8a5a4a') : '#5a5064';
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
      ctx.fillStyle = isSel ? '#fff3d0' : '#cfc4d4';
      ctx.fillText(def.name, 54, y);
      for (let d = 0; d < def.max; d++) {
        ctx.fillStyle = d < lv ? '#ffb347' : '#4a4450';
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
      ctx.fillStyle = maxed ? '#5a5064' : (afford ? '#ffd76e' : '#8a5a4a');
      ctx.fillText(maxed ? '满' : '$' + cost, VIEW_W - 54, y);
      ctx.textAlign = 'left';
    }

    ctx.textAlign = 'center';
    ctx.font = '10px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#5f5668';
    ctx.fillText('A/D 换枪  ·  W/S 换项  ·  回车购买  ·  V/ESC 返回', VIEW_W / 2, VIEW_H - 24);

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
    start: { x: VIEW_W / 2 - 80, y: 176, w: 160, h: 40 },
    settings: { x: VIEW_W / 2 - 80, y: 226, w: 160, h: 40 }
  };

  function drawTitle() {
    ctx.save();
    ctx.fillStyle = 'rgba(8,6,10,0.82)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';
    ctx.font = 'bold 34px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#e53935';
    ctx.fillText('HOTLINE 2.5D', VIEW_W / 2, 110);
    // 两个按钮：开始游戏 / 设置
    drawMenuButton(TITLE_BTN.start, '开始游戏', '#e53935');
    drawMenuButton(TITLE_BTN.settings, '设置', '#5aa7e0');
    // 只留一行最必要的：其余键位靠 HUD 和手感学，不铺教程
    ctx.fillStyle = '#6f6678';
    ctx.font = '11px "Microsoft YaHei", monospace';
    ctx.fillText('WASD 移动 · 左键开火 · 右键瞄准 · G 手雷 · E 交互/拾取', VIEW_W / 2, 300);
    ctx.restore();
  }

  /** 绘制一个菜单按钮（圆角描边 + 文字），hover 高亮。 */
  function drawMenuButton(b, label, color) {
    const hover = mouse.x >= b.x && mouse.x <= b.x + b.w && mouse.y >= b.y && mouse.y <= b.y + b.h;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 底板
    ctx.fillStyle = hover ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
    ctx.strokeStyle = hover ? color : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1.5;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.w, b.h, 6);
    } else {
      ctx.beginPath();
      ctx.rect(b.x, b.y, b.w, b.h);
    }
    ctx.fill();
    ctx.stroke();
    // 文字
    ctx.font = 'bold 16px "Microsoft YaHei", monospace';
    ctx.fillStyle = hover ? '#ffffff' : '#cfc4d4';
    ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 1);
    ctx.textBaseline = 'alphabetic';
  }

  // 设置页按钮区域
  const SETTINGS_BTN = {
    sound: { x: VIEW_W / 2 - 120, y: 138, w: 240, h: 40 },
    control: { x: VIEW_W / 2 - 120, y: 190, w: 240, h: 40 },
    back: { x: VIEW_W / 2 - 80, y: 248, w: 160, h: 40 }
  };

  function drawSettings() {
    ctx.save();
    ctx.fillStyle = 'rgba(8,6,10,0.88)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';
    ctx.font = 'bold 26px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#e8e0f0';
    ctx.fillText('设置', VIEW_W / 2, 96);
    // 音效开关
    const sb = SETTINGS_BTN.sound;
    const sHover = mouse.x >= sb.x && mouse.x <= sb.x + sb.w && mouse.y >= sb.y && mouse.y <= sb.y + sb.h;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = sHover ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
    ctx.strokeStyle = sHover ? '#5aa7e0' : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1.5;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(sb.x, sb.y, sb.w, sb.h, 6); }
    else { ctx.beginPath(); ctx.rect(sb.x, sb.y, sb.w, sb.h); }
    ctx.fill();
    ctx.stroke();
    ctx.font = 'bold 15px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#cfc4d4';
    ctx.fillText('音效：' + (Sfx.muted ? '关' : '开'), sb.x + sb.w / 2, sb.y + sb.h / 2 + 1);
    ctx.textBaseline = 'alphabetic';
    // 操作方式：手机触控 / 电脑键鼠
    const cb = SETTINGS_BTN.control;
    const cHover = mouse.x >= cb.x && mouse.x <= cb.x + cb.w && mouse.y >= cb.y && mouse.y <= cb.y + cb.h;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = cHover ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
    ctx.strokeStyle = cHover ? '#e5a13a' : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1.5;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(cb.x, cb.y, cb.w, cb.h, 6); }
    else { ctx.beginPath(); ctx.rect(cb.x, cb.y, cb.w, cb.h); }
    ctx.fill();
    ctx.stroke();
    ctx.font = 'bold 15px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#e8d8b8';
    ctx.fillText('操作方式：' + (inputMode === 'touch' ? '手机触控' : '电脑键鼠'), cb.x + cb.w / 2, cb.y + cb.h / 2 + 1);
    ctx.textBaseline = 'alphabetic';
    // 返回按钮
    drawMenuButton(SETTINGS_BTN.back, '返回', '#5aa7e0');
    ctx.restore();
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
        drawRingCrosshair(x, y, p.healCharge / HEAL_TIME, '#5ad08a');
      } else if (p.plating) {
        drawRingCrosshair(x, y, p.plateCharge / PLATE_TIME, '#5aa7e0');
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
    const col = hs ? '#ffb347' : 'rgba(255,74,74,0.98)';

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
    if (G.state === 'title' || !W) { drawTitle(); return; }

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

    // 先画尸体（最底层活物）
    for (const e of W.enemies) {
      if (!e.alive) drawActor(e, ENEMY_KIND[e.kind].tex, false, ENEMY_KIND[e.kind].corpse);
    }
    // 拾取物压在尸体上面，避免血包/弹药被尸体盖住捡不到
    drawPickups();
    // 活人压在最上面
    for (const e of W.enemies) {
      if (e.alive) drawActor(e, ENEMY_KIND[e.kind].tex, false, ENEMY_KIND[e.kind].corpse);
    }
    drawEliteBars();
    drawActor(G.player, 'player', true, 'corpse_player');
    drawLaser();

    drawGrenades();
    drawEffects();
    drawBlasts();
    drawWorldTexts();
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
    if (G && (G.state === 'title' || G.state === 'settings')) advanced = true;   // 标题/设置画面不跑逻辑，按键当帧作废

    if (G && G.state !== 'title' && G.state !== 'settings') {
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
    ctx.fillStyle = 'rgba(8,6,10,0.7)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';
    ctx.font = 'bold 20px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#e8e0f0';
    ctx.fillText('暂停', VIEW_W / 2, VIEW_H / 2 - 34);
    // 两个选项：继续 / 返回主菜单（鼠标悬停或键盘选中高亮）
    const sel = G.pauseSel || 0;
    const items = [
      { label: '继续游戏', y: VIEW_H / 2 - 4 },
      { label: '返回主菜单', y: VIEW_H / 2 + 30 }
    ];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const b = { x: VIEW_W / 2 - 80, y: it.y - 14, w: 160, h: 28 };
      const hover = mouse.x >= b.x && mouse.x <= b.x + b.w && mouse.y >= b.y && mouse.y <= b.y + b.h;
      const active = sel === i || hover;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = active ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.03)';
      ctx.strokeStyle = active ? (i === 1 ? '#e53935' : '#5aa7e0') : 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1.5;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 5); }
      else { ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); }
      ctx.fill();
      ctx.stroke();
      ctx.font = 'bold 15px "Microsoft YaHei", monospace';
      ctx.fillStyle = active ? '#ffffff' : '#cfc4d4';
      ctx.fillText(it.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
      ctx.textBaseline = 'alphabetic';
    }
    ctx.font = '11px "Microsoft YaHei", monospace';
    ctx.fillStyle = '#9c90a8';
    ctx.fillText('W/S 选择 · 回车/左键确认 · ESC 继续', VIEW_W / 2, VIEW_H / 2 + 70);
    ctx.restore();
  }

  /** 返回主菜单：清空世界和玩家，state 回 title（标题页纯 UI，不跑游戏逻辑）。 */
  function goTitle() {
    G.state = 'title';
    G.paused = false;
    G.pauseSel = 0;
    G.centerText = '';
    G.centerTimer = 0;
    W = null;
    G.player = null;
    G.grenades = [];
    BLASTS.length = 0;
  }

  /** 暂停菜单的按键处理（仅在 paused 时由 loop 调用）。 */
  function handlePauseKeys() {
    if (pressed['escape']) { G.paused = false; return; }
    if (pressed['w'] || pressed['arrowup']) G.pauseSel = 0;
    if (pressed['s'] || pressed['arrowdown']) G.pauseSel = 1;
    if (pressed['enter'] || pressed[' ']) {
      if (G.pauseSel === 1) goTitle();
      else G.paused = false;
    }
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
      if (pressed['s'] || pressed['arrowdown']) G.upgSel.line = Math.min(UPGRADE_LINES.length, G.upgSel.line + 1);
      if (pressed['enter'] || pressed[' '] || pressed['j']) buyUpgrade();
      if (pressed['e'] || pressed['escape']) closeUpgrade();
      pressed = Object.create(null);
      return;
    }
    // 设置页：ESC 返回标题
    if (G.state === 'settings') {
      if (pressed['escape']) { G.state = 'title'; pressed = Object.create(null); return; }
    }
    // R：手动换弹（重置关卡功能已去掉，死了会自动重来）
    if (pressed['r'] && G.state === 'play') startReload();
    // 整备期间：空格/回车跳过，立即进下一波
    if (G.state === 'play' && W.cleared && G.intermission > 0 &&
        (pressed[' '] || pressed['enter'])) {
      G.intermission = 0;
      if (G.doubleScore > 0) G.doubleScore--;
      startWave();
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
    fitCanvas();
    window.addEventListener('resize', fitCanvas);

    // 读取上次的操作方式（手机触控 / 电脑键鼠），默认电脑
    try {
      const saved = localStorage.getItem('hotline.inputMode');
      if (saved === 'touch' || saved === 'pc') inputMode = saved;
    } catch (err) { /* 忽略 */ }

    G = {
      state: 'title',
      levelIndex: 0,
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
      pauseSel: 0,          // 暂停菜单选中项：0=继续，1=返回主菜单
      deadTimer: 0,
      clearTimer: 0,
      fireTap: false,
      grenades: [],        // 飞行中的手雷
      blasts: [],          // 冲击波（视觉层，和 BLASTS 互为引用）
      // 武器升级：按枪种记账（pistol/smg/shotgun），第 5 波清完解锁
      upg: makeUpgrades(),
      upgUnlocked: false,
      upgSel: { gun: 0, line: 0 }
    };
    G.blasts = BLASTS;

    loadImages().then(() => {
      const bootEl = document.getElementById('boot');
      if (bootEl) bootEl.remove();
      // 鼠标按下时记录单击（用于半自动武器）
      canvas.addEventListener('mousedown', (e) => { if (e.button === 0) G.fireTap = true; });
      // ?autostart=1 直接进第一波，方便截图和自动化测试；?prep=1 保留开局 30 秒准备期
      if (/[?&]autostart=1/.test(location.search)) {
        startGame({ prep: /[?&]prep=1/.test(location.search) });
      }
      // ?settings=1 直接进设置页，用于截图核对（调试用）
      if (/[?&]settings=1/.test(location.search)) {
        G.state = 'settings';
      }
      // ?touch=1 切到手机触控模式（截图核对摇杆/按钮 UI 用）
      if (/[?&]touch=1/.test(location.search)) {
        setInputMode('touch');
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
    get arena() { return ARENA; },
    get shop() { return SHOP; },
    get slotSymbols() { return SLOT_SYMBOLS; },
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
    classifyTouch,
    applyTouchInput,
    refillArmor,
    openUpgrade,
    closeUpgrade,
    buyUpgrade,
    gunStat,
    gunUp,
    gunEvolved,
    upAllMaxed,
    upCost,
    get upgrades() { return G ? G.upg : null; },
    get upgUnlocked() { return G ? G.upgUnlocked : false; },
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
    /** 当前散射（度）：腰射 / 瞄准差多少，测试直接断言这个 */
    spreadDeg() {
      const p = G && G.player;
      return (p && p.weapon) ? spreadDeg(p, WEAPONS[p.weapon]) : 0;
    },
    /** 当前画面缩放（瞄准会升高） */
    get zoom() { return camZoom(); },
    attack() { if (G.player && G.player.weapon) playerAttack(); },
    pickup() { tryPickup(true); },
    reload() { return startReload(); },
    swap() { return swapWeapon(); },
    /** 手雷：投掷 / 直接炸开（测试用） */
    grenade() { return throwGrenade(); },
    explode(x, y, r, dmg) { explodeAt(x, y, r || GRENADE_RADIUS, dmg || GRENADE_DMG, true); },
    ignite(b) { return igniteBarrel(b); },
    /** 直接对敌人造成伤害（测试用） */
    hitEnemy(e, dmg) { return damageEnemy(e, dmg || 999, 0, true, false); },
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
