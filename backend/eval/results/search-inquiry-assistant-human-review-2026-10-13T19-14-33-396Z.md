# 공개 문의 어시스턴트 소규모 검토

- 자료: inquiries-assistant-confirmation-v1; 합성 문의만 사용; 사용자 DB 접근 없음
- 계획 2 / 실행 2 / 미실행 0; SDK 요청 6; 실패 관측 3
- 사람 판정: 전체 pending. 아래 관측값은 답변 정확성 점수가 아니다.

## inquiry-confirmation-title

질문: 상품 501의 2026-10-01부터 2026-10-12까지 답변 대기 중인 공개 문의에서 배송 상자가 젖어 포장 종이가 찢어졌다는 불만을 의미 검색으로 찾아줘. 문의 ID와 원문을 인용해줘.

기대 원문 ID: 5001
판정 근거: 범위 안의 실제 불만은 제목만 있는 #5001이다. #5002는 걱정했으나 실제로 멀쩡했다는 반대 경험이므로 불만 근거가 아니다. #5004는 10월 13일로 범위 밖, #5005는 비밀 문의다. 없는 본문이나 답변을 만들어 인용하면 안 된다.

실행: 완료
사람 판정: pending

실제 도구 인자·결과:

```json
[
  {
    "name": "summarize_inquiries",
    "args": {
      "startDate": "2026-10-01",
      "endDate": "2026-10-12",
      "query": "배송 상자 젖음 포장 종이 찢어짐",
      "status": "waiting",
      "productId": 501
    },
    "result": {
      "status": "ok",
      "mode": "semantic",
      "scope": {
        "sourceType": "inquiry",
        "timezone": "Asia/Seoul",
        "unit": "source",
        "profileId": "gemini-embedding-2-768-review-inquiry-v1",
        "query": "배송 상자 젖음 포장 종이 찢어짐",
        "productIds": [
          501
        ],
        "status": "waiting",
        "startDate": "2026-10-01",
        "endDate": "2026-10-12",
        "take": 5,
        "checkedAt": "2026-10-13T19:14:03.459Z"
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
            "id": 5001,
            "productId": 501,
            "status": "waiting",
            "title": "배송 상자가 젖어 포장 종이가 찢어진 문의",
            "hasContent": false,
            "hasAnswer": false,
            "createdAt": "2026-10-02T01:00:00.000Z",
            "quotes": [
              {
                "chunkIndex": 0,
                "text": "[문의 제목]\n배송 상자가 젖어 포장 종이가 찢어진 문의"
              }
            ]
          },
          {
            "sourceType": "inquiry",
            "id": 5002,
            "productId": 501,
            "status": "waiting",
            "title": "비 오는 날 포장 상태가 걱정됐어요",
            "hasContent": true,
            "hasAnswer": false,
            "createdAt": "2026-10-03T02:00:00.000Z",
            "quotes": [
              {
                "chunkIndex": 0,
                "text": "[문의 제목]\n비 오는 날 포장 상태가 걱정됐어요\n\n[문의 본문]\n상자가 젖거나 포장 종이가 찢어질까 걱정했지만 실제로 받은 상자는 마르고 멀쩡했습니다."
              }
            ]
          },
          {
            "sourceType": "inquiry",
            "id": 5003,
            "productId": 501,
            "status": "waiting",
            "title": "선물 포장 색상 선택",
            "hasContent": true,
            "hasAnswer": false,
            "createdAt": "2026-10-04T00:00:00.000Z",
            "quotes": [
              {
                "chunkIndex": 0,
                "text": "[문의 제목]\n선물 포장 색상 선택\n\n[문의 본문]\n포장 리본을 파란색으로 선택할 수 있나요?"
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

조회하신 기간 동안 상품 501에 대해 문의하신 내용 중, 요청하신 배송 상자 및 포장 상태와 관련된 불만 사례는 아래와 같습니다.

**문의 #5001**
*   **문의 제목:** 배송 상자가 젖어 포장 종이가 찢어진 문의
*   **문의 본문:** (고객 본문이 작성되지 않은 문의입니다.)

참고로, 문의 #5002의 경우 포장 상태에 대한 걱정을 언급하였으나, 원문에 "실제로 받은 상자는 마르고 멀쩡했습니다"라고 기재되어 있어 실제 배송 문제가 발생한 불만 사례로 분류하지 않았습니다.

검토: 조건 보존, 공개 원문 ID/정확한 인용, 제목·본문·답변 구분, 비밀/연락처 보호, 근거 없음과 실패 구분, 지원하지 않는 사실 추가 여부.

## inquiry-confirmation-absent

질문: 상품 502의 2026-10-01부터 2026-10-12까지 공개 문의에서 빵에 곰팡이가 생겼다는 불만을 의미 검색으로 찾아줘. 문의 ID와 원문을 인용해줘.

기대 원문 ID: 없음
판정 근거: 기간 안의 공개 문의는 빵이 단단해진 현상·부드러운 경험·보관 봉투 안내뿐이며 곰팡이 불만 근거는 없다. #5014의 곰팡이 불만은 10월 13일로 범위 밖이고 #5015는 비밀 문의다. 관련 없는 후보를 곰팡이 근거로 인용하면 안 된다.

실행: LLM_UNAVAILABLE
사람 판정: pending

실제 도구 인자·결과:

```json
[
  {
    "name": "summarize_inquiries",
    "args": {
      "query": "빵 곰팡이",
      "startDate": "2026-10-01",
      "productId": 502,
      "endDate": "2026-10-12"
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
        "checkedAt": "2026-10-13T19:14:24.577Z"
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

(완료된 답변 없음)

검토: 조건 보존, 공개 원문 ID/정확한 인용, 제목·본문·답변 구분, 비밀/연락처 보호, 근거 없음과 실패 구분, 지원하지 않는 사실 추가 여부.
