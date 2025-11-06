import os
import numpy as np
import librosa
import matplotlib.pyplot as plt
from pydub import AudioSegment

# 그래프에서 한국어 폰트 설정
plt.rcParams['font.family'] = 'Malgun Gothic'

# -----------------------------
# 유틸
# -----------------------------
def _clamp(v, lo, hi):
    return max(lo, min(hi, v))

def _ensure_mono(y):
    # (n,) or (2,n) 형태 대비
    if y.ndim == 2:
        return np.mean(y, axis=0)
    return y

# -----------------------------
# 오디오 로드
# -----------------------------
def load_audio(audio_path, sr=None):
    """
    sr=None: 원 샘플레이트 유지(권장)
    """
    y, sr = librosa.load(audio_path, sr=sr, mono=True)
    y = _ensure_mono(y)
    # 긴 무음에 온셋이 낚이지 않게 살짝 트림
    y, _ = librosa.effects.trim(y, top_db=40)
    return y, sr

# -----------------------------
# 온셋 추출
# -----------------------------
def extract_onsets(y, sr, hop_length=512, backtrack=True):
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop_length)
    onsets = librosa.onset.onset_detect(
        onset_envelope=onset_env,
        sr=sr,
        hop_length=hop_length,
        units='time',
        backtrack=backtrack,        # transient 앞쪽으로 보정
        pre_max=20, post_max=20,
        pre_avg=100, post_avg=100,
        delta=0.0, wait=0
    )
    return onsets, onset_env

# -----------------------------
# 온셋 시퀀스 정렬(DTW) + 비교
# -----------------------------
def compare_onsets(onsets_original, onsets_cover, threshold=0.1, use_dtw=True):
    """
    반환:
      differences: 각 원본 온셋과 정렬된 커버 온셋의 시간차(cover - orig)
      diff_status: 'good' | 'early' | 'late' | 'bad'
      score: {'good', 'bad', 'accuracy'}
    """
    differences = []
    diff_status = []

    if len(onsets_original) == 0:
        # 원본 온셋이 0이면 정확도를 정의하기 어려우니 0 처리
        return [], [], {'good': 0, 'bad': 0, 'accuracy': 0.0}

    if len(onsets_cover) == 0:
        # 커버 온셋이 아예 없으면 모두 bad
        differences = [threshold + 1.0] * len(onsets_original)
        diff_status = ['bad'] * len(onsets_original)
    else:
        if use_dtw:
            # DTW로 원본-커버 온셋 정렬(시간 차이 비용)
            # (T1, 1) vs (T2, 1)로 만들어 L2거리 비용행렬 생성
            O = onsets_original.reshape(-1, 1)
            C = onsets_cover.reshape(-1, 1)
            # L2 거리
            cost = np.abs(O - C.T)
            # librosa.sequence.dtw는 음수 index 주의. 비용행렬로 바로 DTW
            wp = librosa.sequence.dtw(C=cost)[0]  # warping path (idx in rows, cols)
            # wp는 (i,j) 뒤에서 앞으로 옴 → 정방향 정렬
            wp = wp[::-1]

            # 각 원본 인덱스(i)에 대해 가장 가까운 j(커버) 매칭 하나 택
            # (여러 번 매칭될 수도 있어 가장 작은 cost만 유지)
            best_for_i = {}
            for i, j in wp:
                d = onsets_cover[j] - onsets_original[i]
                if (i not in best_for_i) or (abs(d) < abs(best_for_i[i])):
                    best_for_i[i] = d

            for i in range(len(onsets_original)):
                if i in best_for_i:
                    d = best_for_i[i]
                    differences.append(d)
                    if abs(d) <= threshold:
                        diff_status.append('good')
                    else:
                        diff_status.append('late' if d > 0 else 'early')
                else:
                    # DTW 경로에 없으면 bad
                    differences.append(threshold + 1.0)
                    diff_status.append('bad')
        else:
            # 가장 가까운 커버 온셋 매칭(단순 그리디)
            cover_list = list(onsets_cover)
            for onset in onsets_original:
                if not cover_list:
                    differences.append(threshold + 1.0)
                    diff_status.append('bad')
                    continue
                j = np.argmin(np.abs(np.array(cover_list) - onset))
                d = cover_list[j] - onset
                del cover_list[j]
                differences.append(d)
                if abs(d) <= threshold:
                    diff_status.append('good')
                else:
                    diff_status.append('late' if d > 0 else 'early')

    good_count = sum(1 for d in differences if abs(d) <= threshold)
    bad_count = len(differences) - good_count
    accuracy = (good_count / len(differences) * 100.0) if len(differences) else 0.0

    score = {'good': good_count, 'bad': bad_count, 'accuracy': accuracy}
    return differences, diff_status, score

