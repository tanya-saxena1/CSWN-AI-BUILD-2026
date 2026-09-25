# CSWN-AI-BUILDS-2026

We want to build a computer vision interface that lets a person control common computer actions using signals
that work for them. One person might use hand gestures. Another might have no usable hand movement and use
head movement with dwell selection. Both should reach the same actions. Mouse and keyboard controls require movements that are difficult or unavailable for some people. A hand gesture interface alone repeats that barrier for people who cannot use their hands. Our design separates a user’s intended action from the physical signal used to request it. A person can choose a profile, adjust how much movement is needed, and change how a command is triggered. No one alternative input will work for every disabled person, so the interface should support choices and visible fallbacks.

# What the prototype will do:
- Recognize deliberate hand signals: hand position steers focus, a stable pinch selects, and an open palm held
briefly pauses input.
- Provide a no-hand camera profile: small head movements steer a cursor or focus highlight. Holding on a target
for a configurable dwell period selects it.
- Provide keyboard controls and a one-key scanning mode. The highlight cycles through controls; a keypress
selects the highlighted control. A switch that acts as a keyboard key could use this route.
- Connect every input to the same commands: next slide, previous slide, play or pause media, move focus,
select, back, and pause input.
- Display active mode, recognized signal, tracking status, last command, and dwell progress. Let users adjust
sensitivity, dwell duration, and command assignments.
