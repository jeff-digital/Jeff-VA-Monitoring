# Jeff VA mobile design preview

An interactive browser demonstration of the native Android app's interface. All records, account details, messages, amounts and charts are synthetic. The preview does not sign into Supabase, connect a real inbox, send email or request actual phone notifications.

This is a UI prototype, not an Android emulator. The native Java app is maintained in `../project/`; system widgets, typography and device behavior can differ from this preview.

## Run locally

Install Node.js and then, from this directory:

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 4173
```

Open the local address printed by Vite. Supported initial views include `?screen=Applications`, `?screen=Daily%20tasks`, `?screen=Email%20inbox` and `?screen=More`.

Navigate using the phone's bottom tabs and More menu. Sample actions affect only in-memory preview records. Reloading resets the samples. No mobile backend configuration is needed for the preview.

## Check the preview

```sh
npx tsc --noEmit
npm run check:runtime
```

The mobile shell includes the Pixel/iPhone picker, simulated keyboard and scrolling behavior. App UI lives in `src/Prototype.tsx` and `src/prototype.css`; the shell's integrity lock detects accidental runtime edits.

See the parent [Android README](../README.md) for native features, setup, limits and sample screenshots.
