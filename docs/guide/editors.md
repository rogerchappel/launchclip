# Finish in your own editor

Want to make the final touches yourself? Export any LaunchClip project as an editable timeline:

```bash
launchclip export ./my-video --format fcpxml     # Final Cut Pro
launchclip export ./my-video --format premiere   # Premiere Pro and DaVinci Resolve
launchclip export ./my-video --format all        # plus CMX3600 EDL and OpenTimelineIO
```

The timeline arrives on separate tracks:
- your footage, with every cut, as clips;
- each animated scene as its own transparent clip;
- voice, music, every sound effect and the typing track on separate audio tracks;
- captions as a subtitle track;
- markers at each scene and key moment.

Everything lands in `exports/<name>/`, with the media alongside. It handles exact frame rates, including 29.97 drop-frame.
