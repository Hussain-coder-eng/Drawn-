import { useRef, useCallback } from 'react';

export function useTurnAlerts() {
  const speechSynthRef = useRef<SpeechSynthesis | null>(typeof window !== 'undefined' ? window.speechSynthesis : null);
  const lastAlertRef = useRef<number | null>(null);

  const speakInstruction = useCallback((text: string) => {
    if (!speechSynthRef.current) return;

    speechSynthRef.current.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    const voices = speechSynthRef.current.getVoices();
    const preferredVoice = voices.find(v =>
      v.lang.startsWith('en') && v.name.toLowerCase().includes('female')
    ) ?? voices.find(v => v.lang.startsWith('en')) ?? voices[0];

    if (preferredVoice) utterance.voice = preferredVoice;

    speechSynthRef.current.speak(utterance);
  }, []);

  const vibrateAlert = useCallback((pattern: number[]) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  }, []);

  const handleTurnAlert = useCallback(({ turn, distanceM, instruction }: { turn: any; distanceM: number; instruction: string }) => {
    if (lastAlertRef.current === turn.routePointIndex) return null;
    lastAlertRef.current = turn.routePointIndex;

    const roundedDistance = Math.round(distanceM / 5) * 5;
    const fullInstruction = `In ${roundedDistance} meters, ${instruction}`;

    speakInstruction(fullInstruction);

    const vibrationPatterns: Record<string, number[]> = {
      'u-turn':      [100, 50, 100, 50, 200],
      'sharp-left':  [200, 100, 100],
      'sharp-right': [200, 100, 100],
      'left':        [150, 100],
      'right':       [150, 100],
      'slight-left': [100],
      'slight-right':[100],
      'straight':    [50]
    };
    vibrateAlert(vibrationPatterns[turn.turnType] ?? [100]);

    return {
      instruction: fullInstruction,
      turnType: turn.turnType,
      distanceM: roundedDistance,
      showUntilDistanceM: 10
    };
  }, [speakInstruction, vibrateAlert]);

  return { handleTurnAlert, speakInstruction };
}
