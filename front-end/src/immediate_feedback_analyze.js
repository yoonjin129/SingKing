import React, { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import "./immediate_feedback_analyze.css";
import "./common/root.css";
import Footer from "./common/Footer";
import Training_Splash from "./training_splash";
import Training_Tone from "./training_tone";

const API_BASE = "http://localhost:5000";
const PUB = process.env.PUBLIC_URL || "";

// 안전한 JSON fetch
async function safeFetchJSON(url, opts = {}) {
  const res = await fetch(url, { credentials: "include", ...opts });
  const ct = res.headers.get("content-type") || "";
  const txt = await res.text();
  if (!res.ok)
    throw new Error(`HTTP ${res.status} @ ${url} :: ${txt.slice(0, 300)}`);
  if (!ct.includes("application/json"))
    throw new Error(`Non-JSON @ ${url} :: ${txt.slice(0, 300)}`);
  return JSON.parse(txt);
}

// ✅ 확정적 MR 매핑 (public/mr 폴더에 실제 파일 존재 필요)
const MR_MAP = {
  "안아줘|정준일": `${PUB}/mr/hug_me.wav`,
  "너였다면|정승환": `${PUB}/mr/if_it_is_you.mp3`,
  "밤편지|아이유": `${PUB}/mr/letter_at_night.mp3`,
  "야생화|박효신": `${PUB}/mr/wild_flower.mp3`,
  "흰수염고래|YB": `${PUB}/mr/a_blue_whale.mp3`,
  "흔들리는 꽃들 속에서 네 샴푸 향이 느껴진 거야|장범준": `${PUB}/mr/wobbly_flowers.mp3`,
};

function keyOf(title, artist) {
  return `${String(title || "").trim()}|${String(artist || "").trim()}`;
}

function Immediate_feedback_analyze() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [audioError, setAudioError] = useState("");
  const audioRef = useRef(null);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [recordedChunks, setRecordedChunks] = useState([]);
  const finishingRef = useRef(false); // ✅ 종료 중복 방지
  const navigate = useNavigate();
  const [showToneAdjuster, setShowToneAdjuster] = useState(true);
  const [showSplash, setShowSplash] = useState(false);
  const [showMainContent, setShowMainContent] = useState(false);
  const [tone, setTone] = useState(0);

  // 재생/재개 액션 구분용
  const playbackActionRef = useRef(null); // 'start' | 'resume' | null
  const startAfterCountdownRef = useRef(false);

  // 🔻 location.state로부터 song 객체 사용
  const location = useLocation();
  const { song } = location.state || {};
  const songTitle = song?.recommend || "너였다면";
  const artist = song?.artist || "정승환";
  const imagePath = song?.image || `${PUB}/img/songs/cover_if_it_is_you.png`;

  const handleToneAdjusterFinish = () => setShowToneAdjuster(false);

  const handleSplashFinish = () => {
    setShowSplash(false);
    setShowMainContent(true);
    if (startAfterCountdownRef.current) {
      startAfterCountdownRef.current = false;
      if (playbackActionRef.current === "start") {
        beginPlaybackAndRecording();
      } else if (playbackActionRef.current === "resume") {
        resumePlaybackAndRecording();
      }
      playbackActionRef.current = null;
    }
  };

  const handlePitchChange = async (pitch) => {
    try {
      const res = await fetch(`${API_BASE}/pitch_change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pitch }),
        credentials: "include",
      });
      if (res.ok) {
        const out = await res.json();
        setTone(Number(out?.pitch ?? pitch));
      } else {
        setTone(pitch);
      }
      setShowToneAdjuster(false);
    } catch (error) {
      console.error("서버 통신 오류:", error);
      setTone(pitch);
      setShowToneAdjuster(false);
    }
  };

  // ===== 가사 처리 =====
  const [lyrics, setLyrics] = useState([]); // [(sec, text), ...]
  const [currentLyricIndex, setCurrentLyricIndex] = useState(0);
  const lyricRefs = useRef([]);

  const fetchLyrics = async () => {
    try {
      const t = await safeFetchJSON(`${API_BASE}/training`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songTitle, artist }),
      });

      // 1) training 응답에 lyrics 포함
      if (Array.isArray(t?.lyrics)) {
        const normalized = t.lyrics.map((row) => {
          if (Array.isArray(row) && row.length >= 2)
            return [Number(row[0]) || 0, String(row[1] || "")];
          if (row && typeof row === "object" && "time" in row && "text" in row)
            return [Number(row.time) || 0, String(row.text || "")];
          return [0, String(row || "")];
        });
        setLyrics(normalized);
        return;
      }

      // 2) 별도 /lyrics 사용
      const lrc = await safeFetchJSON(`${API_BASE}/lyrics`, { method: "GET" });
      const arr = Array.isArray(lrc?.lyrics) ? lrc.lyrics : [];
      const normalized = arr.map((row) => {
        if (Array.isArray(row) && row.length >= 2)
          return [Number(row[0]) || 0, String(row[1] || "")];
        if (row && typeof row === "object" && "time" in row && "text" in row)
          return [Number(row.time) || 0, String(row.text || "")];
        return [0, String(row || "")];
      });
      setLyrics(normalized);
    } catch (error) {
      console.error("Failed to fetch lyrics:", error);
      setLyrics([]);
    }
  };

  useEffect(() => {
    setLyrics([]);
    setCurrentLyricIndex(0);
    fetchLyrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songTitle, artist]);

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio || !(lyrics && lyrics.length)) return;

    const t = audio.currentTime || 0;
    const idx = lyrics.findIndex((lyric, i) => {
      const currStart = lyric?.[0] ?? 0;
      const nextStart = lyrics[i + 1]?.[0] ?? Number.POSITIVE_INFINITY;
      return t >= currStart && t < nextStart;
    });

    if (idx !== -1 && idx !== currentLyricIndex) {
      setCurrentLyricIndex(idx);
      const el = lyricRefs.current[idx];
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  // ✅ 오디오 파일 경로 확정 + 사전 존재 확인
  const [audioSrc, setAudioSrc] = useState("");
  useEffect(() => {
    const k = keyOf(songTitle, artist);
    const src = MR_MAP[k];
    if (!src) {
      setAudioSrc("");
      setAudioError(
        `MR 파일 매핑을 찾을 수 없습니다: [${songTitle} - ${artist}]`
      );
      console.warn("MR_MAP 미존재:", k);
      return;
    }
    (async () => {
      try {
        const head = await fetch(src, { method: "HEAD" });
        if (!head.ok) throw new Error(`HTTP ${head.status}`);
        setAudioSrc(src);
        setAudioError("");
      } catch (e) {
        setAudioSrc("");
        setAudioError(
          `오디오 파일을 불러오지 못했습니다 (${src}). public/mr 경로와 파일명을 확인하세요.`
        );
        console.error("Audio HEAD fail:", e);
      }
    })();
  }, [songTitle, artist]);

  // ===== 서버에 "분석 시작" 트리거 =====
  async function startAnalysis({ songTitle, artist }) {
    try {
      await fetch(`${API_BASE}/vocal_analysis/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ songTitle, artist }),
      });
    } catch (e) {
      console.warn("start analysis failed:", e);
    }
  }

  // ===== 공통: 재생 + 녹음 시작 =====
  const beginPlaybackAndRecording = async () => {
    const audio = audioRef.current;
    if (!audio) {
      console.error("오디오 참조가 null입니다.");
      return;
    }
    if (!audioSrc) {
      alert(audioError || "오디오 소스를 찾을 수 없습니다.");
      return;
    }

    // 현재 곡/가수 세션 확정
    try {
      await safeFetchJSON(`${API_BASE}/training`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songTitle, artist }),
      });
    } catch (e) {
      console.warn("training(set session) failed:", e);
    }

    const playAudio = () => {
      audio
        .play()
        .then(() => {
          setIsPlaying(true);
          setIsPaused(false);
          console.log("오디오 재생 시작");
        })
        .catch((e) => {
          console.error("오디오 재생 실패:", e);
          alert("오디오 재생에 실패했습니다. 콘솔 로그를 확인하세요.");
        });
    };

    if (audio.readyState >= 3) playAudio();
    else {
      const onCanPlay = () => {
        audio.removeEventListener("canplay", onCanPlay);
        playAudio();
      };
      audio.addEventListener("canplay", onCanPlay);
      audio.load();
    }

    // 마이크 녹음 시작
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      setMediaRecorder(recorder);

      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) chunks.push(event.data);
      };
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        setRecordedChunks(chunks);
        console.log("녹음된 Blob:", blob);
        await uploadToServer(blob);
        stream.getTracks().forEach((t) => t.stop());
      };

      recorder.start();
      console.log("녹음 시작");
    } catch (error) {
      console.error("녹음 시작 오류:", error);
      // 권한 거부 등이어도 음악 재생은 계속 가능
    }
  };

  // ===== 공통: 재개(일시정지 상태에서) =====
  const resumePlaybackAndRecording = () => {
    const audio = audioRef.current;
    // 녹음 재개
    if (mediaRecorder && mediaRecorder.state === "paused") {
      try {
        mediaRecorder.resume();
      } catch (e) {
        console.warn("MediaRecorder resume 실패:", e);
      }
    }
    // 오디오 재개
    if (audio) {
      audio
        .play()
        .then(() => {
          setIsPlaying(true);
          setIsPaused(false);
          console.log("오디오 재개");
        })
        .catch((e) => {
          console.error("오디오 재개 실패:", e);
        });
    }
  };

  // ===== 공통 종료(버튼/자동) =====
  const doStopAndGoFeedback = async () => {
    if (finishingRef.current) return; // ✅ 중복 방지
    finishingRef.current = true;

    const audio = audioRef.current;

    // 녹음 정지
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      try {
        mediaRecorder.stop();
      } catch (e) {
        console.warn("MediaRecorder stop 실패:", e);
      }
    }

    // 오디오 정지 및 위치 초기화
    if (audio) {
      try {
        audio.pause();
      } catch {}
      audio.currentTime = 0;
    }

    setIsPlaying(false);
    setIsPaused(false);

    // 업로드는 onstop에서 진행 → 그 직후 서버 분석 트리거
    // 여기서는 바로 피드백 페이지로 이동(피드백에서 로딩/폴링)
    navigate("/feedback", { state: { songTitle, artist, imagePath } });
  };

  // ===== 버튼 핸들러 =====
  const handleStart = async () => {
    playbackActionRef.current = "start";
    startAfterCountdownRef.current = true;
    setShowSplash(true);
  };

  const handlePause = () => {
    const audio = audioRef.current;
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.pause();
    }
    if (audio) audio.pause();
    setIsPaused(true);
    setIsPlaying(false);
  };

  const handleResume = () => {
    playbackActionRef.current = "resume";
    startAfterCountdownRef.current = true;
    setShowSplash(true);
  };

  // (사용자 수동 정지)
  const handleStop = async () => {
    await doStopAndGoFeedback();
  };

  // (자동: 노래가 끝나면)
  const handleAudioEnded = async () => {
    await doStopAndGoFeedback();
  };

  // 서버 업로드 (✅ /uploads/tone) → 업로드 성공 시 분석 시작
  const uploadToServer = async (blob) => {
    const formData = new FormData();
    formData.append("audio", blob, "recording.webm");
    try {
      const result = await safeFetchJSON(`${API_BASE}/uploads/tone`, {
        method: "POST",
        body: formData,
      });
      console.log("업로드 응답:", result);

      // ✅ 업로드 성공 → 분석 시작
      await startAnalysis({ songTitle, artist });
    } catch (error) {
      console.error("서버로 파일 업로드 실패:", error);
    }
  };

  return (
    <div className="body">
      <div className="container">
        <div className="immediate_feedback_analyze">
          <div className="song_container">
            <div className="recording_status">
              {isPlaying ? "녹음 중" : isPaused ? "일시정지" : "대기 중"}
            </div>

            <div className="song_info_container">
              <div className="song_img">
                <img src={imagePath} alt={songTitle} />
              </div>
              <div>
                <div className="song_name ">{songTitle}</div>
                <div className="song_artist">{artist}</div>
              </div>
            </div>

            <div className="song_lyrics_container">
              <div className="lyrics_header">
                <img src={`${PUB}/img/lyrics.png`} alt={songTitle} />
                <span>Lyrics</span>
              </div>
              <div className="lyrics_text">
                {(lyrics || []).map((lyric, index) => {
                  const text = Array.isArray(lyric)
                    ? lyric[1]
                    : String(lyric || "");
                  return (
                    <p
                      key={index}
                      ref={(el) => (lyricRefs.current[index] = el)}
                      className={
                        index === currentLyricIndex ? "highlighted-lyric" : ""
                      }
                    >
                      {text}
                    </p>
                  );
                })}
                {!lyrics?.length && (
                  <p style={{ opacity: 0.7 }}>
                    가사를 불러오는 중이거나 가사가 없습니다.
                  </p>
                )}
              </div>
            </div>

            {/* 오류 메시지 표시 */}
            {audioError && (
              <div style={{ color: "#f55", fontSize: 14, marginTop: 8 }}>
                {audioError}
              </div>
            )}

            <div className="btn_container">
              {/* Play / Pause / Resume */}
              <div className="playbtn_container">
                <img
                  src={
                    isPlaying
                      ? `${PUB}/img/stopbtn.png`
                      : isPaused
                      ? `${PUB}/img/playbtn.png`
                      : `${PUB}/img/playbtn.png`
                  }
                  alt="Play or Pause Button"
                  onClick={
                    isPlaying
                      ? handlePause
                      : isPaused
                      ? handleResume
                      : handleStart
                  }
                />
                <p className="btn_text">
                  {isPlaying ? "일시정지" : isPaused ? "재개" : "재생"}
                </p>
              </div>

              {/* Stop */}
              <div className="stopbtn_container">
                <img
                  src={`${PUB}/img/pausebtn.png`}
                  alt="Stop Button"
                  onClick={handleStop}
                  style={{
                    opacity: isPlaying || isPaused ? 1 : 0.5,
                    cursor: isPlaying || isPaused ? "pointer" : "not-allowed",
                  }}
                />
                <p className="btn_text">정지</p>
              </div>
            </div>

            <audio
              ref={audioRef}
              src={audioSrc || undefined}
              preload="auto"
              onTimeUpdate={handleTimeUpdate}
              onEnded={handleAudioEnded} // ✅ 노래 끝 → 자동 종료 & 피드백 이동
              onError={(e) => {
                console.error("HTMLAudioElement error", e);
                setAudioError(
                  "오디오 요소 로딩 중 오류가 발생했습니다. 콘솔 로그를 확인하세요."
                );
              }}
            />
          </div>

          {showToneAdjuster && (
            <Training_Tone
              onPitchChange={handlePitchChange}
              tone={tone}
              setTone={setTone}
              onFinish={handleToneAdjusterFinish}
            />
          )}
          {showSplash && <Training_Splash onFinish={handleSplashFinish} />}
        </div>
        <Footer activeTab="training" />
      </div>
    </div>
  );
}

export default Immediate_feedback_analyze;
