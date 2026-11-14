# Family journal: how to use and maintain it

A private, passphrase-locked journal website. It is plain HTML, CSS and JavaScript with no build step.
Everything personal (entries, photos, videos) is encrypted on your computer before it is saved,
so the files can sit on a public host such as GitHub Pages and still be unreadable without a passphrase.

## Everyday use

1. Double-click **Start Editor.command** (first time: right-click, Open). A Terminal window opens and your browser shows the editor.
   It needs Python 3, which macOS offers to install the first time if it is missing.
2. First run only: choose the journal title and two passphrases.
   - **Parent passphrase**: opens everything, including drafts and private entries, and the editor.
   - **Family passphrase**: view only; sees published entries marked "Family".
   - There is **no reset**. Write both down and keep them somewhere safe.
3. Add or edit entries, attach files, press **Save entry**. Saving writes locked files into `content/` and `media/`.
4. Close the Terminal window when you are done.
5. Publish: upload the folder to GitHub (below).

The editor only works on your computer. On the public website the editor page shows a notice and cannot change anything.

## Quick entry

In the editor press **Quick entry**: say what happened, optionally add a sentence and one photo, and save. A photo fills in the date by itself. Unless you tick "She is happy to share this with family", the entry stays parents-only.

## Time stamps and seals

Every entry has two dates. The **event date** is the one you choose. The **"written down on" date** is set by the editor the moment a real entry is first saved and cannot be typed or changed. The journal shows it on each entry, and says plainly when a moment was added long after it happened.

Each save also makes a **seal**: a fingerprint of the entry's words, dates and files. Only the fingerprint goes into the public file `content/seals.json`; nothing about the entry can be read from it. Later, anyone you show the entry to can confirm that it matches a fingerprint that has been on GitHub since that date. Every edit adds a new seal, so the history of changes is visible too.

What this does and does not prove: it shows an entry existed in exactly this form when its seal was published. It does not prove the event happened; certificates, programs, published results and a teacher's word do that, so attach them when you have them. Publish soon after adding entries, because the date that an outsider can check is the date the seal reached GitHub.

## Who sees what

| Entry setting | Parent passphrase | Family passphrase | No passphrase |
| --- | --- | --- | --- |
| Draft, Archived, or "Parents only" | Yes | No | No |
| Published + "Family" | Yes | Yes | No |
| She said "No" to sharing | Yes | No, whatever else is set | No |
| File marked "parents only", or showing other people without consent | Yes | No | No |

Public (no passphrase) sharing is switched off in this version.

## Publishing to GitHub Pages

One-time setup:

1. On github.com create a new repository under your account. Use a neutral name such as `journal`, because repository names are public.
2. In Terminal, inside this folder:

   ```
   git init
   git add .
   git commit -m "Journal"
   git branch -M main
   git remote add origin https://github.com/Seymurhh/journal.git
   git push -u origin main
   ```
3. On GitHub: Settings, Pages, Source "Deploy from a branch", branch `main`, folder `/ (root)`.
4. The site appears at `https://seymurhh.github.io/journal/` after a minute or two.

Each later update: `git add . && git commit -m "Update" && git push`.

## What a stranger can and cannot see

- Can see: that a journal exists at the address, the site's code, the number and sizes of locked files, and when you update.
- Cannot see: the title, her name, any text, any photo or video. The lock screen shows only "A private family journal".
- The lock is only as strong as the passphrases. Locked files are downloadable by anyone, so use long passphrases (four or more unrelated words) and never post them.
- If a passphrase leaks: change it in Settings and publish. Older copies in the GitHub history stay readable with the old passphrase, so for a serious leak delete the repository and create a new one.

## Limits

- Each file must be under 95 MB (GitHub refuses files over 100 MB). Shorten or compress long videos first.
- Keep the whole site under about 1 GB (GitHub Pages limit).
- Videos download fully before playing because they are locked; short clips work best.
- iPhone HEIC photos: export as JPEG first (in Photos: File, Export, JPEG).
- Photos are resized to 1800 px and re-encoded, which also removes hidden location data.

## Piano studio

`studio.html` turns a piano performance into a 3D view (notes travelling to a keyboard that lights up) and can make an MP4 video. It runs entirely in the browser; nothing is uploaded.

**Playing live and recording (Yamaha digital piano)**

