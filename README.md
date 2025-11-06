# 🎤 씽킹(SingKing): 인공지능 기반 보컬 트레이닝 서비스

## 개요

**씽킹**(**SingKing**)은 인공지능(AI)과 음성 데이터 분석 기술을 활용하여, 시간과 비용의 부담 없이 누구나 쉽고 체계적으로 노래 실력을 향상시킬 수 있도록 돕는 보컬 트레이닝 서비스입니다.  
기존의 단순 영상 재생 위주의 코칭 서비스와 달리, 사용자의 노래 데이터를 분석하여 발성, 음정, 박자, 가사 전달력 등 다양한 요소에 대해 맞춤형 피드백을 제공합니다.

---

## 주요 기능 및 페이지

- **AI 음색 진단**: 사용자의 목소리를 녹음하여, 발라드/댄스/락/트로트 등 네 가지 음색 중 가장 유사한 음색을 분석 및 추천합니다. (MFCC + CNN 기반)
- **정밀 트레이닝**: 원하는 곡을 선택해 노래를 부르면, 원곡과의 음정·박자 비교, 점수 산정, 그래프 시각화, 틀린 구간 반복 연습 기능을 제공합니다.
- **음역대 진단**: 피아노 건반을 따라 부르며 자신의 음역대(1~3옥타브)와 주파수를 확인할 수 있습니다.
- **매칭 시스템**: 사용자 간 멘토-멘티 매칭, 전문가 매칭, 레벨 5 이상 사용자 멘토 등록
- **마이페이지**: 나의 음색 정보, 보컬 데이터, 트레이닝 기록 확인

<details>
<summary><h3>페이지 상세</h3></summary>

<details>
<summary><b>메인 페이지</b></summary>

서비스의 주요 정보를 한눈에 확인할 수 있습니다.

<img src="https://github.com/user-attachments/assets/952f1263-2318-409a-b476-700717aebc5f" width="40%" />

- 최상단에서 사용자 정보 확인
- 최근 정밀 트레이닝 기록, 점수 비교, 주간 랭킹 등 제공

</details>

<details>
<summary><b>트레이닝 페이지</b></summary>

노래를 부르고 실시간 피드백을 받을 수 있습니다.

<img src="https://github.com/user-attachments/assets/36b942c0-7ef2-4e69-aecd-fb53d7d33364" width="40%" />

- 4가지 핵심 트레이닝 기능 제공

</details>

<details>
<summary><b>AI 음색 진단</b></summary>

사용자의 목소리를 녹음하여, 네 가지 음색 중 가장 유사한 음색을 분석 및 추천합니다. (MFCC + CNN 기반)

<img src="https://github.com/user-attachments/assets/44b9d4db-fe26-48cc-811c-8d238f8712f2" width="40%" />
<img src="https://github.com/user-attachments/assets/b776150a-f792-44f9-bb76-b0d130e3d72c" width="40%" />

- 마이크 버튼으로 음성 녹음
- 발라드/댄스/락/트로트 중 유사 음색 분석

</details>

<details>
<summary><b>정밀 트레이닝</b></summary>

원하는 곡을 선택해 노래를 부르면, 원곡과의 음정·박자 비교, 점수 산정, 그래프 시각화, 틀린 구간 반복 연습 기능을 제공합니다.

<img src="https://github.com/user-attachments/assets/9cceae9a-cbfc-4656-961a-3c62b8dbd509" width="19%" />
<img src="https://github.com/user-attachments/assets/b965e78c-4be9-4101-824a-de1c59b697e8" width="19%" />
<img src="https://github.com/user-attachments/assets/5722ec76-cec1-4f8c-abbc-336baa6281a6" width="19%" />
<img src="https://github.com/user-attachments/assets/401ba3bf-9ba2-454e-a170-e06760d33c82" width="19%" />
<img src="https://github.com/user-attachments/assets/82197c44-afbd-4ace-8198-708f060332d7" width="19%" />

- 음정/박자 비교 및 점수 산정
- 그래프 시각화, 틀린 구간 반복 연습

</details>

<details>
<summary><b>음역대 진단</b></summary>

피아노 건반을 따라 부르며 자신의 음역대(1~3옥타브)와 주파수를 확인할 수 있습니다.

<img src="https://github.com/user-attachments/assets/c48378c5-ad99-4d79-b4f5-7259cd6844bf" width="40%" />

