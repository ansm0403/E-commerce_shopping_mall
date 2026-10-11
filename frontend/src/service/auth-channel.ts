export type AuthBroadcastMessage = { type: 'LOGIN' | 'LOGOUT' | 'TOKEN_REFRESHED' | 'REQUEST_TOKEN' | 'TOKEN_RESPONSE'; revision: string; requestId?: string; accessToken?: string };

let channel: BroadcastChannel | null = null;

export function getAuthChannel() {
  if (typeof window === 'undefined') return null;
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('auth-channel');
  }
  return channel;
}

export function closeAuthChannel() {
  if (channel) {
    channel.close();
    channel = null;
  }
}
