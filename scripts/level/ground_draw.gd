class_name GroundDraw
extends Node2D
## 把地板和墙一次性画出来。用 _draw 而不是几百个 Sprite 节点，省节点也省心。

const FLOOR_A := preload("res://assets/sprites/floor.png")
const FLOOR_B := preload("res://assets/sprites/floor2.png")
const WALL := preload("res://assets/sprites/wall.png")

var floor_rects: Array[Rect2] = []
var floor_rects_b: Array[Rect2] = []
var wall_rects: Array[Rect2] = []


func _draw() -> void:
	for r in floor_rects:
		draw_texture_rect(FLOOR_A, r, false)
	for r in floor_rects_b:
		draw_texture_rect(FLOOR_B, r, false)
	for r in wall_rects:
		draw_texture_rect(WALL, r, false)
