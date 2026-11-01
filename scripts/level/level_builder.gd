class_name LevelBuilder
extends RefCounted
## 把 ASCII 地图变成真实的场景节点：地板、墙碰撞、门、敌人、武器、出口。
##
## 一个格子 = TILE 像素。想加新的地图符号，就在这里加一个分支。

const TILE := Levels.TILE


static func build(rows: Array, world: Node2D) -> Dictionary:
	var h := rows.size()
	var w := 0
	for r in rows:
		w = maxi(w, (r as String).length())

	var ground := GroundDraw.new()
	ground.name = "Ground"
	ground.z_index = -10
	world.add_child(ground)

	var walls := StaticBody2D.new()
	walls.name = "Walls"
	walls.collision_layer = 1
	walls.collision_mask = 0
	world.add_child(walls)

	var spawn := Vector2.ZERO
	var exit_pos := Vector2.ZERO
	var has_exit := false
	var enemy_specs: Array = []
	var weapon_specs: Array = []
	var door_positions: Array = []

	for y in h:
		var row: String = rows[y]
		for x in w:
			var ch := " "
			if x < row.length():
				ch = row[x]
			if ch == " ":
				continue

			var rect := Rect2(x * TILE, y * TILE, TILE, TILE)
			var center := rect.get_center()

			if ch == "#":
				ground.wall_rects.append(rect)
				continue

			# 其余都是可以站人的格子，先铺地板
			if (x * 3 + y * 5) % 11 == 0:
				ground.floor_rects_b.append(rect)
			else:
				ground.floor_rects.append(rect)

			match ch:
				"P":
					spawn = center
				"X":
					exit_pos = center
					has_exit = true
				"E":
					enemy_specs.append({"type": "melee", "pos": center})
				"G":
					enemy_specs.append({"type": "gun", "pos": center})
				"S":
					enemy_specs.append({"type": "shotgun", "pos": center})
				"1", "2", "B", "K":
					weapon_specs.append({"code": ch, "pos": center})
				"D":
					door_positions.append(center)

	# 墙碰撞：按行合并连续的墙，减少碰撞形状数量
	for rect in _merge_horizontal(ground.wall_rects):
		var shape := CollisionShape2D.new()
		var box := RectangleShape2D.new()
		box.size = rect.size
		shape.shape = box
		shape.position = rect.get_center()
		walls.add_child(shape)

	# 门
	for pos in door_positions:
		var d := Door.new()
		d.name = "Door"
		world.add_child(d)
		d.global_position = pos

	# 敌人
	var enemies: Array = []
	for spec in enemy_specs:
		var e := Enemy.new()
		e.enemy_type = spec["type"]
		world.add_child(e)
		e.global_position = spec["pos"]
		e.on_spawned()
		enemies.append(e)

	# 地上的武器
	for spec in weapon_specs:
		var data := WeaponDB.from_code(spec["code"])
		if data != null:
			Pickup.spawn(data, spec["pos"])

	# 出口
	if has_exit:
		var ex := ExitZone.new()
		ex.name = "Exit"
		world.add_child(ex)
		ex.global_position = exit_pos

	ground.queue_redraw()

	return {
		"spawn": spawn,
		"size": Vector2(w * TILE, h * TILE),
		"enemy_count": enemies.size(),
	}


## 把同一行里连续的墙格合并成一个长条矩形
static func _merge_horizontal(rects: Array) -> Array[Rect2]:
	var out: Array[Rect2] = []
	var by_row := {}
	for r in rects:
		var key := int(r.position.y)
		if not by_row.has(key):
			by_row[key] = []
		by_row[key].append(r)

	for key in by_row:
		var line: Array = by_row[key]
		line.sort_custom(func(a, b): return a.position.x < b.position.x)
		var cur: Rect2 = line[0]
		for i in range(1, line.size()):
			var r: Rect2 = line[i]
			if is_equal_approx(r.position.x, cur.position.x + cur.size.x):
				cur.size.x += r.size.x
			else:
				out.append(cur)
				cur = r
		out.append(cur)
	return out
