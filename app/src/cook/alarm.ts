// Timer alarm.
//
// Synthesised with Web Audio rather than shipped as a file: the offline shell
// must stay small (docs/design.md E6), and an audio asset that failed to
// precache would be a silent alarm — the one failure mode that matters here.
//
// The sound is never the only signal. Completion is also shown, because the
// user may not be looking, may have the phone muted, or may not hear it over an
// extractor fan (docs/design.md §6).

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  context ??= new AudioContext();
  return context;
}

/**
 * Unlock audio from a user gesture.
 *
 * iOS refuses to start an AudioContext outside a real interaction, so this is
 * called when cook mode is entered — otherwise the first alarm of the session
 * would be silent, discovered only by the food burning.
 */
export async function primeAlarm(): Promise<void> {
  const ctx = audioContext();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') await ctx.resume();
  } catch {
    // Nothing to do — the visual alert still fires.
  }
}

/** Three rising beeps; distinct from a notification chime. */
export function playAlarm(): void {
  const ctx = audioContext();
  if (!ctx || ctx.state !== 'running') return;

  const start = ctx.currentTime;
  for (const [index, frequency] of [880, 1108, 1318].entries()) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.value = frequency;

    const at = start + index * 0.22;
    // Ramped rather than switched, so it does not click.
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.3, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.2);

    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.22);
  }
}

/** A short buzz where supported — reaches the user when the phone is muted. */
export function vibrateAlarm(): void {
  try {
    navigator.vibrate?.([200, 100, 200]);
  } catch {
    // Unsupported; the sound and the visual alert remain.
  }
}
