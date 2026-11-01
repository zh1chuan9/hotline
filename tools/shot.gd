extends Node
## 出图用：加载 main.tscn，先让 5 个角色活着站一排（核对站姿），再逐个打死（核对尸体/血迹）。
## 用法：
##   Godot --path D:/Games/2.5d res://tools/shot.tscn --write-movie shots/f.png \
##         --fixed-fps 30 --quit-after 120
## 只用于截图核对画面（尸体、血迹、武器贴图），不参与游戏逻辑。

func _ready() -> void:
	var main: Node = load("res://scenes/main.tscn").instantiate()
	add_child(main)
	await get_tree().process_frame
	await get_tree().process_frame

	var p = Game.player
	if p == null:
		return
	p.set_process(false)
	p.set_physics_process(false)
	p.facing = Vector2.RIGHT
	p.equip(WeaponDB.pistol())

	# ---- 第一阶段：五个角色活着一字排开，朝四个方向，核对站姿
	var line := [Vector2(-58, -46), Vector2(-58, 8), Vector2(-58, 62), Vector2(52, -46)]
	var i := 0
	for e in Game.enemies.duplicate():
		if not is_instance_valid(e):
			continue
		if i >= line.size():
			break
		e.set_physics_process(false)
		e.set_process(false)
		e.global_position = p.global_position + line[i]
		e.facing = [Vector2.RIGHT, Vector2.UP, Vector2.DOWN, Vector2.LEFT][i]
		i += 1
	await get_tree().physics_frame
	await get_tree().create_timer(0.9).timeout

	# ---- 特写：把相机拉近，专门核对站姿（平时 zoom 2 看不清 32px 的细节）
	var cam: Camera2D = main.get_node("Camera")
	cam.set_process(false)
	cam.zoom = Vector2(5, 5)
	cam.global_position = p.global_position + Vector2(-30, 8)
	await get_tree().create_timer(0.8).timeout
	cam.zoom = Vector2(2, 2)
	cam.set_process(true)
	await get_tree().create_timer(0.2).timeout

	# ---- 第二阶段：摆到玩家右侧围成一圈，逐个打死
	var offsets := [Vector2(70, -44), Vector2(96, 6), Vector2(66, 46), Vector2(24, -70)]
	i = 0
	for e in Game.enemies.duplicate():
		if not is_instance_valid(e):
			continue
		e.global_position = p.global_position + offsets[i % offsets.size()]
		e.set_process(true)
		i += 1
	await get_tree().physics_frame

	var dirs := [Vector2.RIGHT, Vector2.UP, Vector2.DOWN, Vector2.LEFT]
	i = 0
	for e in Game.enemies.duplicate():
		if not is_instance_valid(e):
			continue
		e.kill(dirs[i % dirs.size()], "手枪")
		i += 1
	await get_tree().physics_frame

	# 留一具玩家的尸体在画面里（顺便验证玩家死亡表现）
	var px: Vector2 = p.global_position
	await get_tree().create_timer(0.35).timeout
	p.global_position = px + Vector2(-52, 18)
	p.kill(Vector2.LEFT, "测试")
	await get_tree().create_timer(2.0).timeout
