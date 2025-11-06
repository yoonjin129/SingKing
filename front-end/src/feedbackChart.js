import React, { useMemo } from "react";
import { useLocation } from "react-router-dom";
import "./feedback.css";
import "./common/root.css";
import Footer from "./common/Footer";
import Chart from "react-apexcharts";

const toNum = (v) => (Number.isFinite(+v) ? +v : 0);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

// ===== 시간축 라벨(stepSecs 간격) =====
function makeTimeCategories(totalSecs = 20, stepSecs = 5) {
  const cats = [];
  for (let i = 0; i <= totalSecs; i += stepSecs) cats.push(`${i}s`);
  return cats;
}

// ===== 상승형 추세 데이터 (길이에 맞춰 생성) =====
function makeTrendSeriesByLength(target, count) {
  const tgt = Math.min(100, Math.max(0, +target));
  const start = tgt * 0.55;
  const arr = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1 || 1);
    const y = start + (tgt - start) * easeOutCubic(t);
    arr.push(Number(y.toFixed(2)));
  }
  return arr;
}

// ===== 공통 그래프 옵션 =====
function makeLineOptions(title, categories) {
  return {
    chart: {
      type: "line",
      toolbar: { show: false },
      zoom: { enabled: false },
      animations: { enabled: true, easing: "easeinout", speed: 300 },
    },
    title: { text: title, style: { fontWeight: 700, fontSize: "16px" } },
    stroke: { curve: "smooth", width: 4 },
    markers: { size: 0, hover: { size: 4 } },
    colors: ["#3b82f6"],
    grid: { borderColor: "#e5e7eb", strokeDashArray: 4 },
    dataLabels: { enabled: false },
    xaxis: {
      categories,
      title: { text: "Time (sec)" },
      labels: { style: { fontWeight: 500 } },
    },
    yaxis: {
      min: 0,
      max: 100,
      tickAmount: 5,
      labels: { formatter: (v) => v.toFixed(0) },
    },
    tooltip: {
      x: { formatter: (_, { dataPointIndex }) => categories[dataPointIndex] },
      y: { formatter: (v) => `${v.toFixed(2)}점` },
    },
  };
}

// ===== 피드백 메시지 =====
function feedbackMsg(score) {
  const s = toNum(score);
  if (s < 60) return { h: "부족합니다!", t: "조금 더 연습이 필요해요." };
  if (s < 80) return { h: "좋아요!", t: "꾸준히 연습하면 완벽해집니다!" };
  return { h: "훌륭합니다!", t: "아주 안정적인 실력이에요!" };
}

export default function FeedbackChart() {
  const location = useLocation();
  const {
    artist,
    songTitle,
    imagePath,
    durationSecs = 270, // 넘어와도 무시하고 20초로 자름
    pitchScore = 0,
    beatScore = 0,
    pronunciationScore = 0,
  } = location.state || {};

  const pitch = toNum(pitchScore);
  const beat = toNum(beatScore);
  const pron = toNum(pronunciationScore);

  // ✅ 항상 20초까지만 표시
  const EFFECTIVE_DURATION = 20; // seconds
  const STEP = 5; // label spacing (sec)

  // 시간축(0,5,10,15,20)
  const categories = useMemo(
    () => makeTimeCategories(EFFECTIVE_DURATION, STEP),
    []
  );

  // 각 파트별 추세선 (길이 = categories.length)
  const pitchSeries = [
    { name: "Pitch", data: makeTrendSeriesByLength(pitch, categories.length) },
  ];
  const beatSeries = [
    { name: "Beat", data: makeTrendSeriesByLength(beat, categories.length) },
  ];
  const pronSeries = [
    {
      name: "Pronunciation",
      data: makeTrendSeriesByLength(pron, categories.length),
    },
  ];

  const pitchOpts = makeLineOptions("음정 그래프", categories);
  const beatOpts = makeLineOptions("박자 그래프", categories);
  const pronOpts = makeLineOptions("발음 그래프", categories);

  const pitchMsg = feedbackMsg(pitch);
  const beatMsg = feedbackMsg(beat);
  const pronMsg = feedbackMsg(pron);

  const CHART_WIDTH = 480;
  const CHART_HEIGHT = 320;

  return (
    <div className="body">
      <div className="container">
        <div className="feedback">
          {/* ===== 음정 그래프 ===== */}
          <div className="feedback_chart_title">
            <div className="header_title">음정 그래프</div>
          </div>
          <div
            className="feedback_component feedback_chart_component"
            style={{ gap: 12 }}
          >
            <div className="feedback_chart">
              <Chart
                key={`tune-${pitch}`}
                options={pitchOpts}
                series={pitchSeries}
                type="line"
                width={CHART_WIDTH}
                height={CHART_HEIGHT}
              />
            </div>
            <div>
              <div className="feedback_song_info_songname feedback_header">
                {pitchMsg.h}
              </div>
              <div className="feedback_song_info_singer feedback_text">
                {pitchMsg.t}
              </div>
            </div>
          </div>

          {/* ===== 박자 그래프 ===== */}
          <div className="feedback_chart_title" style={{ marginTop: 20 }}>
            <div className="header_title">박자 그래프</div>
          </div>
          <div
            className="feedback_component feedback_chart_component"
            style={{ gap: 12 }}
          >
            <div className="feedback_chart">
              <Chart
                key={`beat-${beat}`}
                options={beatOpts}
                series={beatSeries}
                type="line"
                width={CHART_WIDTH}
                height={CHART_HEIGHT}
              />
            </div>
            <div>
              <div className="feedback_song_info_songname feedback_header">
                {beatMsg.h}
              </div>
              <div className="feedback_song_info_singer feedback_text">
                {beatMsg.t}
              </div>
            </div>
          </div>

          {/* ===== 발음 그래프 ===== */}
          <div className="feedback_chart_title" style={{ marginTop: 20 }}>
            <div className="header_title">발음 그래프</div>
          </div>
          <div
            className="feedback_component feedback_chart_component"
            style={{ gap: 12 }}
          >
            <div className="feedback_chart">
              <Chart
                key={`pron-${pron}`}
                options={pronOpts}
                series={pronSeries}
                type="line"
                width={CHART_WIDTH}
                height={CHART_HEIGHT}
              />
            </div>
            <div>
              <div className="feedback_song_info_songname feedback_header">
                {pronMsg.h}
              </div>
              <div className="feedback_song_info_singer feedback_text">
                {pronMsg.t}
              </div>
            </div>
          </div>
        </div>
      </div>
      <Footer activeTab="training" />
    </div>
  );
}
