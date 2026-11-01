extends Node
## 全局游戏状态：玩家引用、敌人名单、连击与计分、关卡索引。
## 这是唯一允许持有"当前世界"引用的地方，其他系统只从这里读。

const COMBO_WINDOW := 2.6          ## 连击维持时间（秒）
const SCORE_PER_KILL := 100        ## 每杀一人的基础分

var main: Node = null              ## 根节点（main.tscn）
var world: Node2D = null           ## 当前关卡的容器
var player = null                  ## Player 实例（弱类型，方便访问自定义属性）
var enemies: Array = []

var level_index := 0
var score := 0
var combo := 0
var best_combo := 0
var kills := 0
var level_cleared := false         ## 本关是否已清场

var _combo_timer := 0.0


func _process(delta: float) -> void:
	if combo > 0:
		_combo_timer -= delta
		if _combo_timer <= 0.0:
			combo = 0
			Events.combo_changed.emit(combo, best_combo, score)


# ---------------------------------------------------------------- 敌人登记
func register_enemy(e: Node) -> void:
	if not enemies.has(e):
		enemies.append(e)


func unregister_enemy(e: Node) -> void:
	enemies.erase(e)
	if enemies.is_empty() and not level_cleared:
		level_cleared = true
		Events.enemies_cleared.emit()


func alive_enemy_count() -> int:
	var n := 0
	for e in enemies:
		if is_instance_valid(e) and e.get("alive"):
			n += 1
	return n


# ---------------------------------------------------------------- 计分
func on_kill(pos: Vector2, weapon_name: String) -> void:
	kills += 1
	combo += 1
	_combo_timer = COMBO_WINDOW
	if combo > best_combo:
		best_combo = combo
	score += SCORE_PER_KILL * combo
	Events.enemy_killed.emit(pos, weapon_name)
	Events.combo_changed.emit(combo, best_combo, score)


func reset_combo() -> void:
	if combo != 0:
		combo = 0
		Events.combo_changed.emit(combo, best_combo, score)


## 重开一局（清分数与连击）
func reset_run() -> void:
	score = 0
	combo = 0
	best_combo = 0
	kills = 0
	_combo_timer = 0.0
	level_cleared = false
	enemies.clear()
	player = null
	Events.combo_changed.emit(combo, best_combo, score)


## 重载当前关（保留总分，只清本关状态）
func reset_level_state() -> void:
	combo = 0
	_combo_timer = 0.0
	level_cleared = false
	enemies.clear()
	player = null
	Events.combo_changed.emit(combo, best_combo, score)
