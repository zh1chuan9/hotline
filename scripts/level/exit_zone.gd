class_name ExitZone
extends Area2D
## 出口。清场之前是灰的，清场之后亮起来，走进去就通关。

const GLOW := preload("res://assets/sprites/spark.png")

var active := false
var _t := 0.0
var _glow: Sprite2D
var _fired := false


func _ready() -> void:
	collision_layer = 0
	collision_mask = 2
	monitoring = true

	var col := CollisionShape2D.new()
	var shape := RectangleShape2D.new()
	shape.size = Vector2(18, 18)
	col.shape = shape
	add_child(col)

	_glow = Sprite2D.new()
	_glow.texture = GLOW
	_glow.scale = Vector2.ONE * 3.4
	_glow.modulate = Color(0.45, 0.5, 0.52, 0.30)
	add_child(_glow)

	z_index = 2
	Events.enemies_cleared.connect(_activate)
	body_entered.connect(_on_body_entered)


func _activate() -> void:
	if active:
		return
	active = true
	Sfx.play("clear", 1.0, -6.0)


func _process(delta: float) -> void:
	_t += delta
	if _glow == null:
		return
	if active:
		var k: float = 0.6 + 0.4 * sin(_t * 5.0)
		_glow.modulate = Color(0.55 * k, 1.0 * k, 0.62 * k, 0.75)
		_glow.scale = Vector2.ONE * (3.4 + sin(_t * 5.0) * 0.5)
	else:
		_glow.modulate = Color(0.42, 0.45, 0.48, 0.25)


func _on_body_entered(body) -> void:
	if not active or _fired:
		return
	if body.is_in_group("player"):
		_fired = true
		Events.level_cleared.emit(Game.level_index)
