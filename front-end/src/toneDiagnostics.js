import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Footer from "./common/Footer";
import "./common/root.css";
import "./training.css";
import "./toneDiagnostics.css";
const API_BASE = "http://localhost:5000";

// (새로 추가) 딜레이 헬퍼 함수
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ToneDiagnostics = () => {
  const [isPlaying, setIsPlaying] = useState(false); // 녹음 중 여부
  // (새로 추가) 페이지 이동 전 "처리 중" 상태
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const navigate = useNavigate();

  // 타임아웃 포함 JSON fetch 유틸
  const fetchJSON = async (url, opts = {}, timeoutMs = 20000) => {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        credentials: "include",
        signal: ctrl.signal,
        ...opts,
      });
      const ct = res.headers.get("content-type") || "";
      const txt = await res.text();
      if (!res.ok)
        throw new Error(`HTTP ${res.status} @ ${url} :: ${txt.slice(0, 300)}`);
      if (!ct.includes("application/json"))
        throw new Error(`Non-JSON @ ${url} :: ${txt.slice(0, 300)}`);
      return JSON.parse(txt);
    } finally {
      clearTimeout(id);
    }
  };

  // 녹음 시작
  const handleStart = async () => {
    // (수정) 처리 중일 때는 녹음 시작 안 함
    if (isProcessing) return;

    try {
      // 0) 세션 정보 세팅
      await fetchJSON(`${API_BASE}/training`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artist: "AI_Vocal_Test",
          songTitle: "Tone_Analysis",
        }),
      });

      // 1) 마이크 스트림
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 44100 },
      });
      streamRef.current = stream;

      // 2) 브라우저 지원 코덱 선택
      const preferredMime =
        (window.MediaRecorder &&
          MediaRecorder.isTypeSupported("audio/webm") &&
          "audio/webm") ||
        (window.MediaRecorder &&
          MediaRecorder.isTypeSupported("audio/ogg") &&
          "audio/ogg") ||
        "";

      const recorder = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;

      const chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        try {
          const usedMime = recorder.mimeType || "audio/webm";
          const blob = new Blob(chunks, { type: usedMime });
          // (수정) 'startBackgroundPipeline'은 async
          await startBackgroundPipeline(blob); // 업로드/분석은 백그라운드, 결과 페이지가 폴링
        } catch (err) {
          console.error("녹음 처리 실패:", err);
          alert(`녹음/분석 처리 중 오류가 발생했습니다.\n${err.message}`);
          setIsProcessing(false); // (수정) 오류 시 처리 중 상태 해제
        } finally {
          // 마이크 스트림 정리
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
          }
        }
      };

      recorder.start();
      setIsPlaying(true);

      // 자동 6초 후 종료(필요 시 길이 조절)
      setTimeout(() => {
        if (recorder && recorder.state === "recording") recorder.stop();
      }, 6000);

      console.log("녹음 시작");
    } catch (error) {
      console.error("녹음 시작 오류:", error);
      alert("마이크 권한 또는 서버 상태를 확인해 주세요.");
      setIsPlaying(false); // (수정) 오류 시 재생 상태 되돌림
    }
  };

  // 녹음 종료(수동)
  const handleStop = () => {
    // (수정) 처리 중일 때는 중복 중지 안 함
    if (isProcessing) return;

    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.stop();
      console.log("녹음 종료");
    }
    setIsPlaying(false);
  };

  // 클릭 토글
  const handleToggle = () => {
    if (isPlaying) handleStop();
    else handleStart();
  };

  // (수정) 새 방식: 업로드/분석은 백그라운드, 결과 페이지는 "딜레이 후" 이동
  const startBackgroundPipeline = async (blob) => {
    // 1. (수정) "처리 중" 상태로 변경 (UI에 로딩 표시)
    setIsProcessing(true);

    const mime = blob.type || "audio/webm";
    const ext = mime.includes("webm")
      ? "webm"
      : mime.includes("ogg")
      ? "ogg"
      : "wav";

    // 2. (수정) UI가 로딩 화면으로 바뀔 시간을 주고 (100ms)
    //    인위적인 로딩 딜레이(1.5초)를 추가합니다.
    await delay(100);
    await delay(5000); // 5초 대기 (이 시간을 조절하세요)

    // 3. (수정) 결과 상태 초기화 후 즉시 이동
    sessionStorage.removeItem("toneResult");
    sessionStorage.setItem("toneResultStatus", "processing");
    // 결과 화면으로 1.5초 뒤에 전환됨
    navigate("/toneDiagnosticsResult", { state: { loading: true } });

    // 4. (수정) 페이지가 이동한 "후"에 실제 백그라운드 작업 시작
    // (isProcessing은 페이지가 바뀌므로 굳이 false로 되돌릴 필요 없음)

    // 1) 업로드 (응답이 JSON이 아닐 수 있으므로 fetch만 사용)
    try {
      const fd = new FormData();
      fd.append("audio", blob, `tone.${ext}`);
      await fetch(`${API_BASE}/uploads/tone`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
    } catch (e) {
      console.error(e);
      sessionStorage.setItem("toneResultStatus", "error:upload");
      window.dispatchEvent(new Event("toneResultReady"));
      return;
    }

    // 2) 분석 트리거
    try {
      await fetchJSON(`${API_BASE}/vocal_analysis`, { method: "POST" }, 60000);
    } catch (e) {
      console.error(e);
      sessionStorage.setItem("toneResultStatus", "error:analysis");
      window.dispatchEvent(new Event("toneResultReady"));
      return;
    }

    // 3) 결과/추천 병렬 취득
    try {
      const [latest, rec] = await Promise.all([
        fetchJSON(`${API_BASE}/result/latest`, { method: "GET" }, 20000),
        fetchJSON(`${API_BASE}/ai_tone`, { method: "GET" }, 20000),
      ]);

      const payload = { latest, rec };
      sessionStorage.setItem("toneResult", JSON.stringify(payload));
      sessionStorage.setItem("toneResultStatus", "done");
      // 같은 탭 알림(폴백으로 결과 페이지에서 setInterval도 돌려둠)
      window.dispatchEvent(new Event("toneResultReady"));
    } catch (e) {
      console.error(e);
      sessionStorage.setItem("toneResultStatus", "error:result");
      window.dispatchEvent(new Event("toneResultReady"));
    }
  };

  useEffect(() => {
    if (!isPlaying) return;
    // 플레이어 애니메이션 등 진입 시 부가 처리 필요하면 사용
  }, [isPlaying]);

  return (
    <div className="body">
      <div className="container">
        <div className="main">
          <div className="tone_diagnostics">
            <div className="header_title">AI 음색 진단</div>

            <div className="tone_diagnostics_component tone_diagnostics_mid_component">
              <div className="tone_diagnostics_lp_area">
                <img
                  className={`tone_diagnostics_lp ${
                    // (수정) isProcessing일 때도 애니메이션 유지
                    isPlaying || isProcessing
                      ? "tone_diagnostics_lp_animation"
                      : ""
                  }`}
                  src="./img/tone_diagnostics_lp.png"
                  alt="ai cover 이미지"
                />
                <img
                  className="tone_diagnostics_player"
                  src="./img/tone_diagnostics_player.png"
                  alt="ai cover 이미지"
                />
                <p className="ai_text_2 tone_diagnostics_text">
                  음색은 발라드, 락, 트로트, 댄스 4가지로 구분합니다
                </p>
              </div>
            </div>

            {/* (수정) 3단계 상태 메시지 (기본 / 녹음 중 / 처리 중) */}
            <p className="ai_text_2 tone_diagnostics_text">
              {isProcessing
                ? "분석을 시작합니다. 잠시만 기다려주세요..."
                : isPlaying
                ? "AI 분석용 녹음이 진행 중입니다"
                : "버튼을 누르고 아무 노래 한 소절을 불러주세요"}
            </p>

            <div
              className="tone_diagnostics_component tone_recording_button"
              // (수정) 처리 중(isProcessing)일 때는 클릭 비활성화
              onClick={isProcessing ? undefined : handleToggle}
              style={{ cursor: isProcessing ? "wait" : "pointer" }}
            >
              <img
                className="tone_cover_img"
                src={
                  // (수정) 녹음 중이거나 처리 중일 때 stop 이미지 표시
                  isPlaying || isProcessing
                    ? "/img/ai_precise_img_1_stop.png"
                    : "/img/ai_precise_img_1.png"
                }
                alt="ai cover 이미지"
              />
            </div>
          </div>
        </div>
        <Footer activeTab="training" />
      </div>
    </div>
  );
};

export default ToneDiagnostics;
