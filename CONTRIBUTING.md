# Contributing

Thanks for taking a look. CairnTab is small on purpose; the bar for a change is "does it keep the
rules below and make the daily loop nicer".

## Before you start

- Read [`AGENTS.md`](AGENTS.md) (rules that must not break, known traps) and
  [`docs/conventions.md`](docs/conventions.md).
- For anything bigger than a fix, open an issue first and say what problem it solves.
- Design choices are recorded in [`docs/decisions.md`](docs/decisions.md). If your change reverses
  one, add a new entry that says so and why, instead of editing the old one.

## Rules that are not negotiable

1. Never delete a bookmark. Archive means move.
2. Tabs never write bookmarks; data flows bookmarks → tabs.
3. Re-read a node before every write; a vanished node is a normal outcome (`Gone`).
4. `extension/lib/` stays pure: no `chrome.*`, no DOM (`make check` enforces it).
5. No network requests, analytics or remote code. Icons come from Chrome's local cache only.

## Workflow

```
make ci        # must pass before every commit
make preview   # http://127.0.0.1:8770/dev/preview.html — the real page on a fake Chrome
```

- Add or update tests in `test/` for any logic change; the fake Chrome in `test/fake-chrome.js`
  should behave like Chrome (including its error messages and `bookmarks.move` index rule).
- Check UI changes in the preview, in light and dark, and at a narrow width.
- Use only public sites and made-up titles in fixtures, demo data and screenshots — never data
  from a real browser profile.
- `README.md` and `README-zh.md` (Traditional Chinese) describe the same thing; update both when
  behaviour or setup changes.
- If the UI changed visibly, re-render the README screenshots: `make preview` in one terminal,
  then `make screenshots`.

## License of contributions

CairnTab is licensed under Apache-2.0. Unless you say otherwise, anything you submit is contributed
under the same license (section 5). Please do not remove or reword the attribution in `NOTICE`.

## Commit messages

One change per commit. The subject says what changed (`feat: …`, `fix: …`, `docs: …`); the body
says why, in a sentence or two.
