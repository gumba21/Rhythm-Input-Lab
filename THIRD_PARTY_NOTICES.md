# Third-party notices

## FunkinChart

The FNF chart-import design was informed by the uploaded **Funkin' Web Chart / FunkinChart** project by jsm925, particularly its handling of legacy FNF sections, `mustHitSection`, note-lane halves, sustains, and dynamic BPM sections.

Rhythm Input Lab contains an independently written Python importer and does not require FunkinChart at runtime.

The uploaded FunkinChart project is licensed under the GNU Lesser General Public License version 3. A copy of its license is included at `third_party/FunkinChart_LICENSE.txt`.

## Web osu!mania

Rhythm Input Lab's osu!mania adapter was developed with the open-source **Web osu!mania** project available as a format and implementation reference. Rhythm Input Lab uses its own Python parser and neutral RIL runtime model; it does not bundle Web osu!mania's renderer, assets, game client, or dependencies.

Web osu!mania is licensed under the MIT License:

```text
MIT License

Copyright (c) 2024 Danny Duong

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Quaver and Quaver.API

Rhythm Input Lab's Quaver adapter was developed with the user-supplied Quaver client source and the public **Quaver.API** implementation available as format references, particularly the `.qua` model, `.qp` packaging, key-mode mapping, mines, long notes, timing points, slider velocities, scroll-speed factors, timing groups, bookmarks, hit sounds, and active-actions-per-second definition.

Rhythm Input Lab uses an independently written Python parser and neutral adapter. It does not bundle Quaver client code, Quaver.API assemblies, Quaver artwork, gameplay assets, or Quaver's difficulty calculator.

The referenced Quaver source is licensed under the Mozilla Public License 2.0. No Quaver source files are copied into Rhythm Input Lab.

## osu!

osu! and osu!mania are created by ppy Pty Ltd and contributors. Rhythm Input Lab is an independent project and is not affiliated with or endorsed by osu! or its creators. Imported beatmaps and audio remain subject to their respective creators' rights and applicable sharing rules.

## Quaver

Quaver is created by Swan and the Quaver Team. Rhythm Input Lab is an independent project and is not affiliated with or endorsed by Quaver or its creators. Imported maps and media remain subject to their respective creators' rights and applicable sharing rules.

## Supplied visual assets

The optional FNF visual theme uses `NOTE_assets.png`, `NOTE_assets.xml`, `noteSplashes.png`, and `noteSplashes.xml` supplied by the user for this build. Rhythm Input Lab's Minimal and X-ray themes do not depend on those assets.
