# 이 파일은 현재의 프로젝트가 아니라 이전에 수행한 프로젝트들에 대한 내용이다.


# 계좌 어플리케이션
<br>

---


## 프로젝트 소개

토스와 같은 계좌 어플리케이션입니다. 

해당 프로젝트를 통하여 트랜잭션이 오가는 상황에서의 데이터 처리와 데이터베이스 관리, 계좌 잔액의 데이터 리슨(Listen)을 통한 실시간 업데이트를 공부했습니다.

그리고 모바일 어플리케이션을 겨냥하여 UI 를 구성하였습니다.

---
## 개발자 소개

<br>

* 안상문 : 프론트엔드, 백엔드

<br>

## 기술 스택


### Development

![Next JS](https://img.shields.io/badge/Next-black?style=for-the-badge&logo=next.js&logoColor=white)
![JavaScript](https://img.shields.io/badge/javascript-%23323330.svg?style=for-the-badge&logo=javascript&logoColor=%23F7DF1E)
![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)
![Context-API](https://img.shields.io/badge/Context--Api-000000?style=for-the-badge&logo=react)
![React Query](https://img.shields.io/badge/-React%20Query-FF4154?style=for-the-badge&logo=react%20query&logoColor=white) <br>
![Firebase](https://img.shields.io/badge/firebase-a08021?style=for-the-badge&logo=firebase&logoColor=ffcd34)
![Styled Components](https://img.shields.io/badge/styled--components-DB7093?style=for-the-badge&logo=styled-components&logoColor=white)


### Enviornment

![Git](https://img.shields.io/badge/git-%23F05033.svg?style=for-the-badge&logo=git&logoColor=white)
![GitHub](https://img.shields.io/badge/github-%23121011.svg?style=for-the-badge&logo=github&logoColor=white)
![Visual Studio Code](https://img.shields.io/badge/Visual%20Studio%20Code-0078d7.svg?style=for-the-badge&logo=visual-studio-code&logoColor=white)


### Config

![Yarn](https://img.shields.io/badge/yarn-%232C8EBB.svg?style=for-the-badge&logo=yarn&logoColor=white)

<br>

## 주요 기능

1. 계좌 및 카드 신청
2. 거래내역 확인
3. 입출금 및 이체
4. 분석
5. 신용점수 확인

<br>

# 실행 결과

<img width="200" alt="화면 캡처 2025-06-02 213821" src="https://github.com/user-attachments/assets/2f4a7119-8bc6-4229-b3a7-880e2e9dba7a" />
<img width="200" alt="화면 캡처 2025-06-02 213821" src="https://github.com/user-attachments/assets/d6a9e259-6bf3-4788-adbe-efe8b6c90796" />
<img width="200" alt="화면 캡처 2025-06-02 213821" src="https://github.com/user-attachments/assets/014dbd16-c0a4-4502-a38c-b17e4570aeef" />
<img width="200" alt="화면 캡처 2025-06-02 213821" src="https://github.com/user-attachments/assets/1fb0925c-45ec-469f-9bd0-f1f7e60cdd8b" />

<br>

배포 : https://webtoon-web-service-renew.vercel.app/

로그인은 직접 Google Oauth 를 통하시면 되며, 시험용 계좌 : 1746128790915 / 1746282153766

1746128790915 : 이름/안상문
1746282153766 : 이름/김철수

<br>

## 개선점

#### 메인 페이지의 굉장히 큰 LCP 지표.
1. 해당 홈 의 LCP 가 굉장히 크게 나왔습니다. 사실 어플리케이션 특성상 홈에 기능이 모여있긴 했지만 예상보다 더 큰 결과였습니다.
2. 홈은 서버 컴포넌트인데, Next.js SSR의 이점을 버리는게 훨씬 이득이었기에 홈에 있는 모든 컴포넌트를 클라이언트 컴포넌트로 분리하여 스플리팅을 하였습니다.
3. page.tsx의 용량이 `7.2 MB` 에서 `2.1 MB` 까지 줄었으며, `LCP` 를 `4.2` 에서 `2.4`까지 줄이는데 성공했습니다.

#### Firebase 참조에서 데이터 복제로 변경
1. 유저 컬렉션에 존재하는 하위 컬렉션인 트랜잭션의 경우 트랜잭션 컬렉션의 `ID` 를 그대로 받아서 참조로 저장했습니다.
2. 하지만 이렇게 될 경우 하위 컬렉션을 받아와서 또 추가로 받아온 참조들을 이용하여 fetch 하는 방법말고는 없었습니다. _(Sanity 에서는 이것을 쿼리 한 줄로도 해결할 수 있었는데 아쉬웠습니다.))_
3. NoSQL 은 원래가 데이터 복제를 권장하는 방식으로 만들어졌고, 쿼리의 수를 줄이는 것이 성능에 가장 큰 영향을 준다는 것을 알게 됐습니다.
4. RDB 처럼 만들려했던 것이 패착으로, NoSQL 본연의 방식대로 데이터 복제로 바꿔 참조 대신 트랜잭션 데이터 그 자체를 하위 컬렉션에 추가했습니다.
5. 10개의 트랜잭션을 가져오는 기준 `280ms -> 132ms` 로 개선하였습니다.

#### CLS 개선
1. 홈에 기능들을 집약했기 때문에 단순히 로딩 스피너 만으로는 `CLS` 값을 개선할 수 없었습니다.
2. 그래서 스켈레톤 UI 를 만들어 `CLS` 값을 `0.32`에서 `0.03` 으로 개선하였습니다.

#### 보안 추가
1. 계좌 생성시 전달하는 정보를 AES + RSA 암호화.

<br>

## 후기

친구가 금융계에서 일하기때문에 만약 저도 금융계에서 일하게 된다면 이런 트랜잭션과 리슨(Listen)을 통한 실시간 업데이트를 다룰 것이 분명하므로, 해당 파트를 공부했습니다.

단순히 거래 하나를 함에도 일반적인 데이터와는 달리 많은 처리를 해줘야하였습니다. 하지만 이렇게 어려운 과정이었기에 데이터 송수신에 성공했을 때는 굉장히 보람 있었습니다.

아쉽다면, 계좌 어플리케이션에서는 정말 많은 기능들이 있지만 시간에 쫓겨 모든 기능을 구현해보지 못한 것이 아쉽습니다.

# JAPAN HOTEL RESERVATION
<br>

## 프로젝트 소개

일본 주요 지역 호텔의 정보들과 예약이 가능한 어플리케이션입니다. 

네이버에서 미용실을 예약하는 도중에 이 예약이란 것은 어떤 로직과 상태로 구성되며, 생각보다 구현이 어려울 것 같다는 생각에 만들어보게 되었습니다.

---
## 개발자 소개

<br>

* 안상문 : 프론트엔드, 백엔드
  
<br>

## 기술 스택

### Enviornment

![Git](https://img.shields.io/badge/git-%23F05033.svg?style=for-the-badge&logo=git&logoColor=white)
 ![GitHub](https://img.shields.io/badge/github-%23121011.svg?style=for-the-badge&logo=github&logoColor=white)
 ![Visual Studio Code](https://img.shields.io/badge/Visual%20Studio%20Code-0078d7.svg?style=for-the-badge&logo=visual-studio-code&logoColor=white)

### Development

![React](https://img.shields.io/badge/react-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB)
![JavaScript](https://img.shields.io/badge/javascript-%23323330.svg?style=for-the-badge&logo=javascript&logoColor=%23F7DF1E)
![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)
![Styled Components](https://img.shields.io/badge/styled--components-DB7093?style=for-the-badge&logo=styled-components&logoColor=white)
![Firebase](https://img.shields.io/badge/firebase-a08021?style=for-the-badge&logo=firebase&logoColor=ffcd34)
![Redux](https://img.shields.io/badge/redux-%23593d88.svg?style=for-the-badge&logo=redux&logoColor=white)


### Config

![Yarn](https://img.shields.io/badge/yarn-%232C8EBB.svg?style=for-the-badge&logo=yarn&logoColor=white)
  
<br>

## 주요 기능

* 호텔 정보 (별점, 지도, 사진) <br>
* 댓글 및 찜목록 <br>
* 호텔 예약 <br>

## 실행 결과

<img width="200" alt="화면 캡처 2025-06-02 213821" src="https://github.com/user-attachments/assets/4c5fbe41-473f-4664-b9cc-080f46ad6fb1" />
<img width="200" alt="화면 캡처 2025-06-02 213821" src="https://github.com/user-attachments/assets/3e9860fd-a1b2-471c-94f1-a777394088ce" />
<img width="200" alt="화면 캡처 2025-06-02 213821" src="https://github.com/user-attachments/assets/7bb1d2bb-5944-40e8-895f-581abfdcc337" />
<img width="200" alt="화면 캡처 2025-06-02 213821" src="https://github.com/user-attachments/assets/c0f083b1-f7ad-48f7-878c-5328b9b81f21" />
<img width="200" alt="화면 캡처 2025-06-02 213821" src="https://github.com/user-attachments/assets/fd2acc54-eaf4-49d0-b5af-37d131aba0ee" />


## 실행 방법

> https://hotels-app-sage.vercel.app <br>


## 개선점

#### 지연로딩으로 캐러셀 최적화

1. 초기화면의 추천 호텔 캐러셀에는 총 `20`개의 호텔리스트가 들어있습니다.
2. 하지만 모바일 기준 2개의 호텔만 캐러셀에 드러났기 때문에 나머지 `18`개의 데이터를 미리 가져올 필요가 없었습니다.
3. LazyLoadImage 컴포넌트로 보이지 않는 캐러셀의 이미지는 지연로딩하여 화면에 나타날때만 렌더링 되도록 최적화하였습니다.
4. 최적화의 결과로 `LCP`가 `2.1`초에서 `1.81`초로 감소하였습니다.
5. 하지만 캐러셀의 이미지를 자동으로 움직이도록 만들때에는 화면에 보이는 순간에 이미지가 로딩중인 모습이 계속해서 보입니다.
6. 그래서 위의 경우에는 스켈레톤 UI를 사용하는 등의 방법으로 사용자 경험을 신경써주거나, 이미지 전체를 미리 다운받아 놓는 것이 좋을 것 같습니다.

#### 큰 번들 사이즈

1. 번들 사이즈가 `4.7 MB` 나 되어, 번들을 다운받는 데에만 총 `1`초의 시간이 걸렸습니다.
2. 추천 호텔과, 인기 호텔을 스플리팅하고, 그리고 생각 외로 크기가 굉장히 큰 `React-icons` 도 추가로 스플리팅하였습니다.
3. 번들의 사이즈가 `1.5 MB` 까지 줄었으며 다운로드 시간이 `1`초에서 `0.3`초로 줄었습니다.
4. 추가로 LCP가 `1.81`에서 `1.48`까지 감소하였습니다. 

#### 호텔 상세페이지 intersection Observer 로 최적화

1. 호텔 상세페이지에는 많은 정보가 담겨있고 스크롤을 아래까지 내려야합니다.
2. 아래로 내린 곳에는 추천 호텔과 댓글 컴포넌트가 존재하는데, 이 컴포넌트들은 네트워크에 데이터를 요청합니다.
3. 위의 지연로딩과 마찬가지로 뷰포트에 들어올 때 서버에 요청을 하여 최적화를 수행합니다. 이때 `intersection Observer`를 통해 뷰포트에 들어올 때 `react-query` 의 `enabled` 를 `true` 로 만들어 데이터를 불러옵니다.
4. `LCP` 가 `1.90` 에서 `1.74` 로 감소하였습니다.
5. 하지만 스크롤을 내리면 데이터를 불러오면서 갑자기 스켈레톤 UI가 나타나는데 저는 단 한 번도 어플리케이션들을 사용하면서 이러한 경험을 해본 적이 없습니다.
6. 차라리 사용자 경험을 위해 이러한 부분을 지우고 최대한 많은 컴포넌트를 스플리팅하여 `LCP` 를 `1.60`까지 감소시켰습니다.

## 후기

예약을 구현하는 데에 어려움이 있었고 많은 데이터를 사용하는 어플리케이션이다보니 더욱 더 최적화에 힘을 써야했습니다. 
이 역시 좋은 경험이 되었고 아직 구현해보지 못한 예약 케이스에 대해 공부해봐야할 것 같습니다.


# WebtoonWebService

![Honeycam 2025-07-09 06-48-48](https://github.com/user-attachments/assets/611662c9-c1e1-44df-a91f-56ffeb5046c5)# WebtoonWebService
---

## 프로젝트 개요

<br>

점점 모바일화 되어가고 있는 사회에서 웹툰을 뗄레야 뗼 수 없는 사업입니다. 

바쁘고 피곤한 현대에 표현에 큰 제약이 없고, 빠르게 읽고 소비할 수 있는 웹툰은 영화, 드라마보다 쉽게 접근할 수 있으며 이러한 장점들은 웹툰의 산업이 빠르게 성장하도록 하였습니다.

하지만 플랫폼마다 서로 독립적이고 경쟁을 하기때문에 각 플랫폼의 정보를 얻기 쉽지않으며, 플랫폼들의 존재 조차 모른다면 좋은 웹툰을 읽을 기회를 잃게됩니다.

이러한 고민으로부터 이번 졸업 프로젝트를 진행하게 되었고, 여러 플랫폼들로 부터 많은 웹툰을 추천 받을 수 있도록 만들었습니다.

<br>

---

## 개발자 소개

<br>

* 안상문 : 프로젝트 기획, UI/UX 디자인, 프론트엔드 개발
 
<br>

---

<br>

## 기술 스택

### Environment

![Git](https://img.shields.io/badge/git-%23F05033.svg?style=for-the-badge&logo=git&logoColor=white)
![GitHub](https://img.shields.io/badge/github-%23121011.svg?style=for-the-badge&logo=github&logoColor=white)
![Visual Studio Code](https://img.shields.io/badge/Visual%20Studio%20Code-0078d7.svg?style=for-the-badge&logo=visual-studio-code&logoColor=white)

### Development

![JavaScript](https://img.shields.io/badge/javascript-%23323330.svg?style=for-the-badge&logo=javascript&logoColor=%23F7DF1E)
![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)
![Next JS](https://img.shields.io/badge/Next-black?style=for-the-badge&logo=next.js&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/tailwindcss-%2338B2AC.svg?style=for-the-badge&logo=tailwind-css&logoColor=white)
![React Query](https://img.shields.io/badge/-React%20Query-FF4154?style=for-the-badge&logo=react%20query&logoColor=white)
![SANITY](https://img.shields.io/badge/SANITY-%23CB3837.svg?style=for-the-badge&logo=sanity&logoColor=white)

### config

![Yarn](https://img.shields.io/badge/yarn-%232C8EBB.svg?style=for-the-badge&logo=yarn&logoColor=white)

<br>

---

<br>

## 주요 기능

<br>

* 전체 플랫폼의 웹툰을 (웹툰의 조회수 / 해당 플랫폼의 전체 조회수) 로 계산하여 인기 플랫폼에 치중하지 않고 웹툰의 랭킹을 매깁니다.

* 전체 플랫폼의 랭킹을 주요 장르(판타지, 액션, 로맨스, 무협 등)별로 구분하여 따로 랭킹을 매깁니다.

* 이름뿐 아니라 장르와 요일만으로도 검색할 수 있어 다양한 방식으로 원하는 웹툰을 검색할 수 있습니다.

* 웹툰 마다 코멘트를 작성하여 웹툰을 보기 전에 미리 해당 웹툰의 정보를 얻을 수 있습니다.

* 웹툰을 런칭한지 3개월 이내의 신작 웹툰들을 볼 수 있습니다.

<br>

---

<br>

## 실행 결과

<img width="300" alt="화면 캡처 2025-06-02 213821" src="https://github.com/user-attachments/assets/9627a368-7dff-48b3-9fc6-05d7d1760116" />
<img width="300" alt="화면 캡처 2025-06-02 213821" src="https://github.com/user-attachments/assets/c73f515f-cb33-4cbb-a048-5ce13626b163" />
<img width="300" alt="화면 캡처 2025-06-02 213821" src="https://github.com/user-attachments/assets/b44cd59d-d0b9-4be1-9bb7-04b34858bddb" />
<img width="300" alt="화면 캡처 2025-06-02 213821" src="https://github.com/user-attachments/assets/b8ec7dea-146e-4073-849f-66a3ff80604b" />
<img width="300" alt="화면 캡처 2025-06-02 213821" src="https://github.com/user-attachments/assets/37ab39f8-c44e-4ad5-a8a7-caafcfd286d6" />
<img width="300" alt="화면 캡처 2025-06-02 213821" src="https://github.com/user-attachments/assets/59298629-e66c-4f15-a3a1-833d9cee9ea8" />
<img width="300" alt="화면 캡처 2025-06-02 213821" src="https://github.com/user-attachments/assets/7ab24b7a-54bb-41cf-b9ea-dc5d67d01685" />

<br>

배포 : https://webtoon-web-service-renew.vercel.app/



<br>

---

<br>

## 개선점

<br>

####  해당 프로젝트의 홈은 데이터 요청이 없어 오래 걸리지 않을거라는 예상과 달리 첫 번째 페이지의 LCP 가 2.1초 가량으로 생각보다 좋지 않는 성능을 보임.  
  1. 개발자 도구의 성능 탭을 통해 확인한 결과 layout.tsx 의 다운로드 시간이 길었던 것을 확인
  2. 코드 스플리팅을 통해 해당 파일의 컴포넌트들을 동적 임포트.
  3. 모바일 navbar 는 메뉴 버튼을 누르지 않으면 나오지 않기에 스플리팅
  4. 추가로 확인해보니 다른 컴포넌트들보다 react-icons 에서 가져온 search Icon 이 생각보다 매우 큰 크기를 가짐.
  5. 해당 파일까지 스플리팅한 후 LCP 는 0.21 로 매우 높은 성능 개선 효과를 보임.

####  웹툰 목록은 페이지네이션으로 구현되어있기에 첫 로드시 페이지네이션 컴포넌트가 먼저 렌더링 되어 좋지 않은 CLS 점수를 보임.
 1. 각 웹툰들의 스켈레톤 UI 를 만들어서 CLS 최적화
 2. 웹툰 디테일 페이지에 추가적인 스켈레톤 UI 로 CLS 최적화
 3. CLS 가 0.08까지 감소


####  웹툰 목록 첫 번째 페이지의 프리페칭
 1. 웹툰 목록들에서 2, 3번째 페이지는 몰라도 첫 번째 페이지는 목록에 접근하면 무조건 봐야한다.
 2. 따라서 각 목록들의 첫 번째 페이지들을 프리페칭하여 더 빠른 페이지 접근을 가능하게 하였다.
 3. DOMContentLoaded: 422 -> 356 ms 로드: 506 -> 403 ms

#### 검색 입력마다 state의 변경으로 서버에 지속된 요청
 1. 한 번의 입력마다 계속해서 서버에 데이터를 요청하는 상황
 2. 디바운스를 통하여 입력 후 일정시간 동안 추가적인 입력이 없을 때에만 검색이 발생하도록 최적화
 3. 디바운스를 하여도 state 의 변경은 막을 수 없기에 리렌더링이 발생하면서 서버가 요청하는 것 아닌가? 라는 의문이 생김
 4. 하지만 React-query 나 SWR 등을 이용하여 key 를 state가 아닌 디바운스된 state로 만들면 해당 문제도 해결 

