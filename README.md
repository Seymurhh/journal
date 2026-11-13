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
| `tools/editor_server.py` | Small local program that lets the editor save files; listens only on this computer |
| `content/starter.json` | The placeholder entries used once, when the journal is created |
| `content/family.vault`, `content/parent.vault` | The locked entries (created by the editor) |
| `media/*.enc` | Locked photos, videos and files |
