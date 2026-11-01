class_name WeaponDB
extends RefCounted
## 武器工厂。全部用代码构造，避免维护一堆 .tres 文件。

const ICON_PISTOL := preload("res://assets/sprites/w_pistol.png")
const ICON_SHOTGUN := preload("res://assets/sprites/w_shotgun.png")
const ICON_BAT := preload("res://assets/sprites/w_bat.png")
const ICON_KNIFE := preload("res://assets/sprites/w_knife.png")


static func pistol() -> WeaponData:
	var w := WeaponData.new()
	w.display_name = "手枪"
	w.kind = WeaponData.Kind.RANGED
	w.icon = ICON_PISTOL
	w.fire_rate = 0.15
	w.magazine = 12
	w.pellets = 1
	w.spread_deg = 1.6
	w.max_range = 520.0
	w.automatic = false
	w.shake = 2.2
	w.sound = "shoot"
	return w


static func shotgun() -> WeaponData:
	var w := WeaponData.new()
	w.display_name = "霰弹枪"
	w.kind = WeaponData.Kind.RANGED
	w.icon = ICON_SHOTGUN
	w.fire_rate = 0.75
	w.magazine = 5
	w.pellets = 7
	w.spread_deg = 9.0
	w.max_range = 230.0
	w.automatic = false
	w.shake = 6.0
	w.sound = "shotgun"
	return w


static func bat() -> WeaponData:
	var w := WeaponData.new()
	w.display_name = "棒球棍"
	w.kind = WeaponData.Kind.MELEE
	w.icon = ICON_BAT
	w.fire_rate = 0.42
	w.magazine = 9999
	w.melee_reach = 34.0
	w.melee_arc = 130.0
	w.shake = 3.0
	w.sound = "swing"
	return w


static func knife() -> WeaponData:
	var w := WeaponData.new()
	w.display_name = "匕首"
	w.kind = WeaponData.Kind.MELEE
	w.icon = ICON_KNIFE
	w.fire_rate = 0.26
	w.magazine = 9999
	w.melee_reach = 30.0
	w.melee_arc = 100.0
	w.shake = 2.0
	w.sound = "swing"
	return w


## 按 ASCII 地图里的字符取武器；返回 null 表示这个字符不是武器
static func from_code(code: String) -> WeaponData:
	match code:
		"1":
			return pistol()
		"2":
			return shotgun()
		"B":
			return bat()
		"K":
			return knife()
	return null
