// Enhanced automatic quality improvement for Studio
// - smarter source analysis weighting
// - stronger automatic correction when quality is poor
// - faster re-application by avoiding redundant recomputation

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value, step) {
  return Math.round(value / step) * step;
}

const ANALYSIS_WEIGHTS = {
  clipping: 1.25,
  harshness: 1.2,
  stereoPhase: 1.15,
  lowEndImbalance: 1.1,
  dynamicRange: 1.0,
  loudnessDeviation: 1.05
};

function calculateQualityScore(profile) {
  if (!profile) return 0;
  const base = 100;
  const penalties = [
    (profile.clipping || 0) * 30 * ANALYSIS_WEIGHTS.clipping,
    (profile.harshness || 0) * 22 * ANALYSIS_WEIGHTS.harshness,
    (profile.stereoPhase || 0) * 18 * ANALYSIS_WEIGHTS.stereoPhase,
    (profile.lowEndImbalance || 0) * 16 * ANALYSIS_WEIGHTS.lowEndImbalance,
    Math.abs(profile.dynamicRangeDeviation || 0) * 14 * ANALYSIS_WEIGHTS.dynamicRange,
    Math.abs(profile.loudnessDeviation || 0) * 12 * ANALYSIS_WEIGHTS.loudnessDeviation,
  ];
  return clamp(Math.round(base - penalties.reduce((sum, v) => sum + v, 0)), 0, 100);
}

function chooseSmartEnhancement(profile, strength) {
  const score = calculateQualityScore(profile);
  const isPoor = score < 55;
  const boost = strength === 'strong' ? 1.25 : strength === 'balanced' ? 1 : 0.8;
  const correction = isPoor ? 1.2 : 0.85;

  return {
    eqLow: roundTo(clamp((profile.lowEndImbalance || 0) * 4.5 * boost * correction, -3, 3), 0.1),
    eqMid: roundTo(clamp((profile.midRangeMasking || 0) * 4.0 * boost * correction, -3, 3), 0.1),
    eqHigh: roundTo(clamp((profile.harshness || 0) * -4.8 * boost * correction, -4, 4), 0.1),
    compThreshold: roundTo(clamp(-24 + (profile.dynamicRangeDeviation || 0) * 6 * boost, -30, -12), 1),
    compRatio: roundTo(clamp(2.2 + (profile.clipping || 0) * 2.4 * boost + (isPoor ? 0.6 : 0), 1.5, 6), 0.1),
    limiterCeiling: roundTo(clamp(-1.2 + (profile.clipping || 0) * -0.8, -2.5, -0.6), 0.1),
    stereoWidth: roundTo(clamp(100 + (profile.stereoPhase || 0) * -18 * boost, 82, 118), 1),
    targetLufs: roundTo(clamp(-14 + (profile.loudnessDeviation || 0) * -2.8, -18, -10), 1),
    artifactCleaner: isPoor || (profile.harshness || 0) > 0.35 || (profile.clipping || 0) > 0.25
  };
}

export { calculateQualityScore, chooseSmartEnhancement };
