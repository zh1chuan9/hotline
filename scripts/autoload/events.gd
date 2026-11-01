extends Node
## 全局信号总线。
## 所有跨系统通信都走这里：角色不知道关卡存在，关卡不知道 UI 存在。
## 想加新玩法时，优先在这里加信号，而不是让节点互相找对方。

## 某个东西发出了声音（枪声、开门、脚步）。敌人监听这个来决定去哪查看。
signal noise_emitted(pos: Vector2, radius: float)
## 玩家死亡（用于镜头、慢动作、UI）
signal player_died(pos: Vector2)
## 敌人被击杀
signal enemy_killed(pos: Vector2, weapon_name: String)
## 本关敌人清空
signal enemies_cleared
## 关卡加载完成
signal level_loaded(index: int, title: String)
## 关卡通关（走进出口）
signal level_cleared(index: int)
## 连击变化
signal combo_changed(combo: int, best: int, score: int)
## 屏幕震动请求
signal shake_requested(amount: float, duration: float)
## 命中冲击：镜头沿 [param dir] 的反方向踢一下再弹回。dir 是弹道/挥击方向。
signal impact_requested(pos: Vector2, dir: Vector2, power: float)
## 镜头瞬时拉近（kill 的"顶一下"，不要用于普通命中，会晕）
signal zoom_punch_requested(amount: float, duration: float)
## 短暂顿帧请求
signal hitstop_requested(duration: float)
## UI 飘字
signal toast(text: String)


## 兜底：如果 project.godot 里的输入映射没被读到（比如手动改坏了），
## 这里会按下面的表补齐，保证游戏一定能操作。
func _ready() -> void:
	_bind("move_left", [KEY_A, KEY_LEFT])
	_bind("move_right", [KEY_D, KEY_RIGHT])
	_bind("move_up", [KEY_W, KEY_UP])
	_bind("move_down", [KEY_S, KEY_DOWN])
	_bind("fire", [KEY_J])
	_bind("throw", [KEY_SPACE])
	_bind("pickup", [KEY_E])
	_bind("restart", [KEY_R])
	_bind("pause", [KEY_ESCAPE])
	_bind_mouse("fire", MOUSE_BUTTON_LEFT)
	_bind_mouse("throw", MOUSE_BUTTON_RIGHT)


func _bind(action: String, keys: Array) -> void:
	if not InputMap.has_action(action):
		InputMap.add_action(action)
	var existing := InputMap.action_get_events(action)
	for k in keys:
		var found := false
		for e in existing:
			if e is InputEventKey and e.physical_keycode == k:
				found = true
				break
		if not found:
			var ev := InputEventKey.new()
			ev.physical_keycode = k
			InputMap.action_add_event(action, ev)


func _bind_mouse(action: String, button: int) -> void:
	if not InputMap.has_action(action):
		InputMap.add_action(action)
	var existing := InputMap.action_get_events(action)
	for e in existing:
		if e is InputEventMouseButton and e.button_index == button:
			return
	var ev := InputEventMouseButton.new()
	ev.button_index = button
	InputMap.action_add_event(action, ev)
