class_name Weapon
extends Node2D
## 挂在角色身下的武器节点：负责开火、近战判定、弹道、掉落到地面。
## 逻辑与数据分离，换武器只换 WeaponData。

const MASK_SHOT := 1 | 2 | 4     ## 墙 + 玩家 + 敌人（1/2/4 为物理层位）
const MASK_WALL := 1

var data: WeaponData
var holder = null                 ## 持有者（Actor），弱类型以避免和 Actor 形成循环引用
var ammo: int = 0
var cooldown: float = 0.0
var _kick: float = 0.0


## 创建一把武器并挂到角色身上
static func create(d: WeaponData, h) -> Weapon:
	var w := Weapon.new()
	w.data = d
	w.holder = h
	w.ammo = d.magazine
	h.add_child(w)
	var icon := Sprite2D.new()
	icon.name = "Icon"
	icon.texture = d.icon
	icon.position = Vector2(2, 0)      # 让握把落在手上，枪身往前伸
	# 枪不能比头还大。头直径约 11px，枪身按 0.72 缩到 13px 才配得上
	icon.scale = Vector2(0.72, 0.72)
	# 枪不能比头还大。头直径约 11px，枪身按 0.72 缩到 13px 才配得上
	icon.scale = Vector2(0.72, 0.72)
	w.add_child(icon)
	return w


func _process(delta: float) -> void:
	if cooldown > 0.0:
		cooldown -= delta
	if holder == null or not is_instance_valid(holder):
		return
	rotation = holder.facing.angle()
	_kick = move_toward(_kick, 0.0, delta * 55.0)
	position = holder.facing * (11.6 - _kick) + holder.facing.orthogonal() * 2.0


func is_melee() -> bool:
	return data != null and data.kind == WeaponData.Kind.MELEE


func is_empty() -> bool:
	return not is_melee() and ammo <= 0


## 尝试攻击，返回是否真的挥出去了
func try_attack() -> bool:
	if data == null or holder == null or not holder.alive:
		return false
	if cooldown > 0.0:
		return false
	if is_melee():
		_do_melee()
	elif ammo <= 0:
		Sfx.play("empty")
		cooldown = 0.3
		return false
	else:
		_do_shoot()
	cooldown = data.fire_rate
	return true


# ---------------------------------------------------------------- 近战
func _do_melee() -> void:
	Sfx.play(data.sound)
	_kick = 7.0
	Fx.shake(data.shake, 0.12)
	var origin: Vector2 = holder.global_position
	var reached := data.melee_reach
	var arc := deg_to_rad(data.melee_arc) * 0.5
	var hit_any := false

	# 玩家砍敌人 / 敌人砍玩家 —— 目标列表按持有者身份决定
	var targets: Array = []
	if holder.is_in_group("player"):
		targets = Game.enemies.duplicate()
	elif Game.player != null and is_instance_valid(Game.player) and Game.player.alive:
		targets = [Game.player]

	for e in targets:
		if not is_instance_valid(e) or not e.alive:
			continue
		var to: Vector2 = e.global_position - origin
		var dist := to.length()
		if dist > reached + 10.0:
			continue
		if dist > 1.0 and absf(holder.facing.angle_to(to)) > arc:
			continue
		if not _clear_line(origin, e.global_position):
			continue
		var dir: Vector2 = to.normalized() if dist > 1.0 else holder.facing
		e.kill(dir, data.display_name)
		hit_any = true

	if hit_any:
		# 近战的反馈比枪更重：挥砍是"用力砸"，不是"点一下"
		Fx.kill_feedback(holder.facing, 1.3)
		FxUtil.impact_burst(origin + holder.facing * reached * 0.6, holder.facing, 1.35)
	FxUtil.slash_arc(origin, holder.facing, reached + 4.0, data.melee_arc)
	Events.noise_emitted.emit(origin, 130.0)


# ---------------------------------------------------------------- 射击
func _do_shoot() -> void:
	ammo -= 1
	Sfx.play(data.sound)
	Fx.shake(data.shake, 0.16)
	# 开火的后坐：镜头往后退一点点，越大的枪退得越多
	Fx.impact(holder.facing, data.shake * 0.4)
	_kick = 7.0
	Events.noise_emitted.emit(holder.global_position, 520.0)

	var origin: Vector2 = holder.global_position + holder.facing * 12.0
	for i in data.pellets:
		var ang: float = holder.facing.angle() + deg_to_rad(randf_range(-data.spread_deg, data.spread_deg))
		_trace_shot(origin, ang)

	FxUtil.spark(origin, holder.facing, 3)


func _trace_shot(origin: Vector2, ang: float) -> void:
	var dir := Vector2.RIGHT.rotated(ang)
	var to := origin + dir * data.max_range
	var q := PhysicsRayQueryParameters2D.create(origin, to, MASK_SHOT)
	q.exclude = [holder.get_rid()]
	var res: Dictionary = holder.get_world_2d().direct_space_state.intersect_ray(q)

	var end := to
	if not res.is_empty():
		end = res.position
		var col = res.collider
		# 活着的角色都在 "actors" 组里，死了就退组 —— 用组判断避免和 Actor 类型循环引用
		if col.is_in_group("actors"):
			col.kill(dir, data.display_name)
			Fx.kill_feedback(dir, 1.0)
			FxUtil.impact_burst(end, dir, 1.0)
		else:
			FxUtil.spark(end, -dir, 3)
			FxUtil.bullet_hole(end)
	FxUtil.tracer(origin, end)


func _clear_line(from: Vector2, to: Vector2) -> bool:
	var q := PhysicsRayQueryParameters2D.create(from, to, MASK_WALL)
	q.exclude = [holder.get_rid()]
	return holder.get_world_2d().direct_space_state.intersect_ray(q).is_empty()


# ---------------------------------------------------------------- 掉落 / 投掷
## 从手上脱离，变成地上的拾取物（可带初速 = 投掷）
func detach_to_ground(impulse := Vector2.ZERO) -> void:
	if data == null:
		return
	var d := data
	var pos := global_position
	holder = null
	Pickup.spawn(d, pos, impulse)
	queue_free()


## 预留：以后加换弹时在这里打断
func cancel_reload() -> void:
	pass


## 剩余弹药描述
func ammo_text() -> String:
	if is_melee():
		return "近战"
	return "%d / %d" % [maxi(ammo, 0), data.magazine]
