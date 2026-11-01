extends Node
## 程序合成音效：不依赖任何音频文件，直接用数学算出波形。
## 想换成真实音效时，把音效文件放进 assets/sfx/ 后，用 preload 替换 _build() 里的 _synth 调用即可，
## 其余调用代码一行都不用动。

const RATE := 22050
const POOL_SIZE := 16

var _streams: Dictionary = {}
var _players: Array[AudioStreamPlayer] = []
var _cursor := 0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for i in POOL_SIZE:
		var p := AudioStreamPlayer.new()
		p.process_mode = Node.PROCESS_MODE_ALWAYS
		add_child(p)
		_players.append(p)
	_build()


func play(id: String, pitch := 1.0, vol_db := 0.0) -> void:
	if not _streams.has(id) or _players.is_empty():
		return
	var p := _players[_cursor]
	_cursor = (_cursor + 1) % _players.size()
	p.stream = _streams[id]
	p.pitch_scale = clampf(pitch * randf_range(0.95, 1.06), 0.3, 3.0)
	p.volume_db = vol_db
	p.play()


# ---------------------------------------------------------------- 合成
func _build() -> void:
	_streams["shoot"] = _synth(0.17, 28.0, 0.85, 85.0, 0.55, 0.55, 0.55)
	_streams["shotgun"] = _synth(0.32, 15.0, 0.95, 58.0, 0.65, 0.40, 0.70)
	_streams["swing"] = _synth(0.15, 20.0, 0.85, 240.0, 0.15, 0.16, 0.45)
	_streams["hit"] = _synth(0.15, 34.0, 0.55, 62.0, 0.95, 0.30, 0.75)
	_streams["die"] = _synth(0.48, 7.0, 0.35, 138.0, 0.85, 0.55, 0.55)
	_streams["pickup"] = _synth(0.10, 14.0, 0.06, 920.0, 0.95, 0.95, 0.45)
	_streams["door"] = _synth(0.34, 9.0, 0.75, 46.0, 0.55, 0.12, 0.55)
	_streams["empty"] = _synth(0.07, 55.0, 0.55, 1150.0, 0.45, 1.00, 0.35)
	_streams["step"] = _synth(0.07, 48.0, 0.70, 95.0, 0.25, 0.25, 0.22)
	_streams["throw"] = _synth(0.13, 22.0, 0.70, 320.0, 0.20, 0.30, 0.40)
	_streams["death"] = _synth(0.90, 3.2, 0.30, 96.0, 0.90, 0.50, 0.60)
	_streams["clear"] = _synth(0.55, 5.0, 0.10, 660.0, 0.90, 0.95, 0.50)


## seconds: 时长 / decay: 衰减速度 / noise_mix: 噪声占比 / tone_hz: 音高
## tone_mix: 音调占比 / lp: 低通系数(越小越闷) / gain: 总音量
func _synth(seconds: float, decay: float, noise_mix: float, tone_hz: float,
		tone_mix: float, lp: float, gain: float) -> AudioStreamWAV:
	var n := int(RATE * seconds)
	var buf := PackedFloat32Array()
	buf.resize(n)
	var rng := RandomNumberGenerator.new()
	rng.seed = int(seconds * 10000.0) + int(tone_hz)
	var filtered := 0.0
	for i in n:
		var t := float(i) / float(RATE)
		var env: float = exp(-t * decay)
		var w: float = rng.randf_range(-1.0, 1.0)
		filtered += (w - filtered) * clampf(lp, 0.01, 1.0)
		var tone: float = sin(TAU * tone_hz * t)
		buf[i] = clampf((filtered * noise_mix + tone * tone_mix) * env * gain, -1.0, 1.0)
	return _to_wav(buf)


func _to_wav(buf: PackedFloat32Array) -> AudioStreamWAV:
	var n := buf.size()
	var bytes := PackedByteArray()
	bytes.resize(n * 2)
	for i in n:
		var v: float = clampf(buf[i], -1.0, 1.0)
		bytes.encode_s16(i * 2, int(v * 30000.0))
	var s := AudioStreamWAV.new()
	s.format = AudioStreamWAV.FORMAT_16_BITS
	s.mix_rate = RATE
	s.stereo = false
	s.data = bytes
	return s
