extends Node
## 屏幕级反馈：顿帧、慢动作、震动、方向冲击转发。
## 手感的一大半来自这里 —— 打击感靠 hitstop，死亡靠 slowmo，开枪靠 shake。

## 顿帧的"冻结倍率"。0.03 几乎是静止，但还能看到一点点变化，比 0.0 更自然。
const STOP_SCALE := 0.03
const STOP_STEP := 0.016

var _stop_left := 0.0     ## 还剩多少秒顿帧（可叠加，连续命中不会互相吞掉）
var _stop_running := false
var _slowmo := false


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS


## 屏幕震动
func shake(amount: float, duration := 0.18) -> void:
	Events.shake_requested.emit(amount, duration)


## 方向冲击：镜头往弹道的反方向被"顶"一下
func impact(dir: Vector2, power := 1.0) -> void:
	Events.impact_requested.emit(Vector2.ZERO, dir, power)


## 镜头瞬时拉近（只在击杀时用）
func zoom_punch(amount := 0.1) -> void:
	Events.zoom_punch_requested.emit(amount, 0.16)


## 顿帧：极致短暂地几乎冻结时间，让命中"钉"住一瞬。
## 这里刻意做成可叠加 —— 用 `_busy` 直接 return 的话，连喷霰弹只有第一颗
## 有顿帧，后面全是软的，那正是"打击感弱"最典型的来源。
func hitstop(duration := 0.045) -> void:
	if _slowmo:
		return
	_stop_left = maxf(_stop_left, duration)
	if _stop_running:
		return
	_stop_running = true
	Engine.time_scale = STOP_SCALE
	while _stop_left > 0.0:
		# ignore_time_scale = true，否则 time_scale 被改小后计时器自己也会变慢
		await get_tree().create_timer(STOP_STEP, true, false, true).timeout
		_stop_left -= STOP_STEP
	Engine.time_scale = 1.0
	_stop_left = 0.0
	_stop_running = false


## 击杀的"重击"：比普通命中更长的顿帧 + 方向冲击 + 镜头顶一下 + 震动。
## 一处调用把五种反馈绑在一起，避免每个调用点各写一遍、数值还不统一。
func kill_feedback(dir: Vector2, power := 1.0) -> void:
	hitstop(0.075 * power)
	impact(dir, 5.0 * power)
	zoom_punch(0.09 * power)
	shake(3.4 * power, 0.2)


## 慢动作：玩家阵亡 / 通关时用
func slowmo(scale := 0.3, duration := 0.7) -> void:
	if _slowmo:
		return
	_stop_left = 0.0
	_slowmo = true
	Engine.time_scale = scale
	await get_tree().create_timer(duration, true, false, true).timeout
	# 用不受 time_scale 影响的计时器做平滑恢复，避免硬切回 1.0
	var steps := 10
	for i in steps:
		Engine.time_scale = lerpf(scale, 1.0, float(i) / float(steps))
		await get_tree().create_timer(0.018, true, false, true).timeout
	Engine.time_scale = 1.0
	_slowmo = false


func clear_time_effects() -> void:
	_stop_left = 0.0
	_stop_running = false
	_slowmo = false
	Engine.time_scale = 1.0
