// The body numbers: how a weight change splits into fat and lean (Forbes), how training adds muscle,
// and how much each region's circumference moves per kg (only the waist figure is measured; the rest
// are starting estimates from the research notes, kept in one table so they're easy to tune).

/** Circumference change in cm per kg of body weight gained or lost (mostly fat), by sex. Waist:
 *  Japanese 1-year cohort, 1.15 men / 0.94 women. Others: estimates (hips higher in women, calves
 *  barely move). */
const FAT_CM_PER_KG = {
  m: { neck: 0.28, chest: 0.75, waist: 1.15, hips: 0.45, thigh: 0.45, calf: 0.12, arm: 0.30, forearm: 0.12 },
  f: { neck: 0.22, chest: 0.65, waist: 0.94, hips: 0.80, thigh: 0.62, calf: 0.15, arm: 0.34, forearm: 0.12 },
};
FAT_CM_PER_KG.x = Object.fromEntries(Object.keys(FAT_CM_PER_KG.m).map((k) => [k, (FAT_CM_PER_KG.m[k] + FAT_CM_PER_KG.f[k]) / 2]));

/** Circumference change in cm per kg of MUSCLE (estimates: arm about +1.5 cm for ~1.5 kg lean mass
 *  in 10–12 weeks; chest, shoulders and thighs carry most of it, the waist almost none). */
const MUSCLE_CM_PER_KG = { neck: 0.35, chest: 1.5, shoulder: 1.6, waist: 0.1, hips: 0.35, thigh: 1.0, calf: 0.35, arm: 1.0, forearm: 0.45 };

/** Starting circumference for each region, as a share of height, at BMI 23 (rough adult averages). */
const BASE_SHARE = { neck: 0.22, chest: 0.56, shoulder: 0.66, waist: 0.48, hips: 0.57, thigh: 0.32, calf: 0.215, arm: 0.175, forearm: 0.155 };
const BASE_BMI_POWER = { neck: 0.4, chest: 0.5, shoulder: 0.35, waist: 0.75, hips: 0.5, thigh: 0.6, calf: 0.4, arm: 0.65, forearm: 0.45 };

export const TRAINING = [
  { id: 'none', label: 'No strength training', cap: 0 },
  { id: 'some', label: '2× a week', cap: 4 },
  { id: 'lots', label: '4× a week', cap: 7 },
];

export const GAIN_CAP_KG = 15;     // the body stops changing beyond this
export const LEAN_CAP_KG = 8;      // and never goes leaner than this
export const HEALTHY_BMI = 18.5;   // nor below a healthy weight

/** Body fat % from BMI, age and sex (Deurenberg 1991). */
export function bodyFatPct(bmi, age, sex) {
  const male = sex === 'm' ? 1 : sex === 'f' ? 0 : 0.5;
  return Math.max(6, Math.min(55, 1.2 * bmi + 0.23 * age - 10.8 * male - 5.4));
}

/** Split a scale-weight change into fat and lean with the Forbes curve: the lean share of each step
 *  is 10.4 / (10.4 + fat mass), so lean people lose more lean tissue and heavier people more fat. */
export function forbesSplit(deltaKg, fatKg) {
  const steps = 40;
  const step = deltaKg / steps;
  let fat = fatKg;
  for (let i = 0; i < steps; i++) {
    const lean = 10.4 / (10.4 + Math.max(1, fat));
    fat += step * (1 - lean);
  }
  return { fat: fat - fatKg, lean: deltaKg - (fat - fatKg) };
}

/** Muscle added by strength training after `days`: a beginner curve that slows down
 *  (about 0.3 kg a month at first at 4× a week; women about 60% of that). */
export function trainingMuscle(trainingId, days, sex) {
  const t = TRAINING.find((x) => x.id === trainingId) || TRAINING[0];
  const sexScale = sex === 'f' ? 0.6 : sex === 'x' ? 0.8 : 1;
  return t.cap * sexScale * (1 - Math.exp(-days / 540));
}

/**
 * Everything the warp needs for one future: per-region width scale (0 = unchanged, 0.1 = 10% wider),
 * plus belly depth for side views and a few shading amounts.
 * kg is the energy-balance weight change; it is capped and floored here.
 */
export function bodyParams(kg, days, profile, ageYears) {
  const sex = profile.sex || 'x';
  const h = profile.height / 100;
  const bmi = profile.weight / (h * h);
  const floorKg = HEALTHY_BMI * h * h - profile.weight;          // negative: how far down we may go
  const lowest = Math.max(-LEAN_CAP_KG, Math.min(0, floorKg));
  const shownKg = Math.max(lowest, Math.min(GAIN_CAP_KG, kg));
  const fatKg0 = profile.weight * bodyFatPct(bmi, ageYears, sex) / 100;
  const split = forbesSplit(shownKg, fatKg0);
  const muscle = trainingMuscle(profile.training, days, sex);
  const fatCm = FAT_CM_PER_KG[sex] || FAT_CM_PER_KG.x;
  const bmiNow = (profile.weight + shownKg) / (h * h);

  const scale = {};
  for (const r of Object.keys(BASE_SHARE)) {
    const c0 = BASE_SHARE[r] * profile.height * Math.pow(bmi / 23, BASE_BMI_POWER[r]);
    // The cohort figures are per kg of scale weight (fat and the lean tissue that comes with it).
    const dc = (fatCm[r] || 0) * shownKg + (MUSCLE_CM_PER_KG[r] || 0) * muscle;
    scale[r] = dc / c0;
  }
  // The face fills out noticeably from about 4 kg (Re & Rule 2016); lower face and jaw most.
  scale.face = 0.0075 * shownKg;
  // Visceral fat pushes the belly forward more than out to the sides, more so in men.
  const bellyDepth = scale.waist * (sex === 'm' ? 1.5 : sex === 'f' ? 1.1 : 1.3);
  const fatPct = 100 * (fatKg0 + split.fat) / (profile.weight + shownKg + muscle);
  return {
    kg: shownKg, rawKg: kg, fat: split.fat, lean: split.lean, muscle, floored: kg < lowest, capped: kg > GAIN_CAP_KG,
    scale, bellyDepth, fatPct, bmi: bmiNow,
    // A soft fold above the waistband once the belly has filled out (from about +4 kg of fat).
    fold: Math.max(0, Math.min(1, (split.fat - 4) / 9)),
    // Rounder flanks with fat, a little more contrast with muscle.
    round: Math.max(0, Math.min(1, split.fat / 12)),
  };
}

export const ZERO_BODY = {
  kg: 0, fat: 0, lean: 0, muscle: 0, bellyDepth: 0, fold: 0, round: 0,
  scale: { face: 0, neck: 0, chest: 0, shoulder: 0, waist: 0, hips: 0, thigh: 0, calf: 0, arm: 0, forearm: 0 },
};

/** Blend smoothly toward a target (for the slider and the hold button). */
export function smoothBody(cur, target, k) {
  if (!cur) return structuredClone(target);
  const out = { ...target, scale: {} };
  for (const key of ['kg', 'fat', 'lean', 'muscle', 'bellyDepth', 'fold', 'round']) out[key] = cur[key] + (target[key] - cur[key]) * k;
  for (const r of Object.keys(target.scale)) out.scale[r] = cur.scale[r] + (target.scale[r] - cur.scale[r]) * k;
  return out;
}
