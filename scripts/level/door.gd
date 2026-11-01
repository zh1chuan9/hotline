class_name Door
extends StaticBody2D
## 门：玩家朝它走就会推开。推门有声，会惊动附近的人 —— 所以走门是有代价的。

const TEX := preload("res://assets/sprites/door.png")
const OPEN_RANGE := 30.0
const NOISE_RADIUS := 210.0

var opened := false
var _sprite: Sprite2D
var _col: CollisionShape2D


func _ready() -> void:
	collision_layer = 1
	collision_mask = 0
	z_index = 2

	_sprite = Sprite2D.new()
	_sprite.texture = TEX
	add_child(_sprite)

	_col = CollisionShape2D.new()
	var shape := RectangleShape2D.new()
	shape.size = Vector2(Levels.TILE, Levels.TILE)
	_col.shape = shape
	add_child(_col)


func _physics_process(_delta: float) -> void:
	if opened:
		return
	var p = Game.player
	if p == null or not is_instance_valid(p) or not p.alive:
		return
	var to: Vector2 = global_position - p.global_position
	if to.length() > OPEN_RANGE:
		return
	# 只有在朝门的方向移动时才推开
	if p.velocity.length() < 20.0:
		return
	if p.velocity.normalized().dot(to.normalized()) < 0.55:
		return
	open()


func open() -> void:
	if opened:
		return
	opened = true
	_col.set_deferred("disabled", true)
	Sfx.play("door", 1.0, -3.0)
	Events.noise_emitted.emit(global_position, NOISE_RADIUS)

	# 视觉：门被推进墙里
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(self, "rotation", deg_to_rad(78.0), 0.16)
	tw.tween_property(self, "modulate:a", 0.35, 0.18)
