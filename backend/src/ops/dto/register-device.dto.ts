import { IsIn, IsString, Matches, MaxLength } from 'class-validator';

/**
 * POST /v1/ops/devices — 앱이 발급받은 Expo push token 등록 (설계 §5.1).
 *
 * 토큰 형식을 정규식으로 못박는 이유: 이 값은 나중에 Expo Push API 에 그대로 실려 나간다.
 * 형식이 아닌 값이 표에 쌓이면 발송이 통째로 실패하거나 남의 기기에 보내려는 시도가 된다.
 */
export class RegisterDeviceDto {
  /** 예: ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx] */
  @IsString()
  @MaxLength(200)
  @Matches(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/, {
    message: 'Expo push token 형식이 올바르지 않습니다.',
  })
  expoPushToken: string;

  @IsIn(['ios', 'android'], { message: 'platform 은 ios 또는 android 여야 합니다.' })
  platform: 'ios' | 'android';
}
