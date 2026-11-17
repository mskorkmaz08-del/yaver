// Sound: Yaver is silent. Interface sounds were removed in v40 and the background
// music in v55 (Mustafa found it distracting; it comes back only when he asks for a
// finished piece). These no-op hooks stay so the chat and focus mode keep calling
// the same names if music returns.
export function init() {}
export function duck() {}
export function startMusic() {}
export function stopMusic() {}
export const musicPlaying = () => false;
