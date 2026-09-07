# Album manifest

All files are local and resolved within the folder containing `album.json`, including symlinks. Put the manifest in the existing image folder; do not copy unrelated images into the tool checkout.

```json
{
  "schemaVersion": 1,
  "id": "product-shoot",
  "revision": "1",
  "title": "Product alternatives",
  "photos": [
    {
      "id": "candidate-01",
      "file": "candidate-01.png",
      "title": "Soft light",
      "group": "Candidates",
      "referenceId": "reference-01",
      "focusBox": [0.25, 0.2, 0.75, 0.65]
    },
    {
      "id": "reference-01",
      "file": "reference-01.jpg",
      "title": "Existing selection",
      "group": "References",
      "baseline": "selected"
    }
  ]
}
```

- Required top-level: schemaVersion=1, id, revision, title, photos.
- Required per photo: id, file, title. Group defaults to `Images`, baseline to `candidate`.
- IDs start with an ASCII letter or digit, then contain letters/digits/underscore/hyphen, 1–80 characters; prototype-related keys are invalid. Revision is a nonempty string, up to 80 characters.
- Titles allow up to 500 UTF-16 code units and groups up to 200; both reject control characters. Review notes allow up to 4000 UTF-16 code units and are never silently shortened.
- `referenceId` must name another photo in this album. No self-reference. Omit it when no meaningful reference exists.
- `focusBox` is `[left,top,right,bottom]`, numbers between 0 and 1 with left<right and top<bottom. Omit it instead of inventing the face/product location. Image dimensions come from headers.
- PNG, JPEG and WebP only; no SVG, HTML, remote URLs or outside-folder paths. Maximum 500 images, 32 MiB each, 256 MiB total.
- Use `baseline: selected` only for an actual existing selection. It is not a new user verdict or identity certification.
- Keep image IDs stable within a revision. The tool also hashes image bytes and metadata; changed content gets isolated draft/receipt state.

For the complete server and receipt schema, use the checkout's `docs/contract.md`. Validate every manifest with the CLI before offering the album to the user.
