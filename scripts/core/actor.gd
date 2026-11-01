class_name Actor
extends CharacterBody2D
## 角色基类：玩家和敌人共用的移动、朝向、一击必杀、掉落武器。
## 这套玩法里所有人都是一下就死，所以没有血量，只有 alive。
##
## 造型只有三样东西：一个头、两只圆手。手绕着头转、眼睛看向朝向 —
## 俯视角下这三样就是全部信息量，再多的躯干、肩膀、腿只会变成一团色块。
## 好处是手能连续跟着鼠标走，不用为 8 个方向各画一张贴图。

signal died(actor: Actor)

const SHADOW_TEX := preload("res://assets/sprites/shadow.png")

const HEAD_R := 5.8          ## 头半径
const HAND_R := 2.9          ## 圆手半径
const HAND_REACH := 12.0     ## 手到圆心的距离
const HAND_ARC := 0.58       ## 两只手相对朝向张开的角度
const EYE_DARK := Color(0.10, 0.08, 0.12)

@export var move_speed: float = 130.0

var alive: bool = true
var facing: Vector2 = Vector2.RIGHT
var equipped: Weapon = null
var stun_time: float = 0.0

## 配色：由子类在 super() 之前设置
var head_color: Color = Color(0.92, 0.90, 0.86)
var skin_color: Color = Color(0.89, 0.70, 0.56)
var body_tint: Color = Color.WHITE

var sprite: Sprite2D
var shadow: Sprite2D
var _last_facing: Vector2 = Vector2.ZERO


func _ready() -> void:
	add_to_group("actors")
	_build_visual()


## 子类返回自己的尸体贴图（倒地姿势单独画，比把活人转个角度好看得多）
func corpse_texture() -> Texture2D:
	return null


func _build_visual() -> void:
	shadow = Sprite2D.new()
	shadow.name = "Shadow"
	shadow.texture = SHADOW_TEX
	shadow.scale = Vector2(0.46, 0.46)
	shadow.z_as_relative = false
	shadow.z_index = 1
	add_child(shadow)

	var col := CollisionShape2D.new()
	col.name = "Collision"
	var shape := CircleShape2D.new()
	shape.radius = 8.0
	col.shape = shape
	add_child(col)

	z_index = 3
	queue_redraw()


func _process(delta: float) -> void:
	if alive and facing != _last_facing:
		_last_facing = facing
		queue_redraw()
	if stun_time > 0.0:
		stun_time = maxf(0.0, stun_time - delta)


# ---------------------------------------------------------------- 画自己
func _draw() -> void:
	if not alive:
		return
	var ang := facing.angle()
	var rim := head_color.darkened(0.62) * body_tint
	var hair := head_color * body_tint
	var skin := skin_color * body_tint

	# 手：绕头前方左右各一只。先画手、后画头，手的根部就被头压住
	for s: float in [-1.0, 1.0]:
		var p := Vector2.RIGHT.rotated(ang + s * HAND_ARC) * HAND_REACH
		draw_circle(p, HAND_R + 1.0, rim)
		draw_circle(p, HAND_R, skin)
		draw_circle(p + Vector2(-0.7, -0.8), HAND_R * 0.38, skin.lightened(0.28))

	# 头：外圈描边 + 头发
	draw_circle(Vector2.ZERO, HEAD_R + 0.9, rim)
	draw_circle(Vector2.ZERO, HEAD_R, hair)

	# 发旋：头顶偏后的一小块高光，很淡 —— 亮过头就成了脑袋上的第三个点
	draw_circle(Vector2(-1.2, -1.5), 1.5, hair.lightened(0.10))

	# 眼睛：贴着朝向，瞳孔再往朝向那边偏一点，"眼睛看向哪"才看得出来
	for s: float in [-1.0, 1.0]:
		var ea := ang + s * 0.42
		var ep := Vector2.RIGHT.rotated(ea) * (HEAD_R * 0.60)
		draw_circle(ep + Vector2.RIGHT.rotated(ang) * 0.3, 1.05, EYE_DARK)
		draw_circle(ep - Vector2.RIGHT.rotated(ang) * 0.7 + Vector2(0, -0.4), 0.36,
			Color(0.99, 0.98, 0.95))


## 染色（受击闪红、死亡褪色）
func set_tint(c: Color) -> void:
	body_tint = c
	queue_redraw()


## 带状态的移动。被击晕时失去控制、靠惯性滑停。
func step(dir: Vector2, delta: float) -> void:
	if stun_time > 0.0:
		velocity = velocity.move_toward(Vector2.ZERO, 1700.0 * delta)
	else:
		velocity = dir.limit_length(1.0) * move_speed
	move_and_slide()


func face(dir: Vector2) -> void:
	if dir.length_squared() > 0.0004:
		facing = dir.normalized()


func is_stunned() -> bool:
	return stun_time > 0.0


func stun(seconds: float) -> void:
	stun_time = maxf(stun_time, seconds)
	if equipped != null:
		equipped.cancel_reload()


## 一击必杀。dir 决定血溅方向与倒地朝向。
func kill(dir: Vector2, weapon_name: String) -> void:
	if not alive:
		return
	alive = false
	velocity = Vector2.ZERO
	remove_from_group("actors")
	collision_layer = 0
	collision_mask = 0
	queue_redraw()

	var d := dir.normalized() if dir.length_squared() > 0.001 else facing
	# 尸体沿受力方向被推开一小段：原地倒下没有重量，推开才有"被打飞"的错觉
	var death_pos := global_position + d * randf_range(5.0, 11.0)
	FxUtil.blood_burst(global_position, d)
	FxUtil.corpse(death_pos, corpse_texture(), d.angle())
	Sfx.play("die")

	if equipped != null:
		var w := equipped
		equipped = null
		w.detach_to_ground(facing * 30.0)

	_death_visual()
	died.emit(self)


## 子类覆写：倒地后的额外表现。
func _death_visual() -> void:
	if shadow != null:
		shadow.modulate.a = 0.0
	queue_redraw()


## 捡起武器（会扔掉手里的）
func equip(data: WeaponData) -> void:
	if equipped != null:
		var old := equipped
		equipped = null
		old.detach_to_ground()
	equipped = Weapon.create(data, self)
	Sfx.play(data.pickup_sfx)


func weapon_name() -> String:
	if equipped == null or equipped.data == null:
		return "空手"
	return equipped.data.display_name
