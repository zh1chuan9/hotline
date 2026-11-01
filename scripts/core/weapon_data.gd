class_name WeaponData
extends Resource
## 武器数据（纯数据，不带逻辑）。
## 新增武器 = 在 weapon_db.gd 里加一个 static 函数，不用碰任何逻辑代码。

enum Kind { MELEE, RANGED }

@export var display_name: String = "未知"
@export var kind: Kind = Kind.RANGED
@export var icon: Texture2D

@export_group("射击")
@export var damage: int = 1
@export var fire_rate: float = 0.16      ## 两次攻击的最小间隔（秒）
@export var magazine: int = 12           ## 弹匣容量；近战填 9999 表示无限
@export var pellets: int = 1             ## 一次打出的弹丸数（霰弹枪 > 1）
@export var spread_deg: float = 2.0      ## 散布半角（度）
@export var max_range: float = 460.0     ## 射程
@export var automatic: bool = false      ## 按住是否连发
@export var knockback: float = 0.0       ## 命中后的击退

@export_group("近战")
@export var melee_reach: float = 30.0
@export var melee_arc: float = 110.0     ## 挥击扇形总角度

@export_group("表现")
@export var shake: float = 2.0           ## 开火屏幕震动
@export var sound: String = "shoot"
@export var pickup_sfx: String = "pickup"
@export var return_on_throw_hit: bool = true  ## 投掷命中后是否掉回地面
