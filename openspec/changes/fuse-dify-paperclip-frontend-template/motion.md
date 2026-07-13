# Motion Spec

## Summary

- Change id: `fuse-dify-paperclip-frontend-template`
- Surfaces: prototype shell and variant switcher
- Implementation target: existing CSS transitions only
- Motion risk: low

## Principles

- Purpose: confirm selection and preserve orientation.
- Product feeling: immediate, precise, interruptible.
- Motion must never delay scanning or simulate runtime activity.
- Reduced motion: all transitions reduce to near-instant through existing global rules.

## Interaction inventory

| Element | Trigger | Response |
| --- | --- | --- |
| Variant switch | click / Left / Right | URL update and immediate structural replacement |
| Tabs and list rows | hover / focus | semantic surface and border emphasis, 150-180ms |
| Buttons | press | existing physical press token |

## Timing and easing

- Surface feedback: 150-180ms using existing `--motion-ease-spatial`.
- No entrance choreography, stagger, auto-animation, or scroll-linked motion.
- Repeated input immediately selects the newest variant.

## Accessibility and performance

- Keyboard focus remains stable on the switcher.
- No motion-only meaning.
- Only color, opacity, and transform from existing tokens are allowed.
- No layout animation, blur animation, or new runtime dependency.

## QA scenarios

- Rapid arrow-key switching does not queue animation.
- Reduced motion leaves all content immediately readable.
- Fixed switcher does not cover the last content block.
