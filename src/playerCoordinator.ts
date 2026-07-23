// The ONLY module permitted to touch Spotify playback, and only via pause/resume.
// The injected port deliberately has no seek/playUri surface (AC28).

export interface PlayerPort {
  isPlaying(): boolean;
  pause(): void;
  resume(): void;
}

export function createPlayerCoordinator(player: PlayerPort) {
  let active = false;
  let wasPlaying = false;

  return {
    acquire(): void {
      if (active) return; // AC27: no second pause on replacement
      wasPlaying = player.isPlaying();
      if (wasPlaying) player.pause(); // AC24
      active = true;
    },
    release(): void {
      if (!active) return;
      if (wasPlaying) player.resume(); // AC25 / AC26
      active = false;
    },
    isActive: (): boolean => active,
  };
}

export type PlayerCoordinator = ReturnType<typeof createPlayerCoordinator>;
