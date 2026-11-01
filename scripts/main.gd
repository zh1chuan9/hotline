extends Node2D
## 游戏入口：加载关卡、生成玩家、处理重试与关卡切换。

@onready var world: Node2D = $World
@onready var camera = $Camera
@onready var hud = $HUD

var _score_at_level_start := 0
var _transitioning := false
var _game_done := false
var _level_token := 0          ## 每次重建关卡 +1，用来作废还在 await 的旧流程
var _hint_shown := false


func _ready() -> void:
	# main 与 HUD 在暂停时仍然响应输入，只有 World 停下来
	process_mode = Node.PROCESS_MODE_ALWAYS
	world.process_mode = Node.PROCESS_MODE_PAUSABLE

	Game.main = self
	Game.world = world
	Events.level_cleared.connect(_on_level_cleared)

	Game.reset_run()
	start_level(0)


# ---------------------------------------------------------------- 关卡流程
func start_level(index: int) -> void:
	_transitioning = false
	_game_done = false
	_score_at_level_start = Game.score
	_build_level(index)


func restart_level() -> void:
	if _game_done:
		Game.reset_run()
		start_level(0)
		return
	Game.score = _score_at_level_start
	_build_level(Game.level_index)
	Events.toast.emit("重新开始")


func _build_level(index: int) -> void:
	_level_token += 1
	Game.reset_level_state()
	Game.level_index = index
	Fx.clear_time_effects()
	get_tree().paused = false
	hud.set_paused(false)

	# 清场：先摘出树再释放，避免同一帧里旧关卡的碰撞还在
	for c in world.get_children():
		world.remove_child(c)
		c.queue_free()

	var data := Levels.get_level(index)
	var info := LevelBuilder.build(data["rows"], world)
	var spawn: Vector2 = info["spawn"]
	var map_size: Vector2 = info["size"]

	var p := Player.new()
	p.name = "Player"
	p.position = spawn
	world.add_child(p)
	Game.player = p

	camera.setup(p, Rect2(Vector2.ZERO, map_size))

	Events.level_loaded.emit(index, data["title"])
	Events.combo_changed.emit(0, Game.best_combo, Game.score)
	if not _hint_shown:
		_hint_shown = true
		Events.toast.emit("WASD 移动 · 鼠标瞄准 · 左键攻击 · 右键扔武器 · E 换武器 · R 重开")
	else:
		Events.toast.emit(data["title"])
	hud.clear_center()

	if Game.enemies.is_empty():
		Game.level_cleared = true
		Events.enemies_cleared.emit()


func _on_level_cleared(index: int) -> void:
	if _transitioning:
		return
	_transitioning = true
	var token := _level_token
	Fx.hitstop(0.02)
	hud.show_center("区域完成", Color(0.7, 1.0, 0.78))
	await get_tree().create_timer(1.3).timeout
	# 这期间玩家可能按了 R 重开，那就别再切关了
	if token != _level_token:
		return

	if index + 1 < Levels.count():
		start_level(index + 1)
	else:
		_game_done = true
		hud.show_center("全部完成\n按 R 再来一遍", Color(1, 0.88, 0.5))
		Events.toast.emit("总分 %d · 最高连击 x%d" % [Game.score, Game.best_combo])


# ---------------------------------------------------------------- 输入
func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("restart"):
		restart_level()
		get_viewport().set_input_as_handled()
	elif event.is_action_pressed("pause"):
		var paused := not get_tree().paused
		get_tree().paused = paused
		hud.set_paused(paused)
		get_viewport().set_input_as_handled()
