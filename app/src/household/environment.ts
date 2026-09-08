// A link shared through a messenger opens inside that app's own webview, whose
// storage is isolated from the installed Home Screen app. Pairing there binds a
// throwaway session and consumes the single-use invite token, leaving the real
// app unpaired with a token that can no longer be used. Push registration does
// not work there either. So the pairing form refuses it instead of failing in a
// way the user cannot diagnose.

const IN_APP_BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/KAKAOTALK/i, '카카오톡'],
  [/NAVER\(inapp/i, '네이버 앱'],
  [/Instagram/i, '인스타그램'],
  [/\bFBAN\b|\bFBAV\b/, '페이스북'],
  [/\bLine\//i, '라인'],
];

/** The messenger whose in-app browser is showing this page, if it is one. */
export function inAppBrowser(userAgent: string = navigator.userAgent): string | null {
  for (const [pattern, name] of IN_APP_BROWSERS) {
    if (pattern.test(userAgent)) return name;
  }
  return null;
}
