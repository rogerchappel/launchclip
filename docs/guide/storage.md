# Where your videos are stored

Video projects get big: rendered segments, voice takes, mattes and the
finished files all live in the project folder. A library lets you keep them on
an external drive without passing `--out` to every command.

## Set up a library

```bash
launchclip library init ~/Videos/launchclip --projects /Volumes/Footage/launchclip
```

That writes `~/Videos/launchclip/launchclip.library.json`:

```json
{
  "schema": "launchclip.library.v1",
  "name": "launchclip",
  "storage": {
    "projects": "/Volumes/Footage/launchclip",
    "finals": null,
    "archive": null,
    "min_free_gb": 10
  },
  "cache": null,
  "collections": []
}
```

| Field | What it does |
|---|---|
| `storage.projects` | Where `make` and `intake` put new projects. Defaults to the library folder. An external drive is fine. |
| `storage.finals` | Where finished files will collect (used by batches later; set it now if you like). |
| `storage.archive` | Where old projects will move (later). |
| `storage.min_free_gb` | The free space a job needs on its drive before it starts. Default 10. |
| `cache` | Where voice, music and voice-isolation caches go. Defaults to `~/.cache/launchclip`. Keep it on the internal disk: it is read on every job. |

Relative paths resolve against the library folder, and `~` is your home
folder. `init` takes `--projects`, `--finals`, `--cache`, `--min-free-gb`,
`--name` and `--force` (to replace an existing file).

## Use it

Run `make` or `intake` anywhere inside the library folder:

```bash
cd ~/Videos/launchclip
launchclip make "A 30-second launch video for Ledgerly" --assets ./ledgerly
```

The project goes to `/Volumes/Footage/launchclip/launchclip-<slug>/`. `--out`
still wins when you pass it.

LaunchClip finds the library by looking in the current folder and each folder
above it. From somewhere else, point at it with `--library <path>` or the
`LAUNCHCLIP_LIBRARY` environment variable. With no library, every command
works exactly as before.

## Checks before a job

Inside a library, `make`, `intake` and `finish` check the project's drive
before writing anything:

- the drive is mounted (`/Volumes/<name>` on macOS, `/media/…` or `/mnt/…` on Linux)
- the folder is writable
- it has at least `storage.min_free_gb` free

Each failure is one line that names the folder and what to do, for example:

```
storage.projects: /Volumes/Footage is not mounted; connect the drive or change the path (set in ~/Videos/launchclip/launchclip.library.json)
```

If the drive is unplugged in the middle of a job, the job stops with one line
saying so. Plug it back in and run the same command again: finished stages
(script, storyboard, voice, music, rendered segments) are reused.

## What stays on the internal disk

- Caches: voice, music and isolation (`cache`, or `LAUNCHCLIP_CACHE`), Remotion
  bundles in the system temp folder, styles and models in `~/.launchclip`
  (`LAUNCHCLIP_HOME`).

Everything else is written to the project's drive. While `finish` renders,
temporary files (Remotion frames and downloads, the Chrome profile, HyperFrames
work files) go in a `.launchclip-tmp/` folder next to the project instead of
the system temp folder, and are removed when the render ends.
