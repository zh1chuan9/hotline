class_name Player
extends Actor
## 玩家：移动与朝向分离（朝鼠标），一击必杀，可以扔武器。

const SPEED := 134.0
const TEX_CORPSE := preload("res://assets/sprites/corpse_player.png")

var nearby: Array = []
var _step_timer := 0.0
var _death_done := false


func _ready() -> void:
	# 配色要在 super() 之前给：_ready 里就会按这三色把造型画出来
	head_color = Color8(234, 228, 216)     # 白发
	skin_color = Color8(226, 178, 142)
	super()
	add_to_group("player")
	collision_layer = 2      # player 层：拾取物 / 出口 / 敌人子弹都只认这一层
	collision_mask = 1       # 只和墙碰撞
	move_speed = SPEED
	Game.player = self


func corpse_texture() -> Texture2D:
	return TEX_CORPSE


func _physics_process(delta: float) -> void:
	if not alive:
		step(Vector2.ZERO, delta)
		return

	# 移动：8 方向
	var dir := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	step(dir, delta)

	# 朝向：永远看鼠标（所以可以边后退边开枪）
	var aim := get_global_mouse_position() - global_position
	if aim.length_squared() > 36.0:
		face(aim)

	_footsteps(delta)
	_handle_combat()


func _footsteps(delta: float) -> void:
	if velocity.length() > 24.0:
		_step_timer -= delta
		if _step_timer <= 0.0:
			_step_timer = 0.28
			Sfx.play("step", 1.0, -14.0)
	else:
		_step_timer = 0.0


func _handle_combat() -> void:
	if Input.is_action_just_pressed("pickup"):
		_try_pickup()

	if equipped == null:
		return
	if Input.is_action_pressed("fire"):
		if equipped.data.automatic:
			equipped.try_attack()
		elif Input.is_action_just_pressed("fire"):
			equipped.try_attack()

	if Input.is_action_just_pressed("throw"):
		var w := equipped
		equipped = null
		w.detach_to_ground(facing)
		Sfx.play("throw")
		Events.noise_emitted.emit(global_position, 110.0)
		Fx.shake(1.2, 0.1)


func _try_pickup() -> void:
	_clean_nearby()
	if nearby.is_empty():
		return
	var best = nearby[0]
	var best_d := 1e9
	for p in nearby:
		if not is_instance_valid(p):
			continue
		var d: float = global_position.distance_squared_to(p.global_position)
		if d < best_d:
			best_d = d
			best = p
	if is_instance_valid(best):
		best.collect(self)


func add_nearby(p: Node) -> void:
	if not nearby.has(p):
		nearby.append(p)


func _clean_nearby() -> void:
	var kept: Array = []
	for p in nearby:
		if is_instance_valid(p) and not p.is_queued_for_deletion():
			kept.append(p)
	nearby = kept


func _death_visual() -> void:
	if _death_done:
		return
	_death_done = true
	set_tint(Color(0.85, 0.5, 0.5))
	Fx.slowmo(0.22, 0.55)
	Fx.shake(5.0, 0.35)
	Events.player_died.emit(global_position)