- 피아노 음정 따라 부르기, 주파수 시각화

</details>

<details>
<summary><b>매칭 페이지</b></summary>

사용자 간 멘토-멘티 매칭, 전문가 매칭(예정), 레벨 5 이상 사용자 멘토 등록 기능(예정)

<img src="https://github.com/user-attachments/assets/84711f62-c9e5-4fb3-8b0c-232a9d062839" width="40%" />
<img src="https://github.com/user-attachments/assets/87e46a35-395a-4bbd-a6b0-e57f4e109b85" width="40%" />

</details>

<details>
<summary><b>마이페이지</b></summary>

나의 음색 정보, 보컬 데이터, 트레이닝 기록 확인(일부 예정)

<img src="https://github.com/user-attachments/assets/dd010647-f565-43e1-8ef3-c4321c95b49f" width="40%" />

</details>
</details>

---

## 프로젝트 구조

```
ai_vocal_training/
├── back-end/                # 백엔드(Python, Flask)
│   ├── app.py               # 백엔드 메인 엔트리포인트
│   ├── module/              # AI/음성처리 모듈
│   │   ├── ai.py
│   │   ├── beat_test.py
│   │   ├── db.py
│   │   ├── karaoke.py
│   │   ├── pitch_shift.py
│   │   ├── range_check.py
│   │   ├── remove_silence.py
│   │   ├── vocal_analysis.py
│   │   └── youtube.py
│   └── pretrained_models/   # 사전학습 모델(2stems 보컬/반주 분리)
│       └── 2stems/
├── front-end/               # 프론트엔드(React)
│   ├── public/              # 정적 파일, 이미지, 오디오(MR)
│   ├── src/                 # React 소스코드
│   │   ├── common/          # 공통 컴포넌트(Header, Footer 등)
│   │   ├── components/      # 주요 UI 컴포넌트(곡 리스트, 추천 등)
│   │   ├── data/            # 데이터 파일
│   │   ├── aiCover.js       # AI 커버 기능
│   │   ├── feedback.js      # 피드백 기능
│   │   ├── immediate_feedback_analyze.js
│   │   ├── join_member.js   # 회원가입
│   │   ├── login.js         # 로그인
│   │   ├── main.js          # 메인 페이지
│   │   ├── matching.js      # 매칭 기능
│   │   ├── myPage.js        # 마이페이지
│   │   ├── precisionTraining.js # 정밀 트레이닝
│   │   ├── scale_analyze.js # 음역대 분석
│   │   ├── toneDiagnostics.js   # 음색 진단
│   │   ├── training.js      # 트레이닝
│   │   └── ...              # 기타 기능별 JS/CSS
│   └── package.json         # 프론트엔드 의존성
├── README.md                # 프로젝트 설명서
├── requirments.txt          # 백엔드 Python 패키지 목록
└── package-lock.json        # 루트 패키지
```

---

## 기술 스택

- **AI/ML**: Tensorflow, librosa
- **Back-end**: Python3, Flask
- **Front-end**: React.js, JavaScript, HTML, CSS
- **Server**: AWS EC2
- **Database**: AWS RDS(MySQL)

---

## 설치 및 실행 방법

### 1. 백엔드

```bash
cd back-end
pip install -r ../requirments.txt
python app.py
```

### 2. 프론트엔드

```bash
cd front-end
npm install
npm start
```

---

## 트러블슈팅 및 노하우

- **Flask 세션 정보 공유 문제**: CORS(app, supports_credentials=True) 및 fetch credentials: "include" 설정으로 해결
- **AWS EC2 녹음 장치 문제**: 프론트엔드에서 녹음 후 mp3 파일만 서버로 전송하는 방식으로 변경

---

## 기여 및 라이선스

- Pull Request 및 Issue 등록 환영
- 본 프로젝트는 **MIT License**를 따릅니다. 라이선스 전문은 [LICENSE](링크/to/LICENSE) 파일에서 확인하실 수 있습니다.

---

## Acknowledgements (감사 및 출처)

본 프로젝트는 다음과 같은 훌륭한 오픈소스 프로젝트들을 활용하여 개발되었습니다.

- **Vocal/Instrumental Separation Model**: 보컬과 반주 분리를 위해 [Original Project Name/Link]에서 제공하는 `2stems` 사전 학습 모델을 사용하였습니다. 이 모델은 [Model's License, e.g., MIT License]를 따릅니다.

---
