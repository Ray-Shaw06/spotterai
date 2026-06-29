/**
 * SpotterAI — movement-pattern coaching cues (pure)
 * ============================================================================
 * The structured exercise DB has muscles / equipment / joint stress / swaps but
 * no prose. Rather than fabricate per-exercise instructions for ~80 lifts, the
 * Exercise Library derives setup / how-to / common-mistakes / safety from the
 * exercise's MOVEMENT PATTERN — accurate, scalable, and honest about its level.
 */

export const PATTERN_LABEL = {
  squat: "Squat",
  lunge: "Lunge / single-leg",
  hinge: "Hip hinge",
  horizontal_push: "Horizontal push",
  vertical_push: "Vertical push",
  horizontal_pull: "Horizontal pull",
  vertical_pull: "Vertical pull",
  isolation: "Isolation",
  plyometric: "Plyometric / jump",
  isometric: "Isometric / brace",
};

export const MOVEMENT_CUES = {
  squat: {
    setup: "Weight balanced over mid-foot, feet about shoulder-width, toes slightly out. Brace your core before you descend.",
    howto: ["Break at the hips and knees together and sit down between your legs.", "Keep your knees tracking over your toes and your heels planted.", "Descend to a depth you control, then drive up through the whole foot."],
    mistakes: ["Knees caving inward", "Heels lifting or weight drifting onto the toes", "Losing the brace and rounding at the bottom"],
    safety: "Stop short of any depth that pinches or hurts the knees or lower back.",
  },
  lunge: {
    setup: "Stand tall, feet hip-width, core braced. Take a controlled step or set up in a split stance.",
    howto: ["Lower straight down so the front shin stays roughly vertical.", "Keep most of the weight through the front heel.", "Drive back up under control without letting the front knee cave."],
    mistakes: ["Front knee collapsing inward or drifting far past the toes", "Leaning the torso too far forward", "Bouncing out of the bottom"],
    safety: "Reduce range or switch to a more supported variation if the knees complain.",
  },
  hinge: {
    setup: "Soft knees, weight over mid-foot, lats engaged. Set a flat, braced back before you move.",
    howto: ["Push your hips back, letting the torso fold while the back stays flat.", "Lower until you feel a stretch in the hamstrings, not a round in the back.", "Drive the hips forward to stand tall — don't yank with the lower back."],
    mistakes: ["Rounding the lower back", "Turning it into a squat (too much knee bend)", "Hyperextending / leaning back hard at the top"],
    safety: "Hinges load the lower back — keep the spine neutral and the load moderate if you're prone to back pain.",
  },
  horizontal_push: {
    setup: "Stable shoulder blades pulled back and down, wrists stacked over elbows, feet planted.",
    howto: ["Lower the weight under control toward the lower chest.", "Keep the elbows tucked around 45°, not flared to 90°.", "Press back up without losing the shoulder-blade position."],
    mistakes: ["Elbows flaring straight out to the sides", "Bouncing the weight off the chest", "Shoulders rolling forward off the bench"],
    safety: "Ease off range or grip width if the front of the shoulder pinches.",
  },
  vertical_push: {
    setup: "Ribs down, glutes and core braced, wrists stacked over the elbows.",
    howto: ["Press overhead in a straight line, moving your head 'through the window' as the weight passes.", "Keep the core tight so you don't arch the lower back.", "Lower under control to about chin height or where you have control."],
    mistakes: ["Over-arching the lower back to press", "Pressing the weight out in front instead of overhead", "Shrugging before the press starts"],
    safety: "Overhead pressing is shoulder-intensive — skip or substitute if it's painful overhead.",
  },
  horizontal_pull: {
    setup: "Hinge to a stable torso angle (or use chest support), shoulders set, core braced.",
    howto: ["Pull the weight toward your lower ribs, leading with the elbows.", "Squeeze the shoulder blades together at the top.", "Lower under control to a full stretch without losing posture."],
    mistakes: ["Yanking with the lower back instead of the back muscles", "Shrugging the traps to move the weight", "Cutting the range short"],
    safety: "Free-standing rows load the lower back; use chest support if that's a concern.",
  },
  vertical_pull: {
    setup: "Grip set, shoulders pulled down away from the ears, core gently braced.",
    howto: ["Pull your elbows down and toward your ribs.", "Bring the bar/handle to the upper chest, squeezing the lats.", "Control the way back up to a full stretch."],
    mistakes: ["Using momentum / kipping", "Leaning back excessively", "Stopping short of a full stretch at the top"],
    safety: "Reduce range or load if the shoulder feels pinchy at full stretch.",
  },
  isolation: {
    setup: "Position the joint so the target muscle does the work; brace everything else.",
    howto: ["Move slowly and deliberately through the full range.", "Keep tension on the target muscle the whole time.", "Avoid swinging or using other muscles to cheat the weight up."],
    mistakes: ["Using momentum instead of control", "Cutting the range of motion short", "Letting bigger muscles take over"],
    safety: "Isolation work should feel like muscular effort, not joint pain — stop if a joint hurts.",
  },
  plyometric: {
    setup: "Warm, fresh, and on a forgiving surface. Plyometrics are skill + impact work, not for fatigue training.",
    howto: ["Land softly through the whole foot, absorbing with the hips and knees.", "Keep the knees tracking over the toes on landing.", "Reset fully between reps — quality over quantity."],
    mistakes: ["Landing stiff or with knees caving in", "Chasing high rep counts when fatigued", "Doing them with an existing knee/ankle issue"],
    safety: "High impact on the knees and ankles — skip entirely if you have a knee, ankle, or hip issue.",
  },
  isometric: {
    setup: "Set a neutral spine and full-body tension before the clock starts.",
    howto: ["Hold the braced position without sagging or shifting.", "Breathe shallowly while keeping the brace.", "Stop the set when form breaks, not just when it's hard."],
    mistakes: ["Letting the hips sag or pike", "Holding the breath fully", "Holding past the point where form breaks down"],
    safety: "Stop if you feel it in the lower back rather than the target muscles.",
  },
};

export const GENERIC_CUES = {
  setup: "Set up in a stable, braced position before you move.",
  howto: ["Move through a range of motion you can control.", "Keep tension on the target muscle.", "Avoid jerking or using momentum."],
  mistakes: ["Using momentum instead of control", "Cutting the range of motion short", "Holding your breath under load"],
  safety: "Stop if a movement causes joint pain rather than muscular effort.",
};

export function cuesFor(pattern) {
  return MOVEMENT_CUES[pattern] || GENERIC_CUES;
}
