import React, { useState, useEffect, useRef } from "react";
import Footer from "./common/Footer";
import { Link, useLocation, useNavigate } from "react-router-dom";
import "./common/root.css";
import "./training.css";
import "./toneDiagnostics.css";

const aiResultMap = {
  ballade: {
    result_img: "/img/singers/cover_jung_seung_hwan_big.png",
    result_content: "따뜻하고 감성적인 발라드형 음색입니다.",
  },
  dance: {
    result_img: "/img/singers/cover_hwasa_big.png",
    result_content: "음색이 뚜렷한 댄스형 음색입니다.",
  },
  rock: {
    result_img: "/img/singers/cover_yoon_do_hyun_big.png",
    result_content: "음역대가 높고 안정적인 호흡의 락형 음색입니다.",
  },
  Trot: {
    result_img: "/img/singers/cover_lim_young_woong_big.png",
    result_content: "독특하고 간드러지는 음색의 트로트형 음색입니다.",
  },
};

// 톤별 추천곡 풀
const SONGS_BY_TONE = {
  ballade: [
    {
      recommend: "너였다면",
      artist: "정승환",
      image: "/img/songs/cover_if_it_is_you.png",
    },
    {
      recommend: "밤편지",
      artist: "아이유",
      image: "/img/songs/cover_letter_at_night.png",
    },
    {
      recommend: "기억해줘요 내 모든 날과 그때를",
      artist: "거미",
      image: "/img/songs/cover_remember.png",
    },
  ],
  dance: [
    {
      recommend: "뚜두뚜두",
      artist: "블랙핑크",
      image: "/img/songs/cover_last_Circle_big.png",
    },
    {
      recommend: "MAGNETIC",
      artist: "아일릿",
      image: "/img/songs/cover_magnetic.png",
    },
    {
      recommend: "Supernova",
      artist: "에스파",
      image: "/img/songs/cover_supernova.png",
    },
  ],
  rock: [
    {
      recommend: "흰수염고래",
      artist: "윤도현",
      image: "/img/songs/cover_a_blue_whale.png",
    },
    {
      recommend: "나는 나비",
      artist: "YB",
      image: "/img/songs/cover_im_butterfly.png",
    },
    {
      recommend: "낭만 고양이",
      artist: "체리필터",
      image: "/img/songs/cover_cat_Cricle_big.png",
    },
  ],
  Trot: [
    {
      recommend: "사랑은 늘 도망가",
      artist: "임영웅",
      image: "/img/songs/cover_love_run.png",
    },
    {
      recommend: "아모르 파티",
      artist: "김연자",
      image: "/img/songs/cover_amo.png",
    },
    {
      recommend: "어머나",
      artist: "장윤정",
      image: "/img/songs/cover_oops.png",
    },
  ],
};

const DEFAULT_RECOMMEND_SONG = {
  recommend: "너였다면",
  artist: "정승환",
  image: "/img/songs/cover_if_it_is_you.png",
};

const FALLBACK_COVER = "/img/songs/cover_fallback.png";

const isLikelyValidImg = (p) =>
  typeof p === "string" &&
  (p.startsWith("/img/") ||
    p.startsWith("http://") ||
    p.startsWith("https://") ||
    /\.(png|jpe?g|webp|gif|svg)$/i.test(p));

const normalizeTone = (rawTone) => {
  if (!rawTone) return "ballade";
  const t = String(rawTone).toLowerCase();
  if (t.includes("dance")) return "dance";
  if (t.includes("rock")) return "rock";
  if (t.includes("trot")) return "Trot";
  return "ballade";
};

const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

// 최종 결과 도착 시 1회만 곡/이미지를 잠그는 훅
const useLockSong = (initialSong) => {
  const locked = useRef(false);
  const [displaySong, setDisplaySong] = useState(initialSong);
  const [coverSrc, setCoverSrc] = useState(initialSong.image);

  const lockWith = (song) => {
    if (locked.current) return;
    locked.current = true;
    setDisplaySong(song);
    setCoverSrc(song.image || initialSong.image);
  };

  const reset = () => {
    locked.current = false;
    setDisplaySong(initialSong);
    setCoverSrc(FALLBACK_COVER);
  };

  return { locked, displaySong, coverSrc, setCoverSrc, lockWith, reset };
};

