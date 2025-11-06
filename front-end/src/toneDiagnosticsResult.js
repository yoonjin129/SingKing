import React, { useState, useEffect } from "react";
import Footer from "./common/Footer";
import { Link, useLocation, useNavigate } from "react-router-dom";
import "./common/root.css";
import "./training.css";
import "./toneDiagnostics.css";

const aiResultMap = {
  ballade: {
    result_img: "./img/singers/cover_jung_seung_hwan_big.png",
    result_content: "따뜻하고 감성적인 발라드형 음색입니다.",
  },
  dance: {
    result_img: "./img/singers/cover_hwasa_big.png",
    result_content: "음색이 뚜렷한 댄스형 음색입니다.",
  },
  rock: {
    result_img: "./img/singers/cover_yoon_do_hyun_big.png",
    result_content: "음역대가 높고 안정적인 호흡의 락형 음색입니다.",
  },
  Trot: {
    result_img: "./img/singers/cover_lim_young_woong_big.png",
    result_content: "독특하고 간드러지는 음색의 트로트형 음색입니다.",
  },
};

// 추천곡 고정 상수를 서버 응답 없을 때의 '기본/폴백' 값으로 사용하도록 변경
const DEFAULT_RECOMMEND_SONG = {
  recommend: "너였다면",
  artist: "정승환",
  image: "./img/songs/cover_if_it_is_you.png",
};

const normalizeTone = (rawTone) => {
  if (!rawTone) return "ballade"; // 기본값 발라드형
  const t = String(rawTone).toLowerCase();
  if (t.includes("dance")) return "dance";
  if (t.includes("rock")) return "rock";
  if (t.includes("trot")) return "Trot";
  return "ballade";
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
  const [selectedTone, setSelectedTone] = useState("ballade");
  // 초기 상태를 기본 추천 곡으로 설정
  const [selectedSong, setSelectedSong] = useState(DEFAULT_RECOMMEND_SONG);

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

  useEffect(() => {
    if (!raw) return;

    // 서버 tone 정보가 있으면 반영
    const toneKey =
      normalizeTone(
        raw?.tone ||
          raw?.result?.tone ||
          raw?.analysis?.tone ||
          raw?.latest?.tone
      ) || "ballade";
    setSelectedTone(toneKey);

    // ⭐ 서버 응답(raw.rec)에서 추천 곡 정보를 찾아서 설정
    const serverRec = raw?.rec;
    const songToUse =
      serverRec && serverRec.recommend && serverRec.artist
        ? {
            recommend: serverRec.recommend,
            artist: serverRec.artist,
            // 이미지 경로가 없으면 기본 이미지 사용
            image: serverRec.image || DEFAULT_RECOMMEND_SONG.image,
          }
        : DEFAULT_RECOMMEND_SONG; // 서버 데이터 없으면 기본값 사용

    setSelectedSong(songToUse);
  }, [raw]);

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
              ) : (
                <>
                  <img
                    className="tone_diagnostics_result_img"
                    src={aiResultMap[selectedTone].result_img}
                    alt="AI cover 이미지"
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
                {/* ⭐ 동적 상태 변수 selectedSong 사용 */}
                <div className="ai_text_1 tone_text_1">
                  {selectedSong.recommend}
                </div>
                <div className="ai_text_2">{selectedSong.artist}</div>
                <img
                  className="tone_diagnostics_result_img"
                  src={selectedSong.image}
                  alt={selectedSong.recommend}
                />
              </div>
            </div>

            <div className="drag_menu_component drag_menu_component_ai">
              <Link
                to="/immediate_feedback_analyze"
                state={{
                  tone: selectedTone,
                  song: selectedSong,
                }}
              >
                <div className="drag_menu_component_1 drag_menu_component_1_short tone_border">
                  <img
                    className="ai_precise_img"
                    src="./img/ai_precise_img_1.png"
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
                    src="./img/ai_precise_img_3.png"
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
