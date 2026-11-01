class_name FxUtil
extends RefCounted
## 一次性视觉特效工具：弹道、血溅、火花、地面贴花。
## 全部由代码现场生成，不需要为每种特效做场景。

const SPARK := preload("res://assets/sprites/spark.png")
const DOT := preload("res://assets/sprites/dot.png")
const RING := preload("res://assets/sprites/ring.png")
const SHADOW := preload("res://assets/sprites/shadow.png")
const BLOOD_TEX := [
	preload("res://assets/sprites/blood_1.png"),
	preload("res://assets/sprites/blood_2.png"),
	preload("res://assets/sprites/blood_3.png"),
	preload("res://assets/sprites/blood_4.png"),
]
const BLOOD_STREAK := [
	preload("res://assets/sprites/blood_streak_1.png"),
	preload("res://assets/sprites/blood_streak_2.png"),
]

const MAX_DECALS := 260      ## 地面贴花上限（血迹会一直留着，但总得有个上限）
const MAX_CORPSES := 40      ## 尸体上限，超了从最早的开始清


static func _world() -> Node2D:
	return Game.world


## 地面贴花的容器（自动创建，带数量上限）
static func _decal_root() -> Node2D:
	var w := _world()
	if w == null:
		return null
	var n := w.get_node_or_null("Decals") as Node2D
	if n == null:
		n = Node2D.new()
		n.name = "Decals"
		n.z_index = -5
		w.add_child(n)
	while n.get_child_count() > MAX_DECALS:
		var old := n.get_child(0)
		n.remove_child(old)
		old.queue_free()
	return n


## 尸体的容器：压在地面贴花之上、活人之下
static func _corpse_root() -> Node2D:
	var w := _world()
	if w == null:
		return null
	var n := w.get_node_or_null("Corpses") as Node2D
	if n == null:
		n = Node2D.new()
		n.name = "Corpses"
		n.z_index = 2
		w.add_child(n)
	while n.get_child_count() > MAX_CORPSES:
		var old := n.get_child(0)
		n.remove_child(old)
		old.queue_free()
	return n


## 子弹轨迹：一道很快消失的光
static func tracer(from: Vector2, to: Vector2, color := Color(1.0, 0.94, 0.68, 0.9)) -> void:
	var w := _world()
	if w == null:
		return
	var line := Line2D.new()
	line.width = 1.4
	line.default_color = color
	line.z_index = 18
	line.points = PackedVector2Array([from, to])
	w.add_child(line)
	var tw := line.create_tween()
	tw.tween_property(line, "modulate:a", 0.0, 0.1)
	tw.tween_callback(line.queue_free)


## 血溅：往受力方向飞的小血滴
static func blood_splat(pos: Vector2, dir: Vector2, count := 5, color := Color(0.66, 0.06, 0.11, 1.0)) -> void:
	var w := _world()
	if w == null:
		return
	for i in count:
		var s := Sprite2D.new()
		s.texture = DOT
		s.modulate = color
		s.z_index = 16
		s.scale = Vector2.ONE * randf_range(0.8, 2.0)
		w.add_child(s)
		s.global_position = pos
		var a := (dir.angle() if dir.length_squared() > 0.001 else randf() * TAU) + randf_range(-0.85, 0.85)
		var target := pos + Vector2.RIGHT.rotated(a) * randf_range(14.0, 46.0)
		var tw := s.create_tween()
		tw.set_parallel(true)
		tw.tween_property(s, "global_position", target, randf_range(0.16, 0.30))
		tw.tween_property(s, "modulate:a", 0.0, randf_range(0.28, 0.5))
		tw.chain().tween_callback(s.queue_free)