# -----------------------------
# 음절 경계(온셋 기반)
# -----------------------------
def extract_syllable_boundaries(y, sr, onsets_time, min_dur=0.04):
    """
    온셋 시각을 경계로 [onset_i, onset_{i+1}] 구간을 생성.
    마지막은 트랙 끝까지.
    """
    duration = len(y) / sr
    if len(onsets_time) == 0:
        return [(0.0, duration)]

    # 경계 리스트
    segs = []
    times = np.clip(onsets_time, 0.0, duration)
    # 시작~첫 온셋 구간
    if times[0] > 0.0:
        segs.append((0.0, float(times[0])))
    # 온셋 사이 구간
    for a, b in zip(times[:-1], times[1:]):
        if (b - a) >= min_dur:
            segs.append((float(a), float(b)))
    # 마지막~끝
    if duration - times[-1] >= min_dur:
        segs.append((float(times[-1]), float(duration)))

    # 최소 길이 필터
    segs = [(s, e) for (s, e) in segs if (e - s) >= min_dur]
    return segs

# -----------------------------
# 틀린 구간 병합
# -----------------------------
def merge_bad_segments(syllable_boundaries, onsets_original, diff_status, merge_tolerance=0.5):
    bad_segments = []
    current = None

    onset_bad = set(i for i, st in enumerate(diff_status) if st in ('bad', 'early', 'late'))
    # 각 음절 경계에 원본 온셋이 들어오고 그 온셋이 bad면 해당 구간 bad로 표시
    for (start, end) in syllable_boundaries:
        has_bad = False
        for idx, onset in enumerate(onsets_original):
            if idx in onset_bad and (start <= onset <= end):
                has_bad = True
                break

        if has_bad:
            if current is None:
                current = [start, end]
            else:
                # 인접/겹치면 병합
                if start - current[1] <= merge_tolerance:
                    current[1] = end
                else:
                    bad_segments.append(tuple(current))
                    current = [start, end]
        else:
            if current is not None:
                bad_segments.append(tuple(current))
                current = None

    if current is not None:
        bad_segments.append(tuple(current))

    # 2차 병합(혹시 남아 있으면)
    merged = []
    for seg in sorted(bad_segments):
        if not merged:
            merged.append(list(seg))
        else:
            prev = merged[-1]
            if seg[0] - prev[1] <= merge_tolerance:
                prev[1] = max(prev[1], seg[1])
            else:
                merged.append(list(seg))
    return [tuple(x) for x in merged]

# -----------------------------
# 잘못된 구간 저장
# -----------------------------
def save_bad_segments(audio_path, bad_segments, output_dir, output_prefix, padding=3.0):
    os.makedirs(output_dir, exist_ok=True)
    audio = AudioSegment.from_wav(audio_path)
    L = len(audio)  # ms

    for i, (start, end) in enumerate(bad_segments):
        # 앞쪽은 살짝 덜, 뒤쪽은 넉넉히(원 코드 스타일을 존중)
        start_ms = int(_clamp((start - (padding - 1.25)) * 1000.0, 0, L))
        end_ms   = int(_clamp((end   +  padding)        * 1000.0, 0, L))
        if end_ms <= start_ms:
            continue
        segment = audio[start_ms:end_ms]
        out = os.path.join(output_dir, f"{output_prefix}_bad_segment_{i+1}.wav")
        segment.export(out, format="wav")

