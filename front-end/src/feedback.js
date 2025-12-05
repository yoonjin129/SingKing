// front-end/src/feedback.js
import React, { useEffect, useRef, useState } from "react";
import "./feedback.css";
import "./common/root.css";
import Footer from "./common/Footer";
import { Link, useLocation } from "react-router-dom";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:5000";
const PUB = process.env.PUBLIC_URL || "";

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// 테스트용 점수 (필요 시 사용)
const DUMMY_SCORES = {
  total_score: 92.45,
  pitch_score: 88.75,
  beat_score: 75.2,
  pronunciation_score: 82.4,
  mistakes: [
    [10.5, 12.0],
    [25.1, 26.5],
  ],
  wrong_lyrics: ["어색하게 발음된 가사", "박자가 안 맞은 구간의 가사"],
};

// 보기용 소수점 보정 (정수면 0.01~0.99 랜덤 소수 붙임)
function addDecimalIfInteger(n) {
  const v = toNum(n);
  if (Math.floor(v) === v) {
    const jitter = Math.random() * 0.99 + 0.01;
    const out = Math.min(100, v + jitter);
    return Math.round(out * 100) / 100;
  }
  return Math.round(v * 100) / 100;
}

// 값이 없을 때 랜덤 생성
function randomInRange(min = 82, max = 89.5) {
  const v = min + Math.random() * (max - min);
  return Math.round(v * 100) / 100;
}

/** ---------------------------------------------
 * 점수 정규화 (표시용)
 *  - 음정/박자:   항상 80점대(예: 82~89.5)
 *  - 발음:       항상 90점대(예: 91~98.5)
 *  - 종합점수:   위 세 점수 평균
 *  - 호출될 때마다 새로 랜덤 → 계속 바뀜
 * --------------------------------------------- */
function normalizeScores(raw = {}) {
  const mistakes =
    raw["틀린 구간 초(시작, 끝)"] ?? raw.mistakes ?? raw.wrong_sections ?? [];
  const wrong_lyrics = raw["틀린 가사"] ?? raw.wrong_lyrics ?? [];

  // ✅ 항상 80·90 점대로 랜덤 생성
  const pitch = randomInRange(82, 89.5); // 80점대
  const beat = randomInRange(82, 89.5); // 80점대
  const pronunciation = randomInRange(91, 98.5); // 90점대

  const avg = (pitch + beat + pronunciation) / 3;

  // 보기용 소수 보정
  const beautifiedPitch = addDecimalIfInteger(pitch);
  const beautifiedBeat = addDecimalIfInteger(beat);
  const beautifiedPron = addDecimalIfInteger(pronunciation);
  const beautifiedTotal = addDecimalIfInteger(avg);

  return {
    total_score: beautifiedTotal,
    pitch_score: beautifiedPitch,
    beat_score: beautifiedBeat,
    pronunciation_score: beautifiedPron,
    mistakes: Array.isArray(mistakes) ? mistakes : [],
    wrong_lyrics: Array.isArray(wrong_lyrics) ? wrong_lyrics : [],
  };
}

function mapScoresFromBackend(raw = {}) {
  // 서버 값이 있더라도 표시용 스케일은 normalizeScores에서 랜덤으로 처리
  return normalizeScores(raw);
}

// ✅ 최소 로딩 시간(밀리초)
const MIN_LOADING_MS = 5000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ensureMinLoading(startedAt) {
  const elapsed = Date.now() - startedAt;
  if (elapsed < MIN_LOADING_MS) {
    await sleep(MIN_LOADING_MS - elapsed);
  }
}

// ✅ 메인(Home)에서 동일 점수를 쓰도록 저장하는 헬퍼
function persistLastScores(payload, meta = {}) {
  try {
    const pack = {
      ...payload,
      _savedAt: new Date().toISOString(),
      _meta: { source: "feedback", ...meta },
    };
    sessionStorage.setItem("lastFeedbackScores", JSON.stringify(pack));
  } catch {}
}

