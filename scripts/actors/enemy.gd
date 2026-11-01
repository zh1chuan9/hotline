class_name Enemy
extends Actor
## 敌人 AI：巡逻 → 听到动静去查看 → 看见玩家后短暂迟疑 → 追击/开火。
## 设计原则：情报是"有限"的 —— 敌人只知道自己看到和听到的。

enum State { IDLE, PATROL, INVESTIGATE, CHASE }

const TEX_CORPSE_MELEE := preload("res://assets/sprites/corpse_enemy_melee.png")
const TEX_CORPSE_GUN := preload("res://assets/sprites/corpse_enemy_gun.png")
const TEX_CORPSE_SHOTGUN := preload("res://assets/sprites/corpse_enemy_shotgun.png")

var enemy_type := "melee"

# 感知
var view_distance := 210.0
var view_angle := 120.0        ## 视野总角度（度）
var reaction := 0.22           ## 看见玩家后的迟疑时间

# 战斗
var attack_range := 30.0
var keep_distance := 160.0     ## 枪手希望维持的距离
var attack_interval := 0.55
var aim_error := 5.0           ## 射击角度误差（度），给玩家活路

# 巡逻
var patrol_radius := 46.0
var home := Vector2.ZERO

var state := State.IDLE
var investigate_pos := Vector2.ZERO

var _saw_last := false
var _alert := 0.0
var _last_seen := Vector2.ZERO
var _lost := 0.0
var _attack_cd := 0.0
var _think_timer := 0.0
var _investigate_timer := 0.0
var _stuck := 0.0
var _patrol_target := Vector2.ZERO


func _ready() -> void:
	_configure()
	super()
	collision_layer = 4      # enemy 层：玩家子弹射线会打这一层
	collision_mask = 1       # 只和墙碰撞，不互相挤开
	Events.noise_emitted.connect(_on_noise)


func corpse_texture() -> Texture2D:
	match enemy_type:
		"gun":
			return TEX_CORPSE_GUN
		"shotgun":
			return TEX_CORPSE_SHOTGUN
	return TEX_CORPSE_MELEE


func _configure() -> void:
	# 配色要在 super() 之前给：_ready 里就会按这三色把造型画出来
	match enemy_type:
		"melee":
			head_color = Color8(176, 154, 202)   # 紫兜帽
			skin_color = Color8(206, 166, 132)
		"gun":
			head_color = Color8(172, 178, 192)   # 蓝西装，灰发
			skin_color = Color8(214, 172, 138)
		"shotgun":
			head_color = Color8(198, 160, 106)   # 土黄，鸭舌帽
			skin_color = Color8(224, 180, 144)
	match enemy_type:
		"gun":
			move_speed = 92.0
			view_distance = 205.0
			attack_range = 170.0
			keep_distance = 140.0
			attack_interval = 0.65
			aim_error = 8.0
			equipped = Weapon.create(WeaponDB.pistol(), self)
		"shotgun":
			move_speed = 100.0
			view_distance = 190.0
			attack_range = 100.0
			keep_distance = 84.0
			attack_interval = 1.15
			aim_error = 10.0
			equipped = Weapon.create(WeaponDB.shotgun(), self)
		_:
			enemy_type = "melee"
			move_speed = 112.0
			view_distance = 185.0
			attack_range = 26.0
			attack_interval = 0.62
			aim_error = 0.0
			equipped = Weapon.create(WeaponDB.knife(), self)


## 由 level_builder 在摆好位置之后调用
func on_spawned() -> void:
	home = global_position
	facing = Vector2.RIGHT.rotated(randf() * TAU)
	state = State.IDLE
	_think_timer = randf_range(0.5, 2.0)
	Game.register_enemy(self)


# ---------------------------------------------------------------- 主循环
func _physics_process(delta: float) -> void:
	if not alive:
		return

	if _attack_cd > 0.0:
		_attack_cd -= delta

	if is_stunned():
		_alert = 0.0
		step(Vector2.ZERO, delta)
		return

	var sees := _sees_player()

	if sees:
		_last_seen = Game.player.global_position
		_lost = 0.0
		if not _saw_last:
			_saw_last = true
			if state != State.CHASE:
				_alert = reaction
				face(_last_seen - global_position)
				step(Vector2.ZERO, delta)
				Sfx.play("alert", 1.0, -8.0)
				return
		if _alert > 0.0:
			_alert -= delta
			face(_last_seen - global_position)
			step(Vector2.ZERO, delta)
			return
		state = State.CHASE
	else:
		_saw_last = false
		if state == State.CHASE:
			_lost += delta
			if _lost > 1.8:
				state = State.INVESTIGATE
				investigate_pos = _last_seen
				_investigate_timer = 4.5

	match state:
		State.IDLE:
			_do_idle(delta)
		State.PATROL:
			_do_patrol(delta)
		State.INVESTIGATE:
			_do_investigate(delta)
		State.CHASE:
			_do_chase(delta)


