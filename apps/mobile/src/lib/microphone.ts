export async function waitForMicrophoneForeground(
  current: () => boolean,
  foreground: () => boolean,
  pause: (milliseconds: number) => Promise<void> = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
) {
  const deadline = Date.now() + 3000;
  while (current() && !foreground() && Date.now() < deadline) await pause(100);
}