## 血雾：几团半透明的大血点，在命中瞬间膨胀并消失。
## 光有"小血滴"会像撒芝麻，加一层雾才有"喷出来"的体积。
static func blood_mist(pos: Vector2, dir: Vector2, count := 5) -> void:
	var w := _world()
	if w == null:
		return
	for i in count:
		var s := Sprite2D.new()
		s.texture = DOT
		s.modulate = Color(0.52, 0.04, 0.08, 0.55)
		s.z_index = 15
		var sc := randf_range(3.0, 7.0)
		s.scale = Vector2.ONE * sc * 0.35
		w.add_child(s)
		s.global_position = pos + dir * randf_range(-5.0, 5.0)
		var a := dir.angle() + randf_range(-0.6, 0.6)
		var target := pos + Vector2.RIGHT.rotated(a) * randf_range(12.0, 34.0)
		var tw := s.create_tween()
		tw.set_parallel(true)
		tw.tween_property(s, "global_position", target, randf_range(0.10, 0.20))
		tw.tween_property(s, "scale", Vector2.ONE * sc, randf_range(0.18, 0.30))
		tw.tween_property(s, "modulate:a", 0.0, randf_range(0.24, 0.42))
		tw.chain().tween_callback(s.queue_free)


## 命中冲击环：一圈白光瞬间扩散消失。打击感最便宜的单一元素。
static func impact_ring(pos: Vector2, scale_mul := 1.0) -> void:
	var w := _world()
	if w == null:
		return
	var s := Sprite2D.new()
	s.texture = RING
	s.z_index = 20
	s.global_position = pos
	s.scale = Vector2.ONE * 0.22 * scale_mul
	w.add_child(s)
	var tw := s.create_tween()
	tw.set_parallel(true)
	tw.tween_property(s, "scale", Vector2.ONE * 1.55 * scale_mul, 0.16)
	tw.tween_property(s, "modulate:a", 0.0, 0.18)
	tw.chain().tween_callback(s.queue_free)


## 击杀瞬间：一圈白光 + 一道朝弹道方向拖出的细长光带
static func impact_burst(pos: Vector2, dir: Vector2, power := 1.0) -> void:
	impact_ring(pos, power)
	var w := _world()
	if w == null:
		return
	var line := Line2D.new()
	line.width = 3.0 * power
	line.default_color = Color(1.0, 0.97, 0.9, 0.85)
	line.z_index = 20
	line.add_point(pos - dir.normalized() * 4.0)
	line.add_point(pos + dir.normalized() * 16.0 * power)
	w.add_child(line)
	var tw := line.create_tween()
	tw.set_parallel(true)
	tw.tween_property(line, "width", 0.0, 0.14)
	tw.tween_property(line, "modulate:a", 0.0, 0.14)
	tw.chain().tween_callback(line.queue_free)


## 火星：撞墙/开枪的火花
static func spark(pos: Vector2, dir: Vector2, count := 5) -> void:
	var w := _world()
	if w == null:
		return
	for i in count:
		var s := Sprite2D.new()
		s.texture = SPARK
		s.modulate = Color(1.0, 0.86, 0.45, 1.0)
		s.z_index = 17
		s.scale = Vector2.ONE * randf_range(0.4, 1.0)
		w.add_child(s)
		s.global_position = pos
		var a := dir.angle() + randf_range(-0.7, 0.7)
		var target := pos + Vector2.RIGHT.rotated(a) * randf_range(8.0, 26.0)
		var tw := s.create_tween()
		tw.set_parallel(true)
		tw.tween_property(s, "global_position", target, randf_range(0.08, 0.18))
		tw.tween_property(s, "modulate:a", 0.0, randf_range(0.1, 0.22))
		tw.chain().tween_callback(s.queue_free)


## 地面血迹（会永久留下，但有数量上限）
static func blood_decal(pos: Vector2, scale_mul := 1.0) -> void:
	var root := _decal_root()
	if root == null:
		return
	var s := Sprite2D.new()
	s.texture = BLOOD_TEX[randi() % BLOOD_TEX.size()]
	s.rotation = randf() * TAU
	s.scale = Vector2.ONE * randf_range(0.55, 1.1) * scale_mul
	s.modulate = Color(1, 1, 1, 0.9)
	root.add_child(s)
	s.global_position = pos


## 朝某个方向甩出去的血痕（贴地）
static func blood_streak(pos: Vector2, angle: float, scale_mul := 1.0) -> void:
	var root := _decal_root()
	if root == null:
		return
	var s := Sprite2D.new()
	s.texture = BLOOD_STREAK[randi() % BLOOD_STREAK.size()]
	s.rotation = angle + randf_range(-0.2, 0.2)
	s.scale = Vector2.ONE * randf_range(0.8, 1.25) * scale_mul
	s.modulate = Color(1, 1, 1, 0.92)
	root.add_child(s)
	s.global_position = pos


