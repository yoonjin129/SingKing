// front-end/src/WeeklyRanking.js
import React, { useMemo } from "react";

const PUB = process.env.PUBLIC_URL || "";

function formatDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

const WeeklyRanking = () => {
  const names = ["김윤진", "정아인", "김지연", "양효재", "송찬혁"];

  const rankingData = useMemo(() => {
    const list = names.map((name) => ({
      user_name: name,
      score: Number((Math.random() * 50 + 50).toFixed(2)), // 50~100점
    }));
    list.sort((a, b) => b.score - a.score);
    return list.map((item, idx) => ({ ...item, rank: idx + 1 }));
  }, []);

  if (!rankingData.length) return null;

  const top = rankingData[0];
  const rest = rankingData.slice(1, 5);
  const dateLabel = formatDate();

  return (
    <div className="wr-wrap">
      <div className="wr-header">
        <div className="wr-title">주간 랭킹</div>
        <div className="wr-date">{dateLabel} 기준 (7일마다 업데이트)</div>
      </div>

      <div className="wr-card">
        <div className="wr-top">
          <div className="wr-top-left">
            <div className="wr-top-badge">TOP</div>
            <div className="wr-top-rank">1</div>
          </div>

          <div className="wr-top-main">
            <img
              className="wr-avatar lg"
              src={`${PUB}/img/mypage_user_icon.png`}
              alt="user"
            />
            <div className="wr-top-name">{top.user_name}</div>
          </div>

          <div className="wr-top-score">{top.score.toFixed(2)}</div>
        </div>

        <div className="wr-divider" />

        <div className="wr-list">
          {rest.map((item) => (
            <div key={item.rank} className="wr-row">
              <div className="wr-row-left">
                <div className="wr-index">{item.rank}</div>
                <img
                  className="wr-avatar sm"
                  src={`${PUB}/img/mypage_user_icon.png`}
                  alt="user"
                />
                <div className="wr-name">{item.user_name}</div>
              </div>
              <div className="wr-score">{item.score.toFixed(2)}</div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .wr-wrap{
          width: 100%;
          max-width: 600px;
          margin: 0 auto 60px;
          padding: 0 20px;
          box-sizing: border-box;
        }

        .wr-header{
          display:flex;
          align-items:baseline;
          gap:10px;
          margin: 10px 0 12px;
        }
        .wr-title{
          font-weight:800;
          font-size:20px;
          color:#374151;
        }
        .wr-date{
          font-size:12px;
          color:#9CA3AF;
        }

        .wr-card{
          background:#fff;
          border:1px solid #E5E7EB;
          border-radius:18px;
          padding: 20px 18px 35px; /* ⬅️ 하단만 살짝 줄임 */
          box-shadow: 0 8px 20px rgba(0,0,0,0.06);
        }

        /* TOP 1 */
        .wr-top{
          display:grid;
          grid-template-columns: 70px 1fr auto;
          align-items:center;
          gap: 14px;
          padding-bottom: 12px; /* ⬅️ 살짝 줄임 (16 → 12) */
        }
        .wr-top-left{
          display:flex;
          flex-direction:column;
          align-items:center;
          gap:6px;
        }
        .wr-top-badge{
          font-size:12px;
          font-weight:800;
          color:#4F46E5;
          background:#EEF2FF;
          border-radius:8px;
          padding:5px 9px;
        }
        .wr-top-rank{
          font-size:22px;
          font-weight:900;
          color:#1F2937;
        }
        .wr-top-main{
          display:flex;
          align-items:center;
          gap:14px;
        }
        .wr-top-name{
          font-size:19px;
          font-weight:800;
          color:#111827;
        }
        .wr-top-score{
          font-size:18px;
          font-weight:900;
          color:#111827;
          font-variant-numeric: tabular-nums;
        }

        .wr-avatar{
          border-radius:50%;
          background:#EEF2FF;
          border:2px solid #C7D2FE;
          object-fit:cover;
        }
        .wr-avatar.lg{
          width:64px;
          height:64px;
        }
        .wr-avatar.sm{
          width:40px;
          height:40px;
        }

        .wr-divider{
          height:1px;
          background:#E5E7EB;
          margin: 10px 0;  /* ⬅️ 구분선 여백 줄임 (14 → 10) */
        }

        .wr-list{
          display:flex;
          flex-direction:column;
          gap:10px; /* ⬅️ 행 간격 줄임 (12 → 10) */
        }
        .wr-row{
          display:flex;
          align-items:center;
          justify-content:space-between;
          padding: 8px 8px; /* ⬅️ 행 내부 패딩 줄임 (10 → 8) */
          border-radius:12px;
          transition: background 0.25s;
        }
        .wr-row:hover{ background:#F9FAFB; }
        .wr-row-left{
          display:flex;
          align-items:center;
          gap:14px;
        }
        .wr-index{
          width:24px;
          text-align:center;
          font-weight:800;
          color:#1E3A8A;
        }
        .wr-name{
          font-size:16px;
          font-weight:700;
          color:#111827;
        }
        .wr-score{
          font-size:15px;
          font-weight:800;
          color:#374151;
          font-variant-numeric: tabular-nums;
        }

        @media (max-width: 600px){
          .wr-card{ padding:18px 16px 10px; } /* 모바일에서도 하단 여백 축소 */
          .wr-top-name{ font-size:17px; }
          .wr-top-score{ font-size:16px; }
        }
      `}</style>
    </div>
  );
};

export default WeeklyRanking;
