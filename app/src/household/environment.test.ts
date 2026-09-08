import { describe, expect, it } from 'vitest';
import { inAppBrowser } from './environment';

const SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const CHROME =
  'Mozilla/5.0 (Linux; Android 13; SM-S911N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36';

describe('inAppBrowser', () => {
  it('names KakaoTalk on both phone platforms', () => {
    expect(
      inAppBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.3.0',
      ),
    ).toBe('카카오톡');
    expect(inAppBrowser(CHROME + ';KAKAOTALK 10.3.0')).toBe('카카오톡');
  });

  it('names the other messengers a link is likely to arrive through', () => {
    expect(inAppBrowser(SAFARI + ' NAVER(inapp; search; 2000; 12.0.0)')).toBe('네이버 앱');
    expect(inAppBrowser(CHROME + ' Instagram 302.0.0.0')).toBe('인스타그램');
    expect(inAppBrowser(SAFARI + ' [FBAN/FBIOS;FBAV/440.0.0]')).toBe('페이스북');
    expect(inAppBrowser(SAFARI + ' Line/13.5.0')).toBe('라인');
  });

  // The guard blocks pairing, so a false positive locks a real browser out of
  // the only screen that can pair it.
  it('leaves ordinary mobile browsers alone', () => {
    expect(inAppBrowser(SAFARI)).toBeNull();
    expect(inAppBrowser(CHROME)).toBeNull();
    expect(inAppBrowser('')).toBeNull();
  });
});
