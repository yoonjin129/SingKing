import Footer from "./common/Footer";
import "./common/root.css";
import "./matching.css";
import React, { useState, useEffect } from "react"; // 👈 useState, useEffect 임포트
import { Link } from "react-router-dom";

const Matching = () => {
  // 🚨 [추가] 사용자 이름과 톤을 저장할 state 생성
  const [userName, setUserName] = useState("게스트");
  const [userTone, setUserTone] = useState("진단필요");

  // 🚨 [추가] MyPage와 동일하게 /index에서 사용자 정보를 가져오는 로직
  useEffect(() => {
    fetch("http://localhost:5000/index", {
      method: "GET",
      credentials: "include", // 세션 쿠키 포함
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Network response was not ok");
        }
        return response.json();
      })
      .then((data) => {
        if (data.status === "success" && data.user_name) {
          // 🚨 이름과 톤 업데이트
          setUserName(data.user_name);
          setUserTone(data.user_tone || "진단필요");
        } else {
          // 로그인 상태가 아닐 때 (게스트)
          setUserName(data.user_name || "게스트");
          setUserTone("진단필요");
        }
      })
      .catch((error) => {
        console.error("Error fetching user data/name:", error);
      });
  }, []); // 컴포넌트 마운트 시 한 번만 실행

  return (
    <div className="body">
      <div className="container">
        <div className="main">
          <div className="header_title header_bottom">MATCHING</div>
          <div className="mypage_component">
            <div className="mypage_tone_area">
              <div>
                {/* 🚨 [수정] "게스트" 대신 state 변수 사용 */}
                <div className="battle_text_1">{userName}</div>
                <div className="mypage_tone_logo"># {userTone}</div>
              </div>
              <img
                src=".\img\mypage_user_icon.png"
                className="mypage_user_icon"
                alt="배틀 이미지"
              />
            </div>
          </div>
          <div className="header_title header_bottom">매칭 메뉴</div>
          <Link to="/vocal_matching">
            <div className="battle_component">
              <div className="battle_text">
                <div className="battle_text_1">보컬 코치 매칭</div>
                <div className="battle_text_2">
                  전문 보컬 코치가 내 노래를 코칭합니다
                </div>
              </div>
            </div>
          </Link>
          <div className="battle_component">
            <div className="battle_text">
              <div className="battle_text_1">보컬 코치 등록</div>
              <div className="battle_text_2">
                전문 보컬 코치가 되어 노래를 가르칠 수 있습니다.
              </div>
            </div>
          </div>
          <div className="battle_component">
            <div className="battle_text">
              <div className="battle_text_1">매칭 기록</div>
              <div className="battle_text_2">
                코칭을 진행한 매칭 기록을 확인할 수 있습니다.
              </div>
            </div>
          </div>
        </div>
        <Footer activeTab="matching" />
      </div>
    </div>
  );
};

export default Matching;