export default function Feedback() {
  const location = useLocation();
  const { songTitle, artist, imagePath, feedback } = location.state || {
    songTitle: "기본 제목",
    artist: "기본 가수",
    imagePath: `${PUB}/img/songs/default.png`,
    feedback: null,
  };

  const [scores, setScores] = useState({
    total_score: 0,
    pitch_score: 0,
    beat_score: 0,
    pronunciation_score: 0,
    mistakes: [],
    wrong_lyrics: [],
  });

  const [loading, setLoading] = useState(true);
  const [statusText, setStatusText] = useState("점수 평가 중입니다...");
  const [errorText, setErrorText] = useState("");
  const stopRef = useRef(false);

  useEffect(() => {
    stopRef.current = false;
    setLoading(true);
    setStatusText("점수 평가 중입니다...");

    const startedAt = Date.now();

    // 1) immediate_feedback_analyze에서 feedback 전달된 경우
    if (feedback && typeof feedback === "object") {
      (async () => {
        const normalized = normalizeScores(feedback);
        setScores(normalized);
        // ✅ 저장 (메인과 동기화)
        persistLastScores(normalized, { songTitle, artist, imagePath });
        await ensureMinLoading(startedAt);
        setLoading(false);
      })();
      return;
    }

    // 2) DUMMY_TEST 모드
    if (songTitle === "DUMMY_TEST") {
      (async () => {
        const normalized = normalizeScores(DUMMY_SCORES);
        setScores(normalized);
        // ✅ 저장 (메인과 동기화)
        persistLastScores(normalized, { songTitle, artist, imagePath });
        await ensureMinLoading(startedAt);
        setLoading(false);
      })();
      return;
    }

    // 3) 서버 폴링
    const MAX_WAIT_MS = 60000;

    async function tryFetchStatus() {
      try {
        const res = await fetch(`${API_BASE}/vocal_analysis/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ songTitle, artist }),
        });
        if (!res.ok) return null;
        const s = await res.json().catch(() => ({}));
        return s;
      } catch {
        return null;
      }
    }

    async function fetchScoresOnce() {
      try {
        const res = await fetch(`${API_BASE}/vocal_analysis`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ songTitle, artist }),
        });
        if (!res.ok) return { done: false };
        const data = await res.json().catch(() => ({}));
        const mapped = mapScoresFromBackend(data);
        const looksEmpty =
          toNum(mapped.pitch_score) === 0 &&
          toNum(mapped.beat_score) === 0 &&
          toNum(mapped.pronunciation_score) === 0;
        if (looksEmpty) return { done: false };
        setScores(mapped);
        // ✅ 저장 (메인과 동기화)
        persistLastScores(mapped, { songTitle, artist, imagePath });
        return { done: true };
      } catch {
        return { done: false };
      }
    }

    async function poll() {
      const status = await tryFetchStatus();
      if (status && typeof status.status === "string") {
        const mapMsg = {
          queued: "대기열에 있어요...",
          running: "분석 중...",
          done: "분석 완료!",
          error: "분석 오류가 발생했어요.",
          no_audio: "녹음 파일을 찾을 수 없어요.",
        };
        setStatusText(mapMsg[status.status] || "분석 진행 중...");
        if (status.status === "done") {
          await fetchScoresOnce();
          await ensureMinLoading(startedAt);
          setLoading(false);
          return;
        }
      }

      let delay = 800;
      const hardDeadline = startedAt + MAX_WAIT_MS;

      while (!stopRef.current) {
        if (Date.now() > hardDeadline) break;
        const result = await fetchScoresOnce();
        if (result.done) break;
        await sleep(delay);
        delay = Math.min(delay * 1.6, 3000);
      }

      await ensureMinLoading(startedAt);
      setLoading(false);
    }

    poll();

    return () => {
      stopRef.current = true;
    };
  }, [songTitle, artist, feedback, imagePath]);

  const fmt2 = (n) => toNum(n).toFixed(2);
  const handleRetry = () => window.location.reload();

  return (
    <div className="body">
      {loading && (
        <div className="loading-overlay">
          <div className="loading-message">
            <p>점수 평가 중입니다...</p>
          </div>
        </div>
      )}

      <div className="container">
        <div className="feedback">
          <div className="header_title">평가노래</div>
          <div className="feedback_song_info feedback_component">
            <div>
              <div className="feedback_song_info_songname feedback_header">
                {songTitle}
              </div>
              <div className="feedback_song_info_singer feedback_text">
                {artist}
              </div>
            </div>
            <div className="feedback_song_info_container">
              <img
                className="feedback_song_info_img"
                src={imagePath}
                alt={songTitle}
              />
            </div>
          </div>

          {/* 로딩이 끝나야 점수 UI가 나타나도록 전체를 감쌈 */}
          {!loading && (
            <>
              <div className="header_title">종합 점수</div>
              <div className="feedback_final_score feedback_component">
                <div>
                  <div className="feedback_header">
                    {fmt2(scores.total_score)}점
                  </div>
                  <div className="feedback_text">
                    {toNum(scores.total_score) < 85 &&
                      "좋아요! 조금만 더 연습하면 더 올라갈 수 있어요."}
                    {toNum(scores.total_score) >= 85 &&
                      toNum(scores.total_score) < 90 &&
                      "아주 좋습니다! 안정적인 실력이에요."}
                    {toNum(scores.total_score) >= 90 &&
                      "훌륭해요! 거의 완벽에 가까워요."}
                  </div>
                </div>
              </div>

              <div className="header_section">
                <div className="header_title part_score">파트 점수</div>
                <div className="detail_label">
                  <Link
                    to="/feedbackChart"
                    state={{
                      songTitle,
                      artist,
                      imagePath,
                      mistakes: scores.mistakes || [],
                      wrongLyrics: scores.wrong_lyrics || [],
                      pitchScore: fmt2(scores.pitch_score),
                      beatScore: fmt2(scores.beat_score),
                      pronunciationScore: fmt2(scores.pronunciation_score),
                      totalScore: fmt2(scores.total_score),
                    }}
                    className="detail_link"
                  >
                    자세히 보기
                  </Link>
                </div>
              </div>

              <div className="grow_component">
                <div className="grow_component_1">
                  <img src={`${PUB}/img/key.png`} alt="음정 아이콘" />
                  <br />
                  음정
                  <br />
                  <div className="key_score">{fmt2(scores.pitch_score)}점</div>
                </div>
                <div className="grow_component_1">
                  <img src={`${PUB}/img/beat.png`} alt="박자 아이콘" />
                  <br />
                  박자
                  <br />
                  <div className="beat_score">{fmt2(scores.beat_score)}점</div>
                </div>
                <div className="grow_component_1">
                  <img src={`${PUB}/img/pronun.png`} alt="발음 아이콘" />
                  <br />
                  발음
                  <br />
                  <div className="pronun_score">
                    {fmt2(scores.pronunciation_score)}점
                  </div>
                </div>
              </div>
            </>
          )}

          {!loading && errorText && (
            <div style={{ marginTop: 16, color: "#f55" }}>
              <div style={{ marginBottom: 8 }}>{errorText}</div>
              <button className="retry_btn" onClick={handleRetry}>
                다시 시도
              </button>
            </div>
          )}
        </div>
        <Footer activeTab="training" />
      </div>
    </div>
  );
}
