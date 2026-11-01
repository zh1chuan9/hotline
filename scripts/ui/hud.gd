extends CanvasLayer
## HUD：全代码搭建，没有 .tscn 依赖。中文用系统字体的回退链。

const VIEW_W := 640.0
const VIEW_H := 360.0

var _font: SystemFont
var _l_title: Label
var _l_score: Label
var _l_combo: Label
var _l_weapon: Label
var _l_center: Label
var _l_toast: Label
var _l_pause: Label

var _last_weapon := ""
var _toast_timer := 0.0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	layer = 10

	_font = SystemFont.new()
	_font.font_names = PackedStringArray([
		"Microsoft YaHei", "SimHei", "PingFang SC",
		"Noto Sans CJK SC", "Source Han Sans SC", "Arial Unicode MS",
	])

	_l_title = _make(Vector2(10, 6), Vector2(340, 18), 11, Color(0.82, 0.80, 0.88))
	_l_score = _make(Vector2(330, 4), Vector2(300, 24), 16, Color(1, 0.94, 0.72), HORIZONTAL_ALIGNMENT_RIGHT)
	_l_combo = _make(Vector2(330, 26), Vector2(300, 18), 12, Color(1, 0.6, 0.45), HORIZONTAL_ALIGNMENT_RIGHT)
	_l_weapon = _make(Vector2(10, VIEW_H - 26), Vector2(320, 20), 13, Color(0.92, 0.90, 0.96))
	_l_center = _make(Vector2(0, 128), Vector2(VIEW_W, 84), 24, Color(1, 1, 1), HORIZONTAL_ALIGNMENT_CENTER)
	_l_toast = _make(Vector2(0, 214), Vector2(VIEW_W, 22), 12, Color(0.86, 0.92, 1.0), HORIZONTAL_ALIGNMENT_CENTER)
	_l_pause = _make(Vector2(0, 150), Vector2(VIEW_W, 40), 22, Color(0.9, 0.9, 1.0), HORIZONTAL_ALIGNMENT_CENTER)
	_l_pause.text = ""

	Events.level_loaded.connect(_on_level_loaded)
	Events.combo_changed.connect(_on_combo_changed)
	Events.toast.connect(_on_toast)
	Events.player_died.connect(_on_player_died)
	Events.enemies_cleared.connect(_on_cleared)


func _make(pos: Vector2, size: Vector2, font_size: int, color: Color,
		align := HORIZONTAL_ALIGNMENT_LEFT) -> Label:
	var l := Label.new()
	l.position = pos
	l.size = size
	l.add_theme_font_override("font", _font)
	l.add_theme_font_size_override("font_size", font_size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.85))
	l.add_theme_constant_override("shadow_offset_x", 1)
	l.add_theme_constant_override("shadow_offset_y", 1)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.75))
	l.add_theme_constant_override("outline_size", 3)
	l.horizontal_alignment = align
	l.vertical_alignment = VERTICAL_ALIGNMENT_TOP
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(l)
	return l


func _process(delta: float) -> void:
	if _toast_timer > 0.0:
		_toast_timer -= delta
		if _toast_timer <= 0.0:
			_l_toast.text = ""
	_update_weapon()


func _update_weapon() -> void:
	var p = Game.player
	var txt := ""
	if p != null and is_instance_valid(p) and p.alive:
		if p.equipped == null:
			txt = "空手 —— 捡把家伙"
		else:
			txt = "%s   [%s]" % [p.equipped.data.display_name, p.equipped.ammo_text()]
	if txt != _last_weapon:
		_last_weapon = txt
		_l_weapon.text = txt


func _on_level_loaded(_index: int, title: String) -> void:
	_l_title.text = title
	_l_center.text = ""


func _on_combo_changed(combo: int, _best: int, score: int) -> void:
	_l_score.text = str(score)
	_l_combo.text = ("连击 x%d" % combo) if combo >= 2 else ""


func _on_toast(text: String) -> void:
	_l_toast.text = text
	_toast_timer = 2.4


func _on_player_died(_pos: Vector2) -> void:
	show_center("你倒下了\n按 R 重试", Color(1, 0.42, 0.40))


func _on_cleared() -> void:
	if _l_center.text == "":
		show_center("清场\n前往出口", Color(0.7, 1.0, 0.78))


func show_center(text: String, color := Color.WHITE) -> void:
	_l_center.text = text
	_l_center.add_theme_color_override("font_color", color)


func clear_center() -> void:
	_l_center.text = ""


func set_paused(paused: bool) -> void:
	_l_pause.text = "已暂停\n按 ESC 继续" if paused else ""
	if paused:
		_l_pause.add_theme_color_override("font_color", Color(0.92, 0.92, 1.0))
