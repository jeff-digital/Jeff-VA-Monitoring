# Payment brand assets

Wise and PayPal marks identify the available payment methods. Trademarks belong to their respective owners.

- Wise dark wordmark: [official Wise newsroom media kit](https://newsroom.wise.com/en-NAM/assets/228784/), asset `470455-Frame 39263-cdfad6-original-1677657684.png` from its linked CloudFront library.
- PayPal: [official hosted logo](https://www.paypalobjects.com/webstatic/mktg/Logo/pp-logo-200px.png).

Only surrounding blank space was trimmed; artwork and colors are preserved. PNG copies live in `src/frontend/images/payment-*.png`. The same PNG bytes are embedded in `invoice-payment-brands.js` for synchronous, offline PDF exports; update both copies together. Invoice preview uses the local image files. No external logo request is made when viewing or exporting an invoice.
