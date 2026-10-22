# Voice, music and sound effects

LaunchClip scores every video for you: a voiceover, a music bed, sound effects on every visual beat, typing sounds when code appears, and a final mix mastered for social platforms. It all works with **no API keys**, and you can upgrade any part.

| | Free (built in, runs on your machine) | Optional upgrade |
|---|---|---|
| Voice | Kokoro, an offline open-source voice | ElevenLabs voices (`ELEVENLABS_API_KEY`) |
| Music | A procedural bed shaped to the video's energy | ElevenLabs music, composed to the video and synced to the beat |
| Sound effects | A built-in kit: whooshes, impacts, ticks, pops, risers, UI clicks and mechanical keyboard typing | Your own ElevenLabs-generated library |
| Your own audio | Supply a voiceover or a music file and it's used as is | — |

The first time the built-in voice runs, it downloads its model (about 325 MB) once.

## Your own voiceover

Drop in a recorded voiceover and LaunchClip uses your timing and words: it tightens long pauses, levels the loudness and lines up captions to what you said.

## Music that follows the edit

With an ElevenLabs key, LaunchClip composes an instrumental track sized to your video, with calm sections where the video is calm and lift where it builds. It then lines the beat up with the cuts:
- **Videos with narration:** the music shifts so downbeats land on the big moments.
- **Videos without narration:** the cuts snap to the beat.

Once a project has a track, it is **locked**. Change scenes as much as you like and LaunchClip reuses the same track (it prints `REUSE` or `PAID` before any request), unless you ask for a new one with `--music-regenerate`.

## Your own sound-effect library

The built-in effects are good. If you want effects that are unique to you, seed a library once:

```bash
launchclip sfx seed               # uses ElevenLabs if a key is set, otherwise the built-in kit
launchclip sfx audition whoosh    # listen to every whoosh variant
launchclip sfx reroll keystroke   # don't like the typing sounds? regenerate just those
```

Every clip is trimmed so it starts exactly on its hit, its tail is faded, and it is levelled. From then on, every video uses your library, so your channel sounds consistent. It lives in `.launchclip/sfx/`, or in `~/.launchclip/sfx/` to use it across projects.

## Delivery-ready loudness

Every finished video is mastered to −14 LUFS with a −1 dBTP ceiling, the level YouTube, TikTok and Instagram expect. The voice stays clearly above the music.
