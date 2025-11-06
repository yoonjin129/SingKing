import React, { useState, useRef, useEffect, useMemo } from "react";
import "./immediate_feedback_analyze.css";
import "./common/root.css";
import "./aiCover.css";
import Footer from "./common/Footer";

const API_BASE = "http://localhost:5000";
const PUB = process.env.PUBLIC_URL || "";

const AiCover = () => {
  const [selectedSong, setSelectedSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [audioError, setAudioError] = useState("");

  // 메인 MR 오디오
  const audioRef = useRef(null);

  // ---- (선택) RVC 상태: 백엔드 붙이기 전까지는 미사용 가능 ----
  const [has5Samples, setHas5Samples] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [resultUrl, setResultUrl] = useState(null);
  const [generatingFor, setGeneratingFor] = useState(null);
  const pollTimerRef = useRef(null);

  const songs = useMemo(
    () => ({
      hug_me: { title: "안아줘", artist: "정준일" },
      if_it_is_you: { title: "너였다면", artist: "정승환" },
      wobbly_flowers: {
        title: "흔들리는 꽃들 속에서 네 샴푸 향이 느껴진 거야",
        artist: "장범준",
      },
      letter_at_night: { title: "밤편지", artist: "아이유" },
      wild_flower: { title: "야생화", artist: "박효신" },
      a_blue_whale: { title: "흰수염고래", artist: "YB" },
    }),
    []
  );

  // ✅ MR 파일 경로 (안아줘는 hug_me_sing으로 매핑)
  const MR_MAP = useMemo(
    () => ({
      // 여기만 바뀜: 안아줘 MR을 hug_me_sing으로 사용
      hug_me: `${PUB}/mr/hug_me_sing.mp3`,
      if_it_is_you: `${PUB}/mr/if_it_is_you.mp3`,
      wobbly_flowers: `${PUB}/mr/wobbly_flowers.mp3`,
      letter_at_night: `${PUB}/mr/letter_at_night.mp3`,
      wild_flower: `${PUB}/mr/wild_flower.mp3`,
      a_blue_whale: `${PUB}/mr/a_blue_whale.mp3`,
    }),
    [PUB]
  );

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/rvc/eligibility`, {
          credentials: "include",
        });
        const d = await r.json();
        setHas5Samples(!!d?.has5);
      } catch {
        setHas5Samples(false);
      }
    })();
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // 공통: HEAD 체크 유틸
  const headOK = async (url) => {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) throw new Error(`HEAD ${url} -> ${res.status}`);
    return true;
  };

  // 곡 선택 시 초기화 + 소스 세팅
  const handleSongSelect = async (songKey) => {
    const next = selectedSong === songKey ? null : songKey;
    setSelectedSong(next);

    // 플레이어 초기화
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.removeAttribute("src");
    }
    setIsPlaying(false);
    setIsPaused(false);
    setResultUrl(null);
    setGeneratingFor(null);
    setJobId(null);
    setJobStatus(null);
    setAudioError("");

    // 미선택이면 끝
    if (!next) return;

    // MR 세팅
    const mrSrc = MR_MAP[next];
    if (!mrSrc) {
      setAudioError(
        `MR 매핑을 찾을 수 없습니다. public/mr/에 파일이 있는지 확인하세요. (key=${next})`
      );
      return;
    }

    try {
      await headOK(mrSrc);
      if (audioRef.current) audioRef.current.src = mrSrc;
    } catch (e) {
      setAudioError(
        `오디오 파일 접근 실패(MR): ${mrSrc}\npublic/mr 폴더와 파일명을 확인하세요.`
      );
    }
  };

  // 재생
  const handleStart = async () => {
    // 선택 없으면 기본 MR(안아줘 = hug_me_sing)
    if (!selectedSong) {
      const fallback = MR_MAP.hug_me; // 이미 hug_me_sing으로 매핑됨
      try {
        await headOK(fallback);
        if (audioRef.current) audioRef.current.src = fallback;
      } catch {
        setAudioError("기본 MR(hug_me_sing)을 찾을 수 없습니다.");
        return;
      }
    }

    if (!audioRef.current?.src) {
      setAudioError("오디오 소스를 설정할 수 없습니다.");
      return;
    }

    try {
      await audioRef.current.play();
      setIsPlaying(true);
      setIsPaused(false);
    } catch (e) {
      console.error("오디오 재생 실패:", e);
      setAudioError(
        "브라우저가 자동재생을 차단했거나, 파일 접근이 실패했습니다. 다시 재생을 눌러보세요."
      );
    }
  };

  // 일시정지
  const handlePause = () => {
    if (audioRef.current) audioRef.current.pause();
    setIsPlaying(false);
    setIsPaused(true);
  };

  // 정지
  const handleStop = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setIsPaused(false);
  };

  return (
    <div className="body">
      <div className="container">
        <div className="main">
          <div className="ai_training">
            <div className="header_title">AI COVER</div>

            {/* 곡 선택 UI */}
            <div className="drag_menu_component">
              <div
                className="drag_menu_component_1"
                onClick={() => handleSongSelect("hug_me")}
              >
                <img
                  className="ai_diagnosis_img"
                  src={`${PUB}/img/songs/cover_hug.png`}
                  alt="안아줘"
                />
                <div className="ai_text">
                  <p className="ai_text_1">안아줘</p>
                  <p className="ai_text_2">정준일</p>
                </div>
                {selectedSong === "hug_me" && (
                  <div className="overlay">
                    <p className="overlay_text">선택 중</p>
                  </div>
                )}
              </div>

              <div
                className="drag_menu_component_1"
                onClick={() => handleSongSelect("if_it_is_you")}
              >
                <img
                  className="ai_diagnosis_img"
                  src={`${PUB}/img/songs/cover_if_it_is_you.png`}
                  alt="너였다면"
                />
                <div className="ai_text">
                  <p className="ai_text_1">너였다면</p>
                  <p className="ai_text_2">정승환</p>
                </div>
                {selectedSong === "if_it_is_you" && (
                  <div className="overlay">
                    <p className="overlay_text">선택 중</p>
                  </div>
                )}
              </div>

              <div
                className="drag_menu_component_1"
                onClick={() => handleSongSelect("wobbly_flowers")}
              >
                <img
                  className="ai_diagnosis_img"
                  src={`${PUB}/img/songs/cover_wobbly_flowers.png`}
                  alt="흔들리는 꽃들 속에서 네 샴푸 향"
                />
                <div className="ai_text">
                  <p className="ai_text_1">
                    흔들리는 꽃들 속에서 네 샴푸 향이 느껴진 거야
                  </p>
                  <p className="ai_text_2">장범준</p>
                </div>
                {selectedSong === "wobbly_flowers" && (
                  <div className="overlay">
                    <p className="overlay_text">선택 중</p>
                  </div>
                )}
              </div>
            </div>

            <div className="drag_menu_component">
              <div
                className="drag_menu_component_1"
                onClick={() => handleSongSelect("letter_at_night")}
              >
                <img
                  className="ai_diagnosis_img"
                  src={`${PUB}/img/songs/cover_letter_at_night.png`}
                  alt="밤편지"
                />
                <div className="ai_text">
                  <p className="ai_text_1">밤편지</p>
                  <p className="ai_text_2">아이유</p>
                </div>
                {selectedSong === "letter_at_night" && (
                  <div className="overlay">
                    <p className="overlay_text">선택 중</p>
                  </div>
                )}
              </div>

              <div
                className="drag_menu_component_1"
                onClick={() => handleSongSelect("wild_flower")}
              >
                <img
                  className="ai_diagnosis_img"
                  src={`${PUB}/img/songs/cover_wild_flower.png`}
                  alt="야생화"
                />
                <div className="ai_text">
                  <p className="ai_text_1">야생화</p>
                  <p className="ai_text_2">박효신</p>
                </div>
                {selectedSong === "wild_flower" && (
                  <div className="overlay">
                    <p className="overlay_text">선택 중</p>
                  </div>
                )}
              </div>

              <div
                className="drag_menu_component_1"
                onClick={() => handleSongSelect("a_blue_whale")}
              >
                <img
                  className="ai_diagnosis_img"
                  src={`${PUB}/img/songs/cover_a_blue_whale.png`}
                  alt="흰수염고래"
                />
                <div className="ai_text">
                  <p className="ai_text_1">흰수염고래</p>
                  <p className="ai_text_2">YB</p>
                </div>
                {selectedSong === "a_blue_whale" && (
                  <div className="overlay">
                    <p className="overlay_text">선택 중</p>
                  </div>
                )}
              </div>
            </div>

            <div className="training_ai_cover_component ai_message">
              <div className="ai_text">
                <div className="ai_text_1">
                  {selectedSong ? songs[selectedSong].title : "AI 커버"}
                </div>
                <p className="ai_text_2">
                  {selectedSong ? songs[selectedSong].artist : ""}
                </p>
                <p className="ai_text_2">
                  {selectedSong
                    ? "선택 중"
                    : "원하는 노래를 선택하면 AI 커버를 만들어줍니다"}
                </p>
              </div>
            </div>

            {/* 에러 메시지 */}
            {audioError && (
              <div style={{ color: "#f55", fontSize: 14, marginTop: 8 }}>
                {audioError}
              </div>
            )}

            <div className="btn_container">
              <div className="playbtn_container">
                <img
                  src={`${PUB}${
                    isPlaying ? "/img/stopbtn.png" : "/img/playbtn.png"
                  }`}
                  alt="Play or Pause Button"
                  onClick={isPlaying ? handlePause : handleStart}
                />
                <p className="btn_text">
                  {isPlaying ? "일시정지" : isPaused ? "재개" : "재생"}
                </p>
              </div>

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

            {/* 단일 오디오만 사용 */}
            <audio
              ref={audioRef}
              preload="auto"
              onPlay={() => {
                setIsPlaying(true);
                setIsPaused(false);
              }}
              onEnded={() => {
                setIsPlaying(false);
                setIsPaused(false);
              }}
              onError={(e) => {
                console.error("MR HTMLAudioElement error", e);
                setAudioError(
                  "오디오 로딩 중 오류가 발생했습니다. 파일 경로를 확인하세요."
                );
              }}
            />
          </div>
        </div>
        <Footer activeTab="training" />
      </div>
    </div>
  );
};

export default AiCover;
