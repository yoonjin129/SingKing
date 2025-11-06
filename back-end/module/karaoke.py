import pyaudio
import numpy as np
from scipy.signal import lfilter

# ===== 오디오 설정 =====
CHUNK = 512                   # 지연 줄이려면 512 권장 (1024도 가능)
FORMAT = pyaudio.paInt16
CHANNELS = 1
RATE = 44100

# ===== 리버브(피드백 딜레이) 파라미터 =====
REVERB_DECAY = 0.5            # 0.2~0.8 권장 (기존 3.8은 절대 안됨)
REVERB_DELAY = int(0.03 * RATE)  # 30ms

# 드라이/웨트 믹스 (0~1)
DRY_MIX = 0.7
WET_MIX = 0.3

# ===== IIR 피드백 딜레이 필터 계수 =====
# y[n] = x[n] + g * y[n-D]
# lfilter 계수는 b[0]=1, a[0]=1, a[D] = -g
b = np.zeros(REVERB_DELAY + 1, dtype=np.float32)
a = np.zeros(REVERB_DELAY + 1, dtype=np.float32)
b[0] = 1.0
a[0] = 1.0
a[REVERB_DELAY] = -REVERB_DECAY

# PyAudio
p = pyaudio.PyAudio()

stream_input = p.open(format=FORMAT,
                      channels=CHANNELS,
                      rate=RATE,
                      input=True,
                      frames_per_buffer=CHUNK)

stream_output = p.open(format=FORMAT,
                       channels=CHANNELS,
                       rate=RATE,
                       output=True,
                       frames_per_buffer=CHUNK)

print("실시간 리버브(피드백 딜레이) 시작. Ctrl+C로 종료.")

try:
    while True:
        # 마이크에서 읽기 (오버플로 경고 무시)
        data = stream_input.read(CHUNK, exception_on_overflow=False)

        # int16 → float32(-1~1)
        x = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0

        # 리버브(IIR 피드백 딜레이)
        y_reverb = lfilter(b, a, x)

        # 드라이/웨트 믹스
        y = DRY_MIX * x + WET_MIX * y_reverb

        # 클리핑 방지
        y = np.clip(y, -1.0, 1.0)

        # float32 → int16
        out = (y * 32767.0).astype(np.int16).tobytes()

        # 출력
        stream_output.write(out)
except KeyboardInterrupt:
    print("\n종료합니다.")
finally:
    stream_input.stop_stream()
    stream_input.close()
    stream_output.stop_stream()
    stream_output.close()
    p.terminate()