## 尸体：留在地上的贴图，不是把活人精灵转个角度了事
static func corpse(pos: Vector2, tex: Texture2D, angle: float) -> void:
	if tex == null:
		return
	var root := _corpse_root()
	if root == null:
		return
	# 尸体也需要影子，否则看起来像浮在地板上
	var sh := Sprite2D.new()
	sh.texture = SHADOW
	sh.z_index = 0
	sh.modulate = Color(1, 1, 1, 0.5)
	sh.scale = Vector2.ONE * 1.15
	root.add_child(sh)
	sh.global_position = pos + Vector2(2, 3)

	var s := Sprite2D.new()
	s.texture = tex
	s.z_index = 1
	s.rotation = angle + randf_range(-0.3, 0.3)
	root.add_child(s)
	s.global_position = pos
	# 摔下去的一点点挤压感
	s.scale = Vector2.ONE * 1.22
	var tw := s.create_tween()
	tw.tween_property(s, "scale", Vector2.ONE, 0.18).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)


## 死亡时一次性铺开：血雾 + 主血泊 + 沿弹道甩出去的一串血滩 + 侧向血痕。
## 关键不是"往地上丢一堆贴花"，而是让血沿着受力方向排成一条递减的线 ——
## 人眼看到的是"喷出去"，而不是"脚下一片红"。
static func blood_burst(pos: Vector2, dir: Vector2) -> void:
	var d := dir.normalized() if dir.length_squared() > 0.001 else Vector2.RIGHT
	var perp := d.orthogonal()

	# 1) 空中：血雾 + 沿弹道高速喷出的血滴 + 反向回落
	blood_mist(pos, d, 6)
	blood_splat(pos, d, 30)
	blood_splat(pos, -d * 0.8, 10, Color(0.40, 0.03, 0.06, 1.0))
	blood_splat(pos, perp, 7, Color(0.56, 0.05, 0.10, 1.0))
	blood_splat(pos, -perp, 7, Color(0.56, 0.05, 0.10, 1.0))

	# 2) 地面主血泊
	blood_decal(pos, 1.15)

	# 3) 沿受力方向排一串"渐远渐小"的血滩：这是"喷"的方向感来源
	for i in 4:
		var t := float(i) / 3.0
		var off := d * (9.0 + t * 30.0) + perp * randf_range(-8.0, 8.0)
		blood_decal(pos + off, lerpf(0.70, 0.26, t))

	# 4) 两侧随机小滩，防止看起来像一条直线
	for i in 5:
		var off := Vector2(randf_range(-1.0, 1.0), randf_range(-1.0, 1.0)) * randf_range(9.0, 19.0)
		blood_decal(pos + off, randf_range(0.3, 0.6))

	# 5) 两道甩痕：一前一后，方向一致才像同一个人的血
	blood_streak(pos + d * 13.0, d.angle(), 1.15)
	blood_streak(pos + perp * randf_range(8.0, 16.0) * (1.0 if randf() < 0.5 else -1.0),
			(d + perp).angle(), 0.7)


## 墙上弹孔
static func bullet_hole(pos: Vector2) -> void:
	var root := _decal_root()
	if root == null:
		return
	var s := Sprite2D.new()
	s.texture = DOT
	s.modulate = Color(0.15, 0.12, 0.14, 0.9)
	s.scale = Vector2.ONE * randf_range(0.5, 0.9)
	s.z_index = 2
	root.add_child(s)
	s.global_position = pos


## 近战挥击的弧光
static func slash_arc(origin: Vector2, dir: Vector2, reach: float, arc_deg: float,
		color := Color(1, 1, 1, 0.85)) -> void:
	var w := _world()
	if w == null:
		return
	var line := Line2D.new()
	line.width = 2.0
	line.default_color = color
	line.z_index = 19
	var pts := PackedVector2Array()
	var steps := 12
	var half := deg_to_rad(arc_deg * 0.5)
	for i in steps + 1:
		var a: float = -half + (2.0 * half) * float(i) / float(steps)
		pts.append(origin + dir.rotated(a) * reach)
	line.points = pts
	w.add_child(line)
	var tw := line.create_tween()
	tw.tween_property(line, "modulate:a", 0.0, 0.13)
	tw.tween_callback(line.queue_free)
