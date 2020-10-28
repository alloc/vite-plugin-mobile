# vite-plugin-mobile

- Serve different modules based on the [user agent].
- Build separate bundles for mobile and desktop.
- Easily share modules between them.

[user agent]: https://en.wikipedia.org/wiki/User_agent

```ts
import mobile from 'vite-plugin-mobile'

export default {
  plugins: [
    mobile(),
  ]
}
```

&nbsp;

### Options

- `mobileRoot: string`  
  The directory containing mobile-only modules.  
  Defaults to `"/src/mobile"`

- `desktopRoot: string`  
  The directory containing desktop-only modules.  
  Defaults to `"/src/desktop"`

- `tabletRoot: string`  
  The directory containing tablet-only modules.  
  Defaults to `this.mobileRoot`

&nbsp;

### Notes

- "Common chunks" are *not* generated, so bundles *will* contain duplicate modules.
- Assets in `public/` are shared between bundles.
- Your `index.html` is rendered once per bundle.
- The desktop bundle is used by `dist/index.html`.
- The mobile bundle is used by `dist/index.mobile.html`.
- When `tabletRoot` is unique, a separate tablet-only bundle is generated and
  used by `dist/index.tablet.html`.
