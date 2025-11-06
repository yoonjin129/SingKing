# module/vocal_analysis.py
import os
import re
import json
import urllib
import requests
import numpy as np
import pandas as pd
import librosa
import soundfile as sf
import tensorflow as tf
import tensorflow_hub as hub
from tensorflow import keras
from keras.models import load_model
from keras.utils import to_categorical  # (일부 환경에서 필요)
from sklearn.preprocessing import LabelEncoder  # (일부 환경에서 필요)
from sklearn.metrics.pairwise import cosine_similarity
from datetime import datetime
from scipy.interpolate import interp1d
from pydub import AudioSegment
import matplotlib
matplotlib.use('Agg')  # GUI 없는 백엔드
import matplotlib.pyplot as plt
from bs4 import BeautifulSoup
import speech_recognition as s_r
import Levenshtein

# -----------------------------
# 전역 캐시
# -----------------------------
_SPICE_MODEL = None              # TF-Hub SPICE (피치)
_TONE_MODEL = None               # 음색 분류 Keras 모델
_DB_FEATURES = None              # DB 임베딩
_DB_TITLES = None                # DB 타이틀 목록


class VocalAnalysis:
    def __init__(self, artist=None, title=None):
        self.artist = artist or "AI_Vocal_Test"
        self.title = title or "Tone_Analysis"

        self.artist_audio_path = f'assets/audio/artist/vocal/{self.artist}-{self.title}.wav'
        self.user_audio_path   = f'assets/audio/user/{self.artist}-{self.title}.wav'
        self.lrc_path          = f'assets/lrc/{self.artist}-{self.title}.lrc'
        self.graph_dir         = 'assets/graph'

        self.sampling_rate = 16000
        self.model = self.model_load()  # SPICE

        # 디렉토리 보장
        os.makedirs(os.path.dirname(self.artist_audio_path), exist_ok=True)
        os.makedirs(os.path.dirname(self.user_audio_path), exist_ok=True)
        # lrc_path는 파일 경로이므로 디렉토리만 생성
        os.makedirs(os.path.dirname(self.lrc_path), exist_ok=True)
        os.makedirs(self.graph_dir, exist_ok=True)

        # LRC 보장
        try:
            self.ensure_lrc_exists()
        except Exception as e:
            print(f"[ensure_lrc_exists] 오류: {e}")

    # ------------------------
    # 공용 유틸
    # ------------------------
    def model_load(self):
        """SPICE 모델을 전역 캐시에 1회만 로드"""
        global _SPICE_MODEL
        if _SPICE_MODEL is None:
            _SPICE_MODEL = hub.load("https://tfhub.dev/google/spice/2")
        return _SPICE_MODEL

    def ensure_lrc_exists(self):
        """없으면 기본 LRC 생성"""
        if os.path.exists(self.lrc_path):
            return
        default_lrc = (
            "[00:00.00] 이곳은 테스트용 가사입니다\n"
            "[00:05.00] 아무 노래 한 소절을 불러보세요\n"
            "[00:10.00] 음성 분석을 시작합니다\n"
        )
        with open(self.lrc_path, "w", encoding="utf-8") as f:
            f.write(default_lrc)
        print(f"[Auto LRC] 생성됨: {self.lrc_path}")

    def recording_result(self):
        # NOTE: 이 함수는 오디오 파일을 librosa로 로드했다가 다시 저장하는 용도로 보임.
        # librosa.load(sr=None)은 원본 샘플링 레이트를 유지하며 로드하지만,
        # 이 코드는 단순히 파일을 읽고 다시 쓰는 작업을 합니다.
        # 사용자가 올린 오디오 파일을 표준화하는 용도로 해석하고 원본 유지를 위해 sr=None을 유지합니다.
        try:
            audio_data, sample_rate = librosa.load(self.user_audio_path, sr=None)
            sf.write(self.user_audio_path, audio_data, sample_rate)
        except Exception as e:
            print(f"[recording_result] 오디오 파일 처리 중 오류: {e}")

    # ------------------------
    # 피치 분석 (SPICE)
    # ------------------------
    def extract_pitches(self, audio_path, duration):
        """
        SPICE 출력 길이에 맞춰 10ms(100Hz) 그리드로 보간한 피치 배열 반환
        returns: (pitch_raw, pitch_resampled, y, sr)
        """
        model = self.model
        # SPICE 입력 일관화: 16k mono
        # duration 매개변수를 사용하여 두 오디오 파일의 길이를 일치시킴
        y, sr = librosa.load(audio_path, mono=True, sr=self.sampling_rate, duration=duration)
        y = y.astype(np.float32)  # librosa는 이미 -1..1 스케일

        # 모델 추론
        model_output = model.signatures["serving_default"](tf.constant(y, tf.float32))
        pitch_outputs = model_output["pitch"].numpy()

        # 시간축 계산
        original_duration = len(y) / sr  # seconds
        pitch_time = np.linspace(0, original_duration, len(pitch_outputs))

        # 최소 길이 + 10ms 그리드 (100Hz)
        target_len = max(int(original_duration * 100), 10)  # 최소 10 스텝(=0.1s)
        resampled_time = np.linspace(0, original_duration, target_len)

        # 보간
        interp_func = interp1d(pitch_time, pitch_outputs, kind='linear', fill_value="extrapolate")
        resampled_pitch_outputs = interp_func(resampled_time)

        return pitch_outputs, resampled_pitch_outputs, y, sr

    def find_wrong_segments(self, result_labels, status=0):
        """
        result_labels: "Correct"/"Flat"/"Sharp" 배열 (resampled 기준 권장)
        status=1이면 길이 기준을 더 엄격(2) / 아니면 15
        반환: [(start_idx, end_idx)] (인덱스 단위, 10ms 그리드 기준)
        """
        wrong_segments = []
        in_wrong_segment = False
        start_idx = None
        # status=1: 2프레임 (20ms) 이상이면 잘못된 구간으로 판단 (엄격)
        # status=0: 15프레임 (150ms) 이상이면 잘못된 구간으로 판단 (덜 엄격)
        length = 2 if status == 1 else 15 

        for i in range(len(result_labels)):
            if result_labels[i] != 'Correct':
                if not in_wrong_segment:
                    start_idx = i
                    in_wrong_segment = True
            else:
                if in_wrong_segment:
                    end_idx = i - 1
                    # 최소 길이(length)보다 긴 구간만 저장
                    if (end_idx - start_idx) > length:
                        wrong_segments.append((start_idx, end_idx))
                    in_wrong_segment = False

        # 끝까지 잘못된 구간인 경우 처리
        if in_wrong_segment:
            end_idx = len(result_labels) - 1
            if (end_idx - start_idx) > length: # 끝 부분도 최소 길이 체크
                wrong_segments.append((start_idx, end_idx))
        return wrong_segments

    def pitch_comparison(self):
        """
        사용자/원본 피치 차이로 Correct/Flat/Sharp 판단
        반환: (correct_score, wrong_segments_sec, artist_resampled, user_resampled)
        wrong_segments_sec는 '초' 단위 구간 리스트
        """
        # 사용자 파일 필수
        if not os.path.exists(self.user_audio_path):
            return 0.0, [], np.array([]), np.array([])

        # 원본(아티스트) 파일 없으면 '자기 비교' 폴백 (차이 ≈ 0)
        artist_path = self.artist_audio_path if os.path.exists(self.artist_audio_path) else self.user_audio_path

        # 사용자 파일의 길이를 기준으로 duration 설정
        y_user, sr = librosa.load(self.user_audio_path, mono=True, sr=self.sampling_rate)
        duration = len(y_user) / sr

        # 피치 추출 (duration을 넘기기 때문에 길이가 거의 일치함)
        a_orig, a_res, artist_y, _ = self.extract_pitches(artist_path, duration)
        u_orig, u_res, _, _         = self.extract_pitches(self.user_audio_path, duration)

        # Resampled pitch를 사용하여 비교 (시간축이 일관됨)
        diff_res = a_res - u_res

        # threshold (0.03 = 약 반음의 1/4)
        threshold = 0.03
        result_res = np.where(np.abs(diff_res) <= threshold, "Correct",
                      np.where(diff_res > threshold, "Flat", "Sharp")) # 사용자가 낮으면(Flat), 원본 - 사용자 > 0.03

        correct_score = round((np.sum(result_res == 'Correct') / len(result_res)) * 100, 2) if len(result_res) else 0.0

        # 잘못된 구간(10ms 그리드 기준 인덱스) → '초' 단위
        # status=1 (엄격한 기준)으로 잘못된 구간 인덱스 추출
        idx_segments = self.find_wrong_segments(result_res, status=1)
        sec_segments = [(s * 0.01, e * 0.01) for (s, e) in idx_segments]

        # 시각화(안전 가드)
        try:
            plt.rcParams['font.family'] = 'Malgun Gothic'
            plt.figure(figsize=(15, 5))
            
            # **수정: 보간된 피치(a_res)를 플로팅하여 resampled segment와 인덱스 일치시킴**
            if len(a_res):
                plt.plot(a_res, label='Original (Resampled)', color='blue', alpha=0.6)
            
            # **result_res를 기준으로 Correct/Sharp/Flat 인덱스 찾기**
            correct_indices = np.where(result_res == 'Correct')[0]
            sharp_indices   = np.where(result_res == 'Sharp')[0]
            flat_indices    = np.where(result_res == 'Flat')[0]

            if len(a_res):
                # **a_res의 인덱스로 Scatter 플롯**
                if len(correct_indices): plt.scatter(correct_indices, a_res[correct_indices], color='orange', label='Good', s=8)
                # 'Sharp'은 사용자가 높음 (Original - User < -0.03) -> 원곡보다 위에 점 찍기
                if len(sharp_indices):   plt.scatter(sharp_indices,   a_res[sharp_indices],   color='hotpink', label='Sharp(사용자 높음)', marker="^", s=12)
                # 'Flat'은 사용자가 낮음 (Original - User > 0.03) -> 원곡보다 아래에 점 찍기
                if len(flat_indices):    plt.scatter(flat_indices,    a_res[flat_indices],    color='lightgrey', label='Flat(사용자 낮음)', marker="v", s=12)
            
            plt.title(f'원곡과 사용자 보컬의 음정 체크: {correct_score}점')
            plt.xlabel('프레임 인덱스 (10ms 그리드)')
            plt.ylabel('피치 값')
            plt.legend()
            
            # **resampled index를 그대로 사용하여 잘못된 구간 표시**
            for start_idx, end_idx in idx_segments:
                plt.axvspan(start_idx, end_idx, color='red', alpha=0.25)
                
            out_png = os.path.join(self.graph_dir, f'{self.title}.png')
            plt.savefig(out_png); plt.close()
        except Exception as e:
            print(f"[pitch_comparison: plot] 오류: {e}")
            pass

        # 잘못된 구간 오디오 저장
        try:
            # 원곡 음원(artist_y)을 사용하여 해당 구간을 저장
            if len(artist_y):
                for index, (start_sec, end_sec) in enumerate(sec_segments):
                    s_i = int(max(start_sec, 0.0) * sr)
                    e_i = int((end_sec + 1.0) * sr) # 1.0초 패딩 추가
                    audio_segment = artist_y[s_i:e_i]
                    if len(audio_segment):
                        # artist_audio_path가 wav 파일이므로 replace를 사용
                        seg_path = f'{self.artist_audio_path.replace(".wav","")}_segment{index+1}.wav'
                        sf.write(seg_path, audio_segment, sr)
        except Exception as e:
            print(f"[pitch_comparison: segment_save] 오류: {e}")
            pass

        return correct_score, sec_segments, a_res, u_res

    # ------------------------
    # LRC 처리
    # ------------------------
    def time_to_seconds(self, time_str):
        mins, secs = map(float, time_str.split(":"))
        return mins * 60 + secs

    def find_incorrect_lyrics(self, wrong_segments, tolerance=1):
        """
        wrong_segments: [(start_sec, end_sec)] '초' 단위
        lrc의 타임스탬프와 대조하여 해당 구간의 가사 추출
        """
        if not wrong_segments:
            return ["완벽해요!"]

        # LRC 파일이 없으면 빈 배열 반환
        if not os.path.exists(self.lrc_path):
             return ["LRC 파일 없음"]

        with open(self.lrc_path, encoding='utf-8') as f:
            lines = f.readlines()
        
        # 주석/정보 태그를 제외한 타임스탬프와 가사만 파싱
        parsed = []
        for line in lines:
             match = re.match(r"\[(\d+:\d+\.\d+)\](.*)", line)
             if match:
                 parsed.append((self.time_to_seconds(match.group(1)), match.group(2).strip()))
        
        result = []
        for start, end in wrong_segments:
            # 음정 오류 구간에 포함되는 가사 줄 추출
            rng = "\n".join(txt for t, txt in parsed if (start - tolerance) <= t <= end)
            result.append(rng if rng else f"[{start:.2f}s ~ {end:.2f}s] 해당 구간 가사 없음")
            
        # 중복 제거 (순서 유지는 포기)
        unique_result = sorted(list(set(result)), key=lambda x: result.index(x))
        return unique_result

    def read_lrc(self, file_path):
        with open(file_path, 'r', encoding='utf-8') as file:
            lines = file.readlines()
        lrc_data = []
        for line in lines:
            match = re.match(r'\[(\d+):(\d+\.\d+)\](.*)', line)
            if match:
                minutes = int(match.group(1))
                seconds = float(match.group(2))
                text = match.group(3).strip()
                lrc_data.append((minutes * 60 + seconds, text))
        return lrc_data

    # ------------------------
    # Meta data / Lyrics (Bugs)
    # ------------------------
    def extract_artist_and_title(self, file_name):
        base_name = os.path.splitext(file_name)[0]
        if '-' in base_name:
            artist, title = base_name.split('-', 1)
            return artist.strip(), title.strip()
        else:
            return None, None

    def get_artist_track_id(self, artist_name, title):
        try:
            # URL 인코딩 적용
            query = urllib.parse.quote(f"{artist_name} {title}")
            search_url = f'https://music.bugs.co.kr/search/track?q={query}'
            # print(f"[Bugs Search] URL: {search_url}")
            
            response = requests.get(search_url, timeout=5)
            response.raise_for_status()
            
            search_soup = BeautifulSoup(response.text, 'html.parser')
            track_tag = search_soup.select_one("tr[trackid]")
            if track_tag:
                return track_tag.get('trackid')
        except Exception as e:
            print(f"[get_artist_track_id] 오류: {e}")
        return None

    def download_lyrics(self, track_id, file_path_no_ext):
        """
        Bugs API에서 가사를 JSON으로 받아와 원본 가사 텍스트를 반환
        (파일 저장 로직 제거, 효율 개선)
        """
        try:
            # NOTE: API KEY는 보안 상 환경 변수 등으로 관리하는 것이 좋습니다.
            url = f'http://api.bugs.co.kr/3/tracks/{track_id}/lyrics?&api_key=b2de0fbe3380408bace96a5d1a76f800'
            
            response = requests.get(url, timeout=5)
            response.raise_for_status() # HTTP 오류 발생 시 예외 발생

            data = response.json()
            return data.get('result', {}).get('lyrics', None)
        except Exception as e:
            print(f"[download_lyrics] 오류: {e}")
            return None

    def lrc_maker(self, file_path_no_ext, lyrics_text):
        """
        원본 가사 텍스트(Bugs 포맷)를 LRC 포맷으로 변환하여 파일로 저장
        """
        try:
            TIME, LYRICS, mm, ss, xx = [], [], [], [], []
            # Bugs 포맷: [시간]|가사#...
            lyrics_lines = lyrics_text.replace("＃", "\n").split("\n")
            
            for line in lyrics_lines:
                if "|" not in line:
                    continue
                time_marker, lyric = line.rsplit("|", 1)
                
                # time_marker가 유효한 숫자 형태인지 확인
                try:
                    time_float = float(time_marker)
                except ValueError:
                    continue # 시간 마커가 숫자가 아니면 건너뛰기

                TIME.append(time_float)
                LYRICS.append(lyric.strip()) # 앞뒤 공백 제거

            for time in TIME:
                total_seconds = time
                # 소수점 셋째 자리까지 가져와서 .xx 부분만 추출
                xx.append(f"{total_seconds % 1:.2f}"[1:]) 
                ss.append(f"{int(total_seconds) % 60:02}")
                mm.append(f"{int(total_seconds) // 60:02}")

            with open(f'{file_path_no_ext}.lrc', 'w', encoding='UTF8') as file:
                for i in range(len(TIME)):
                    # [mm:ss.xx]LYRICS
                    # xx는 .00 형태를 위해 .을 포함한 형태로 저장
                    file.write(f"[{mm[i]}:{ss[i]}{xx[i]}]{LYRICS[i]}\n")

            print(f"{file_path_no_ext}.lrc 파일을 생성했습니다.")
        except Exception as e:
            print(f"[lrc_maker] 오류: {e}")

    def process_music_files(self):
        """
        LRC 파일이 없으면 Bugs에서 시도 → 실패시 기본 LRC 생성 → 파일 읽어 반환
        """
        artist, title = self.artist, self.title
        file_path_no_ext = f'assets/lrc/{artist}-{title}'
        lrc_full_path = file_path_no_ext + '.lrc'

        if not os.path.isfile(lrc_full_path):
            print(f"[process_music_files] {lrc_full_path} 없음 — Bugs에서 검색 시도")
            track_id = self.get_artist_track_id(artist, title)
            if track_id:
                print(f"[process_music_files] track_id 찾음: {track_id} — 가사 다운로드 시도")
                # download_lyrics는 이제 가사 텍스트를 반환
                lyrics = self.download_lyrics(track_id, file_path_no_ext)
                if lyrics:
                    self.lrc_maker(file_path_no_ext, lyrics)
                else:
                    print("[process_music_files] 가사 다운로드 실패 — 기본 LRC 생성")
                    self.ensure_lrc_exists()
            else:
                print("[process_music_files] track_id 없음 — 기본 LRC 생성")
                self.ensure_lrc_exists()
        else:
            print(f"[process_music_files] 이미 존재: {lrc_full_path}")

        try:
            return self.read_lrc(lrc_full_path)
        except Exception as e:
            print(f"[process_music_files] read_lrc 실패: {e} — 기본 LRC로 다시 보장")
            try:
                self.ensure_lrc_exists()
                return self.read_lrc(self.lrc_path)
            except Exception as e2:
                print(f"[process_music_files] 복구 불가: {e2}")
                return []

    # ------------------------
    # 온셋/박자 비교 (기존 로직 정리)
    # ------------------------
    def load_audio(self, audio_path):
        y, sr = librosa.load(audio_path, sr=None)
        return y, sr

    def extract_onsets(self, y, sr):
        onset_env = librosa.onset.onset_strength(y=y, sr=sr)
        onsets = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, units='time')
        return onsets, onset_env

    def compare_onsets(self, onsets_original, onsets_cover, threshold=0.1):
        differences, diff_status = [], []
        # 원본 온셋을 기준으로 커버 온셋과의 차이 분석
        for onset in onsets_original:
            if len(onsets_cover) == 0:
                differences.append(threshold + 1)
                diff_status.append('bad')
                continue
            
            # 가장 가까운 커버 온셋 찾기
            closest_onset_index = np.argmin(np.abs(onsets_cover - onset))
            closest_onset = onsets_cover[closest_onset_index]
            difference = closest_onset - onset
            
            if abs(difference) > threshold:
                differences.append(difference)
                # difference > 0 : 커버 온셋이 원본 온셋보다 늦음 (late)
                # difference < 0 : 커버 온셋이 원본 온셋보다 빠름 (early)
                diff_status.append('late' if difference > 0 else 'early')
            else:
                differences.append(difference)
                diff_status.append('good')

        good_count = sum(1 for diff in differences if abs(diff) <= threshold)
        
        score = {
            'total_onsets': len(onsets_original),
            'good': good_count,
            'bad': len(differences) - good_count,
            'accuracy': (good_count / len(differences) * 100) if differences else 0
        }
        return differences, diff_status, score

    def extract_syllable_boundaries(self, y, sr, hop_length=512, frame_length=2048):
        # 파형에서 RMS(에너지) 변화를 기반으로 음절 경계 추정
        S = np.abs(librosa.stft(y, n_fft=frame_length, hop_length=hop_length))
        rms = librosa.feature.rms(S=S)[0]
        # Agglomerative clustering으로 경계 찾기. k는 임시로 rms 길이의 1/50로 설정.
        k_val = max(2, int(len(rms) // 50))
        boundaries = librosa.segment.agglomerative(rms.reshape(1, -1), k=k_val)
        times = librosa.times_like(rms, sr=sr, hop_length=hop_length)
        
        syllable_boundaries = []
        for i in range(len(boundaries) - 1):
            start_idx = boundaries[i]
            end_idx = boundaries[i + 1]
            start = times[start_idx]
            # 경계의 끝은 다음 경계 인덱스 직전 프레임으로 설정
            end = times[max(0, end_idx - 1)] 
            syllable_boundaries.append((start, end))
            
        return syllable_boundaries

    def merge_bad_segments(self, syllable_boundaries, onsets_original, diff_status, merge_tolerance=0.5):
        # diff_status가 'bad', 'early', 'late'인 온셋을 찾아서 해당 온셋을 포함하는 음절 경계를 병합
        bad_onset_times = [onset for onset, status in zip(onsets_original, diff_status) if status in ['bad', 'early', 'late']]
        
        if not bad_onset_times:
            return []
            
        initial_bad_segments = []
        
        # 1차: '나쁜' 온셋을 포함하는 음절 경계 선택
        for start, end in syllable_boundaries:
            if any(start <= onset <= end for onset in bad_onset_times):
                initial_bad_segments.append((start, end))

        if not initial_bad_segments:
            return []
            
        # 2차: 인접한 '나쁜' 음절 경계를 병합
        merged_segments = []
        current_start, current_end = initial_bad_segments[0]
        
        for next_start, next_end in initial_bad_segments[1:]:
            # 현재 구간의 끝과 다음 구간의 시작 사이 간격이 병합 허용치 이내인 경우
            if next_start - current_end <= merge_tolerance:
                current_end = next_end # 현재 구간의 끝을 연장
            else:
                merged_segments.append((current_start, current_end))
                current_start, current_end = next_start, next_end # 새 구간 시작
        
        # 마지막 구간 추가
        merged_segments.append((current_start, current_end))
        
        return merged_segments

    def save_bad_segments(self, audio_path, bad_segments, output_dir, output_prefix, padding=3.0):
        os.makedirs(output_dir, exist_ok=True)
        try:
            audio = AudioSegment.from_wav(audio_path)
            for i, (start, end) in enumerate(bad_segments):
                # 시작 시점: start - (padding - 1.25) * 1000
                start_ms = max((start - (padding - 1.25)) * 1000, 0)
                # 종료 시점: end + padding * 1000
                end_ms = min((end + padding) * 1000, len(audio))
                
                segment = audio[start_ms:end_ms]
                # output_prefix에 아티스트-제목 정보 포함
                output_filename = os.path.join(output_dir, f"{output_prefix}_bad_segment_{i+1}.wav")
                segment.export(output_filename, format="wav")
        except Exception as e:
            print(f"[save_bad_segments] 오디오 저장 오류: {e}")

    def plot_onset_differences(self, y_original, sr_original, onsets_original, bad_segments, diff_status):
        try:
            plt.rcParams['font.family'] = 'Malgun Gothic'
            plt.figure(figsize=(15, 5))
            time = np.linspace(0, len(y_original) / sr_original, num=len(y_original))
            plt.plot(time, y_original, label='원본 음원 파형', alpha=0.6)

            if bad_segments:
                for idx, (start, end) in enumerate(bad_segments):
                    # 초 단위로 X축에 세그먼트 표시
                    plt.axvspan(start, end, color='red', alpha=0.25, label='박자 오류 구간' if idx == 0 else "")

            # bad_segments 안에 포함되는 'early' 또는 'late' 온셋만 표시
            early_plotted = False
            late_plotted = False
            
            for onset, status in zip(onsets_original, diff_status):
                is_in_bad_segment = any(start <= onset <= end for start, end in bad_segments)
                
                if is_in_bad_segment:
                    if status == 'early':
                        plt.axvline(onset, color='green', linestyle=':', linewidth=1.5, label='Early 박자' if not early_plotted else None)
                        early_plotted = True
                    elif status == 'late':
                        plt.axvline(onset, color='orange', linestyle=':', linewidth=1.5, label='Late 박자' if not late_plotted else None)
                        late_plotted = True

            plt.xlabel('시간 (초)')
            plt.ylabel('진폭')
            plt.title(f'원본 음원의 파형과 박자 오류 분석 ({self.artist}-{self.title})')
            plt.legend()
            plt.grid(True)
            out_png = os.path.join(self.graph_dir, f'{self.artist}-{self.title}-beat.png')
            plt.savefig(out_png)
            plt.close()
        except Exception as e:
            print(f"[plot_onset_differences] 플롯 오류: {e}")


    def score_cover(self, threshold=0.2, merge_tolerance=0.6):
        try:
            if not os.path.exists(self.artist_audio_path) or not os.path.exists(self.user_audio_path):
                 print("[score_cover] 원본 또는 사용자 오디오 파일이 없어 분석 불가")
                 return {'total_onsets': 0, 'good': 0, 'bad': 0, 'accuracy': 0.0}

            y_original, sr_original = self.load_audio(self.artist_audio_path)
            y_cover, sr_cover = self.load_audio(self.user_audio_path)
            
            onsets_original, _ = self.extract_onsets(y_original, sr_original)
            onsets_cover, _ = self.extract_onsets(y_cover, sr=sr_cover)
            
            if not onsets_original:
                 print("[score_cover] 원본 오디오에서 온셋을 찾을 수 없음")
                 return {'total_onsets': 0, 'good': 0, 'bad': 0, 'accuracy': 0.0}

            differences, diff_status, score = self.compare_onsets(onsets_original, onsets_cover, threshold)
            
            syllable_boundaries = self.extract_syllable_boundaries(y_original, sr_original)
            bad_segments = self.merge_bad_segments(syllable_boundaries, onsets_original, diff_status, merge_tolerance)
            
            self.plot_onset_differences(y_original, sr_original, onsets_original, bad_segments, diff_status)
            
            # 박자 오류 구간 오디오 저장
            output_prefix = f'{self.artist}-{self.title}-original'
            self.save_bad_segments(self.artist_audio_path, bad_segments, self.graph_dir, output_prefix)
            
            return score
        except Exception as e:
            print(f"[score_cover] 오류: {e}")
            return {'total_onsets': 0, 'good': 0, 'bad': 0, 'accuracy': 0.0}


    # ------------------------
    # 발음/가사 유사도
    # ------------------------
    def remove_brackets_and_text(self, text):
        return re.sub(r'\[.*?\]', '', text)

    def calculate_levenshtein_similarity(self, target_string):
        # LRC가 아닌 별도의 가사 파일(assets/lyrics)을 사용하는 것으로 보임
        lyrics_dir = 'assets/lyrics'
        os.makedirs(lyrics_dir, exist_ok=True)
        file_path = os.path.join(lyrics_dir, f'{self.artist}-{self.title}.txt')
        
        try:
            # 원본 가사 파일 읽기
            with open(file_path, 'r', encoding='utf-8') as f:
                file_content = f.read().replace('\n', ' ') # 줄바꿈 제거 후 공백으로 통일
            # STT 결과도 유사하게 처리
            target_string = target_string.replace('\n', ' ')
        except Exception:
            file_content = ""
            
        # 비교 대상 문자열이 없으면 유사도 계산 불가
        if not file_content and not target_string:
            return 1.0 # 둘 다 없으면 완벽 일치로 간주
        if not file_content or not target_string:
            return 0.0 # 하나만 없으면 0점

        distance = Levenshtein.distance(file_content, target_string)
        max_len = max(len(file_content), len(target_string))
        
        # 유사도 = 1 - (거리 / 최대 길이)
        similarity = round(1 - (distance / max_len), 2) if max_len else 0.0
        return similarity  # float

    def pronunciation_score(self):
        if not os.path.exists(self.user_audio_path):
            return 0.0
        
        # 오디오 길이 체크 (0.5초 미만이면 STT 실패 가능성이 높음)
        try:
            y_tmp, sr_tmp = librosa.load(self.user_audio_path, sr=None)
            if len(y_tmp) < sr_tmp * 0.5:
                print("음성 파일이 너무 짧아 STT를 수행할 수 없습니다.")
                return 0.0
        except Exception as e:
            print(f"오디오 로드/길이 확인 예외: {e}")
            return 0.0

        r = s_r.Recognizer()
        text = ""
        try:
            with s_r.AudioFile(self.user_audio_path) as source:
                # 노이즈를 고려하여 오디오 파일 전체를 한 번에 기록
                audio = r.record(source) 
            # Google STT API를 사용하여 한국어(ko-KR)로 음성 인식
            text = r.recognize_google(audio, language="ko-KR")
            print(f"음성 인식 결과: '{text}'")
        except s_r.UnknownValueError:
            print("음성 인식을 이해하는데 실패했습니다. (UnknownValueError)")
        except s_r.RequestError as e:
            print(f"요청 실패 (RequestError): {e}")
        except Exception as e:
            print(f"STT 예외: {e}")

        if text:
            try:
                # 인식된 텍스트와 원본 가사의 유사도 계산
                return float(self.calculate_levenshtein_similarity(text))
            except Exception as e:
                print(f"유사도 계산 예외: {e}")
                return 0.0
        return 0.0

    # ------------------------
    # 피치 시프팅(선택)
    # ------------------------
    def change_pitch_without_speed(self, semitones):
        inst_file = f"assets/audio/artist/inst/{self.artist}-{self.title}.wav"
        input_files = [self.artist_audio_path, inst_file]
        for i in input_files:
            try:
                if not os.path.exists(i):
                    continue
                y, sr = librosa.load(i, sr=None)
                # librosa.effects.pitch_shift는 `y`와 `sr`을 모두 받으므로, sr=sr을 명시적으로 전달
                y_shifted = librosa.effects.pitch_shift(y=y, sr=sr, n_steps=semitones)
                
                pm = '+' if semitones > 0 else '' if semitones == 0 else '-'
                output_file = f"{i.replace('.wav','')}_shift_{pm}{abs(semitones)}.wav"
                
                # 출력 디렉토리 보장
                os.makedirs(os.path.dirname(output_file), exist_ok=True)
                sf.write(output_file, y_shifted, sr)
                print(f"피치 시프팅 파일 생성됨: {output_file}")
            except Exception as e:
                print(f"[change_pitch_without_speed] {i} 처리 중 오류: {e}")

    # ------------------------
    # 음색 분류 + 추천 (프론트 친화 스키마)
    # ------------------------
    def extract_features(self, model, data):
        """
        모델의 마지막 전-출력 특징(embedding) 추출.
        """
        try:
            # 기본: 마지막에서 두 번째 레이어 (분류 레이어 직전)의 출력을 특징으로 사용
            inter = keras.Model(inputs=model.inputs, outputs=model.get_layer(index=-2).output)
            return inter.predict(data, verbose=0)
        except Exception:
            # 이름 기반 풀링/평균/플래튼 후보
            candidate_names = [
                "global_average_pooling2d", "global_average_pooling1d",
                "avg_pool", "average_pooling", "flatten", "gap", "dense"
            ]
            for cand in candidate_names:
                # 뒤에서부터 레이어 탐색
                for lyr in model.layers[::-1]:
                    if cand in lyr.name.lower():
                        try:
                            # 해당 레이어의 출력을 특징으로 사용
                            inter = keras.Model(inputs=model.inputs, outputs=lyr.output)
                            return inter.predict(data, verbose=0)
                        except Exception:
                            pass
            # 최후의 폴백: 모델의 최종 출력을 특징으로 사용
            return model.predict(data, verbose=0)


    def tone_classification(self):
        """
        음색 분류 모델을 사용하여 사용자 음색 분류 및 유사한 노래 추천
        """
        global _TONE_MODEL, _DB_FEATURES, _DB_TITLES

        labels_kr = ['발라드', '락', '트로트', '댄스']
        label_map_en = {'발라드': 'ballade', '락': 'rock', '트로트': 'Trot', '댄스': 'dance'}
        
        # 기본 폴백 값
        fallback_result = {
            "tone": "ballade", "tone_kr": "발라드",
            "song": {"title": "", "artist": "", "cover_url": ""},
            "recommends": []
        }

        # 1) 모델/DB를 1회만 로드 (로딩 로직 통합)
        if _TONE_MODEL is None:
            try:
                # Keras 모델 로드
                _TONE_MODEL = load_model('models/voice_char.h5')
            except Exception as e:
                print(f"[tone_classification] 모델 로드 실패 (models/voice_char.h5): {e}")
                return fallback_result

        if (_DB_FEATURES is None) or (_DB_TITLES is None):
            try:
                # DB 데이터 로드 및 특징 벡터 계산
                df = pd.read_pickle('models/voice_data.pkl')
                x_db = np.array(df.feature.tolist())
                _DB_TITLES = df.title.tolist()
                
                # DB 특징 벡터 미리 계산
                _DB_FEATURES = self.extract_features(_TONE_MODEL, x_db)
            except Exception as e:
                print(f"[tone_classification] DB 로드/특징 추출 실패 (models/voice_data.pkl): {e}")
                _DB_FEATURES = np.array([])
                _DB_TITLES = []

        # 2) 사용자 파일 로드 (너무 짧으면 안전 폴백)
        file_name = self.user_audio_path
        if not os.path.exists(file_name):
            print(f"[tone_classification] 사용자 오디오 파일 없음: {file_name}")
            return fallback_result

        y, sr = librosa.load(file_name, sr=None)
        if len(y) < sr * 0.5:  # 0.5초 미만이면 불안정 → 폴백
            print(f"[tone_classification] 오디오 길이가 너무 짧음: {len(y) / sr:.2f}초")
            return fallback_result

        # 3) 입력 특징 전처리(MFCC → 패딩)
        test_mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=40)
        max_pad_len = 10000
        pad_width = max_pad_len - test_mfcc.shape[1]
        
        if pad_width > 0:
            test_mfcc = np.pad(test_mfcc, pad_width=((0, 0), (0, pad_width)), mode='constant')
        else:
            test_mfcc = test_mfcc[:, :max_pad_len]
            
        # Keras 모델 입력 형태로 reshape: (batch_size, height, width, channels)
        test_data = tf.reshape(test_mfcc, [-1, 40, 10000, 1])

        # 4) 입력 특징 추출
        input_features = self.extract_features(_TONE_MODEL, test_data)

        # 5) 유사도 기반 추천
        top_titles = []
        if len(_DB_FEATURES) > 0 and len(input_features) > 0:
            # 1차원 벡터로 변환 (cosine_similarity가 2D 입력을 기대)
            input_features_2d = input_features.reshape(1, -1)
            db_features_2d = _DB_FEATURES.reshape(len(_DB_FEATURES), -1)

            sim = cosine_similarity(input_features_2d, db_features_2d)
            idxs = np.argsort(sim[0])[::-1]
            top_titles = [_DB_TITLES[i] for i in idxs[:5]]
        else:
            print("[tone_classification] DB 특징 벡터가 없어 유사도 비교 불가")

        # 6) 클래스 추정
        class_idx = int(np.argmax(_TONE_MODEL.predict(test_data, verbose=0)))
        
        # 클래스 인덱스가 유효한지 확인
        if class_idx < 0 or class_idx >= len(labels_kr):
            print(f"[tone_classification] 유효하지 않은 클래스 인덱스: {class_idx}")
            label_kr = "발라드"
        else:
            label_kr = labels_kr[class_idx]
            
        label_en = label_map_en.get(label_kr, 'ballade') # 기본값: ballade

        # 추천곡 정보 설정
        song = {"title": top_titles[0] if top_titles else "", "artist": "", "cover_url": ""}

        return {
            "tone": label_en,
            "tone_kr": label_kr,
            "song": song,
            "recommends": top_titles
        }

# 코드가 끝난 후에는 주석이나 불필요한 공백을 제거하고 사용자에게 요청한 전체 코드를 제공합니다.