# -----------------------------
# 시각화
# -----------------------------
def plot_onset_differences(y_original, sr_original, onsets_original, bad_segments, diff_status):
    plt.figure(figsize=(15, 5))
    t = np.linspace(0, len(y_original) / sr_original, num=len(y_original))
    plt.plot(t, y_original, label='원본 음원', alpha=0.6)

    # 틀린 구간 음영
    first = True
    for s, e in bad_segments:
        plt.axvspan(s, e, color='red', alpha=0.35, label='차이 나는 부분' if first else "")
        first = False

    # 틀린 온셋만 표시
    early_plotted = False
    late_plotted = False
    for onset, st in zip(onsets_original, diff_status):
        if st == 'early':
            plt.axvline(onset, color='green', linestyle='--',
                        label='early 박자' if not early_plotted else "")
            early_plotted = True
        elif st == 'late':
            plt.axvline(onset, color='orange', linestyle='--',
                        label='late 박자' if not late_plotted else "")
            late_plotted = True

    plt.xlabel('시간 (초)')
    plt.ylabel('진폭')
    plt.title('원본 파형 & 온셋 차이(틀린 구간 강조)')
    plt.legend()
    plt.grid(True)
    plt.tight_layout()
    plt.show()

# -----------------------------
# 메인: 점수화 파이프라인
# -----------------------------
def score_cover(original_audio_path, cover_audio_path, threshold=0.1, merge_tolerance=0.5, use_dtw=True):
    # 파일 존재 체크
    if not os.path.exists(original_audio_path):
        raise FileNotFoundError(f"원본 오디오 파일이 없습니다: {original_audio_path}")
    if not os.path.exists(cover_audio_path):
        raise FileNotFoundError(f"커버 오디오 파일이 없습니다: {cover_audio_path}")

    # 로드
    y_orig, sr_orig = load_audio(original_audio_path, sr=None)
    y_cov,  sr_cov  = load_audio(cover_audio_path,   sr=None)

    # 온셋 추출
    onsets_orig, _ = extract_onsets(y_orig, sr_orig)
    onsets_cov,  _ = extract_onsets(y_cov,  sr_cov)

    # 비교
    differences, diff_status, score = compare_onsets(
        onsets_orig, onsets_cov, threshold=threshold, use_dtw=use_dtw
    )

    # 음절 경계(온셋 기반)
    syllable_boundaries = extract_syllable_boundaries(y_orig, sr_orig, onsets_orig)

    # 틀린 구간 병합
    bad_segments = merge_bad_segments(
        syllable_boundaries, onsets_orig, diff_status, merge_tolerance=merge_tolerance
    )

    # 시각화
    if len(y_orig) > 0:
        plot_onset_differences(y_orig, sr_orig, onsets_orig, bad_segments, diff_status)

    # 구간 저장
    save_bad_segments(original_audio_path, bad_segments, "original_bad_segments", "original")
    save_bad_segments(cover_audio_path,     bad_segments, "cover_bad_segments",    "cover")

    # 로그
    if bad_segments:
        print("Detected bad segments (with padding):")
        for s, e in bad_segments:
            print(f"Start: {s:.2f} s, End: {e:.2f} s")
    else:
        print("No bad segments detected.")

    # 틀린 온셋만 상태 로그
    for onset, st in zip(onsets_orig, diff_status):
        if st in ('early', 'late'):
            print(f"Onset at {onset:.2f} s is {st}")

    return score

# -----------------------------
# 사용 예
# -----------------------------
if __name__ == "__main__":
    title = '장범준-흔들리는 꽃들 속에서 네 샴푸향이 느껴진거야'
    original_audio_path = f'back-end/assets/audio/artist/test/{title}.wav'
    cover_audio_path    = f'back-end/assets/audio/user/{title}.wav'
    threshold = 0.2
    merge_tolerance = 0.6

    score = score_cover(
        original_audio_path,
        cover_audio_path,
        threshold=0.2,
        merge_tolerance=0.6,
        use_dtw=True
    )
    print(score)
