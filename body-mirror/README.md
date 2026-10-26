# Body Mirror

Macro Mirror for the whole body. Tell it what you eat and how you train, then drag the timeline: your own live body in the camera gets fuller, or leaner and more muscular, over 1 month to 10 years.

**Live:** https://tirupathipodugu.github.io/ideas/body-mirror/ (stand back so you're in view from head to knees)

This is phase 1 of the plan in `reports/Realistic live body change filter.md`: a live 2D warp sized by physiology, with the background kept still. Everything runs in the browser; the camera never leaves the device.

## How it works

- **Tracking.** MediaPipe Pose Landmarker (full, or lite from the plate sheet) gives 33 body points, 3D world points and a person mask on every frame ([pose.js](js/pose.js)). Points are smoothed with a One Euro filter.
- **The numbers** ([body.js](js/body.js)):
  - Weight follows the same simplified Hall model as Macro Mirror.
  - The Forbes curve splits weight into fat and lean, which is used for body fat % and the fold shading.
  - Strength training adds muscle on a slowing beginner curve.
  - Each region moves by its own cm per kg. The waist (1.15 cm/kg in men, 0.94 in women) is measured. The other regions are estimates, all kept in one table so they're easy to tune.
  - The face fills out from about 4 kg.
  - Hard limits: up to +15 kg, down to −8 kg, and never below BMI 18.5.
- **The warp** ([rig.js](js/rig.js), [warp.js](js/warp.js)):
  - Each body part (torso, neck, face, upper arms, forearms, thighs, calves) is an axis with four width-scale keys.
  - Every screen pixel adds up where the parts say it should come from.
  - A pixel only takes the camera pixel there if that pixel is the person, so the background never bends.
  - The torso carries hanging arms outward rigidly.
  - Turned side-on, the belly comes forward more than it spreads.
  - Fat adds rounder flanks and a soft fold above the waistband.

## Checks

- `?debug=1` shows the points and axes; `?debug=2` also tints the mask and the displacement.
- The speed readout (on by default, toggle in the plate sheet) shows drawn fps, tracked fps, pose time and the GPU/CPU delegate.

## Not yet (later phases)

- A calibrated 3D body (Anny) fitted once from photos.
- Shading computed from the 3D body, plus muscle definition.
- Clothes that fold.
- The full Hall model.
- Share card.