1. Connect a USB A-to-B cable ("printer cable") from the piano's USB TO HOST port to the computer. A Mac with only USB-C ports needs a USB-C adapter or a USB-C to USB-B cable.
2. Open the studio in Chrome or Edge (Safari cannot talk to MIDI devices): start the editor and go to `http://127.0.0.1:8321/studio.html`, or use the live site.
3. Press **Connect the piano** (top right) and allow MIDI access when the browser asks. The button then shows the piano's name. After the first time it connects by itself.
4. Play. Keys light up, each note leaves its key as a glowing bar, and the computer plays the instrument chosen under **Sound**. Turn the piano's own volume down to hear only that sound, or untick "Play this sound while she plays" to hear only the piano.
5. To keep a performance press **Record**, play, then **Stop**. Press Play to watch it and **Save as MIDI file** to keep it.

**Sound:** eight instruments. Concert Grand is a real Yamaha C5 grand recorded note by note (Salamander Grand Piano); Bright Grand, Soft Felt and Honky-tonk Upright are made from those recordings. Electric Grand, Electric Piano and Harpsichord come from the FluidR3 sound set. Simple Synth needs no files. "Room" adds the echo of a room or a concert hall. The sound files are in `assets/sounds/` (about 5.7 MB; credits in `CREDITS.txt` there) and an instrument is downloaded the first time it is chosen.

**Look:** five colour sets (Aurora and Ember are the dark neon ones), three cameras (Front, Along the keys, Above) and two shapes (Wide for TV and YouTube, Tall for phones and Shorts). The choices are remembered on this computer.

**Making a video:** on the Video tab choose size and smoothness, press **Make the video**, wait for the bar, then **Save the video**. Keep the tab in front while it works. The video uses the chosen instrument, room, colours, camera and shape. Its sound is the studio's instrument, not the room recording.

**Putting it in the journal:** in the editor, attach the `.mid` file (and the video if you like) to a Music entry. Family members then get a **Watch in the piano studio** button on that entry.

**Two views:** "Piano keys" shows notes travelling to a lit keyboard. "Flight lines" draws the music as glowing lines in a 3D space: left to right is time, up and down is pitch, near and far follows the direction of the melody, and thickness follows loudness.

**Dancer:** under Look, Picture, choose "Dancer". A girl drawn only by her glowing outline (ponytail and skirt swing as she moves) dances to whatever the studio hears: press "Listen with the microphone" and play any music near the computer, or press Play on a piece, or play the piano. The studio finds the beat (it needs a few seconds) and picks one of four ways of moving: Flowing (no clear beat, or very calm), Swaying (a gentle steady beat), Groove (a clear beat with more going on) and Energetic (fast or busy). It does this by measuring the beat, the tempo and how many attacks there are each second; it does not recognise genres by name, so it can choose differently from what you expect. "Way of dancing" lets you choose yourself. The moves are formulas written for this studio, not recordings of a real dancer. To keep a video, use "Start filming" on the Video tab ("Make the video" cannot draw the dancer).

**Listen with the microphone:** draws one flying line live from any sound (singing, whistling, one note at a time on any instrument). It follows a single pitch, so chords confuse it, and it is not saved or made into a video.

**Film the screen live:** "Start filming" captures the picture live with sound until you press "Stop and save"; the file goes to Downloads. Use it for the microphone view, or to capture a playback exactly as you watch it. The title text is not included in these recordings. "Make the video" is still the better choice for a finished piece, because it draws every frame exactly.

**Not built yet:** using a phone audio or video recording as the input, sheet-music view.

## Backups

The folder is the journal. Keep a copy of the whole folder (including `content/` and `media/`) on an external drive or private cloud storage.
Keep your original photos and videos too; the journal stores web-sized copies.

## Privacy checklist before sharing the address

- [ ] No home address, school name, schedules or regular locations in any text or photo
- [ ] Other children appear only with their family's agreement
- [ ] She has seen each visible entry and is happy with it
- [ ] Sample entries replaced or set back to Draft
- [ ] Family passphrase given in person or by phone only

## Files

| Path | What it is |
| --- | --- |
| `index.html`, `assets/` | The journal viewer |
| `admin.html` | The editor page (works only through Start Editor) |
| `studio.html`, `assets/css/studio.css`, `assets/js/studio.js`, `stage.js`, `flight.js`, `dancer.js`, `listen.js`, `midi.js`, `synth.js` | The piano studio |
| `assets/sounds/` | Instrument recordings for the studio (see `CREDITS.txt` there) |
| `assets/vendor/` | Third-party code used by the studio: three.js (3D) and mp4-muxer (video files), both MIT licensed |
| `tools/editor_server.py` | Small local program that lets the editor save files; listens only on this computer |
| `content/starter.json` | The placeholder entries used once, when the journal is created |
| `content/family.vault`, `content/parent.vault` | The locked entries (created by the editor) |
| `media/*.enc` | Locked photos, videos and files |
