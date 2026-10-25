# Voice, music and sound effects

LaunchClip scores every video for you: a voiceover, a music bed, sound effects on every visual beat, typing sounds when code appears, and a final mix mastered for social platforms. It all works with **no API keys**, and you can upgrade any part.

| | Free (built in, runs on your machine) | Optional upgrade |
|---|---|---|
| Voice | Kokoro, an offline open-source voice | ElevenLabs voices (`ELEVENLABS_API_KEY`) |
| Music | A procedural bed shaped to the video's energy, in nine genres from ambient to house to chiptune | ElevenLabs music, composed to the video and synced to the beat |
| Sound effects | A built-in kit of 31 effect families (whooshes, impacts, chimes, page turns, shutters, cash registers and more, plus mechanical keyboard typing) in 12 sonic palettes | Your own ElevenLabs-generated library |
| Ambience | Quiet, looping room sound for the scene's world: an office, a cafe, a street by day or night, rain, waves | — |
| Your own audio | Supply a voiceover or a music file and it's used as is | — |

The first time the built-in voice runs, it downloads its model (about 325 MB) once.

## Your own voiceover

Drop in a recorded voiceover and LaunchClip uses your timing and words: it tightens long pauses, levels the loudness and lines up captions to what you said.

## Music that follows the edit

With an ElevenLabs key, LaunchClip composes an instrumental track sized to your video, with calm sections where the video is calm and lift where it builds. It then lines the beat up with the cuts:
- **Videos with narration:** the music shifts so downbeats land on the big moments.
- **Videos without narration:** the cuts snap to the beat.

Once a project has a track, it is **locked**. Change scenes as much as you like and LaunchClip reuses the same track (it prints `REUSE` or `PAID` before any request), unless you ask for a new one with `--music-regenerate`.

## A sound for every style

A style can carry a `sound` block. A seeded style (see the seeded styles RFC) gets one drawn from its seed, so two videos made from bare prompts don't sound alike, and the same project always sounds the same.

```json
"sound": {
  "palette": "organic",
  "music": { "genre": "lo-fi", "bpm": 84, "key": "D", "progression": 2 },
  "ambience": "auto",
  "sfx_density": 0.5
}
```

- **`palette`** sets the timbre of every sound effect. A whoosh in `organic` is breath and paper; in `retro-8bit` it is a bit-crushed square-wave zap. The palettes are `cinematic`, `glassy`, `organic`, `cartoon`, `lofi`, `retro-8bit`, `analog`, `minimal`, `documentary`, `synthwave`, `soft` and `industrial`. The style's seed draws fresh variants inside the palette, so your whooshes are your own.
- **`music`** picks a synth genre: `ambient`, `lo-fi`, `house`, `synthwave`, `acoustic-pluck`, `cinematic-pulse`, `chiptune`, `jazz-hop` or `orchestral-lite`. Each has four chord progressions, its own instruments and tempo range, and drums that come in where the video builds. The beat still lines up with the cuts.
- **`ambience`** plays a quiet room sound under everything, ducked when someone speaks. `auto` picks one from the style's world (a cafe murmurs, a night street has distant traffic and a siren, a park at night has crickets); you can also name a bed (`office`, `cafe`, `street-day`, `street-night`, `crickets`, `rain`, `waves`, `wind`, `server-room`, `crowd`, `birds`, `room-tone`, `space-hum`) or say `none`.
- **`sfx_density`** sets how many effects play, from `0` (only some of the hits) to `1` (all of them). `low`, `normal` and `high` still work.

A storyboard can override any of it with `audio.sound`. With no `sound` block, nothing changes: you get the same built-in sound as before.

To hear everything, run:

```bash
node scripts/sound-audition.mjs --out audition
```

It writes one WAV per palette (every effect in turn), a 20-second clip per genre, every ambience loop, and a mastered test mix per genre, and checks them all against the loudness and audio gates.

## Your own sound-effect library

The built-in effects are good. If you want effects that are unique to you, seed a library once (a library wins over the palette for the families it has):

```bash
launchclip sfx seed               # uses ElevenLabs if a key is set, otherwise the built-in kit
launchclip sfx audition whoosh    # listen to every whoosh variant
launchclip sfx reroll keystroke   # don't like the typing sounds? regenerate just those
```

Every clip is trimmed so it starts exactly on its hit, its tail is faded, and it is levelled. From then on, every video uses your library, so your channel sounds consistent. It lives in `.launchclip/sfx/`, or in `~/.launchclip/sfx/` to use it across projects.

## Delivery-ready loudness

Every finished video is mastered to −14 LUFS with a −1 dBTP ceiling, the level YouTube, TikTok and Instagram expect. The voice stays clearly above the music.
