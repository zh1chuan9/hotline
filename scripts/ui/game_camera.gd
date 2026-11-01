extends Camera2D
## 相机：跟随玩家，并朝鼠标方向偏移一点 —— 让你看得见要打的方向。
## 同时负责屏幕震动、方向冲击（被子弹顶回来）、击杀时的瞬时拉近。

const BASE_ZOOM := 2.0

var target: Node2D = null

var _bounds := Rect2()
var _shake := 0.0
var _punch := Vector2.ZERO     ## 方向冲击位移，快速回弹
var _zoom_bump := 0.0          ## 击杀时的临时拉近量
var _look := Vector2.ZERO


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_PAUSABLE
	zoom = Vector2(BASE_ZOOM, BASE_ZOOM)
	position_smoothing_enabled = false
	Events.shake_requested.connect(_on_shake_requested)
	Events.impact_requested.connect(_on_impact_requested)
	Events.zoom_punch_requested.connect(_on_zoom_punch)


func setup(t: Node2D, bounds: Rect2) -> void:
	target = t
	_bounds = bounds
	if t != null:
		global_position = t.global_position


func _on_shake_requested(amount: float, _duration: float) -> void:
	_shake = maxf(_shake, amount)


## 方向冲击：镜头被"顶"向弹道的反方向，然后弹回
func _on_impact_requested(_pos: Vector2, dir: Vector2, power: float) -> void:
	if dir.length_squared() < 0.0001 or power <= 0.0:
		return
	_punch -= dir.normalized() * power


func _on_zoom_punch(amount: float, _duration: float) -> void:
	_zoom_bump = maxf(_zoom_bump, amount)


func _process(delta: float) -> void:
	# 冲击回弹和拉近恢复：和 target 无关，玩家死了也要继续收尾
	_punch = _punch.lerp(Vector2.ZERO, 1.0 - pow(0.0000001, delta))
	_zoom_bump = move_toward(_zoom_bump, 0.0, delta * 1.2)
	var z := BASE_ZOOM * (1.0 + _zoom_bump)
	if not is_equal_approx(zoom.x, z):
		zoom = Vector2(z, z)

	if target == null or not is_instance_valid(target):
		offset = _punch
		return

	# 朝鼠标偏移，让视线更靠前
	var desired_look := (get_global_mouse_position() - target.global_position) * 0.16
	desired_look = desired_look.limit_length(48.0)
	_look = _look.lerp(desired_look, 1.0 - pow(0.002, delta))

	var desired := target.global_position + _look

	# 限制在地图内
	var view := get_viewport_rect().size * 0.5 / zoom
	if _bounds.size.x > view.x * 2.0:
		desired.x = clampf(desired.x, _bounds.position.x + view.x, _bounds.end.x - view.x)
	if _bounds.size.y > view.y * 2.0:
		desired.y = clampf(desired.y, _bounds.position.y + view.y, _bounds.end.y - view.y)

	global_position = global_position.lerp(desired, 1.0 - pow(0.00005, delta))

	# 震动：衰减要比以前慢很多。原来每秒衰减 100+，6 的震动 0.05 秒就没了，
	# 玩家根本来不及"感觉"到，这是打击感弱的隐藏原因之一。
	var shake_off := Vector2.ZERO
	if _shake > 0.05:
		shake_off = Vector2(randf_range(-1.0, 1.0), randf_range(-1.0, 1.0)) * _shake
		_shake = move_toward(_shake, 0.0, delta * (_shake * 3.0 + 8.0))
	else:
		_shake = 0.0
	offset = shake_off + _punch
