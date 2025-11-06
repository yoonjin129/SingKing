import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import Footer from "./common/Footer";
import "./common/root.css";
import "./main.css";

const MyPage = () => {
  const [userData, setUserData] = useState({
    level: 2, // 고정
    pitch: 45, // 고정
    beat: 60, // 고정
    tone: null, // ✅ "진단필요" 기본 제거
  });

  const [userName, setUserName] = useState("게스트");
  const navigate = useNavigate();

  useEffect(() => {
    fetch("http://localhost:5000/index", {
      method: "GET",
      credentials: "include",
    })
      .then((response) => {
        if (!response.ok) throw new Error("Network response was not ok");
        return response.json();
      })
      .then((data) => {
        if (data.status === "success" && data.user_name) {
          setUserName(data.user_name);
          setUserData((prev) => ({
            ...prev,
            level: 2,
            pitch: 45,
            beat: 60,
            // ✅ "진단필요"일 경우 tone을 null로 처리해서 표시 안 함
            tone:
              data.user_tone && data.user_tone !== "진단필요"
                ? data.user_tone
                : null,
          }));
        } else if (data.status === "fail") {
          setUserName(data.user_name || "게스트");
          setUserData((prev) => ({
            ...prev,
            level: 2,
            pitch: 45,
            beat: 60,
            tone: null,
          }));
        }
      })
      .catch((error) => {
        console.error("Error fetching user data/name:", error);
        setUserData((prev) => ({
          ...prev,
          level: 2,
          pitch: 45,
          beat: 60,
          tone: null,
        }));
      });
  }, [navigate]);

  const handleLogout = () => {
    fetch("http://localhost:5000/logout", {
      method: "POST",
      credentials: "include",
    })
      .then((response) => {
        if (response.ok) {
          setUserName("게스트");
          navigate("/login");
        } else {
          console.error("Logout failed");
        }
      })
      .catch((error) => {
        console.error("Error during logout:", error);
      });
  };

  return (
    <div className="body">
      <div className="container">
        <div className="main">
          <div className="singing_battle">
            <div className="singking_battle_title">MYPAGE</div>

            <div className="mypage_component">
              <div className="mypage_tone_area">
                <div>
                  <div className="battle_text_1">{userName}</div>
                  {/* ✅ tone이 존재할 때만 출력 */}
                  {userData.tone && (
                    <div className="mypage_tone_logo"># {userData.tone}</div>
                  )}
                </div>
                <img
                  src="/img/mypage_user_icon.png"
                  className="mypage_user_icon"
                  alt="배틀 이미지"
                />
              </div>
            </div>

            <div className="singking_grow">
              <div className="singking_grow_title">보컬 데이터 확인</div>
              <div className="grow_component">
                <div className="grow_component_1">
                  <br />
                  <span className="battle_text_1">레벨</span>
                  <br />
                  <div className="key_score graph_area">
                    <div className="graph_text">{userData.level}</div>
                    <div
                      className="graph_bar"
                      style={{ height: `${(userData.level / 100) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="grow_component_1">
                  <br />
                  <span className="battle_text_1">음정</span>
                  <br />
                  <div className="beat_score graph_area">
                    <div className="graph_text">{userData.pitch}</div>
                    <div
                      className="graph_bar"
                      style={{ height: `${(userData.pitch / 100) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="grow_component_1">
                  <br />
                  <span className="battle_text_1">박자</span>
                  <br />
                  <div className="pronun_score graph_area">
                    <div className="graph_text">{userData.beat}</div>
                    <div
                      className="graph_bar"
                      style={{ height: `${(userData.beat / 100) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="battle_component">
              <div className="battle_text">
                <span className="battle_text_1">트레이닝 기록</span>
                <span className="battle_text_2">
                  음정 점수 기록, 박자 점수 기록, 발음 점수 기록
                </span>
              </div>
            </div>

            <div className="battle_component">
              <div className="battle_text">
                <span className="battle_text_1">설정</span>
                <span className="battle_text_2">
                  회원정보, 멤버십, 공지사항, 고객센터
                </span>
              </div>
            </div>

            <div className="battle_component" onClick={handleLogout}>
              <div className="battle_text">
                <span className="battle_text_1">로그아웃</span>
                <span className="battle_text_2">서비스 사용 종료</span>
              </div>
            </div>
          </div>
        </div>

        <Footer activeTab="myPage" />
      </div>
    </div>
  );
};

export default MyPage;
