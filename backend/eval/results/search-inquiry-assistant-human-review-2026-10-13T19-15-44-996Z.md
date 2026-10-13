# 공개 문의 어시스턴트 소규모 검토

- 자료: inquiries-assistant-confirmation-v1; 합성 문의만 사용; 사용자 DB 접근 없음
- 계획 1 / 실행 1 / 미실행 0; SDK 요청 3; 실패 관측 1
- 사람 판정: 전체 pending. 아래 관측값은 답변 정확성 점수가 아니다.

## inquiry-confirmation-absent

질문: 상품 502의 2026-10-01부터 2026-10-12까지 공개 문의에서 빵에 곰팡이가 생겼다는 불만을 의미 검색으로 찾아줘. 문의 ID와 원문을 인용해줘.

기대 원문 ID: 없음
판정 근거: 기간 안의 공개 문의는 빵이 단단해진 현상·부드러운 경험·보관 봉투 안내뿐이며 곰팡이 불만 근거는 없다. #5014의 곰팡이 불만은 10월 13일로 범위 밖이고 #5015는 비밀 문의다. 관련 없는 후보를 곰팡이 근거로 인용하면 안 된다.

실행: 완료
사람 판정: pending

실제 도구 인자·결과:

```json
[
  {
    "name": "summarize_inquiries",
    "args": {
      "productId": 502,
      "query": "빵 곰팡이",
      "endDate": "2026-10-12",
      "startDate": "2026-10-01"
    },
    "result": {
      "status": "ok",
      "mode": "semantic",
      "scope": {
        "sourceType": "inquiry",
        "timezone": "Asia/Seoul",
        "unit": "source",
        "profileId": "gemini-embedding-2-768-review-inquiry-v1",
        "query": "빵 곰팡이",
        "productIds": [
          502
        ],
        "startDate": "2026-10-01",
        "endDate": "2026-10-12",
        "take": 5,
        "checkedAt": "2026-10-13T19:15:38.673Z"
      },
      "coverage": {
        "total": 3,
        "ready": 3,
        "pending": 0,
        "failed": 0,
        "partial": false
      },
      "data": {
        "sources": [
          {
            "sourceType": "inquiry",
            "id": 5011,
            "productId": 502,
            "status": "answered",
            "title": "다음 날 빵이 단단해졌어요",
            "hasContent": true,
            "hasAnswer": true,
            "createdAt": "2026-10-03T03:00:00.000Z",
            "quotes": [
              {
                "chunkIndex": 0,
                "text": "[문의 제목]\n다음 날 빵이 단단해졌어요\n\n[문의 본문]\n빵을 냉장고에 넣었더니 다음 날 딱딱해졌습니다. 부드럽게 먹는 방법이 있나요?\n\n[답변]\n먹기 전에 살짝 데우고 남은 빵은 밀봉해 냉동 보관해주세요."
              }
            ]
          },
          {
            "sourceType": "inquiry",
            "id": 5012,
            "productId": 502,
            "status": "waiting",
            "title": "밀봉한 빵의 부드러움",
            "hasContent": true,
            "hasAnswer": false,
            "createdAt": "2026-10-05T01:00:00.000Z",
            "quotes": [
              {
                "chunkIndex": 0,
                "text": "[문의 제목]\n밀봉한 빵의 부드러움\n\n[문의 본문]\n밀봉해서 두니 다음 날에도 부드러웠습니다. 데워 먹어도 되나요?"
              }
            ]
          },
          {
            "sourceType": "inquiry",
            "id": 5013,
            "productId": 502,
            "status": "answered",
            "title": "보관용 봉투 사용 문의",
            "hasContent": true,
            "hasAnswer": true,
            "createdAt": "2026-10-04T05:00:00.000Z",
            "quotes": [
              {
                "chunkIndex": 0,
                "text": "[문의 제목]\n보관용 봉투 사용 문의\n\n[문의 본문]\n남은 빵을 보관하는 봉투를 별도로 판매하나요?\n\n[답변]\n밀봉할 수 있는 식품 보관용 봉투를 이용해주세요."
              }
            ]
          }
        ],
        "candidateChunkCount": 3,
        "omittedSourceCount": 0,
        "contextTruncated": false
      },
      "error": null
    }
  }
]
```

실제 답변:

요청하신 상품 502의 2026-10-01부터 2026-10-12까지의 공개 문의 중 '빵에 곰팡이가 생겼다'는 내용과 관련하여 검색을 수행하였으나, 가져온 자료에서 해당 불만 사항에 대한 근거를 찾지 못했습니다.

검토: 조건 보존, 공개 원문 ID/정확한 인용, 제목·본문·답변 구분, 비밀/연락처 보호, 근거 없음과 실패 구분, 지원하지 않는 사실 추가 여부.
