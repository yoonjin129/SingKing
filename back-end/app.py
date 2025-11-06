import os
import uuid
import subprocess
import shutil
import threading
import time
from pathlib import Path
from functools import wraps
from werkzeug.utils import secure_filename

import numpy as np
from flask import Flask, request, session, jsonify, send_from_directory, make_response
from flask_cors import CORS
import json

from module.db import Database
from module.vocal_analysis import VocalAnalysis
from module.range_check import extract_pitch
from module.pitch_shift import change_pitch_without_speed  # <- (input_stem, semitones, path_num) 시그니처 사용

# =========================
# Flask & Config
# =========================
app = Flask(__name__)

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
CORS(
    app,
    supports_credentials=True,
    resources={r"/*": {"origins": FRONTEND_ORIGIN}},
)

app.secret_key = os.getenv("SECRET_KEY", "Um_AI_Diary_Hungry_BBC_BBQ_Chicken")
app.config["JSON_AS_ASCII"] = False
app.config["MAX_CONTENT_LENGTH"] = int(os.getenv("MAX_UPLOAD_MB", "50")) * 1024 * 1024  # 50MB

# --- CORS 사전요청/응답 보강 ---
@app.before_request
def _cors_preflight():
    if request.method == "OPTIONS":
        resp = make_response()
        resp.status_code = 200
        req_headers = request.headers.get(
            "Access-Control-Request-Headers",
            "Content-Type, Authorization, X-Requested-With"
        )
        resp.headers["Access-Control-Allow-Origin"] = FRONTEND_ORIGIN
        resp.headers["Access-Control-Allow-Credentials"] = "true"
        resp.headers["Access-Control-Allow-Headers"] = req_headers
        resp.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
        return resp

@app.after_request
def _cors_after(resp):
    resp.headers["Access-Control-Allow-Origin"] = FRONTEND_ORIGIN
    resp.headers["Access-Control-Allow-Credentials"] = "true"
    resp.headers.setdefault("Vary", "Origin")
    return resp

# 업로드 경로
UPLOAD_ROOT = "assets/audio/user"
app.config["UPLOAD_FOLDER"] = UPLOAD_ROOT
app.config["TONE_UPLOAD_FOLDER"] = os.path.join(UPLOAD_ROOT, "tone")
app.config["RANGE_UPLOAD_FOLDER"] = os.path.join(UPLOAD_ROOT, "range")
GRAPH_FOLDER = "assets/graph"

# 허용 확장자 (webm 추가)
ALLOWED_EXTENSIONS = {"wav", "mp3", "m4a", "flac", "ogg", "webm"}

# =========================
# MR(반주) 폴더/URL 설정 + 매핑 (추가)
# =========================
FRONT_PUBLIC_MR = os.path.abspath("../front-end/public/mr")  # CRA dev가 이 폴더를 정적 서빙
PUBLIC_URL_BASE = os.getenv("PUBLIC_URL_BASE", "http://localhost:3000")  # 프런트 개발 서버 URL

# (선택) 곡 제목/가수 -> MR 파일 베이스 이름(확장자 제외) 매핑
MR_FILES = {
    ("너였다면", "정승환"): "if_it_is_you",
    ("밤편지", "아이유"): "letter_at_night",
    ("야생화", "박효신"): "wild_flower",
    ("흰수염고래", "YB"): "a_blue_whale",
    # 필요에 따라 추가
}

def _safe_stem(s: str) -> str:
    return "".join(c if c.isalnum() or c in ("_", "-") else "_" for c in (s or "").strip())

def _mr_find_input_stem(artist: str, title: str, mr_basename: str | None) -> str:
    """
    1) mr_basename이 오면 그걸 사용
    2) 없으면 (title, artist) 매핑에서 찾기
    3) 둘 다 없으면 title을 안전 문자열로 사용
    """
    if mr_basename:
        return os.path.splitext(mr_basename.strip())[0]
    key = ((title or "").strip(), (artist or "").strip())
    if key in MR_FILES:
        return MR_FILES[key]
    return _safe_stem(title or "unknown_title")