const ToneDiagnosticsResult = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const initialRaw =
    location.state?.result ||
    (() => {
      try {
        const cached = sessionStorage.getItem("toneResult");
        return cached ? JSON.parse(cached) : null;
      } catch {
        return null;
      }
    })();

  const [raw, setRaw] = useState(initialRaw);
  const [status, setStatus] = useState(
    sessionStorage.getItem("toneResultStatus") ||
      (initialRaw ? "done" : "processing")
  );

  // 처리 중엔 null → 로딩만 노출
  const [selectedTone, setSelectedTone] = useState(null);

  // 곡 잠금 훅
  const {
    locked: coverLocked,
    displaySong,
    coverSrc,
    setCoverSrc,
    lockWith,
    reset: resetLock,
  } = useLockSong(DEFAULT_RECOMMEND_SONG);

  // 🔄 분석 재시작(=processing) 때 **완전 리셋**
  const toneLocked = useRef(false);
  useEffect(() => {
    if (status === "processing") {
      // 잠금/톤/표시 상태 초기화 — 다음 "done"에서 새 랜덤 뽑기
      toneLocked.current = false;
      resetLock();
      setSelectedTone(null);
    }
  }, [status, resetLock]);

  // 결과 폴링
  useEffect(() => {
    const pull = () => {
      const s = sessionStorage.getItem("toneResultStatus") || "processing";
      setStatus(s);
      if (s === "done") {
        const r = sessionStorage.getItem("toneResult");
        if (r) {
          try {
            const parsed = JSON.parse(r);
            setRaw(parsed);
          } catch {}
        }
      }
    };
    window.addEventListener("toneResultReady", pull);
    const iv = setInterval(pull, 500);
    return () => {
      window.removeEventListener("toneResultReady", pull);
      clearInterval(iv);
    };
  }, []);

  // ✅ 최종 서버 결과 도착: 서버 톤으로 확정, 곡은 그 톤 풀에서 랜덤 1곡으로 확정(한 번만)
  useEffect(() => {
    if (!raw) return;

    // 1) 서버 판정 톤
    const toneKey =
      normalizeTone(
        raw?.tone ||
          raw?.result?.tone ||
          raw?.analysis?.tone ||
          raw?.latest?.tone
      ) || "ballade";

    if (!toneLocked.current) {
      setSelectedTone(toneKey);
      toneLocked.current = true;
    }

    // 2) 해당 톤 풀에서 랜덤 1곡
    const pool = SONGS_BY_TONE[toneKey] || [DEFAULT_RECOMMEND_SONG];
    const randomSong = pickRandom(pool);

    if (!coverLocked.current && isLikelyValidImg(randomSong.image)) {
      lockWith(randomSong);
    }
  }, [raw, coverLocked, lockWith]);

  const errorMessage = status.startsWith("error")
    ? `처리 중 오류가 발생했습니다: ${status}`
    : null;

  return (
    <div className="body">
      <div className="container">
        <div className="main">
          <div className="tone_diagnostics">
            <div className="header_title">AI 음색 진단 결과</div>

            <div className="tone_diagnostics_component tone_diagnostics_result_component tone_margin tone_border">
              {errorMessage ? (
                <p>{errorMessage}</p>
              ) : status !== "done" || !selectedTone ? (
                <p className="ai_text_2 tone_diagnostics_text">
                  음색 진단 중입니다…
                </p>
              ) : (
                <>
                  <img
                    className="tone_diagnostics_result_img"
                    src={aiResultMap[selectedTone].result_img}
                    alt="AI cover 이미지"
                    onError={(e) => {
                      if (!e.currentTarget.dataset.errored) {
                        e.currentTarget.dataset.errored = "1";
                        e.currentTarget.src = "/img/singers/cover_fallback.png";
                      }
                    }}
                  />
                  <p className="ai_text_2 tone_diagnostics_text">
                    {aiResultMap[selectedTone].result_content}
                  </p>
                </>
              )}
            </div>

            <div className="header_title">AI 음색 추천 곡</div>
            <div className="tone_diagnostics_component tone_diagnostics_result_component tone_border">
              <div>
                {status !== "done" || !selectedTone ? (
                  <>
                    <div className="ai_text_2">추천 곡을 준비 중…</div>
                    <img
                      className="tone_diagnostics_result_img"
                      src={FALLBACK_COVER}
                      alt="loading cover"
                      style={{ minHeight: 120, opacity: 0.5 }}
                    />
                  </>
                ) : (
                  <>
                    <div className="ai_text_1 tone_text_1">
                      {displaySong.recommend}
                    </div>
                    <div className="ai_text_2">{displaySong.artist}</div>
                    <img
                      className="tone_diagnostics_result_img"
                      src={coverSrc}
                      alt={displaySong.recommend}
                      onError={(e) => {
                        const fallbackAbs =
                          window.location.origin + FALLBACK_COVER;
                        if (e.currentTarget.src !== fallbackAbs) {
                          e.currentTarget.src = FALLBACK_COVER;
                          setCoverSrc(FALLBACK_COVER);
                        }
                      }}
                      style={{ minHeight: 120 }}
                    />
                  </>
                )}
              </div>
            </div>

            <div className="drag_menu_component drag_menu_component_ai">
              <Link
                to="/immediate_feedback_analyze"
                state={{
                  tone: selectedTone || "ballade",
                  song: displaySong, // 최종 랜덤 선택된 곡
                }}
              >
                <div className="drag_menu_component_1 drag_menu_component_1_short tone_border">
                  <img
                    className="ai_precise_img"
                    src="/img/ai_precise_img_1.png"
                    alt="정밀 이미지1"
                  />
                  <div className="ai_text">
                    <p className="ai_text_1">추천 곡 트레이닝</p>
                  </div>
                </div>
              </Link>

              <Link to="/toneDiagnostics">
                <div className="drag_menu_component_1 drag_menu_component_1_short tone_border">
                  <img
                    className="ai_precise_img"
                    src="/img/ai_precise_img_3.png"
                    alt="정밀 이미지3"
                  />
                  <div className="ai_text">
                    <p className="ai_text_1">재진단</p>
                  </div>
                </div>
              </Link>
            </div>
          </div>
        </div>
        <Footer activeTab="training" />
      </div>
    </div>
  );
};

export default ToneDiagnosticsResult;
