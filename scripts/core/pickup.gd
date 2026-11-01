class_name Pickup
extends Area2D
## 地上的武器。也负责"被扔出去的武器"的飞行与命中判定。

const MASK_FLY := 1 | 4        ## 墙 + 敌人
const THROW_SPEED := 420.0

var data: WeaponData
var velocity := Vector2.ZERO
var flying := false

var _icon: Sprite2D
var _bob := 0.0


static func spawn(d: WeaponData, pos: Vector2, impulse := Vector2.ZERO) -> Pickup:
	var world := Game.world
	if world == null or d == null:
		return null

	var p := Pickup.new()
	p.data = d

	var col := CollisionShape2D.new()
	var shape := CircleShape2D.new()
	shape.radius = 13.0
	col.shape = shape
	p.add_child(col)

	var spr := Sprite2D.new()
	spr.name = "Icon"
	spr.texture = d.icon
	spr.scale = Vector2(0.78, 0.78)      # 和持在手里时同一个比例
	spr.scale = Vector2(0.78, 0.78)      # 和持在手里时同一个比例
	p.add_child(spr)
	p._icon = spr

	p.z_index = 1
	world.add_child(p)
	p.global_position = pos
	p._bob = randf() * TAU

	if impulse.length() > 0.01:
		p.velocity = impulse.normalized() * THROW_SPEED
		p.flying = true
		p.rotation = p.velocity.angle()
	return p


func _ready() -> void:
	collision_layer = 8      # pickup 层
	collision_mask = 2       # 只关心玩家
	monitoring = true
	body_entered.connect(_on_body_entered)


func _physics_process(delta: float) -> void:
	_bob += delta
	if _icon != null:
		_icon.position.y = sin(_bob * 2.6) * 1.2

	if not flying:
		return

	var step := velocity * delta
	if step.length() < 1.0:
		_land()
		return

	var q := PhysicsRayQueryParameters2D.create(global_position, global_position + step, MASK_FLY)
	q.exclude = [get_rid()]
	var res := get_world_2d().direct_space_state.intersect_ray(q)
	if res.is_empty():
		global_position += step
		rotation = velocity.angle()
		velocity = velocity.move_toward(Vector2.ZERO, 260.0 * delta)
	else:
		global_position = res.position - step.normalized() * 6.0
		var col = res.collider
		if col.is_in_group("actors"):
			col.stun(1.6)
			Sfx.play("hit")
			Fx.shake(3.0, 0.14)
			FxUtil.blood_splat(col.global_position, velocity.normalized(), 4)
		else:
			Sfx.play("step")
		_land()


func _land() -> void:
	flying = false
	velocity = Vector2.ZERO
	rotation = 0.0


func _on_body_entered(body) -> void:
	if body.is_in_group("player"):
		body.add_nearby(self)
		# 空手时自动捡起，手上有家伙就得按 E 换
		if body.equipped == null and not flying:
			collect(body)


func collect(actor) -> void:
	if data == null:
		return
	actor.equip(data)
	queue_free()