# ---------------------------------------------------------------- 感知
func _sees_player() -> bool:
	var p = Game.player
	if p == null or not is_instance_valid(p) or not p.alive:
		return false
	var to: Vector2 = p.global_position - global_position
	var dist := to.length()
	if dist > view_distance:
		return false
	if dist > 10.0 and absf(rad_to_deg(facing.angle_to(to))) > view_angle * 0.5:
		return false
	var q := PhysicsRayQueryParameters2D.create(global_position, p.global_position, 1)
	q.exclude = [get_rid()]
	return get_world_2d().direct_space_state.intersect_ray(q).is_empty()


func _on_noise(pos: Vector2, radius: float) -> void:
	if not alive or state == State.CHASE:
		return
	var d := global_position.distance_to(pos)
	if d > radius or d < 36.0:
		return
	investigate_pos = pos
	state = State.INVESTIGATE
	_investigate_timer = 5.0
	_stuck = 0.0


# ---------------------------------------------------------------- 各状态行为
func _do_idle(delta: float) -> void:
	step(Vector2.ZERO, delta)
	_think_timer -= delta
	if _think_timer <= 0.0:
		_think_timer = randf_range(1.6, 3.8)
		if randf() < 0.65:
			_patrol_target = _point_near(home, patrol_radius)
			state = State.PATROL


func _do_patrol(delta: float) -> void:
	var to := _patrol_target - global_position
	if to.length() < 8.0:
		state = State.IDLE
		_think_timer = randf_range(0.7, 2.0)
		step(Vector2.ZERO, delta)
		return
	face(to)
	step(to.normalized(), delta)
	if get_real_velocity().length() < 12.0:
		_stuck += delta
		if _stuck > 0.45:
			_stuck = 0.0
			state = State.IDLE
			_think_timer = 0.5
	else:
		_stuck = 0.0


func _do_investigate(delta: float) -> void:
	_investigate_timer -= delta
	if _investigate_timer <= 0.0:
		state = State.IDLE
		_think_timer = 0.8
		step(Vector2.ZERO, delta)
		return

	var to := investigate_pos - global_position
	if to.length() < 20.0:
		# 到了，原地环顾
		step(Vector2.ZERO, delta)
		facing = facing.rotated(delta * 1.6)
		return
	face(to)
	step(to.normalized(), delta)
	if get_real_velocity().length() < 12.0:
		_stuck += delta
		if _stuck > 0.5:
			_stuck = 0.0
			investigate_pos = _point_near(global_position, 44.0)
	else:
		_stuck = 0.0


func _do_chase(delta: float) -> void:
	var p = Game.player
	if p == null or not is_instance_valid(p) or not p.alive:
		state = State.IDLE
		step(Vector2.ZERO, delta)
		return

	var to: Vector2 = p.global_position - global_position
	var dist := to.length()
	if dist > 2.0:
		face(to)

	if enemy_type == "melee":
		if dist <= attack_range:
			_swing()
			step(Vector2.ZERO, delta)
		else:
			step(to.normalized(), delta)
		return

	# 枪手：没子弹就冲上来
	if equipped == null or equipped.is_empty():
		step(to.normalized(), delta)
		return

	if dist > keep_distance:
		step(to.normalized(), delta)
	elif dist < keep_distance * 0.6:
		step(-to.normalized(), delta)
	else:
		step(Vector2.ZERO, delta)

	if dist <= attack_range:
		_shoot()


func _swing() -> void:
	if _attack_cd > 0.0 or equipped == null:
		return
	if equipped.try_attack():
		_attack_cd = attack_interval


func _shoot() -> void:
	if _attack_cd > 0.0 or equipped == null:
		return
	var orig := facing
	facing = orig.rotated(deg_to_rad(randf_range(-aim_error, aim_error)))
	var fired := equipped.try_attack()
	facing = orig
	if fired:
		_attack_cd = attack_interval


# ---------------------------------------------------------------- 工具
func _point_near(origin: Vector2, radius: float) -> Vector2:
	for i in 6:
		var p := origin + Vector2(randf_range(-1, 1), randf_range(-1, 1)) * radius
		var q := PhysicsRayQueryParameters2D.create(origin, p, 1)
		q.exclude = [get_rid()]
		if get_world_2d().direct_space_state.intersect_ray(q).is_empty():
			return p
	return origin


## 敌人死亡：注销 + 计分
func kill(dir: Vector2, weapon_name: String) -> void:
	if not alive:
		return
	Game.unregister_enemy(self)
	super(dir, weapon_name)
	Game.on_kill(global_position, weapon_name)
