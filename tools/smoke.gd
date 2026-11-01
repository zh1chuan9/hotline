extends Node
## 冒烟测试：加载 main.tscn，验证生成、开火击杀、清场、出口通关。
## 用法：Godot --path D:/Games/2.5d res://tools/smoke.tscn

var _fails := 0

func _ready() -> void:
	var main: Node = load("res://scenes/main.tscn").instantiate()
	add_child(main)
	await get_tree().process_frame
	await get_tree().process_frame

	_check("关卡已加载", Game.world != null and Game.world.get_child_count() > 0)
	var enemy_n: int = Game.enemies.size()
	_check("敌人生成 (%d 只)" % enemy_n, enemy_n > 0)

	var p = Game.player
	_check("玩家存在", p != null)
	_check("玩家在 actors 组", p.is_in_group("actors"))
	_check("玩家碰撞层 = 2", p.collision_layer == 2)

	# --- 拾取：地上放一把霰弹枪，空手走过去应自动捡起 ---
	p.set_physics_process(false)   # 停住玩家，避免它自己走开
	p.process_mode = Node.PROCESS_MODE_ALWAYS
	var probe: Pickup = Pickup.spawn(WeaponDB.shotgun(), p.global_position)
	await get_tree().physics_frame
	await get_tree().physics_frame
	_check("走到武器上能自动拾取", p.equipped != null)

	# 给玩家一把手枪，朝第一个敌人连开
	p.equip(WeaponDB.pistol())
	await get_tree().physics_frame
	_check("武器已装备", p.equipped != null and p.equipped.ammo > 0)

	var target = Game.enemies[0] if enemy_n > 0 else null
	if target != null:
		# 关掉玩家的 _process，否则它每帧按鼠标（0,0）改写 facing，子弹会朝左上飞
		p.set_process(false)
		p.set_physics_process(false)
		var before: int = Game.enemies.size()
		p.global_position = target.global_position + Vector2(-40, 0)
		p.facing = Vector2.RIGHT
		await get_tree().physics_frame
		for i in 12:
			p.equipped.cooldown = 0.0
			p.equipped.try_attack()
			await get_tree().physics_frame
			if not is_instance_valid(target) or not target.alive:
				break
		_check("开枪能击杀敌人", not is_instance_valid(target) or not target.alive)
		_check("击杀后计数下降 (%d -> %d)" % [before, Game.enemies.size()], Game.enemies.size() < before)

	# 清空所有敌人，检查清场与出口
	for e in Game.enemies.duplicate():
		if is_instance_valid(e):
			e.kill(Vector2.RIGHT, "测试")
	await get_tree().process_frame
	await get_tree().process_frame
	_check("清场后标记 level_cleared", Game.level_cleared)

	# --- 出口：清场后走进出口应推进到下一关 ---
	var exit_node: ExitZone = null
	for c in Game.world.get_children():
		if c is ExitZone:
			exit_node = c
			break
	_check("存在出口", exit_node != null)
	if exit_node != null:
		_check("清场后出口激活", exit_node.active)
		p.global_position = exit_node.global_position
		await get_tree().physics_frame
		await get_tree().physics_frame
		await get_tree().create_timer(2.0).timeout
		_check("走进出口进入第 2 关 (当前 index=%d)" % Game.level_index, Game.level_index == 1)

	print("\n==== 冒烟测试结果：%s ====" % ("全部通过" if _fails == 0 else "%d 项失败" % _fails))
	get_tree().quit(0 if _fails == 0 else 1)


func _check(label: String, ok: bool) -> void:
	print(("  [OK]   " if ok else "  [FAIL] ") + label)
	if not ok:
		_fails += 1
