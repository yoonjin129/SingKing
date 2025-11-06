// front-end/src/Main.js
import React, { useState, useEffect } from "react";
import "./main.css";
import "./common/root.css";
import Footer from "./common/Footer";
import WeeklyRanking from "./WeeklyRanking.js";

// 특정 '점대'로 소수점 2자리 숫자 생성 (예: 40 -> 40.00 ~ 49.99)
function randomInDecade(decade) {
  const base = Number(decade) || 0; // 40, 60, 70, 80 ...
  const val = base + Math.random() * 10; // [base, base+10)
  return Number(val.toFixed(2));
}

// 0~100 범위로 안전 클램프
function clamp100(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.min(100, Math.max(0, x));
}

// ProgressComparison 컴포넌트 정의
function ProgressComparison({ title, lastWeekValue, latestValue }) {
  const [animatedLastWeekValue, setAnimatedLastWeekValue] = useState(0);
  const [animatedLatestValue, setAnimatedLatestValue] = useState(0);

  const titleClassMap = {
    음정: "pitch",
    박자: "rhythm",
    발음: "pronunciation",
    템포: "tempo",
    볼륨: "volume",
  };
  const className = titleClassMap[title] || "default";

  useEffect(() => {
    const v1 = clamp100(lastWeekValue);
    const v2 = clamp100(latestValue);

    const timer1 = setTimeout(() => setAnimatedLastWeekValue(v1), 300);
    const timer2 = setTimeout(() => setAnimatedLatestValue(v2), 300);
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [lastWeekValue, latestValue]);

  return (
    <div className={`progress-comparison ${className}`}>
      <div className="progress-container last-week">
        <div className="progress-track">
          <div
            className={`progress-last-week ${className}`}
            style={{
              width: `${animatedLastWeekValue}%`,
              transition: "width 1.5s ease-in-out",
            }}
          />
        </div>
        <span>{animatedLastWeekValue.toFixed(2)}%</span>
      </div>

      <div className="progress-title">{title}</div>

      <div className="progress-container latest">
        <div className="progress-track">
          <div
            className={`progress-latest ${className}`}
            style={{
              width: `${animatedLatestValue}%`,
              transition: "width 1.5s ease-in-out",
            }}
          />
        </div>
        <span>{animatedLatestValue.toFixed(2)}%</span>
      </div>
    </div>
  );
}

// Main 컴포넌트
function Main() {
  const [rankingData, setRankingData] = useState([]);
  const [userData, setUserData] = useState({
    pitch: 0,
    beat: 0,
    pronunciation: 0,
    lastWeekPitch: 0,
    lastWeekBeat: 0,
    lastWeekPronunciation: 0,
    tone: "진단필요",
  });
  const [userName, setUserName] = useState("게스트");

  // 데이터 fetch 함수
  const fetchData = async () => {
    try {
      // 1) /index: 주간 랭킹 + 사용자 이름
      const resIndex = await fetch("http://localhost:5000/index", {
        credentials: "include",
      });
      const indexData = await resIndex.json();
      setRankingData(indexData.data || []);
      if (indexData.user_name) setUserName(indexData.user_name);

      // 2) /my_page: 원본 점수 (받아오긴 하지만, 아래에서 요구하는 '점대' 규칙으로 표시값을 강제 세팅)
      const resMyPage = await fetch("http://localhost:5000/my_page", {
        credentials: "include",
      });
      const myPageData = await resMyPage.json();

      // 사용자 이름이 있으면 갱신
      if (myPageData.user_name) setUserName(myPageData.user_name);

      // ============== 표시 규칙 강제 적용 ==============
      // 7일 전: 음정/박자=40점대, 발음=60점대
      const lastWeekPitch = randomInDecade(40);
      const lastWeekBeat = randomInDecade(40);
      const lastWeekPronunciation = randomInDecade(60);

      // 최신 기록: 음정/박자=70점대, 발음=80점대
      const pitch = randomInDecade(70);
      const beat = randomInDecade(70);
      const pronunciation = randomInDecade(80);

      setUserData({
        pitch,
        beat,
        pronunciation,
        lastWeekPitch,
        lastWeekBeat,
        lastWeekPronunciation,
        tone: myPageData.user_tone || "진단필요",
      });
      // ===============================================
    } catch (error) {
      console.error("Error fetching data:", error);

      // 에러 시에도 기본 규칙대로 예시값 세팅(앱이 비어 보이지 않도록)
      setUserData({
        pitch: randomInDecade(70),
        beat: randomInDecade(70),
        pronunciation: randomInDecade(80),
        lastWeekPitch: randomInDecade(40),
        lastWeekBeat: randomInDecade(40),
        lastWeekPronunciation: randomInDecade(60),
        tone: "진단필요",
      });
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div className="body">
      <div className="container">
        <div className="main">
          <div className="singing_battle">
            <div className="singking_battle_title">HOME</div>

            <div className="mypage_component">
              <div className="mypage_tone_area">
                <div>
                  <div className="battle_text_1">{userName}</div>
                  <div className="mypage_tone_logo"># {userData.tone}</div>
                </div>
                <img
                  src="./img/mypage_user_icon.png"
                  className="mypage_user_icon"
                  alt="배틀 이미지"
                />
              </div>
            </div>

            <div className="singking_grow">
              <div className="singking_grow_title">
                SINGKING과 함께 성장했어요!
              </div>
              <div className="grow_component">
                <div className="grow_component_1">
                  <img src="./img/key.png" alt="음정 아이콘" />
                  <br />
                  음정
                  <br />
                  <div className="key_score">{userData.pitch.toFixed(2)}점</div>
                </div>
                <div className="grow_component_1">
                  <img src="./img/beat.png" alt="박자 아이콘" />
                  <br />
                  박자
                  <br />
                  <div className="beat_score">{userData.beat.toFixed(2)}점</div>
                </div>
                <div className="grow_component_1">
                  <img src="./img/pronun.png" alt="발음 아이콘" />
                  <br />
                  발음
                  <br />
                  <div className="pronun_score">
                    {userData.pronunciation.toFixed(2)}점
                  </div>
                </div>
              </div>
            </div>

            <div className="singking_ability">
              <div className="singking_ability_title">나의 실력은?</div>
              <div className="ability_component">
                <div className="ability_title">
                  <div className="battle_text_1 first">7일 전 </div>
                  <div className="ability_text_vs middle"> VS </div>
                  <div className="battle_text_1 last">최신 기록</div>
                </div>

                <ProgressComparison
                  title="음정"
                  lastWeekValue={userData.lastWeekPitch}
                  latestValue={userData.pitch}
                />
                <ProgressComparison
                  title="박자"
                  lastWeekValue={userData.lastWeekBeat}
                  latestValue={userData.beat}
                />
                <ProgressComparison
                  title="발음"
                  lastWeekValue={userData.lastWeekPronunciation}
                  latestValue={userData.pronunciation}
                />
              </div>
            </div>

            <div className="weekly_ranking">
              <div className="weekly_ranking_title">주간 랭킹</div>
              <div className="weekly_ranking_component battle_text_2">
                <WeeklyRanking rankingData={rankingData} />
              </div>
            </div>
          </div>
        </div>
        <Footer />
      </div>
    </div>
  );
}

export default Main;