def _mr_resolve_existing_path(input_stem: str) -> str:
    """
    public/mr 폴더에서 input_stem.(wav|mp3) 중 존재하는 실제 경로 반환.
    없으면 .wav 경로(존재X)를 반환해 에러 메시지에 경로가 찍히도록 함.
    """
    wav_p = os.path.join(FRONT_PUBLIC_MR, f"{input_stem}.wav")
    mp3_p = os.path.join(FRONT_PUBLIC_MR, f"{input_stem}.mp3")
    if os.path.exists(wav_p): return wav_p
    if os.path.exists(mp3_p): return mp3_p
    return wav_p

# =========================
# RVC 작업 디렉토리/상태 (데모용)
# =========================
JOBS_ROOT = Path("jobs")
JOBS_ROOT.mkdir(parents=True, exist_ok=True)

# 메모리 상태 저장 (간단 데모용): job_id -> {"status": "queued|...|done|error:...", "result": "jobs/.../mix.wav" or None}
RVC_JOBS = {}

# =========================
# 유틸 함수
# =========================
def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS

def ensure_folder_exists(path: str):
    os.makedirs(path, exist_ok=True)

def ffmpeg_installed() -> bool:
    return shutil.which("ffmpeg") is not None

def transcode_to_wav(src_path: str, remove_src: bool = True) -> str:
    """ffmpeg로 어떤 오디오든 44.1kHz/mono PCM WAV로 변환"""
    if not ffmpeg_installed():
        raise RuntimeError("ffmpeg가 설치되지 않았습니다. (PATH에 없음)")

    base, _ = os.path.splitext(src_path)
    wav_path = f"{base}.wav"

    cmd = [
        "ffmpeg", "-y", "-i", src_path, "-vn",
        "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "1",
        wav_path
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    if remove_src and os.path.exists(src_path) and src_path.lower() != wav_path.lower():
        try:
            os.remove(src_path)
        except Exception:
            pass
    return wav_path

def canonical_wav_path(artist: str, title: str) -> str:
    """우리 서버의 표준 경로 (고정 파일명)."""
    safe_artist = (artist or "").strip() or "AI_Vocal_Test"
    safe_title = (title or "").strip() or "Tone_Analysis"
    filename = f"{safe_artist}-{safe_title}.wav"
    return os.path.join(app.config["UPLOAD_FOLDER"], filename)

def legacy_wav_path_for_vocal_module(artist: str, title: str) -> str:
    """
    VocalAnalysis 모듈이 내부적으로 찾는 레거시 경로:
    assets/audio/artist/vocal/{artist}-{title}.wav
    """
    safe_artist = (artist or "").strip() or "AI_Vocal_Test"
    safe_title = (title or "").strip() or "Tone_Analysis"
    legacy_dir = os.path.join("assets", "audio", "artist", "vocal")
    ensure_folder_exists(legacy_dir)
    return os.path.join(legacy_dir, f"{safe_artist}-{safe_title}.wav")

def _job_dir(job_id: str) -> Path:
    p = JOBS_ROOT / job_id
    p.mkdir(parents=True, exist_ok=True)
    return p

def _write_status(job_id: str, status: str, detail: str = None):
    job_dir = _job_dir(job_id)
    payload = {"status": status}
    if detail:
        payload["detail"] = detail
    (job_dir / "status.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    RVC_JOBS[job_id] = {"status": status, "result": RVC_JOBS.get(job_id, {}).get("result")}

def _user_samples_count(user_id: str) -> int:
    """DB가 있으면 DB 카운트 사용, 실패 시 업로드 폴더 WAV 개수를 폴백으로 사용"""
    try:
        vc_list = db.get_vocal_data(user_id) or []
        return len(vc_list)
    except Exception:
        base = Path(app.config["UPLOAD_FOLDER"])
        return len(list(base.glob("*.wav")))

def normalize_song_for_frontend(song_data, tone_key):
    """DB에서 조회한 노래 데이터를 프론트엔드 형식으로 변환"""
    if not song_data:
        return {
            "recommend": "너였다면",
            "artist": "정승환",
            "image": "./img/songs/cover_if_it_is_you.png",
            "tone": tone_key
        }
    return {
        "recommend": song_data.get('title', 'Unknown Title'),
        "artist": song_data.get('artist', 'Unknown Artist'),
        "image": song_data.get('cover_url') or f"./img/songs/cover_{tone_key}_fallback.png",
        "tone": tone_key
    }

# 시작 시 폴더 확보
for folder in [
    UPLOAD_ROOT,
    app.config["TONE_UPLOAD_FOLDER"],
    app.config["RANGE_UPLOAD_FOLDER"],
    GRAPH_FOLDER,
    os.path.join("assets","audio","artist","vocal")
]:
    ensure_folder_exists(folder)

db = Database()

# =========================
# 공통 유틸
# =========================
def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if "user_id" not in session:
            return jsonify({"status": "fail", "message": "로그인이 필요합니다."}), 401
        return fn(*args, **kwargs)
    return wrapper

def save_uploaded_file_from_request(req, folder_path, filename_suggestion=None):
    ensure_folder_exists(folder_path)
    if "audio" not in req.files:
        return jsonify({"error": "파일 파트(audio)가 없습니다."}), 400
    file = req.files["audio"]
    if not file or file.filename == "":
        return jsonify({"error": "선택된 파일이 없습니다."}), 400
    if not allowed_file(file.filename):
        return jsonify({"error": f"허용되지 않는 확장자입니다. {sorted(ALLOWED_EXTENSIONS)}"}), 400

    base = secure_filename(filename_suggestion or file.filename) # 원본 확장자 유지
    name, ext = os.path.splitext(base)
    unique_name = f"{name}-{uuid.uuid4().hex[:8]}{ext}"
    file_path = os.path.join(folder_path, unique_name)
    file.save(file_path)
    return file_path

# ... (Auth, index, uploads 등 나머지 엔드포인트는 변경 없음)

# =========================
# 정적 그래프
# =========================
@app.route('/assets/graph/<path:filename>')
def serve_image(filename):
    return send_from_directory(GRAPH_FOLDER, filename)

# =========================
# Auth
# =========================
@app.route("/login", methods=["POST"])
def login():
    data = request.get_json(force=True, silent=True) or {}
    user_id = data.get('id')
    user_password = data.get('password')
    if not user_id or not user_password:
        return jsonify({"status": "fail", "message": "id/password가 필요합니다."}), 400

    response = db.db_login(user_id, user_password)
    if response.get('status') == 'success':
        session['user_id'] = response.get('user_id')
        session['user_name'] = response.get('user_name')
    return jsonify(response)

@app.route('/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({"message": "Logged out successfully!"}), 200

@app.route("/register", methods=["POST"])
def register():
    data = request.get_json(force=True, silent=True) or {}
    required = ["id", "name", "age", "gender", "password"]
    if not all(k in data for k in required):
        return jsonify({"status": "fail", "message": f"필수 필드 누락: {required}"}), 400
    return db.db_register(data["id"], data["name"], data["age"], data["gender"], data["password"])

# =========================
# index
# =========================
@app.route("/index", methods=["GET", "POST"])
def index():
    user_name = session.get('user_name', '게스트')

    if 'user_id' not in session:
        return jsonify({'status': 'fail', 'message': '로그인 상태가 아닙니다.', 'user_name': user_name}), 200

    weekly_data = db.get_weekly_ranking()
    user_data = db.get_user_info(session['user_id'])
    user_vocal_data = db.get_vocal_data(session['user_id']) or []

    if len(user_vocal_data) > 1:
        last_week_vocal_data = user_vocal_data[-2]
    elif len(user_vocal_data) == 1:
        last_week_vocal_data = user_vocal_data[0]
    else:
        default_vocal_data = {'pitch_score': 0, 'beat_score': 0, 'pronunciation_score': 0}
        last_week_vocal_data = default_vocal_data
        
    latest_vocal_data = user_vocal_data[-1] if user_vocal_data else default_vocal_data

    pitch_score = latest_vocal_data.get('pitch_score', 0) or 0
    beat_score = latest_vocal_data.get('beat_score', 0) or 0
    pronunciation_score = float(latest_vocal_data.get('pronunciation_score', 0) or 0)

    last_week_pitch = last_week_vocal_data.get('pitch_score', 0) or 0
    last_week_beat = last_week_vocal_data.get('beat_score', 0) or 0
    last_week_pronunciation = float(last_week_vocal_data.get('pronunciation_score', 0) or 0)

    session['user_tone'] = user_data.get('user_tone')
    session['user_level'] = user_data.get('user_level', 0)
    user_name = user_data.get('user_name', user_name)

    return jsonify({
        'status': 'success',
        'data': weekly_data,
        'pitch_score': pitch_score,
        'beat_score': beat_score,
        'pronunciation_score': pronunciation_score,
        'last_week_pitch': last_week_pitch,
        'last_week_beat': last_week_beat,
        'last_week_pronunciation': last_week_pronunciation,
        'user_tone': session['user_tone'],
        'user_level': session['user_level'],
        'user_name': user_name
    }), 200

# =========================
# 파일 업로드 (기본)
# =========================
@app.route("/uploads", methods=["POST"])
@login_required
def upload():
    saved = save_uploaded_file_from_request(request, app.config['UPLOAD_FOLDER'], filename_suggestion=None)
    if isinstance(saved, tuple):
        return saved
    file_path = saved

    # ffmpeg 변환
    _, ext = os.path.splitext(file_path)
    if ext.lower() != ".wav":
        try:
            file_path = transcode_to_wav(file_path, remove_src=True)
        except Exception as e:
            return jsonify({"status": "fail", "message": f"ffmpeg 변환 오류: {str(e)}"}), 500

    return jsonify({"status": "success", "message": "File saved successfully", "file_path": file_path}), 200

# =========================
# 파일 업로드 (세부 타입: tone/range)
# =========================
@app.route("/uploads/<kind>", methods=["POST"])
@login_required
def upload_kind(kind):
    folder_map = {
        "tone": app.config["TONE_UPLOAD_FOLDER"],
        "range": app.config["RANGE_UPLOAD_FOLDER"],
        "default": app.config["UPLOAD_FOLDER"],
    }
    folder = folder_map.get(kind, folder_map["default"])

    # 1) 업로드 저장
    saved = save_uploaded_file_from_request(request, folder, filename_suggestion=None)
    if isinstance(saved, tuple):
        return saved
    src_path = saved

    # 2) ffmpeg 변환
    _, ext = os.path.splitext(src_path)
    try:
        if ext.lower() != ".wav":
            wav_path = transcode_to_wav(src_path, remove_src=True)
        else:
            wav_path = src_path
    except Exception as e:
        return jsonify({"status": "fail", "message": f"ffmpeg 변환 오류: {str(e)}"}), 500

    # 3) tone 업로드: 표준 경로 이동 + 레거시 경로 미러링
    if kind == "tone":
        artist = session.get('artist')
        title = session.get('title')
        if not artist or not title:
            return jsonify({"status": "fail", "message": "세션에 artist/title이 없습니다. /training 먼저 호출하세요."}), 400

        # 표준 경로
        final_path = canonical_wav_path(artist, title) # assets/audio/user/{artist}-{title}.wav
        ensure_folder_exists(os.path.dirname(final_path))
        try:
            if os.path.abspath(wav_path) != os.path.abspath(final_path):
                if os.path.exists(final_path):
                    os.remove(final_path)
                shutil.move(wav_path, final_path)
        except Exception as e:
            return jsonify({"status": "fail", "message": f"파일 이동 오류: {str(e)}"}), 500

        # ✅ VocalAnalysis 레거시 경로에도 복사
        try:
            legacy_path = legacy_wav_path_for_vocal_module(artist, title)
            if os.path.exists(legacy_path):
                os.remove(legacy_path)
            shutil.copy2(final_path, legacy_path)
            print(f"[tone upload] mirrored to legacy path: {legacy_path}")
        except Exception as e:
            return jsonify({"status": "fail", "message": f"레거시 경로 복사 오류: {str(e)}"}), 500

        # 4) (선택) 업로드 직후 사전처리
        try:
            va = VocalAnalysis(artist, title)
            va.recording_result()
        except Exception as e:
            return jsonify({"status": "fail", "message": f"{kind} 처리 중 오류: {str(e)}"}), 500

        return jsonify({"status": "success", "kind": kind, "file_path": final_path, "legacy_path": legacy_path}), 200

    # kind != "tone"
    return jsonify({"status": "success", "kind": kind, "file_path": wav_path}), 200

# =========================
# 가사 제공
# =========================
@app.route("/lyrics", methods=["GET"])
@login_required
def lyrics():
    # 세션에 /training으로 설정된 값 사용 (없으면 기본값)
    artist = session.get("artist") or "AI_Vocal_Test"
    title = session.get("title") or "Tone_Analysis"

    try:
        va = VocalAnalysis(artist, title)
        lrc = va.process_music_files() # [(sec, text), ...] 형식
        if lrc is None:
            lrc = []
        return jsonify({"status": "success", "lyrics": lrc}), 200
    except Exception as e:
        return jsonify({"status": "fail", "message": f"/lyrics error: {e}", "lyrics": []}), 500

# =========================
# 피치(반음) 변경 (실제 변환 + URL 반환)  <<<< 수정됨
# =========================
@app.route("/pitch_change", methods=["POST"])
@login_required
def pitch_change():
    """
    요청(JSON):
      - pitch: int (예: -2, -1, 0, +1, +2, ...)
      - mrBasename: 선택 (확장자 없이 'if_it_is_you'처럼)
      - songTitle, artist: 선택 (세션에 /training 저장되어 있으면 생략 가능)
    응답(JSON):
      - { status, pitch, url }  # url은 CRA가 바로 재생 가능한 /mr/xxx.wav
    """
    try:
        data = request.get_json(silent=True) or {}
        pitch = int(data.get("pitch", 0))
        mr_basename = (data.get("mrBasename") or "").strip()

        # 1) 기준 곡 식별: 세션(/training) → 요청값 순
        artist = (session.get("artist") or data.get("artist") or "").strip()
        title  = (session.get("title")  or data.get("songTitle") or "").strip()
        if (not artist or not title) and not mr_basename:
            return jsonify({"status": "fail", "message": "곡 식별 정보가 없습니다. /training 먼저 호출하거나 mrBasename을 보내세요."}), 400

        # 2) MR 입력 스템/경로 결정
        input_stem = _mr_find_input_stem(artist, title, mr_basename)  # 예: if_it_is_you
        in_path    = _mr_resolve_existing_path(input_stem)
        if not os.path.exists(in_path):
            return jsonify({"status": "fail", "message": f"MR 파일을 찾을 수 없습니다: {os.path.abspath(in_path)}"}), 404

        # 3) 피치 변환 실행 (module.pitch_shift의 함수 사용)
        #    path_num=0 → ../front-end/public/mr/{stem}{+N}.wav 로 저장하도록 구현되어 있어야 함
        out_abs_path = change_pitch_without_speed(input_stem, pitch, 0)

        # 4) 프런트가 바로 재생할 URL 구성
        sign = "+" if pitch >= 0 else ""
        out_name = f"{input_stem}{sign}{pitch}.wav"
        out_url  = f"{PUBLIC_URL_BASE}/mr/{out_name}"

        # (선택) 캐시 무력화 원하면 쿼리 추가
        # out_url = f"{out_url}?t={int(time.time())}"

        # 기록(기존 동작 유지)
        session["selected_pitch"] = pitch

        return jsonify({"status": "success", "pitch": pitch, "url": out_url}), 200

    except Exception as e:
        return jsonify({"status": "fail", "message": f"/pitch_change error: {e}"}), 500

# =========================
# 학습 세팅 (세션만 저장)
# =========================
@app.route("/training", methods=["POST"])
@login_required
def training():
    try:
        payload = request.get_json(silent=True) or {}
        artist = str(payload.get("artist") or "AI_Vocal_Test").strip()
        title = str(payload.get("songTitle") or "Tone_Analysis").strip()

        session["artist"] = artist
        session["title"] = title

        print(f"[training] set artist={artist}, title={title}, user_id={session.get('user_id')}")
        return jsonify({"status": "success", "artist": artist, "title": title}), 200
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"status": "fail", "message": f"/training error: {e}"}), 500

# =========================
# 보컬 분석
# =========================
@app.route("/vocal_analysis", methods=["POST"])
@login_required
def vocal_analysis():
    artist = session.get('artist', '')
    title = session.get('title', '')
    va = VocalAnalysis(artist, title)

    try:
        va.process_music_files() # 🔹 가사 파일 없으면 자동 생성

        pitch_score, wrong_segments, artist_resampled, user_resampled = va.pitch_comparison()
        session['artist_resampled'] = json.dumps(artist_resampled.tolist())
        session['user_resampled'] = json.dumps(user_resampled.tolist())
        wrong_lyrics = va.find_incorrect_lyrics(wrong_segments)
        beat_score = round(va.score_cover().get('accuracy', 0.0), 2)
        pronunciation_score = float(va.pronunciation_score() or 0.0)

        def clamp01(x): return max(0.0, min(100.0, float(x)))
        p = clamp01(pitch_score)
        b = clamp01(beat_score)
        pr = clamp01(pronunciation_score)
        total_score = round((p + b + pr) / 3.0, 2)

        db.vocal_data(session['user_id'], 0, p, b, pr)

        session['last_result'] = {
            "total": total_score, "pitch": p, "beat": b, "pronunciation": pr,
            "wrong_segments": wrong_segments, "wrong_lyrics": wrong_lyrics
        }

        return jsonify({
            'status': 'success',
            '총점': total_score, '음정 점수': p, '박자 점수': b,
            '발음 점수': pr, '틀린 구간': wrong_segments, '틀린 가사': wrong_lyrics
        }), 200

    except Exception as e:
        return jsonify({'status': 'fail', 'message': f'분석 중 오류: {str(e)}'}), 500

# =========================
# 최근 결과/추천
# =========================
@app.route("/result/latest", methods=["GET"])
@login_required
def result_latest():
    data = session.get("last_result")
    if not data:
        return jsonify({"status": "empty", "message": "최근 분석 결과가 없습니다."}), 200
    return jsonify({"status": "success", "result": data}), 200

@app.route("/ai_tone", methods=["GET"])
@login_required
def ai_tone():
    """음색 진단 결과 및 DB 기반 추천 곡"""
    artist = session.get("artist") or "AI_Vocal_Test"
    title = session.get("title") or "Tone_Analysis"
    
    diagnosed_tone = (session.get("user_tone") or "neutral").lower() 
    print(f"[DEBUG /ai_tone] 1. Initial/Fallback Tone from session: {diagnosed_tone}")
    
    try:
        va = VocalAnalysis(artist, title)
        ai_result = va.tone_classification() 
        if ai_result and ai_result.get("tone"):
            new_tone = str(ai_result["tone"]).lower()
            if new_tone != diagnosed_tone:
                db.update_user_tone(session["user_id"], new_tone)
                session["user_tone"] = new_tone
            diagnosed_tone = new_tone
            print(f"[DEBUG /ai_tone] 2. AI Diagnosis SUCCESS. New Tone: {diagnosed_tone}")
        else:
            print(f"[DEBUG /ai_tone] 2. AI Diagnosis FAILED/No tone in result. Using Fallback Tone.")
    except FileNotFoundError as e:
        print(f"[/ai_tone] 모델 없음/분석 실패. 세션 톤({diagnosed_tone}) 폴백. 오류: {e}")
    except Exception as e:
        print(f"[/ai_tone] 예외 발생. 세션 톤({diagnosed_tone}) 폴백. 오류: {e}")
        import traceback; traceback.print_exc()

    print(f"[DEBUG /ai_tone] 3. Final Tone used for DB query: {diagnosed_tone}")
    db_recs = db.get_song_recommendations(diagnosed_tone) or []
    first_rec = db_recs[0] if db_recs else None

    recommended_song = normalize_song_for_frontend(first_rec, diagnosed_tone)
    print(f"[DEBUG /ai_tone] 4. Recommended Song: {recommended_song['recommend']} by {recommended_song['artist']}")

    return jsonify({
        "status": "success",
        "tone": recommended_song["tone"],
        "recommend": recommended_song["recommend"], 
        "artist": recommended_song["artist"],
        "image": recommended_song["image"],
        "rec": recommended_song 
    }), 200

# =========================
# RVC: eligibility / cover / status / result
# =========================
@app.get("/rvc/eligibility")
@login_required
def rvc_eligibility():
    uid = session["user_id"]
    count = _user_samples_count(uid)
    return jsonify({"has5": count >= 5, "count": count}), 200

def _run_rvc_pipeline(user_id: str, song_key: str, job_id: str):
    """데모 파이프라인: 실제 RVC/분리는 이 함수 안의 부분을 교체하세요."""
    job_dir = _job_dir(job_id)
    mix_path = job_dir / "mix.wav"

    try:
        _write_status(job_id, "queued"); time.sleep(0.3)
        _write_status(job_id, "preparing"); time.sleep(0.3)
        _write_status(job_id, "separating"); time.sleep(0.5)
        _write_status(job_id, "training"); time.sleep(0.7)
        _write_status(job_id, "converting"); time.sleep(0.7)
        _write_status(job_id, "mixing")

        if not ffmpeg_installed():
            raise RuntimeError("ffmpeg가 필요합니다.")

        # 데모: 3초 무음으로 mix.wav 생성 (실제는 MR + converted 보컬을 amix 하세요)
        subprocess.run(
            ["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "3", str(mix_path)],
            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )

        _write_status(job_id, "done")
        RVC_JOBS[job_id]["result"] = str(mix_path)
    except Exception as e:
        _write_status(job_id, f"error: {type(e).__name__}", str(e))

@app.post("/rvc/cover")
@login_required
def rvc_cover():
    data = request.get_json(silent=True) or {}
    song_key = data.get("songKey")
    if not song_key:
        return jsonify({"error": "songKey required"}), 400

    uid = session["user_id"]
    if _user_samples_count(uid) < 5:
        return jsonify({"error": "need_at_least_5_samples"}), 400

    job_id = uuid.uuid4().hex
    RVC_JOBS[job_id] = {"status": "queued", "result": None}
    _write_status(job_id, "queued")

    th = threading.Thread(target=_run_rvc_pipeline, args=(uid, song_key, job_id), daemon=True)
    th.start()

    return jsonify({"jobId": job_id}), 200

@app.get("/rvc/status/<job_id>")
@login_required
def rvc_status(job_id):
    p = _job_dir(job_id) / "status.json"
    if not p.exists():
        return jsonify({"status": "unknown"}), 200
    try:
        return jsonify(json.loads(p.read_text(encoding="utf-8"))), 200
    except Exception:
        return jsonify({"status": "unknown"}), 200

@app.get("/rvc/result/<job_id>")
@login_required
def rvc_result(job_id):
    info = RVC_JOBS.get(job_id)
    if not info or info.get("status") != "done" or not info.get("result"):
        return jsonify({"error": "not_ready"}), 404
    result_path = Path(info["result"]).resolve()
    if not result_path.exists():
        return jsonify({"error": "missing_file"}), 404
    return send_from_directory(result_path.parent, result_path.name, mimetype="audio/wav")

# =========================
# (선택) 마이페이지 JSON
# =========================
@app.route("/my_page", methods=["GET"])
@login_required
def my_page():
    uid = session["user_id"]
    user = db.get_user_info(uid) or {}
    vocal_list = db.get_vocal_data(uid) or []
    latest = vocal_list[-1] if vocal_list else None

    return jsonify({
        "status": "success",
        "user": {
            "id": uid,
            "name": session.get("user_name"),
            "tone": session.get("user_tone"),
            "level": session.get("user_level", 0),
        },
        "vocal_latest": latest
    }), 200

# =========================
# 헬스체크
# =========================
@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True})

# =========================
# 개발 서버
# =========================
if __name__ == "__main__":
    host = os.getenv("FLASK_HOST", "0.0.0.0")
    port = int(os.getenv("FLASK_PORT", "5000"))
    debug = os.getenv("FLASK_DEBUG", "0") == "1"
    app.run(host=host, port=port, debug=debug)
